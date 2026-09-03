import pokemonOptionsPayload from "../data/generated/pokemon-options.gen.json";
import aliasOverridesJson from "../data/overrides/ja-aliases.json";
import labelOverridesJson from "../data/overrides/ja-label-overrides.json";
import type { JaAliasOverridePayload, JaLabelOverridePayload } from "../data/localizationTypes";
import { applyDisplayNameRules } from "../localization/displayNameRules";
import { normalizeSearchText } from "../localization/normalize";
import { getPublicAssetUrl } from "./publicAssetUrl";

type PokemonOptionEntry = {
  id: string;
  label: string;
  showdownName: string;
  searchText: string;
  artwork?: string;
  types?: string[];
};

export type PokemonArtworkMatch = {
  id: string;
  label: string;
  showdownName: string;
  artworkUrl: string;
  types: string[];
};

type LookupInput = {
  input?: string;
  canonicalName?: string;
};

const pokemonOptions = (pokemonOptionsPayload.entries as PokemonOptionEntry[])
  .filter((entry) => entry.artwork);
const aliasOverrides = aliasOverridesJson as JaAliasOverridePayload;
const labelOverrides = labelOverridesJson as JaLabelOverridePayload;
const labelOverrideById = new Map(
  labelOverrides.entries
    .filter((entry) => entry.kind === "pokemon")
    .map((entry) => [entry.id, entry]),
);

const toArtworkUrl = (artwork: string): string => getPublicAssetUrl(artwork);

const toMatch = (entry: PokemonOptionEntry): PokemonArtworkMatch | null => {
  const override = labelOverrideById.get(entry.id);
  const artwork = override?.artwork ?? entry.artwork;
  if (!artwork) {
    return null;
  }

  return {
    id: entry.id,
    label: applyDisplayNameRules("pokemon", entry.showdownName, override?.displayNameJa ?? entry.label),
    showdownName: entry.showdownName,
    artworkUrl: toArtworkUrl(artwork),
    types: entry.types ?? [],
  };
};

const artworkByExactKey = new Map<string, PokemonOptionEntry>();
const optionById = new Map(pokemonOptions.map((option) => [option.id, option]));
const artworkByDisplayAliasKey = new Map<string, {
  option: PokemonOptionEntry;
  displayNameJa: string;
  artwork: string;
}>();

for (const option of pokemonOptions) {
  const labelOverride = labelOverrideById.get(option.id);
  const displayLabel = applyDisplayNameRules(
    "pokemon",
    option.showdownName,
    labelOverride?.displayNameJa ?? option.label,
  );
  const keys = [
    option.id,
    option.label,
    displayLabel,
    option.showdownName,
    ...option.searchText.split(/\s+/u),
  ];

  for (const key of keys) {
    const normalized = normalizeSearchText(key);
    if (normalized && !artworkByExactKey.has(normalized)) {
      artworkByExactKey.set(normalized, option);
    }
  }
}

for (const override of aliasOverrides.entries) {
  if (override.kind !== "pokemon") {
    continue;
  }
  const option = optionById.get(override.id);
  if (!option) {
    continue;
  }
  for (const displayAlias of override.displayAliasesJa ?? []) {
    const artwork = displayAlias.artwork ?? option.artwork;
    const key = normalizeSearchText(displayAlias.displayNameJa);
    if (artwork && key && !artworkByDisplayAliasKey.has(key)) {
      artworkByDisplayAliasKey.set(key, {
        option,
        displayNameJa: displayAlias.displayNameJa,
        artwork,
      });
    }
  }
}

export const findPokemonArtwork = ({ input, canonicalName }: LookupInput): PokemonArtworkMatch | null => {
  const canonicalKey = normalizeSearchText(canonicalName ?? "");
  const inputKey = normalizeSearchText(input ?? "");
  const displayAliasMatch = artworkByDisplayAliasKey.get(inputKey);
  if (displayAliasMatch) {
    return {
      id: displayAliasMatch.option.id,
      label: displayAliasMatch.displayNameJa,
      showdownName: displayAliasMatch.option.showdownName,
      artworkUrl: toArtworkUrl(displayAliasMatch.artwork),
      types: displayAliasMatch.option.types ?? [],
    };
  }
  const exactMatch = artworkByExactKey.get(canonicalKey) ?? artworkByExactKey.get(inputKey);

  if (exactMatch) {
    return toMatch(exactMatch);
  }

  if (!inputKey) {
    return null;
  }

  const fuzzyMatch = pokemonOptions.find((option) => normalizeSearchText(option.searchText).includes(inputKey));
  return fuzzyMatch ? toMatch(fuzzyMatch) : null;
};

export const pokemonArtworkSummary = {
  totalOptions: pokemonOptionsPayload.summary.totalOptions,
  withArtwork: pokemonOptionsPayload.summary.withArtwork,
};
