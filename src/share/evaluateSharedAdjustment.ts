import type { ShareStateDocument } from "../ui/shareState";
import { buildDefenceSearchInput, buildOffenseAdjustmentInput, buildSpeedAdjustmentInput, buildTargetBuildFromUi, createOffenseAdjustmentFormFromScenarioAttack } from "../ui/defenceSearchUi";
import { evaluateScenario } from "../search/defenceSearch";
import { evaluateCurrentOffense } from "../search/offenseAdjustment";
import { evaluateCurrentSpeed } from "../search/speedAdjustment";
import { getBuildDerivedStats } from "../search/bulkScore";
import type { StatTable } from "../domain/model";
import { validateSharedConditions } from "./sharedAdjustment";

export type SharedConditionResult = { scenarioId: string; attackId?: string; state: "pass" | "fail" | "disabled" | "error"; text: string };
export type SharedEvaluation = { stats: StatTable | null; targetError?: string; conditions: SharedConditionResult[] };
const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;
export const sharedCalculationError = (error: unknown): string => error instanceof Error && /[ぁ-んァ-ン一-龯]/.test(error.message)
  ? error.message.replace("を canonical name に解決できません", "を確認できません").replace(/\s*\((exact|alias|ambiguous|not-found),.*\)$/, "")
  : "この条件は計算できません。入力内容と対応状況を確認してください。";

/** Same adapters and evaluators as the editor, with the received SP held fixed. */
export const evaluateSharedAdjustment = (document: ShareStateDocument): SharedEvaluation => {
  validateSharedConditions(document);
  const evaluation: SharedEvaluation = { stats: null, conditions: [] };
  try { evaluation.stats = getBuildDerivedStats(buildTargetBuildFromUi(document.target)); }
  catch (error) { evaluation.targetError = sharedCalculationError(error); }
  for (const scenario of document.scenarios) {
    if (!scenario.enabled) {
      evaluation.conditions.push({ scenarioId: scenario.id, state: "disabled", text: "無効なシナリオ" });
      continue;
    }
    const addError = (error: unknown, attackId?: string) => evaluation.conditions.push({ scenarioId: scenario.id, attackId, state: "error", text: sharedCalculationError(error) });
    if (scenario.adjustmentType === "defence") {
      try {
        if (scenario.attacks.length === 0 || scenario.attacks.some((attack) => !attack.moveInput.trim())) throw new Error("攻撃の技が未入力です");
        const input = buildDefenceSearchInput(document.target, [scenario]);
        const result = evaluateScenario(input.build, input.scenarios[0]);
        evaluation.conditions.push({ scenarioId: scenario.id, state: result.passed ? "pass" : "fail", text: `生存率 ${percent(result.survivalProbability)} / 必要 ${percent(result.minSurvivalProbability)}` });
      } catch (error) { addError(error); }
    } else {
      if (scenario.attacks.length === 0) addError(new Error("条件が未入力です"));
      for (const attack of scenario.attacks) {
        try {
          if (scenario.adjustmentType === "offense") {
            const result = evaluateCurrentOffense(buildOffenseAdjustmentInput(document.target, createOffenseAdjustmentFormFromScenarioAttack(attack)));
            const range = result.hitEvaluation.damageRange;
            evaluation.conditions.push({ scenarioId: scenario.id, attackId: attack.id, state: result.passed ? "pass" : "fail", text: `KO率 ${percent(result.koProbability)} / 必要 ${percent(result.targetKoProbability)}・ダメージ ${range.min}〜${range.max}` });
          } else {
            const result = evaluateCurrentSpeed(buildSpeedAdjustmentInput(document.target, attack));
            evaluation.conditions.push({ scenarioId: scenario.id, attackId: attack.id, state: result.passed ? "pass" : "fail", text: `こちらのS ${result.actualSpeed} / 相手のS ${result.targetSpeed} / 必要S ${result.requiredSpeed}${attack.speedOrderMode === "trick-room" ? "以下" : "以上"}` });
          }
        } catch (error) { addError(error, attack.id); }
      }
    }
  }
  return evaluation;
};
