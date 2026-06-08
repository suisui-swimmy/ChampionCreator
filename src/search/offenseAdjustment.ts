import { calculateSmogonHit, toSmogonPokemon } from "../calc/smogonAdapter";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  clampStatPointValue,
  statPointTableToSmogonEvs,
  sumStatPoints,
} from "../domain/championsStats";
import type {
  Build,
  FieldState,
  MoveRef,
  NatureRef,
  ScenarioHit,
  ScenarioHitEvaluation,
  SideState,
  StatBoostTable,
  StatKey,
  StatTable,
} from "../domain/model";
import {
  getMoveStatReferencePlan,
  type MoveStatReference,
} from "../domain/moveStatReference";
import { getBuildStatPoints } from "./defenceSearch";

export type OffenseAdjustmentStatus = "pass" | "fail" | "fixed" | "unresolved" | "invalid";

export interface OffenseAdjustmentInput {
  attackerBuild: Build;
  defenderBuild: Build;
  move: MoveRef;
  moveInput: string;
  targetKoProbability: number;
  field: FieldState;
  critical: boolean;
  attackerBoosts: StatBoostTable;
  defenderBoosts: StatBoostTable;
  attackerSide: SideState;
  defenderSide: SideState;
  boostedNatures?: Partial<Record<"atk" | "spa", NatureRef>>;
}

export interface OffenseAdjustmentResult {
  id: string;
  status: OffenseAdjustmentStatus;
  passed: boolean;
  label: string;
  owner: MoveStatReference["owner"] | "none";
  stat: StatKey | null;
  role: MoveStatReference["role"] | "fixed";
  canApply: boolean;
  requiredStatPoints: number | null;
  actualStat: number | null;
  koProbability: number;
  targetKoProbability: number;
  damageRange: ScenarioHitEvaluation["damageRange"] | null;
  description?: string;
  reason: string;
  reference?: OffenseAdjustmentResult;
}

type OffenseCandidateEvaluation = {
  statPoints: number;
  actualStat: number;
  koProbability: number;
  hitEvaluation: ScenarioHitEvaluation;
};

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  friendGuard: false,
};

const KO_EPSILON = 1e-12;

const statCodes = {
  hp: "H",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
} satisfies Record<StatKey, string>;

const clampProbability = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
};

const buildOffenseHit = (
  attackerBuild: Build,
  input: OffenseAdjustmentInput,
): ScenarioHit => ({
  id: "offense-adjustment-hit",
  attacker: attackerBuild,
  defenderStatus: input.defenderBuild.status,
  move: input.move,
  repeat: 1,
  critical: input.critical,
  attackerBoosts: input.attackerBoosts,
  defenderBoosts: input.defenderBoosts,
  attackerSide: input.attackerSide ?? emptySide,
  defenderSide: input.defenderSide ?? emptySide,
});

export const calculateKoProbability = (
  defenderMaxHp: number,
  damageRolls: readonly number[],
): number => {
  const finiteRolls = damageRolls.filter(Number.isFinite);
  if (finiteRolls.length === 0 || defenderMaxHp <= 0) {
    return 0;
  }

  return finiteRolls.filter((damage) => damage >= defenderMaxHp).length / finiteRolls.length;
};

const getActualStat = (build: Build, stat: StatKey): number => {
  const pokemon = toSmogonPokemon(build);
  return stat === "hp" ? pokemon.maxHP() : pokemon.stats[stat];
};

const withStatPoint = (
  build: Build,
  stat: StatKey,
  statPoints: number,
): Build => {
  const nextStatPoints = {
    ...getBuildStatPoints(build),
    [stat]: clampStatPointValue(statPoints),
  };

  return {
    ...build,
    statPoints: nextStatPoints,
    evs: statPointTableToSmogonEvs(nextStatPoints),
  };
};

const withNature = (build: Build, nature: NatureRef | undefined): Build =>
  nature ? { ...build, nature } : build;

const getMaxSearchStatPoints = (build: Build, stat: StatKey): number => {
  const current = getBuildStatPoints(build);
  const usedByOtherStats = sumStatPoints(current) - current[stat];
  return Math.max(
    0,
    Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats),
  );
};

const evaluateCandidate = (
  input: OffenseAdjustmentInput,
  reference: MoveStatReference,
  statPoints: number,
  attackerOverride?: Build,
  defenderOverride?: Build,
): OffenseCandidateEvaluation => {
  const baseAttacker = attackerOverride ?? input.attackerBuild;
  const baseDefender = defenderOverride ?? input.defenderBuild;
  const attackerBuild = reference.owner === "attacker"
    ? withStatPoint(baseAttacker, reference.stat, statPoints)
    : baseAttacker;
  const defenderBuild = reference.owner === "target"
    ? withStatPoint(baseDefender, reference.stat, statPoints)
    : baseDefender;
  const hitEvaluation = calculateSmogonHit(
    defenderBuild,
    buildOffenseHit(attackerBuild, input),
    input.field,
  );

  return {
    statPoints,
    actualStat: getActualStat(reference.owner === "attacker" ? attackerBuild : defenderBuild, reference.stat),
    koProbability: calculateKoProbability(toSmogonPokemon(defenderBuild).maxHP(), hitEvaluation.damageRolls),
    hitEvaluation,
  };
};

const isInvariantLine = (evaluations: OffenseCandidateEvaluation[]): boolean => {
  if (evaluations.length <= 1) {
    return false;
  }

  const [first] = evaluations;
  return evaluations.every((evaluation) => (
    evaluation.koProbability === first.koProbability
    && evaluation.hitEvaluation.damageRange.min === first.hitEvaluation.damageRange.min
    && evaluation.hitEvaluation.damageRange.max === first.hitEvaluation.damageRange.max
  ));
};

const formatLineLabel = (reference: MoveStatReference): string =>
  reference.owner === "target"
    ? `相手${statCodes[reference.stat]}参照`
    : `${statCodes[reference.stat]}ライン`;

const canApplyReference = (reference: MoveStatReference): boolean =>
  reference.owner === "attacker" && (reference.stat === "atk" || reference.stat === "spa");

const makeFixedResult = (
  input: OffenseAdjustmentInput,
  id: string,
  evaluation: OffenseCandidateEvaluation,
  reference?: MoveStatReference,
): OffenseAdjustmentResult => {
  const passed = evaluation.koProbability + KO_EPSILON >= clampProbability(input.targetKoProbability);
  return {
    id,
    status: "fixed",
    passed,
    label: reference ? formatLineLabel(reference) : "固定条件",
    owner: reference?.owner ?? "none",
    stat: reference?.stat ?? null,
    role: reference?.role ?? "fixed",
    canApply: false,
    requiredStatPoints: null,
    actualStat: reference ? evaluation.actualStat : null,
    koProbability: evaluation.koProbability,
    targetKoProbability: clampProbability(input.targetKoProbability),
    damageRange: evaluation.hitEvaluation.damageRange,
    description: evaluation.hitEvaluation.description,
    reason: passed
      ? "SPを変えても結果が変わらず、現在条件でKO条件を満たします"
      : "SPを変えても結果が変わらず、現在条件ではKO条件に届きません",
  };
};

const calculateReferenceLine = (
  input: OffenseAdjustmentInput,
  reference: MoveStatReference,
  options: { id: string; attackerOverride?: Build; referenceNature?: NatureRef } = { id: "line" },
): OffenseAdjustmentResult => {
  const targetBuild = reference.owner === "attacker"
    ? (options.attackerOverride ?? input.attackerBuild)
    : input.defenderBuild;
  const maxStatPoints = getMaxSearchStatPoints(targetBuild, reference.stat);
  const evaluations: OffenseCandidateEvaluation[] = [];

  for (let statPoints = 0; statPoints <= maxStatPoints; statPoints += 1) {
    evaluations.push(evaluateCandidate(
      input,
      reference,
      statPoints,
      options.attackerOverride,
    ));
  }

  if (evaluations.length === 0) {
    return {
      id: options.id,
      status: "invalid",
      passed: false,
      label: formatLineLabel(reference),
      owner: reference.owner,
      stat: reference.stat,
      role: reference.role,
      canApply: false,
      requiredStatPoints: null,
      actualStat: null,
      koProbability: 0,
      targetKoProbability: clampProbability(input.targetKoProbability),
      damageRange: null,
      reason: "SP予算が不足しているため、候補を評価できません",
    };
  }

  if (isInvariantLine(evaluations)) {
    return makeFixedResult(input, options.id, evaluations[0], reference);
  }

  const targetKoProbability = clampProbability(input.targetKoProbability);
  const passing = evaluations.find((evaluation) => (
    evaluation.koProbability + KO_EPSILON >= targetKoProbability
  ));
  const best = passing ?? evaluations.reduce((currentBest, evaluation) => (
    evaluation.koProbability > currentBest.koProbability ? evaluation : currentBest
  ));
  const passed = Boolean(passing);

  return {
    id: options.id,
    status: passed ? "pass" : "fail",
    passed,
    label: formatLineLabel(reference),
    owner: reference.owner,
    stat: reference.stat,
    role: reference.role,
    canApply: passed && canApplyReference(reference) && !options.referenceNature,
    requiredStatPoints: best.statPoints,
    actualStat: best.actualStat,
    koProbability: best.koProbability,
    targetKoProbability,
    damageRange: best.hitEvaluation.damageRange,
    description: best.hitEvaluation.description,
    reason: passed
      ? `${formatLineLabel(reference)} ${best.statPoints} SPでKO条件を満たします`
      : `${formatLineLabel(reference)}は最大 ${maxStatPoints} SPでもKO条件に届きません`,
  };
};

export const calculateOffenseAdjustment = (
  input: OffenseAdjustmentInput,
): OffenseAdjustmentResult[] => {
  const referencePlan = getMoveStatReferencePlan(input.moveInput, {
    teraEnabled: input.attackerBuild.teraType !== undefined,
  });
  const damageReferences = referencePlan.references.filter((reference) => reference.role === "damage");

  if (damageReferences.length === 0) {
    const current = evaluateCandidate(
      input,
      { owner: "attacker", stat: "atk", role: "damage" },
      getBuildStatPoints(input.attackerBuild).atk,
    );
    return [makeFixedResult(input, "fixed-current", current)];
  }

  const results = damageReferences.map((reference, index) => {
    const result = calculateReferenceLine(input, reference, { id: `line-${index + 1}` });

    if (
      result.status === "fail"
      && reference.owner === "attacker"
      && (reference.stat === "atk" || reference.stat === "spa")
      && input.boostedNatures?.[reference.stat]
    ) {
      const referenceNature = input.boostedNatures[reference.stat];
      return {
        ...result,
        reference: calculateReferenceLine(input, reference, {
          id: `${result.id}-boosted-nature`,
          attackerOverride: withNature(input.attackerBuild, referenceNature),
          referenceNature,
        }),
      };
    }

    return result;
  });

  return results;
};
