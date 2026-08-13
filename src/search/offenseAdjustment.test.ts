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
import type { HpEvent } from "../domain/hpEvents";
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
  it("returns the actually applied assisted move power", () => {
    const result = calculateOffenseAdjustment(makeInput("おはかまいり", {
      movePowerOverride: { value: 200, source: "assisted" },
    }))[0];

    expect(result.movePower).toEqual({
      catalogBasePower: 50,
      appliedBasePower: 200,
      source: "assisted",
      detailLabel: "ひんしの味方 3体",
    });
  });

  it("keeps the direct-only result compatible when no HP events are configured", () => {
    const result = calculateOffenseAdjustment(makeInput("ふいうち"))[0];

    expect(result.hpEventEvaluations).toEqual([]);
    expect(result).toMatchObject({
      stat: "atk",
      label: "Aライン",
      passed: true,
      koProbability: 1,
    });
  });

  it("includes explicit sandstorm damage in the final KO probability without changing the direct range or description", () => {
    const attackerBuild = {
      ...makeBuild("attacker", "ラッキー"),
      level: 94,
    };
    const defenderBuild = {
      ...makeBuild("defender", "ミュウ"),
      level: 30,
      ivs: { ...defaultIvs, hp: 0 },
    };
    const input = makeInput("ちきゅうなげ", {
      attackerBuild,
      defenderBuild,
      field: { ...emptyField, weather: "sand" },
    });
    const sandstormEvent = {
      id: "sandstorm-after-seismic-toss",
      effectId: "sandstorm-damage",
      enabled: true,
      sequenceContext: "currentMove",
    } satisfies HpEvent;

    const directOnly = calculateOffenseAdjustment(input)[0];
    const withSandstorm = calculateOffenseAdjustment({
      ...input,
      hpEvents: [sandstormEvent],
    })[0];

    expect(directOnly).toMatchObject({
      status: "fixed",
      passed: false,
      koProbability: 0,
      damageRange: { min: 94, max: 94 },
      hpEventEvaluations: [],
    });
    expect(withSandstorm).toMatchObject({
      status: "fixed",
      passed: true,
      koProbability: 1,
      damageRange: { min: 94, max: 94 },
    });
    expect(withSandstorm.hpEventEvaluations).toEqual([
      expect.objectContaining({
        eventId: sandstormEvent.id,
        effectId: "sandstorm-damage",
        subject: "defender",
        damage: 6,
        applied: true,
        activationProbability: 1,
      }),
    ]);
    expect(withSandstorm.description).toBe(directOnly.description);
  });

  it("lets Sitrus Berry recovery prevent an otherwise guaranteed residual KO", () => {
    const attackerBuild = {
      ...makeBuild("attacker", "ラッキー"),
      level: 94,
    };
    const defenderBuild = {
      ...makeBuild("defender", "ミュウ"),
      level: 30,
      ivs: { ...defaultIvs, hp: 0 },
    };
    const input = makeInput("ちきゅうなげ", {
      attackerBuild,
      defenderBuild,
      field: { ...emptyField, weather: "sand" },
    });
    const sandstormEvent = {
      id: "sandstorm",
      effectId: "sandstorm-damage",
      enabled: true,
      sequenceContext: "currentMove",
    } satisfies HpEvent;
    const sitrusEvent = {
      id: "sitrus",
      effectId: "sitrus-berry-heal",
      enabled: true,
      sequenceContext: "currentMove",
    } satisfies HpEvent;

    const withSandstorm = calculateOffenseAdjustment({
      ...input,
      hpEvents: [sandstormEvent],
    })[0];
    const withSitrus = calculateOffenseAdjustment({
      ...input,
      hpEvents: [sandstormEvent, sitrusEvent],
    })[0];

    expect(withSandstorm).toMatchObject({
      status: "fixed",
      passed: true,
      koProbability: 1,
    });
    expect(withSitrus).toMatchObject({
      status: "fixed",
      passed: false,
      koProbability: 0,
      hpEventEvaluations: [
        expect.objectContaining({
          effectId: "sitrus-berry-heal",
          healing: 25,
          applied: true,
        }),
        expect.objectContaining({
          effectId: "sandstorm-damage",
          damage: 6,
          applied: true,
        }),
      ],
    });
  });

  it("counts a defender KO even when Life Orb recoil then faints the attacker", () => {
    const attackerBuild = {
      ...makeBuild("attacker", "ヌケニン", "いじっぱり", { ...zeroStatPoints, atk: 32 }),
      item: mustResolve("item", "いのちのたま"),
    };
    const lifeOrbEvent = {
      id: "shedinja-life-orb",
      effectId: "life-orb-recoil",
      enabled: true,
      sequenceContext: "currentMove",
    } satisfies HpEvent;
    const result = calculateOffenseAdjustment(makeInput("かげうち", {
      attackerBuild,
      defenderBuild: makeBuild("defender", "ピチュー"),
      hpEvents: [lifeOrbEvent],
    }))[0];

    expect(result.passed).toBe(true);
    expect(result.koProbability).toBe(1);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        eventId: lifeOrbEvent.id,
        effectId: "life-orb-recoil",
        subject: "attacker",
        damage: 1,
        applied: true,
        activationProbability: 1,
      }),
    ]);
    expect(result.description).toContain("Life Orb Shedinja Shadow Sneak");
  });

  it("keeps automatic move recoil out of ordinary offense line details", () => {
    const defenderBuild = makeBuild("defender", "ピチュー");
    const result = calculateOffenseAdjustment(makeInput("すてみタックル", {
      attackerBuild: makeBuild("attacker", "ドドゲザン", "いじっぱり"),
      defenderBuild,
    }))[0];

    expect(result).toMatchObject({
      passed: true,
      koProbability: 1,
    });
    expect(result.hpEventEvaluations).toEqual([]);
  });

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
    expect(finalGambit.hpEventEvaluations).toEqual([]);
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

  it("lets @smogon/calc resolve weight-based power from the defender species", () => {
    const lightTarget = calculateOffenseAdjustment(makeInput("くさむすび", {
      attackerBuild: makeBuild("attacker", "ライチュウ", "ひかえめ", { ...zeroStatPoints, spa: 32 }),
      defenderBuild: makeBuild("defender", "ピチュー"),
    }))[0];
    const heavyTarget = calculateOffenseAdjustment(makeInput("くさむすび", {
      attackerBuild: makeBuild("attacker", "ライチュウ", "ひかえめ", { ...zeroStatPoints, spa: 32 }),
      defenderBuild: makeBuild("defender", "カビゴン"),
    }))[0];

    expect(lightTarget).toMatchObject({ stat: "spa", label: "Cライン" });
    expect(heavyTarget).toMatchObject({ stat: "spa", label: "Cライン" });
    expect(lightTarget.description).toContain("Grass Knot (20 BP)");
    expect(heavyTarget.description).toContain("Grass Knot (120 BP)");
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
