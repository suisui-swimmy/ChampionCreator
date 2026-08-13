import {
  createDefaultScenarioAttackForm,
  createDefaultBeatUpParticipants,
  createDefaultScenarioForms,
  createDefaultTargetForm,
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

export const SHARE_SCHEMA_VERSION = 9;

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
const speedMoveModifiers = new Set<ScenarioAttackFormState["speedMoveModifier"]>(["none", "tailwind", "trick-room"]);
const speedManualMultipliers = new Set<ScenarioAttackFormState["speedItemMultiplier"]>(["auto", "2", "1.5", "0.5"]);
const movePowerModes = new Set<MovePowerMode>(["auto", "assisted", "manual"]);
type SupportedShareSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | typeof SHARE_SCHEMA_VERSION;

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

const normalizeTarget = (value: unknown): TargetFormState => {
  const defaults = createDefaultTargetForm();
  const input = mergeObject(defaults, value) as TargetFormState & Record<string, unknown>;
  const normalized = {
    ...defaults,
    ...input,
    statPoints: mergeObject(defaults.statPoints, input.statPoints),
    boosts: mergeObject(defaults.boosts, input.boosts),
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
  const hasSpeedMoveModifier = isRecord(value) && "speedMoveModifier" in value;
  const hasSpeedItemMultiplier = isRecord(value) && "speedItemMultiplier" in value;
  const hasSpeedAbilityMultiplier = isRecord(value) && "speedAbilityMultiplier" in value;
  const hasMovePowerMode = isRecord(value) && "movePowerMode" in value;
  const hasMovePowerValue = isRecord(value) && "movePowerValue" in value;
  const attackId = typeof input.id === "string" && input.id ? input.id : defaults.id;
  const canonicalMoveName = typeof input.moveInput === "string"
    ? toEntityRef(resolveEntity("move", input.moveInput), "move")?.canonicalName
    : undefined;
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
  return {
    ...defaults,
    ...input,
    id: attackId,
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
    speedMoveModifier: hasSpeedMoveModifier
      && typeof input.speedMoveModifier === "string"
      && speedMoveModifiers.has(input.speedMoveModifier as ScenarioAttackFormState["speedMoveModifier"])
      ? input.speedMoveModifier as ScenarioAttackFormState["speedMoveModifier"]
      : input.tailwind === true ? "tailwind" : defaults.speedMoveModifier,
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
    target: normalizeTarget(parsed.target),
    scenarios: parsed.scenarios.map((scenario, index) => normalizeScenario(
      scenario,
      index,
      legacyTargetStatus,
      sourceSchemaVersion,
    )),
  };
};
