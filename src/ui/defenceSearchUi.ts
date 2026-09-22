import type { EntityKind } from "../data/localizationTypes";
import { resolvePokemonTypeOverride, type PokemonTypeOverrideForm } from "./pokemonTypes";
import type {
  ActiveDefenceSearchRequest,
  StartDefenceSearchWorkerOptions,
  StartMaximizeRemainingBulkWorkerOptions,
} from "../worker/defenceSearchWorkerClient";
import { createBulkMaximizeRequestId, createDefenceSearchRequestId } from "../worker/defenceSearchWorkerClient";
import type {
  Build,
  BeatUpMoveContext,
  CandidateResult,
  DefenceSearchStatKey,
  EntityRef,
  FieldState,
  GameType,
  PokemonStatus,
  Scenario,
  ScenarioHit,
  SideState,
  StatBoostTable,
  StatKey,
  StatTable,
  Weather,
  Terrain,
} from "../domain/model";
import {
  CHAMPIONS_TOTAL_STAT_POINTS,
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  isLegalStatPointTable,
  isLegalStatPointValue,
  clampStatPointTable,
  clampStatPointValue,
  statPointTableToSmogonEvs,
  sumStatPoints,
  type StatPointTable,
} from "../domain/championsStats";
import { isActiveAllyAbilityCanonicalName } from "../domain/allyAbilitySupport";
import type { HpEvent } from "../domain/hpEvents";
import {
  compileHpEventForMove,
  getHpEventRuleDefinition,
} from "../calc/hpEventRules";
import {
  getMovePowerAssistRule,
  resolveAllowedMovePowerOverride,
} from "../calc/movePowerRules";
import {
  BEAT_UP_CANONICAL_NAME,
  getBeatUpParticipantLimit,
} from "../calc/beatUp";
import { toEntityRef } from "../domain/model";
import { resolveEntity, resolveEntityWithCanonicalHint } from "../localization/resolver";
import {
  buildOffenseHit,
  calculateOffenseAdjustment,
  type OffenseAdjustmentInput,
  type OffenseAdjustmentResult,
} from "../search/offenseAdjustment";
import {
  getMoveHitCountRangeFromInput,
  getMoveMaxHitsFromInput,
} from "../domain/moveHitCounts";
import { getMoveDefenderStatKeys } from "../domain/moveStatReference";
import {
  calculateSpeedAdjustment,
  buildSpeedConditionInput,
  evaluateSpeedConditions,
  getAutomaticSpeedModifierSources,
  type SpeedAdjustmentInput,
  type SpeedAdjustmentResult,
  type SpeedComparisonMode,
  type SpeedManualMultiplier,
  type SpeedOrderMode,
} from "../search/speedAdjustment";
import type { SpeedScenarioCondition, SpeedScenarioEvaluation } from "../domain/speed";
import {
  type BulkNatureCandidate,
  type MaximizeRemainingBulkInput,
  type MaximizeRemainingBulkResult,
} from "../search/maximizeRemainingBulk";
import { getBuildDerivedStats } from "../search/bulkScore";
import natureOptionsData from "../data/generated/nature-options.gen.json";
import { searchOffenseAllocation, offenseSequenceResult, type OffenseSequenceCondition } from "../search/offenseSequence";

export type SpeedTargetMode = "opponent" | "manual";
export type LevelInputMode = "auto" | "manual";
export type MovePowerMode = "auto" | "assisted" | "manual";
export type BeatUpParticipantPowerMode = "auto" | "manual";

export const DEFAULT_LEVEL = 50;

export interface BeatUpParticipantFormState {
  id: string;
  source: "attacker" | "party";
  pokemonInput: string;
  powerMode: BeatUpParticipantPowerMode;
  powerValue: number;
}

export interface HpEventFormState {
  id: string;
  effectId: string;
  enabled: boolean;
  toxicStage?: number;
  spikesLayers?: number;
}

export interface TargetFormState {
  pokemonInput: string;
  pokemonCanonicalName?: string;
  natureInput: string;
  abilityInput: string;
  itemInput: string;
  teraTypeInput: string;
  typeOverride?: PokemonTypeOverrideForm;
  teraEnabled: boolean;
  dmaxEnabled: boolean;
  level: number;
  levelMode: LevelInputMode;
  statPoints: StatPointTable;
  boosts: StatBoostTable;
}

export interface ScenarioAttackFormState {
  id: string;
  label: string;
  attackerPokemonInput: string;
  attackerPokemonCanonicalName?: string;
  attackerNatureInput: string;
  attackerAbilityInput: string;
  attackerItemInput: string;
  attackerTeraTypeInput: string;
  attackerTypeOverride?: PokemonTypeOverrideForm;
  attackerTeraEnabled: boolean;
  attackerDmaxEnabled: boolean;
  attackerStatus: PokemonStatus;
  defenderStatus: PokemonStatus;
  attackerLevel: number;
  attackerLevelMode: LevelInputMode;
  attackerStatPoints: StatPointTable;
  attackerBoosts: StatBoostTable;
  defenderBoosts: StatBoostTable;
  offenseAttackerBoosts?: Partial<StatBoostTable>;
  offenseAttackerStatus?: PokemonStatus;
  moveInput: string;
  movePowerMode: MovePowerMode;
  movePowerValue: number;
  beatUpParticipants: BeatUpParticipantFormState[];
  hpEvents: HpEventFormState[];
  repeat: number;
  requiredSurvivedHits: number;
  minSurvivalProbabilityPercent: number;
  targetKoProbabilityPercent: number;
  gameType: GameType;
  weather: Weather;
  terrain: Terrain;
  critical: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
  friendGuard: boolean;
  speedTargetMode: SpeedTargetMode;
  speedComparison: SpeedComparisonMode;
  speedRequiredOffset: number;
  speedTargetValue: number;
  speedTargetStatus: PokemonStatus;
  speedTargetItemMultiplier: SpeedManualMultiplier;
  speedTargetAbilityMultiplier: SpeedManualMultiplier;
  speedTargetTailwind: boolean;
  speedOpponentTailwind: boolean;
  speedOrderMode: SpeedOrderMode;
  speedItemMultiplier: SpeedManualMultiplier;
  speedAbilityMultiplier: SpeedManualMultiplier;
  tailwind: boolean;
}

export type ScenarioAdjustmentType = "defence" | "offense" | "speed";

export interface ScenarioFormState {
  id: string;
  label: string;
  enabled: boolean;
  adjustmentType: ScenarioAdjustmentType;
  attacks: ScenarioAttackFormState[];
  offense?: OffenseScenarioSettings;
}

export const offenseOpponentKeys = [
  "attackerPokemonInput", "attackerPokemonCanonicalName", "attackerNatureInput",
  "attackerAbilityInput", "attackerItemInput", "attackerTeraTypeInput", "attackerTypeOverride",
  "attackerTeraEnabled", "attackerDmaxEnabled", "attackerLevel", "attackerLevelMode", "attackerStatPoints",
] as const;
export type OffenseOpponentForm = Pick<ScenarioAttackFormState, typeof offenseOpponentKeys[number]>;
export interface OffenseScenarioSettings {
  opponent: OffenseOpponentForm;
  targetKoProbabilityPercent: number;
}
export const createOffenseScenarioSettings = (attack: ScenarioAttackFormState): OffenseScenarioSettings => ({
  opponent: Object.fromEntries(offenseOpponentKeys.map((key) => [key, structuredClone(attack[key])])) as OffenseOpponentForm,
  targetKoProbabilityPercent: attack.targetKoProbabilityPercent,
});
export const initializeOffenseScenario = (scenario: ScenarioFormState): ScenarioFormState =>
  scenario.adjustmentType === "offense" && !scenario.offense && scenario.attacks[0]
    ? { ...scenario, offense: createOffenseScenarioSettings(scenario.attacks[0]) } : scenario;

export interface OffenseAdjustmentFormState {
  defenderPokemonInput: string;
  defenderPokemonCanonicalName?: string;
  defenderNatureInput: string;
  defenderAbilityInput: string;
  defenderItemInput: string;
  defenderTeraTypeInput: string;
  defenderTypeOverride?: PokemonTypeOverrideForm;
  defenderTeraEnabled: boolean;
  defenderDmaxEnabled: boolean;
  defenderStatus: PokemonStatus;
  defenderLevel: number;
  defenderStatPoints: StatPointTable;
  defenderBoosts: StatBoostTable;
  moveInput: string;
  movePowerMode: MovePowerMode;
  movePowerValue: number;
  beatUpParticipants: BeatUpParticipantFormState[];
  hpEvents: HpEventFormState[];
  targetKoProbabilityPercent: number;
  gameType: GameType;
  weather: Weather;
  terrain: Terrain;
  critical: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
  friendGuard: boolean;
}

export interface DefenceSearchInput {
  build: Build;
  scenarios: Scenario[];
  minimumStatPoints?: Partial<StatPointTable>;
  searchStatKeys?: DefenceSearchStatKey[];
  speedConditions?: SpeedScenarioCondition[];
  offenseConditions?: OffenseSequenceCondition[];
}

export interface OffenseScenarioResult {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  attackId: string;
  attackLabel: string;
  result: OffenseAdjustmentResult;
}

export interface SpeedScenarioResult {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  attackId: string;
  attackLabel: string;
  result: SpeedAdjustmentResult;
}

export interface IntegratedOffenseRequirements {
  fixedStatPoints: Partial<Pick<StatPointTable, "atk" | "spa">>;
  minimumStatPoints: Partial<Pick<StatPointTable, "hp" | "def" | "spd">>;
  selectedResults: OffenseScenarioResult[];
  blockingReasons: string[];
}

export interface IntegratedSpeedRequirements {
  fixedStatPoints: Partial<Pick<StatPointTable, "spe">>;
  selectedResults: SpeedScenarioEvaluation[];
  speedConditions?: SpeedScenarioCondition[];
  blockingReasons: string[];
}

export type SearchStatus = "idle" | "running" | "complete" | "error" | "canceled";

export interface SearchUiState {
  status: SearchStatus;
  activeRequestId: string | null;
  searchedCandidates: number;
  totalCandidates: number;
  progress: number;
  candidates: CandidateResult[];
  passingCandidateCount: number;
  errorMessage: string | null;
  strictestFailureLabel: string | null;
  offenseResults?: OffenseScenarioResult[];
}

export type SearchUiAction =
  | { type: "start"; requestId: string }
  | {
      type: "progress";
      requestId: string;
      searchedCandidates: number;
      totalCandidates: number;
      progress: number;
    }
  | { type: "partialResult"; requestId: string; candidates: CandidateResult[]; passingCandidateCount?: number }
  | {
      type: "complete";
      requestId: string;
      candidates: CandidateResult[];
      passingCandidateCount?: number;
      strictestFailureLabel?: string | null;
      offenseResults?: OffenseScenarioResult[];
    }
  | { type: "error"; requestId?: string; message: string }
  | { type: "cancel"; requestId?: string }
  | { type: "validationError"; message: string }
  | { type: "reset" };

export interface DefenceSearchWorkerClientAdapter {
  start: (
    build: Build,
    scenarios: Scenario[],
    options?: StartDefenceSearchWorkerOptions,
  ) => ActiveDefenceSearchRequest;
}

export interface BulkMaximizeWorkerClientAdapter {
  maximizeRemainingBulk: (
    input: MaximizeRemainingBulkInput,
    options?: StartMaximizeRemainingBulkWorkerOptions,
  ) => ActiveDefenceSearchRequest;
}

export type SearchUiDispatch = (action: SearchUiAction) => void;

export type BulkMaximizeStatus = "idle" | "running" | "complete" | "error" | "canceled";

export interface BulkMaximizeUiState {
  status: BulkMaximizeStatus;
  activeRequestId: string | null;
  searchedCandidates: number;
  totalCandidates: number;
  progress: number;
  result: MaximizeRemainingBulkResult | null;
  results: MaximizeRemainingBulkResult[];
  errorMessage: string | null;
}

export type BulkMaximizeUiAction =
  | { type: "start"; requestId: string }
  | {
      type: "progress";
      requestId: string;
      searchedCandidates: number;
      totalCandidates: number;
      progress: number;
    }
  | {
      type: "complete";
      requestId: string;
      result: MaximizeRemainingBulkResult | null;
      results: MaximizeRemainingBulkResult[];
      searchedCandidates: number;
      totalCandidates: number;
    }
  | { type: "error"; requestId?: string; message: string }
  | { type: "cancel"; requestId?: string }
  | { type: "validationError"; message: string }
  | { type: "reset" };

export type BulkMaximizeUiDispatch = (action: BulkMaximizeUiAction) => void;

export const createInitialSearchUiState = (): SearchUiState => ({
  status: "idle",
  activeRequestId: null,
  searchedCandidates: 0,
  totalCandidates: 0,
  progress: 0,
  candidates: [],
  passingCandidateCount: 0,
  errorMessage: null,
  strictestFailureLabel: null,
});

export const createInitialBulkMaximizeUiState = (): BulkMaximizeUiState => ({
  status: "idle",
  activeRequestId: null,
  searchedCandidates: 0,
  totalCandidates: 0,
  progress: 0,
  result: null,
  results: [],
  errorMessage: null,
});

const zeroStatPoints: StatPointTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

export const createDefaultAttackerStatPoints = (): StatPointTable => ({
  ...zeroStatPoints,
  atk: 32,
  spa: 32,
});

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  tailwind: false,
  friendGuard: false,
};

const zeroBoosts: Required<StatBoostTable> = {
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const clampProbabilityPercent = (value: number): number => clampInt(value, 0, 100) / 100;

const clampBoost = (value: number | undefined): number => clampInt(value ?? 0, -6, 6);

const normalizeBoosts = (boosts: StatBoostTable = {}): StatBoostTable => ({
  atk: clampBoost(boosts.atk),
  def: clampBoost(boosts.def),
  spa: clampBoost(boosts.spa),
  spd: clampBoost(boosts.spd),
  spe: clampBoost(boosts.spe),
});

const toDomainHpEvents = (
  hpEvents: readonly HpEventFormState[],
): HpEvent[] => hpEvents.map((event) => compileHpEventForMove({
  id: event.id,
  effectId: event.effectId,
  enabled: event.enabled,
  ...(event.toxicStage !== undefined
    ? { toxicStage: clampInt(event.toxicStage, 1, 15) }
    : {}),
  ...(event.spikesLayers !== undefined
    ? { spikesLayers: clampInt(event.spikesLayers, 1, 3) }
    : {}),
}));

const mustResolve = <K extends EntityKind>(
  kind: K,
  input: string,
  label: string,
): EntityRef<K> => {
  const result = resolveEntity(kind, input);
  const ref = toEntityRef(result, kind);
  if (!ref) {
    const suffix = result.candidates.length > 0
      ? `候補: ${result.candidates.map((candidate) => candidate.displayNameJa).join(", ")}`
      : "候補なし";
    throw new Error(`${label}「${input}」を canonical name に解決できません (${result.status}, ${suffix})`);
  }
  return ref;
};

const resolveOptional = <K extends EntityKind>(
  kind: K,
  input: string,
  label: string,
): EntityRef<K> | undefined => {
  if (!input.trim()) {
    return undefined;
  }
  return mustResolve(kind, input, label);
};

export const createDefaultTargetForm = (): TargetFormState => ({
  pokemonInput: "メガマフォクシー",
  natureInput: "おくびょう",
  abilityInput: "",
  itemInput: "",
  teraTypeInput: "",
  teraEnabled: false,
  dmaxEnabled: false,
  level: DEFAULT_LEVEL,
  levelMode: "auto",
  statPoints: { ...zeroStatPoints, atk: 0, spa: 0, spe: 0 },
  boosts: { ...zeroBoosts },
});

export const createDefaultScenarioAttackForm = (id = "attack-a", label = "攻撃A"): ScenarioAttackFormState => ({
  id,
  label,
  attackerPokemonInput: "ドドゲザン",
  attackerNatureInput: "いじっぱり",
  attackerAbilityInput: "",
  attackerItemInput: "",
  attackerTeraTypeInput: "",
  attackerTeraEnabled: false,
  attackerDmaxEnabled: false,
  attackerStatus: "none",
  defenderStatus: "none",
  attackerLevel: DEFAULT_LEVEL,
  attackerLevelMode: "auto",
  attackerStatPoints: createDefaultAttackerStatPoints(),
  attackerBoosts: { ...zeroBoosts },
  defenderBoosts: { ...zeroBoosts },
  moveInput: "ふいうち",
  movePowerMode: "auto",
  movePowerValue: 0,
  beatUpParticipants: [],
  hpEvents: [],
  repeat: 1,
  requiredSurvivedHits: 1,
  minSurvivalProbabilityPercent: 100,
  targetKoProbabilityPercent: 100,
  gameType: "singles",
  weather: "none",
  terrain: "none",
  critical: false,
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  friendGuard: false,
  speedTargetMode: "opponent",
  speedComparison: "outspeed",
  speedRequiredOffset: 1,
  speedTargetValue: 0,
  speedTargetStatus: "none",
  speedTargetItemMultiplier: "auto",
  speedTargetAbilityMultiplier: "auto",
  speedTargetTailwind: false,
  speedOpponentTailwind: false,
  speedOrderMode: "normal",
  speedItemMultiplier: "auto",
  speedAbilityMultiplier: "auto",
  tailwind: false,
});

export const applyAttackerLevelMode = (
  attackForm: ScenarioAttackFormState,
  attackerLevelMode: LevelInputMode,
): ScenarioAttackFormState => ({
  ...attackForm,
  attackerLevelMode,
  attackerLevel: attackerLevelMode === "auto"
    ? DEFAULT_LEVEL
    : attackForm.attackerLevel,
});

export const applyTargetLevelMode = (
  targetForm: TargetFormState,
  levelMode: LevelInputMode,
): TargetFormState => ({
  ...targetForm,
  levelMode,
  level: levelMode === "auto" ? DEFAULT_LEVEL : targetForm.level,
});

export const applyMoveHitCountDefaults = (
  attackForm: ScenarioAttackFormState,
  moveInput: string,
): ScenarioAttackFormState => {
  const nextMaxHits = getMoveMaxHitsFromInput(moveInput);
  const nextAttackForm = { ...attackForm, moveInput };

  if (nextMaxHits && nextMaxHits > 1) {
    return {
      ...nextAttackForm,
      repeat: nextMaxHits,
      requiredSurvivedHits: nextMaxHits,
    };
  }

  const previousMaxHits = getMoveMaxHitsFromInput(attackForm.moveInput);
  const shouldClearPreviousAutoFill = (
    previousMaxHits
    && previousMaxHits > 1
    && attackForm.repeat === previousMaxHits
    && attackForm.requiredSurvivedHits === previousMaxHits
  );

  return shouldClearPreviousAutoFill
    ? { ...nextAttackForm, repeat: 1, requiredSurvivedHits: 1 }
    : nextAttackForm;
};

const resolveMoveCanonicalName = (moveInput: string): string | undefined =>
  toEntityRef(resolveEntity("move", moveInput), "move")?.canonicalName;

const resolveMovePowerOverrideFromUi = (
  canonicalName: string,
  mode: MovePowerMode,
  value: number,
) => {
  if (
    mode === "auto"
    || !Number.isInteger(value)
    || value < 1
    || value > 10_000
  ) {
    return undefined;
  }
  return resolveAllowedMovePowerOverride(canonicalName, {
    value,
    source: mode,
  });
};

export const createDefaultBeatUpParticipants = (
  attackId = "attack",
): BeatUpParticipantFormState[] => [{
  id: `${attackId}-beat-up-attacker`,
  source: "attacker",
  pokemonInput: "",
  powerMode: "auto",
  powerValue: 0,
}];

const isBeatUpInput = (moveInput: string): boolean =>
  resolveMoveCanonicalName(moveInput) === BEAT_UP_CANONICAL_NAME;

export const applyBeatUpParticipants = (
  attackForm: ScenarioAttackFormState,
  participants: BeatUpParticipantFormState[],
): ScenarioAttackFormState => {
  const limit = getBeatUpParticipantLimit(attackForm.gameType);
  const nextParticipants = participants.slice(0, limit);
  const previousCount = Math.max(1, attackForm.beatUpParticipants.length);
  const nextCount = Math.max(1, nextParticipants.length);
  const shouldSyncRequiredHits = attackForm.requiredSurvivedHits === previousCount;
  return {
    ...attackForm,
    beatUpParticipants: nextParticipants,
    repeat: nextCount,
    requiredSurvivedHits: shouldSyncRequiredHits
      ? nextCount
      : Math.min(attackForm.requiredSurvivedHits, nextCount),
  };
};

export const applyBeatUpGameTypeDefaults = (
  attackForm: ScenarioAttackFormState,
  gameType: GameType,
): ScenarioAttackFormState => {
  const nextForm = { ...attackForm, gameType };
  if (!isBeatUpInput(attackForm.moveInput)) {
    return nextForm;
  }
  const limit = getBeatUpParticipantLimit(gameType);
  const attackerParticipant = attackForm.beatUpParticipants.find(
    (participant) => participant.source === "attacker",
  ) ?? createDefaultBeatUpParticipants(attackForm.id)[0];
  const nextParticipants = attackForm.beatUpParticipants.slice(0, limit);
  if (!nextParticipants.some((participant) => participant.source === "attacker")) {
    if (nextParticipants.length === 0) {
      nextParticipants.push(attackerParticipant);
    } else {
      nextParticipants[nextParticipants.length - 1] = attackerParticipant;
    }
  }
  return applyBeatUpParticipants(nextForm, nextParticipants);
};

export const applyMovePowerDefaults = (
  attackForm: ScenarioAttackFormState,
  moveInput: string,
): ScenarioAttackFormState => {
  const previousCanonicalName = resolveMoveCanonicalName(attackForm.moveInput);
  const nextCanonicalName = resolveMoveCanonicalName(moveInput);
  if (previousCanonicalName === nextCanonicalName) {
    return { ...attackForm, moveInput };
  }

  const assistRule = nextCanonicalName
    ? getMovePowerAssistRule(nextCanonicalName)
    : undefined;
  return {
    ...attackForm,
    moveInput,
    movePowerMode: assistRule ? "assisted" : "auto",
    movePowerValue: assistRule?.defaultPower ?? 0,
    beatUpParticipants: nextCanonicalName === BEAT_UP_CANONICAL_NAME
      ? createDefaultBeatUpParticipants(attackForm.id)
      : [],
  };
};

export const applyMoveInputDefaults = (
  attackForm: ScenarioAttackFormState,
  moveInput: string,
  syncHitCount: boolean,
): ScenarioAttackFormState => {
  const withPowerDefaults = applyMovePowerDefaults(attackForm, moveInput);
  if (!syncHitCount) {
    return withPowerDefaults;
  }

  // Both helpers must inspect the same pre-change move. Calling one helper
  // with the other's result would lose the previous move needed to clear an
  // automatically selected multi-hit count.
  const withHitCountDefaults = applyMoveHitCountDefaults(attackForm, moveInput);
  const beatUpParticipantCount = withPowerDefaults.beatUpParticipants.length;
  if (beatUpParticipantCount > 0) {
    return {
      ...withPowerDefaults,
      repeat: beatUpParticipantCount,
      requiredSurvivedHits: beatUpParticipantCount,
    };
  }
  return {
    ...withPowerDefaults,
    repeat: withHitCountDefaults.repeat,
    requiredSurvivedHits: withHitCountDefaults.requiredSurvivedHits,
  };
};

const toBeatUpMoveContext = (
  canonicalMoveName: string,
  attacker: Build,
  participants: BeatUpParticipantFormState[],
  gameType: GameType,
): BeatUpMoveContext | undefined => {
  if (canonicalMoveName !== BEAT_UP_CANONICAL_NAME) {
    return undefined;
  }
  const limit = getBeatUpParticipantLimit(gameType);
  if (participants.length < 1 || participants.length > limit) {
    throw new Error(`ふくろだたきの参加ポケモンは${gameType === "doubles" ? "ダブル4体" : "シングル3体"}までです`);
  }
  if (participants.filter((participant) => participant.source === "attacker").length !== 1) {
    throw new Error("ふくろだたきの参加ポケモンに使用者を1体指定してください");
  }

  return {
    kind: "beat-up",
    participants: participants.map((participant, participantIndex) => {
      const pokemon = participant.source === "attacker"
        ? attacker.pokemon
        : mustResolve(
          "pokemon",
          participant.pokemonInput,
          `ふくろだたき参加ポケモン${participantIndex + 1}`,
        );
      if (
        participant.powerMode === "manual"
        && (
          !Number.isInteger(participant.powerValue)
          || participant.powerValue < 1
          || participant.powerValue > 10_000
        )
      ) {
        throw new Error(`ふくろだたき参加ポケモン${participantIndex + 1}の威力が不正です`);
      }
      return {
        pokemon,
        ...(participant.powerMode === "manual"
          ? { powerOverride: participant.powerValue }
          : {}),
      };
    }),
  };
};

export const formatScenarioAttackLabel = (
  adjustmentType: ScenarioAdjustmentType,
  attackIndex: number,
  label: string,
): string => {
  const defaultPrefix = adjustmentType === "offense"
    ? "火力調整"
    : adjustmentType === "speed" ? "素早さ調整" : "耐久調整";
  const defaultLabel = `${defaultPrefix}${String.fromCharCode(65 + attackIndex)}`;
  const trimmedLabel = label.trim();

  if (!trimmedLabel || /^(?:攻撃|耐久調整|火力調整|S調整|素早さ調整)[A-Z]$/.test(trimmedLabel)) {
    return defaultLabel;
  }

  return label;
};

export const createDefaultScenarioForms = (): ScenarioFormState[] => [
  {
    id: "scenario-defence",
    label: "シナリオ1",
    enabled: true,
    adjustmentType: "defence",
    attacks: [{
      ...createDefaultScenarioAttackForm(),
      minSurvivalProbabilityPercent: 90,
    }],
  },
  {
    id: "scenario-offense",
    label: "シナリオ2",
    enabled: true,
    adjustmentType: "offense",
    attacks: [{
      ...createDefaultScenarioAttackForm(),
      attackerPokemonInput: "メガゲンガー",
      attackerNatureInput: "おくびょう",
      attackerAbilityInput: "",
      attackerStatPoints: { ...zeroStatPoints, hp: 32 },
      moveInput: "サイコキネシス",
      targetKoProbabilityPercent: 80,
    }],
  },
  {
    id: "scenario-speed",
    label: "シナリオ3",
    enabled: true,
    adjustmentType: "speed",
    attacks: [{
      ...createDefaultScenarioAttackForm(),
      attackerPokemonInput: "メガゲンガー",
      attackerNatureInput: "おくびょう",
      attackerAbilityInput: "",
      attackerItemInput: "",
      attackerStatPoints: { ...zeroStatPoints, spe: 32 },
      moveInput: "",
      speedTargetMode: "opponent",
      speedComparison: "outspeed",
      speedRequiredOffset: 1,
    }],
  },
];

export const createDefaultOffenseAdjustmentForm = (): OffenseAdjustmentFormState => ({
  defenderPokemonInput: "ピチュー",
  defenderNatureInput: "",
  defenderAbilityInput: "",
  defenderItemInput: "",
  defenderTeraTypeInput: "",
  defenderTeraEnabled: false,
  defenderDmaxEnabled: false,
  defenderStatus: "none",
  defenderLevel: 50,
  defenderStatPoints: { ...zeroStatPoints },
  defenderBoosts: { ...zeroBoosts },
  moveInput: "ふいうち",
  movePowerMode: "auto",
  movePowerValue: 0,
  beatUpParticipants: [],
  hpEvents: [],
  targetKoProbabilityPercent: 100,
  gameType: "singles",
  weather: "none",
  terrain: "none",
  critical: false,
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  friendGuard: false,
});

type BuildFormState = Omit<TargetFormState, "levelMode"> & { status?: PokemonStatus };

const toBuild = (form: BuildFormState, id: string): Build => {
  const statPoints = clampStatPointTable(form.statPoints);
  const teraType = form.teraEnabled
    ? mustResolve("type", form.teraTypeInput, "テラスタイプ")
    : undefined;
  const pokemonResult = resolveEntityWithCanonicalHint(
    "pokemon",
    form.pokemonInput,
    form.pokemonCanonicalName,
  );
  const pokemon = toEntityRef(pokemonResult, "pokemon");
  if (!pokemon) {
    const suffix = pokemonResult.candidates.length > 0
      ? `候補: ${pokemonResult.candidates.map((candidate) => candidate.displayNameJa).join(", ")}`
      : "候補なし";
    throw new Error(`ポケモン「${form.pokemonInput}」を canonical name に解決できません (${pokemonResult.status}, ${suffix})`);
  }
  const isGmaxForm = pokemon.canonicalName.endsWith("-Gmax");

  return {
    id,
    pokemon,
    level: clampInt(form.level, 1, 100),
    nature: resolveOptional("nature", form.natureInput, "性格"),
    ability: resolveOptional("ability", form.abilityInput, "特性"),
    item: resolveOptional("item", form.itemInput, "持ち物"),
    teraType,
    typeOverride: resolvePokemonTypeOverride(form.typeOverride),
    isDynamaxed: form.dmaxEnabled || isGmaxForm || undefined,
    status: form.status && form.status !== "none" ? form.status : undefined,
    ivs: defaultIvs,
    statPoints,
    evs: statPointTableToSmogonEvs(statPoints),
  };
};

export const buildTargetBuildFromUi = (
  targetForm: TargetFormState,
  id = "target",
): Build => toBuild(targetForm, id);

export const buildScenarioAttackBuildFromUi = (
  attackForm: ScenarioAttackFormState,
  id: string,
): Build => toBuild(
  {
    pokemonInput: attackForm.attackerPokemonInput,
    pokemonCanonicalName: attackForm.attackerPokemonCanonicalName,
    natureInput: attackForm.attackerNatureInput,
    abilityInput: attackForm.attackerAbilityInput,
    itemInput: attackForm.attackerItemInput,
    teraTypeInput: attackForm.attackerTeraTypeInput,
    typeOverride: attackForm.attackerTypeOverride,
    teraEnabled: attackForm.attackerTeraEnabled,
    dmaxEnabled: attackForm.attackerDmaxEnabled,
    status: attackForm.attackerStatus,
    level: attackForm.attackerLevel,
    statPoints: attackForm.attackerStatPoints,
    boosts: { ...zeroBoosts },
  },
  id,
);

const toScenarioHit = (
  scenarioForm: ScenarioFormState,
  attackForm: ScenarioAttackFormState,
  index: number,
  hitsBefore: number,
  targetBoosts: StatBoostTable,
): ScenarioHit => {
  const moveHitRange = getMoveHitCountRangeFromInput(attackForm.moveInput);
  const configuredRepeat = moveHitRange
    ? clampInt(attackForm.repeat, moveHitRange.minHits, moveHitRange.maxHits)
    : Math.max(1, clampInt(attackForm.repeat, 1, 10));
  const requiredSurvivedHits = Math.max(
    Math.max(1, clampInt(attackForm.requiredSurvivedHits, 1, 10)),
    Math.min(10, hitsBefore + 1),
  );
  const attacker = buildScenarioAttackBuildFromUi(
    attackForm,
    `${scenarioForm.id}-${attackForm.id}-attacker`,
  );
  const move = mustResolve("move", attackForm.moveInput, "技");
  const moveContext = toBeatUpMoveContext(
    move.canonicalName,
    attacker,
    attackForm.beatUpParticipants,
    attackForm.gameType,
  );
  const repeat = moveContext?.participants.length ?? configuredRepeat;
  const movePowerOverride = resolveMovePowerOverrideFromUi(
    move.canonicalName,
    attackForm.movePowerMode,
    attackForm.movePowerValue,
  );

  return {
    id: `${scenarioForm.id}-hit-${index + 1}`,
    attacker,
    defenderStatus: attackForm.defenderStatus === "none" ? undefined : attackForm.defenderStatus,
    allyAbilities: attackForm.gameType === "doubles"
      ? scenarioForm.attacks
        .filter((allyForm) => allyForm.id !== attackForm.id)
        .map((allyForm) => resolveOptional(
          "ability",
          allyForm.attackerAbilityInput,
          `${allyForm.label || "味方"}の特性`,
        ))
        .filter((ability): ability is NonNullable<typeof ability> => Boolean(ability))
        .filter((ability) => isActiveAllyAbilityCanonicalName(ability.canonicalName))
      : undefined,
    move,
    moveHits: moveContext ? repeat : moveHitRange ? repeat : undefined,
    ...(movePowerOverride ? { movePowerOverride } : {}),
    ...(moveContext ? { moveContext } : {}),
    hpEvents: toDomainHpEvents(attackForm.hpEvents ?? []),
    field: toFieldState(attackForm),
    constraint: {
      enabled: true,
      requiredSurvivedHits,
      minSurvivalProbability: clampProbabilityPercent(attackForm.minSurvivalProbabilityPercent),
    },
    repeat,
    critical: attackForm.critical,
    attackerBoosts: normalizeBoosts(attackForm.attackerBoosts),
    defenderBoosts: normalizeBoosts({
      atk: (targetBoosts.atk ?? 0) + (attackForm.defenderBoosts.atk ?? 0),
      def: (targetBoosts.def ?? 0) + (attackForm.defenderBoosts.def ?? 0),
      spa: (targetBoosts.spa ?? 0) + (attackForm.defenderBoosts.spa ?? 0),
      spd: (targetBoosts.spd ?? 0) + (attackForm.defenderBoosts.spd ?? 0),
      spe: (targetBoosts.spe ?? 0) + (attackForm.defenderBoosts.spe ?? 0),
    }),
    attackerSide: { ...emptySide, helpingHand: attackForm.helpingHand, tailwind: attackForm.tailwind },
    defenderSide: {
      ...emptySide,
      reflect: attackForm.reflect,
      lightScreen: attackForm.lightScreen,
      auroraVeil: attackForm.auroraVeil,
      friendGuard: attackForm.gameType === "doubles" && attackForm.friendGuard,
    },
  };
};

const toFieldState = (form: { gameType?: GameType; weather: Weather; terrain: Terrain }): FieldState => ({
  gameType: form.gameType ?? "singles",
  weather: form.weather,
  terrain: form.terrain,
});

const hasDamageMove = (form: ScenarioAttackFormState): boolean =>
  Boolean(form.moveInput.trim());

const defenceSearchStatKeyOrder = ["hp", "def", "spd"] as const satisfies readonly DefenceSearchStatKey[];

const mergeDefenceSearchStatKeys = (
  ...keyGroups: Array<readonly DefenceSearchStatKey[] | undefined>
): DefenceSearchStatKey[] => {
  const requested = new Set<DefenceSearchStatKey>();
  for (const keyGroup of keyGroups) {
    for (const key of keyGroup ?? []) {
      requested.add(key);
    }
  }

  return defenceSearchStatKeyOrder.filter((key) => requested.has(key));
};

const getDefenceSearchStatKeysFromScenarioForms = (
  scenarioForms: ScenarioFormState[],
): DefenceSearchStatKey[] => mergeDefenceSearchStatKeys(
  scenarioForms.flatMap((scenario) => (
    scenario.attacks
      .filter(hasDamageMove)
      .flatMap((attack) => getMoveDefenderStatKeys(attack.moveInput, {
        teraEnabled: attack.attackerTeraEnabled,
      }))
      .filter((key): key is DefenceSearchStatKey => (
        key === "hp" || key === "def" || key === "spd"
      ))
  )),
  scenarioForms.some((scenario) => (
    scenario.attacks.some((attack) => attack.hpEvents?.some((event) => (
      event.enabled
      && getHpEventRuleDefinition(event.effectId)?.subject === "defender"
    )))
  ))
    ? ["hp"]
    : [],
);

const getDefenceSearchStatKeysFromMinimums = (
  minimumStatPoints: Partial<Pick<StatPointTable, "hp" | "def" | "spd">>,
): DefenceSearchStatKey[] =>
  defenceSearchStatKeyOrder.filter((key) => (minimumStatPoints[key] ?? 0) > 0);

const toScenarioHits = (
  scenarioForm: ScenarioFormState,
  activeAttacks: ScenarioAttackFormState[],
  targetBoosts: StatBoostTable,
): ScenarioHit[] => {
  let hitsBefore = 0;
  return activeAttacks.map((attack, index) => {
    const hit = toScenarioHit(scenarioForm, attack, index, hitsBefore, targetBoosts);
    hitsBefore += hit.repeat;
    return hit;
  });
};

export const buildDefenceSearchInput = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): DefenceSearchInput => {
  const activeScenarioForms = scenarioForms.filter((form) => (
    form.enabled && form.adjustmentType === "defence"
  ));

  if (activeScenarioForms.length === 0) {
    throw new Error("有効な耐久調整シナリオがありません");
  }

  return {
    build: toBuild(targetForm, "target"),
    searchStatKeys: getDefenceSearchStatKeysFromScenarioForms(activeScenarioForms),
    scenarios: activeScenarioForms.map((form): Scenario => {
      const activeAttacks = form.attacks.filter(hasDamageMove);
      if (activeAttacks.length === 0) {
        throw new Error(`${form.label} に有効な攻撃条件がありません`);
      }
      const hits = toScenarioHits(form, activeAttacks, normalizeBoosts(targetForm.boosts));

      return {
        id: form.id,
        label: form.label,
        enabled: form.enabled,
        hits,
        field: { gameType: "singles", weather: "none", terrain: "none" },
        constraint: {
          enabled: form.enabled,
          requiredSurvivedHits: Math.max(
            1,
            ...hits.map((hit) => hit.constraint?.requiredSurvivedHits ?? 1),
          ),
          minSurvivalProbability: Math.min(
            ...activeAttacks.map((attack) => clampProbabilityPercent(attack.minSurvivalProbabilityPercent)),
          ),
        },
      };
    }),
  };
};

export const buildOffenseAdjustmentInput = (
  targetForm: TargetFormState,
  offenseForm: OffenseAdjustmentFormState,
): OffenseAdjustmentInput => {
  const move = mustResolve("move", offenseForm.moveInput, "火力調整の技");
  const attackerBuild = buildTargetBuildFromUi(targetForm, "offense-attacker");
  const moveContext = toBeatUpMoveContext(
    move.canonicalName,
    attackerBuild,
    offenseForm.beatUpParticipants,
    offenseForm.gameType,
  );
  const movePowerOverride = resolveMovePowerOverrideFromUi(
    move.canonicalName,
    offenseForm.movePowerMode,
    offenseForm.movePowerValue,
  );
  return {
    attackerBuild,
    defenderBuild: toBuild({
      pokemonInput: offenseForm.defenderPokemonInput,
      pokemonCanonicalName: offenseForm.defenderPokemonCanonicalName,
      natureInput: offenseForm.defenderNatureInput,
      abilityInput: offenseForm.defenderAbilityInput,
      itemInput: offenseForm.defenderItemInput,
      teraTypeInput: offenseForm.defenderTeraTypeInput,
      typeOverride: offenseForm.defenderTypeOverride,
      teraEnabled: offenseForm.defenderTeraEnabled,
      dmaxEnabled: offenseForm.defenderDmaxEnabled,
      status: offenseForm.defenderStatus,
      level: offenseForm.defenderLevel,
      statPoints: offenseForm.defenderStatPoints,
      boosts: { ...zeroBoosts },
    }, "offense-defender"),
    move,
    moveInput: offenseForm.moveInput,
    ...(movePowerOverride ? { movePowerOverride } : {}),
    ...(moveContext ? { moveContext } : {}),
    hpEvents: toDomainHpEvents(offenseForm.hpEvents ?? []),
    targetKoProbability: clampProbabilityPercent(offenseForm.targetKoProbabilityPercent),
    field: toFieldState(offenseForm),
    critical: offenseForm.critical,
    attackerBoosts: normalizeBoosts(targetForm.boosts),
    defenderBoosts: normalizeBoosts(offenseForm.defenderBoosts),
    attackerSide: { ...emptySide, helpingHand: offenseForm.helpingHand },
    defenderSide: {
      ...emptySide,
      reflect: offenseForm.reflect,
      lightScreen: offenseForm.lightScreen,
      auroraVeil: offenseForm.auroraVeil,
      friendGuard: offenseForm.gameType === "doubles" && offenseForm.friendGuard,
    },
    boostedNatures: {
      atk: mustResolve("nature", "いじっぱり", "A上昇補正"),
      spa: mustResolve("nature", "ひかえめ", "C上昇補正"),
    },
  };
};

export interface MovePowerPreviewInput {
  defenderBuild: Build;
  hit: ScenarioHit;
  field: FieldState;
}

export const buildMovePowerPreviewInputFromUi = (
  targetForm: TargetFormState,
  adjustmentType: ScenarioAdjustmentType,
  attackForm: ScenarioAttackFormState,
): MovePowerPreviewInput | null => {
  if (adjustmentType === "speed") {
    return null;
  }
  if (!toEntityRef(resolveEntity("move", attackForm.moveInput), "move")) {
    return null;
  }

  try {
    if (adjustmentType === "offense") {
      const offenseInput = buildOffenseAdjustmentInput(
        targetForm,
        createOffenseAdjustmentFormFromScenarioAttack(attackForm),
      );
      return {
        defenderBuild: offenseInput.defenderBuild,
        hit: buildOffenseHit(offenseInput.attackerBuild, offenseInput),
        field: offenseInput.field,
      };
    }

    const previewScenario: ScenarioFormState = {
      id: "move-power-preview",
      label: "威力プレビュー",
      enabled: true,
      adjustmentType: "defence",
      attacks: [attackForm],
    };
    const hit = toScenarioHit(
      previewScenario,
      attackForm,
      0,
      0,
      normalizeBoosts(targetForm.boosts),
    );
    return {
      defenderBuild: buildTargetBuildFromUi(targetForm, "move-power-preview-defender"),
      hit,
      field: hit.field ?? toFieldState(attackForm),
    };
  } catch {
    return null;
  }
};

export const createOffenseAdjustmentFormFromScenarioAttack = (
  attackForm: ScenarioAttackFormState,
): OffenseAdjustmentFormState => ({
  defenderPokemonInput: attackForm.attackerPokemonInput,
  defenderPokemonCanonicalName: attackForm.attackerPokemonCanonicalName,
  defenderNatureInput: attackForm.attackerNatureInput,
  defenderAbilityInput: attackForm.attackerAbilityInput,
  defenderItemInput: attackForm.attackerItemInput,
  defenderTeraTypeInput: attackForm.attackerTeraTypeInput,
  defenderTypeOverride: attackForm.attackerTypeOverride,
  defenderTeraEnabled: attackForm.attackerTeraEnabled,
  defenderDmaxEnabled: attackForm.attackerDmaxEnabled,
  defenderStatus: attackForm.attackerStatus,
  defenderLevel: attackForm.attackerLevel,
  defenderStatPoints: attackForm.attackerStatPoints,
  defenderBoosts: attackForm.attackerBoosts,
  moveInput: attackForm.moveInput,
  movePowerMode: attackForm.movePowerMode,
  movePowerValue: attackForm.movePowerValue,
  beatUpParticipants: attackForm.beatUpParticipants,
  hpEvents: attackForm.hpEvents ?? [],
  targetKoProbabilityPercent: attackForm.targetKoProbabilityPercent,
  gameType: attackForm.gameType,
  weather: attackForm.weather,
  terrain: attackForm.terrain,
  critical: attackForm.critical,
  reflect: attackForm.reflect,
  lightScreen: attackForm.lightScreen,
  auroraVeil: attackForm.auroraVeil,
  helpingHand: attackForm.helpingHand,
  friendGuard: attackForm.friendGuard,
});

const makeOffenseAdjustmentMessageResult = (
  status: OffenseAdjustmentResult["status"],
  reason: string,
): OffenseAdjustmentResult => ({
  id: `offense-${status}`,
  status,
  passed: false,
  label: status === "unresolved" ? "未解決" : "入力エラー",
  owner: "none",
  stat: null,
  role: "fixed",
  canApply: false,
  requiredStatPoints: null,
  actualStat: null,
  koProbability: 0,
  targetKoProbability: 0,
  damageRange: null,
  hpEventEvaluations: [],
  reason,
});

export const buildOffenseSequenceCondition = (
  target: TargetFormState, scenario: ScenarioFormState,
): OffenseSequenceCondition => {
  const settings = scenario.offense;
  if (!settings) throw new Error(`${scenario.label}: 共通の仮想敵を入力してください`);
  if (!settings.opponent.attackerPokemonInput.trim()) throw new Error(`${scenario.label}: 仮想敵のポケモンを入力してください`);
  if (!Object.values(settings.opponent.attackerStatPoints).every(isLegalStatPointValue)
    || !Number.isInteger(settings.opponent.attackerLevel) || settings.opponent.attackerLevel < 1 || settings.opponent.attackerLevel > 100) {
    throw new Error(`${scenario.label}: 仮想敵のSP・レベルが不正です`);
  }
  const probability = settings.targetKoProbabilityPercent;
  if (!Number.isFinite(probability) || probability < 0 || probability > 100) throw new Error("KO率は0〜100%で入力してください");
  if (!scenario.attacks.length) throw new Error(`${scenario.label}: 技を入力してください`);
  const attacks = scenario.attacks.map((attack, index) => {
    if (!attack.moveInput.trim()) throw new Error(`${scenario.label} / ${formatScenarioAttackLabel("offense", index, attack.label)}: 技を入力してください`);
    if ([...Object.values(attack.attackerBoosts), ...Object.values(attack.offenseAttackerBoosts ?? {})]
      .some((rank) => !Number.isInteger(rank) || rank < -6 || rank > 6)) throw new Error(`${scenario.label}: 能力ランクが不正です`);
    const merged = { ...attack, ...settings.opponent, targetKoProbabilityPercent: probability };
    const input = buildOffenseAdjustmentInput(target, createOffenseAdjustmentFormFromScenarioAttack(merged));
    input.attackerBoosts = { ...target.boosts, ...attack.offenseAttackerBoosts };
    input.attackerBuild = { ...input.attackerBuild, status: attack.offenseAttackerStatus === "none" ? undefined : attack.offenseAttackerStatus };
    if ((attack.hpEvents ?? []).some((event) => event.enabled && !getHpEventRuleDefinition(event.effectId))) throw new Error("計算未対応の定数ダメージ・回復が含まれています");
    const range = getMoveHitCountRangeFromInput(attack.moveInput);
    return { ...input, id: attack.id, label: formatScenarioAttackLabel("offense", index, attack.label),
      ...(range ? { moveHits: Math.max(range.minHits, Math.min(range.maxHits, Math.trunc(attack.repeat))) } : {}) };
  });
  return { id: scenario.id, scenarioId: scenario.id, scenarioLabel: scenario.label,
    defenderBuild: attacks[0].defenderBuild, targetKoProbability: probability / 100, attacks };
};

export const buildOffenseSequenceConditions = (target: TargetFormState, scenarios: ScenarioFormState[]) =>
  scenarios.filter((scenario) => scenario.enabled && scenario.adjustmentType === "offense")
    .map((scenario) => buildOffenseSequenceCondition(target, initializeOffenseScenario(scenario)));

export const calculateOffenseAdjustmentFromUi = (
  targetForm: TargetFormState,
  offenseForm: OffenseAdjustmentFormState,
): OffenseAdjustmentResult[] => {
  const moveResult = resolveEntity("move", offenseForm.moveInput);
  if (!toEntityRef(moveResult, "move")) {
    const candidates = moveResult.candidates.length > 0
      ? `候補: ${moveResult.candidates.map((candidate) => candidate.displayNameJa).join(", ")}`
      : "候補なし";
    return [makeOffenseAdjustmentMessageResult(
      "unresolved",
      `技「${offenseForm.moveInput}」を canonical name に解決できません (${moveResult.status}, ${candidates})`,
    )];
  }

  try {
    return calculateOffenseAdjustment(buildOffenseAdjustmentInput(targetForm, offenseForm));
  } catch (error) {
    return [makeOffenseAdjustmentMessageResult(
      "invalid",
      error instanceof Error ? error.message : String(error),
    )];
  }
};

const calculateLegacyOffenseAdjustmentsFromScenarios = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): OffenseScenarioResult[] => scenarioForms
  .filter((scenario) => scenario.enabled && scenario.adjustmentType === "offense")
  .flatMap((scenario) => scenario.attacks
    .filter(hasDamageMove)
    .flatMap((attack, attackIndex) => {
      const offenseForm = createOffenseAdjustmentFormFromScenarioAttack(attack);
      return calculateOffenseAdjustmentFromUi(targetForm, offenseForm).map((result) => ({
        id: `${scenario.id}-${attack.id}-${result.id}`,
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        attackId: attack.id,
        attackLabel: formatScenarioAttackLabel(scenario.adjustmentType, attackIndex, attack.label),
        result,
      }));
    }));

/** Synchronous entrypoint for static generation/tests. Interactive requests run this enumeration in a Worker. */
const resolveSequenceAllocationFromUi = (target: TargetFormState, scenarios: ScenarioFormState[]) => {
  const conditions = buildOffenseSequenceConditions(target, scenarios);
  const iterator = searchOffenseAllocation(buildTargetBuildFromUi(target), conditions, buildSpeedConditionsFromScenarios(target, scenarios));
  let next = iterator.next();
  while (!next.done) next = iterator.next();
  return { allocation: next.value, conditions };
};
export const calculateOffenseAdjustmentsFromScenarios = (target: TargetFormState, scenarios: ScenarioFormState[]): OffenseScenarioResult[] => {
  if (!scenarios.some((scenario) => scenario.adjustmentType === "offense" && scenario.offense)) return calculateLegacyOffenseAdjustmentsFromScenarios(target, scenarios);
  try {
    const { allocation, conditions } = resolveSequenceAllocationFromUi(target, scenarios);
    if (!allocation) throw new Error("火力・素早さ条件を同時に満たす合法な配分がありません");
    return allocation.evaluations.map((evaluation, index) => ({ id: evaluation.scenarioId,
      scenarioId: evaluation.scenarioId, scenarioLabel: evaluation.scenarioLabel, attackId: conditions[index].attacks[0].id,
      attackLabel: "連続攻撃", result: offenseSequenceResult(evaluation, allocation.build) }));
  } catch (error) {
    return scenarios.filter((scenario) => scenario.enabled && scenario.adjustmentType === "offense").map((scenario) => ({
      id: scenario.id, scenarioId: scenario.id, scenarioLabel: scenario.label, attackId: scenario.attacks[0]?.id ?? "", attackLabel: "連続攻撃",
      result: makeOffenseAdjustmentMessageResult("invalid", error instanceof Error ? error.message : String(error)) }));
  }
};

const hasSpeedTarget = (form: ScenarioAttackFormState): boolean =>
  form.speedTargetMode === "manual"
    ? form.speedTargetValue > 0
    : Boolean(form.attackerPokemonInput.trim());

export const buildSpeedAdjustmentInput = (
  targetForm: TargetFormState,
  attackForm: ScenarioAttackFormState,
): SpeedAdjustmentInput => {
  const hasManualTargetSpeed = attackForm.speedTargetMode === "manual" && attackForm.speedTargetValue > 0;
  const opponentBuild = hasManualTargetSpeed
    ? undefined
    : buildScenarioAttackBuildFromUi(attackForm, "speed-opponent");
  const targetBuild = buildTargetBuildFromUi(targetForm, "speed-target");

  return {
    targetBuild: {
      ...targetBuild,
      ...(attackForm.speedTargetStatus !== "none"
        ? { status: attackForm.speedTargetStatus }
        : {}),
    },
    opponentBuild,
    opponentLabel: attackForm.attackerPokemonInput.trim() || "任意S値",
    field: toFieldState(attackForm),
    targetBoosts: normalizeBoosts(targetForm.boosts),
    opponentBoosts: normalizeBoosts(attackForm.attackerBoosts),
    targetSide: { ...emptySide, tailwind: attackForm.speedTargetTailwind },
    opponentSide: { ...emptySide, tailwind: attackForm.speedOpponentTailwind },
    comparison: attackForm.speedComparison,
    orderMode: attackForm.speedOrderMode,
    requiredSpeedOffset: hasManualTargetSpeed ? 0 : clampInt(attackForm.speedRequiredOffset, 0, 10000),
    manualTargetSpeed: hasManualTargetSpeed ? clampInt(attackForm.speedTargetValue, 0, 10000) : undefined,
    targetItemMultiplier: attackForm.speedTargetItemMultiplier,
    targetAbilityMultiplier: attackForm.speedTargetAbilityMultiplier,
    opponentItemMultiplier: attackForm.speedItemMultiplier,
    opponentAbilityMultiplier: attackForm.speedAbilityMultiplier,
    boostedNature: mustResolve("nature", "おくびょう", "S上昇補正"),
  };
};

const makeSpeedAdjustmentMessageResult = (
  status: SpeedAdjustmentResult["status"],
  reason: string,
): SpeedAdjustmentResult => ({
  id: `speed-${status}`,
  status,
  passed: false,
  canApply: false,
  label: "Sライン",
  comparison: "outspeed",
  orderMode: "normal",
  relation: "miss",
  requiredStatPoints: null,
  actualSpeed: null,
  targetSpeed: 0,
  requiredSpeed: 0,
  targetStatPoints: 0,
  notes: [],
  reason,
});

export const calculateSpeedAdjustmentFromUi = (
  targetForm: TargetFormState,
  attackForm: ScenarioAttackFormState,
): SpeedAdjustmentResult => {
  try {
    return calculateSpeedAdjustment(buildSpeedAdjustmentInput(targetForm, attackForm));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return makeSpeedAdjustmentMessageResult(
      message.includes("canonical name に解決できません") ? "unresolved" : "invalid",
      message,
    );
  }
};

export interface TargetSpeedOverrideCounts {
  item: number;
  ability: number;
}

/**
 * Counts the active speed modifiers on the target build that are hidden by a
 * manual speed-condition multiplier.
 *
 * This is intentionally a UI-facing projection of the same automatic source
 * helper used by the speed calculator. It does not inspect the opponent, so a
 * missing opponent input cannot hide the target-side decoration.
 */
export const getTargetSpeedOverrideCounts = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): TargetSpeedOverrideCounts => {
  let targetBuild: Build;
  try {
    targetBuild = buildTargetBuildFromUi(targetForm, "speed-target-override");
  } catch {
    return { item: 0, ability: 0 };
  }

  let item = 0;
  let ability = 0;
  for (const scenario of scenarioForms) {
    if (!scenario.enabled || scenario.adjustmentType !== "speed") {
      continue;
    }

    for (const attack of scenario.attacks) {
      const targetBuildForAttack = attack.speedTargetStatus === "none"
        ? targetBuild
        : { ...targetBuild, status: attack.speedTargetStatus };
      const automaticSources = getAutomaticSpeedModifierSources(
        targetBuildForAttack,
        toFieldState(attack),
      );

      if (attack.speedTargetItemMultiplier !== "auto" && automaticSources.item) {
        item += 1;
      }
      if (attack.speedTargetAbilityMultiplier !== "auto" && automaticSources.ability) {
        ability += 1;
      }
    }
  }

  return { item, ability };
};

export const calculateSpeedAdjustmentsFromScenarios = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): SpeedScenarioResult[] => scenarioForms
  .filter((scenario) => scenario.enabled && scenario.adjustmentType === "speed")
  .flatMap((scenario) => scenario.attacks
    .filter(hasSpeedTarget)
    .map((attack, attackIndex) => {
      const result = calculateSpeedAdjustmentFromUi(targetForm, attack);
      return {
        id: `${scenario.id}-${attack.id}-${result.id}`,
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        attackId: attack.id,
        attackLabel: formatScenarioAttackLabel(scenario.adjustmentType, attackIndex, attack.label),
        result,
      };
    }));

type FixedOffenseStat = "atk" | "spa";
type MinimumOffenseStat = "hp" | "def" | "spd";

type OffenseRequirementChoice = {
  result: OffenseScenarioResult;
  fixedStatPoints: Partial<Record<FixedOffenseStat, number>>;
  minimumStatPoints: Partial<Record<MinimumOffenseStat, number>>;
};

type OffenseRequirementState = Omit<IntegratedOffenseRequirements, "blockingReasons">;

const isFixedOffenseStat = (stat: StatKey | null): stat is FixedOffenseStat =>
  stat === "atk" || stat === "spa";

const isMinimumOffenseStat = (stat: StatKey | null): stat is MinimumOffenseStat =>
  stat === "hp" || stat === "def" || stat === "spd";

const getOffenseResultSourceLabel = (entry: OffenseScenarioResult): string =>
  `${entry.scenarioLabel} / ${entry.attackLabel} / ${entry.result.label}`;

const createOffenseRequirementChoice = (
  entry: OffenseScenarioResult,
): OffenseRequirementChoice | null => {
  const { result } = entry;
  if (
    !result.passed
    || result.owner !== "attacker"
    || result.stat === null
    || result.requiredStatPoints === null
  ) {
    return null;
  }

  if (isFixedOffenseStat(result.stat)) {
    return {
      result: entry,
      fixedStatPoints: { [result.stat]: result.requiredStatPoints },
      minimumStatPoints: {},
    };
  }

  if (isMinimumOffenseStat(result.stat)) {
    return {
      result: entry,
      fixedStatPoints: {},
      minimumStatPoints: { [result.stat]: result.requiredStatPoints },
    };
  }

  return null;
};

const mergeOffenseRequirementChoice = (
  state: OffenseRequirementState,
  choice: OffenseRequirementChoice,
): OffenseRequirementState => ({
  fixedStatPoints: {
    atk: Math.max(state.fixedStatPoints.atk ?? 0, choice.fixedStatPoints.atk ?? 0),
    spa: Math.max(state.fixedStatPoints.spa ?? 0, choice.fixedStatPoints.spa ?? 0),
  },
  minimumStatPoints: {
    hp: Math.max(state.minimumStatPoints.hp ?? 0, choice.minimumStatPoints.hp ?? 0),
    def: Math.max(state.minimumStatPoints.def ?? 0, choice.minimumStatPoints.def ?? 0),
    spd: Math.max(state.minimumStatPoints.spd ?? 0, choice.minimumStatPoints.spd ?? 0),
  },
  selectedResults: [...state.selectedResults, choice.result],
});

const getOffenseRequirementCost = (
  state: OffenseRequirementState,
  baseStatPoints: StatPointTable,
): number => (
  Math.max(baseStatPoints.atk, state.fixedStatPoints.atk ?? 0)
  + Math.max(baseStatPoints.spa, state.fixedStatPoints.spa ?? 0)
  + baseStatPoints.spe
  + (state.minimumStatPoints.hp ?? 0)
  + (state.minimumStatPoints.def ?? 0)
  + (state.minimumStatPoints.spd ?? 0)
);

const compareOffenseRequirementStates = (
  left: OffenseRequirementState,
  right: OffenseRequirementState,
  baseStatPoints: StatPointTable,
): number => {
  const leftCost = getOffenseRequirementCost(left, baseStatPoints);
  const rightCost = getOffenseRequirementCost(right, baseStatPoints);
  if (leftCost !== rightCost) {
    return leftCost - rightCost;
  }

  const leftFixed = (left.fixedStatPoints.atk ?? 0) + (left.fixedStatPoints.spa ?? 0);
  const rightFixed = (right.fixedStatPoints.atk ?? 0) + (right.fixedStatPoints.spa ?? 0);
  if (leftFixed !== rightFixed) {
    return leftFixed - rightFixed;
  }

  return left.selectedResults.length - right.selectedResults.length;
};

const pruneOffenseRequirementStates = (
  states: OffenseRequirementState[],
  baseStatPoints: StatPointTable,
): OffenseRequirementState[] => {
  const bestByKey = new Map<string, OffenseRequirementState>();
  for (const state of states) {
    const key = [
      state.fixedStatPoints.atk ?? 0,
      state.fixedStatPoints.spa ?? 0,
      state.minimumStatPoints.hp ?? 0,
      state.minimumStatPoints.def ?? 0,
      state.minimumStatPoints.spd ?? 0,
    ].join(":");
    const current = bestByKey.get(key);
    if (!current || compareOffenseRequirementStates(state, current, baseStatPoints) < 0) {
      bestByKey.set(key, state);
    }
  }

  return Array.from(bestByKey.values())
    .sort((left, right) => compareOffenseRequirementStates(left, right, baseStatPoints))
    .slice(0, 32);
};

export const createOffenseSearchBaselineTargetForm = (
  targetForm: TargetFormState,
): TargetFormState => ({
  ...targetForm,
  statPoints: {
    ...targetForm.statPoints,
    hp: 0,
    def: 0,
    spd: 0,
  },
});

export const calculateOffenseAdjustmentsForCandidateRanking = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): OffenseScenarioResult[] => calculateOffenseAdjustmentsFromScenarios(
  createOffenseSearchBaselineTargetForm(targetForm),
  scenarioForms,
);

export const calculateSpeedAdjustmentsForCandidateRanking = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): SpeedScenarioResult[] => calculateSpeedAdjustmentsFromScenarios(
  createOffenseSearchBaselineTargetForm(targetForm),
  scenarioForms,
);

export const resolveIntegratedOffenseRequirements = (
  targetForm: TargetFormState,
  offenseResults: OffenseScenarioResult[],
): IntegratedOffenseRequirements => {
  const baseStatPoints = clampStatPointTable(targetForm.statPoints);
  const groupedResults = new Map<string, OffenseScenarioResult[]>();
  const blockingReasons: string[] = [];
  let states: OffenseRequirementState[] = [{
    fixedStatPoints: {},
    minimumStatPoints: {},
    selectedResults: [],
  }];

  for (const entry of offenseResults) {
    const key = `${entry.scenarioId}:${entry.attackId}`;
    groupedResults.set(key, [...(groupedResults.get(key) ?? []), entry]);
  }

  for (const group of groupedResults.values()) {
    const choices = group
      .map(createOffenseRequirementChoice)
      .filter((choice): choice is OffenseRequirementChoice => Boolean(choice));

    if (choices.length > 0) {
      states = pruneOffenseRequirementStates(
        states.flatMap((state) => choices.map((choice) => mergeOffenseRequirementChoice(state, choice))),
        baseStatPoints,
      );
      continue;
    }

    if (!group.some((entry) => entry.result.passed)) {
      const failed = group.find((entry) => !entry.result.passed) ?? group[0];
      blockingReasons.push(`${getOffenseResultSourceLabel(failed)}: ${failed.result.reason}`);
    }
  }

  const best = pruneOffenseRequirementStates(states, baseStatPoints)[0] ?? {
    fixedStatPoints: {},
    minimumStatPoints: {},
    selectedResults: [],
  };

  return {
    ...best,
    blockingReasons,
  };
};

export const applyIntegratedOffenseRequirementsToTargetForm = (
  targetForm: TargetFormState,
  requirements: IntegratedOffenseRequirements,
): TargetFormState => {
  const statPoints = clampStatPointTable(targetForm.statPoints);
  return {
    ...targetForm,
    statPoints: {
      ...statPoints,
      atk: Math.max(statPoints.atk, requirements.fixedStatPoints.atk ?? 0),
      spa: Math.max(statPoints.spa, requirements.fixedStatPoints.spa ?? 0),
    },
  };
};

export const buildSpeedConditionsFromScenarios = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): SpeedScenarioCondition[] => scenarioForms
  .filter((scenario) => scenario.enabled && scenario.adjustmentType === "speed")
  .flatMap((scenario) => scenario.attacks.flatMap((attack, attackIndex) => {
    if (!hasSpeedTarget(attack)) return [];
    const { targetBuild, boostedNature: _boostedNature, ...condition } = buildSpeedAdjustmentInput(targetForm, attack);
    return [{
      id: `${scenario.id}-${attack.id}-speed-evaluation`,
      scenarioId: scenario.id,
      scenarioLabel: scenario.label,
      attackId: attack.id,
      attackLabel: formatScenarioAttackLabel(scenario.adjustmentType, attackIndex, attack.label),
      condition: { ...condition, targetStatus: targetBuild.status },
    }];
  }));

export const resolveIntegratedSpeedRequirements = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): IntegratedSpeedRequirements => {
  const baseStatPoints = clampStatPointTable(targetForm.statPoints);
  const speedConditions = buildSpeedConditionsFromScenarios(targetForm, scenarioForms);
  if (speedConditions.length === 0) {
    return { fixedStatPoints: { spe: baseStatPoints.spe }, selectedResults: [], speedConditions, blockingReasons: [] };
  }
  const build = buildTargetBuildFromUi(targetForm, "integrated-speed-target");
  const maxSpe = Math.min(CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
    CHAMPIONS_TOTAL_STAT_POINTS - sumStatPoints(baseStatPoints) + baseStatPoints.spe);

  // Each condition is checked at the same S; a downward proposal is not proof
  // that the user's fixed S satisfies a Trick Room upper bound.
  for (let spe = baseStatPoints.spe; spe <= maxSpe; spe += 1) {
    const statPoints = { ...baseStatPoints, spe };
    const selectedResults = evaluateSpeedConditions({
      ...build, statPoints, evs: statPointTableToSmogonEvs(statPoints),
    }, speedConditions);
    if (selectedResults.every((entry) => entry.result.passed)) {
      return { fixedStatPoints: { spe }, selectedResults, speedConditions, blockingReasons: [] };
    }
  }

  const currentResults = evaluateSpeedConditions(build, speedConditions);
  return {
    fixedStatPoints: { spe: baseStatPoints.spe },
    selectedResults: [],
    speedConditions,
    blockingReasons: [
      `入力済みS${baseStatPoints.spe} SP以上で、すべての素早さ条件を満たす配分がありません`,
      ...currentResults.map((entry, index) => {
        const proposal = !entry.result.passed && entry.result.orderMode === "trick-room"
          ? calculateSpeedAdjustment(buildSpeedConditionInput(build, speedConditions[index]))
          : undefined;
        const hint = proposal?.passed && proposal.requiredStatPoints !== null
          ? `（S${proposal.requiredStatPoints} SPへの変更でこの条件を達成できます）` : "";
        return `${entry.scenarioLabel} / ${entry.attackLabel}: ${entry.result.reason}${hint}`;
      }),
    ],
  };
};

export const applyIntegratedSpeedRequirementsToTargetForm = (
  targetForm: TargetFormState,
  requirements: IntegratedSpeedRequirements,
): TargetFormState => {
  const statPoints = clampStatPointTable(targetForm.statPoints);
  return {
    ...targetForm,
    statPoints: {
      ...statPoints,
      spe: Math.max(statPoints.spe, requirements.fixedStatPoints.spe ?? 0),
    },
  };
};

export const buildIntegratedDefenceSearchInput = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): DefenceSearchInput => {
  if (scenarioForms.some((scenario) => scenario.adjustmentType === "offense" && scenario.offense)) {
    const baseline = createOffenseSearchBaselineTargetForm(targetForm);
    const { allocation, conditions } = resolveSequenceAllocationFromUi(baseline, scenarioForms);
    if (!allocation) throw new Error("火力・素早さ条件を同時に満たす合法な配分がありません");
    const input = buildDefenceSearchInput({ ...baseline, statPoints: allocation.build.statPoints! }, scenarioForms);
    return { ...input, build: allocation.build, minimumStatPoints: allocation.minimumStatPoints,
      offenseConditions: conditions, speedConditions: buildSpeedConditionsFromScenarios(baseline, scenarioForms),
      searchStatKeys: mergeDefenceSearchStatKeys(input.searchStatKeys, getDefenceSearchStatKeysFromMinimums(allocation.minimumStatPoints)) };
  }
  const baselineTargetForm = createOffenseSearchBaselineTargetForm(targetForm);
  const offenseResults = calculateOffenseAdjustmentsFromScenarios(baselineTargetForm, scenarioForms);
  const requirements = resolveIntegratedOffenseRequirements(baselineTargetForm, offenseResults);
  if (requirements.blockingReasons.length > 0) {
    throw new Error(`火力調整条件を候補一覧へ統合できません: ${requirements.blockingReasons.join(" / ")}`);
  }
  const offenseTargetForm = applyIntegratedOffenseRequirementsToTargetForm(baselineTargetForm, requirements);
  const speedRequirements = resolveIntegratedSpeedRequirements(offenseTargetForm, scenarioForms);
  if (speedRequirements.blockingReasons.length > 0) {
    throw new Error(`素早さ調整条件を候補一覧へ統合できません: ${speedRequirements.blockingReasons.join(" / ")}`);
  }

  const integratedTargetForm = applyIntegratedSpeedRequirementsToTargetForm(
    offenseTargetForm,
    speedRequirements,
  );
  const fixedBudget =
    integratedTargetForm.statPoints.atk
    + integratedTargetForm.statPoints.spa
    + integratedTargetForm.statPoints.spe;
  const minimumDefenceBudget =
    (requirements.minimumStatPoints.hp ?? 0)
    + (requirements.minimumStatPoints.def ?? 0)
    + (requirements.minimumStatPoints.spd ?? 0);

  if (fixedBudget + minimumDefenceBudget > CHAMPIONS_TOTAL_STAT_POINTS) {
    throw new Error(
      `火力/素早さ調整込みの必要SPが合計${CHAMPIONS_TOTAL_STAT_POINTS}を超えています`
      + ` (固定 ${fixedBudget} + 火力最低 ${minimumDefenceBudget})`,
    );
  }

  const defenceInput = buildDefenceSearchInput(integratedTargetForm, scenarioForms);
  return {
    ...defenceInput,
    speedConditions: speedRequirements.speedConditions,
    minimumStatPoints: requirements.minimumStatPoints,
    searchStatKeys: mergeDefenceSearchStatKeys(
      defenceInput.searchStatKeys,
      getDefenceSearchStatKeysFromMinimums(requirements.minimumStatPoints),
    ),
  };
};

/** Normalize only. Allocation belongs to the Worker, never to an input render. */
export const buildUnallocatedSearchInput = (target: TargetFormState, scenarios: ScenarioFormState[]): DefenceSearchInput => {
  if (!isLegalStatPointTable(target.statPoints)) throw new Error("SPは各能力0〜32、合計66以内で入力してください");
  const baseline = createOffenseSearchBaselineTargetForm(target);
  const defence: DefenceSearchInput = scenarios.some((scenario) => scenario.enabled && scenario.adjustmentType === "defence")
    ? buildDefenceSearchInput(baseline, scenarios) : { build: buildTargetBuildFromUi(baseline), scenarios: [], searchStatKeys: [] };
  return { ...defence,
    offenseConditions: buildOffenseSequenceConditions(baseline, scenarios),
    speedConditions: buildSpeedConditionsFromScenarios(baseline, scenarios) };
};

type GeneratedNatureOption = {
  label: string;
};

const generatedNatureOptions = natureOptionsData.entries as GeneratedNatureOption[];

const createBulkNatureCandidates = (): BulkNatureCandidate[] =>
  generatedNatureOptions.map((option) => ({
    nature: mustResolve("nature", option.label, "性格候補"),
  }));

const getProtectedActualStatsForBulkMaximize = (
  build: Build,
  offenseRequirements: IntegratedOffenseRequirements,
): Partial<Pick<StatPointTable, "atk" | "spa" | "spe">> => {
  const stats = getBuildDerivedStats(build);
  const protectedStats: Partial<Pick<StatPointTable, "atk" | "spa" | "spe">> = {};

  if (offenseRequirements.selectedResults.some((entry) => entry.result.stat === "atk")) {
    protectedStats.atk = stats.atk;
  }
  if (offenseRequirements.selectedResults.some((entry) => entry.result.stat === "spa")) {
    protectedStats.spa = stats.spa;
  }
  return protectedStats;
};

export const buildMaximizeRemainingBulkInputFromUi = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
  options: { allowNatureChange: boolean },
): MaximizeRemainingBulkInput => {
  if (scenarioForms.some((scenario) => scenario.adjustmentType === "offense" && scenario.offense)) {
    const { allocation, conditions } = resolveSequenceAllocationFromUi(createOffenseSearchBaselineTargetForm(targetForm), scenarioForms);
    if (!allocation) throw new Error("火力・素早さ条件を同時に満たす合法な配分がありません");
    return { build: allocation.build, currentBuild: buildTargetBuildFromUi(targetForm),
      minimumStatPoints: allocation.minimumStatPoints, offenseConditions: conditions,
      speedConditions: buildSpeedConditionsFromScenarios(targetForm, scenarioForms),
      allowNatureChange: options.allowNatureChange,
      natureCandidates: options.allowNatureChange ? createBulkNatureCandidates() : undefined };
  }
  const baselineTargetForm = createOffenseSearchBaselineTargetForm(targetForm);
  const offenseResults = calculateOffenseAdjustmentsFromScenarios(baselineTargetForm, scenarioForms);
  const offenseRequirements = resolveIntegratedOffenseRequirements(baselineTargetForm, offenseResults);
  if (offenseRequirements.blockingReasons.length > 0) {
    throw new Error(`火力調整条件を耐久最大化へ統合できません: ${offenseRequirements.blockingReasons.join(" / ")}`);
  }
  const speedRequirements = resolveIntegratedSpeedRequirements(
    applyIntegratedOffenseRequirementsToTargetForm(baselineTargetForm, offenseRequirements),
    scenarioForms,
  );
  if (speedRequirements.blockingReasons.length > 0) {
    throw new Error(`素早さ調整条件を耐久最大化へ統合できません: ${speedRequirements.blockingReasons.join(" / ")}`);
  }

  const integratedTargetForm = applyIntegratedSpeedRequirementsToTargetForm(
    applyIntegratedOffenseRequirementsToTargetForm(targetForm, offenseRequirements),
    speedRequirements,
  );
  const fixedBudget =
    integratedTargetForm.statPoints.atk
    + integratedTargetForm.statPoints.spa
    + integratedTargetForm.statPoints.spe;
  const minimumDefenceBudget =
    (offenseRequirements.minimumStatPoints.hp ?? 0)
    + (offenseRequirements.minimumStatPoints.def ?? 0)
    + (offenseRequirements.minimumStatPoints.spd ?? 0);

  if (fixedBudget + minimumDefenceBudget > CHAMPIONS_TOTAL_STAT_POINTS) {
    throw new Error(
      `火力/素早さ調整込みの必要SPが合計${CHAMPIONS_TOTAL_STAT_POINTS}を超えています`
      + ` (固定 ${fixedBudget} + 火力最低 ${minimumDefenceBudget})`,
    );
  }

  const build = buildTargetBuildFromUi(integratedTargetForm, "target-bulk-maximize");
  return {
    build,
    allowNatureChange: options.allowNatureChange,
    natureCandidates: options.allowNatureChange ? createBulkNatureCandidates() : undefined,
    minimumStatPoints: offenseRequirements.minimumStatPoints,
    speedConditions: speedRequirements.speedConditions,
    protectedActualStats: getProtectedActualStatsForBulkMaximize(
      build,
      offenseRequirements,
    ),
    keepCurrentPhysicalSpecialBulk: true,
  };
};

const isActiveRequest = (state: SearchUiState, requestId: string): boolean =>
  state.activeRequestId === requestId;

const isActiveBulkRequest = (state: BulkMaximizeUiState, requestId: string): boolean =>
  state.activeRequestId === requestId;

export const searchUiReducer = (
  state: SearchUiState,
  action: SearchUiAction,
): SearchUiState => {
  if ("requestId" in action && action.requestId && !isActiveRequest(state, action.requestId)) {
    if (action.type !== "start") {
      return state;
    }
  }

  switch (action.type) {
    case "start":
      return {
        status: "running",
        activeRequestId: action.requestId,
        searchedCandidates: 0,
        totalCandidates: 0,
        progress: 0,
        candidates: [],
        passingCandidateCount: 0,
        errorMessage: null,
        strictestFailureLabel: null,
      };
    case "progress":
      return {
        ...state,
        searchedCandidates: action.searchedCandidates,
        totalCandidates: action.totalCandidates,
        progress: action.progress,
      };
    case "partialResult":
      return {
        ...state,
        candidates: action.candidates,
        passingCandidateCount: action.passingCandidateCount ?? action.candidates.length,
      };
    case "complete":
      return {
        offenseResults: action.offenseResults,
        ...state,
        status: "complete",
        activeRequestId: null,
        progress: 1,
        candidates: action.candidates,
        passingCandidateCount: action.passingCandidateCount ?? action.candidates.length,
        strictestFailureLabel: action.strictestFailureLabel ?? null,
      };
    case "error":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        errorMessage: action.message,
        strictestFailureLabel: null,
      };
    case "cancel":
      return {
        ...state,
        status: "canceled",
        activeRequestId: null,
      };
    case "validationError":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        errorMessage: action.message,
        strictestFailureLabel: null,
      };
    case "reset":
      return createInitialSearchUiState();
    default:
      return state;
  }
};

export const bulkMaximizeUiReducer = (
  state: BulkMaximizeUiState,
  action: BulkMaximizeUiAction,
): BulkMaximizeUiState => {
  if ("requestId" in action && action.requestId && !isActiveBulkRequest(state, action.requestId)) {
    if (action.type !== "start") {
      return state;
    }
  }

  switch (action.type) {
    case "start":
      return {
        status: "running",
        activeRequestId: action.requestId,
        searchedCandidates: 0,
        totalCandidates: 0,
        progress: 0,
        result: null,
        results: [],
        errorMessage: null,
      };
    case "progress":
      return {
        ...state,
        searchedCandidates: action.searchedCandidates,
        totalCandidates: action.totalCandidates,
        progress: action.progress,
      };
    case "complete":
      return {
        ...state,
        status: "complete",
        activeRequestId: null,
        searchedCandidates: action.searchedCandidates,
        totalCandidates: action.totalCandidates,
        progress: 1,
        result: action.result,
        results: action.results,
        errorMessage: null,
      };
    case "error":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        errorMessage: action.message,
      };
    case "cancel":
      return {
        ...state,
        status: "canceled",
        activeRequestId: null,
      };
    case "validationError":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        result: null,
        errorMessage: action.message,
      };
    case "reset":
      return createInitialBulkMaximizeUiState();
    default:
      return state;
  }
};

export const startDefenceSearchFromUi = (
  client: DefenceSearchWorkerClientAdapter,
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
  dispatch: SearchUiDispatch,
  options: { requestId?: string; maxResults?: number | null; partialResultLimit?: number } = {},
): { request: ActiveDefenceSearchRequest; input: DefenceSearchInput } => {
  const input = buildUnallocatedSearchInput(targetForm, scenarioForms);
  const requestId = options.requestId ?? createDefenceSearchRequestId();
  dispatch({ type: "start", requestId });

  const request = client.start(input.build, input.scenarios, {
    requestId,
    maxResults: options.maxResults ?? null,
    partialResultLimit: options.partialResultLimit ?? 20,
    minimumStatPoints: input.minimumStatPoints,
    searchStatKeys: input.searchStatKeys,
    speedConditions: input.speedConditions,
    offenseConditions: input.offenseConditions,
    prepareOffenseAllocation: true,
    standalone: input.scenarios.length === 0,
    progressInterval: 250,
    partialResultInterval: 1,
    yieldEvery: 250,
    callbacks: {
      onProgress: (message) => dispatch({
        type: "progress",
        requestId: message.requestId,
        searchedCandidates: message.searchedCandidates,
        totalCandidates: message.totalCandidates,
        progress: message.progress,
      }),
      onPartialResult: (message) => dispatch({
        type: "partialResult",
        requestId: message.requestId,
        candidates: message.candidates,
        passingCandidateCount: message.passingCandidateCount,
      }),
      onComplete: (message) => dispatch({
        type: "complete",
        requestId: message.requestId,
        candidates: message.candidates,
        passingCandidateCount: message.passingCandidateCount,
        strictestFailureLabel: message.strictestFailureLabel ?? null,
        offenseResults: message.offenseResults,
      }),
      onError: (message) => dispatch({
        type: "error",
        requestId: message.requestId,
        message: message.message,
      }),
    },
  });

  return { request, input };
};

export const startMaximizeRemainingBulkFromUi = (
  client: BulkMaximizeWorkerClientAdapter,
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
  dispatch: BulkMaximizeUiDispatch,
  options: { requestId?: string; allowNatureChange: boolean; maxResults?: number } = {
    allowNatureChange: false,
  },
): { request: ActiveDefenceSearchRequest; input: MaximizeRemainingBulkInput } => {
  const input: MaximizeRemainingBulkInput = {
    build: buildTargetBuildFromUi(targetForm), allowNatureChange: options.allowNatureChange,
    natureCandidates: options.allowNatureChange ? createBulkNatureCandidates() : undefined,
    offenseConditions: buildOffenseSequenceConditions(targetForm, scenarioForms),
    speedConditions: buildSpeedConditionsFromScenarios(targetForm, scenarioForms), prepareOffenseAllocation: true,
  };
  const requestId = options.requestId ?? createBulkMaximizeRequestId();
  dispatch({ type: "start", requestId });

  const request = client.maximizeRemainingBulk(input, {
    requestId,
    maxResults: options.maxResults ?? 50,
    callbacks: {
      onBulkProgress: (message) => dispatch({
        type: "progress",
        requestId: message.requestId,
        searchedCandidates: message.searchedCandidates,
        totalCandidates: message.totalCandidates,
        progress: message.progress,
      }),
      onBulkComplete: (message) => dispatch({
        type: "complete",
        requestId: message.requestId,
        result: message.result,
        results: message.results,
        searchedCandidates: message.searchedCandidates,
        totalCandidates: message.totalCandidates,
      }),
      onBulkError: (message) => dispatch({
        type: "error",
        requestId: message.requestId,
        message: message.message,
      }),
    },
  });

  return { request, input };
};

export const applyCandidateToTarget = (
  targetForm: TargetFormState,
  candidate: CandidateResult | undefined,
): TargetFormState => {
  if (!candidate) {
    return targetForm;
  }

  return {
    ...targetForm,
    statPoints: { ...candidate.appliedStatPoints },
  };
};

export const applyTopCandidateToTarget = (
  targetForm: TargetFormState,
  candidates: CandidateResult[],
): TargetFormState => applyCandidateToTarget(targetForm, candidates[0]);

export const applyOffenseAdjustmentToTarget = (
  targetForm: TargetFormState,
  result: OffenseAdjustmentResult | undefined,
): TargetFormState => {
  if (result?.canApply && result.requiredAllocation) {
    const points = { ...targetForm.statPoints, atk: result.requiredAllocation.atk, spa: result.requiredAllocation.spa,
      hp: Math.max(targetForm.statPoints.hp, result.requiredAllocation.hp),
      def: Math.max(targetForm.statPoints.def, result.requiredAllocation.def),
      spd: Math.max(targetForm.statPoints.spd, result.requiredAllocation.spd),
      spe: Math.max(targetForm.statPoints.spe, result.requiredAllocation.spe) };
    return sumStatPoints(points) <= CHAMPIONS_TOTAL_STAT_POINTS ? { ...targetForm, statPoints: points } : targetForm;
  }
  if (
    !result?.canApply
    || result.requiredStatPoints === null
    || (result.stat !== "atk" && result.stat !== "spa")
  ) {
    return targetForm;
  }

  const nextValue = clampStatPointValue(result.requiredStatPoints);
  const usedByOtherStats = sumStatPoints(targetForm.statPoints) - targetForm.statPoints[result.stat];
  const cappedValue = Math.min(nextValue, Math.max(0, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats));

  return {
    ...targetForm,
    statPoints: {
      ...targetForm.statPoints,
      [result.stat]: cappedValue,
    },
  };
};

export const applySpeedAdjustmentToTarget = (
  targetForm: TargetFormState,
  result: SpeedAdjustmentResult | undefined,
): TargetFormState => {
  if (!result?.canApply || result.requiredStatPoints === null) {
    return targetForm;
  }

  const nextValue = clampStatPointValue(result.requiredStatPoints);
  const usedByOtherStats = sumStatPoints(targetForm.statPoints) - targetForm.statPoints.spe;
  const cappedValue = Math.min(nextValue, Math.max(0, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats));

  return {
    ...targetForm,
    statPoints: {
      ...targetForm.statPoints,
      spe: cappedValue,
    },
  };
};

export const applyMaximizeRemainingBulkToTarget = (
  targetForm: TargetFormState,
  result: MaximizeRemainingBulkResult | null | undefined,
): TargetFormState => {
  if (!result) {
    return targetForm;
  }

  return {
    ...targetForm,
    natureInput: result.candidate.natureCanonicalName ? result.candidate.nature : targetForm.natureInput,
    statPoints: { ...result.candidate.statPoints },
  };
};
