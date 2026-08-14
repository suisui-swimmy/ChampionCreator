import { normalizeSearchText } from "../localization/normalize";
import type {
  ChampionsUsageData,
  SuggestionFormat,
  UsageRankingCategory,
  UsagePokemonEntry,
} from "./types";

/** A resolver-backed candidate with a Showdown canonical name. */
export type UsageRankableCandidate = {
  canonicalName: string;
  value?: string;
};

const getFormatEntries = (
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
): Record<string, UsagePokemonEntry> | undefined => data?.formats[format];

/** Match the API's Pokemon id convention without collapsing forms together. */
export const toUsagePokemonKey = (pokemonCanonicalName: string): string => (
  pokemonCanonicalName.toLowerCase().replace(/[^a-z0-9]/g, "")
);

/**
 * Look up a Pokemon's ranking without falling back to another form or format.
 * The toID comparison only accommodates generated id keys such as `pikachu`
 * beside resolver canonical names such as `Pikachu`. Form suffixes remain part
 * of the key (`Aegislash-Shield` -> `aegislashshield`), so unlisted forms do
 * not inherit the base Pokemon's ranking.
 */
export const getUsagePokemonEntry = (
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
  pokemonCanonicalName: string | undefined,
): UsagePokemonEntry | undefined => {
  if (!pokemonCanonicalName) {
    return undefined;
  }

  const entries = getFormatEntries(data, format);
  if (!entries) {
    return undefined;
  }

  const exact = entries[pokemonCanonicalName];
  if (exact) {
    return exact;
  }

  const usageKey = toUsagePokemonKey(pokemonCanonicalName);
  const matchingKey = Object.keys(entries).find((key) => toUsagePokemonKey(key) === usageKey);
  return matchingKey ? entries[matchingKey] : undefined;
};

export const getUsageRanking = (
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
  pokemonCanonicalName: string | undefined,
  category: UsageRankingCategory,
): readonly string[] | undefined => getUsagePokemonEntry(data, format, pokemonCanonicalName)?.[category];

/**
 * Apply a usage ranking to an already-filtered autocomplete list.
 *
 * The caller performs the existing prefix match first. This helper then puts
 * candidates present in the ranking first, in ranking order, and keeps all
 * unlisted candidates in their original (normally Japanese alphabetical)
 * order. Unknown ranking names are ignored and never create new candidates.
 */
export const applyUsageRanking = <T extends UsageRankableCandidate>(
  candidates: readonly T[],
  ranking: readonly string[] | undefined,
): T[] => {
  if (!ranking || ranking.length === 0 || candidates.length < 2) {
    return [...candidates];
  }

  const rankByCanonicalName = new Map<string, number>();
  ranking.forEach((canonicalName, index) => {
    if (!rankByCanonicalName.has(canonicalName)) {
      rankByCanonicalName.set(canonicalName, index);
    }
  });

  return candidates
    .map((candidate, originalIndex) => ({
      candidate,
      originalIndex,
      rank: rankByCanonicalName.get(candidate.canonicalName),
    }))
    .sort((left, right) => {
      const leftRanked = left.rank !== undefined;
      const rightRanked = right.rank !== undefined;
      if (leftRanked && rightRanked) {
        return left.rank! - right.rank! || left.originalIndex - right.originalIndex;
      }
      if (leftRanked) {
        return -1;
      }
      if (rightRanked) {
        return 1;
      }
      return left.originalIndex - right.originalIndex;
    })
    .map(({ candidate }) => candidate);
};

/** Alias with an explicit name for call sites that sort autocomplete options. */
export const sortCandidatesByUsage = applyUsageRanking;

/**
 * Prefix-match the existing catalog and then overlay usage order. Applying
 * the limit last is important: a popular item that is alphabetically beyond
 * the first 40 catalog entries must still be visible in the empty-input list.
 */
export const getMatchingEntityInputOptionsWithUsage = <T extends UsageRankableCandidate>(
  options: readonly T[],
  input: string,
  ranking: readonly string[] | undefined,
  limit = 40,
): T[] => {
  const safeLimit = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : 40;
  const normalizedInput = normalizeSearchText(input);
  const matching = normalizedInput
    ? options.filter((option) => normalizeSearchText(option.value ?? "").startsWith(normalizedInput))
    : [...options];
  return applyUsageRanking(matching, ranking).slice(0, safeLimit);
};

/**
 * Convenience form that obtains the ranking from a loaded payload. The caller
 * supplies the appropriate owner Pokemon and category, so no tutorial-specific
 * or cross-form behavior is hidden in this helper.
 */
export const getUsageMatchingEntityInputOptions = <T extends UsageRankableCandidate>(
  options: readonly T[],
  input: string,
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
  pokemonCanonicalName: string | undefined,
  category: UsageRankingCategory,
  limit = 40,
): T[] => getMatchingEntityInputOptionsWithUsage(
  options,
  input,
  getUsageRanking(data, format, pokemonCanonicalName, category),
  limit,
);
