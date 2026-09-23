const legacyAllyAbilityCanonicalNames = new Set([
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

export const isLegacyAllyAbilityCanonicalName = (
  canonicalName: string | undefined,
): boolean => canonicalName !== undefined && legacyAllyAbilityCanonicalNames.has(canonicalName);

/** Explicit ally slots. The legacy set above is frozen for saved-data migration. */
export const battleAbilityCanonicalNames = [...legacyAllyAbilityCanonicalNames, "Friend Guard"] as const;
export const isBattleAbilityCanonicalName = (name: string): boolean =>
  battleAbilityCanonicalNames.includes(name);
