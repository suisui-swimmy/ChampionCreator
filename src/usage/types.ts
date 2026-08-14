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
  move: string[];
  ability: string[];
  item: string[];
}

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
