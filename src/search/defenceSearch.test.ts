import { describe, expect, it } from "vitest";
import { calculateSmogonHit } from "../calc/smogonAdapter";
import type { EntityKind } from "../data/localizationTypes";
import type { Build, EntityRef, FieldState, Scenario, ScenarioHit, SideState, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  calculateSurvivalProbability,
  enumerateDefenceEvCandidates,
  evaluateCandidate,
  evaluateScenario,
  searchDefenceCandidates,
  type CalculateHit,
} from "./defenceSearch";

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

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
};

const emptyField: FieldState = {
  gameType: "singles",
  weather: "none",
  terrain: "none",
};

const makeBuild = (
  id: string,
  pokemonInput: string,
  evs: StatTable = zeroEvs,
  level = 50,
  natureInput?: string,
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemonInput),
  level,
  nature: natureInput ? mustResolve("nature", natureInput) : undefined,
  ivs: defaultIvs,
  evs,
});

const makeHit = (
  id: string,
  attacker: Build,
  moveInput: string,
  repeat = 1,
): ScenarioHit => ({
  id,
  attacker,
  move: mustResolve("move", moveInput),
  repeat,
  critical: false,
  attackerBoosts: {},
  defenderBoosts: {},
  attackerSide: emptySide,
  defenderSide: emptySide,
});

const makeScenario = (
  id: string,
  hits: ScenarioHit[],
  requiredSurvivedHits: number,
  minSurvivalProbability: number,
): Scenario => ({
  id,
  label: id,
  enabled: true,
  hits,
  field: emptyField,
  constraint: {
    enabled: true,
    requiredSurvivedHits,
    minSurvivalProbability,
  },
});

describe("enumerateDefenceEvCandidates", () => {
  it("enumerates only legal H/B/D SP candidates and counts fixed A/C/S SP in the total budget", () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });

    const candidates = enumerateDefenceEvCandidates(defender);

    expect(candidates).toEqual(
      expect.arrayContaining([
        { hp: 0, def: 0, spd: 0 },
        { hp: 1, def: 0, spd: 0 },
        { hp: 0, def: 1, spd: 0 },
        { hp: 0, def: 0, spd: 1 },
        { hp: 2, def: 0, spd: 0 },
      ]),
    );
    expect(candidates).toHaveLength(10);
    expect(candidates.every((candidate) => (
      [candidate.hp, candidate.def, candidate.spd].every((sp) => sp >= 0 && sp <= 32)
      && candidate.hp + candidate.def + candidate.spd + 64 <= 66
    ))).toBe(true);
  });
});

describe("calculateSurvivalProbability", () => {
  it("treats each repeated hit as an independent damage roll from the same HP pool", () => {
    expect(calculateSurvivalProbability(101, [[50], [50]])).toBe(1);
    expect(calculateSurvivalProbability(100, [[50], [50]])).toBe(0);
    expect(calculateSurvivalProbability(101, [[40, 60], [40, 60]])).toBe(0.75);
  });
});

describe("evaluateScenario", () => {
  it("uses ScenarioHit.repeat for continuous survival probability and fails below minSurvivalProbability", () => {
    const defender = makeBuild("target", "カイリュー");
    const attacker = makeBuild("attacker", "ピカチュウ", { ...zeroEvs, spa: 252 }, 50, "ひかえめ");
    const singleHit = makeScenario("single", [makeHit("thunderbolt", attacker, "10まんボルト", 1)], 1, 1);
    const repeatedHit = makeScenario("repeat", [makeHit("thunderbolt", attacker, "10まんボルト", 3)], 3, 0.99);

    const singleResult = evaluateScenario(defender, singleHit);
    const repeatedResult = evaluateScenario(defender, repeatedHit);

    expect(singleResult).toMatchObject({ passed: true, survivalProbability: 1 });
    expect(repeatedResult.passed).toBe(false);
    expect(repeatedResult.survivalProbability).toBeGreaterThan(0);
    expect(repeatedResult.survivalProbability).toBeLessThan(0.99);
    expect(repeatedResult.hitEvaluations[0].description).toContain("Thunderbolt");
  });

  it("passes hit-specific field state to the damage adapter", () => {
    const defender = makeBuild("target", "カイリュー");
    const attacker = makeBuild("attacker", "ピカチュウ");
    const hit = {
      ...makeHit("field-hit", attacker, "10まんボルト"),
      field: { gameType: "doubles", weather: "rain", terrain: "electric" } as FieldState,
    };
    const scenario = makeScenario("field", [hit], 1, 1);
    const fields: FieldState[] = [];

    evaluateScenario(defender, scenario, {
      calculateHit: (_build, currentHit, field) => {
        fields.push(field);
        return {
          hitId: currentHit.id,
          damageRolls: [1],
          damageRange: { min: 1, max: 1, percentMin: 1, percentMax: 1 },
        };
      },
    });

    expect(fields).toEqual([{ gameType: "doubles", weather: "rain", terrain: "electric" }]);
  });

  it("evaluates hit-specific survival constraints against cumulative damage", () => {
    const defender = makeBuild("target", "カイリュー");
    const attacker = makeBuild("attacker", "ピカチュウ");
    const firstHit = {
      ...makeHit("first-hit", attacker, "10まんボルト"),
      constraint: { enabled: true, requiredSurvivedHits: 1, minSurvivalProbability: 1 },
    };
    const secondHit = {
      ...makeHit("second-hit", attacker, "10まんボルト"),
      constraint: { enabled: true, requiredSurvivedHits: 2, minSurvivalProbability: 1 },
    };
    const scenario = makeScenario("cumulative-cards", [firstHit, secondHit], 1, 1);

    const result = evaluateScenario(defender, scenario, {
      calculateHit: (_build, hit) => ({
        hitId: hit.id,
        damageRolls: hit.id === "first-hit" ? [1] : [999],
        damageRange: { min: 1, max: 999, percentMin: 1, percentMax: 999 },
      }),
    });

    expect(result).toMatchObject({
      passed: false,
      requiredSurvivedHits: 2,
      minSurvivalProbability: 1,
      survivalProbability: 0,
    });
  });
});

describe("evaluateCandidate", () => {
  it("fails the whole candidate if any enabled scenario fails", () => {
    const defender = makeBuild("target", "カイリュー");
    const easyAttacker = makeBuild("easy-attacker", "ピカチュウ", zeroEvs, 1);
    const hardAttacker = makeBuild("hard-attacker", "ガブリアス", { ...zeroEvs, atk: 252 }, 50, "ようき");
    const easyScenario = makeScenario("easy", [makeHit("easy-hit", easyAttacker, "10まんボルト")], 1, 1);
    const hardScenario = makeScenario("hard", [makeHit("hard-hit", hardAttacker, "げきりん")], 1, 1);

    const result = evaluateCandidate(defender, [easyScenario, hardScenario], { hp: 0, def: 0, spd: 0 });

    expect(result.passed).toBe(false);
    expect(result.scenarioResults.map((scenario) => scenario.passed)).toEqual([true, false]);
  });
});

describe("searchDefenceCandidates", () => {
  it("evaluates one H/B/D candidate against every scenario through the M3 adapter and revalidates final candidates", () => {
    const defender = makeBuild("target", "カイリュー");
    const specialAttacker = makeBuild("special-attacker", "ピカチュウ", { ...zeroEvs, spa: 252 }, 50, "ひかえめ");
    const physicalAttacker = makeBuild("physical-attacker", "ガブリアス", zeroEvs, 1);
    const scenarios = [
      makeScenario("special", [makeHit("special-hit", specialAttacker, "10まんボルト")], 1, 1),
      makeScenario("physical", [makeHit("physical-hit", physicalAttacker, "げきりん")], 1, 1),
    ];
    const hitIds: string[] = [];
    const calculateHit: CalculateHit = (build, hit, field) => {
      hitIds.push(hit.id);
      return calculateSmogonHit(build, hit, field);
    };

    const results = searchDefenceCandidates(defender, scenarios, { maxResults: 1, calculateHit });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      rank: 1,
      candidate: { hp: 0, def: 0, spd: 0 },
      passed: true,
    });
    expect(results[0].scenarioResults).toHaveLength(2);
    expect(results[0].scenarioResults.every((scenario) => scenario.passed)).toBe(true);
    expect(hitIds).toEqual(["special-hit", "physical-hit", "special-hit", "physical-hit"]);
  });

  it("does not return candidates that fail final scenario validation", () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252, spe: 4 });
    const attacker = makeBuild("attacker", "ガブリアス", { ...zeroEvs, atk: 252 }, 50, "ようき");
    const impossibleScenario = makeScenario("impossible", [makeHit("outrage", attacker, "げきりん")], 1, 1);

    const results = searchDefenceCandidates(defender, [impossibleScenario], { maxResults: 5 });

    expect(results).toEqual([]);
  });

  it("filters passing candidates below integrated H/B/D minimum requirements", () => {
    const defender = makeBuild("target", "ピカチュウ");
    const scenario = makeScenario("easy", [makeHit("hit", makeBuild("attacker", "ピチュー"), "でんこうせっか")], 1, 1);
    const calculateHit: CalculateHit = () => ({
      hitId: "hit",
      damageRolls: [1],
      damageRange: { min: 1, max: 1, percentMin: 1, percentMax: 1 },
    });

    const results = searchDefenceCandidates(defender, [scenario], {
      maxResults: 3,
      calculateHit,
      minimumStatPoints: { hp: 2, def: 1 },
    });

    expect(results).not.toHaveLength(0);
    expect(results.every((result) => result.candidate.hp >= 2 && result.candidate.def >= 1)).toBe(true);
  });
});
