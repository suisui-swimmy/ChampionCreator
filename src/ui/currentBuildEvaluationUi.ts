import { isLegalStatPointTable, isLegalStatPointValue } from "../domain/championsStats";
import { type StatBoostTable, type StatTable } from "../domain/model";
import { classifyCurrentBuildIssue, type CurrentBuildCondition, type CurrentBuildEvaluationInput, type CurrentBuildIssue } from "../search/currentBuildEvaluation";
import {
  buildOffenseSequenceCondition,
  buildDefenceSearchInput, buildOffenseAdjustmentInput, buildSpeedAdjustmentInput, buildTargetBuildFromUi,
  createOffenseAdjustmentFormFromScenarioAttack, formatScenarioAttackLabel,
  type ScenarioAttackFormState, type ScenarioFormState, type TargetFormState,
} from "./defenceSearchUi";

const validateNumbers = (statPoints: StatTable, level: number, boosts: StatBoostTable, enforceBudget = true) => {
  if (enforceBudget ? !isLegalStatPointTable(statPoints) : !Object.values(statPoints).every(isLegalStatPointValue)) {
    throw new Error(enforceBudget ? "SPは各能力0〜32、合計66以内で入力してください" : "仮想敵のSPは各能力0〜32で入力してください");
  }
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new Error("レベルは1〜100で入力してください");
  if (Object.values(boosts).some((value) => !Number.isInteger(value) || value < -6 || value > 6)) {
    throw new Error("能力ランクは-6〜6で入力してください");
  }
};
const validatePercent = (value: number) => {
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error("確率は0〜100%で入力してください");
};
const validateOpponent = (attack: ScenarioAttackFormState) => {
  // Opponent inputs model reference stats independently, including hidden axes.
  validateNumbers(attack.attackerStatPoints, attack.attackerLevel, attack.attackerBoosts, false);
};
const incomplete = (message: string): CurrentBuildIssue => ({ status: "incomplete", message });
/** Prepare canonical conditions only. Never run the integrated allocation/line search. */
export const buildCurrentBuildEvaluationInput = (
  target: TargetFormState,
  scenarios: readonly ScenarioFormState[],
): CurrentBuildEvaluationInput => {
  const conditions: CurrentBuildCondition[] = [];
  let build;
  try {
    if (!target.pokemonInput.trim()) return { conditions, issue: incomplete("調整対象のポケモンを入力してください") };
    validateNumbers(target.statPoints, target.level, target.boosts);
    build = buildTargetBuildFromUi(target);
  } catch (error) {
    return { conditions, issue: classifyCurrentBuildIssue(error) };
  }
  for (const scenario of scenarios.filter((entry) => entry.enabled)) {
    const base = { id: scenario.id, scenarioId: scenario.id, scenarioLabel: scenario.label, label: scenario.label, kind: scenario.adjustmentType };
    if (!scenario.attacks.length) {
      conditions.push({ ...base, issue: incomplete("条件を入力してください") });
      continue;
    }
    if (scenario.adjustmentType === "defence") {
      try {
        const damageAttacks = scenario.attacks;
        const missing = damageAttacks.find((attack) => !attack.moveInput.trim() || !attack.attackerPokemonInput.trim());
        if (!damageAttacks.length || missing) {
          conditions.push({ ...base, issue: incomplete(missing
            ? `${formatScenarioAttackLabel("defence", damageAttacks.indexOf(missing), missing.label)}のポケモンと技を入力してください`
            : "耐久を確認する攻撃条件を入力してください") });
          continue;
        }
        for (const attack of damageAttacks) {
          validateOpponent(attack);
          validatePercent(attack.minSurvivalProbabilityPercent);
        }
        const canonical = buildDefenceSearchInput(target, [scenario]).scenarios[0];
        canonical.hits.forEach((hit, index) => {
          if (hit.constraint) hit.constraint.minSurvivalProbability = damageAttacks[index].minSurvivalProbabilityPercent / 100;
        });
        conditions.push({ ...base, kind: "defence", scenario: canonical,
          hitLabels: damageAttacks.map((attack, index) => `${formatScenarioAttackLabel("defence", index, attack.label)} / ${attack.moveInput}`) });
      } catch (error) {
        conditions.push({ ...base, issue: classifyCurrentBuildIssue(error) });
      }
      continue;
    }
    if (scenario.adjustmentType === "offense" && scenario.offense) {
      try {
        const sequence = buildOffenseSequenceCondition(target, scenario);
        conditions.push({ ...base, kind: "offense", input: sequence.attacks[0], sequence,
          hitLabels: sequence.attacks.map((attack, index) => `${formatScenarioAttackLabel("offense", index, attack.label)} / ${attack.moveInput}`) });
      } catch (error) { conditions.push({ ...base, issue: classifyCurrentBuildIssue(error) }); }
      continue;
    }
    for (const [index, attack] of scenario.attacks.entries()) {
      const identity = { ...base, id: `${scenario.id}:${attack.id}`, label: formatScenarioAttackLabel(scenario.adjustmentType, index, attack.label) };
      try {
        if (scenario.adjustmentType === "offense") {
          if (!attack.moveInput.trim() || !attack.attackerPokemonInput.trim()) {
            conditions.push({ ...identity, issue: incomplete("仮想敵のポケモンと技を入力してください") });
            continue;
          }
          validateOpponent(attack);
          validatePercent(attack.targetKoProbabilityPercent);
          const input = buildOffenseAdjustmentInput(target, createOffenseAdjustmentFormFromScenarioAttack(attack));
          input.targetKoProbability = attack.targetKoProbabilityPercent / 100;
          conditions.push({ ...identity, kind: "offense", input, hitLabels: [`${identity.label} / ${attack.moveInput}`] });
        } else {
          if (attack.speedTargetMode === "manual") {
            if (!Number.isInteger(attack.speedTargetValue) || attack.speedTargetValue <= 0 || attack.speedTargetValue > 10000) {
              conditions.push({ ...identity, issue: incomplete("任意S値を1〜10000で入力してください") });
              continue;
            }
          } else {
            if (!attack.attackerPokemonInput.trim()) {
              conditions.push({ ...identity, issue: incomplete("仮想敵のポケモンを入力してください") });
              continue;
            }
            validateOpponent(attack);
          }
          conditions.push({ ...identity, kind: "speed", input: buildSpeedAdjustmentInput(target, attack) });
        }
      } catch (error) {
        conditions.push({ ...identity, issue: classifyCurrentBuildIssue(error) });
      }
    }
  }
  return { build, conditions };
};
