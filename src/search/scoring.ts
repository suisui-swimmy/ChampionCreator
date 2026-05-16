import type { DamageScenarioEvaluation, Result } from "../domain/model";

const requiredProbability = (evaluation: DamageScenarioEvaluation): number =>
  evaluation.thresholdProbability ?? 0;

export const defenceSpTotal = (result: Result): number => {
  const { hp, def, spd } = result.candidate.statPoints;

  return hp + def + spd;
};

export const bottleneckMargin = (result: Result): number =>
  result.evaluations.reduce((margin, evaluation) => {
    const damageEvaluation = evaluation as DamageScenarioEvaluation;

    return Math.min(margin, damageEvaluation.probability - requiredProbability(damageEvaluation));
  }, Number.POSITIVE_INFINITY);

export const compareDefenceResults = (left: Result, right: Result): number => {
  const defenceSpDelta = defenceSpTotal(left) - defenceSpTotal(right);

  if (defenceSpDelta !== 0) {
    return defenceSpDelta;
  }

  const remainingDelta = right.candidate.remainingSp - left.candidate.remainingSp;

  if (remainingDelta !== 0) {
    return remainingDelta;
  }

  const marginDelta = bottleneckMargin(right) - bottleneckMargin(left);

  if (marginDelta !== 0) {
    return marginDelta;
  }

  return right.candidate.statPoints.hp - left.candidate.statPoints.hp;
};
