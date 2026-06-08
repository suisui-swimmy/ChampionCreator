import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type {
  Build,
  EntityRef,
  FieldState,
  NatureRef,
  SideState,
  StatBoostTable,
  StatTable,
} from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  calculateKoProbability,
  calculateOffenseAdjustment,
  type OffenseAdjustmentInput,
} from "./offenseAdjustment";

const mustResolve = <K extends EntityKind>(kind: K, input: string): EntityRef<K> => {
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

const zeroStatPoints: StatTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const zeroBoosts: StatBoostTable = {
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
  friendGuard: false,
};

const emptyField: FieldState = {
  gameType: "singles",
  weather: "none",
  terrain: "none",
};

const statPointsToEvs = (statPoints: StatTable): StatTable => ({
  hp: statPoints.hp === 0 ? 0 : 4 + (statPoints.hp - 1) * 8,
  atk: statPoints.atk === 0 ? 0 : 4 + (statPoints.atk - 1) * 8,
  def: statPoints.def === 0 ? 0 : 4 + (statPoints.def - 1) * 8,
  spa: statPoints.spa === 0 ? 0 : 4 + (statPoints.spa - 1) * 8,
  spd: statPoints.spd === 0 ? 0 : 4 + (statPoints.spd - 1) * 8,
  spe: statPoints.spe === 0 ? 0 : 4 + (statPoints.spe - 1) * 8,
});

const makeBuild = (
  id: string,
  pokemonInput: string,
  natureInput = "",
  statPoints: StatTable = zeroStatPoints,
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemonInput),
  nature: natureInput ? mustResolve("nature", natureInput) : undefined,
  level: 50,
  ivs: defaultIvs,
  statPoints,
  evs: statPointsToEvs(statPoints),
});

const makeInput = (
  moveInput: string,
  options: Partial<OffenseAdjustmentInput> = {},
): OffenseAdjustmentInput => ({
  attackerBuild: makeBuild("attacker", "ドドゲザン", "いじっぱり"),
  defenderBuild: makeBuild("defender", "ピチュー"),
  move: mustResolve("move", moveInput),
  moveInput,
  targetKoProbability: 1,
  field: emptyField,
  critical: false,
  attackerBoosts: zeroBoosts,
  defenderBoosts: zeroBoosts,
  attackerSide: emptySide,
  defenderSide: emptySide,
  ...options,
});

describe("calculateKoProbability", () => {
  it("counts rolls that reach or exceed the defender HP as KO rolls", () => {
    expect(calculateKoProbability(100, [99, 100, 101, 50])).toBe(0.5);
    expect(calculateKoProbability(100, [])).toBe(0);
  });
});

describe("calculateOffenseAdjustment", () => {
  it("returns an A line for ordinary physical moves and a C line for ordinary special moves", () => {
    const physical = calculateOffenseAdjustment(makeInput("ふいうち"))[0];
    const special = calculateOffenseAdjustment(makeInput("10まんボルト", {
      attackerBuild: makeBuild("attacker", "ピカチュウ", "ひかえめ"),
      defenderBuild: makeBuild("defender", "コイキング"),
    }))[0];

    expect(physical).toMatchObject({ stat: "atk", label: "Aライン", canApply: true, status: "pass" });
    expect(special).toMatchObject({ stat: "spa", label: "Cライン", canApply: true, status: "pass" });
  });

  it("returns B and H lines for Body Press and Final Gambit without making them auto-applicable", () => {
    const bodyPress = calculateOffenseAdjustment(makeInput("ボディプレス"))[0];
    const finalGambit = calculateOffenseAdjustment(makeInput("いのちがけ", {
      attackerBuild: makeBuild("attacker", "コノヨザル", "いじっぱり"),
    }))[0];

    expect(bodyPress).toMatchObject({ stat: "def", label: "Bライン", canApply: false });
    expect(finalGambit).toMatchObject({ stat: "hp", label: "Hライン", canApply: false });
  });

  it("returns both A and C lines for adaptive offense moves", () => {
    const attacker = {
      ...makeBuild("attacker", "ピカチュウ", "ひかえめ"),
      teraType: mustResolve("type", "でんき"),
    };
    const results = calculateOffenseAdjustment(makeInput("テラバースト", { attackerBuild: attacker }));

    expect(results.map((result) => result.stat)).toEqual(["atk", "spa"]);
    expect(results.map((result) => result.label)).toEqual(["Aライン", "Cライン"]);
  });

  it("uses current speed conditions for speed-powered moves but searches only the damage stat", () => {
    const result = calculateOffenseAdjustment(makeInput("ジャイロボール", {
      attackerBuild: makeBuild("attacker", "ドータクン", "ゆうかん", { ...zeroStatPoints, spe: 0 }),
      defenderBuild: makeBuild("defender", "マルマイン", "おくびょう", { ...zeroStatPoints, spe: 32 }),
    }))[0];

    expect(result).toMatchObject({ stat: "atk", label: "Aライン" });
  });

  it("reports Foul Play as an opponent A reference that cannot be applied to the target", () => {
    const result = calculateOffenseAdjustment(makeInput("イカサマ"))[0];

    expect(result).toMatchObject({
      owner: "target",
      stat: "atk",
      label: "相手A参照",
      canApply: false,
    });
  });

  it("treats stat-invariant moves as fixed current-condition results", () => {
    const result = calculateOffenseAdjustment(makeInput("まもる"))[0];

    expect(result).toMatchObject({
      status: "fixed",
      canApply: false,
      requiredStatPoints: null,
    });
  });

  it("adds a boosted-nature reference line when the current A/C nature cannot reach the target", () => {
    const boostedNature = mustResolve("nature", "ひかえめ") as NatureRef;
    const result = calculateOffenseAdjustment(makeInput("10まんボルト", {
      attackerBuild: makeBuild("attacker", "コイキング", "いじっぱり"),
      defenderBuild: makeBuild("defender", "ハピナス", "おだやか", { ...zeroStatPoints, hp: 32, spd: 32 }),
      boostedNatures: { spa: boostedNature },
    }))[0];

    expect(result.status).toBe("fail");
    expect(result.reference?.stat).toBe("spa");
    expect(result.reference?.canApply).toBe(false);
  });
});
