import type {
  BaseScenario,
  Constraint,
  DamageEvaluationCheck,
  DamageScenarioEvaluation,
} from "../domain/model";
import { evaluateDamageScenario } from "./smogonAdapter";

const clampHits = (hits?: number): number => {
  if (!hits || hits < 1) {
    return 1;
  }

  return Math.floor(hits);
};

const damageSumDistribution = (rolls: number[], hits: number): Map<number, number> => {
  let distribution = new Map<number, number>([[0, 1]]);

  for (let hit = 0; hit < hits; hit += 1) {
    const next = new Map<number, number>();

    for (const [currentDamage, count] of distribution.entries()) {
      for (const roll of rolls) {
        const totalDamage = currentDamage + roll;
        next.set(totalDamage, (next.get(totalDamage) ?? 0) + count);
      }
    }

    distribution = next;
  }

  return distribution;
};

const probabilityFromDistribution = (
  distribution: Map<number, number>,
  predicate: (totalDamage: number) => boolean,
): number => {
  let passed = 0;
  let total = 0;

  for (const [damage, count] of distribution.entries()) {
    total += count;

    if (predicate(damage)) {
      passed += count;
    }
  }

  return total === 0 ? 0 : passed / total;
};

const fixedDamageBeforeHits = (scenario: BaseScenario, defenderHp: number): number => {
  const maxHpRatio = scenario.field.hazardDamage?.maxHpRatio;

  if (!maxHpRatio) {
    return 0;
  }

  return Math.floor(defenderHp * maxHpRatio);
};

const resolveCheck = (
  constraint?: Constraint,
): {
  check: DamageEvaluationCheck;
  hits: number;
  thresholdProbability?: number;
} => {
  if (constraint?.type === "survive") {
    return {
      check: "survive",
      hits: clampHits(constraint.hits),
      thresholdProbability: constraint.minSurvivalRate,
    };
  }

  if (constraint?.type === "ko") {
    return {
      check: "ko",
      hits: clampHits(constraint.hits),
      thresholdProbability: constraint.minKoRate,
    };
  }

  return {
    check: "raw-damage",
    hits: 1,
  };
};

const checkLabel = (check: DamageEvaluationCheck): string => {
  if (check === "survive") {
    return "生存";
  }

  if (check === "ko") {
    return "KO";
  }

  return "ダメージ";
};

export const evaluateAttackScenario = (
  scenario: BaseScenario,
  constraint?: Constraint,
): DamageScenarioEvaluation => {
  const damageResult = evaluateDamageScenario(scenario);
  const { check, hits, thresholdProbability } = resolveCheck(
    constraint?.scenarioId === scenario.id ? constraint : undefined,
  );
  const distribution = damageSumDistribution(damageResult.damageRolls, hits);
  const fixedDamage = fixedDamageBeforeHits(scenario, damageResult.defenderHp);
  const probability =
    check === "survive"
      ? probabilityFromDistribution(
          distribution,
          (totalDamage) => fixedDamage + totalDamage < damageResult.defenderHp,
        )
      : check === "ko"
        ? probabilityFromDistribution(
            distribution,
            (totalDamage) => fixedDamage + totalDamage >= damageResult.defenderHp,
          )
        : 1;
  const passed = thresholdProbability === undefined ? true : probability >= thresholdProbability;

  return {
    scenarioId: scenario.id,
    evaluationKind: "damage",
    check,
    passed,
    probability,
    damageRolls: damageResult.damageRolls,
    damageRange: damageResult.damageRange,
    defenderHp: damageResult.defenderHp,
    hits,
    thresholdProbability,
    engineDescription: damageResult.description,
    explanation:
      `${hits} hit ${checkLabel(check)} check: ${Math.round(probability * 1000) / 10}%` +
      (thresholdProbability === undefined
        ? ""
        : ` / required ${Math.round(thresholdProbability * 1000) / 10}%`),
  };
};
