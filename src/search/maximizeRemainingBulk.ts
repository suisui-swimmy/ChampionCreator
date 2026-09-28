import { evaluateOffenseConditions, type OffenseSequenceCondition } from "./offenseSequence";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  isLegalStatPointTable,
  isLegalStatPointValue,
  getBuildStatPoints,
  statPointTableToSmogonEvs,
  sumStatPoints,
} from "../domain/championsStats";
import type {
  Build,
  BulkScore,
  DefenceSearchStatKey,
  NatureRef,
  Scenario,
  StatKey,
  StatTable,
} from "../domain/model";
import { evaluateCurrentBuildCondition, type CurrentBuildCondition } from "./currentBuildEvaluation";
import { evaluateScenario } from "./defenceSearch";
import { computeBulkScore, getBuildDerivedStats } from "./bulkScore";
import type { SpeedScenarioCondition } from "../domain/speed";
import { evaluateSpeedConditions } from "./speedAdjustment";

export { computeBulkScore, getBuildDerivedStats } from "./bulkScore";
export type { BulkScore } from "../domain/model";

const DEFENSIVE_STAT_KEYS = ["hp", "def", "spd"] as const satisfies readonly DefenceSearchStatKey[];
const NATURE_STAT_KEYS = ["atk", "def", "spa", "spd", "spe"] as const satisfies readonly Exclude<StatKey, "hp">[];
const PROTECTED_SIDE_EFFECT_STAT_KEYS = ["atk", "spa", "spe"] as const satisfies readonly StatKey[];
export type BulkNatureCandidate = { nature?: NatureRef };

export type NatureChangeImpact = {
  changed: boolean;
  from: string;
  to: string;
  loweredStats: Array<Exclude<StatKey, "hp">>;
  raisedStats: Array<Exclude<StatKey, "hp">>;
  notes: string[];
};

export type MaximizeRemainingBulkResult = {
  candidate: {
    nature: string;
    natureCanonicalName?: string;
    statPoints: StatTable;
    spOrEvs: StatTable;
    derivedStats: StatTable;
    usedTotal: number;
    remaining: number;
  };
  score: BulkScore & {
    currentPhysicalBulk: number;
    currentSpecialBulk: number;
    currentOverallBulk: number;
    overallBulkGain: number;
  };
  natureChangeImpact: NatureChangeImpact;
  explanation: string;
};

export interface MaximizeRemainingBulkInput {
  build: Build;
  allowNatureChange?: boolean;
  natureCandidates?: BulkNatureCandidate[];
  defenceScenarios?: Scenario[];
  speedConditions?: SpeedScenarioCondition[];
  offenseConditions?: OffenseSequenceCondition[];
}

export interface MaximizeRemainingBulkOptions {
  maxResults?: number;
}

const getNatureLabel = (nature: NatureRef | undefined): string =>
  nature?.displayNameJa ?? nature?.canonicalName ?? "性格なし";

const getNatureKey = (candidate: BulkNatureCandidate): string =>
  candidate.nature?.canonicalName ?? "__none__";

const normalizeNatureCandidates = (
  build: Build,
  allowNatureChange: boolean,
  candidates: BulkNatureCandidate[] = [],
): BulkNatureCandidate[] => {
  const baseCandidate = { nature: build.nature };
  if (!allowNatureChange) {
    return [baseCandidate];
  }

  const seen = new Set<string>();
  const normalized: BulkNatureCandidate[] = [];
  for (const candidate of [baseCandidate, ...candidates]) {
    const key = getNatureKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(candidate);
  }
  return normalized.length > 0 ? normalized : [baseCandidate];
};

const validateCurrentPoints = (build: Build): StatTable => {
  const points = getBuildStatPoints(build);
  if (!Object.values(points).every(isLegalStatPointValue)) throw new Error("現在のSP配分に上限外の値があります");
  if (!isLegalStatPointTable(points)) throw new Error("現在のSP配分が合計66を超えています");
  return points;
};

/** Existing points are lower bounds; A/C/S SP never changes. */
export function* iterateDefensiveAllocations(input: MaximizeRemainingBulkInput): Generator<StatTable> {
  const base = validateCurrentPoints(input.build);
  const budget = CHAMPIONS_TOTAL_STAT_POINTS - base.atk - base.spa - base.spe;
  for (let hp = base.hp; hp <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT; hp++) {
    for (let def = base.def; def <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT; def++) {
      const spd = budget - hp - def;
      if (spd >= base.spd && spd <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT) yield { ...base, hp, def, spd };
    }
  }
}

export const enumerateDefensiveAllocations = (input: MaximizeRemainingBulkInput): StatTable[] =>
  Array.from(iterateDefensiveAllocations(input));

export const countMaximizeRemainingBulkCandidates = (input: MaximizeRemainingBulkInput): number => {
  let count = 0;
  for (const _points of iterateDefensiveAllocations(input)) count++;
  return count * normalizeNatureCandidates(input.build, Boolean(input.allowNatureChange), input.natureCandidates).length;
};

type BulkContext = {
  currentStats: StatTable;
  currentScore: BulkScore;
  defenceScenarios: Scenario[];
  offenseConditions: OffenseSequenceCondition[];
  speedConditions: SpeedScenarioCondition[];
};

const prepareContext = (input: MaximizeRemainingBulkInput): BulkContext => {
  validateCurrentPoints(input.build);
  const currentStats = getBuildDerivedStats(input.build);
  const isPassing = (condition: CurrentBuildCondition): boolean => {
    const result = evaluateCurrentBuildCondition(input.build, condition);
    if (result.status !== "pass" && result.status !== "fail") throw new Error(result.message ?? "条件を評価できません");
    return result.status === "pass";
  };
  return {
    currentStats,
    currentScore: computeBulkScore(currentStats),
    defenceScenarios: (input.defenceScenarios ?? []).filter((scenario) => scenario.enabled && scenario.constraint.enabled)
      .filter((scenario) => isPassing({ id: scenario.id, scenarioId: scenario.id, scenarioLabel: scenario.label ?? scenario.id,
        label: scenario.label ?? scenario.id, kind: "defence", scenario })),
    offenseConditions: (input.offenseConditions ?? []).filter((condition) => {
      if (!condition.attacks.length) throw new Error("火力調整の攻撃条件を入力してください");
      return isPassing({ id: condition.id, scenarioId: condition.scenarioId, scenarioLabel: condition.scenarioLabel,
        label: condition.scenarioLabel, kind: "offense", input: condition.attacks[0], sequence: condition });
    }),
    speedConditions: (input.speedConditions ?? []).filter((condition) => {
      const result = evaluateSpeedConditions(input.build, [condition])[0].result;
      if (result.status === "invalid" || result.status === "unresolved") throw new Error(result.reason);
      return result.passed;
    }),
  };
};

const evaluateWithContext = (
  input: MaximizeRemainingBulkInput, context: BulkContext, statPoints: StatTable, natureCandidate: BulkNatureCandidate,
  validateConditions = true,
): MaximizeRemainingBulkResult | null => {
  const base = getBuildStatPoints(input.build);
  if (!isLegalStatPointTable(statPoints)
    || DEFENSIVE_STAT_KEYS.some((key) => statPoints[key] < base[key])
    || PROTECTED_SIDE_EFFECT_STAT_KEYS.some((key) => statPoints[key] !== base[key])) return null;
  const candidateBuild = { ...input.build, nature: natureCandidate.nature, statPoints, evs: statPointTableToSmogonEvs(statPoints) };
  // HP thresholds, recoil and variable-power moves can break monotonicity.
  if (validateConditions && (context.defenceScenarios.some((scenario) => !evaluateScenario(candidateBuild, scenario).passed)
    || evaluateOffenseConditions(candidateBuild, context.offenseConditions).some((entry) => !entry.passed)
    || evaluateSpeedConditions(candidateBuild, context.speedConditions).some((entry) => !entry.result.passed))) return null;
  const derivedStats = getBuildDerivedStats(candidateBuild);
  const score = computeBulkScore(derivedStats);
  const usedTotal = sumStatPoints(statPoints);
  const nature = getNatureLabel(natureCandidate.nature);
  const natureChanged = input.build.nature?.canonicalName !== natureCandidate.nature?.canonicalName;
  return {
    candidate: {
      nature, natureCanonicalName: natureCandidate.nature?.canonicalName,
      statPoints: { ...statPoints }, spOrEvs: { ...statPoints }, derivedStats,
      usedTotal, remaining: CHAMPIONS_TOTAL_STAT_POINTS - usedTotal,
    },
    score: {
      ...score, currentPhysicalBulk: context.currentScore.physicalBulk,
      currentSpecialBulk: context.currentScore.specialBulk,
      currentOverallBulk: context.currentScore.overallBulk,
      overallBulkGain: score.overallBulk - context.currentScore.overallBulk,
    },
    natureChangeImpact: { changed: natureChanged, from: getNatureLabel(input.build.nature), to: nature,
      loweredStats: NATURE_STAT_KEYS.filter((key) => derivedStats[key] < context.currentStats[key]),
      raisedStats: NATURE_STAT_KEYS.filter((key) => derivedStats[key] > context.currentStats[key]), notes: [] },
    explanation: `現在のSPを維持し、性格${nature}で残りSPをH${statPoints.hp} / B${statPoints.def} / D${statPoints.spd}まで追加します`,
  };
};

export const evaluateBulkCandidate = (
  input: MaximizeRemainingBulkInput, statPoints: StatTable, natureCandidate: BulkNatureCandidate = { nature: input.build.nature },
): MaximizeRemainingBulkResult | null => {
  if (!normalizeNatureCandidates(input.build, Boolean(input.allowNatureChange), input.natureCandidates)
    .some((entry) => getNatureKey(entry) === getNatureKey(natureCandidate))) return null;
  return evaluateWithContext(input, prepareContext(input), statPoints, natureCandidate);
};

/** Rank cheaply first, then validate in score order; yield during both phases for cancellation. */
export function* iterateBulkCandidateResults(
  input: MaximizeRemainingBulkInput, options: MaximizeRemainingBulkOptions = {},
): Generator<MaximizeRemainingBulkResult | null> {
  const context = prepareContext(input);
  const natures = normalizeNatureCandidates(input.build, Boolean(input.allowNatureChange), input.natureCandidates);
  const ranked: Array<{ result: MaximizeRemainingBulkResult; nature: BulkNatureCandidate }> = [];
  for (const points of iterateDefensiveAllocations(input)) {
    for (const nature of natures) {
      const result = evaluateWithContext(input, context, points, nature, false);
      if (result) ranked.push({ result, nature });
      yield null;
    }
  }
  ranked.sort((a, b) => compareBulkCandidates(a.result, b.result));
  let accepted = 0;
  const maxResults = Math.max(1, Math.trunc(options.maxResults ?? 1));
  for (const { result, nature } of ranked) {
    const checked = evaluateWithContext(input, context, result.candidate.statPoints, nature);
    yield checked;
    if (checked && ++accepted >= maxResults) return;
  }
}

export const compareBulkCandidates = (
  left: MaximizeRemainingBulkResult,
  right: MaximizeRemainingBulkResult,
): number => {
  if (left.score.overallBulk !== right.score.overallBulk) {
    return right.score.overallBulk - left.score.overallBulk;
  }

  const leftLowerBulk = Math.min(left.score.physicalBulk, left.score.specialBulk);
  const rightLowerBulk = Math.min(right.score.physicalBulk, right.score.specialBulk);
  if (leftLowerBulk !== rightLowerBulk) {
    return rightLowerBulk - leftLowerBulk;
  }

  if (left.candidate.remaining !== right.candidate.remaining) {
    return right.candidate.remaining - left.candidate.remaining;
  }

  if (left.natureChangeImpact.changed !== right.natureChangeImpact.changed) {
    return left.natureChangeImpact.changed ? 1 : -1;
  }

  if (left.candidate.derivedStats.hp !== right.candidate.derivedStats.hp) {
    return right.candidate.derivedStats.hp - left.candidate.derivedStats.hp;
  }

  if (left.candidate.statPoints.hp !== right.candidate.statPoints.hp) {
    return right.candidate.statPoints.hp - left.candidate.statPoints.hp;
  }

  if (left.candidate.statPoints.def !== right.candidate.statPoints.def) {
    return right.candidate.statPoints.def - left.candidate.statPoints.def;
  }

  return right.candidate.statPoints.spd - left.candidate.statPoints.spd;
};

export const maximizeRemainingBulk = (
  input: MaximizeRemainingBulkInput,
  options: MaximizeRemainingBulkOptions = {},
): MaximizeRemainingBulkResult[] => {
  const maxResults = Math.max(1, Math.trunc(options.maxResults ?? 1));
  return Array.from(iterateBulkCandidateResults(input, options))
    .filter((result): result is MaximizeRemainingBulkResult => result !== null)
    .sort(compareBulkCandidates)
    .slice(0, maxResults);
};
