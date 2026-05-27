import { describe, expect, it } from "vitest";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  isLegalStatPointTable,
  smogonEvTableToStatPoints,
  statPointTableToSmogonEvs,
  statPointsToSmogonEv,
} from "./championsStats";

describe("champions stat point conversion", () => {
  it("converts Champions SP to Smogon EV values that preserve Lv.50 stat increments", () => {
    expect(CHAMPIONS_MAX_STAT_POINTS_PER_STAT).toBe(32);
    expect(CHAMPIONS_TOTAL_STAT_POINTS).toBe(66);
    expect(statPointsToSmogonEv(0)).toBe(0);
    expect(statPointsToSmogonEv(1)).toBe(4);
    expect(statPointsToSmogonEv(2)).toBe(12);
    expect(statPointsToSmogonEv(32)).toBe(252);
  });

  it("converts full stat point tables and validates the Champions caps", () => {
    const statPoints = { hp: 2, atk: 0, def: 0, spa: 32, spd: 0, spe: 32 };

    expect(isLegalStatPointTable(statPoints)).toBe(true);
    expect(statPointTableToSmogonEvs(statPoints)).toEqual({
      hp: 12,
      atk: 0,
      def: 0,
      spa: 252,
      spd: 0,
      spe: 252,
    });
    expect(smogonEvTableToStatPoints(statPointTableToSmogonEvs(statPoints))).toEqual(statPoints);
    expect(isLegalStatPointTable({ ...statPoints, spd: 1 })).toBe(false);
  });
});
