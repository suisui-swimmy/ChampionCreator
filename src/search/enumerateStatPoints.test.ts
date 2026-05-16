import { describe, expect, it } from "vitest";
import { enumerateStatPoints } from "./enumerateStatPoints";

describe("enumerateStatPoints", () => {
  it("keeps every SP inside 0..32 and total <= 66", () => {
    const candidates = Array.from(
      enumerateStatPoints({
        fixed: {
          atk: 20,
          spa: 0,
          spe: 16,
        },
        varyingStats: ["hp", "def", "spd"],
        step: 8,
      }),
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => Object.values(candidate).every((value) => value >= 0 && value <= 32))).toBe(
      true,
    );
    expect(candidates.every((candidate) => Object.values(candidate).reduce((total, value) => total + value, 0) <= 66)).toBe(
      true,
    );
  });

  it("honors fixed values and lower bounds", () => {
    const candidates = Array.from(
      enumerateStatPoints({
        maxPerStat: 4,
        maxTotal: 10,
        fixed: {
          atk: 2,
          spa: 1,
          spe: 1,
        },
        lowerBounds: {
          hp: 1,
          def: 2,
          spd: 3,
        },
        varyingStats: ["hp", "def", "spd"],
      }),
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.atk === 2)).toBe(true);
    expect(candidates.every((candidate) => candidate.spa === 1)).toBe(true);
    expect(candidates.every((candidate) => candidate.spe === 1)).toBe(true);
    expect(candidates.every((candidate) => candidate.hp >= 1)).toBe(true);
    expect(candidates.every((candidate) => candidate.def >= 2)).toBe(true);
    expect(candidates.every((candidate) => candidate.spd >= 3)).toBe(true);
  });
});
