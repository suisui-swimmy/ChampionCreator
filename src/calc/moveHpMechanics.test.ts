import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type {
  Build,
  EntityRef,
  ScenarioHit,
  SideState,
  StatTable,
} from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  getMoveHpMechanicsProfile,
  isCurrentHpDependentMoveCanonicalName,
} from "./moveHpMechanics";
import { calculateSmogonHit, toSmogonPokemon } from "./smogonAdapter";

const mustResolve = <K extends EntityKind>(
  kind: K,
  input: string,
): EntityRef<K> => {
  const ref = toEntityRef(resolveEntity(kind, input), kind);
  if (!ref) {
    throw new Error(`Expected ${kind}:${input} to resolve`);
  }
  return ref;
};

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const zeroEvs: StatTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
};

const makeBuild = (
  id: string,
  pokemon = "Mew",
  options: Partial<Build> = {},
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemon),
  level: 50,
  ivs: defaultIvs,
  evs: zeroEvs,
  ...options,
});

const makeHit = (
  move: string,
  attackerOptions: Partial<Build> = {},
): ScenarioHit => ({
  id: `hit-${move}`,
  attacker: makeBuild("attacker", "Mew", attackerOptions),
  move: mustResolve("move", move),
  repeat: 1,
  critical: false,
  attackerBoosts: {},
  defenderBoosts: {},
  attackerSide: emptySide,
  defenderSide: emptySide,
});

const field = {
  gameType: "singles",
  weather: "none",
  terrain: "none",
} as const;

describe("getMoveHpMechanicsProfile", () => {
  it("identifies moves whose power or damage depends on current HP", () => {
    expect(isCurrentHpDependentMoveCanonicalName("Eruption")).toBe(true);
    expect(isCurrentHpDependentMoveCanonicalName("Water Spout")).toBe(true);
    expect(isCurrentHpDependentMoveCanonicalName("Sucker Punch")).toBe(false);
  });

  it("derives contact and damage-based recoil from @smogon/calc Move metadata", () => {
    const doubleEdge = getMoveHpMechanicsProfile(makeHit("Double-Edge"));
    const thunderbolt = getMoveHpMechanicsProfile(makeHit("Thunderbolt"));

    expect(doubleEdge).toMatchObject({
      canonicalName: "Double-Edge",
      makesContact: true,
      damageBasedRecoil: {
        numerator: 33,
        denominator: 100,
      },
    });
    expect(thunderbolt.makesContact).toBe(false);
    expect(thunderbolt.damageBasedRecoil).toBeUndefined();
  });

  it("suppresses contact for Long Reach, Protective Pads, and punching moves with Punching Glove", () => {
    const drainPunch = makeHit("Drain Punch");
    const withLongReach = makeHit("Drain Punch", {
      ability: mustResolve("ability", "Long Reach"),
    });
    const withProtectivePads = makeHit("Drain Punch", {
      item: mustResolve("item", "Protective Pads"),
    });
    const withPunchingGlove = makeHit("Drain Punch", {
      item: mustResolve("item", "Punching Glove"),
    });
    const nonPunchWithPunchingGlove = makeHit("Bite", {
      item: mustResolve("item", "Punching Glove"),
    });

    expect(getMoveHpMechanicsProfile(drainPunch).makesContact).toBe(true);
    expect(getMoveHpMechanicsProfile(withLongReach).makesContact).toBe(false);
    expect(getMoveHpMechanicsProfile(withProtectivePads).makesContact).toBe(false);
    expect(getMoveHpMechanicsProfile(withPunchingGlove).makesContact).toBe(false);
    expect(getMoveHpMechanicsProfile(nonPunchWithPunchingGlove).makesContact).toBe(true);
  });

  it("keeps Struggle and Mind Blown style recoil separate from damage-based recoil", () => {
    const struggle = getMoveHpMechanicsProfile(makeHit("Struggle"));
    const mindBlown = getMoveHpMechanicsProfile(makeHit("Mind Blown"));
    const steelBeam = getMoveHpMechanicsProfile(makeHit("Steel Beam"));

    expect(struggle.specialRecoil).toEqual({ kind: "struggle" });
    expect(struggle.damageBasedRecoil).toBeUndefined();
    expect(mindBlown.specialRecoil).toEqual({ kind: "mind-blown" });
    expect(steelBeam.specialRecoil).toEqual({ kind: "mind-blown" });
  });

  it.each([
    ["Belly Drum", "belly-drum", 50],
    ["Substitute", "substitute", 25],
    ["Clangorous Soul", "clangorous-soul", 33],
    ["Shed Tail", "shed-tail", 51],
    ["Fillet Away", "fillet-away", 50],
  ] as const)(
    "reports the HP cost and strict payment condition for %s",
    (move, kind, expectedCost) => {
      const hpCost = getMoveHpMechanicsProfile(makeHit(move)).hpCost;

      expect(hpCost?.kind).toBe(kind);
      expect(hpCost?.amount(101)).toBe(expectedCost);
      expect(hpCost?.canPay(expectedCost + 1, 101)).toBe(true);
      expect(hpCost?.canPay(expectedCost, 101)).toBe(false);
    },
  );

  it("treats Curse as an HP-cost move only for a current Ghost type", () => {
    const nonGhost = getMoveHpMechanicsProfile(makeHit("Curse"));
    const ghost = getMoveHpMechanicsProfile({
      ...makeHit("Curse"),
      attacker: makeBuild("ghost-attacker", "Gengar"),
    });
    const teraGhost = getMoveHpMechanicsProfile(makeHit("Curse", {
      teraType: mustResolve("type", "Ghost"),
    }));

    expect(nonGhost.hpCost).toBeUndefined();
    expect(ghost.hpCost?.kind).toBe("ghost-curse");
    expect(ghost.hpCost?.amount(101)).toBe(50);
    expect(teraGhost.hpCost?.kind).toBe("ghost-curse");
  });

  it("marks target- and user-current-HP moves and Final Gambit's forced faint", () => {
    const superFang = getMoveHpMechanicsProfile(makeHit("Super Fang"));
    const guardian = getMoveHpMechanicsProfile(makeHit("Guardian of Alola"));
    const eruption = getMoveHpMechanicsProfile(makeHit("Eruption"));
    const finalGambit = getMoveHpMechanicsProfile(makeHit("Final Gambit"));
    const ordinaryMove = getMoveHpMechanicsProfile(makeHit("Thunderbolt"));

    expect(superFang).toMatchObject({
      usesCurrentHpDamage: true,
      currentHpDependency: "defender",
    });
    expect(guardian.currentHpFormulaLabel).toContain("3/4");
    expect(eruption).toMatchObject({
      usesCurrentHpDamage: true,
      currentHpDependency: "attacker",
    });
    expect(finalGambit).toMatchObject({
      usesCurrentHpDamage: true,
      currentHpDependency: "attacker",
      forcesAttackerFaint: true,
    });
    expect(ordinaryMove.usesCurrentHpDamage).toBe(false);
    expect(ordinaryMove.forcesAttackerFaint).toBe(false);
  });
});

describe("current HP @smogon/calc adapter", () => {
  const defender = makeBuild("defender");

  it("passes an explicit current HP into Pokemon", () => {
    const pokemon = toSmogonPokemon(
      makeBuild("current-hp"),
      {},
      false,
      { currentHp: 37 },
    );

    expect(pokemon.curHP()).toBe(37);
  });

  it("recalculates user-current-HP base power and Final Gambit damage", () => {
    const eruptionHit = makeHit("Eruption");
    const fullHp = toSmogonPokemon(eruptionHit.attacker).maxHP();
    const fullPower = calculateSmogonHit(
      defender,
      eruptionHit,
      field,
      { attackerCurrentHp: fullHp },
    );
    const lowPower = calculateSmogonHit(
      defender,
      eruptionHit,
      field,
      { attackerCurrentHp: Math.floor(fullHp / 4) },
    );
    const finalGambit = calculateSmogonHit(
      defender,
      makeHit("Final Gambit"),
      field,
      { attackerCurrentHp: 37 },
    );

    expect(lowPower.damageRange.max).toBeLessThan(fullPower.damageRange.max);
    expect(finalGambit.damageRolls).toEqual([37]);
  });

  it.each([
    ["Super Fang", 50],
    ["Nature's Madness", 50],
    ["Ruination", 50],
  ] as const)(
    "uses current target HP for %s without app-owned direct damage",
    (move, expectedDamage) => {
      const result = calculateSmogonHit(
        defender,
        makeHit(move),
        field,
        { defenderCurrentHp: 101 },
      );

      expect(result.damageRolls).toEqual([expectedDamage]);
      expect(result.description).toContain(move);
    },
  );

  it("preserves Super Fang's Normal-type immunity in the compatibility route", () => {
    const ghostDefender = makeBuild("ghost-defender", "Gengar");
    const result = calculateSmogonHit(
      ghostDefender,
      makeHit("Super Fang"),
      field,
      { defenderCurrentHp: 101 },
    );

    expect(result.damageRolls).toEqual([0]);
  });

  it.each([
    "Super Fang",
    "Nature's Madness",
    "Ruination",
    "Guardian of Alola",
  ] as const)("keeps %s at minimum 1 damage against a target at 1 HP", (move) => {
    const result = calculateSmogonHit(
      defender,
      makeHit(move),
      field,
      { defenderCurrentHp: 1 },
    );

    expect(result.damageRolls).toEqual([1]);
  });
});
