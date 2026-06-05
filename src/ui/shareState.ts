import {
  createDefaultScenarioAttackForm,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  type ScenarioAttackFormState,
  type ScenarioFormState,
  type TargetFormState,
} from "./defenceSearchUi";

export const SHARE_SCHEMA_VERSION = 1;

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

const normalizeTarget = (value: unknown): TargetFormState => {
  const defaults = createDefaultTargetForm();
  const input = mergeObject(defaults, value) as TargetFormState & Record<string, unknown>;
  return {
    ...defaults,
    ...input,
    statPoints: mergeObject(defaults.statPoints, input.statPoints),
    boosts: mergeObject(defaults.boosts, input.boosts),
  } as TargetFormState;
};

const normalizeAttack = (value: unknown, index: number): ScenarioAttackFormState => {
  const defaults = createDefaultScenarioAttackForm(`attack-${index + 1}`, `攻撃${String.fromCharCode(65 + index)}`);
  const input = mergeObject(defaults, value) as ScenarioAttackFormState & Record<string, unknown>;
  return {
    ...defaults,
    ...input,
    id: typeof input.id === "string" && input.id ? input.id : defaults.id,
    attackerStatPoints: mergeObject(defaults.attackerStatPoints, input.attackerStatPoints),
    attackerBoosts: mergeObject(defaults.attackerBoosts, input.attackerBoosts),
    defenderBoosts: mergeObject(defaults.defenderBoosts, input.defenderBoosts),
  } as ScenarioAttackFormState;
};

const normalizeScenario = (value: unknown, index: number): ScenarioFormState => {
  const defaults = createDefaultScenarioForms()[0];
  const input = mergeObject(defaults, value) as ScenarioFormState & Record<string, unknown>;
  const attacks = Array.isArray(input.attacks)
    ? input.attacks.map((attack, attackIndex) => normalizeAttack(attack, attackIndex))
    : defaults.attacks;

  return {
    ...defaults,
    ...input,
    id: typeof input.id === "string" && input.id ? input.id : `scenario-${index + 1}`,
    label: typeof input.label === "string" && input.label ? input.label : `シナリオ${index + 1}`,
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
  if (!isRecord(parsed) || parsed.schemaVersion !== SHARE_SCHEMA_VERSION) {
    throw new Error(`対応していない条件JSONです (schemaVersion ${SHARE_SCHEMA_VERSION} のみ対応)`);
  }
  if (!Array.isArray(parsed.scenarios)) {
    throw new Error("条件JSONに scenarios がありません");
  }

  return {
    schemaVersion: SHARE_SCHEMA_VERSION,
    target: normalizeTarget(parsed.target),
    scenarios: parsed.scenarios.map((scenario, index) => normalizeScenario(scenario, index)),
  };
};
