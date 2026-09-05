import {
  CHAMPIONS_USAGE_SCHEMA_VERSION,
  SUGGESTION_FORMATS,
  USAGE_RANKING_CATEGORIES,
  type ChampionsUsageData,
  type SuggestionFormat,
  type UsageFormatEntries,
  type NatureUsageDatum,
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

const parseNatureRanking = (
  value: unknown,
  path: string,
): NatureUsageDatum[] | undefined => {
  // `nature` was added as an optional field to schema v1.  Keeping the
  // property omitted for older payloads lets the client distinguish an
  // unavailable feed from a feed that did publish a top-nature list.
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new UsageDataValidationError(path, "expected an array");
  }

  const seenNames = new Set<string>();
  const seenRanks = new Set<number>();
  return value.map((rawEntry, index) => {
    const entryPath = `${path}[${index}]`;
    assertRecord(rawEntry, entryPath);

    const canonicalName = rawEntry.canonicalName;
    assertNonEmptyString(canonicalName, `${entryPath}.canonicalName`);
    if (seenNames.has(canonicalName)) {
      throw new UsageDataValidationError(
        `${entryPath}.canonicalName`,
        `duplicate canonical name ${JSON.stringify(canonicalName)}`,
      );
    }
    seenNames.add(canonicalName);

    const rawRank = rawEntry.rank;
    if (typeof rawRank !== "number" || !Number.isInteger(rawRank) || rawRank < 1 || rawRank > 10) {
      throw new UsageDataValidationError(
        `${entryPath}.rank`,
        "expected a positive integer rank from 1 through 10",
      );
    }
    const rank = rawRank;
    if (seenRanks.has(rank)) {
      throw new UsageDataValidationError(`${entryPath}.rank`, `duplicate rank ${rank}`);
    }
    seenRanks.add(rank);

    const percentage = rawEntry.percentage;
    if (percentage !== null && (
      typeof percentage !== "number"
      || !Number.isFinite(percentage)
      || percentage < 0
      || percentage > 100
    )) {
      throw new UsageDataValidationError(
        `${entryPath}.percentage`,
        "expected null or a finite percentage from 0 through 100",
      );
    }

    return { canonicalName, rank, percentage };
  });
};

const parsePokemonEntry = (value: unknown, path: string): UsagePokemonEntry => {
  assertRecord(value, path);

  const entry = {} as UsagePokemonEntry;
  if (value.pokemonRank !== undefined) {
    if (typeof value.pokemonRank !== "number"
      || !Number.isSafeInteger(value.pokemonRank)
      || value.pokemonRank < 1) {
      throw new UsageDataValidationError(`${path}.pokemonRank`, "expected a positive integer rank");
    }
    entry.pokemonRank = value.pokemonRank;
  }
  for (const category of USAGE_RANKING_CATEGORIES) {
    entry[category] = parseRanking(value[category], `${path}.${category}`);
  }
  const nature = parseNatureRanking(value.nature, `${path}.nature`);
  if (nature !== undefined) {
    entry.nature = nature;
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
