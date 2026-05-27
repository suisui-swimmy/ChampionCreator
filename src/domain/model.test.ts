import { describe, expect, it } from "vitest";
import { resolveEntity } from "../localization/resolver";
import type { Build, CandidateResult, EntityRef, Scenario, StatTable } from "./model";
import { isResolvedEntityResult, toEntityRef } from "./model";
import type { EntityKind } from "../data/localizationTypes";

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

const zeroEvs: StatTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

describe("domain model resolver boundary", () => {
  it("accepts exact resolver results as canonical domain refs", () => {
    const resolved = resolveEntity("pokemon", "ピカチュウ");

    expect(isResolvedEntityResult(resolved, "pokemon")).toBe(true);
    expect(toEntityRef(resolved, "pokemon")).toMatchObject({
      kind: "pokemon",
      canonicalName: "Pikachu",
      calcId: "pikachu",
      displayNameJa: "ピカチュウ",
      resolvedBy: "exact",
    });
  });

  it("accepts alias resolver results without leaking the input text into the canonical field", () => {
    const ref = toEntityRef(resolveEntity("move", "十万ボルト"), "move");

    expect(ref).toMatchObject({
      kind: "move",
      canonicalName: "Thunderbolt",
      displayNameJa: "10まんボルト",
      resolvedBy: "alias",
    });
  });

  it("keeps ambiguous or missing resolver results outside the domain model", () => {
    expect(toEntityRef(resolveEntity("pokemon", "ドラゴン"), "pokemon")).toBeNull();
    expect(toEntityRef(resolveEntity("item", "しらないどうぐ"), "item")).toBeNull();
  });
});

describe("domain model shape", () => {
  it("can represent a target build, multi-hit scenario, evaluation placeholder, and H/B/D candidate", () => {
    const defender: Build = {
      id: "target-1",
      pokemon: mustResolve("pokemon", "ピカチュウ"),
      level: 100,
      nature: mustResolve("nature", "ひかえめ"),
      ivs: defaultIvs,
      evs: { ...zeroEvs, hp: 12, def: 4, spa: 28 },
      ability: mustResolve("ability", "せいでんき"),
      item: mustResolve("item", "こだわりスカーフ"),
      teraType: mustResolve("type", "でんき"),
    };

    const attacker: Build = {
      id: "attacker-1",
      pokemon: mustResolve("pokemon", "ガブリアス"),
      level: 100,
      nature: mustResolve("nature", "ようき"),
      ivs: defaultIvs,
      evs: { ...zeroEvs, atk: 252, spe: 252 },
      item: mustResolve("item", "こだわりハチマキ"),
    };

    const scenario: Scenario = {
      id: "scenario-a",
      label: "シナリオA",
      enabled: true,
      hits: [
        {
          id: "hit-1",
          attacker,
          move: mustResolve("move", "じしん"),
          repeat: 2,
          critical: false,
          attackerBoosts: { atk: 0 },
          defenderBoosts: { def: 0 },
          attackerSide: { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false },
          defenderSide: { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false },
        },
      ],
      field: { weather: "none", terrain: "none" },
      constraint: {
        enabled: true,
        requiredSurvivedHits: 2,
        minSurvivalProbability: 0.75,
      },
    };

    const candidate: CandidateResult = {
      id: "candidate-1",
      rank: 1,
      candidate: { hp: 12, def: 4, spd: 0 },
      appliedStatPoints: { ...zeroEvs, hp: 12, def: 4 },
      appliedEvs: defender.evs,
      usedStatPointBudget: 16,
      remainingStatPointBudget: 50,
      usedEvBudget: 16,
      remainingEvBudget: 50,
      passed: true,
      bottleneckLabel: "シナリオA +7.9%",
      scenarioResults: [
        {
          scenarioId: scenario.id,
          passed: true,
          survivalProbability: 0.829,
          requiredSurvivedHits: scenario.constraint.requiredSurvivedHits,
          minSurvivalProbability: scenario.constraint.minSurvivalProbability,
          bottleneckLabel: "シナリオA +7.9%",
          hitEvaluations: [
            {
              hitId: scenario.hits[0].id,
              damageRolls: [42, 43, 45],
              damageRange: { min: 42, max: 45, percentMin: 18.8, percentMax: 20.1 },
              description: "M3 adapter will fill this from @smogon/calc",
            },
          ],
        },
      ],
    };

    expect(defender.pokemon.canonicalName).toBe("Pikachu");
    expect(scenario.hits[0].move.canonicalName).toBe("Earthquake");
    expect(candidate.candidate).toEqual({ hp: 12, def: 4, spd: 0 });
    expect(candidate.scenarioResults[0]).toMatchObject({
      scenarioId: "scenario-a",
      passed: true,
      minSurvivalProbability: 0.75,
    });
  });
});
