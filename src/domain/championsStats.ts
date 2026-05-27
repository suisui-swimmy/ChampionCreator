import type { StatKey, StatTable } from "./model";

export const CHAMPIONS_TOTAL_STAT_POINTS = 66;
export const CHAMPIONS_MAX_STAT_POINTS_PER_STAT = 32;

const ALL_STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];

export type StatPointTable = StatTable;

export const sumStatPoints = (statPoints: StatPointTable): number =>
  ALL_STAT_KEYS.reduce((total, key) => total + statPoints[key], 0);

export const statPointsToSmogonEv = (statPoints: number): number => {
  const points = Math.max(0, Math.trunc(statPoints));
  return points === 0 ? 0 : 4 + (points - 1) * 8;
};

export const smogonEvToStatPoints = (ev: number): number => {
  const value = Math.max(0, Math.trunc(ev));
  return value === 0 ? 0 : Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT, Math.floor((value + 4) / 8));
};

export const statPointTableToSmogonEvs = (statPoints: StatPointTable): StatTable => ({
  hp: statPointsToSmogonEv(statPoints.hp),
  atk: statPointsToSmogonEv(statPoints.atk),
  def: statPointsToSmogonEv(statPoints.def),
  spa: statPointsToSmogonEv(statPoints.spa),
  spd: statPointsToSmogonEv(statPoints.spd),
  spe: statPointsToSmogonEv(statPoints.spe),
});

export const smogonEvTableToStatPoints = (evs: StatTable): StatPointTable => ({
  hp: smogonEvToStatPoints(evs.hp),
  atk: smogonEvToStatPoints(evs.atk),
  def: smogonEvToStatPoints(evs.def),
  spa: smogonEvToStatPoints(evs.spa),
  spd: smogonEvToStatPoints(evs.spd),
  spe: smogonEvToStatPoints(evs.spe),
});

export const clampStatPointValue = (statPoints: number): number => {
  if (!Number.isFinite(statPoints)) {
    return 0;
  }
  return Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT, Math.max(0, Math.trunc(statPoints)));
};

export const clampStatPointTable = (statPoints: StatPointTable): StatPointTable => ({
  hp: clampStatPointValue(statPoints.hp),
  atk: clampStatPointValue(statPoints.atk),
  def: clampStatPointValue(statPoints.def),
  spa: clampStatPointValue(statPoints.spa),
  spd: clampStatPointValue(statPoints.spd),
  spe: clampStatPointValue(statPoints.spe),
});

export const isLegalStatPointValue = (statPoints: number): boolean =>
  Number.isInteger(statPoints)
    && statPoints >= 0
    && statPoints <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT;

export const isLegalStatPointTable = (statPoints: StatPointTable): boolean =>
  ALL_STAT_KEYS.every((key) => isLegalStatPointValue(statPoints[key]))
    && sumStatPoints(statPoints) <= CHAMPIONS_TOTAL_STAT_POINTS;
