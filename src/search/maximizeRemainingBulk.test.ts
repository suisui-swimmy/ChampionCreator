import { describe, expect, it } from "vitest";
import { evaluateScenario } from "./defenceSearch";
import { createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { createTrickRoomFixture } from "../ui/testFixtures/speedIntegration";
import { buildMaximizeRemainingBulkInputFromUi } from "../ui/defenceSearchUi";
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
  enumerateDefensiveAllocations,
  getBuildDerivedStats,
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

describe("bulk maximization with speed conditions", () => {
  it.each([9, 11])("keeps S and nature fixed for both passing and failing Trick Room conditions (S SP %s)", (speed) => {
    const { target, scenarios } = createTrickRoomFixture(speed);
    const input = buildMaximizeRemainingBulkInputFromUi(target, scenarios);
    const results = maximizeRemainingBulk(input, { maxResults: 5 });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(result.candidate.statPoints.spe).toBe(speed);
      expect(result.candidate.natureCanonicalName).toBe(input.build.nature?.canonicalName);
    }
  });
});

describe("computeBulkScore", () => {
  it("uses hp * def * spd / (def + spd) for overall bulk", () => {
    expect(computeBulkScore({ hp: 100, def: 80, spd: 120 })).toEqual({
      physicalBulk: 8000,
      specialBulk: 12000,
      overallBulk: 4800,
    });
  });

  it("returns zero for the overall score when both defensive stats are zero", () => {
    expect(computeBulkScore({ hp: 100, def: 0, spd: 0 })).toEqual({
      physicalBulk: 0,
      specialBulk: 0,
      overallBulk: 0,
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
  it("adds only to H/B/D in the annotated H30 B32 D0 example", () => {
    const base = { ...zeroStatPoints, hp: 30, def: 32 };
    const build = { ...makeBuild(base, "いじっぱり"), pokemon: mustResolve("pokemon", "ドドゲザン") };
    const results = maximizeRemainingBulk({ build }, { maxResults: 50 });
    expect(results).toHaveLength(3);
    expect(results[0].candidate.statPoints).toEqual({ ...base, spd: 4 });
    for (const result of results) {
      expect(result.candidate.statPoints.hp).toBeGreaterThanOrEqual(30);
      expect(result.candidate.statPoints.def).toBe(32);
      expect(result.candidate.statPoints).toMatchObject({ atk: 0, spa: 0, spe: 0 });
      expect(result.candidate.natureCanonicalName).toBe("Adamant");
      expect(result.candidate.usedTotal).toBeLessThanOrEqual(66);
    }
    expect(evaluateBulkCandidate({ build }, { ...base, hp: 32, def: 31, spd: 3 })).toBeNull();
    expect(evaluateBulkCandidate({ build }, { ...base, atk: 1 })).toBeNull();
    expect(evaluateBulkCandidate({ build }, { ...base, spd: 5 })).toBeNull();
    expect(build.statPoints).toEqual(base);
  });

  it("returns the top 50 in the same order as all legal additional allocations", () => {
    const build = makeBuild({ ...zeroStatPoints, hp: 8, def: 8, spd: 8, atk: 8, spa: 4, spe: 10 });
    const all = maximizeRemainingBulk({ build }, { maxResults: 10000 });
    expect(maximizeRemainingBulk({ build }, { maxResults: 50 })).toEqual(all.slice(0, 50));
    expect(all.length).toBeGreaterThan(50);
    expect(all.every((entry) => entry.candidate.statPoints.hp >= 8 && entry.candidate.statPoints.def >= 8 && entry.candidate.statPoints.spd >= 8)).toBe(true);
    expect(all[0].candidate.usedTotal).toBe(66);
  });

  it("returns the unchanged allocation when no SP remains", () => {
    const build = makeBuild({ ...zeroStatPoints, hp: 30, def: 32, spd: 4 });
    const results = maximizeRemainingBulk({ build }, { maxResults: 50 });
    expect(results).toHaveLength(1);
    expect(results[0].candidate.statPoints).toEqual(build.statPoints);
    expect(results[0].score.overallBulkGain).toBe(0);
  });

  it("respects all lower bounds and spends exactly the remaining SP", () => {
    const build = makeBuild({ hp: 31, atk: 0, def: 31, spa: 0, spd: 1, spe: 0 });
    const points = enumerateDefensiveAllocations({ build });
    expect(points).toHaveLength(4);
    expect(points.every((entry) => Object.values(entry).reduce((sum, sp) => sum + sp, 0) === 66)).toBe(true);
    expect(points.every((entry) => entry.hp <= 32 && entry.def <= 32 && entry.spd >= 1)).toBe(true);
    expect(() => maximizeRemainingBulk({ build: makeBuild({ ...zeroStatPoints, hp: 33 }) })).toThrow("上限外");
    expect(() => maximizeRemainingBulk({ build: makeBuild({ ...zeroStatPoints, hp: 32, def: 32, spd: 3 }) })).toThrow("合計66");
  });

  it("preserves the annotated passing Close Combat condition using the real calc evaluator", () => {
    const target = { ...createDefaultTargetForm(), pokemonInput: "ドドゲザン", pokemonCanonicalName: undefined,
      natureInput: "いじっぱり", abilityInput: "まけんき", itemInput: "ヨプのみ",
      statPoints: { ...zeroStatPoints, hp: 30, def: 32 } };
    const [scenario] = createDefaultScenarioForms();
    scenario.attacks = [{ ...scenario.attacks[0], attackerPokemonInput: "オオニューラ", attackerPokemonCanonicalName: undefined,
      attackerNatureInput: "ようき", attackerAbilityInput: "かるわざ", attackerItemInput: "たつじんのおび",
      attackerStatPoints: { ...zeroStatPoints, atk: 32 }, moveInput: "インファイト", repeat: 1,
      requiredSurvivedHits: 1, minSurvivalProbabilityPercent: 100 }];
    const input = buildMaximizeRemainingBulkInputFromUi(target, [scenario]);
    const defence = input.defenceScenarios![0];
    expect(evaluateScenario(input.build, defence).passed).toBe(true);
    const loweringNature = { nature: mustResolve("nature", "おっとり") as NatureRef };
    const natureInput = { ...input, allowNatureChange: true, natureCandidates: [loweringNature] };
    expect(evaluateBulkCandidate(natureInput, { ...target.statPoints, spd: 4 }, loweringNature)).toBeNull();
    const failingInput = { ...natureInput, build: { ...input.build, item: undefined } };
    expect(evaluateScenario(failingInput.build, defence).passed).toBe(false);
    expect(evaluateBulkCandidate(failingInput, { ...target.statPoints, spd: 4 }, loweringNature)).not.toBeNull();
    const unsupportedInput = { ...natureInput, defenceScenarios: [{ ...defence, hits: defence.hits.map((hit) => ({
      ...hit, hpEvents: [{ id: "unsupported", effectId: "not-supported", enabled: true, sequenceContext: "currentMove" as const }],
    })) }] };
    expect(() => maximizeRemainingBulk(unsupportedInput)).toThrow("計算未対応");
    const noConditions = { ...natureInput, defenceScenarios: [] };
    expect(evaluateBulkCandidate(noConditions, { ...target.statPoints, spd: 4 }, loweringNature)).not.toBeNull();
    const results = maximizeRemainingBulk(natureInput, { maxResults: 50 });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const build = { ...input.build, statPoints: result.candidate.statPoints, evs: statPointTableToSmogonEvs(result.candidate.statPoints) };
      expect(evaluateScenario(build, defence).passed).toBe(true);
      expect(result.score).toMatchObject(computeBulkScore(getBuildDerivedStats(build)));
    }
  });
});

describe("optional nature changes", () => {
  it("offers other natures without reducing any SP when no conditions are set", () => {
    const build = makeBuild({ ...zeroStatPoints, hp: 30, def: 32 }, "いじっぱり");
    const bold = { nature: mustResolve("nature", "ずぶとい") as NatureRef };
    const input = { build, allowNatureChange: true, natureCandidates: [bold] };
    const result = evaluateBulkCandidate(input, { ...build.statPoints!, spd: 4 }, bold);
    expect(result?.candidate.natureCanonicalName).toBe("Bold");
    expect(result?.natureChangeImpact.changed).toBe(true);
    expect(result?.candidate.statPoints).toMatchObject({ hp: 30, def: 32 });
    expect(evaluateBulkCandidate({ ...input, allowNatureChange: false }, { ...build.statPoints!, spd: 4 }, bold)).toBeNull();
    expect(maximizeRemainingBulk(input, { maxResults: 50 }).some((entry) => entry.candidate.natureCanonicalName === "Bold")).toBe(true);
  });

  it("rejects nature changes that break a passing speed condition but ignores an already failing one", () => {
    const { target, scenarios } = createTrickRoomFixture(9);
    const input = buildMaximizeRemainingBulkInputFromUi(target, scenarios, { allowNatureChange: true });
    input.defenceScenarios = [];
    const points = { ...input.build.statPoints!, hp: 32, def: 25, spd: 0, spe: 9 };
    const fast = { nature: mustResolve("nature", "ようき") as NatureRef };
    expect(evaluateBulkCandidate(input, points, fast)).toBeNull();
    const failInput = buildMaximizeRemainingBulkInputFromUi({ ...target, statPoints: { ...target.statPoints, spe: 11 } }, scenarios, { allowNatureChange: true });
    failInput.defenceScenarios = [];
    expect(evaluateBulkCandidate(failInput, { ...points, def: 23, spe: 11 }, fast)).not.toBeNull();
  });
});
