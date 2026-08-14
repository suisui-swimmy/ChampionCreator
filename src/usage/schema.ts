import {
  CHAMPIONS_USAGE_SCHEMA_VERSION,
  SUGGESTION_FORMATS,
  USAGE_RANKING_CATEGORIES,
  type ChampionsUsageData,
  type SuggestionFormat,
  type UsageFormatEntries,
  type UsagePokemonEntry,
} from "./types";

export class UsageDataValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`Invalid champions usage data at ${path}: ${message}`);
    this.name = "UsageDataValidationError";
    this.path = path;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === "string" && value.trim().length > 0
);

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new UsageDataValidationError(path, "expected an object");
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (!isNonEmptyString(value)) {
    throw new UsageDataValidationError(path, "expected a non-empty string");
  }
}

const parseRanking = (value: unknown, path: string): string[] => {
  if (!Array.isArray(value)) {
    throw new UsageDataValidationError(path, "expected an array");
  }

  const seen = new Set<string>();
  return value.map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    assertNonEmptyString(entry, entryPath);
    if (seen.has(entry)) {
      throw new UsageDataValidationError(entryPath, `duplicate canonical name ${JSON.stringify(entry)}`);
    }
    seen.add(entry);
    return entry;
  });
};

const parsePokemonEntry = (value: unknown, path: string): UsagePokemonEntry => {
  assertRecord(value, path);

  const entry = {} as UsagePokemonEntry;
  for (const category of USAGE_RANKING_CATEGORIES) {
    entry[category] = parseRanking(value[category], `${path}.${category}`);
  }
  return entry;
};

const parseFormatEntries = (value: unknown, path: string): UsageFormatEntries => {
  assertRecord(value, path);

  const entries: UsageFormatEntries = {};
  for (const [pokemonKey, pokemonValue] of Object.entries(value)) {
    if (!isNonEmptyString(pokemonKey)) {
      throw new UsageDataValidationError(`${path}.${pokemonKey}`, "expected a non-empty Pokemon key");
    }
    entries[pokemonKey] = parsePokemonEntry(pokemonValue, `${path}.${pokemonKey}`);
  }
  return entries;
};

const parseSourceGeneratedAt = (value: unknown, path: string): string => {
  assertNonEmptyString(value, path);
  if (Number.isNaN(Date.parse(value))) {
    throw new UsageDataValidationError(path, "expected an ISO-compatible date string");
  }
  return value;
};

/**
 * Validate and copy the generated static payload.
 *
 * Unknown properties are intentionally ignored so a later payload can add
 * fields (for example natures) without making the v1 client unusable. Every
 * field required by v1 is validated strictly and ranking arrays may be empty,
 * which is how the deploy workflow represents a valid no-data fallback.
 */
export const parseChampionsUsageData = (value: unknown): ChampionsUsageData => {
  assertRecord(value, "$");

  if (value.schemaVersion !== CHAMPIONS_USAGE_SCHEMA_VERSION) {
    throw new UsageDataValidationError(
      "$.schemaVersion",
      `expected ${CHAMPIONS_USAGE_SCHEMA_VERSION}`,
    );
  }

  assertNonEmptyString(value.dataVersion, "$.dataVersion");
  const sourceGeneratedAt = parseSourceGeneratedAt(value.sourceGeneratedAt, "$.sourceGeneratedAt");
  assertRecord(value.formats, "$.formats");

  const formats = {} as Record<SuggestionFormat, UsageFormatEntries>;
  for (const format of SUGGESTION_FORMATS) {
    if (!Object.prototype.hasOwnProperty.call(value.formats, format)) {
      throw new UsageDataValidationError(`$.formats.${format}`, "missing format");
    }
    formats[format] = parseFormatEntries(value.formats[format], `$.formats.${format}`);
  }

  return {
    schemaVersion: CHAMPIONS_USAGE_SCHEMA_VERSION,
    dataVersion: value.dataVersion,
    sourceGeneratedAt,
    formats,
  };
};

export const parseChampionsUsageDataJson = (raw: string): ChampionsUsageData => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new UsageDataValidationError(
      "$",
      `expected valid JSON (${error instanceof Error ? error.message : "parse error"})`,
    );
  }
  return parseChampionsUsageData(value);
};
