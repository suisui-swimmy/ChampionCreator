import { isSuggestionFormat, type SuggestionFormat } from "./types";

export const SUGGESTION_FORMAT_STORAGE_KEY = "championcreator.suggestion-format.v1";
export const SUGGESTION_FORMAT_STORAGE_SCHEMA_VERSION = 1 as const;

export interface SuggestionFormatPreference {
  schemaVersion: typeof SUGGESTION_FORMAT_STORAGE_SCHEMA_VERSION;
  format: SuggestionFormat;
}

export interface SuggestionFormatStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const defaultFormat: SuggestionFormat = "Singles";

const getDefaultStorage = (): SuggestionFormatStorage | undefined => {
  try {
    if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
      return undefined;
    }
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const readStorage = (storage?: SuggestionFormatStorage): SuggestionFormatStorage | undefined => (
  storage ?? getDefaultStorage()
);

const parsePreference = (raw: string | null): SuggestionFormat | undefined => {
  if (!raw) {
    return undefined;
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object"
      || value === null
      || Array.isArray(value)
      || (value as Record<string, unknown>).schemaVersion !== SUGGESTION_FORMAT_STORAGE_SCHEMA_VERSION
      || !isSuggestionFormat((value as Record<string, unknown>).format)
    ) {
      return undefined;
    }
    return (value as { format: SuggestionFormat }).format;
  } catch {
    return undefined;
  }
};

export const loadSuggestionFormat = (
  storage?: SuggestionFormatStorage,
): SuggestionFormat => {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return defaultFormat;
  }

  try {
    return parsePreference(resolvedStorage.getItem(SUGGESTION_FORMAT_STORAGE_KEY)) ?? defaultFormat;
  } catch {
    return defaultFormat;
  }
};

export const saveSuggestionFormat = (
  format: SuggestionFormat,
  storage?: SuggestionFormatStorage,
): boolean => {
  if (!isSuggestionFormat(format)) {
    return false;
  }

  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return false;
  }

  const preference: SuggestionFormatPreference = {
    schemaVersion: SUGGESTION_FORMAT_STORAGE_SCHEMA_VERSION,
    format,
  };

  try {
    resolvedStorage.setItem(SUGGESTION_FORMAT_STORAGE_KEY, JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
};

