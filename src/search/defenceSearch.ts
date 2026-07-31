import { calculateSmogonHit, toSmogonPokemon } from "../calc/smogonAdapter";
import {
  getHpSequenceSurvivalProbability,
  simulateHpSequence,
  type HpSequenceCard,
  type HpSequenceMoveUse,
} from "../calc/simulateHpSequence";
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
  DefenceSearchStatKey,
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
const LEGACY_SHOWDOWN_EV_BUDGET = 508;

const DEFENCE_SEARCH_KEYS = ["hp", "def", "spd"] as const satisfies readonly DefenceSearchStatKey[];
const FIXED_EV_KEYS = ["atk", "spa", "spe"] as const satisfies readonly StatKey[];
const ALL_STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];

export type CalculateHit = (
  defenderBuild: Build,
  hit: ScenarioHit,
  fieldState: FieldState,
) => ScenarioHitEvaluation;

export interface DefenceSearchOptions {
  maxResults?: number | null;
  calculateHit?: CalculateHit;
  minimumStatPoints?: Partial<StatTable>;
  searchStatKeys?: readonly DefenceSearchStatKey[] | null;
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

const isLegalDefenceCandidate = (candidate: DefenceStatPointCandidate): boolean =>
  DEFENCE_SEARCH_KEYS.every((key) => isLegalStatPointValue(candidate[key]));

const getCandidateDefenceBudget = (candidate: DefenceStatPointCandidate): number =>
  candidate.hp + candidate.def + candidate.spd;

export const normalizeDefenceSearchStatKeys = (
  searchStatKeys?: readonly DefenceSearchStatKey[] | null,
): DefenceSearchStatKey[] => {
  if (searchStatKeys === undefined || searchStatKeys === null) {
    return [...DEFENCE_SEARCH_KEYS];
  }

  const requested = new Set(searchStatKeys);
  return DEFENCE_SEARCH_KEYS.filter((key) => requested.has(key));
};

export const meetsMinimumStatPointRequirements = (
  candidate: DefenceStatPointCandidate,
  minimumStatPoints: Partial<StatTable> = {},
): boolean => DEFENCE_SEARCH_KEYS.every((key) => (
  candidate[key] >= (minimumStatPoints[key] ?? 0)
));

export function* iterateDefenceEvCandidates(
  build: Build,
  options: Pick<DefenceSearchOptions, "searchStatKeys"> = {},
): Generator<DefenceStatPointCandidate> {
  const buildStatPoints = getBuildStatPoints(build);
  if (!ALL_STAT_KEYS.every((key) => isLegalStatPointValue(buildStatPoints[key]))) {
    return;
  }

  const searchStatKeys = normalizeDefenceSearchStatKeys(options.searchStatKeys);
  const searchStatKeySet = new Set<DefenceSearchStatKey>(searchStatKeys);
  const fixedBudget = ALL_STAT_KEYS.reduce(
    (total, key) => total + (searchStatKeySet.has(key as DefenceSearchStatKey) ? 0 : buildStatPoints[key]),
    0,
  );
  const remainingBudget = CHAMPIONS_TOTAL_STAT_POINTS - fixedBudget;
  if (remainingBudget < 0) {
    return;
  }

  if (searchStatKeys.length === 0) {
    const candidate = {
      hp: buildStatPoints.hp,
      def: buildStatPoints.def,
      spd: buildStatPoints.spd,
    };
    if (isLegalDefenceCandidate(candidate)) {
      yield candidate;
    }
    return;
  }

  const maxSearchBudget = Math.min(remainingBudget, CHAMPIONS_MAX_STAT_POINTS_PER_STAT * searchStatKeys.length);

  function* assignSearchStats(
    keyIndex: number,
    remainingTotal: number,
    assigned: DefenceStatPointCandidate,
  ): Generator<DefenceStatPointCandidate> {
    const key = searchStatKeys[keyIndex];
    const isLastKey = keyIndex === searchStatKeys.length - 1;
    const maxValue = Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT, remainingTotal);

    if (isLastKey) {
      if (remainingTotal <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT) {
        yield { ...assigned, [key]: remainingTotal };
      }
      return;
    }

    for (let value = 0; value <= maxValue; value += 1) {
      yield* assignSearchStats(keyIndex + 1, remainingTotal - value, {
        ...assigned,
        [key]: value,
      });
    }
  }

  const baseCandidate = {
    hp: buildStatPoints.hp,
    def: buildStatPoints.def,
    spd: buildStatPoints.spd,
  };

  for (let total = 0; total <= maxSearchBudget; total += 1) {
    for (const candidate of assignSearchStats(0, total, baseCandidate)) {
      if (isLegalDefenceCandidate(candidate)) {
        yield candidate;
      }
    }
  }
}

export const enumerateDefenceEvCandidates = (
  build: Build,
  options: Pick<DefenceSearchOptions, "searchStatKeys"> = {},
): DefenceStatPointCandidate[] =>
  Array.from(iterateDefenceEvCandidates(build, options));

export const countDefenceEvCandidates = (
  build: Build,
  options: Pick<DefenceSearchOptions, "searchStatKeys"> = {},
): number => {
  let count = 0;
  for (const _candidate of iterateDefenceEvCandidates(build, options)) {
    count += 1;
  }
  return count;
};

const getMoveUses = (
  hit: ScenarioHit,
  evaluation: ScenarioHitEvaluation,
): HpSequenceMoveUse[] => {
  const repeat = Math.max(0, Math.trunc(hit.repeat));
  const damageRollsByMove = evaluation.damageRollsByHit ?? [evaluation.damageRolls];

  if (hit.moveHits !== undefined) {
    return [{
      id: `${hit.id}-move-1`,
      damageRollsByHit: damageRollsByMove.slice(0, repeat),
    }];
  }

  return Array.from({ length: repeat }, (_value, index) => ({
    id: `${hit.id}-move-${index + 1}`,
    damageRollsByHit: damageRollsByMove,
  }));
};

const getDirectDamageRolls = (
  hit: ScenarioHit,
  evaluation: ScenarioHitEvaluation,
): number[][] => getMoveUses(hit, evaluation)
  .flatMap((moveUse) => moveUse.damageRollsByHit.map((rolls) => [...rolls]));

const buildHpSequenceCards = (
  defenderBuild: Build,
  scenario: Scenario,
  hitEvaluations: ScenarioHitEvaluation[],
): HpSequenceCard[] => {
  const evaluationsByHitId = new Map(hitEvaluations.map((evaluation) => [evaluation.hitId, evaluation]));
  return scenario.hits.flatMap((hit) => {
    const evaluation = evaluationsByHitId.get(hit.id);
    if (!evaluation) {
      return [];
    }

    return [{
      id: hit.id,
      attackerBuild: hit.attacker,
      defenderBuild: hit.defenderStatus
        ? { ...defenderBuild, status: hit.defenderStatus }
        : defenderBuild,
      moveUses: getMoveUses(hit, evaluation),
      hpEvents: hit.hpEvents,
      field: hit.field ?? scenario.field,
    }];
  });
};

const getCardDirectHitCount = (card: HpSequenceCard): number =>
  card.moveUses.reduce((total, moveUse) => total + moveUse.damageRollsByHit.length, 0);

const getSequenceDirectHitCount = (cards: readonly HpSequenceCard[]): number =>
  cards.reduce((total, card) => total + getCardDirectHitCount(card), 0);

const sliceHpSequenceCards = (
  cards: readonly HpSequenceCard[],
  requiredDirectHits: number,
): HpSequenceCard[] => {
  let remainingHits = Math.max(0, Math.trunc(requiredDirectHits));
  const prefix: HpSequenceCard[] = [];

  for (const card of cards) {
    if (remainingHits <= 0) {
      break;
    }

    const cardHitCount = getCardDirectHitCount(card);
    if (remainingHits >= cardHitCount) {
      prefix.push(card);
      remainingHits -= cardHitCount;
      continue;
    }

    const moveUses: HpSequenceMoveUse[] = [];
    for (const moveUse of card.moveUses) {
      if (remainingHits <= 0) {
        break;
      }

      const hitCount = moveUse.damageRollsByHit.length;
      if (remainingHits >= hitCount) {
        moveUses.push(moveUse);
        remainingHits -= hitCount;
        continue;
      }

      moveUses.push({
        ...moveUse,
        damageRollsByHit: moveUse.damageRollsByHit.slice(0, remainingHits),
        completed: false,
      });
      remainingHits = 0;
    }

    prefix.push({
      ...card,
      moveUses,
      completed: false,
    });
  }

  return prefix;
};

const calculateScenarioSequence = (
  defenderBuild: Build,
  cards: readonly HpSequenceCard[],
  requiredDirectHits: number,
): {
  survivalProbability: number;
  hpEventEvaluations: NonNullable<ScenarioEvaluation["hpEventEvaluations"]>;
} => {
  if (requiredDirectHits <= 0) {
    return {
      survivalProbability: 1,
      hpEventEvaluations: [],
    };
  }

  const simulation = simulateHpSequence({
    cards: sliceHpSequenceCards(cards, requiredDirectHits),
  });
  return {
    survivalProbability: getHpSequenceSurvivalProbability(simulation, defenderBuild.id),
    hpEventEvaluations: simulation.hpEventEvaluations,
  };
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
    const evaluation = evaluationsByHitId.get(hit.id);
    if (!evaluation) {
      continue;
    }

    sequence.push(...getDirectDamageRolls(hit, evaluation));

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

const expandDamageSequence = (
  scenario: Scenario,
  hitEvaluations: ScenarioHitEvaluation[],
): number[][] => {
  const evaluationsByHitId = new Map(hitEvaluations.map((evaluation) => [evaluation.hitId, evaluation]));
  return scenario.hits.flatMap((hit) => {
    const evaluation = evaluationsByHitId.get(hit.id);
    if (!evaluation) {
      return [];
    }

    return getDirectDamageRolls(hit, evaluation);
  });
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

export const getCandidateWorstMargin = (result: CandidateResult): number => {
  const worstScenario = getWorstScenarioEvaluation(result.scenarioResults);
  return worstScenario ? getScenarioMargin(worstScenario) : 0;
};

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
  const hpSequenceCards = buildHpSequenceCards(defenderBuild, scenario, hitEvaluations);
  const totalDirectHits = getSequenceDirectHitCount(hpSequenceCards);
  const hasEnabledHpEvents = hpSequenceCards.some((card) => (
    card.hpEvents?.some((event) => event.enabled) ?? false
  ));
  const defenderMaxHp = hasEnabledHpEvents
    ? undefined
    : toSmogonPokemon(defenderBuild).maxHP();

  if (checkpoints.length > 0) {
    const checkpointResults = checkpoints.map((checkpoint) => {
      if (checkpoint.requiredSurvivedHits > checkpoint.damageSequence.length) {
        return {
          ...checkpoint,
          passed: false,
          survivalProbability: 0,
          hpEventEvaluations: [],
          margin: -checkpoint.minSurvivalProbability,
        };
      }

      const sequenceResult = hasEnabledHpEvents
        ? calculateScenarioSequence(
            defenderBuild,
            hpSequenceCards,
            checkpoint.requiredSurvivedHits,
          )
        : {
            survivalProbability: checkpoint.requiredSurvivedHits === 0
              ? 1
              : calculateSurvivalProbability(
                  defenderMaxHp ?? 0,
                  checkpoint.damageSequence.slice(0, checkpoint.requiredSurvivedHits),
                ),
            hpEventEvaluations: [],
          };
      const { survivalProbability } = sequenceResult;

      return {
        ...checkpoint,
        hpEventEvaluations: sequenceResult.hpEventEvaluations,
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
      ...(worstCheckpoint.hpEventEvaluations.length > 0
        ? { hpEventEvaluations: worstCheckpoint.hpEventEvaluations }
        : {}),
      bottleneckLabel: formatMarginLabel(label, worstCheckpoint.margin),
    };
  }

  if (requiredSurvivedHits > totalDirectHits) {
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

  const sequenceResult = hasEnabledHpEvents
    ? calculateScenarioSequence(
        defenderBuild,
        hpSequenceCards,
        requiredSurvivedHits,
      )
    : {
        survivalProbability: requiredSurvivedHits === 0
          ? 1
          : calculateSurvivalProbability(
              defenderMaxHp ?? 0,
              damageSequence.slice(0, requiredSurvivedHits),
            ),
        hpEventEvaluations: [],
      };
  const { survivalProbability } = sequenceResult;
  const margin = survivalProbability - minSurvivalProbability;

  return {
    scenarioId: scenario.id,
    passed: survivalProbability + SURVIVAL_EPSILON >= minSurvivalProbability,
    survivalProbability,
    requiredSurvivedHits,
    minSurvivalProbability,
    hitEvaluations,
    ...(sequenceResult.hpEventEvaluations.length > 0
      ? { hpEventEvaluations: sequenceResult.hpEventEvaluations }
      : {}),
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

  const leftWorstMargin = getCandidateWorstMargin(left);
  const rightWorstMargin = getCandidateWorstMargin(right);
  if (leftWorstMargin !== rightWorstMargin) {
    return rightWorstMargin - leftWorstMargin;
  }

  return right.candidate.hp - left.candidate.hp;
};

export const compareFailureCandidateResults = (left: CandidateResult, right: CandidateResult): number => {
  const leftWorstMargin = getCandidateWorstMargin(left);
  const rightWorstMargin = getCandidateWorstMargin(right);
  if (leftWorstMargin !== rightWorstMargin) {
    return rightWorstMargin - leftWorstMargin;
  }

  return compareCandidateResults(left, right);
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
  const remainingEvBudget = Math.max(0, LEGACY_SHOWDOWN_EV_BUDGET - usedEvBudget);
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
  const maxResults = options.maxResults === undefined ? DEFAULT_MAX_RESULTS : options.maxResults;
  const topCandidates = passingResults
    .filter((result) => meetsMinimumStatPointRequirements(result.candidate, options.minimumStatPoints))
    .sort(compareCandidateResults)
    .slice(0, maxResults === null ? undefined : maxResults);
  const revalidatedCandidates = topCandidates
    .map((result) => evaluateCandidate(defenderBuild, scenarios, result.candidate, options))
    .filter((result) => (
      result.passed
      && meetsMinimumStatPointRequirements(result.candidate, options.minimumStatPoints)
    ))
    .sort(compareCandidateResults)
    .slice(0, maxResults === null ? undefined : maxResults);

  return rankCandidateResults(revalidatedCandidates);
};

export const searchDefenceCandidates = (
  defenderBuild: Build,
  scenarios: Scenario[],
  options: DefenceSearchOptions = {},
): CandidateResult[] => {
  const maxResults = options.maxResults === undefined ? DEFAULT_MAX_RESULTS : options.maxResults;
  if (maxResults !== null && maxResults <= 0) {
    return [];
  }

  const passingResults: CandidateResult[] = [];
  let acceptedDefenceBudgetCeiling: number | null = null;

  for (const candidate of iterateDefenceEvCandidates(defenderBuild, options)) {
    const defenceBudget = getCandidateDefenceBudget(candidate);
    if (acceptedDefenceBudgetCeiling !== null && defenceBudget > acceptedDefenceBudgetCeiling) {
      break;
    }

    if (!meetsMinimumStatPointRequirements(candidate, options.minimumStatPoints)) {
      continue;
    }

    const result = evaluateCandidate(defenderBuild, scenarios, candidate, options);
    if (result.passed) {
      passingResults.push(result);
      if (
        maxResults !== null
        && passingResults.length >= maxResults
        && acceptedDefenceBudgetCeiling === null
      ) {
        acceptedDefenceBudgetCeiling = defenceBudget;
      }
    }
  }

  return finalizeDefenceSearchResults(defenderBuild, scenarios, passingResults, options);
};
