import { describe, expect, it } from "vitest";
import {
  getMoveHitCountRangeFromInput,
  getMoveMaxHitsFromInput,
} from "./moveHitCounts";

describe("move hit counts", () => {
  it("resolves two-to-five hit moves from Japanese input", () => {
    expect(getMoveHitCountRangeFromInput("タネマシンガン")).toEqual({
      minHits: 2,
      maxHits: 5,
    });
  });

  it("uses @smogon/calc multihit data for newer moves", () => {
    expect(getMoveMaxHitsFromInput("ネズミざん")).toBe(10);
  });

  it("returns null for single-hit moves and unresolved input", () => {
    expect(getMoveHitCountRangeFromInput("ふいうち")).toBeNull();
    expect(getMoveHitCountRangeFromInput("知らない連続技")).toBeNull();
  });
});
