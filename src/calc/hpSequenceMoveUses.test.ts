import { describe, expect, it, vi } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type {
  Build,
  EntityRef,
  FieldState,
  ScenarioHit,
  ScenarioHitEvaluation,
  SideState,
  StatTable,
} from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  buildHpSequenceMoveUses,
  getAutomaticMoveHpNotices,
  moveUseRequiresHpSequence,
} from "./hpSequenceMoveUses";
import { toSmogonPokemon } from "./smogonAdapter";

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

const field: FieldState = {
  gameType: "singles",
  weather: "none",
  terrain: "none",
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
  options: Partial<ScenarioHit> = {},
): ScenarioHit => ({
  id: `hit-${move}`,
  attacker: makeBuild("attacker"),
  move: mustResolve("move", move),
  repeat: 1,
  critical: false,
  attackerBoosts: {},
  defenderBoosts: {},
  attackerSide: emptySide,
  defenderSide: emptySide,
  ...options,
});

const makeEvaluation = (
  hitId: string,
  damageRolls: number[] = [1],
): ScenarioHitEvaluation => ({
  hitId,
  damageRolls,
  damageRange: {
    min: Math.min(...damageRolls),
    max: Math.max(...damageRolls),
    percentMin: 0,
    percentMax: 0,
  },
});

const buildMoveUses = (
  hit: ScenarioHit,
  evaluation = makeEvaluation(hit.id),
) => buildHpSequenceMoveUses({
  defenderBuild: makeBuild("defender"),
  hit,
  field,
  evaluation,
});

describe("buildHpSequenceMoveUses", () => {
  it("maps contact, HP cost, standard recoil, special recoil, and forced faint profiles", () => {
    const contact = buildMoveUses(makeHit("Drain Punch"))[0];
    const hpCostHit = makeHit("Belly Drum");
    const hpCost = buildMoveUses(hpCostHit, makeEvaluation(hpCostHit.id, [0]))[0];
    const damageRecoil = buildMoveUses(makeHit("Double-Edge"))[0];
    const struggle = buildMoveUses(makeHit("Struggle"))[0];
    const mindBlown = buildMoveUses(makeHit("Mind Blown"))[0];
    const finalGambit = buildMoveUses(makeHit("Final Gambit"))[0];
    const attackerMaxHp = toSmogonPokemon(hpCostHit.attacker).maxHP();

    expect(contact.automaticHpEffects).toMatchObject({
      makesContact: true,
    });
    expect(hpCost.automaticHpEffects?.hpCost).toMatchObject({
      effectId: "move-hp-cost:belly-drum",
      amount: Math.floor(attackerMaxHp / 2),
    });
    expect(damageRecoil.automaticHpEffects?.damageBasedRecoil).toEqual({
      effectId: "move-damage-recoil",
      label: expect.stringContaining("反動"),
      numerator: 33,
      denominator: 100,
    });
    expect(struggle.automaticHpEffects?.specialRecoil).toMatchObject({
      effectId: "move-special-recoil:struggle",
      amount: Math.round(attackerMaxHp / 4),
    });
    expect(mindBlown.automaticHpEffects?.specialRecoil).toMatchObject({
      effectId: "move-special-recoil:mind-blown",
      amount: Math.ceil(attackerMaxHp / 2),
    });
    expect(finalGambit.automaticHpEffects?.forcesAttackerFaint).toMatchObject({
      effectId: "move-forced-faint:final-gambit",
    });
  });

  it("only requires sequence simulation for HP-changing move mechanics", () => {
    const contactOnly = buildMoveUses(makeHit("Drain Punch"))[0];
    const recoil = buildMoveUses(makeHit("Double-Edge"))[0];
    const currentHp = buildMoveUses(makeHit("Super Fang"))[0];

    expect(moveUseRequiresHpSequence(contactOnly)).toBe(false);
    expect(moveUseRequiresHpSequence(recoil)).toBe(true);
    expect(moveUseRequiresHpSequence(currentHp)).toBe(true);
  });

  it("shows automatic notices without requiring extra user events", () => {
    expect(getAutomaticMoveHpNotices(makeHit("Double-Edge"))).toEqual([
      expect.objectContaining({
        id: "damage-recoil:Double-Edge",
        timingLabel: "技の後",
        formulaLabel: expect.stringContaining("33/100"),
      }),
    ]);
    expect(getAutomaticMoveHpNotices(makeHit("Final Gambit"))).toEqual([
      expect.objectContaining({ id: "current-hp:Final Gambit" }),
      expect.objectContaining({ id: "forced-faint:final-gambit" }),
    ]);
  });

  it("recalculates current-HP-dependent damage per HP state and caches identical states", () => {
    const hit = makeHit("Super Fang", { repeat: 2 });
    const calculateHit = vi.fn((
      _defenderBuild: Build,
      currentHit: ScenarioHit,
      _fieldState: FieldState,
      options?: {
        attackerCurrentHp?: number;
        defenderCurrentHp?: number;
      },
    ): ScenarioHitEvaluation => {
      const damage = Math.max(1, Math.floor((options?.defenderCurrentHp ?? 1) / 2));
      return makeEvaluation(currentHit.id, [damage]);
    });
    const moveUses = buildHpSequenceMoveUses({
      defenderBuild: makeBuild("defender"),
      hit,
      field,
      evaluation: makeEvaluation(hit.id, [50]),
      calculateHit,
    });
    const resolveFirst = moveUses[0].resolveDamageRollsByHit;
    const resolveSecond = moveUses[1].resolveDamageRollsByHit;

    expect(resolveFirst).toBeDefined();
    expect(resolveSecond).toBe(resolveFirst);
    expect(resolveFirst?.(175, 101)).toEqual([[50]]);
    expect(resolveSecond?.(175, 101)).toEqual([[50]]);
    expect(resolveFirst?.(175, 51)).toEqual([[25]]);
    expect(calculateHit).toHaveBeenCalledTimes(2);
    expect(calculateHit.mock.calls.map((call) => call[3])).toEqual([
      { attackerCurrentHp: 175, defenderCurrentHp: 101 },
      { attackerCurrentHp: 175, defenderCurrentHp: 51 },
    ]);
  });
});
