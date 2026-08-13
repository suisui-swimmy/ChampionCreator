import type { MovePowerOverride } from "../domain/model";

export interface MovePowerAssistOption {
  power: number;
  label: string;
}

export interface MovePowerAssistRule {
  canonicalName: string;
  defaultPower: number;
  options: readonly MovePowerAssistOption[];
}

const MOVE_POWER_ASSIST_RULES = {
  Avalanche: {
    canonicalName: "Avalanche",
    defaultPower: 60,
    options: [
      { power: 60, label: "通常" },
      { power: 120, label: "同じターンに相手からダメージを受けた" },
    ],
  },
  "Fickle Beam": {
    canonicalName: "Fickle Beam",
    defaultPower: 80,
    options: [
      { power: 80, label: "通常（70%）" },
      { power: 160, label: "威力が2倍になった（30%）" },
    ],
  },
  "Last Respects": {
    canonicalName: "Last Respects",
    defaultPower: 50,
    options: Array.from({ length: 6 }, (_value, faintedAllies) => ({
      power: 50 + faintedAllies * 50,
      label: `ひんしの味方 ${faintedAllies}体`,
    })),
  },
  "Rage Fist": {
    canonicalName: "Rage Fist",
    defaultPower: 50,
    options: Array.from({ length: 7 }, (_value, timesHit) => ({
      power: 50 + timesHit * 50,
      label: timesHit === 6
        ? "攻撃を受けた回数 6回以上（最大）"
        : `攻撃を受けた回数 ${timesHit}回`,
    })),
  },
  Round: {
    canonicalName: "Round",
    defaultPower: 60,
    options: [
      { power: 60, label: "通常" },
      { power: 120, label: "味方の「りんしょう」に続けて使用" },
    ],
  },
  "Spit Up": {
    canonicalName: "Spit Up",
    defaultPower: 100,
    options: [
      { power: 100, label: "たくわえる 1回" },
      { power: 200, label: "たくわえる 2回" },
      { power: 300, label: "たくわえる 3回" },
    ],
  },
  "Stomping Tantrum": {
    canonicalName: "Stomping Tantrum",
    defaultPower: 75,
    options: [
      { power: 75, label: "通常" },
      { power: 150, label: "直前に使った技が失敗した" },
    ],
  },
  "Temper Flare": {
    canonicalName: "Temper Flare",
    defaultPower: 75,
    options: [
      { power: 75, label: "通常" },
      { power: 150, label: "直前に使った技が失敗した" },
    ],
  },
} as const satisfies Record<string, MovePowerAssistRule>;

const UNSUPPORTED_SINGLE_POWER_MOVES = new Set(["Beat Up"]);

const MANUAL_POWER_OVERRIDE_MOVES = new Set([
  ...Object.keys(MOVE_POWER_ASSIST_RULES),
  "Eruption",
  "Water Spout",
  "Dragon Energy",
  "Flail",
  "Reversal",
  "Hard Press",
  "Crush Grip",
  "Wring Out",
  "Brine",
]);

export const isSinglePowerMoveUnsupported = (canonicalName: string): boolean =>
  UNSUPPORTED_SINGLE_POWER_MOVES.has(canonicalName);

export const getMovePowerAssistRule = (
  canonicalName: string,
): MovePowerAssistRule | undefined => (
  MOVE_POWER_ASSIST_RULES[canonicalName as keyof typeof MOVE_POWER_ASSIST_RULES]
);

export const isMovePowerOverrideAllowed = (canonicalName: string): boolean =>
  MANUAL_POWER_OVERRIDE_MOVES.has(canonicalName);

const isValidPower = (value: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= 10000;

export const resolveAllowedMovePowerOverride = (
  canonicalName: string,
  override: MovePowerOverride | undefined,
): MovePowerOverride | undefined => {
  const rule = getMovePowerAssistRule(canonicalName);
  if (
    !override
    || !isValidPower(override.value)
    || !isMovePowerOverrideAllowed(canonicalName)
  ) {
    return undefined;
  }

  if (
    override.source === "assisted"
    && (!rule || !rule.options.some((option) => option.power === override.value))
  ) {
    return undefined;
  }

  return override;
};

export const getMovePowerOverrideDetailLabel = (
  canonicalName: string,
  override: MovePowerOverride,
): string | undefined => {
  if (override.source === "manual") {
    return "任意威力";
  }
  return getMovePowerAssistRule(canonicalName)?.options.find(
    (option) => option.power === override.value,
  )?.label;
};
