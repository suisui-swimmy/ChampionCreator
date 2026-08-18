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
  targetItemMultiplier: "auto",
  targetAbilityMultiplier: "auto",
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
    expect(result.notes).toEqual([]);
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

  it("searches downward and passes slower lines under Trick Room", () => {
    const targetBuild = makeBuild("target", "メガマフォクシー", "おくびょう", {
      ...zeroStatPoints,
      spe: 32,
    });
    const currentSpeed = calculateSmogonFinalSpeed(targetBuild, emptyField, emptySide);
    const zeroSpeed = calculateSmogonFinalSpeed(
      makeBuild("target", "メガマフォクシー", "おくびょう"),
      emptyField,
      emptySide,
    );
    const opponentSpeed = Math.floor((currentSpeed + zeroSpeed) / 2);
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      manualTargetSpeed: opponentSpeed,
      comparison: "outspeed",
      orderMode: "trick-room",
      requiredSpeedOffset: 1,
    }));

    expect(result).toMatchObject({
      status: "pass",
      passed: true,
      orderMode: "trick-room",
      relation: "outspeed",
      requiredSpeed: opponentSpeed - 1,
    });
    expect(result.requiredStatPoints).not.toBe(32);
    expect(result.actualSpeed).toBeLessThan(opponentSpeed);
    expect(result.reason).toContain("トリル先制ライン");
    expect(result.notes).toContain("共通: トリックルーム 行動順反転");
  });

  it("allows ties under Trick Room when the explicit offset is zero", () => {
    const targetBuild = makeBuild("target", "メガマフォクシー", "おくびょう");
    const currentSpeed = calculateSmogonFinalSpeed(targetBuild, emptyField, emptySide);
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      manualTargetSpeed: currentSpeed,
      comparison: "outspeed",
      orderMode: "trick-room",
      requiredSpeedOffset: 0,
    }));

    expect(result).toMatchObject({
      status: "tie",
      passed: true,
      orderMode: "trick-room",
      relation: "tie",
      requiredStatPoints: 0,
      requiredSpeed: currentSpeed,
    });
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
    expect(auto.notes).toEqual(expect.arrayContaining(["相手: こだわりスカーフ 1.5倍", "相手: ようりょくそ 晴れ 2倍"]));
    expect(manual.notes).toEqual(expect.arrayContaining(["相手: 道具倍率 手動 0.5倍", "相手: 特性倍率 手動 0.5倍"]));
  });

  it("applies target status through the authoritative final-speed calculation", () => {
    const baseTarget = makeBuild("target", "メガマフォクシー", "おくびょう");
    const parTarget = makeBuild("target", "メガマフォクシー", "おくびょう", zeroStatPoints, {
      status: "par",
    });
    const baseSpeed = calculateSmogonFinalSpeed(baseTarget, emptyField, emptySide);
    const parSpeed = calculateSmogonFinalSpeed(parTarget, emptyField, emptySide);
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild: parTarget,
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      manualTargetSpeed: 1,
      comparison: "outspeed",
      requiredSpeedOffset: 0,
    }));

    expect(parSpeed).toBe(Math.floor(baseSpeed * 0.5));
    expect(result.actualSpeed).toBe(parSpeed);
    expect(result.notes).toContain("調整対象: まひ 0.5倍");
  });

  it.each(["par", "brn"] as const)(
    "uses Quick Feet for %s without applying paralysis twice",
    (status) => {
      const quickFeetTarget = makeBuild("target", "ピカチュウ", "おくびょう", zeroStatPoints, {
        ability: mustResolve("ability", "はやあし"),
        status,
      });
      const regularTarget = { ...quickFeetTarget, ability: undefined, status: undefined };
      const quickFeetSpeed = calculateSmogonFinalSpeed(quickFeetTarget, emptyField, emptySide);
      const regularSpeed = calculateSmogonFinalSpeed(regularTarget, emptyField, emptySide);
      const result = calculateSpeedAdjustment(makeInput({
        targetBuild: quickFeetTarget,
        opponentBuild: undefined,
        opponentLabel: "任意S値",
        manualTargetSpeed: 1,
        comparison: "outspeed",
        requiredSpeedOffset: 0,
      }));

      expect(quickFeetSpeed).toBe(Math.floor(regularSpeed * 1.5));
      expect(result.actualSpeed).toBe(quickFeetSpeed);
      expect(result.notes).toContain("調整対象: はやあし 状態異常 1.5倍");
      expect(result.notes).not.toContain("調整対象: まひ 0.5倍");
    },
  );

  it("applies target and opponent Tailwind independently and keeps Trick Room common", () => {
    const targetBuild = makeBuild("target", "ピカチュウ", "おくびょう", {
      ...zeroStatPoints,
      spe: 32,
    });
    const opponentBuild = makeBuild("opponent", "ピカチュウ", "おくびょう", {
      ...zeroStatPoints,
      spe: 32,
    });
    const targetSide = { ...emptySide, tailwind: true };
    const opponentSide = { ...emptySide, tailwind: true };
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild,
      targetSide,
      opponentSide,
      comparison: "tie",
      orderMode: "trick-room",
      requiredSpeedOffset: 0,
    }));

    expect(result).toMatchObject({
      status: "tie",
      passed: true,
      orderMode: "trick-room",
      requiredStatPoints: 32,
    });
    expect(result.notes).toEqual(expect.arrayContaining([
      "調整対象: おいかぜ 2倍",
      "相手: おいかぜ 2倍",
      "共通: トリックルーム 行動順反転",
    ]));
  });

  it("passes target manual multipliers to the candidate calculation and suppresses auto notes", () => {
    const targetBuild = makeBuild("target", "ピカチュウ", "おくびょう", zeroStatPoints, {
      item: mustResolve("item", "こだわりスカーフ"),
      ability: mustResolve("ability", "ようりょくそ"),
    });
    const expectedSpeed = calculateSmogonFinalSpeed(
      targetBuild,
      { ...emptyField, weather: "sun" },
      emptySide,
      { manualItemMultiplier: 0.5, manualAbilityMultiplier: 0.5 },
    );
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild: undefined,
      opponentLabel: "任意S値",
      field: { ...emptyField, weather: "sun" },
      manualTargetSpeed: 1,
      comparison: "outspeed",
      requiredSpeedOffset: 0,
      targetItemMultiplier: "0.5",
      targetAbilityMultiplier: "0.5",
    }));

    expect(result.actualSpeed).toBe(expectedSpeed);
    expect(result.notes).toEqual(expect.arrayContaining([
      "調整対象: 道具倍率 手動 0.5倍",
      "調整対象: 特性倍率 手動 0.5倍",
    ]));
    expect(result.notes).not.toContain("調整対象: こだわりスカーフ 1.5倍");
    expect(result.notes).not.toContain("調整対象: ようりょくそ 晴れ 2倍");
  });

  it("uses manual target speed as the opponent line and ignores stale opponent conditions", () => {
    const targetBuild = makeBuild("target", "ピカチュウ", "おくびょう");
    const staleOpponent = makeBuild("opponent", "ピカチュウ", "おくびょう", zeroStatPoints, {
      item: mustResolve("item", "こだわりスカーフ"),
      ability: mustResolve("ability", "すいすい"),
      status: "par",
    });
    const result = calculateSpeedAdjustment(makeInput({
      targetBuild,
      opponentBuild: staleOpponent,
      opponentLabel: "任意S値",
      field: { ...emptyField, weather: "rain" },
      manualTargetSpeed: 123,
      opponentItemMultiplier: "0.5",
      opponentAbilityMultiplier: "2",
      comparison: "tie",
      requiredSpeedOffset: 0,
    }));

    expect(result.targetSpeed).toBe(123);
    expect(result.notes).toContain("相手: 任意S値直接入力");
    expect(result.notes).not.toContain("相手: こだわりスカーフ 1.5倍");
    expect(result.notes).not.toContain("相手: すいすい 雨 2倍");
    expect(result.notes).not.toContain("相手: まひ 0.5倍");
    expect(result.notes).not.toContain("相手: 道具倍率 手動 0.5倍");
    expect(result.notes).not.toContain("相手: 特性倍率 手動 2倍");
  });
});
