import {
  createDefaultScenarioAttackForm,
  createDefaultBeatUpParticipants,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  DEFAULT_LEVEL,
  type LevelInputMode,
  type HpEventFormState,
  type BeatUpParticipantFormState,
  type MovePowerMode,
  type ScenarioAdjustmentType,
  type ScenarioAttackFormState,
  type ScenarioFormState,
  type TargetFormState,
} from "./defenceSearchUi";
import type { PokemonStatus } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { isSupportedHpEventEffectId } from "../domain/hpEvents";
import { resolveAllowedMovePowerOverride } from "../calc/movePowerRules";
import { resolveEntity } from "../localization/resolver";
import {
  BEAT_UP_CANONICAL_NAME,
  getBeatUpParticipantLimit,
} from "../calc/beatUp";

export const SHARE_SCHEMA_VERSION = 11;

export interface ShareStateDocument {
  schemaVersion: typeof SHARE_SCHEMA_VERSION;
  target: TargetFormState;
  scenarios: ScenarioFormState[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeObject = <T extends object>(base: T, value: unknown): T => (
  isRecord(value) ? { ...base, ...value } as T : base
);

const pokemonStatuses = new Set<PokemonStatus>(["none", "slp", "psn", "brn", "frz", "par", "tox"]);
const scenarioAdjustmentTypes = new Set<ScenarioAdjustmentType>(["defence", "offense", "speed"]);
const speedTargetModes = new Set<ScenarioAttackFormState["speedTargetMode"]>(["opponent", "manual"]);
const speedComparisons = new Set<ScenarioAttackFormState["speedComparison"]>(["outspeed", "tie"]);
type LegacySpeedMoveModifier = "none" | "tailwind" | "trick-room";
const speedMoveModifiers = new Set<LegacySpeedMoveModifier>(["none", "tailwind", "trick-room"]);
const speedManualMultipliers = new Set<ScenarioAttackFormState["speedItemMultiplier"]>(["auto", "2", "1.5", "0.5"]);
const speedOrderModes = new Set<ScenarioAttackFormState["speedOrderMode"]>(["normal", "trick-room"]);
const movePowerModes = new Set<MovePowerMode>(["auto", "assisted", "manual"]);
const levelInputModes = new Set<LevelInputMode>(["auto", "manual"]);
type SupportedShareSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | typeof SHARE_SCHEMA_VERSION;

const normalizeBeatUpParticipants = (
  value: unknown,
  sourceSchemaVersion: SupportedShareSchemaVersion,
  attackIndex: number,
  attackId: string,
  canonicalMoveName: string | undefined,
  gameType: ScenarioAttackFormState["gameType"],
): BeatUpParticipantFormState[] => {
  if (sourceSchemaVersion < 9) {
    return canonicalMoveName === BEAT_UP_CANONICAL_NAME
      ? createDefaultBeatUpParticipants(attackId)
      : [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`条件JSONの攻撃${attackIndex + 1}に beatUpParticipants がありません`);
  }
  if (canonicalMoveName !== BEAT_UP_CANONICAL_NAME) {
    if (value.length > 0) {
      throw new Error(`条件JSONの攻撃${attackIndex + 1}に技と一致しないふくろだたき設定があります`);
    }
    return [];
  }

  const limit = getBeatUpParticipantLimit(gameType);
  if (value.length < 1 || value.length > limit) {
    throw new Error(`条件JSONの攻撃${attackIndex + 1}のふくろだたき参加枠が上限を超えています`);
  }
  const participants = value.map((participant, participantIndex): BeatUpParticipantFormState => {
    if (!isRecord(participant)) {
      throw new Error(`条件JSONの攻撃${attackIndex + 1}に不正なふくろだたき参加枠があります`);
    }
    const source = participant.source;
    const pokemonInput = participant.pokemonInput;
    const powerMode = participant.powerMode;
    const powerValue = participant.powerValue;
    if (source !== "attacker" && source !== "party") {
      throw new Error(`条件JSONの攻撃${attackIndex + 1}に不正なふくろだたき参加種別があります`);
    }
    if (typeof pokemonInput !== "string" || (source === "party" && !pokemonInput.trim())) {
      throw new Error(`条件JSONの攻撃${attackIndex + 1}の参加ポケモン${participantIndex + 1}が未入力です`);
    }
    if (
      source === "party"
      && !toEntityRef(resolveEntity("pokemon", pokemonInput), "pokemon")
    ) {
      throw new Error(`条件JSONの攻撃${attackIndex + 1}の参加ポケモン${participantIndex + 1}を解決できません`);
    }
    if (powerMode !== "auto" && powerMode !== "manual") {
      throw new Error(`条件JSONの攻撃${attackIndex + 1}に不正なふくろだたき威力モードがあります`);
    }
    if (
      typeof powerValue !== "number"
      || !Number.isInteger(powerValue)
      || !Number.isFinite(powerValue)
      || (powerMode === "auto" ? powerValue !== 0 : powerValue < 1 || powerValue > 10_000)
    ) {
      throw new Error(`条件JSONの攻撃${attackIndex + 1}に不正なふくろだたき威力があります`);
    }
    return {
      id: typeof participant.id === "string" && participant.id
        ? participant.id
        : `${attackId}-beat-up-${participantIndex + 1}`,
      source,
      pokemonInput,
      powerMode,
      powerValue,
    };
  });
  if (participants.filter((participant) => participant.source === "attacker").length !== 1) {
    throw new Error(`条件JSONの攻撃${attackIndex + 1}のふくろだたき使用者枠が不正です`);
  }
  return participants;
};

const normalizeHpEventNumber = (
  value: unknown,
  min: number,
  max: number,
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const normalizeHpEvents = (
  value: unknown,
  sourceSchemaVersion: SupportedShareSchemaVersion,
): HpEventFormState[] => {
  if (sourceSchemaVersion < 3 || !Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((event, index): HpEventFormState => {
      const effectId = typeof event.effectId === "string" ? event.effectId : "";
      const hasSupportedEffect = isSupportedHpEventEffectId(effectId);
      return {
        id: typeof event.id === "string" && event.id
          ? event.id
          : `hp-event-${index + 1}`,
        effectId,
        enabled: event.enabled === true && hasSupportedEffect,
        ...(effectId === "toxic-damage"
          ? { toxicStage: normalizeHpEventNumber(event.toxicStage, 1, 15) }
          : {}),
        ...(effectId === "spikes-damage"
          ? { spikesLayers: normalizeHpEventNumber(event.spikesLayers, 1, 3) }
          : {}),
      };
    });
};

const normalizePokemonStatus = (value: unknown, fallback: PokemonStatus): PokemonStatus =>
  typeof value === "string" && pokemonStatuses.has(value as PokemonStatus)
    ? value as PokemonStatus
    : fallback;

const normalizeScenarioAdjustmentType = (value: unknown, fallback: ScenarioAdjustmentType): ScenarioAdjustmentType =>
  typeof value === "string" && scenarioAdjustmentTypes.has(value as ScenarioAdjustmentType)
    ? value as ScenarioAdjustmentType
    : fallback;

const normalizeTarget = (
  value: unknown,
  sourceSchemaVersion: SupportedShareSchemaVersion,
): TargetFormState => {
  const defaults = createDefaultTargetForm();
  const input = mergeObject(defaults, value) as TargetFormState & Record<string, unknown>;
  const hasLevel = isRecord(value) && "level" in value;
  const hasLevelMode = isRecord(value) && "levelMode" in value;
  let level = Number.isInteger(input.level) && input.level >= 1 && input.level <= 100
    ? input.level
    : DEFAULT_LEVEL;
  let levelMode: LevelInputMode = level === DEFAULT_LEVEL ? "auto" : "manual";
  if (sourceSchemaVersion >= 10) {
    if (
      !hasLevel
      || typeof input.level !== "number"
      || !Number.isInteger(input.level)
      || input.level < 1
      || input.level > 100
    ) {
      throw new Error("条件JSONの調整対象に不正な level があります");
    }
    if (
      !hasLevelMode
      || typeof input.levelMode !== "string"
      || !levelInputModes.has(input.levelMode as LevelInputMode)
      || (input.levelMode === "auto" && input.level !== DEFAULT_LEVEL)
    ) {
      throw new Error("条件JSONの調整対象に不正な levelMode があります");
    }
    level = input.level;
    levelMode = input.levelMode as LevelInputMode;
  }
  const normalized = {
    ...defaults,
    ...input,
    statPoints: mergeObject(defaults.statPoints, input.statPoints),
    boosts: mergeObject(defaults.boosts, input.boosts),
    level,
    levelMode,
  } as TargetFormState;
  delete (normalized as TargetFormState & { status?: unknown }).status;
  return normalized;
};

const normalizeAttack = (
  value: unknown,
  index: number,
  legacyTargetStatus: PokemonStatus,
  sourceSchemaVersion: SupportedShareSchemaVersion,
): ScenarioAttackFormState => {
  const defaults = createDefaultScenarioAttackForm(`attack-${index + 1}`, `攻撃${String.fromCharCode(65 + index)}`);
  const input = mergeObject(defaults, value) as ScenarioAttackFormState & Record<string, unknown>;
  const hasDefenderStatus = isRecord(value) && "defenderStatus" in value;
  const hasSpeedTargetMode = isRecord(value) && "speedTargetMode" in value;
  const hasSpeedComparison = isRecord(value) && "speedComparison" in value;
  const hasSpeedOrderMode = isRecord(value) && "speedOrderMode" in value;
  const hasSpeedTargetStatus = isRecord(value) && "speedTargetStatus" in value;
  const hasSpeedTargetItemMultiplier = isRecord(value) && "speedTargetItemMultiplier" in value;
  const hasSpeedTargetAbilityMultiplier = isRecord(value) && "speedTargetAbilityMultiplier" in value;
  const hasSpeedTargetTailwind = isRecord(value) && "speedTargetTailwind" in value;
  const hasSpeedOpponentTailwind = isRecord(value) && "speedOpponentTailwind" in value;
  const hasSpeedItemMultiplier = isRecord(value) && "speedItemMultiplier" in value;
  const hasSpeedAbilityMultiplier = isRecord(value) && "speedAbilityMultiplier" in value;
  const hasMovePowerMode = isRecord(value) && "movePowerMode" in value;
  const hasMovePowerValue = isRecord(value) && "movePowerValue" in value;
  const hasAttackerLevel = isRecord(value) && "attackerLevel" in value;
  const hasAttackerLevelMode = isRecord(value) && "attackerLevelMode" in value;
  const attackId = typeof input.id === "string" && input.id ? input.id : defaults.id;
  const canonicalMoveName = typeof input.moveInput === "string"
    ? toEntityRef(resolveEntity("move", input.moveInput), "move")?.canonicalName
    : undefined;
  let attackerLevel = Number.isInteger(input.attackerLevel)
    && input.attackerLevel >= 1
    && input.attackerLevel <= 100
    ? input.attackerLevel
    : DEFAULT_LEVEL;
  let attackerLevelMode: LevelInputMode = attackerLevel === DEFAULT_LEVEL
    ? "auto"
    : "manual";
  if (sourceSchemaVersion >= 10) {
    if (
      !hasAttackerLevel
      || typeof input.attackerLevel !== "number"
      || !Number.isInteger(input.attackerLevel)
      || input.attackerLevel < 1
      || input.attackerLevel > 100
    ) {
      throw new Error(`条件JSONの攻撃${index + 1}に不正な attackerLevel があります`);
    }
    if (
      !hasAttackerLevelMode
      || typeof input.attackerLevelMode !== "string"
      || !levelInputModes.has(input.attackerLevelMode as LevelInputMode)
      || (input.attackerLevelMode === "auto" && input.attackerLevel !== DEFAULT_LEVEL)
    ) {
      throw new Error(`条件JSONの攻撃${index + 1}に不正な attackerLevelMode があります`);
    }
    attackerLevel = input.attackerLevel;
    attackerLevelMode = input.attackerLevelMode as LevelInputMode;
  }
  let movePowerMode = defaults.movePowerMode;
  let movePowerValue = defaults.movePowerValue;
  if (sourceSchemaVersion >= 8) {
    if (
      !hasMovePowerMode
      || typeof input.movePowerMode !== "string"
      || !movePowerModes.has(input.movePowerMode as MovePowerMode)
    ) {
      throw new Error(`条件JSONの攻撃${index + 1}に不正な movePowerMode があります`);
    }
    if (
      !hasMovePowerValue
      || typeof input.movePowerValue !== "number"
      || !Number.isFinite(input.movePowerValue)
      || !Number.isInteger(input.movePowerValue)
      || (
        input.movePowerMode === "auto"
          ? input.movePowerValue !== 0
          : input.movePowerValue < 1 || input.movePowerValue > 10_000
      )
    ) {
      throw new Error(`条件JSONの攻撃${index + 1}に不正な movePowerValue があります`);
    }
    movePowerMode = input.movePowerMode as MovePowerMode;
    movePowerValue = input.movePowerValue;
    if (movePowerMode !== "auto") {
      const allowedOverride = canonicalMoveName
        ? resolveAllowedMovePowerOverride(canonicalMoveName, {
            value: movePowerValue,
            source: movePowerMode,
          })
        : undefined;
      if (!allowedOverride) {
        throw new Error(`条件JSONの攻撃${index + 1}に技と一致しない威力指定があります`);
      }
    }
  }
  const gameType = input.gameType === "doubles" ? "doubles" : "singles";
  const beatUpParticipants = normalizeBeatUpParticipants(
    input.beatUpParticipants,
    sourceSchemaVersion,
    index,
    attackId,
    canonicalMoveName,
    gameType,
  );
  const legacySpeedMoveModifier = isRecord(value) ? value.speedMoveModifier : undefined;
  const hasValidLegacySpeedMoveModifier = typeof legacySpeedMoveModifier === "string"
    && speedMoveModifiers.has(legacySpeedMoveModifier as LegacySpeedMoveModifier);
  const legacySpeedModifier = hasValidLegacySpeedMoveModifier
    ? legacySpeedMoveModifier as LegacySpeedMoveModifier
    : undefined;
  const speedOrderMode = sourceSchemaVersion >= SHARE_SCHEMA_VERSION
    ? hasSpeedOrderMode
      && typeof input.speedOrderMode === "string"
      && speedOrderModes.has(input.speedOrderMode as ScenarioAttackFormState["speedOrderMode"])
      ? input.speedOrderMode as ScenarioAttackFormState["speedOrderMode"]
      : defaults.speedOrderMode
    : legacySpeedModifier === "trick-room" ? "trick-room" : "normal";
  const speedOpponentTailwind = sourceSchemaVersion >= SHARE_SCHEMA_VERSION
    ? hasSpeedOpponentTailwind && typeof input.speedOpponentTailwind === "boolean"
      ? input.speedOpponentTailwind
      : defaults.speedOpponentTailwind
    : legacySpeedModifier === "tailwind"
      || (!legacySpeedModifier && input.tailwind === true);
  const normalized = {
    ...defaults,
    ...input,
    id: attackId,
    attackerLevel,
    attackerLevelMode,
    speedTargetMode: hasSpeedTargetMode
      && typeof input.speedTargetMode === "string"
      && speedTargetModes.has(input.speedTargetMode as ScenarioAttackFormState["speedTargetMode"])
      ? input.speedTargetMode as ScenarioAttackFormState["speedTargetMode"]
      : Number(input.speedTargetValue) > 0 ? "manual" : defaults.speedTargetMode,
    speedComparison: hasSpeedComparison
      && typeof input.speedComparison === "string"
      && speedComparisons.has(input.speedComparison as ScenarioAttackFormState["speedComparison"])
      ? input.speedComparison as ScenarioAttackFormState["speedComparison"]
      : defaults.speedComparison,
    speedTargetStatus: sourceSchemaVersion >= SHARE_SCHEMA_VERSION && hasSpeedTargetStatus
      ? normalizePokemonStatus(input.speedTargetStatus, defaults.speedTargetStatus)
      : defaults.speedTargetStatus,
    speedTargetItemMultiplier: sourceSchemaVersion >= SHARE_SCHEMA_VERSION
      && hasSpeedTargetItemMultiplier
      && typeof input.speedTargetItemMultiplier === "string"
      && speedManualMultipliers.has(input.speedTargetItemMultiplier as ScenarioAttackFormState["speedTargetItemMultiplier"])
      ? input.speedTargetItemMultiplier as ScenarioAttackFormState["speedTargetItemMultiplier"]
      : defaults.speedTargetItemMultiplier,
    speedTargetAbilityMultiplier: sourceSchemaVersion >= SHARE_SCHEMA_VERSION
      && hasSpeedTargetAbilityMultiplier
      && typeof input.speedTargetAbilityMultiplier === "string"
      && speedManualMultipliers.has(input.speedTargetAbilityMultiplier as ScenarioAttackFormState["speedTargetAbilityMultiplier"])
      ? input.speedTargetAbilityMultiplier as ScenarioAttackFormState["speedTargetAbilityMultiplier"]
      : defaults.speedTargetAbilityMultiplier,
    speedTargetTailwind: sourceSchemaVersion >= SHARE_SCHEMA_VERSION && hasSpeedTargetTailwind
      && typeof input.speedTargetTailwind === "boolean"
      ? input.speedTargetTailwind
      : defaults.speedTargetTailwind,
    speedOpponentTailwind,
    speedOrderMode,
    speedItemMultiplier: hasSpeedItemMultiplier
      && typeof input.speedItemMultiplier === "string"
      && speedManualMultipliers.has(input.speedItemMultiplier as ScenarioAttackFormState["speedItemMultiplier"])
      ? input.speedItemMultiplier as ScenarioAttackFormState["speedItemMultiplier"]
      : defaults.speedItemMultiplier,
    speedAbilityMultiplier: hasSpeedAbilityMultiplier
      && typeof input.speedAbilityMultiplier === "string"
      && speedManualMultipliers.has(input.speedAbilityMultiplier as ScenarioAttackFormState["speedAbilityMultiplier"])
      ? input.speedAbilityMultiplier as ScenarioAttackFormState["speedAbilityMultiplier"]
      : defaults.speedAbilityMultiplier,
    movePowerMode,
    movePowerValue,
    beatUpParticipants,
    gameType,
    defenderStatus: hasDefenderStatus
      ? normalizePokemonStatus(input.defenderStatus, defaults.defenderStatus)
      : legacyTargetStatus,
    hpEvents: normalizeHpEvents(input.hpEvents, sourceSchemaVersion),
    attackerStatPoints: mergeObject(defaults.attackerStatPoints, input.attackerStatPoints),
    attackerBoosts: mergeObject(defaults.attackerBoosts, input.attackerBoosts),
    defenderBoosts: mergeObject(defaults.defenderBoosts, input.defenderBoosts),
  } as ScenarioAttackFormState;
  // speedMoveModifier was part of schema <=10 only. Do not let an unknown
  // legacy key leak back into the current form state after migration.
  delete (normalized as ScenarioAttackFormState & Record<string, unknown>).speedMoveModifier;
  return normalized;
};

const normalizeScenario = (
  value: unknown,
  index: number,
  legacyTargetStatus: PokemonStatus,
  sourceSchemaVersion: SupportedShareSchemaVersion,
): ScenarioFormState => {
  const defaults = createDefaultScenarioForms()[0];
  const input = mergeObject(defaults, value) as ScenarioFormState & Record<string, unknown>;
  const attacks = Array.isArray(input.attacks)
    ? input.attacks.map((attack, attackIndex) => normalizeAttack(
      attack,
      attackIndex,
      legacyTargetStatus,
      sourceSchemaVersion,
    ))
    : defaults.attacks;

  return {
    ...defaults,
    ...input,
    id: typeof input.id === "string" && input.id ? input.id : `scenario-${index + 1}`,
    label: typeof input.label === "string" && input.label ? input.label : `シナリオ${index + 1}`,
    adjustmentType: normalizeScenarioAdjustmentType(input.adjustmentType, defaults.adjustmentType),
    attacks,
  } as ScenarioFormState;
};

export const createShareStateDocument = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
): ShareStateDocument => ({
  schemaVersion: SHARE_SCHEMA_VERSION,
  target,
  scenarios,
});

export const stringifyShareStateDocument = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
): string => `${JSON.stringify(createShareStateDocument(target, scenarios), null, 2)}\n`;

export const parseShareStateDocument = (json: string): ShareStateDocument => {
  const parsed = JSON.parse(json) as unknown;
  if (
    !isRecord(parsed)
    || (
      parsed.schemaVersion !== SHARE_SCHEMA_VERSION
      && parsed.schemaVersion !== 10
      && parsed.schemaVersion !== 9
      && parsed.schemaVersion !== 8
      && parsed.schemaVersion !== 7
      && parsed.schemaVersion !== 6
      && parsed.schemaVersion !== 5
      && parsed.schemaVersion !== 4
      && parsed.schemaVersion !== 3
      && parsed.schemaVersion !== 2
      && parsed.schemaVersion !== 1
    )
  ) {
    throw new Error(`対応していない条件JSONです (schemaVersion 1〜${SHARE_SCHEMA_VERSION} のみ対応)`);
  }
  if (!Array.isArray(parsed.scenarios)) {
    throw new Error("条件JSONに scenarios がありません");
  }

  const legacyTargetStatus = isRecord(parsed.target)
    ? normalizePokemonStatus(parsed.target.status, "none")
    : "none";
  const sourceSchemaVersion = parsed.schemaVersion as SupportedShareSchemaVersion;

  return {
    schemaVersion: SHARE_SCHEMA_VERSION,
    target: normalizeTarget(parsed.target, sourceSchemaVersion),
    scenarios: parsed.scenarios.map((scenario, index) => normalizeScenario(
      scenario,
      index,
      legacyTargetStatus,
      sourceSchemaVersion,
    )),
  };
};
