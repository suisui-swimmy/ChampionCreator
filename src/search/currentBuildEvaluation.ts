import { evaluateOffenseSequence, type OffenseSequenceCondition, type OffenseSequenceEvaluation } from "./offenseSequence";
import type { Build, EntityRef, Scenario, ScenarioEvaluation } from "../domain/model";
import type { SpeedAdjustmentInput, SpeedConditionEvaluation } from "../domain/speed";
import { getBuildStatPoints, isLegalStatPointTable, isLegalStatPointValue } from "../domain/championsStats";
import { getHpEventRuleDefinition } from "../calc/hpEventRules";
import { evaluateScenario } from "./defenceSearch";
import { evaluateCurrentOffense, type CurrentOffenseEvaluation, type OffenseAdjustmentInput } from "./offenseAdjustment";
import { evaluateSpeedCondition } from "./speedAdjustment";

export type CurrentBuildIssueStatus = "incomplete" | "unresolved" | "unsupported" | "invalid";
export interface CurrentBuildIssue { status: CurrentBuildIssueStatus; message: string }
export interface CurrentBuildConditionIdentity {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  label: string;
  kind: "defence" | "offense" | "speed";
  hitLabels?: string[];
}
export type CurrentBuildCondition = CurrentBuildConditionIdentity & (
  | { kind: "defence"; scenario: Scenario; issue?: never }
  | { kind: "offense"; input: OffenseAdjustmentInput; sequence?: OffenseSequenceCondition; issue?: never }
  | { kind: "speed"; input: SpeedAdjustmentInput; issue?: never }
  | { issue: CurrentBuildIssue }
);
export interface CurrentBuildEvaluationInput {
  build?: Build;
  issue?: CurrentBuildIssue;
  conditions: CurrentBuildCondition[];
}
export interface CurrentBuildConditionResult extends CurrentBuildConditionIdentity {
  status: "pass" | "fail" | CurrentBuildIssueStatus;
  message?: string;
  defence?: ScenarioEvaluation;
  offense?: CurrentOffenseEvaluation | OffenseSequenceEvaluation;
  speed?: SpeedConditionEvaluation;
}
export interface CurrentBuildEvaluationResult {
  build?: Build;
  issue?: CurrentBuildIssue;
  status: "pass" | "fail" | "blocked" | "empty";
  conditions: CurrentBuildConditionResult[];
}

export const classifyCurrentBuildIssue = (error: unknown): CurrentBuildIssue => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("canonical name に解決できません")) {
    return { status: "unresolved", message: message.replace("canonical name に解決できません", "特定できません") };
  }
  if (/技を入力してください|ポケモンを入力してください|共通の仮想敵を入力してください/.test(message)) return { status: "incomplete", message };
  return { status: /未対応|not supported|not found/i.test(message) ? "unsupported" : "invalid", message };
};

const assertSupportedEntity = (entity: EntityRef | undefined) => {
  if (entity?.sourceStatus === "unsupported-temporary") {
    throw new Error(`「${entity.displayNameJa}」は計算未対応です`);
  }
};
const assertBuild = (build: Build, enforceBudget = false) => {
  const points = getBuildStatPoints(build);
  if (enforceBudget ? !isLegalStatPointTable(points) : !Object.values(points).every(isLegalStatPointValue)) {
    throw new Error(enforceBudget ? "SPは各能力0〜32、合計66以内で入力してください" : "仮想敵のSPは各能力0〜32で入力してください");
  }
  [build.pokemon, build.nature, build.ability, build.item, build.teraType].forEach(assertSupportedEntity);
};

export const evaluateCurrentBuildCondition = (
  build: Build,
  condition: CurrentBuildCondition,
): CurrentBuildConditionResult => {
  const { id, scenarioId, scenarioLabel, label, kind, hitLabels } = condition;
  const identity = { id, scenarioId, scenarioLabel, label, kind, hitLabels };
  if (condition.issue) return { ...identity, ...condition.issue };
  try {
    assertBuild(build, true);
    if (condition.kind === "speed") {
      assertBuild(condition.input.targetBuild, true);
      if (condition.input.opponentBuild) assertBuild(condition.input.opponentBuild);
      const speed = evaluateSpeedCondition(condition.input);
      if (speed.status === "invalid" || speed.status === "unresolved") {
        return { ...identity, ...classifyCurrentBuildIssue(speed.reason) };
      }
      return { ...identity, status: speed.passed ? "pass" : "fail", speed };
    }
    if (condition.kind === "offense" && condition.sequence) {
      for (const attack of condition.sequence.attacks) {
        assertBuild(attack.defenderBuild); assertSupportedEntity(attack.move);
        if (attack.hpEvents?.some((event) => event.enabled && !getHpEventRuleDefinition(event.effectId))) throw new Error("計算未対応の定数ダメージ・回復が含まれています");
      }
      const offense = evaluateOffenseSequence(build, condition.sequence);
      return { ...identity, status: offense.passed ? "pass" : "fail", offense };
    }
    const hits = condition.kind === "defence" ? condition.scenario.hits : [];
    if (condition.kind === "defence" && (!condition.scenario.enabled || !condition.scenario.constraint.enabled || !hits.length)) {
      return { ...identity, status: "incomplete", message: "有効な攻撃条件がありません" };
    }
    const events = condition.kind === "defence" ? hits.flatMap((hit) => hit.hpEvents ?? []) : condition.input.hpEvents ?? [];
    if (events.some((event) => event.enabled && !getHpEventRuleDefinition(event.effectId))) {
      return { ...identity, status: "unsupported", message: "計算未対応の定数ダメージ・回復が含まれています" };
    }
    for (const hit of hits) {
      assertBuild(hit.attacker);
      assertSupportedEntity(hit.move);
      hit.allyAbilities?.forEach(assertSupportedEntity);
    }
    if (condition.kind === "defence") {
      const defence = evaluateScenario(build, condition.scenario);
      if (defence.hitEvaluations.some((hit) => hit.movePower?.source === "status")) {
        return { ...identity, status: "unsupported", message: "変化技の効果による耐久判定は計算未対応です" };
      }
      return { ...identity, status: defence.passed ? "pass" : "fail", defence };
    }
    assertBuild(condition.input.attackerBuild, true);
    assertBuild(condition.input.defenderBuild);
    assertSupportedEntity(condition.input.move);
    const offense = evaluateCurrentOffense(condition.input);
    if (offense.hitEvaluation.movePower?.source === "status") {
      return { ...identity, status: "unsupported", message: "変化技の効果によるKO判定は計算未対応です" };
    }
    return { ...identity, status: offense.passed ? "pass" : "fail", offense };
  } catch (error) {
    return { ...identity, ...classifyCurrentBuildIssue(error) };
  }
};

export const summarizeCurrentBuildEvaluation = (
  input: CurrentBuildEvaluationInput,
  conditions: CurrentBuildConditionResult[],
): CurrentBuildEvaluationResult => ({
  build: input.build,
  issue: input.issue,
  conditions,
  status: input.issue || conditions.some((condition) => condition.status !== "pass" && condition.status !== "fail")
    ? "blocked"
    : conditions.length === 0 ? "empty"
    : conditions.every((condition) => condition.status === "pass") ? "pass" : "fail",
});

export const evaluateCurrentBuild = (input: CurrentBuildEvaluationInput): CurrentBuildEvaluationResult =>
  summarizeCurrentBuildEvaluation(input, input.build && !input.issue
    ? input.conditions.map((condition) => evaluateCurrentBuildCondition(input.build!, condition))
    : []);
