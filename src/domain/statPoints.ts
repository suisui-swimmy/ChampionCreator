import { STAT_KEYS, type ChampionsStatPoints, type StatKey } from "./model";

export const SP_LIMITS = {
  maxPerStat: 32,
  maxTotal: 66,
} as const;

export const emptyStatPoints = (): ChampionsStatPoints => ({
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
});

export const sumStatPoints = (points: ChampionsStatPoints): number =>
  STAT_KEYS.reduce((total, key) => total + points[key], 0);

export const isStatPointKey = (value: string): value is StatKey =>
  STAT_KEYS.includes(value as StatKey);

export const validateStatPoints = (
  points: ChampionsStatPoints,
  maxPerStat: number = SP_LIMITS.maxPerStat,
  maxTotal: number = SP_LIMITS.maxTotal,
): string[] => {
  const errors: string[] = [];

  for (const stat of STAT_KEYS) {
    const value = points[stat];

    if (!Number.isInteger(value)) {
      errors.push(`${stat} must be an integer`);
    }

    if (value < 0 || value > maxPerStat) {
      errors.push(`${stat} must be between 0 and ${maxPerStat}`);
    }
  }

  const total = sumStatPoints(points);
  if (total > maxTotal) {
    errors.push(`total SP must be ${maxTotal} or less`);
  }

  return errors;
};
