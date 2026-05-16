import { describe, expect, it } from "vitest";
import {
  SP_LIMITS,
  emptyStatPoints,
  isStatPointKey,
  sumStatPoints,
  validateStatPoints,
} from "./statPoints";

describe("statPoints", () => {
  it("uses Champions SP limits", () => {
    expect(SP_LIMITS).toEqual({
      maxPerStat: 32,
      maxTotal: 66,
    });
  });

  it("creates an empty SP table", () => {
    expect(emptyStatPoints()).toEqual({
      hp: 0,
      atk: 0,
      def: 0,
      spa: 0,
      spd: 0,
      spe: 0,
    });
  });

  it("sums all six SP values", () => {
    expect(sumStatPoints({ hp: 12, atk: 20, def: 8, spa: 0, spd: 8, spe: 18 })).toBe(66);
  });

  it("validates per-stat and total SP limits", () => {
    expect(validateStatPoints({ hp: 32, atk: 0, def: 0, spa: 0, spd: 16, spe: 18 })).toEqual([]);
    expect(validateStatPoints({ hp: 33, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })).toContain(
      "hp must be between 0 and 32",
    );
    expect(validateStatPoints({ hp: 32, atk: 32, def: 2, spa: 1, spd: 0, spe: 0 })).toContain(
      "total SP must be 66 or less",
    );
  });

  it("recognizes domain stat keys only", () => {
    expect(isStatPointKey("hp")).toBe(true);
    expect(isStatPointKey("speed")).toBe(false);
  });
});
