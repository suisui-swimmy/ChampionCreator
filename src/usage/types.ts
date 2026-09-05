/**
 * The battle-data API uses a format-specific ranking. Keep this type separate
 * from the per-attack game type used by the calculator: it is only a UI
 * preference for autocomplete suggestions.
 */
export const SUGGESTION_FORMATS = ["Singles", "Doubles"] as const;

export type SuggestionFormat = (typeof SUGGESTION_FORMATS)[number];

export const USAGE_RANKING_CATEGORIES = ["move", "ability", "item"] as const;

export type UsageRankingCategory = (typeof USAGE_RANKING_CATEGORIES)[number];

export const CHAMPIONS_USAGE_SCHEMA_VERSION = 1 as const;

export interface UsagePokemonEntry {
  /** Overall Pokemon usage position in this format; omitted when unavailable. */
  pokemonRank?: number;
  move: string[];
  ability: string[];
  item: string[];
  /**
   * Optional top-nature usage data.  The API only publishes its leading
   * natures, so an omitted list must not be interpreted as 0% for every
   * nature in the catalog.
   */
  nature?: NatureUsageDatum[];
}

export interface NatureUsageDatum {
  canonicalName: string;
  rank: number;
  percentage: number | null;
}

export type NatureUsageState =
  | { kind: "listed"; rank: number; percentage: number | null }
  | { kind: "unlisted" }
  | { kind: "unavailable" };

export type UsageFormatEntries = Record<string, UsagePokemonEntry>;

export interface ChampionsUsageData {
  schemaVersion: typeof CHAMPIONS_USAGE_SCHEMA_VERSION;
  dataVersion: string;
  sourceGeneratedAt: string;
  formats: Record<SuggestionFormat, UsageFormatEntries>;
}

export const isSuggestionFormat = (value: unknown): value is SuggestionFormat => (
  value === "Singles" || value === "Doubles"
);

export const isUsageRankingCategory = (value: unknown): value is UsageRankingCategory => (
  value === "move" || value === "ability" || value === "item"
);
