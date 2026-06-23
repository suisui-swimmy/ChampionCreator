import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import { statPointTableToSmogonEvs, type StatPointTable } from "../domain/championsStats";
import type { Build, EntityRef, NatureRef, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  compareBulkCandidates,
  computeBulkScore,
  evaluateBulkCandidate,
  maximizeRemainingBulk,
  type BulkNatureCandidate,
} from "./maximizeRemainingBulk";

const mustResolve = <K extends EntityKind>(kind: K, input: string): EntityRef<K> => {
  const ref = toEntityRef(resolveEntity(kind, input), kind);
  if (!ref) {
    throw new Error(`Expected ${kind}:${input} to resolve`);
  }
  return ref;
};

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const zeroStatPoints: StatPointTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const natureCandidate = (label: string): BulkNatureCandidate => ({
  nature: mustResolve("nature", label) as NatureRef,
});

const makeBuild = (
  statPoints: StatPointTable,
  natureInput = "おくびょう",
): Build => ({
  id: "target",
  pokemon: mustResolve("pokemon", "カイリュー"),
  level: 50,
  nature: mustResolve("nature", natureInput),
  ivs: defaultIvs,
  statPoints,
  evs: statPointTableToSmogonEvs(statPoints),
});

describe("computeBulkScore", () => {
  it("uses hp * def * spd / (def + spd) for overall bulk", () => {
    expect(computeBulkScore({ hp: 100, def: 80, spd: 120 })).toEqual({
      physicalBulk: 8000,
      specialBulk: 12000,
      overallBulk: 4800,
    });
  });

  it("ranks a balanced B/D profile above a skewed profile when HP is equal", () => {
    const balanced = {
      candidate: {
        nature: "a",
        statPoints: { ...zeroStatPoints, hp: 10, def: 10, spd: 10 },
        spOrEvs: { ...zeroStatPoints, hp: 10, def: 10, spd: 10 },
        derivedStats: { hp: 100, atk: 0, def: 100, spa: 0, spd: 100, spe: 0 },
        usedTotal: 30,
        remaining: 36,
      },
      score: {
        ...computeBulkScore({ hp: 100, def: 100, spd: 100 }),
        currentPhysicalBulk: 1,
        currentSpecialBulk: 1,
        currentOverallBulk: 1,
        overallBulkGain: 4999,
      },
      natureChangeImpact: { changed: false, from: "a", to: "a", loweredStats: [], raisedStats: [], notes: [] },
      explanation: "",
    };
    const skewed = {
      ...balanced,
      candidate: {
        ...balanced.candidate,
        derivedStats: { hp: 100, atk: 0, def: 50, spa: 0, spd: 150, spe: 0 },
      },
      score: {
        ...computeBulkScore({ hp: 100, def: 50, spd: 150 }),
        currentPhysicalBulk: 1,
        currentSpecialBulk: 1,
        currentOverallBulk: 1,
        overallBulkGain: 3749,
      },
    };

    expect(compareBulkCandidates(balanced, skewed)).toBeLessThan(0);
  });
});

describe("maximizeRemainingBulk", () => {
  it("keeps the current nature when nature changes are disabled", () => {
    const build = makeBuild({ ...zeroStatPoints, hp: 8, def: 4, spd: 6, spe: 12 });

    const [result] = maximizeRemainingBulk({
      build,
      allowNatureChange: false,
      natureCandidates: [natureCandidate("ずぶとい"), natureCandidate("おだやか")],
    });

    expect(result.candidate.natureCanonicalName).toBe("Timid");
    expect(result.natureChangeImpact.changed).toBe(false);
    expect(result.candidate.usedTotal).toBe(66);
    expect(result.candidate.statPoints.atk).toBe(0);
    expect(result.candidate.statPoints.spa).toBe(0);
    expect(result.candidate.statPoints.spe).toBe(12);
    expect(result.score.overallBulkGain).toBeGreaterThan(0);
  });

  it("evaluates supplied nature candidates when nature changes are enabled", () => {
    const build = makeBuild({ ...zeroStatPoints, hp: 8, def: 4, spd: 6, spe: 12 });
    const [withoutNatureChange] = maximizeRemainingBulk({ build, allowNatureChange: false });
    const [withNatureChange] = maximizeRemainingBulk({
      build,
      allowNatureChange: true,
      natureCandidates: [
        natureCandidate("おくびょう"),
        natureCandidate("ずぶとい"),
        natureCandidate("おだやか"),
      ],
    });

    expect(withNatureChange.score.overallBulk).toBeGreaterThanOrEqual(withoutNatureChange.score.overallBulk);
    expect(["Timid", "Bold", "Calm"]).toContain(withNatureChange.candidate.natureCanonicalName);
  });

  it("filters candidates that reduce current physical or special bulk by default", () => {
    const build = makeBuild({ ...zeroStatPoints, hp: 12, def: 12, spd: 12 });
    const result = evaluateBulkCandidate(
      { build },
      { ...zeroStatPoints, hp: 0, def: 0, spd: 32 },
      { nature: build.nature },
    );

    expect(result).toBeNull();
  });

  it("does not return nature candidates that lower protected A/C/S actual stats", () => {
    const build = makeBuild({ ...zeroStatPoints, hp: 8, def: 4, spd: 6, spe: 20 }, "おくびょう");
    const [protectedBaseline] = maximizeRemainingBulk({ build, allowNatureChange: false });
    const [result] = maximizeRemainingBulk({
      build,
      allowNatureChange: true,
      natureCandidates: [
        natureCandidate("ずぶとい"),
        natureCandidate("おくびょう"),
      ],
      protectedActualStats: {
        spe: protectedBaseline.candidate.derivedStats.spe,
      },
    });

    expect(result.candidate.natureCanonicalName).toBe("Timid");
    expect(result.natureChangeImpact.loweredStats).not.toContain("spe");
  });

  it("keeps fixed A/C/S SP and never exceeds per-stat or total SP limits", () => {
    const build = makeBuild({ ...zeroStatPoints, atk: 20, spa: 12, spe: 10, hp: 4, def: 3, spd: 2 });
    const [result] = maximizeRemainingBulk({
      build,
      allowNatureChange: false,
      minimumStatPoints: { hp: 2, def: 2, spd: 2 },
    });

    expect(result.candidate.statPoints).toMatchObject({ atk: 20, spa: 12, spe: 10 });
    expect(Object.values(result.candidate.statPoints).every((value) => value >= 0 && value <= 32)).toBe(true);
    expect(result.candidate.usedTotal).toBe(66);
  });
});
