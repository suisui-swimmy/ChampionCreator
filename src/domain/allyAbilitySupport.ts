const activeAllyAbilityCanonicalNames = new Set([
  "Aura Break",
  "Battery",
  "Beads of Ruin",
  "Dark Aura",
  "Fairy Aura",
  "Flower Gift",
  "Minus",
  "Plus",
  "Power Spot",
  "Steely Spirit",
  "Sword of Ruin",
  "Tablets of Ruin",
  "Vessel of Ruin",
]);

export const isActiveAllyAbilityCanonicalName = (
  canonicalName: string | undefined,
): boolean => canonicalName !== undefined && activeAllyAbilityCanonicalNames.has(canonicalName);
