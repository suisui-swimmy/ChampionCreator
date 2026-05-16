import {
  STAT_KEYS,
  type ChampionsStatPoints,
  type SearchBudget,
  type StatKey,
} from "../domain/model";
import { SP_LIMITS, emptyStatPoints, sumStatPoints, validateStatPoints } from "../domain/statPoints";

export interface StatPointEnumerationOptions {
  fixed?: Partial<ChampionsStatPoints>;
  lowerBounds?: Partial<ChampionsStatPoints>;
  maxPerStat?: number;
  maxTotal?: number;
  varyingStats?: readonly StatKey[];
  step?: number;
}

const normalizeStep = (step?: number): number => {
  if (!step || step < 1) {
    return 1;
  }

  return Math.floor(step);
};

const normalizeBound = (value: number | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value)) {
    throw new Error(`SP bound must be an integer: ${value}`);
  }

  return value;
};

const valuesForStat = (
  stat: StatKey,
  options: Required<Pick<StatPointEnumerationOptions, "maxPerStat" | "maxTotal">> &
    StatPointEnumerationOptions,
): number[] => {
  const fixed = options.fixed?.[stat];
  const lowerBound = normalizeBound(options.lowerBounds?.[stat], 0);
  const isVarying = options.varyingStats?.includes(stat) ?? true;

  if (fixed !== undefined) {
    if (!Number.isInteger(fixed)) {
      throw new Error(`${stat} fixed SP must be an integer`);
    }

    if (fixed < lowerBound) {
      throw new Error(`${stat} fixed SP must be at least lower bound ${lowerBound}`);
    }

    return [fixed];
  }

  if (!isVarying) {
    return [lowerBound];
  }

  const step = normalizeStep(options.step);
  const values: number[] = [];

  for (let value = lowerBound; value <= options.maxPerStat; value += step) {
    values.push(value);
  }

  if (values.at(-1) !== options.maxPerStat) {
    values.push(options.maxPerStat);
  }

  return values;
};

export function* enumerateStatPoints(
  options: StatPointEnumerationOptions = {},
): Generator<ChampionsStatPoints> {
  const normalizedOptions = {
    ...options,
    maxPerStat: options.maxPerStat ?? SP_LIMITS.maxPerStat,
    maxTotal: options.maxTotal ?? SP_LIMITS.maxTotal,
  };
  const valuesByStat = Object.fromEntries(
    STAT_KEYS.map((stat) => [stat, valuesForStat(stat, normalizedOptions)]),
  ) as Record<StatKey, number[]>;
  const candidate = emptyStatPoints();

  function* visit(statIndex: number, partialTotal: number): Generator<ChampionsStatPoints> {
    if (partialTotal > normalizedOptions.maxTotal) {
      return;
    }

    if (statIndex >= STAT_KEYS.length) {
      const errors = validateStatPoints(
        candidate,
        normalizedOptions.maxPerStat,
        normalizedOptions.maxTotal,
      );

      if (errors.length === 0) {
        yield { ...candidate };
      }

      return;
    }

    const stat = STAT_KEYS[statIndex];

    for (const value of valuesByStat[stat]) {
      candidate[stat] = value;
      yield* visit(statIndex + 1, partialTotal + value);
    }
  }

  yield* visit(0, 0);
}

export const budgetToEnumerationOptions = (
  budget: SearchBudget,
  fixed: Partial<ChampionsStatPoints>,
  varyingStats: readonly StatKey[],
  step = 1,
): StatPointEnumerationOptions => ({
  fixed,
  lowerBounds: budget.lowerBounds,
  maxPerStat: Math.min(budget.maxPerStat, SP_LIMITS.maxPerStat),
  maxTotal: Math.min(budget.maxTotal, SP_LIMITS.maxTotal),
  varyingStats,
  step,
});

export const statPointKey = (points: ChampionsStatPoints): string =>
  STAT_KEYS.map((stat) => points[stat]).join("-");

export const totalStatPoints = sumStatPoints;
