import {
  createDefaultOffenseAdjustmentForm,
  createDefaultScenarioAttackForm,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  type OffenseAdjustmentFormState,
  type ScenarioAdjustmentType,
  type ScenarioAttackFormState,
  type ScenarioFormState,
  type TargetFormState,
} from "./defenceSearchUi";
import type { PokemonStatus } from "../domain/model";

export const SHARE_SCHEMA_VERSION = 2;

export interface ShareStateDocument {
  schemaVersion: typeof SHARE_SCHEMA_VERSION;
  target: TargetFormState;
  scenarios: ScenarioFormState[];
  offenseAdjustment: OffenseAdjustmentFormState;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeObject = <T extends object>(base: T, value: unknown): T => (
  isRecord(value) ? { ...base, ...value } as T : base
);

const pokemonStatuses = new Set<PokemonStatus>(["none", "slp", "psn", "brn", "frz", "par", "tox"]);
const scenarioAdjustmentTypes = new Set<ScenarioAdjustmentType>(["defence", "offense"]);

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
): ScenarioAttackFormState => {
  const defaults = createDefaultScenarioAttackForm(`attack-${index + 1}`, `攻撃${String.fromCharCode(65 + index)}`);
  const input = mergeObject(defaults, value) as ScenarioAttackFormState & Record<string, unknown>;
  const hasDefenderStatus = isRecord(value) && "defenderStatus" in value;
  return {
    ...defaults,
    ...input,
    id: typeof input.id === "string" && input.id ? input.id : defaults.id,
    defenderStatus: hasDefenderStatus
      ? normalizePokemonStatus(input.defenderStatus, defaults.defenderStatus)
      : legacyTargetStatus,
    attackerStatPoints: mergeObject(defaults.attackerStatPoints, input.attackerStatPoints),
    attackerBoosts: mergeObject(defaults.attackerBoosts, input.attackerBoosts),
    defenderBoosts: mergeObject(defaults.defenderBoosts, input.defenderBoosts),
  } as ScenarioAttackFormState;
};

const normalizeScenario = (
  value: unknown,
  index: number,
  legacyTargetStatus: PokemonStatus,
): ScenarioFormState => {
  const defaults = createDefaultScenarioForms()[0];
  const input = mergeObject(defaults, value) as ScenarioFormState & Record<string, unknown>;
  const attacks = Array.isArray(input.attacks)
    ? input.attacks.map((attack, attackIndex) => normalizeAttack(attack, attackIndex, legacyTargetStatus))
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

const normalizeOffenseAdjustment = (value: unknown): OffenseAdjustmentFormState => {
  const defaults = createDefaultOffenseAdjustmentForm();
  const input = mergeObject(defaults, value) as OffenseAdjustmentFormState & Record<string, unknown>;

  return {
    ...defaults,
    ...input,
    defenderStatus: normalizePokemonStatus(input.defenderStatus, defaults.defenderStatus),
    defenderStatPoints: mergeObject(defaults.defenderStatPoints, input.defenderStatPoints),
    defenderBoosts: mergeObject(defaults.defenderBoosts, input.defenderBoosts),
  } as OffenseAdjustmentFormState;
};

export const createShareStateDocument = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
  offenseAdjustment: OffenseAdjustmentFormState = createDefaultOffenseAdjustmentForm(),
): ShareStateDocument => ({
  schemaVersion: SHARE_SCHEMA_VERSION,
  target,
  scenarios,
  offenseAdjustment,
});

export const stringifyShareStateDocument = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
  offenseAdjustment: OffenseAdjustmentFormState = createDefaultOffenseAdjustmentForm(),
): string => `${JSON.stringify(createShareStateDocument(target, scenarios, offenseAdjustment), null, 2)}\n`;

export const parseShareStateDocument = (json: string): ShareStateDocument => {
  const parsed = JSON.parse(json) as unknown;
  if (
    !isRecord(parsed)
    || (parsed.schemaVersion !== SHARE_SCHEMA_VERSION && parsed.schemaVersion !== 1)
  ) {
    throw new Error(`対応していない条件JSONです (schemaVersion 1 または ${SHARE_SCHEMA_VERSION} のみ対応)`);
  }
  if (!Array.isArray(parsed.scenarios)) {
    throw new Error("条件JSONに scenarios がありません");
  }

  const legacyTargetStatus = isRecord(parsed.target)
    ? normalizePokemonStatus(parsed.target.status, "none")
    : "none";

  return {
    schemaVersion: SHARE_SCHEMA_VERSION,
    target: normalizeTarget(parsed.target),
    scenarios: parsed.scenarios.map((scenario, index) => normalizeScenario(scenario, index, legacyTargetStatus)),
    offenseAdjustment: normalizeOffenseAdjustment(parsed.offenseAdjustment),
  };
};
