import { normalizeSearchText } from "../localization/normalize";
import type {
  ChampionsUsageData,
  NatureUsageDatum,
  NatureUsageState,
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

/** Listed Pokemon only, using existing selectable labels and exact form IDs. */
export const getUsageRankedPokemonOptions = <T extends UsageRankableCandidate>(
  candidates: readonly T[],
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
): T[] => {
  const rankedEntries = Object.entries(getFormatEntries(data, format) ?? {})
    .filter(([, entry]) => Number.isSafeInteger(entry.pokemonRank) && entry.pokemonRank! > 0);
  if (rankedEntries.length === 0) return [];
  const byId = new Map<string, T>();
  for (const candidate of candidates) {
    const id = toUsagePokemonKey(candidate.canonicalName);
    // Display aliases share a canonical Pokemon. Show its primary label once.
    if (!byId.has(id)) byId.set(id, candidate);
  }
  const seen = new Set<string>();
  return rankedEntries
    .sort(([, left], [, right]) => left.pokemonRank! - right.pokemonRank!)
    .flatMap(([key]) => {
      const id = toUsagePokemonKey(key);
      const candidate = byId.get(id);
      if (!candidate || seen.has(id)) return [];
      seen.add(id);
      return [candidate];
    });
};

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
 * Look up the optional top-nature list for exactly one owner Pokemon and
 * format.  The owner lookup is deliberately shared with the existing
 * ranking path so a form never inherits the base Pokemon's data and Singles
 * never inherits Doubles data.
 */
export const getUsageNatureRanking = (
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
  pokemonCanonicalName: string | undefined,
): readonly NatureUsageDatum[] | undefined => getUsagePokemonEntry(
  data,
  format,
  pokemonCanonicalName,
)?.nature;

/**
 * Resolve one nature's display state from a loaded usage payload.
 *
 * - unavailable: no owner entry or no optional nature feed
 * - unlisted: a feed exists, but the nature is outside the published top 10
 * - listed: the exact canonical nature was published, including a real 0.0%
 */
export const getNatureUsageState = (
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
  pokemonCanonicalName: string | undefined,
  natureCanonicalName: string | undefined,
): NatureUsageState => {
  if (!natureCanonicalName) {
    return { kind: "unavailable" };
  }

  const ranking = getUsageNatureRanking(data, format, pokemonCanonicalName);
  if (!ranking || ranking.length === 0) {
    return { kind: "unavailable" };
  }

  const datum = ranking.find((entry) => entry.canonicalName === natureCanonicalName);
  return datum
    ? { kind: "listed", rank: datum.rank, percentage: datum.percentage }
    : { kind: "unlisted" };
};

/** Alias emphasizing that this lookup is backed by the usage payload. */
export const getUsageNatureState = getNatureUsageState;

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

/**
 * Return the highest-ranked candidate that already exists in the caller's
 * valid option set. Unknown or inapplicable ranking values never create a new
 * option, and a missing ranking never falls back to alphabetical order.
 */
export const getTopUsageRankedCandidate = <T extends UsageRankableCandidate & { value: string }>(
  candidates: readonly T[],
  ranking: readonly string[] | undefined,
): T | undefined => {
  if (!ranking || ranking.length === 0 || candidates.length === 0) {
    return undefined;
  }

  const candidateByCanonicalName = new Map<string, T>();
  for (const candidate of candidates) {
    if (!candidateByCanonicalName.has(candidate.canonicalName)) {
      candidateByCanonicalName.set(candidate.canonicalName, candidate);
    }
  }

  for (const canonicalName of ranking) {
    const candidate = candidateByCanonicalName.get(canonicalName);
    if (candidate?.value.trim()) {
      return candidate;
    }
  }
  return undefined;
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

/** Keep text-search results separate from the trigger's unfiltered menu. */
export const getUsageSuggestionOptionLists = <T extends UsageRankableCandidate>(
  options: readonly T[],
  input: string,
  data: ChampionsUsageData | null | undefined,
  format: SuggestionFormat,
  pokemonCanonicalName: string | undefined,
  category: UsageRankingCategory,
  limit = 40,
): { searchOptions: T[]; menuOptions: T[] } => {
  const ranking = getUsageRanking(data, format, pokemonCanonicalName, category);
  const menuOptions = getMatchingEntityInputOptionsWithUsage(options, "", ranking, limit);
  return {
    searchOptions: input.trim()
      ? getMatchingEntityInputOptionsWithUsage(options, input, ranking, limit)
      : menuOptions,
    menuOptions,
  };
};
