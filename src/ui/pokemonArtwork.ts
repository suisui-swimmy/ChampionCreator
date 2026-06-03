import pokemonOptionsPayload from "../data/generated/pokemon-options.gen.json";
import { applyDisplayNameRules } from "../localization/displayNameRules";
import { normalizeSearchText } from "../localization/normalize";

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

const toArtworkUrl = (artwork: string): string => {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${artwork.replace(/^\/+/, "")}`;
};

const toMatch = (entry: PokemonOptionEntry): PokemonArtworkMatch | null => {
  if (!entry.artwork) {
    return null;
  }

  return {
    id: entry.id,
    label: applyDisplayNameRules("pokemon", entry.showdownName, entry.label),
    showdownName: entry.showdownName,
    artworkUrl: toArtworkUrl(entry.artwork),
    types: entry.types ?? [],
  };
};

const artworkByExactKey = new Map<string, PokemonOptionEntry>();

for (const option of pokemonOptions) {
  const displayLabel = applyDisplayNameRules("pokemon", option.showdownName, option.label);
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

export const findPokemonArtwork = ({ input, canonicalName }: LookupInput): PokemonArtworkMatch | null => {
  const canonicalKey = normalizeSearchText(canonicalName ?? "");
  const inputKey = normalizeSearchText(input ?? "");
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
