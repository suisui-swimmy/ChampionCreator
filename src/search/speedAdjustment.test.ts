import { describe, expect, it } from "vitest";
import { calculateSmogonFinalSpeed } from "../calc/smogonAdapter";
import { statPointTableToSmogonEvs } from "../domain/championsStats";
import type { EntityKind } from "../data/localizationTypes";
import type {
  Build,
  EntityRef,
  FieldState,
  SideState,
  StatBoostTable,
  StatTable,
} from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import { calculateSpeedAdjustment, type SpeedAdjustmentInput } from "./speedAdjustment";

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

const makeBuild = (
  id: string,
  pokemonInput: string,
  natureInput = "",
  statPoints: StatTable = zeroStatPoints,
  options: Partial<Build> = {},
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemonInput),
  nature: natureInput ? mustResolve("nature", natureInput) : undefined,
  level: 50,
  ivs: defaultIvs,
  statPoints,
  evs: statPointTableToSmogonEvs(statPoints),
  ...options,
});

const makeInput = (options: Partial<SpeedAdjustmentInput> = {}): SpeedAdjustmentInput => ({
  targetBuild: makeBuild("target", "メガマフォクシー", "おくびょう"),
  opponentBuild: makeBuild("opponent", "ピカチュウ", ""),
  opponentLabel: "ピカチュウ",
  field: emptyField,
  targetBoosts: zeroBoosts,
  opponentBoosts: zeroBoosts,
  targetSide: emptySide,
  opponentSide: emptySide,
  comparison: "outspeed",
  opponentItemMultiplier: "auto",
  opponentAbilityMultiplier: "auto",
  boostedNature: mustResolve("nature", "おくびょう"),
  ...options,
});

describe("calculateSpeedAdjustment", () => {
  it("finds the minimum S SP needed to outspeed the target line", () => {
    const result = calculateSpeedAdjustment(makeInput({
      opponentBuild: makeBuild("opponent", "マルマイン", "おくびょう", {
        ...zeroStatPoints,
        spe: 12,
      }),
      opponentLabel: "マルマイン",
    }));

    expect(result).toMatchObject({
      status: "pass",
      passed: true,
      canApply: true,
      relation: "outspeed",
      label: "Sライン",
    });
    expect(result.requiredStatPoints).not.toBeNull();
    expect(result.actualSpeed).toBeGreaterThan(result.targetSpeed);
  });

  it("distinguishes tie lines from guaranteed outspeed lines", () => {
    const targetBuild = makeBuild("target", "メガマフォクシー", "おくびょう");
    const currentSpeed = calculateSmogonFinalSpeed(targetBuild, emptyField, emptySide);
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      manualTargetSpeed: currentSpeed,
      comparison: "tie",
    }));

    expect(result).toMatchObject({
      status: "tie",
      passed: true,
      relation: "tie",
      requiredStatPoints: 0,
      targetSpeed: currentSpeed,
    });
  });

  it("uses the explicit required speed offset when provided", () => {
    const targetBuild = makeBuild("target", "メガマフォクシー", "おくびょう");
    const currentSpeed = calculateSmogonFinalSpeed(targetBuild, emptyField, emptySide);
    const tieLine = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      manualTargetSpeed: currentSpeed,
      comparison: "outspeed",
      requiredSpeedOffset: 0,
    }));
    const plusOneLine = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      manualTargetSpeed: currentSpeed,
      comparison: "outspeed",
      requiredSpeedOffset: 1,
    }));

    expect(tieLine).toMatchObject({
      status: "tie",
      passed: true,
      requiredSpeed: currentSpeed,
      requiredStatPoints: 0,
    });
    expect(plusOneLine).toMatchObject({
      status: "pass",
      passed: true,
      requiredSpeed: currentSpeed + 1,
    });
    expect(plusOneLine.requiredStatPoints).not.toBe(0);
  });

  it("reports the maximum reachable line when the SP budget cannot satisfy the condition", () => {
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild: makeBuild("target", "メガマフォクシー", "おくびょう", {
        hp: 32,
        atk: 32,
        def: 2,
        spa: 0,
        spd: 0,
        spe: 0,
      }),
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      manualTargetSpeed: 10000,
      comparison: "outspeed",
    }));

    expect(result).toMatchObject({
      status: "fail",
      passed: false,
      canApply: false,
      requiredStatPoints: 0,
      relation: "miss",
    });
    expect(result.reason).toContain("最大 0 SPでも");
  });

  it("uses automatic speed data when available and manual dropdown multipliers when selected", () => {
    const opponentBuild = makeBuild("opponent", "ピカチュウ", "おくびょう", {
      ...zeroStatPoints,
      spe: 32,
    }, {
      item: mustResolve("item", "こだわりスカーフ"),
      ability: mustResolve("ability", "ようりょくそ"),
    });
    const auto = calculateSpeedAdjustment(makeInput({
      opponentBuild,
      field: { ...emptyField, weather: "sun" },
    }));
    const manual = calculateSpeedAdjustment(makeInput({
      opponentBuild,
      field: { ...emptyField, weather: "sun" },
      opponentItemMultiplier: "0.5",
      opponentAbilityMultiplier: "0.5",
    }));

    expect(auto.targetSpeed).toBeGreaterThan(manual.targetSpeed);
    expect(auto.notes).toEqual(expect.arrayContaining(["こだわりスカーフ 1.5倍", "ようりょくそ 晴れ 2倍"]));
    expect(manual.notes).toEqual(expect.arrayContaining(["道具倍率 手動 0.5倍", "特性倍率 手動 0.5倍"]));
  });
});
