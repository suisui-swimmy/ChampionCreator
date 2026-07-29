import {
  SHARE_SCHEMA_VERSION,
  parseShareStateDocument,
} from "./shareState";
import {
  createDefaultTargetForm,
  type ScenarioFormState,
} from "./defenceSearchUi";

export const ENEMY_BOX_STORAGE_KEY = "championcreator.enemy-box.v1";
export const ENEMY_BOX_STORAGE_SCHEMA_VERSION = 1;
export const ENEMY_BOX_BACKUP_FILE_PREFIX = "championcreator-enemy-box-backup";

export type EnemyBoxEntrySummary = {
  pokemonName: string;
  conditionSummary: string;
  statPointSummary: string;
};

export type EnemyBoxEntry = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  summary: EnemyBoxEntrySummary;
  payload: {
    schemaVersion: typeof SHARE_SCHEMA_VERSION;
    scenarios: ScenarioFormState[];
  };
};

export type EnemyBoxStorageDocument = {
  schemaVersion: typeof ENEMY_BOX_STORAGE_SCHEMA_VERSION;
  entries: EnemyBoxEntry[];
};

export type EnemyBoxBackupDocument = EnemyBoxStorageDocument & {
  exportedAt: string;
};

export type EnemyBoxBackupImportResult =
  | {
      status: "success";
      entries: EnemyBoxEntry[];
      skippedCount: number;
      warnings: string[];
    }
  | {
      status: "error";
      message: string;
      warnings: string[];
    };

type EnemyBoxBrowserStorage = Pick<Storage, "getItem" | "setItem">;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const createEnemyBoxEntryId = (): string => {
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }

  return `enemy-box-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

export const createEnemyBoxEntrySummary = (
  scenarios: ScenarioFormState[],
): EnemyBoxEntrySummary => {
  const enabledScenarios = scenarios.filter((scenario) => scenario.enabled);
  const pokemonName = enabledScenarios
    .flatMap((scenario) => scenario.attacks)
    .map((attack) => attack.attackerPokemonInput.trim())
    .find(Boolean) ?? "未設定";
  const counts = enabledScenarios.reduce(
    (current, scenario) => ({
      ...current,
      [scenario.adjustmentType]: current[scenario.adjustmentType] + 1,
    }),
    { defence: 0, offense: 0, speed: 0 },
  );
  const labels = [
    counts.defence ? `耐久 ${counts.defence}` : null,
    counts.offense ? `火力 ${counts.offense}` : null,
    counts.speed ? `素早さ ${counts.speed}` : null,
  ].filter(Boolean);
  const attackCount = enabledScenarios.reduce(
    (total, scenario) => total + scenario.attacks.length,
    0,
  );

  return {
    pokemonName,
    conditionSummary: labels.length > 0 ? labels.join(" / ") : "条件なし",
    statPointSummary: `${enabledScenarios.length}シナリオ / ${attackCount}攻撃`,
  };
};

export const createEnemyBoxEntryFromScenarios = (
  scenarios: ScenarioFormState[],
  options: {
    id?: string;
    name?: string;
    createdAt?: string;
    now?: string;
  } = {},
): EnemyBoxEntry => {
  const now = options.now ?? new Date().toISOString();
  const summary = createEnemyBoxEntrySummary(scenarios);

  return {
    id: options.id ?? createEnemyBoxEntryId(),
    name: options.name ?? summary.pokemonName,
    createdAt: options.createdAt ?? now,
    updatedAt: now,
    summary,
    payload: {
      schemaVersion: SHARE_SCHEMA_VERSION,
      scenarios,
    },
  };
};

const normalizeEnemyBoxEntry = (value: unknown): EnemyBoxEntry | null => {
  if (!isRecord(value) || !isRecord(value.payload)) {
    return null;
  }

  try {
    const normalized = parseShareStateDocument(JSON.stringify({
      schemaVersion: value.payload.schemaVersion,
      target: createDefaultTargetForm(),
      scenarios: value.payload.scenarios,
    }));
    const fallbackSummary = createEnemyBoxEntrySummary(normalized.scenarios);
    const summary = isRecord(value.summary)
      ? {
        pokemonName: typeof value.summary.pokemonName === "string"
          ? value.summary.pokemonName
          : fallbackSummary.pokemonName,
        conditionSummary: typeof value.summary.conditionSummary === "string"
          ? value.summary.conditionSummary
          : fallbackSummary.conditionSummary,
        statPointSummary: typeof value.summary.statPointSummary === "string"
          ? value.summary.statPointSummary
          : fallbackSummary.statPointSummary,
      }
      : fallbackSummary;

    return {
      id: typeof value.id === "string" && value.id ? value.id : createEnemyBoxEntryId(),
      name: typeof value.name === "string" && value.name ? value.name : summary.pokemonName,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
      summary,
      payload: {
        schemaVersion: SHARE_SCHEMA_VERSION,
        scenarios: normalized.scenarios,
      },
    };
  } catch {
    return null;
  }
};

export const parseEnemyBoxStorageDocument = (raw: string | null): EnemyBoxEntry[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      !isRecord(parsed)
      || parsed.schemaVersion !== ENEMY_BOX_STORAGE_SCHEMA_VERSION
      || !Array.isArray(parsed.entries)
    ) {
      return [];
    }

    return parsed.entries.flatMap((entry) => {
      const normalized = normalizeEnemyBoxEntry(entry);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
};

export const stringifyEnemyBoxStorageDocument = (
  entries: EnemyBoxEntry[],
): string => JSON.stringify({
  schemaVersion: ENEMY_BOX_STORAGE_SCHEMA_VERSION,
  entries,
} satisfies EnemyBoxStorageDocument);

export const stringifyEnemyBoxBackupDocument = (
  entries: EnemyBoxEntry[],
  exportedAt = new Date().toISOString(),
): string => `${JSON.stringify({
  schemaVersion: ENEMY_BOX_STORAGE_SCHEMA_VERSION,
  exportedAt,
  entries,
} satisfies EnemyBoxBackupDocument, null, 2)}\n`;

export const createEnemyBoxBackupFileName = (date = new Date()): string => {
  const stamp = date.toISOString().slice(0, 10);
  return `${ENEMY_BOX_BACKUP_FILE_PREFIX}-${stamp}.json`;
};

export const parseEnemyBoxBackupDocument = (raw: string): EnemyBoxBackupImportResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      status: "error",
      message: "仮想敵バックアップJSONを読み込めません",
      warnings: [],
    };
  }

  if (!isRecord(parsed)) {
    return {
      status: "error",
      message: "仮想敵バックアップJSONの形式が不正です",
      warnings: [],
    };
  }

  if (parsed.schemaVersion !== ENEMY_BOX_STORAGE_SCHEMA_VERSION) {
    return {
      status: "error",
      message: `対応していない仮想敵バックアップです (schemaVersion ${ENEMY_BOX_STORAGE_SCHEMA_VERSION} のみ対応)`,
      warnings: [],
    };
  }

  if (!Array.isArray(parsed.entries)) {
    return {
      status: "error",
      message: "仮想敵バックアップJSONに entries がありません",
      warnings: [],
    };
  }

  const entries: EnemyBoxEntry[] = [];
  let skippedCount = 0;
  for (const entry of parsed.entries) {
    const normalized = normalizeEnemyBoxEntry(entry);
    if (normalized) {
      entries.push(normalized);
    } else {
      skippedCount += 1;
    }
  }

  if (entries.length === 0 && parsed.entries.length > 0) {
    return {
      status: "error",
      message: "読み込める仮想敵スロットがありません",
      warnings: [`${skippedCount}件の仮想敵スロットを読み込めませんでした`],
    };
  }

  const warnings = skippedCount > 0
    ? [`${skippedCount}件の仮想敵スロットを読み込めませんでした`]
    : [];

  if (entries.length === 0) {
    warnings.push("バックアップ内の仮想敵スロットは0件です");
  }

  return {
    status: "success",
    entries,
    skippedCount,
    warnings,
  };
};

const getBrowserEnemyBoxStorage = (): EnemyBoxBrowserStorage | null => (
  typeof window === "undefined" ? null : window.localStorage
);

export const loadEnemyBoxEntriesFromBrowser = (
  storage: EnemyBoxBrowserStorage | null = getBrowserEnemyBoxStorage(),
): EnemyBoxEntry[] => {
  if (!storage) {
    return [];
  }

  try {
    return parseEnemyBoxStorageDocument(storage.getItem(ENEMY_BOX_STORAGE_KEY));
  } catch {
    return [];
  }
};

export const saveEnemyBoxEntriesToBrowser = (
  entries: EnemyBoxEntry[],
  storage: EnemyBoxBrowserStorage | null = getBrowserEnemyBoxStorage(),
): string | null => {
  if (!storage) {
    return null;
  }

  try {
    storage.setItem(ENEMY_BOX_STORAGE_KEY, stringifyEnemyBoxStorageDocument(entries));
    return null;
  } catch {
    return "仮想敵ボックスのブラウザ保存に失敗しました";
  }
};

export const duplicateEnemyBoxEntry = (
  entry: EnemyBoxEntry,
  options: {
    id?: string;
    now?: string;
  } = {},
): EnemyBoxEntry => {
  const now = options.now ?? new Date().toISOString();

  return {
    ...entry,
    id: options.id ?? createEnemyBoxEntryId(),
    name: `${entry.name || entry.summary.pokemonName} コピー`,
    createdAt: now,
    updatedAt: now,
  };
};
