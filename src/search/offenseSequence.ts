import { calculateSmogonHit } from "../calc/smogonAdapter";
import { buildHpSequenceMoveUses } from "../calc/hpSequenceMoveUses";
import { simulateHpSequence, getHpSequenceKoProbability } from "../calc/simulateHpSequence";
import { getBuildStatPoints, isLegalStatPointTable, statPointTableToSmogonEvs, sumStatPoints } from "../domain/championsStats";
import { getMoveStatReferencePlan } from "../domain/moveStatReference";
import type { Build, ScenarioHitEvaluation, StatKey, StatTable } from "../domain/model";
import type { HpEventEvaluation } from "../domain/hpEvents";
import type { SpeedScenarioCondition } from "../domain/speed";
import { evaluateSpeedConditions } from "./speedAdjustment";
import { buildOffenseHit, type OffenseAdjustmentInput, type OffenseAdjustmentResult } from "./offenseAdjustment";

export interface OffenseSequenceAttack extends OffenseAdjustmentInput {
  id: string;
  label: string;
  moveHits?: number;
}
export interface OffenseSequenceCondition {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  defenderBuild: Build;
  targetKoProbability: number;
  attacks: OffenseSequenceAttack[];
}
export interface OffenseSequenceStep {
  id: string;
  label: string;
  hitEvaluation: ScenarioHitEvaluation;
  remainingHp: { min: number; max: number };
  koProbability: number;
}
export interface OffenseSequenceEvaluation {
  scenarioId: string;
  scenarioLabel: string;
  passed: boolean;
  targetKoProbability: number;
  koProbability: number;
  hitEvaluation: ScenarioHitEvaluation;
  hitEvaluations: ScenarioHitEvaluation[];
  steps: OffenseSequenceStep[];
  hpEventEvaluations: HpEventEvaluation[];
}

/** Each card is one move use; both identities stay stable across the whole row. */
export const evaluateOffenseSequence = (
  attackerBuild: Build, condition: OffenseSequenceCondition,
): OffenseSequenceEvaluation => {
  if (!condition.attacks.length) throw new Error("火力調整の技を入力してください");
  for (const entity of [attackerBuild.pokemon, attackerBuild.ability, attackerBuild.item,
    condition.defenderBuild.pokemon, condition.defenderBuild.ability, condition.defenderBuild.item, ...condition.attacks.map((attack) => attack.move)]) {
    if (entity?.sourceStatus === "unsupported-temporary") throw new Error(`「${entity.displayNameJa}」は計算未対応です`);
  }
  const defenderBuild = { ...condition.defenderBuild, id: `offense-defender:${condition.id}` };
  const attacker = { ...attackerBuild, id: `offense-attacker:${condition.id}` };
  const evaluations: ScenarioHitEvaluation[] = [];
  const steps: OffenseSequenceStep[] = [];
  const executedCards = new Set<string>();
  const cards = condition.attacks.map((attack) => {
    const defender = { ...defenderBuild, status: attack.defenderBuild.status };
    const user = { ...attacker, status: attack.attackerBuild.status };
    const hit = { ...buildOffenseHit(user, attack), id: attack.id,
      moveHits: attack.moveHits ?? attack.moveContext?.participants.length,
      repeat: attack.moveHits ?? attack.moveContext?.participants.length ?? 1 };
    const hitEvaluation = calculateSmogonHit(defender, hit, attack.field);
    if (hitEvaluation.movePower?.source === "status") throw new Error("変化技の効果によるKO判定は計算未対応です");
    evaluations.push(hitEvaluation);
    const moveUses = buildHpSequenceMoveUses({ defenderBuild: defender, hit, field: attack.field,
      evaluation: hitEvaluation, includeAttackerAutomaticHpEffects: true });
    // HP-sensitive abilities must also see the carried HP, not just HP-dependent moves.
    const rollCache = new Map<string, readonly (readonly number[])[]>();
    for (const moveUse of moveUses) {
      moveUse.resolveDamageRollsByHit = (attackerCurrentHp, defenderCurrentHp) => {
        const key = `${attackerCurrentHp}:${defenderCurrentHp}`;
        const cached = rollCache.get(key);
        if (cached) return cached;
        const actual = calculateSmogonHit(defender, hit, attack.field, { attackerCurrentHp, defenderCurrentHp });
        const rolls = actual.damageRollsByHit ?? [actual.damageRolls];
        const first = !executedCards.has(attack.id);
        executedCards.add(attack.id);
        hitEvaluation.damageRange = first ? { ...actual.damageRange } : {
          min: Math.min(hitEvaluation.damageRange.min, actual.damageRange.min),
          max: Math.max(hitEvaluation.damageRange.max, actual.damageRange.max),
          percentMin: Math.min(hitEvaluation.damageRange.percentMin, actual.damageRange.percentMin),
          percentMax: Math.max(hitEvaluation.damageRange.percentMax, actual.damageRange.percentMax),
        };
        if (rollCache.size || attackerCurrentHp !== undefined) hitEvaluation.description = undefined;
        rollCache.set(key, rolls);
        return rolls;
      };
    }
    return { id: attack.id, attackerBuild: user, defenderBuild: defender, moveUses,
      hpEvents: attack.hpEvents ?? [], field: attack.field };
  });
  const sequence = simulateHpSequence({ cards, onCardComplete: (card, states) => {
    const hp = states.filter((state) => state.probability > 0).map((state) => state.hpByBuildId[defenderBuild.id]);
    const index = steps.length;
    if (!executedCards.has(card.id)) evaluations[index] = { ...evaluations[index], description: undefined,
      damageRange: { min: 0, max: 0, percentMin: 0, percentMax: 0 } };
    steps.push({ id: card.id, label: condition.attacks[index].label, hitEvaluation: evaluations[index],
      remainingHp: { min: Math.min(...hp), max: Math.max(...hp) },
      koProbability: states.reduce((total, state) => total + (state.hpByBuildId[defenderBuild.id] <= 0 ? state.probability : 0), 0) });
  } });
  const koProbability = getHpSequenceKoProbability(sequence, defenderBuild.id);
  return { scenarioId: condition.scenarioId, scenarioLabel: condition.scenarioLabel,
    passed: koProbability + 1e-12 >= condition.targetKoProbability,
    targetKoProbability: condition.targetKoProbability, koProbability,
    hitEvaluation: evaluations[0], hitEvaluations: evaluations, steps,
    hpEventEvaluations: sequence.hpEventEvaluations };
};

export const evaluateOffenseConditions = (build: Build, conditions: readonly OffenseSequenceCondition[]) =>
  conditions.map((condition) => evaluateOffenseSequence(build, condition));

export const withOffenseStatPoints = (build: Build, statPoints: StatTable): Build => ({
  ...build, statPoints, evs: statPointTableToSmogonEvs(statPoints),
});

export interface OffenseAllocation {
  build: Build;
  minimumStatPoints: Partial<StatTable>;
  evaluations: OffenseSequenceEvaluation[];
}

/** Finite exact enumeration, by total cost then A+C and A/C/H/B/D. No beam truncation. */
export function* searchOffenseAllocation(
  build: Build, conditions: readonly OffenseSequenceCondition[], speedConditions: readonly SpeedScenarioCondition[] = [],
): Generator<number, OffenseAllocation | null> {
  const base = getBuildStatPoints(build);
  if (!isLegalStatPointTable(base)) throw new Error("SPは各能力0〜32、合計66以内で入力してください");
  const keys = new Set<StatKey>(conditions.flatMap((condition) => condition.attacks.flatMap((attack) =>
    getMoveStatReferencePlan(attack.moveInput, { teraEnabled: Boolean(build.teraType) }).references
      .filter((reference) => reference.owner === "attacker" && reference.role === "damage")
      .map((reference) => reference.stat))));
  const order = ["atk", "spa", "hp", "def", "spd"] as const;
  const lower = { ...base, hp: 0, def: 0, spd: 0 };
  let evaluated = 0;
  // S is resolved for each proposed allocation before KO evaluation (Gyro Ball etc.).
  function* distribute(index: number, budget: number, points: StatTable): Generator<StatTable> {
    if (index === order.length) { if (budget === 0) yield points; return; }
    const key = order[index];
    const min = lower[key];
    const max = keys.has(key) ? Math.min(32, budget) : min;
    for (let value = min; value <= max && value <= budget; value++) {
      yield* distribute(index + 1, budget - value, { ...points, [key]: value });
    }
  }
  const cache = new Map<string, OffenseSequenceEvaluation>();
  const evaluate = (candidate: Build, condition: OffenseSequenceCondition) => {
    // All six stats belong in the key, including current-HP / speed-dependent moves.
    const key = `${condition.id}:${Object.values(getBuildStatPoints(candidate)).join(":")}`;
    let result = cache.get(key);
    if (!result) { result = evaluateOffenseSequence(candidate, condition); if (cache.size < 4096) cache.set(key, result); }
    return result;
  };
  let best: OffenseAllocation | null = null;
  const compare = (a: StatTable, b: StatTable) => sumStatPoints(a) - sumStatPoints(b)
    || a.atk + a.spa - b.atk - b.spa || order.reduce((difference, key) => difference || a[key] - b[key], 0);
  for (let total = sumStatPoints(lower); total <= 66; total++) {
    const candidates: StatTable[] = [];
    for (const points of distribute(0, total - base.spe, lower)) candidates.push(points);
    candidates.sort((a, b) => a.atk + a.spa - b.atk - b.spa || order.reduce((difference, key) => difference || a[key] - b[key], 0));
    for (const points of candidates) {
      yield ++evaluated;
      let candidate = withOffenseStatPoints(build, points);
      let speedPassed = false;
      for (let spe = base.spe; spe <= 32 && sumStatPoints({ ...points, spe }) <= 66; spe++) {
        candidate = withOffenseStatPoints(build, { ...points, spe });
        if (evaluateSpeedConditions(candidate, speedConditions).every((entry) => entry.result.passed)) { speedPassed = true; break; }
      }
      if (!speedPassed) continue;
      const results: OffenseSequenceEvaluation[] = [];
      for (const condition of conditions) { const result = evaluate(candidate, condition); results.push(result); if (!result.passed) break; }
      if (results.length !== conditions.length || results.some((result) => !result.passed)) continue;
      const allocation = { build: candidate, minimumStatPoints: { hp: points.hp, def: points.def, spd: points.spd }, evaluations: results };
      if (!best || compare(getBuildStatPoints(candidate), getBuildStatPoints(best.build)) < 0) best = allocation;
    }
    if (best && total >= sumStatPoints(getBuildStatPoints(best.build))) return best;
  }
  return best;
}

export const offenseSequenceResult = (evaluation: OffenseSequenceEvaluation, build: Build | StatTable): OffenseAdjustmentResult => {
  const points = "hp" in build ? build : getBuildStatPoints(build);
  const labels = { hp: "H", atk: "A", def: "B", spa: "C", spd: "D" };
  const label = (["hp", "atk", "def", "spa", "spd"] as const).filter((key) => key === "atk" || key === "spa" || points[key] > 0).map((key) => `${labels[key]}${points[key]}`).join(" / ");
  return { id: evaluation.scenarioId, status: evaluation.passed ? "pass" : "fail", passed: evaluation.passed,
    label, owner: "attacker", stat: null, role: "damage", canApply: evaluation.passed,
    requiredStatPoints: null, actualStat: null, requiredAllocation: points,
    koProbability: evaluation.koProbability, targetKoProbability: evaluation.targetKoProbability,
    damageRange: evaluation.steps.length === 1 ? evaluation.hitEvaluation.damageRange : null,
    hpEventEvaluations: evaluation.hpEventEvaluations, sequence: evaluation,
    reason: evaluation.passed ? `${label} SPで一連の攻撃のKO条件を満たします` : "一連の攻撃ではKO条件に届きません" };
};
