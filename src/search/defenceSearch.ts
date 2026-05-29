import { calculateSmogonHit, toSmogonPokemon } from "../calc/smogonAdapter";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  isLegalStatPointTable,
  isLegalStatPointValue,
  smogonEvTableToStatPoints,
  statPointTableToSmogonEvs,
  sumStatPoints,
} from "../domain/championsStats";
import type {
  Build,
  CandidateResult,
  DefenceStatPointCandidate,
  FieldState,
  Scenario,
  ScenarioEvaluation,
  ScenarioHit,
  ScenarioHitEvaluation,
  StatKey,
  StatTable,
} from "../domain/model";

const DEFAULT_MAX_RESULTS = 20;
const SURVIVAL_EPSILON = 1e-12;

const DEFENCE_SEARCH_KEYS = ["hp", "def", "spd"] as const satisfies readonly StatKey[];
const FIXED_EV_KEYS = ["atk", "spa", "spe"] as const satisfies readonly StatKey[];

export type CalculateHit = (
  defenderBuild: Build,
  hit: ScenarioHit,
  fieldState: FieldState,
) => ScenarioHitEvaluation;

export interface DefenceSearchOptions {
  maxResults?: number;
  calculateHit?: CalculateHit;
}

interface ScenarioEvaluationOptions {
  calculateHit?: CalculateHit;
}

const getCalculateHit = (calculateHit?: CalculateHit): CalculateHit => calculateHit ?? calculateSmogonHit;

const sumNumbers = (values: Iterable<number>): number => {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  return total;
};

export const sumEvs = (evs: StatTable): number => sumNumbers(Object.values(evs));

const smogonEvToPointForValidation = (ev: number): number | null => {
  if (!Number.isInteger(ev) || ev < 0 || ev > 252) {
    return null;
  }

  if (ev === 0) {
    return 0;
  }

  if ((ev - 4) % 8 !== 0) {
    return null;
  }

  const statPoints = ((ev - 4) / 8) + 1;
  return isLegalStatPointValue(statPoints) ? statPoints : null;
};

export const isLegalEvValue = (ev: number): boolean => {
  const convertedPoint = smogonEvToPointForValidation(ev);
  return convertedPoint !== null;
};

export const isLegalEvTable = (evs: StatTable): boolean =>
  isLegalStatPointTable(smogonEvTableToStatPoints(evs));

export const getBuildStatPoints = (build: Build): StatTable =>
  build.statPoints ?? smogonEvTableToStatPoints(build.evs);

export const getFixedEvBudget = (build: Build): number =>
  sumNumbers(FIXED_EV_KEYS.map((key) => statPointTableToSmogonEvs(getBuildStatPoints(build))[key]));

export const getFixedStatPointBudget = (build: Build): number =>
  sumNumbers(FIXED_EV_KEYS.map((key) => getBuildStatPoints(build)[key]));

export const applyDefenceStatPointCandidate = (
  build: Build,
  candidate: DefenceStatPointCandidate,
): Build => {
  const appliedStatPoints = {
    ...getBuildStatPoints(build),
    hp: candidate.hp,
    def: candidate.def,
    spd: candidate.spd,
  };

  return {
    ...build,
    statPoints: appliedStatPoints,
    evs: statPointTableToSmogonEvs(appliedStatPoints),
  };
};

export const applyDefenceEvCandidate = applyDefenceStatPointCandidate;

const isLegalFixedStatPointBudget = (build: Build): boolean =>
  FIXED_EV_KEYS.every((key) => isLegalStatPointValue(getBuildStatPoints(build)[key]));

const isLegalDefenceCandidate = (candidate: DefenceStatPointCandidate): boolean =>
  DEFENCE_SEARCH_KEYS.every((key) => isLegalStatPointValue(candidate[key]));

const getCandidateDefenceBudget = (candidate: DefenceStatPointCandidate): number =>
  candidate.hp + candidate.def + candidate.spd;

export function* iterateDefenceEvCandidates(build: Build): Generator<DefenceStatPointCandidate> {
  if (!isLegalFixedStatPointBudget(build)) {
    return;
  }

  const fixedBudget = getFixedStatPointBudget(build);
  const remainingBudget = CHAMPIONS_TOTAL_STAT_POINTS - fixedBudget;
  if (remainingBudget < 0) {
    return;
  }

  const maxSearchBudget = Math.min(remainingBudget, CHAMPIONS_MAX_STAT_POINTS_PER_STAT * DEFENCE_SEARCH_KEYS.length);

  for (let total = 0; total <= maxSearchBudget; total += 1) {
    for (let hp = 0; hp <= Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT, total); hp += 1) {
      for (let def = 0; def <= Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT, total - hp); def += 1) {
        const spd = total - hp - def;
        const candidate = { hp, def, spd };
        if (isLegalDefenceCandidate(candidate)) {
          yield candidate;
        }
      }
    }
  }
}

export const enumerateDefenceEvCandidates = (build: Build): DefenceStatPointCandidate[] =>
  Array.from(iterateDefenceEvCandidates(build));

export const countDefenceEvCandidates = (build: Build): number => {
  let count = 0;
  for (const _candidate of iterateDefenceEvCandidates(build)) {
    count += 1;
  }
  return count;
};

const getMaxHp = (build: Build): number => toSmogonPokemon(build).maxHP();

const expandDamageSequence = (
  scenario: Scenario,
  hitEvaluations: ScenarioHitEvaluation[],
): number[][] => {
  const evaluationsByHitId = new Map(hitEvaluations.map((evaluation) => [evaluation.hitId, evaluation]));
  const sequence: number[][] = [];

  for (const hit of scenario.hits) {
    const repeat = Math.max(0, Math.trunc(hit.repeat));
    const evaluation = evaluationsByHitId.get(hit.id);
    if (!evaluation) {
      continue;
    }

    for (let index = 0; index < repeat; index += 1) {
      sequence.push(evaluation.damageRolls);
    }
  }

  return sequence;
};

const expandDamageCheckpoints = (
  scenario: Scenario,
  hitEvaluations: ScenarioHitEvaluation[],
): Array<{
  requiredSurvivedHits: number;
  minSurvivalProbability: number;
  damageSequence: number[][];
}> => {
  const evaluationsByHitId = new Map(hitEvaluations.map((evaluation) => [evaluation.hitId, evaluation]));
  const sequence: number[][] = [];
  const checkpoints: Array<{
    requiredSurvivedHits: number;
    minSurvivalProbability: number;
    damageSequence: number[][];
  }> = [];

  for (const hit of scenario.hits) {
    const repeat = Math.max(0, Math.trunc(hit.repeat));
    const evaluation = evaluationsByHitId.get(hit.id);
    if (!evaluation) {
      continue;
    }

    for (let index = 0; index < repeat; index += 1) {
      sequence.push(evaluation.damageRolls);
    }

    if (hit.constraint?.enabled) {
      checkpoints.push({
        requiredSurvivedHits: Math.max(0, Math.trunc(hit.constraint.requiredSurvivedHits)),
        minSurvivalProbability: hit.constraint.minSurvivalProbability,
        damageSequence: [...sequence],
      });
    }
  }

  return checkpoints;
};

export const calculateSurvivalProbability = (
  maxHp: number,
  damageRollsByHit: readonly (readonly number[])[],
): number => {
  let aliveDistribution = new Map<number, number>([[0, 1]]);

  for (const damageRolls of damageRollsByHit) {
    const finiteRolls = damageRolls.filter(Number.isFinite);
    if (finiteRolls.length === 0) {
      return 0;
    }

    const rollProbability = 1 / finiteRolls.length;
    const nextDistribution = new Map<number, number>();

    for (const [currentDamage, currentProbability] of aliveDistribution) {
      for (const damage of finiteRolls) {
        const nextDamage = currentDamage + damage;
        if (nextDamage < maxHp) {
          nextDistribution.set(
            nextDamage,
            (nextDistribution.get(nextDamage) ?? 0) + currentProbability * rollProbability,
          );
        }
      }
    }

    aliveDistribution = nextDistribution;
    if (aliveDistribution.size === 0) {
      return 0;
    }
  }

  return sumNumbers(aliveDistribution.values());
};

const formatMarginLabel = (label: string, margin: number): string => {
  const sign = margin >= 0 ? "+" : "";
  return `${label} ${sign}${(margin * 100).toFixed(1)}%`;
};

const getScenarioMargin = (evaluation: ScenarioEvaluation): number =>
  evaluation.survivalProbability - evaluation.minSurvivalProbability;

const getWorstScenarioEvaluation = (evaluations: ScenarioEvaluation[]): ScenarioEvaluation | undefined =>
  evaluations.reduce<ScenarioEvaluation | undefined>((worst, evaluation) => {
    if (!worst || getScenarioMargin(evaluation) < getScenarioMargin(worst)) {
      return evaluation;
    }
    return worst;
  }, undefined);

export const evaluateScenario = (
  defenderBuild: Build,
  scenario: Scenario,
  options: ScenarioEvaluationOptions = {},
): ScenarioEvaluation => {
  const requiredSurvivedHits = Math.max(0, Math.trunc(scenario.constraint.requiredSurvivedHits));
  const minSurvivalProbability = scenario.constraint.minSurvivalProbability;
  const label = scenario.label || scenario.id;

  if (!scenario.enabled || !scenario.constraint.enabled) {
    return {
      scenarioId: scenario.id,
      passed: true,
      survivalProbability: 1,
      requiredSurvivedHits,
      minSurvivalProbability: 0,
      hitEvaluations: [],
      bottleneckLabel: `${label} disabled`,
    };
  }

  const calculateHit = getCalculateHit(options.calculateHit);
  const hitEvaluations = scenario.hits.map((hit) => calculateHit(defenderBuild, hit, hit.field ?? scenario.field));
  const checkpoints = expandDamageCheckpoints(scenario, hitEvaluations);
  const damageSequence = expandDamageSequence(scenario, hitEvaluations);

  if (checkpoints.length > 0) {
    const checkpointResults = checkpoints.map((checkpoint) => {
      if (checkpoint.requiredSurvivedHits > checkpoint.damageSequence.length) {
        return {
          ...checkpoint,
          passed: false,
          survivalProbability: 0,
          margin: -checkpoint.minSurvivalProbability,
        };
      }

      const survivalProbability = checkpoint.requiredSurvivedHits === 0
        ? 1
        : calculateSurvivalProbability(
            getMaxHp(defenderBuild),
            checkpoint.damageSequence.slice(0, checkpoint.requiredSurvivedHits),
          );

      return {
        ...checkpoint,
        survivalProbability,
        passed: survivalProbability + SURVIVAL_EPSILON >= checkpoint.minSurvivalProbability,
        margin: survivalProbability - checkpoint.minSurvivalProbability,
      };
    });
    const worstCheckpoint = checkpointResults.reduce((worst, checkpoint) => (
      checkpoint.margin < worst.margin ? checkpoint : worst
    ));

    return {
      scenarioId: scenario.id,
      passed: checkpointResults.every((checkpoint) => checkpoint.passed),
      survivalProbability: worstCheckpoint.survivalProbability,
      requiredSurvivedHits: worstCheckpoint.requiredSurvivedHits,
      minSurvivalProbability: worstCheckpoint.minSurvivalProbability,
      hitEvaluations,
      bottleneckLabel: formatMarginLabel(label, worstCheckpoint.margin),
    };
  }

  if (requiredSurvivedHits > damageSequence.length) {
    return {
      scenarioId: scenario.id,
      passed: false,
      survivalProbability: 0,
      requiredSurvivedHits,
      minSurvivalProbability,
      hitEvaluations,
      bottleneckLabel: `${label} missing hits`,
    };
  }

  const survivalProbability =
    requiredSurvivedHits === 0
      ? 1
      : calculateSurvivalProbability(getMaxHp(defenderBuild), damageSequence.slice(0, requiredSurvivedHits));
  const margin = survivalProbability - minSurvivalProbability;

  return {
    scenarioId: scenario.id,
    passed: survivalProbability + SURVIVAL_EPSILON >= minSurvivalProbability,
    survivalProbability,
    requiredSurvivedHits,
    minSurvivalProbability,
    hitEvaluations,
    bottleneckLabel: formatMarginLabel(label, margin),
  };
};

export const compareCandidateResults = (left: CandidateResult, right: CandidateResult): number => {
  const leftDefenceBudget = getCandidateDefenceBudget(left.candidate);
  const rightDefenceBudget = getCandidateDefenceBudget(right.candidate);
  if (leftDefenceBudget !== rightDefenceBudget) {
    return leftDefenceBudget - rightDefenceBudget;
  }

  if (left.remainingStatPointBudget !== right.remainingStatPointBudget) {
    return right.remainingStatPointBudget - left.remainingStatPointBudget;
  }

  const leftWorstMargin = getScenarioMargin(getWorstScenarioEvaluation(left.scenarioResults) ?? {
    scenarioId: "",
    passed: true,
    survivalProbability: 1,
    requiredSurvivedHits: 0,
    minSurvivalProbability: 0,
    hitEvaluations: [],
    bottleneckLabel: "",
  });
  const rightWorstMargin = getScenarioMargin(getWorstScenarioEvaluation(right.scenarioResults) ?? {
    scenarioId: "",
    passed: true,
    survivalProbability: 1,
    requiredSurvivedHits: 0,
    minSurvivalProbability: 0,
    hitEvaluations: [],
    bottleneckLabel: "",
  });
  if (leftWorstMargin !== rightWorstMargin) {
    return rightWorstMargin - leftWorstMargin;
  }

  return right.candidate.hp - left.candidate.hp;
};

export const rankCandidateResults = (results: CandidateResult[]): CandidateResult[] =>
  results.map((result, index) => ({
    ...result,
    id: `candidate-${index + 1}`,
    rank: index + 1,
  }));

export const evaluateCandidate = (
  defenderBuild: Build,
  scenarios: Scenario[],
  candidate: DefenceStatPointCandidate,
  options: DefenceSearchOptions = {},
): CandidateResult => {
  const appliedBuild = applyDefenceStatPointCandidate(defenderBuild, candidate);
  const scenarioResults = scenarios.map((scenario) => evaluateScenario(appliedBuild, scenario, options));
  const appliedStatPoints = getBuildStatPoints(appliedBuild);
  const usedStatPointBudget = sumStatPoints(appliedStatPoints);
  const remainingStatPointBudget = CHAMPIONS_TOTAL_STAT_POINTS - usedStatPointBudget;
  const usedEvBudget = sumEvs(appliedBuild.evs);
  const remainingEvBudget = remainingStatPointBudget;
  const worstScenario = getWorstScenarioEvaluation(scenarioResults);
  const appliedPointsAreLegal = isLegalStatPointTable(appliedStatPoints);

  return {
    id: "candidate-unranked",
    rank: 0,
    candidate,
    appliedStatPoints,
    appliedEvs: appliedBuild.evs,
    usedStatPointBudget,
    remainingStatPointBudget,
    usedEvBudget,
    remainingEvBudget,
    passed: appliedPointsAreLegal && scenarioResults.every((result) => result.passed),
    scenarioResults,
    bottleneckLabel: worstScenario?.bottleneckLabel ?? "No active scenarios",
  };
};

export const finalizeDefenceSearchResults = (
  defenderBuild: Build,
  scenarios: Scenario[],
  passingResults: CandidateResult[],
  options: DefenceSearchOptions = {},
): CandidateResult[] => {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const topCandidates = passingResults.sort(compareCandidateResults).slice(0, maxResults);
  const revalidatedCandidates = topCandidates
    .map((result) => evaluateCandidate(defenderBuild, scenarios, result.candidate, options))
    .filter((result) => result.passed)
    .sort(compareCandidateResults)
    .slice(0, maxResults);

  return rankCandidateResults(revalidatedCandidates);
};

export const searchDefenceCandidates = (
  defenderBuild: Build,
  scenarios: Scenario[],
  options: DefenceSearchOptions = {},
): CandidateResult[] => {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  if (maxResults <= 0) {
    return [];
  }

  const passingResults: CandidateResult[] = [];
  let acceptedDefenceBudgetCeiling: number | null = null;

  for (const candidate of iterateDefenceEvCandidates(defenderBuild)) {
    const defenceBudget = getCandidateDefenceBudget(candidate);
    if (acceptedDefenceBudgetCeiling !== null && defenceBudget > acceptedDefenceBudgetCeiling) {
      break;
    }

    const result = evaluateCandidate(defenderBuild, scenarios, candidate, options);
    if (result.passed) {
      passingResults.push(result);
      if (passingResults.length >= maxResults && acceptedDefenceBudgetCeiling === null) {
        acceptedDefenceBudgetCeiling = defenceBudget;
      }
    }
  }

  return finalizeDefenceSearchResults(defenderBuild, scenarios, passingResults, options);
};
