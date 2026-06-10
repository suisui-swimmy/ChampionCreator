import {
  createShareStateDocument,
  parseShareStateDocument,
  type ShareStateDocument,
} from "./shareState";
import {
  type ScenarioFormState,
  type TargetFormState,
} from "./defenceSearchUi";

export const BOX_STORAGE_KEY = "championcreator.box.v1";
export const BOX_STORAGE_SCHEMA_VERSION = 1;

export type BoxEntrySummary = {
  pokemonName: string;
  conditionSummary: string;
};

export type BoxEntry = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  summary: BoxEntrySummary;
  payload: ShareStateDocument;
};

export type BoxStorageDocument = {
  schemaVersion: typeof BOX_STORAGE_SCHEMA_VERSION;
  entries: BoxEntry[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createBoxEntryId = (): string => {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `box-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const createBoxEntrySummary = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
): BoxEntrySummary => {
  const pokemonName = target.pokemonInput.trim() || "未設定";
  const counts = scenarios.reduce(
    (current, scenario) => {
      if (!scenario.enabled) {
        return current;
      }

      return {
        ...current,
        [scenario.adjustmentType]: current[scenario.adjustmentType] + 1,
      };
    },
    { defence: 0, offense: 0, speed: 0 },
  );
  const labels = [
    counts.defence ? `耐久 ${counts.defence}` : null,
    counts.offense ? `火力 ${counts.offense}` : null,
    counts.speed ? `素早さ ${counts.speed}` : null,
  ].filter(Boolean);

  return {
    pokemonName,
    conditionSummary: labels.length > 0 ? labels.join(" / ") : "条件なし",
  };
};

export const createBoxEntryFromState = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
  options: {
    id?: string;
    name?: string;
    createdAt?: string;
    now?: string;
  } = {},
): BoxEntry => {
  const now = options.now ?? new Date().toISOString();
  const summary = createBoxEntrySummary(target, scenarios);
  const name = options.name ?? summary.pokemonName;

  return {
    id: options.id ?? createBoxEntryId(),
    name,
    createdAt: options.createdAt ?? now,
    updatedAt: now,
    summary,
    payload: createShareStateDocument(target, scenarios),
  };
};

const normalizeBoxEntry = (value: unknown): BoxEntry | null => {
  if (!isRecord(value)) {
    return null;
  }

  try {
    const payload = parseShareStateDocument(JSON.stringify(value.payload));
    const summary = isRecord(value.summary)
      ? {
        pokemonName: typeof value.summary.pokemonName === "string"
          ? value.summary.pokemonName
          : payload.target.pokemonInput || "未設定",
        conditionSummary: typeof value.summary.conditionSummary === "string"
          ? value.summary.conditionSummary
          : createBoxEntrySummary(payload.target, payload.scenarios).conditionSummary,
      }
      : createBoxEntrySummary(payload.target, payload.scenarios);

    return {
      id: typeof value.id === "string" && value.id ? value.id : createBoxEntryId(),
      name: typeof value.name === "string" && value.name ? value.name : summary.pokemonName,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
      summary,
      payload,
    };
  } catch {
    return null;
  }
};

export const parseBoxStorageDocument = (raw: string | null): BoxEntry[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed)
      || parsed.schemaVersion !== BOX_STORAGE_SCHEMA_VERSION
      || !Array.isArray(parsed.entries)
    ) {
      return [];
    }

    return parsed.entries.flatMap((entry) => {
      const normalized = normalizeBoxEntry(entry);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
};

export const stringifyBoxStorageDocument = (entries: BoxEntry[]): string => {
  const document: BoxStorageDocument = {
    schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
    entries,
  };

  return JSON.stringify(document);
};
