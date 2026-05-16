import { describe, expect, it } from "vitest";
import type {
  BaseScenario,
  Build,
  DamageScenarioEvaluation,
  DefenceConstraint,
  MoveRef,
  SearchBudget,
} from "../domain/model";
import { searchDefence } from "./searchDefence";

const perfectIvs = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const makeBuild = (id: string, showdownName: string): Build => ({
  id,
  label: showdownName,
  species: {
    id: showdownName.toLowerCase(),
    displayName: showdownName,
    showdownName,
    sourceStatus: "supported",
  },
  level: 50,
  nature: "Hardy",
  ivs: perfectIvs,
  statPoints: {
    hp: 0,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  },
});

const tackle: MoveRef = {
  id: "tackle",
  displayName: "たいあたり",
  showdownName: "Tackle",
  category: "Physical",
  typeName: "Normal",
  sourceStatus: "supported",
};

const target = makeBuild("target", "Pikachu");

const makeScenario = (id: string, attacker: Build): BaseScenario => ({
  id,
  kind: "defence",
  enabled: true,
  title: id,
  attacker,
  defender: target,
  move: tackle,
  field: {
    weather: "none",
    terrain: "none",
  },
  tags: [],
});

const scenarios = [
  makeScenario("physical-hit", makeBuild("physical-attacker", "Garchomp")),
  makeScenario("special-hit", makeBuild("special-attacker", "Flutter Mane")),
];

const constraints: DefenceConstraint[] = [
  {
    type: "survive",
    scenarioId: "physical-hit",
    hits: 1,
    minSurvivalRate: 1,
  },
  {
    type: "survive",
    scenarioId: "special-hit",
    hits: 1,
    minSurvivalRate: 1,
  },
];

const budget: SearchBudget = {
  maxPerStat: 3,
  maxTotal: 6,
  fixed: {},
  lowerBounds: {},
  mode: "precise",
};

const makeEvaluation = (
  scenario: BaseScenario,
  passed: boolean,
  probability: number,
): DamageScenarioEvaluation => ({
  scenarioId: scenario.id,
  evaluationKind: "damage",
  check: "survive",
  passed,
  probability,
  damageRolls: [1],
  damageRange: [1, 1],
  defenderHp: 10,
  hits: 1,
  thresholdProbability: 1,
  engineDescription: "mocked evaluator",
  explanation: "mocked evaluator",
});

describe("searchDefence", () => {
  it("returns only candidates that pass every enabled defence scenario", () => {
    const results = searchDefence({
      target,
      scenarios,
      constraints,
      budget,
      maxResults: 5,
      evaluateScenario: (scenario) => {
        const { hp, def, spd } = scenario.defender.statPoints;
        const probability =
          scenario.id === "physical-hit"
            ? hp + def >= 4
              ? 1
              : 0
            : hp + spd >= 5
              ? 1
              : 0;

        return makeEvaluation(scenario, probability === 1, probability);
      },
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.passed)).toBe(true);
    expect(results.every((result) => result.evaluations.every((evaluation) => evaluation.passed))).toBe(true);
    expect(results[0].candidate.statPoints).toMatchObject({
      hp: 3,
      def: 1,
      spd: 2,
    });
  });

  it("evaluates H/B/D together as one candidate and reuses the evaluator for final verification", () => {
    const calls: Array<{ scenarioId: string; hp: number; def: number; spd: number }> = [];
    const results = searchDefence({
      target,
      scenarios,
      constraints,
      budget,
      maxResults: 1,
      evaluateScenario: (scenario) => {
        const { hp, def, spd } = scenario.defender.statPoints;
        calls.push({ scenarioId: scenario.id, hp, def, spd });

        return makeEvaluation(scenario, hp === 2 && def === 2 && spd === 2, hp === 2 && def === 2 && spd === 2 ? 1 : 0);
      },
    });

    expect(results).toHaveLength(1);
    expect(results[0].candidate.searchPhase).toBe("final-verified");
    expect(results[0].candidate.statPoints).toMatchObject({ hp: 2, def: 2, spd: 2 });

    const finalCandidateCalls = calls.filter((call) => call.hp === 2 && call.def === 2 && call.spd === 2);
    expect(new Set(finalCandidateCalls.map((call) => call.scenarioId))).toEqual(
      new Set(["physical-hit", "special-hit"]),
    );
    expect(finalCandidateCalls.length).toBeGreaterThanOrEqual(6);
  });

  it("keeps searched SP authoritative by clearing H/B/D final-stat overrides by default", () => {
    const overriddenTarget: Build = {
      ...target,
      manualOverrides: {
        finalStats: {
          hp: 999,
          def: 999,
          spd: 999,
          spe: 123,
        },
      },
    };
    const overriddenScenarios = scenarios.map((scenario) => ({
      ...scenario,
      defender: overriddenTarget,
    }));
    const results = searchDefence({
      target: overriddenTarget,
      scenarios: overriddenScenarios,
      constraints,
      budget,
      maxResults: 1,
      evaluateScenario: (scenario) => {
        expect(scenario.defender.manualOverrides?.finalStats?.hp).toBeUndefined();
        expect(scenario.defender.manualOverrides?.finalStats?.def).toBeUndefined();
        expect(scenario.defender.manualOverrides?.finalStats?.spd).toBeUndefined();
        expect(scenario.defender.manualOverrides?.finalStats?.spe).toBe(123);

        return makeEvaluation(scenario, true, 1);
      },
    });

    expect(results).toHaveLength(1);
  });

  it("honors fixed H/B/D values during fast refinement", () => {
    const results = searchDefence({
      target,
      scenarios,
      constraints,
      budget: {
        ...budget,
        mode: "fast",
        fixed: {
          hp: 1,
          def: 2,
          spd: 3,
        },
      },
      maxResults: 3,
      evaluateScenario: (scenario) => makeEvaluation(scenario, true, 1),
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((result) => result.candidate.statPoints.hp === 1)).toBe(true);
    expect(results.every((result) => result.candidate.statPoints.def === 2)).toBe(true);
    expect(results.every((result) => result.candidate.statPoints.spd === 3)).toBe(true);
  });
});
