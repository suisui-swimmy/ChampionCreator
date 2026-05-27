import type { EntityKind, SourceStatus } from "../data/localizationTypes";
import type { ResolveResult, ResolveStatus } from "../localization/resolver";

declare const canonicalNameBrand: unique symbol;
declare const displayNameJaBrand: unique symbol;

export type CanonicalName<K extends EntityKind = EntityKind> = string & {
  readonly [canonicalNameBrand]: K;
};

export type DisplayNameJa = string & {
  readonly [displayNameJaBrand]: "displayNameJa";
};

export type ResolvedStatus = Extract<ResolveStatus, "exact" | "alias">;

export interface EntityRef<K extends EntityKind = EntityKind> {
  kind: K;
  canonicalName: CanonicalName<K>;
  calcId: string;
  displayNameJa: DisplayNameJa;
  sourceStatus: SourceStatus;
  resolvedBy: ResolvedStatus;
}

export type PokemonRef = EntityRef<"pokemon">;
export type MoveRef = EntityRef<"move">;
export type ItemRef = EntityRef<"item">;
export type AbilityRef = EntityRef<"ability">;
export type NatureRef = EntityRef<"nature">;
export type TypeRef = EntityRef<"type">;

export type StatKey = "hp" | "atk" | "def" | "spa" | "spd" | "spe";
export type DefenceSearchStatKey = "hp" | "def" | "spd";

export type StatTable<T = number> = Record<StatKey, T>;
export type StatBoostTable = Partial<Record<Exclude<StatKey, "hp">, number>>;

export interface Build {
  id: string;
  pokemon: PokemonRef;
  level: number;
  nature?: NatureRef;
  ivs: StatTable;
  evs: StatTable;
  ability?: AbilityRef;
  item?: ItemRef;
  teraType?: TypeRef;
}

export type Weather = "none" | "sun" | "rain" | "sand" | "snow";
export type Terrain = "none" | "electric" | "grassy" | "misty" | "psychic";

export interface FieldState {
  weather: Weather;
  terrain: Terrain;
}

export interface SideState {
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
}

export interface ScenarioHit {
  id: string;
  attacker: Build;
  move: MoveRef;
  repeat: number;
  critical: boolean;
  attackerBoosts: StatBoostTable;
  defenderBoosts: StatBoostTable;
  attackerSide: SideState;
  defenderSide: SideState;
}

export interface SurvivalConstraint {
  enabled: boolean;
  requiredSurvivedHits: number;
  minSurvivalProbability: number;
}

export interface Scenario {
  id: string;
  label: string;
  enabled: boolean;
  hits: ScenarioHit[];
  field: FieldState;
  constraint: SurvivalConstraint;
}

export interface DamageRange {
  min: number;
  max: number;
  percentMin: number;
  percentMax: number;
}

export interface ScenarioHitEvaluation {
  hitId: string;
  damageRolls: number[];
  damageRange: DamageRange;
  description?: string;
}

export interface ScenarioEvaluation {
  scenarioId: string;
  passed: boolean;
  survivalProbability: number;
  requiredSurvivedHits: number;
  minSurvivalProbability: number;
  hitEvaluations: ScenarioHitEvaluation[];
  bottleneckLabel: string;
}

export interface DefenceEvCandidate {
  hp: number;
  def: number;
  spd: number;
}

export interface CandidateResult {
  id: string;
  rank: number;
  candidate: DefenceEvCandidate;
  appliedEvs: StatTable;
  usedEvBudget: number;
  remainingEvBudget: number;
  passed: boolean;
  scenarioResults: ScenarioEvaluation[];
  bottleneckLabel: string;
}

type ResolvedEntityResult<K extends EntityKind = EntityKind> = ResolveResult & {
  kind: K;
  status: ResolvedStatus;
  canonicalName: string;
  calcId: string;
  displayNameJa: string;
  sourceStatus: SourceStatus;
};

export const isResolvedEntityResult = <K extends EntityKind>(
  result: ResolveResult,
  kind?: K,
): result is ResolvedEntityResult<K> => {
  const hasResolvedStatus = result.status === "exact" || result.status === "alias";
  const hasResolvedNames = Boolean(result.canonicalName && result.calcId && result.displayNameJa && result.sourceStatus);
  return hasResolvedStatus && hasResolvedNames && (!kind || result.kind === kind);
};

export const toEntityRef = <K extends EntityKind>(
  result: ResolveResult,
  kind: K,
): EntityRef<K> | null => {
  if (!isResolvedEntityResult(result, kind)) {
    return null;
  }

  return {
    kind,
    canonicalName: result.canonicalName as CanonicalName<K>,
    calcId: result.calcId,
    displayNameJa: result.displayNameJa as DisplayNameJa,
    sourceStatus: result.sourceStatus,
    resolvedBy: result.status,
  };
};
