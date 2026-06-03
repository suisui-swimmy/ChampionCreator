import type { EntityKind } from "../data/localizationTypes";

const megaSuffixPattern = /-Mega(?:-[A-Z])?$/u;

export const formatPokemonDisplayNameJa = (canonicalName: string, displayNameJa: string): string => {
  if (!megaSuffixPattern.test(canonicalName)) {
    return displayNameJa;
  }

  const labels = displayNameJa
    .split(/\s+/u)
    .map((text) => text.trim())
    .filter(Boolean);
  const megaLabel = [...labels].reverse().find((text) => text.normalize("NFKC").startsWith("メガ"));

  return megaLabel?.normalize("NFKC") ?? displayNameJa;
};

export const applyDisplayNameRules = (
  kind: EntityKind,
  canonicalName: string,
  displayNameJa: string,
): string => {
  if (kind === "pokemon") {
    return formatPokemonDisplayNameJa(canonicalName, displayNameJa);
  }
  return displayNameJa;
};
