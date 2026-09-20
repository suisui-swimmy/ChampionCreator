import type { Build, FieldState, NatureRef, SideState, StatBoostTable } from "./model";

export type SpeedAdjustmentStatus = "pass" | "tie" | "fail" | "unresolved" | "invalid";
export type SpeedComparisonMode = "outspeed" | "tie";
export type SpeedManualMultiplier = "auto" | "2" | "1.5" | "0.5";
export type SpeedOrderMode = "normal" | "trick-room";
export type SpeedRelation = "outspeed" | "tie" | "miss";

export interface SpeedAdjustmentInput {
  targetBuild: Build;
  opponentBuild?: Build;
  opponentLabel: string;
  field: FieldState;
  targetBoosts: StatBoostTable;
  opponentBoosts: StatBoostTable;
  targetSide: SideState;
  opponentSide: SideState;
  comparison: SpeedComparisonMode;
  orderMode?: SpeedOrderMode;
  requiredSpeedOffset?: number;
  manualTargetSpeed?: number;
  targetItemMultiplier: SpeedManualMultiplier;
  targetAbilityMultiplier: SpeedManualMultiplier;
  opponentItemMultiplier: SpeedManualMultiplier;
  opponentAbilityMultiplier: SpeedManualMultiplier;
  boostedNature?: NatureRef;
}

/** Evaluation of exactly one allocation; never a proposed replacement allocation. */
export interface SpeedConditionEvaluation {
  status: SpeedAdjustmentStatus;
  passed: boolean;
  orderMode: SpeedOrderMode;
  relation: SpeedRelation;
  statPoints: number;
  actualSpeed: number | null;
  targetSpeed: number;
  requiredSpeed: number;
  notes: string[];
  reason: string;
}

interface SpeedScenarioIdentity {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  attackId: string;
  attackLabel: string;
}

/** Canonical, serializable conditions carried through the search Worker. */
export interface SpeedScenarioCondition extends SpeedScenarioIdentity {
  condition: Omit<SpeedAdjustmentInput, "targetBuild" | "boostedNature"> & {
    targetStatus?: Build["status"];
  };
}

export interface SpeedScenarioEvaluation extends SpeedScenarioIdentity {
  result: SpeedConditionEvaluation;
}
