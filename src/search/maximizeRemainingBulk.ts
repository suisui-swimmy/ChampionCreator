import { toSmogonPokemon } from "../calc/smogonAdapter";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  isLegalStatPointTable,
  isLegalStatPointValue,
  statPointTableToSmogonEvs,
  sumStatPoints,
} from "../domain/championsStats";
import type {
  Build,
  DefenceSearchStatKey,
  NatureRef,
  StatKey,
  StatTable,
} from "../domain/model";
import { getBuildStatPoints } from "./defenceSearch";

const DEFENSIVE_STAT_KEYS = ["hp", "def", "spd"] as const satisfies readonly DefenceSearchStatKey[];
const NATURE_STAT_KEYS = ["atk", "def", "spa", "spd", "spe"] as const satisfies readonly Exclude<StatKey, "hp">[];
const PROTECTED_SIDE_EFFECT_STAT_KEYS = ["atk", "spa", "spe"] as const satisfies readonly StatKey[];
const protectedSideEffectStatKeySet = new Set<StatKey>(PROTECTED_SIDE_EFFECT_STAT_KEYS);
const sideEffectStatLabels = {
  atk: "A",
  spa: "C",
  spe: "S",
} satisfies Record<(typeof PROTECTED_SIDE_EFFECT_STAT_KEYS)[number], string>;

export type BulkNatureCandidate = {
  nature?: NatureRef;
};

export type NatureChangeImpact = {
  changed: boolean;
  from: string;
  to: string;
  loweredStats: Array<Exclude<StatKey, "hp">>;
  raisedStats: Array<Exclude<StatKey, "hp">>;
  notes: string[];
};

export type BulkScore = {
  physicalBulk: number;
  specialBulk: number;
  overallBulk: number;
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
  minimumStatPoints?: Partial<Pick<StatTable, "hp" | "def" | "spd">>;
  protectedActualStats?: Partial<Pick<StatTable, "atk" | "spa" | "spe">>;
  keepCurrentPhysicalSpecialBulk?: boolean;
}

export interface MaximizeRemainingBulkOptions {
  maxResults?: number;
}

type MaximizeRemainingBulkContext = {
  buildStatPoints: StatTable;
  currentStats: StatTable;
  currentScore: BulkScore;
  defensiveBudget: number;
  fixedStatPointTotal: number;
  minimumStatPoints: Partial<Pick<StatTable, "hp" | "def" | "spd">>;
  natureCandidates: BulkNatureCandidate[];
  keepCurrentPhysicalSpecialBulk: boolean;
};

export const computeBulkScore = (
  stats: Pick<StatTable, "hp" | "def" | "spd">,
): BulkScore => ({
  physicalBulk: stats.hp * stats.def,
  specialBulk: stats.hp * stats.spd,
  overallBulk: stats.def + stats.spd === 0
    ? 0
    : (stats.hp * stats.def * stats.spd) / (stats.def + stats.spd),
});

const cloneStatPoints = (statPoints: StatTable): StatTable => ({ ...statPoints });

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

const withStatPointsAndNature = (
  build: Build,
  statPoints: StatTable,
  nature: NatureRef | undefined,
): Build => ({
  ...build,
  nature,
  statPoints,
  evs: statPointTableToSmogonEvs(statPoints),
});

export const getBuildDerivedStats = (build: Build): StatTable => {
  const pokemon = toSmogonPokemon(build);
  return {
    ...pokemon.stats,
    hp: pokemon.maxHP(),
  };
};

const prepareMaximizeRemainingBulkContext = (
  input: MaximizeRemainingBulkInput,
): MaximizeRemainingBulkContext => {
  const buildStatPoints = getBuildStatPoints(input.build);
  if (!Object.values(buildStatPoints).every(isLegalStatPointValue)) {
    throw new Error("現在のSP配分に上限外の値があります");
  }
  if (sumStatPoints(buildStatPoints) > CHAMPIONS_TOTAL_STAT_POINTS) {
    throw new Error(`現在のSP配分が合計${CHAMPIONS_TOTAL_STAT_POINTS}を超えています`);
  }

  const fixedStatPointTotal = buildStatPoints.atk + buildStatPoints.spa + buildStatPoints.spe;
  const defensiveBudget = CHAMPIONS_TOTAL_STAT_POINTS - fixedStatPointTotal;
  const minimumStatPoints = input.minimumStatPoints ?? {};
  const minimumDefensiveTotal = DEFENSIVE_STAT_KEYS.reduce(
    (total, key) => total + (minimumStatPoints[key] ?? 0),
    0,
  );
  if (minimumDefensiveTotal > defensiveBudget) {
    throw new Error(
      `H/B/D の下限SPが防御系予算を超えています`
      + ` (下限 ${minimumDefensiveTotal} / 予算 ${defensiveBudget})`,
    );
  }

  const currentStats = getBuildDerivedStats(input.build);
  return {
    buildStatPoints,
    currentStats,
    currentScore: computeBulkScore(currentStats),
    defensiveBudget,
    fixedStatPointTotal,
    minimumStatPoints,
    natureCandidates: normalizeNatureCandidates(
      input.build,
      Boolean(input.allowNatureChange),
      input.natureCandidates,
    ),
    keepCurrentPhysicalSpecialBulk: input.keepCurrentPhysicalSpecialBulk ?? true,
  };
};

export function* iterateDefensiveAllocations(
  input: MaximizeRemainingBulkInput,
): Generator<StatTable> {
  const context = prepareMaximizeRemainingBulkContext(input);
  yield* iterateDefensiveAllocationsFromContext(context);
}

function* iterateDefensiveAllocationsFromContext(
  context: MaximizeRemainingBulkContext,
): Generator<StatTable> {
  const baseStatPoints = context.buildStatPoints;

  for (let hp = 0; hp <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT; hp += 1) {
    if (hp < (context.minimumStatPoints.hp ?? 0)) {
      continue;
    }

    for (let def = 0; def <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT; def += 1) {
      if (def < (context.minimumStatPoints.def ?? 0)) {
        continue;
      }

      const spd = context.defensiveBudget - hp - def;
      if (
        spd < (context.minimumStatPoints.spd ?? 0)
        || spd < 0
        || spd > CHAMPIONS_MAX_STAT_POINTS_PER_STAT
      ) {
        continue;
      }

      const statPoints = {
        ...baseStatPoints,
        hp,
        def,
        spd,
      };
      if (isLegalStatPointTable(statPoints)) {
        yield statPoints;
      }
    }
  }
}

export const enumerateDefensiveAllocations = (
  input: MaximizeRemainingBulkInput,
): StatTable[] => Array.from(iterateDefensiveAllocations(input));

export const countMaximizeRemainingBulkCandidates = (
  input: MaximizeRemainingBulkInput,
): number => {
  const context = prepareMaximizeRemainingBulkContext(input);
  let allocationCount = 0;
  for (const _allocation of iterateDefensiveAllocationsFromContext(context)) {
    allocationCount += 1;
  }
  return allocationCount * context.natureCandidates.length;
};

const getNatureChangeImpact = (
  currentNature: NatureRef | undefined,
  candidateNature: NatureRef | undefined,
  currentStats: StatTable,
  candidateStats: StatTable,
): NatureChangeImpact => {
  const loweredStats = NATURE_STAT_KEYS.filter((key) => candidateStats[key] < currentStats[key]);
  const raisedStats = NATURE_STAT_KEYS.filter((key) => candidateStats[key] > currentStats[key]);
  const notes = loweredStats
    .filter((key) => protectedSideEffectStatKeySet.has(key))
    .map((key) => `${sideEffectStatLabels[key as keyof typeof sideEffectStatLabels]}実数値が現在より下がります`);

  return {
    changed: (currentNature?.canonicalName ?? null) !== (candidateNature?.canonicalName ?? null),
    from: getNatureLabel(currentNature),
    to: getNatureLabel(candidateNature),
    loweredStats,
    raisedStats,
    notes,
  };
};

const passesProtectedActualStats = (
  candidateStats: StatTable,
  protectedActualStats: MaximizeRemainingBulkInput["protectedActualStats"] = {},
): boolean => PROTECTED_SIDE_EFFECT_STAT_KEYS.every((key) => (
  candidateStats[key] >= (protectedActualStats[key] ?? 0)
));

export const evaluateBulkCandidate = (
  input: MaximizeRemainingBulkInput,
  statPoints: StatTable,
  natureCandidate: BulkNatureCandidate,
): MaximizeRemainingBulkResult | null => {
  const context = prepareMaximizeRemainingBulkContext(input);
  return evaluateBulkCandidateWithContext(input, context, statPoints, natureCandidate);
};

const evaluateBulkCandidateWithContext = (
  input: MaximizeRemainingBulkInput,
  context: MaximizeRemainingBulkContext,
  statPoints: StatTable,
  natureCandidate: BulkNatureCandidate,
): MaximizeRemainingBulkResult | null => {
  const candidateBuild = withStatPointsAndNature(input.build, statPoints, natureCandidate.nature);
  const derivedStats = getBuildDerivedStats(candidateBuild);
  const score = computeBulkScore(derivedStats);

  if (
    context.keepCurrentPhysicalSpecialBulk
    && (
      score.physicalBulk < context.currentScore.physicalBulk
      || score.specialBulk < context.currentScore.specialBulk
    )
  ) {
    return null;
  }

  if (!passesProtectedActualStats(derivedStats, input.protectedActualStats)) {
    return null;
  }

  const usedTotal = sumStatPoints(statPoints);
  const natureChangeImpact = getNatureChangeImpact(
    input.build.nature,
    natureCandidate.nature,
    context.currentStats,
    derivedStats,
  );
  const naturePart = natureChangeImpact.changed
    ? `性格を ${natureChangeImpact.from} から ${natureChangeImpact.to} に変更`
    : `${natureChangeImpact.to} のまま`;
  const explanation = [
    `${naturePart}し、H${statPoints.hp} / B${statPoints.def} / D${statPoints.spd} に再配分します`,
    `総合耐久指数は ${context.currentScore.overallBulk.toFixed(1)} から ${score.overallBulk.toFixed(1)} へ上がります`,
  ].join("。");

  return {
    candidate: {
      nature: getNatureLabel(natureCandidate.nature),
      natureCanonicalName: natureCandidate.nature?.canonicalName,
      statPoints: cloneStatPoints(statPoints),
      spOrEvs: cloneStatPoints(statPoints),
      derivedStats,
      usedTotal,
      remaining: CHAMPIONS_TOTAL_STAT_POINTS - usedTotal,
    },
    score: {
      ...score,
      currentPhysicalBulk: context.currentScore.physicalBulk,
      currentSpecialBulk: context.currentScore.specialBulk,
      currentOverallBulk: context.currentScore.overallBulk,
      overallBulkGain: score.overallBulk - context.currentScore.overallBulk,
    },
    natureChangeImpact,
    explanation,
  };
};

export function* iterateBulkCandidateResults(
  input: MaximizeRemainingBulkInput,
): Generator<MaximizeRemainingBulkResult> {
  const context = prepareMaximizeRemainingBulkContext(input);
  for (const statPoints of iterateDefensiveAllocationsFromContext(context)) {
    for (const natureCandidate of context.natureCandidates) {
      const result = evaluateBulkCandidateWithContext(input, context, statPoints, natureCandidate);
      if (result) {
        yield result;
      }
    }
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
  return Array.from(iterateBulkCandidateResults(input))
    .sort(compareBulkCandidates)
    .slice(0, maxResults);
};
