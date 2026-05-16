import { evaluateAttackScenario } from "../calc/evaluateAttackScenario";
import {
  STAT_KEYS,
  type BaseScenario,
  type Build,
  type Candidate,
  type ChampionsStatPoints,
  type DamageScenarioEvaluation,
  type DefenceConstraint,
  type Result,
  type SearchBudget,
  type StatTable,
} from "../domain/model";
import { sumStatPoints } from "../domain/statPoints";
import {
  budgetToEnumerationOptions,
  enumerateStatPoints,
  statPointKey,
} from "./enumerateStatPoints";
import { compareDefenceResults, defenceSpTotal } from "./scoring";

type DefenceEvaluator = (
  scenario: BaseScenario,
  constraint: DefenceConstraint,
) => DamageScenarioEvaluation;

export interface SearchDefenceInput {
  target: Build;
  scenarios: BaseScenario[];
  constraints: DefenceConstraint[];
  budget: SearchBudget;
  evaluateScenario?: DefenceEvaluator;
  maxResults?: number;
  coarseStep?: number;
  refineRadius?: number;
  clearSearchedFinalStatOverrides?: boolean;
}

const DEFENCE_STATS = ["hp", "def", "spd"] as const;
const FIXED_DURING_DEFENCE_SEARCH = ["atk", "spa", "spe"] as const;

const activeDefenceScenarios = (
  scenarios: BaseScenario[],
  constraints: DefenceConstraint[],
): Array<{ scenario: BaseScenario; constraint: DefenceConstraint }> => {
  const constraintsByScenario = new Map(
    constraints.map((constraint) => [constraint.scenarioId, constraint]),
  );

  return scenarios
    .filter((scenario) => scenario.enabled && scenario.kind === "defence" && scenario.move)
    .map((scenario) => ({
      scenario,
      constraint: constraintsByScenario.get(scenario.id),
    }))
    .filter(
      (entry): entry is { scenario: BaseScenario; constraint: DefenceConstraint } =>
        entry.constraint?.type === "survive",
    );
};

const fixedForDefenceSearch = (
  target: Build,
  budget: SearchBudget,
): Partial<ChampionsStatPoints> => {
  const fixed: Partial<ChampionsStatPoints> = { ...budget.fixed };

  for (const stat of FIXED_DURING_DEFENCE_SEARCH) {
    fixed[stat] = target.statPoints[stat];
  }

  return fixed;
};

const omitSearchedFinalStats = (build: Build): Build => {
  const finalStats = build.manualOverrides?.finalStats;

  if (!finalStats) {
    return build;
  }

  const nextFinalStats: Partial<StatTable> = { ...finalStats };
  delete nextFinalStats.hp;
  delete nextFinalStats.def;
  delete nextFinalStats.spd;

  if (Object.keys(nextFinalStats).length === Object.keys(finalStats).length) {
    return build;
  }

  return {
    ...build,
    manualOverrides: {
      ...build.manualOverrides,
      finalStats: Object.keys(nextFinalStats).length > 0 ? nextFinalStats : undefined,
    },
  };
};

const buildWithCandidate = (
  build: Build,
  targetId: string,
  statPoints: ChampionsStatPoints,
  clearSearchedFinalStatOverrides: boolean,
): Build => {
  if (build.id !== targetId) {
    return build;
  }

  const searchedBuild = clearSearchedFinalStatOverrides ? omitSearchedFinalStats(build) : build;

  return {
    ...searchedBuild,
    statPoints,
  };
};

const scenarioWithCandidate = (
  scenario: BaseScenario,
  targetId: string,
  statPoints: ChampionsStatPoints,
  clearSearchedFinalStatOverrides: boolean,
): BaseScenario => ({
  ...scenario,
  attacker: buildWithCandidate(
    scenario.attacker,
    targetId,
    statPoints,
    clearSearchedFinalStatOverrides,
  ),
  defender: buildWithCandidate(
    scenario.defender,
    targetId,
    statPoints,
    clearSearchedFinalStatOverrides,
  ),
});

const candidateFromPoints = (
  id: string,
  points: ChampionsStatPoints,
  budget: SearchBudget,
  phase: Candidate["searchPhase"],
): Candidate => {
  const totalSp = sumStatPoints(points);

  return {
    id,
    statPoints: points,
    totalSp,
    remainingSp: Math.max(budget.maxTotal - totalSp, 0),
    searchPhase: phase,
  };
};

const requiredProbability = (evaluation: DamageScenarioEvaluation): number =>
  evaluation.thresholdProbability ?? 0;

const bottleneckScenarioId = (evaluations: DamageScenarioEvaluation[]): string =>
  evaluations
    .map((evaluation) => ({
      evaluation,
      margin: evaluation.probability - requiredProbability(evaluation),
    }))
    .sort((left, right) => left.margin - right.margin)[0]?.evaluation.scenarioId ??
  evaluations[0].scenarioId;

const markdownForCandidate = (
  candidate: Candidate,
  evaluations: DamageScenarioEvaluation[],
  scenarios: BaseScenario[],
): string =>
  [
    `H${candidate.statPoints.hp}-A${candidate.statPoints.atk}-B${candidate.statPoints.def}-C${candidate.statPoints.spa}-D${candidate.statPoints.spd}-S${candidate.statPoints.spe}`,
    ...evaluations.map((evaluation) => {
      const scenario = scenarios.find((entry) => entry.id === evaluation.scenarioId);

      return `${scenario?.title ?? evaluation.scenarioId}: ${evaluation.passed ? "PASS" : "FAIL"} ${Math.round(evaluation.probability * 1000) / 10}%`;
    }),
  ].join(" / ");

const evaluateCandidate = (
  points: ChampionsStatPoints,
  input: Required<
    Pick<
      SearchDefenceInput,
      "evaluateScenario" | "maxResults" | "clearSearchedFinalStatOverrides"
    >
  > &
    SearchDefenceInput,
  activeScenarios: Array<{ scenario: BaseScenario; constraint: DefenceConstraint }>,
  phase: Candidate["searchPhase"],
  id: string,
): Result | undefined => {
  const evaluations = activeScenarios.map(({ scenario, constraint }) =>
    input.evaluateScenario(
      scenarioWithCandidate(
        scenario,
        input.target.id,
        points,
        input.clearSearchedFinalStatOverrides,
      ),
      constraint,
    ),
  );

  if (!evaluations.every((evaluation) => evaluation.passed)) {
    return undefined;
  }

  const candidate = candidateFromPoints(id, points, input.budget, phase);

  return {
    candidate,
    passed: true,
    score: defenceSpTotal({
      candidate,
      passed: true,
      score: 0,
      bottleneckScenarioId: evaluations[0].scenarioId,
      evaluations,
      markdownSummary: "",
    }),
    bottleneckScenarioId: bottleneckScenarioId(evaluations),
    evaluations,
    markdownSummary: markdownForCandidate(
      candidate,
      evaluations,
      activeScenarios.map((entry) => entry.scenario),
    ),
  };
};

const refinedNeighborhood = (
  seed: ChampionsStatPoints,
  budget: SearchBudget,
  fixed: Partial<ChampionsStatPoints>,
  radius: number,
): ChampionsStatPoints[] => {
  const lowerBounds = budget.lowerBounds;
  const maxPerStat = Math.min(budget.maxPerStat, 32);
  const hpValues =
    fixed.hp !== undefined
      ? [fixed.hp]
      : Array.from(
          {
            length:
              Math.min(maxPerStat, seed.hp + radius) -
              Math.max(lowerBounds.hp ?? 0, seed.hp - radius) +
              1,
          },
          (_, index) => Math.max(lowerBounds.hp ?? 0, seed.hp - radius) + index,
        );
  const defValues =
    fixed.def !== undefined
      ? [fixed.def]
      : Array.from(
          {
            length:
              Math.min(maxPerStat, seed.def + radius) -
              Math.max(lowerBounds.def ?? 0, seed.def - radius) +
              1,
          },
          (_, index) => Math.max(lowerBounds.def ?? 0, seed.def - radius) + index,
        );
  const spdValues =
    fixed.spd !== undefined
      ? [fixed.spd]
      : Array.from(
          {
            length:
              Math.min(maxPerStat, seed.spd + radius) -
              Math.max(lowerBounds.spd ?? 0, seed.spd - radius) +
              1,
          },
          (_, index) => Math.max(lowerBounds.spd ?? 0, seed.spd - radius) + index,
        );
  const points: ChampionsStatPoints[] = [];

  for (const hp of hpValues) {
    for (const def of defValues) {
      for (const spd of spdValues) {
        const candidate = {
          hp,
          atk: fixed.atk ?? seed.atk,
          def,
          spa: fixed.spa ?? seed.spa,
          spd,
          spe: fixed.spe ?? seed.spe,
        };

        if (STAT_KEYS.every((stat) => candidate[stat] >= (lowerBounds[stat] ?? 0))) {
          points.push(candidate);
        }
      }
    }
  }

  return points.filter((point) => sumStatPoints(point) <= budget.maxTotal);
};

export const searchDefence = (input: SearchDefenceInput): Result[] => {
  const normalizedInput = {
    ...input,
    evaluateScenario: input.evaluateScenario ?? evaluateAttackScenario,
    maxResults: input.maxResults ?? 12,
    clearSearchedFinalStatOverrides: input.clearSearchedFinalStatOverrides ?? true,
  };
  const activeScenarios = activeDefenceScenarios(input.scenarios, input.constraints);

  if (activeScenarios.length === 0) {
    return [];
  }

  const fixed = fixedForDefenceSearch(input.target, input.budget);
  const coarseStep =
    input.budget.mode === "precise" ? 1 : Math.max(1, Math.floor(input.coarseStep ?? 4));
  const refineRadius = input.refineRadius ?? Math.max(1, coarseStep - 1);
  const coarseResults: Result[] = [];
  const coarseOptions = budgetToEnumerationOptions(
    input.budget,
    fixed,
    DEFENCE_STATS,
    coarseStep,
  );

  for (const points of enumerateStatPoints(coarseOptions)) {
    const result = evaluateCandidate(
      points,
      normalizedInput,
      activeScenarios,
      "coarse",
      `defence-coarse-${coarseResults.length + 1}`,
    );

    if (result) {
      coarseResults.push(result);
    }
  }

  const candidatePoints =
    input.budget.mode === "precise"
      ? coarseResults.map((result) => result.candidate.statPoints)
      : coarseResults
          .sort(compareDefenceResults)
          .slice(0, normalizedInput.maxResults * 2)
          .flatMap((result) =>
            refinedNeighborhood(
              result.candidate.statPoints,
              input.budget,
              fixed,
              refineRadius,
            ),
          );
  const seen = new Set<string>();
  const refinedResults: Result[] = [];

  for (const points of candidatePoints) {
    const key = statPointKey(points);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    const result = evaluateCandidate(
      points,
      normalizedInput,
      activeScenarios,
      "refined",
      `defence-refined-${refinedResults.length + 1}`,
    );

    if (result) {
      refinedResults.push(result);
    }
  }

  return refinedResults
    .sort(compareDefenceResults)
    .slice(0, normalizedInput.maxResults)
    .map((result, index) => {
      const verified = evaluateCandidate(
        result.candidate.statPoints,
        normalizedInput,
        activeScenarios,
        "final-verified",
        `defence-${index + 1}`,
      );

      if (!verified) {
        throw new Error(`Final defence verification failed for ${result.candidate.id}`);
      }

      return verified;
    });
};
