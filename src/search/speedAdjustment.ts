import { calculateSmogonFinalSpeed } from "../calc/smogonAdapter";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  clampStatPointValue,
  statPointTableToSmogonEvs,
  sumStatPoints,
} from "../domain/championsStats";
import type {
  Build,
  FieldState,
  NatureRef,
  SideState,
  StatBoostTable,
  StatTable,
} from "../domain/model";
import { getBuildStatPoints } from "./defenceSearch";

export type SpeedAdjustmentStatus = "pass" | "tie" | "fail" | "unresolved" | "invalid";
export type SpeedComparisonMode = "outspeed" | "tie";
export type SpeedManualMultiplier = "auto" | "2" | "1.5" | "0.5";
export type SpeedOrderMode = "normal" | "trick-room";
export type SpeedRelation = "outspeed" | "tie" | "miss";

export interface SpeedAdjustmentInput {
  targetBuild: Build;
  opponentBuild?: Build;
  opponentLabel: string;
  field: FieldState;
  targetBoosts: StatBoostTable;
  opponentBoosts: StatBoostTable;
  targetSide: SideState;
  opponentSide: SideState;
  comparison: SpeedComparisonMode;
  orderMode?: SpeedOrderMode;
  requiredSpeedOffset?: number;
  manualTargetSpeed?: number;
  targetItemMultiplier: SpeedManualMultiplier;
  targetAbilityMultiplier: SpeedManualMultiplier;
  opponentItemMultiplier: SpeedManualMultiplier;
  opponentAbilityMultiplier: SpeedManualMultiplier;
  boostedNature?: NatureRef;
}

export interface SpeedAdjustmentResult {
  id: string;
  status: SpeedAdjustmentStatus;
  passed: boolean;
  canApply: boolean;
  label: string;
  comparison: SpeedComparisonMode;
  orderMode: SpeedOrderMode;
  relation: SpeedRelation;
  requiredStatPoints: number | null;
  actualSpeed: number | null;
  targetSpeed: number;
  requiredSpeed: number;
  targetStatPoints: number;
  notes: string[];
  reason: string;
  reference?: SpeedAdjustmentResult;
}

type SpeedCandidateEvaluation = {
  statPoints: number;
  actualSpeed: number;
  relation: SpeedRelation;
};

const manualMultiplierValue = (multiplier: SpeedManualMultiplier | undefined): number | undefined => (
  multiplier === undefined || multiplier === "auto" ? undefined : Number(multiplier)
);

const getManualMultiplier = (
  multiplier: SpeedManualMultiplier | undefined,
): SpeedManualMultiplier => multiplier ?? "auto";

const manualMultiplierLabel = (multiplier: SpeedManualMultiplier): string => {
  switch (multiplier) {
    case "2":
      return "2倍";
    case "1.5":
      return "1.5倍";
    case "0.5":
      return "0.5倍";
    case "auto":
    default:
      return "自動";
  }
};

const statPointsToEvs = (statPoints: StatTable): StatTable =>
  statPointTableToSmogonEvs(statPoints);

const withSpeedStatPoint = (
  build: Build,
  statPoints: number,
): Build => {
  const nextStatPoints = {
    ...getBuildStatPoints(build),
    spe: clampStatPointValue(statPoints),
  };

  return {
    ...build,
    statPoints: nextStatPoints,
    evs: statPointsToEvs(nextStatPoints),
  };
};

const withNature = (build: Build, nature: NatureRef | undefined): Build =>
  nature ? { ...build, nature } : build;

const getMaxSpeedSearchStatPoints = (build: Build): number => {
  const current = getBuildStatPoints(build);
  const usedByOtherStats = sumStatPoints(current) - current.spe;
  return Math.max(
    0,
    Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats),
  );
};

const getSpeedRelation = (actualSpeed: number, targetSpeed: number): SpeedRelation => {
  if (actualSpeed > targetSpeed) {
    return "outspeed";
  }
  if (actualSpeed === targetSpeed) {
    return "tie";
  }
  return "miss";
};

const getOrderMode = (input: Pick<SpeedAdjustmentInput, "orderMode">): SpeedOrderMode =>
  input.orderMode ?? "normal";

const getRequiredSpeed = (
  targetSpeed: number,
  comparison: SpeedComparisonMode,
  requiredSpeedOffset?: number,
  orderMode: SpeedOrderMode = "normal",
): number => {
  const offset = requiredSpeedOffset !== undefined
    ? Math.max(0, Math.trunc(requiredSpeedOffset))
    : comparison === "outspeed" ? 1 : 0;
  return orderMode === "trick-room" ? targetSpeed - offset : targetSpeed + offset;
};

const passesSpeedInput = (
  input: SpeedAdjustmentInput,
  actualSpeed: number,
  targetSpeed: number,
): boolean => {
  const requiredSpeed = getRequiredSpeed(
    targetSpeed,
    input.comparison,
    input.requiredSpeedOffset,
    getOrderMode(input),
  );
  return getOrderMode(input) === "trick-room"
    ? actualSpeed <= requiredSpeed
    : actualSpeed >= requiredSpeed;
};

const getTargetSpeed = (input: SpeedAdjustmentInput): number => {
  if (input.manualTargetSpeed !== undefined && input.manualTargetSpeed > 0) {
    return Math.trunc(input.manualTargetSpeed);
  }
  if (!input.opponentBuild) {
    throw new Error("相手ポケモンまたは任意S値が必要です");
  }

  return calculateSmogonFinalSpeed(
    input.opponentBuild,
    input.field,
    input.opponentSide,
    {
      boosts: input.opponentBoosts,
      manualItemMultiplier: manualMultiplierValue(input.opponentItemMultiplier),
      manualAbilityMultiplier: manualMultiplierValue(input.opponentAbilityMultiplier),
    },
  );
};

export interface AutomaticSpeedModifierSources {
  item?: string;
  ability?: string;
}

/**
 * Returns the currently selected item's and ability's automatic speed
 * modifier descriptions for the given build and field.
 *
 * Manual speed multipliers intentionally do not belong here: this helper is
 * only the source description that the speed-condition UI can show before a
 * manual override is selected.
 */
export const getAutomaticSpeedModifierSources = (
  build: Build | undefined,
  field: FieldState,
): AutomaticSpeedModifierSources => {
  if (!build) {
    return {};
  }

  const ability = build.ability?.canonicalName;
  const item = build.item?.canonicalName;
  let abilitySource: string | undefined;
  let itemSource: string | undefined;

  if (ability === "Chlorophyll" && field.weather === "sun") {
    abilitySource = "ようりょくそ 晴れ 2倍";
  } else if (ability === "Swift Swim" && field.weather === "rain") {
    abilitySource = "すいすい 雨 2倍";
  } else if (ability === "Sand Rush" && field.weather === "sand") {
    abilitySource = "すなかき 砂 2倍";
  } else if (ability === "Slush Rush" && field.weather === "snow") {
    abilitySource = "ゆきかき 雪 2倍";
  } else if (ability === "Surge Surfer" && field.terrain === "electric") {
    abilitySource = "サーフテール エレキ 2倍";
  } else if (ability === "Quick Feet" && build.status) {
    abilitySource = "はやあし 状態異常 1.5倍";
  }

  if (item === "Choice Scarf") {
    itemSource = "こだわりスカーフ 1.5倍";
  } else if (item === "Iron Ball") {
    itemSource = "くろいてっきゅう 0.5倍";
  } else if (item === "Quick Powder" && build.pokemon.canonicalName === "Ditto") {
    itemSource = "スピードパウダー メタモン 2倍";
  }

  return {
    ...(itemSource ? { item: itemSource } : {}),
    ...(abilitySource ? { ability: abilitySource } : {}),
  };
};

const getAutoSpeedNotes = (
  build: Build | undefined,
  field: FieldState,
  side: SideState,
  boosts: StatBoostTable,
  options: {
    itemMultiplier?: SpeedManualMultiplier;
    abilityMultiplier?: SpeedManualMultiplier;
  } = {},
): string[] => {
  if (!build) {
    return [];
  }

  const itemMultiplier = getManualMultiplier(options.itemMultiplier);
  const abilityMultiplier = getManualMultiplier(options.abilityMultiplier);
  const ability = build.ability?.canonicalName;
  const modifierSources = getAutomaticSpeedModifierSources(build, field);
  const notes: string[] = [];
  if (boosts.spe && boosts.spe !== 0) {
    notes.push(`Sランク ${boosts.spe > 0 ? "+" : ""}${boosts.spe}`);
  }
  if (side.tailwind) {
    notes.push("おいかぜ 2倍");
  }
  if (abilityMultiplier === "auto" && modifierSources.ability) {
    notes.push(modifierSources.ability);
  }
  if (itemMultiplier === "auto" && modifierSources.item) {
    notes.push(modifierSources.item);
  }
  if (build.status === "par" && (abilityMultiplier !== "auto" || ability !== "Quick Feet")) {
    notes.push("まひ 0.5倍");
  }
  return notes;
};

const speedNoteOwnerLabel = (owner: "target" | "opponent" | "common"): string => {
  switch (owner) {
    case "target":
      return "調整対象";
    case "opponent":
      return "相手";
    case "common":
    default:
      return "共通";
  }
};

const withSpeedNoteOwner = (
  owner: "target" | "opponent" | "common",
  notes: string[],
): string[] => notes.map((note) => `${speedNoteOwnerLabel(owner)}: ${note}`);

const getManualMultiplierNotes = (
  owner: "target" | "opponent",
  itemMultiplier: SpeedManualMultiplier | undefined,
  abilityMultiplier: SpeedManualMultiplier | undefined,
): string[] => {
  const notes: string[] = [];
  const item = getManualMultiplier(itemMultiplier);
  const ability = getManualMultiplier(abilityMultiplier);
  if (item !== "auto") {
    notes.push(`${speedNoteOwnerLabel(owner)}: 道具倍率 手動 ${manualMultiplierLabel(item)}`);
  }
  if (ability !== "auto") {
    notes.push(`${speedNoteOwnerLabel(owner)}: 特性倍率 手動 ${manualMultiplierLabel(ability)}`);
  }
  return notes;
};

const getNotes = (input: SpeedAdjustmentInput): string[] => {
  const targetNotes = withSpeedNoteOwner(
    "target",
    getAutoSpeedNotes(
      input.targetBuild,
      input.field,
      input.targetSide,
      input.targetBoosts,
      {
        itemMultiplier: input.targetItemMultiplier,
        abilityMultiplier: input.targetAbilityMultiplier,
      },
    ),
  );
  const manualTargetSpeed = input.manualTargetSpeed !== undefined && input.manualTargetSpeed > 0;
  const targetManualNotes = getManualMultiplierNotes(
    "target",
    input.targetItemMultiplier,
    input.targetAbilityMultiplier,
  );
  const notes = manualTargetSpeed
    ? [...targetNotes, ...targetManualNotes, "相手: 任意S値直接入力"]
    : [
        ...targetNotes,
        ...targetManualNotes,
        ...withSpeedNoteOwner(
          "opponent",
          getAutoSpeedNotes(
            input.opponentBuild,
            input.field,
            input.opponentSide,
            input.opponentBoosts,
            {
              itemMultiplier: input.opponentItemMultiplier,
              abilityMultiplier: input.opponentAbilityMultiplier,
            },
          ),
        ),
        ...getManualMultiplierNotes(
          "opponent",
          input.opponentItemMultiplier,
          input.opponentAbilityMultiplier,
        ),
      ];
  if (getOrderMode(input) === "trick-room") {
    notes.push("共通: トリックルーム 行動順反転");
  }
  return notes;
};

const evaluateSpeedCandidate = (
  input: SpeedAdjustmentInput,
  statPoints: number,
  targetSpeed: number,
  targetBuildOverride?: Build,
): SpeedCandidateEvaluation => {
  const targetBuild = withSpeedStatPoint(targetBuildOverride ?? input.targetBuild, statPoints);
  const actualSpeed = calculateSmogonFinalSpeed(
    targetBuild,
    input.field,
    input.targetSide,
    {
      boosts: input.targetBoosts,
      manualItemMultiplier: manualMultiplierValue(input.targetItemMultiplier),
      manualAbilityMultiplier: manualMultiplierValue(input.targetAbilityMultiplier),
    },
  );

  return {
    statPoints,
    actualSpeed,
    relation: getOrderMode(input) === "trick-room"
      ? getSpeedRelation(targetSpeed, actualSpeed)
      : getSpeedRelation(actualSpeed, targetSpeed),
  };
};

const makeInvalidResult = (
  input: SpeedAdjustmentInput,
  id: string,
  reason: string,
): SpeedAdjustmentResult => ({
  id,
  status: "invalid",
  passed: false,
  canApply: false,
  label: "Sライン",
  comparison: input.comparison,
  orderMode: getOrderMode(input),
  relation: "miss",
  requiredStatPoints: null,
  actualSpeed: null,
  targetSpeed: 0,
  requiredSpeed: 0,
  targetStatPoints: getBuildStatPoints(input.targetBuild).spe,
  notes: [],
  reason,
});

const calculateSpeedLine = (
  input: SpeedAdjustmentInput,
  options: { id: string; targetBuildOverride?: Build; referenceNature?: NatureRef } = { id: "line" },
): SpeedAdjustmentResult => {
  let targetSpeed = 0;
  try {
    targetSpeed = getTargetSpeed(input);
  } catch (error) {
    return makeInvalidResult(input, options.id, error instanceof Error ? error.message : String(error));
  }

  const build = options.targetBuildOverride ?? input.targetBuild;
  const currentStatPoints = getBuildStatPoints(build).spe;
  const maxStatPoints = getMaxSpeedSearchStatPoints(build);
  const evaluations: SpeedCandidateEvaluation[] = [];
  const orderMode = getOrderMode(input);

  if (orderMode === "trick-room") {
    for (let statPoints = currentStatPoints; statPoints >= 0; statPoints -= 1) {
      evaluations.push(evaluateSpeedCandidate(input, statPoints, targetSpeed, build));
    }
  } else {
    for (let statPoints = currentStatPoints; statPoints <= maxStatPoints; statPoints += 1) {
      evaluations.push(evaluateSpeedCandidate(input, statPoints, targetSpeed, build));
    }
  }

  if (evaluations.length === 0) {
    return makeInvalidResult(input, options.id, "SP予算が不足しているため、S候補を評価できません");
  }

  const passing = evaluations.find((evaluation) => (
    passesSpeedInput(input, evaluation.actualSpeed, targetSpeed)
  ));
  const best = passing ?? evaluations.reduce((currentBest, evaluation) => {
    if (orderMode === "trick-room") {
      return evaluation.actualSpeed < currentBest.actualSpeed ? evaluation : currentBest;
    }
    return evaluation.actualSpeed > currentBest.actualSpeed ? evaluation : currentBest;
  });
  const passed = Boolean(passing);
  const status: SpeedAdjustmentStatus = passed
    ? best.relation === "tie" ? "tie" : "pass"
    : "fail";
  const comparisonLabel = input.requiredSpeedOffset !== undefined
    ? orderMode === "trick-room" ? "トリル先制ライン" : "指定ライン"
    : input.comparison === "outspeed" ? "確定抜き" : "指定ライン";
  const relationLabel = best.relation === "outspeed"
    ? orderMode === "trick-room" ? "先制できる" : "抜ける"
    : best.relation === "tie" ? "同速" : "届かない";
  const requiredSpeed = getRequiredSpeed(
    targetSpeed,
    input.comparison,
    input.requiredSpeedOffset,
    orderMode,
  );

  return {
    id: options.id,
    status,
    passed,
    canApply: passed && !options.referenceNature,
    label: options.referenceNature ? "S+性格ライン" : "Sライン",
    comparison: input.comparison,
    orderMode,
    relation: best.relation,
    requiredStatPoints: best.statPoints,
    actualSpeed: best.actualSpeed,
    targetSpeed,
    requiredSpeed,
    targetStatPoints: currentStatPoints,
    notes: getNotes(input),
    reason: passed
      ? `${comparisonLabel}は S${best.statPoints} SPで達成します (${relationLabel})`
      : `最大 ${maxStatPoints} SPでも${comparisonLabel}に届きません`,
  };
};

export const calculateSpeedAdjustment = (
  input: SpeedAdjustmentInput,
): SpeedAdjustmentResult => {
  const result = calculateSpeedLine(input, { id: "speed-line" });
  if (
    result.status === "fail"
    && getOrderMode(input) !== "trick-room"
    && input.boostedNature
    && input.targetBuild.nature?.canonicalName !== input.boostedNature.canonicalName
  ) {
    return {
      ...result,
      reference: calculateSpeedLine(input, {
        id: "speed-line-boosted-nature",
        targetBuildOverride: withNature(input.targetBuild, input.boostedNature),
        referenceNature: input.boostedNature,
      }),
    };
  }
  return result;
};
