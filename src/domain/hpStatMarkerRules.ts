export type HpStatMarkerRuleId =
  | "2n"
  | "3n"
  | "4n"
  | "6n"
  | "8n"
  | "10n"
  | "16n"
  | "50n";

export type HpStatMarkerRuleKind = "point";

export type HpStatMarkerRule = {
  id: HpStatMarkerRuleId;
  label: string;
  compactLabel: string;
  kind: HpStatMarkerRuleKind;
  matches: (hp: number) => boolean;
};

export type HpStatMarkerRuleGroup = {
  id: string;
  label: string;
  ruleIds: readonly HpStatMarkerRuleId[];
};

const hasRemainder = (divisor: number, remainder: number) => (hp: number): boolean => (
  hp % divisor === remainder
);

export const hpStatMarkerRules: readonly HpStatMarkerRule[] = [
  { id: "2n", label: "2n", compactLabel: "2n", kind: "point", matches: hasRemainder(2, 0) },
  { id: "3n", label: "3n", compactLabel: "3n", kind: "point", matches: hasRemainder(3, 0) },
  { id: "4n", label: "4n", compactLabel: "4n", kind: "point", matches: hasRemainder(4, 0) },
  { id: "6n", label: "6n", compactLabel: "6n", kind: "point", matches: hasRemainder(6, 0) },
  { id: "8n", label: "8n", compactLabel: "8n", kind: "point", matches: hasRemainder(8, 0) },
  { id: "10n", label: "10n", compactLabel: "10n", kind: "point", matches: hasRemainder(10, 0) },
  { id: "16n", label: "16n", compactLabel: "16n", kind: "point", matches: hasRemainder(16, 0) },
  { id: "50n", label: "50n", compactLabel: "50n", kind: "point", matches: hasRemainder(50, 0) },
];

const hpStatMarkerRuleById = new Map(hpStatMarkerRules.map((rule) => [rule.id, rule]));

export const getHpStatMarkerRule = (id: HpStatMarkerRuleId): HpStatMarkerRule => {
  const rule = hpStatMarkerRuleById.get(id);
  if (!rule) {
    throw new Error(`Unknown HP stat marker rule: ${id}`);
  }
  return rule;
};

export const hpStatMarkerRuleGroups: readonly HpStatMarkerRuleGroup[] = [
  {
    id: "base-multiples",
    label: "基準倍数",
    ruleIds: ["2n", "3n", "4n", "6n", "8n", "10n", "16n", "50n"],
  },
];
