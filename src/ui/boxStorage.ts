import {
  createShareStateDocument,
  parseShareStateDocument,
  type ShareStateDocument,
} from "./shareState";
import {
  type ScenarioFormState,
  type TargetFormState,
} from "./defenceSearchUi";
import type { StatPointTable } from "../domain/championsStats";

export const BOX_STORAGE_KEY = "championcreator.box.v1";
export const BOX_STORAGE_SCHEMA_VERSION = 1;
export const BOX_BACKUP_FILE_PREFIX = "championcreator-box-backup";

export type BoxEntrySummary = {
  pokemonName: string;
  conditionSummary: string;
  statPointSummary: string;
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

export type BoxBackupDocument = BoxStorageDocument & {
  exportedAt: string;
};

export type BoxBackupImportResult =
  | {
      status: "success";
      entries: BoxEntry[];
      skippedCount: number;
      warnings: string[];
    }
  | {
      status: "error";
      message: string;
      warnings: string[];
    };

type BoxBrowserStorage = Pick<Storage, "getItem" | "setItem">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createBoxEntryId = (): string => {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `box-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const formatBoxStatPointSummary = (statPoints: StatPointTable): string => (
  [
    `H${statPoints.hp}`,
    `A${statPoints.atk}`,
    `B${statPoints.def}`,
    `C${statPoints.spa}`,
    `D${statPoints.spd}`,
    `S${statPoints.spe}`,
  ].join(" / ")
);

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
    statPointSummary: formatBoxStatPointSummary(target.statPoints),
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
    const fallbackSummary = createBoxEntrySummary(payload.target, payload.scenarios);
    const summary = isRecord(value.summary)
      ? {
        pokemonName: typeof value.summary.pokemonName === "string"
          ? value.summary.pokemonName
          : payload.target.pokemonInput || "未設定",
        conditionSummary: typeof value.summary.conditionSummary === "string"
          ? value.summary.conditionSummary
          : fallbackSummary.conditionSummary,
        statPointSummary: typeof value.summary.statPointSummary === "string"
          ? value.summary.statPointSummary
          : fallbackSummary.statPointSummary,
      }
      : fallbackSummary;

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

export const stringifyBoxBackupDocument = (
  entries: BoxEntry[],
  exportedAt = new Date().toISOString(),
): string => {
  const document: BoxBackupDocument = {
    schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
    exportedAt,
    entries,
  };

  return `${JSON.stringify(document, null, 2)}\n`;
};

export const createBoxBackupFileName = (date = new Date()): string => {
  const stamp = date.toISOString().slice(0, 10);
  return `${BOX_BACKUP_FILE_PREFIX}-${stamp}.json`;
};

export const parseBoxBackupDocument = (raw: string): BoxBackupImportResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "error",
      message: "バックアップJSONを読み込めません",
      warnings: [],
    };
  }

  if (!isRecord(parsed)) {
    return {
      status: "error",
      message: "バックアップJSONの形式が不正です",
      warnings: [],
    };
  }

  if (parsed.schemaVersion !== BOX_STORAGE_SCHEMA_VERSION) {
    return {
      status: "error",
      message: `対応していないバックアップです (schemaVersion ${BOX_STORAGE_SCHEMA_VERSION} のみ対応)`,
      warnings: [],
    };
  }

  if (!Array.isArray(parsed.entries)) {
    return {
      status: "error",
      message: "バックアップJSONに entries がありません",
      warnings: [],
    };
  }

  const entries: BoxEntry[] = [];
  let skippedCount = 0;
  for (const entry of parsed.entries) {
    const normalized = normalizeBoxEntry(entry);
    if (normalized) {
      entries.push(normalized);
    } else {
      skippedCount += 1;
    }
  }

  if (entries.length === 0 && parsed.entries.length > 0) {
    return {
      status: "error",
      message: "読み込める保存スロットがありません",
      warnings: [`${skippedCount}件の保存スロットを読み込めませんでした`],
    };
  }

  const warnings = skippedCount > 0
    ? [`${skippedCount}件の保存スロットを読み込めませんでした`]
    : [];

  if (entries.length === 0) {
    warnings.push("バックアップ内の保存スロットは0件です");
  }

  return {
    status: "success",
    entries,
    skippedCount,
    warnings,
  };
};

const getBrowserBoxStorage = (): BoxBrowserStorage | null => (
  typeof window === "undefined" ? null : window.localStorage
);

export const loadBoxEntriesFromBrowser = (
  storage: BoxBrowserStorage | null = getBrowserBoxStorage(),
): BoxEntry[] => {
  if (!storage) {
    return [];
  }

  return parseBoxStorageDocument(storage.getItem(BOX_STORAGE_KEY));
};

export const saveBoxEntriesToBrowser = (
  entries: BoxEntry[],
  storage: BoxBrowserStorage | null = getBrowserBoxStorage(),
): string | null => {
  if (!storage) {
    return null;
  }

  try {
    storage.setItem(BOX_STORAGE_KEY, stringifyBoxStorageDocument(entries));
    return null;
  } catch {
    return "ブラウザ保存に失敗しました";
  }
};

export const duplicateBoxEntry = (
  entry: BoxEntry,
  options: {
    id?: string;
    now?: string;
  } = {},
): BoxEntry => {
  const now = options.now ?? new Date().toISOString();

  return {
    ...entry,
    id: options.id ?? createBoxEntryId(),
    name: `${entry.name || entry.summary.pokemonName} コピー`,
    createdAt: now,
    updatedAt: now,
  };
};
