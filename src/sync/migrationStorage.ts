import {
  BOX_DEFAULT_EXAMPLE_SEEDED_KEY,
  BOX_STORAGE_KEY,
  BOX_STORAGE_SCHEMA_VERSION,
  createDefaultBoxExampleEntry,
  parseBoxBackupDocument,
  type BoxEntry,
} from "../ui/boxStorage";
import {
  ENEMY_BOX_STORAGE_KEY,
  ENEMY_BOX_STORAGE_SCHEMA_VERSION,
  parseEnemyBoxBackupDocument,
  type EnemyBoxEntry,
} from "../ui/enemyBoxStorage";
import { sha256Hex } from "./firestoreSyncRepository";

/**
 * The migration reader intentionally has a smaller storage interface than the
 * normal browser repositories.  A snapshot is a read-only operation: it must
 * never invoke the box loaders, because the target-box loader can seed the
 * default example as a side effect.
 */
export interface MigrationRawStorageLike {
  getItem(key: string): string | null;
}

export interface MigrationStateStorageLike extends MigrationRawStorageLike {
  setItem(key: string, value: string): void;
}

export const MIGRATION_STATE_SCHEMA_VERSION = 1 as const;
export type MigrationStateSchemaVersion = typeof MIGRATION_STATE_SCHEMA_VERSION;

export const MIGRATION_STATE_STORAGE_KEY_PREFIX = "championcreator.migration.v1";

export const makeMigrationStateStorageKey = (ownerUid: string): string => (
  `${MIGRATION_STATE_STORAGE_KEY_PREFIX}.${encodeURIComponent(ownerUid)}`
);

export const createMigrationStateStorageKey = makeMigrationStateStorageKey;
export const getMigrationStateStorageKey = makeMigrationStateStorageKey;
export const makeMigrationStorageKey = makeMigrationStateStorageKey;

export type MigrationStatus =
  | "not-started"
  | "in-progress"
  | "needs-review"
  | "completed";

export type MigrationDecision =
  | "merge"
  | "use-cloud"
  | "use-device"
  | "defer";

export interface MigrationState {
  readonly schemaVersion: MigrationStateSchemaVersion;
  readonly ownerUid: string;
  readonly status: MigrationStatus;
  /** Optional metadata is kept app-owned and does not contain box payloads. */
  readonly updatedAt?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly decision?: MigrationDecision;
  readonly sourceFingerprint?: string;
  readonly reviewReason?: string;
}

export type MigrationStateRepositoryErrorCode = "corrupt" | "unavailable" | "quota";

export class MigrationStateRepositoryError extends Error {
  readonly code: MigrationStateRepositoryErrorCode;
  readonly reason: MigrationStateRepositoryErrorCode;

  constructor(code: MigrationStateRepositoryErrorCode, message: string) {
    super(message);
    this.name = "MigrationStateRepositoryError";
    this.code = code;
    this.reason = code;
  }
}

export type MigrationStateLoadResult =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly state: MigrationState }
  | { readonly status: "corrupt"; readonly error: MigrationStateRepositoryError }
  | { readonly status: "unavailable"; readonly error: MigrationStateRepositoryError };

export type MigrationStateSaveResult =
  | { readonly status: "valid"; readonly state: MigrationState }
  | { readonly status: "corrupt"; readonly error: MigrationStateRepositoryError }
  | { readonly status: "unavailable"; readonly error: MigrationStateRepositoryError }
  | { readonly status: "quota"; readonly error: MigrationStateRepositoryError };

export interface MigrationStateRepository {
  readonly ownerUid: string;
  readonly storageKey: string;
  load(): MigrationStateLoadResult;
  save(state: MigrationState): MigrationStateSaveResult;
}

export interface MigrationStateRepositoryOptions {
  readonly storage?: MigrationStateStorageLike | null;
}

export interface MemoryMigrationStateRepository extends MigrationStateRepository {
  readonly raw: string | null;
  setRaw(raw: string | null): void;
  clear(): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === "string" && value.length > 0
);

const isTimestamp = (value: unknown): value is string => (
  isNonEmptyString(value) && Number.isFinite(Date.parse(value))
);

const isQuotaExceededError = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }
  return error.name === "QuotaExceededError"
    || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error.code === 22
    || error.code === 1014;
};

const stateCorrupt = (message: string): MigrationStateRepositoryError => (
  new MigrationStateRepositoryError("corrupt", message)
);

const stateUnavailable = (message: string): MigrationStateRepositoryError => (
  new MigrationStateRepositoryError("unavailable", message)
);

const stateQuota = (message: string): MigrationStateRepositoryError => (
  new MigrationStateRepositoryError("quota", message)
);

const migrationStatuses = new Set<MigrationStatus>([
  "not-started",
  "in-progress",
  "needs-review",
  "completed",
]);

const migrationDecisions = new Set<MigrationDecision>([
  "merge",
  "use-cloud",
  "use-device",
  "defer",
]);

const parseMigrationStateValue = (
  value: unknown,
  expectedOwnerUid?: string,
): MigrationState => {
  if (!isRecord(value)) {
    throw stateCorrupt("移行状態のJSONオブジェクトが不正です");
  }
  if (value.schemaVersion !== MIGRATION_STATE_SCHEMA_VERSION) {
    throw stateCorrupt(
      `対応していない移行状態です (schemaVersion ${MIGRATION_STATE_SCHEMA_VERSION} のみ対応)`,
    );
  }
  if (!isNonEmptyString(value.ownerUid)
    || (expectedOwnerUid !== undefined && value.ownerUid !== expectedOwnerUid)) {
    throw stateCorrupt("移行状態のownerUidが不正です");
  }
  if (typeof value.status !== "string"
    || !migrationStatuses.has(value.status as MigrationStatus)) {
    throw stateCorrupt("移行状態のstatusが不正です");
  }

  const optionalTimestamps = ["updatedAt", "startedAt", "completedAt"] as const;
  for (const key of optionalTimestamps) {
    if (value[key] !== undefined && !isTimestamp(value[key])) {
      throw stateCorrupt(`移行状態の${key}が不正です`);
    }
  }
  if (value.decision !== undefined
    && (typeof value.decision !== "string"
      || !migrationDecisions.has(value.decision as MigrationDecision))) {
    throw stateCorrupt("移行状態のdecisionが不正です");
  }
  if (value.sourceFingerprint !== undefined
    && !isNonEmptyString(value.sourceFingerprint)) {
    throw stateCorrupt("移行状態のsourceFingerprintが不正です");
  }
  if (value.reviewReason !== undefined && typeof value.reviewReason !== "string") {
    throw stateCorrupt("移行状態のreviewReasonが不正です");
  }

  return {
    schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
    ownerUid: value.ownerUid,
    status: value.status as MigrationStatus,
    ...(value.updatedAt === undefined ? {} : { updatedAt: value.updatedAt as string }),
    ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt as string }),
    ...(value.completedAt === undefined ? {} : { completedAt: value.completedAt as string }),
    ...(value.decision === undefined ? {} : { decision: value.decision as MigrationDecision }),
    ...(value.sourceFingerprint === undefined ? {} : { sourceFingerprint: value.sourceFingerprint }),
    ...(value.reviewReason === undefined ? {} : { reviewReason: value.reviewReason }),
  };
};

export const parseMigrationState = (
  raw: string,
  expectedOwnerUid?: string,
): MigrationState => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw stateCorrupt("移行状態JSONを読み込めません");
  }
  return parseMigrationStateValue(parsed, expectedOwnerUid);
};

export const isMigrationState = (
  value: unknown,
  expectedOwnerUid?: string,
): value is MigrationState => {
  try {
    parseMigrationStateValue(value, expectedOwnerUid);
    return true;
  } catch {
    return false;
  }
};

export const stringifyMigrationState = (state: MigrationState): string => {
  const normalized = parseMigrationStateValue(state, state.ownerUid);
  try {
    return JSON.stringify(normalized);
  } catch {
    throw stateCorrupt("移行状態をJSONへ変換できません");
  }
};

export const serializeMigrationState = stringifyMigrationState;

const resolveStateStorage = (
  supplied?: MigrationStateStorageLike | null,
): MigrationStateStorageLike | null => {
  if (supplied !== undefined) {
    return supplied;
  }
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const makeStateRepository = (
  ownerUid: string,
  storage: MigrationStateStorageLike | null | undefined,
): MigrationStateRepository => {
  const resolvedStorage = resolveStateStorage(storage);
  const storageKey = makeMigrationStateStorageKey(ownerUid);
  return {
    ownerUid,
    storageKey,
    load: (): MigrationStateLoadResult => {
      if (!resolvedStorage) {
        return {
          status: "unavailable",
          error: stateUnavailable("移行状態用ブラウザ保存を利用できません"),
        };
      }
      let raw: string | null;
      try {
        raw = resolvedStorage.getItem(storageKey);
      } catch {
        return {
          status: "unavailable",
          error: stateUnavailable("移行状態を読み込めません"),
        };
      }
      if (raw === null) {
        return { status: "missing" };
      }
      try {
        return {
          status: "valid",
          state: parseMigrationState(raw, ownerUid),
        };
      } catch (error) {
        const repositoryError = error instanceof MigrationStateRepositoryError
          ? error
          : stateCorrupt("移行状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
    },
    save: (state: MigrationState): MigrationStateSaveResult => {
      if (!resolvedStorage) {
        return {
          status: "unavailable",
          error: stateUnavailable("移行状態用ブラウザ保存を利用できません"),
        };
      }
      let serialized: string;
      try {
        if (state.ownerUid !== ownerUid) {
          throw stateCorrupt("移行状態のownerUidが不正です");
        }
        serialized = stringifyMigrationState(state);
      } catch (error) {
        const repositoryError = error instanceof MigrationStateRepositoryError
          ? error
          : stateCorrupt("移行状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
      try {
        resolvedStorage.setItem(storageKey, serialized);
      } catch (error) {
        return isQuotaExceededError(error)
          ? { status: "quota", error: stateQuota("移行状態を保存できる容量がありません") }
          : { status: "unavailable", error: stateUnavailable("移行状態へ書き込めません") };
      }
      try {
        return {
          status: "valid",
          state: parseMigrationState(serialized, ownerUid),
        };
      } catch (error) {
        const repositoryError = error instanceof MigrationStateRepositoryError
          ? error
          : stateCorrupt("移行状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
    },
  };
};

export const createMigrationStateRepository = (
  ownerUid: string,
  options?: MigrationStateRepositoryOptions,
): MigrationStateRepository => makeStateRepository(ownerUid, options?.storage);

export const createBrowserMigrationStateRepository = createMigrationStateRepository;

export const createMemoryMigrationStateRepository = (
  ownerUid: string,
  initial?: MigrationState | string | null,
): MemoryMigrationStateRepository => {
  let raw = typeof initial === "string"
    ? initial
    : initial === null || initial === undefined
      ? null
      : stringifyMigrationState(initial);
  const storageKey = makeMigrationStateStorageKey(ownerUid);
  return {
    ownerUid,
    storageKey,
    get raw() {
      return raw;
    },
    setRaw(nextRaw) {
      raw = nextRaw;
    },
    clear() {
      raw = null;
    },
    load: (): MigrationStateLoadResult => {
      if (raw === null) {
        return { status: "missing" };
      }
      try {
        return {
          status: "valid",
          state: parseMigrationState(raw, ownerUid),
        };
      } catch (error) {
        const repositoryError = error instanceof MigrationStateRepositoryError
          ? error
          : stateCorrupt("移行状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
    },
    save: (state: MigrationState): MigrationStateSaveResult => {
      try {
        if (state.ownerUid !== ownerUid) {
          throw stateCorrupt("移行状態のownerUidが不正です");
        }
        raw = stringifyMigrationState(state);
        return {
          status: "valid",
          state: parseMigrationState(raw, ownerUid),
        };
      } catch (error) {
        const repositoryError = error instanceof MigrationStateRepositoryError
          ? error
          : stateCorrupt("移行状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
    },
  };
};

export const createInMemoryMigrationStateRepository = createMemoryMigrationStateRepository;

export type MigrationSnapshotKind = "target-box" | "enemy-box";

export type MigrationDefaultDisposition =
  | "fresh"
  | "untouched"
  | "modified"
  | "deleted"
  | "unseeded";

export type MigrationSnapshotErrorCode =
  | "corrupt"
  | "unavailable"
  | "unknown-marker"
  | "future-schema";

export class MigrationSnapshotError extends Error {
  readonly code: MigrationSnapshotErrorCode;
  readonly key?: string;

  constructor(code: MigrationSnapshotErrorCode, message: string, key?: string) {
    super(message);
    this.name = "MigrationSnapshotError";
    this.code = code;
    this.key = key;
  }
}

export interface MigrationSnapshotRaw {
  readonly targetBox: string | null;
  readonly enemyBox: string | null;
  readonly defaultMarker: string | null;
  /** Aliases make the legacy key boundary explicit to controller callers. */
  readonly box: string | null;
  readonly enemy: string | null;
}

export interface MigrationSnapshotSummary {
  readonly kind: MigrationSnapshotKind;
  readonly initialized: boolean;
  readonly marker: "absent" | "seeded";
  readonly entryCount: number;
  readonly deviceEntryCount: number;
  readonly defaultDisposition: MigrationDefaultDisposition | "not-applicable";
  readonly defaultPresent: boolean;
  readonly deletedDefaultIntent: boolean;
}

export interface MigrationSnapshotFingerprint {
  readonly logical: string;
  readonly entries: string;
  readonly targetBox?: string;
  readonly enemyBox?: string;
  readonly combined?: string;
}

export interface TargetBoxMigrationSnapshot {
  readonly kind: "target-box";
  readonly raw: string | null;
  readonly entries: readonly BoxEntry[];
  readonly deviceEntries: readonly BoxEntry[];
  readonly defaultEntry: BoxEntry | null;
  readonly defaultDisposition: MigrationDefaultDisposition;
  readonly summary: MigrationSnapshotSummary;
  readonly fingerprint: MigrationSnapshotFingerprint;
}

export interface EnemyBoxMigrationSnapshot {
  readonly kind: "enemy-box";
  readonly raw: string | null;
  readonly entries: readonly EnemyBoxEntry[];
  readonly deviceEntries: readonly EnemyBoxEntry[];
  readonly defaultEntry: null;
  readonly defaultDisposition: "unseeded";
  readonly summary: MigrationSnapshotSummary;
  readonly fingerprint: MigrationSnapshotFingerprint;
}

export interface LegacyMigrationSnapshot {
  readonly raw?: MigrationSnapshotRaw;
  readonly targetBox?: TargetBoxMigrationSnapshot;
  readonly enemyBox?: EnemyBoxMigrationSnapshot;
  readonly target?: TargetBoxMigrationSnapshot;
  readonly enemy?: EnemyBoxMigrationSnapshot;
  readonly summary?: {
    readonly targetBox: MigrationSnapshotSummary;
    readonly enemyBox: MigrationSnapshotSummary;
  };
  /** Combined logical fingerprint consumed by the migration plan layer. */
  readonly fingerprint: string;
  /** Per-source fingerprints retained for diagnostics and summaries. */
  readonly fingerprints?: MigrationSnapshotFingerprint;
  /** Compatibility shape used by the controller/plan boundary. */
  readonly defaultExampleState: "deleted" | "untouched" | "modified" | "uninitialized";
  readonly targetEntries: readonly BoxEntry[];
  readonly enemyEntries: readonly EnemyBoxEntry[];
  readonly targetDeviceEntries?: readonly BoxEntry[];
  readonly enemyDeviceEntries?: readonly EnemyBoxEntry[];
  readonly deletedDefaultIntent?: boolean;
}

/** Full result returned by the raw reader.  The base shape remains optional
 * for the pure migration-plan tests, which intentionally use a structural
 * four-field fixture. */
export interface CapturedLegacyMigrationSnapshot extends LegacyMigrationSnapshot {
  readonly raw: MigrationSnapshotRaw;
  readonly targetBox: TargetBoxMigrationSnapshot;
  readonly enemyBox: EnemyBoxMigrationSnapshot;
  readonly target: TargetBoxMigrationSnapshot;
  readonly enemy: EnemyBoxMigrationSnapshot;
  readonly summary: {
    readonly targetBox: MigrationSnapshotSummary;
    readonly enemyBox: MigrationSnapshotSummary;
  };
  readonly fingerprints: MigrationSnapshotFingerprint;
  readonly targetDeviceEntries: readonly BoxEntry[];
  readonly enemyDeviceEntries: readonly EnemyBoxEntry[];
  readonly deletedDefaultIntent: boolean;
}

export type MigrationSnapshot = CapturedLegacyMigrationSnapshot;
export type MigrationSnapshotTargetBox = TargetBoxMigrationSnapshot;
export type MigrationSnapshotEnemyBox = EnemyBoxMigrationSnapshot;

const snapshotCorrupt = (message: string, key: string): MigrationSnapshotError => (
  new MigrationSnapshotError("corrupt", message, key)
);

const parseRawJson = (raw: string, key: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw snapshotCorrupt("保存データJSONを読み込めません", key);
  }
};

const assertStrictEntryEnvelope = (
  value: unknown,
  key: string,
  index: number,
): asserts value is Record<string, unknown> => {
  if (!isRecord(value)) {
    throw snapshotCorrupt(`保存データのentry ${index + 1}が不正です`, key);
  }
  if (!isNonEmptyString(value.id)) {
    throw snapshotCorrupt(`保存データのentry ${index + 1}のidが不正です`, key);
  }
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    throw snapshotCorrupt(`保存データのentry ${index + 1}のtimestampが不正です`, key);
  }
  if (!isRecord(value.payload)) {
    throw snapshotCorrupt(`保存データのentry ${index + 1}のpayloadが不正です`, key);
  }
}

const assertStrictOuterEnvelope = (
  parsed: unknown,
  expectedSchemaVersion: number,
  key: string,
): void => {
  if (!isRecord(parsed)) {
    throw snapshotCorrupt("保存データの外側JSONオブジェクトが不正です", key);
  }
  if (parsed.schemaVersion !== expectedSchemaVersion) {
    if (typeof parsed.schemaVersion === "number"
      && Number.isInteger(parsed.schemaVersion)
      && parsed.schemaVersion > expectedSchemaVersion) {
      throw new MigrationSnapshotError(
        "future-schema",
        `保存データのschemaVersion ${String(parsed.schemaVersion)}には未対応です`,
        key,
      );
    }
    throw snapshotCorrupt("保存データのschemaVersionが不正です", key);
  }
  if (!Array.isArray(parsed.entries)) {
    throw snapshotCorrupt("保存データのentriesが不正です", key);
  }
};

const strictTargetEntries = (raw: string): BoxEntry[] => {
  const key = BOX_STORAGE_KEY;
  const parsed = parseRawJson(raw, key);
  assertStrictOuterEnvelope(parsed, BOX_STORAGE_SCHEMA_VERSION, key);
  const envelope = parsed as Record<string, unknown> & { entries: unknown[] };
  envelope.entries.forEach((entry, index) => assertStrictEntryEnvelope(entry, key, index));

  // The existing backup parser remains the canonical migration boundary.  It
  // performs legacy share-schema upgrades and summary normalization; this
  // layer only prevents it from silently repairing a malformed outer entry.
  const result = parseBoxBackupDocument(raw);
  if (result.status === "error" || result.entries.length !== envelope.entries.length) {
    throw snapshotCorrupt(
      result.status === "error" ? result.message : "保存データのentryを正規化できません",
      key,
    );
  }
  return result.entries;
};

const strictEnemyEntries = (raw: string): EnemyBoxEntry[] => {
  const key = ENEMY_BOX_STORAGE_KEY;
  const parsed = parseRawJson(raw, key);
  assertStrictOuterEnvelope(parsed, ENEMY_BOX_STORAGE_SCHEMA_VERSION, key);
  const envelope = parsed as Record<string, unknown> & { entries: unknown[] };
  envelope.entries.forEach((entry, index) => assertStrictEntryEnvelope(entry, key, index));

  const result = parseEnemyBoxBackupDocument(raw);
  if (result.status === "error" || result.entries.length !== envelope.entries.length) {
    throw snapshotCorrupt(
      result.status === "error" ? result.message : "仮想敵保存データのentryを正規化できません",
      key,
    );
  }
  return result.entries;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
};

const semanticEntry = (entry: BoxEntry | EnemyBoxEntry): unknown => ({
  id: entry.id,
  name: entry.name,
  summary: entry.summary,
  payload: entry.payload,
});

const entriesFingerprint = (kind: MigrationSnapshotKind, entries: readonly (BoxEntry | EnemyBoxEntry)[]): string => (
  sha256Hex(stableStringify({ kind, entries: entries.map(semanticEntry) }))
);

const makeLogicalFingerprint = (
  kind: MigrationSnapshotKind,
  entries: readonly (BoxEntry | EnemyBoxEntry)[],
  defaultDisposition: MigrationDefaultDisposition | "not-applicable",
): string => sha256Hex(stableStringify({
  kind,
  defaultIntent: defaultDisposition === "deleted" ? "deleted" : "present",
  entries: entries.map(semanticEntry),
}));

const sameDefaultSemantics = (entry: BoxEntry, expected: BoxEntry): boolean => (
  stableStringify(semanticEntry(entry)) === stableStringify(semanticEntry(expected))
);

const resolveBrowserReadStorage = (
  supplied?: MigrationRawStorageLike | null,
): MigrationRawStorageLike | null => {
  if (supplied !== undefined) {
    return supplied;
  }
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

const readLegacyRaw = (
  storage: MigrationRawStorageLike,
  key: string,
): string | null => {
  try {
    return storage.getItem(key);
  } catch {
    throw new MigrationSnapshotError("unavailable", "移行元のブラウザ保存を読み込めません", key);
  }
};

const makeTargetSnapshot = (
  raw: string | null,
  markerRaw: string | null,
): TargetBoxMigrationSnapshot => {
  const marker = markerRaw === "1" ? "seeded" : "absent";
  if (markerRaw !== null && markerRaw !== "1") {
    throw new MigrationSnapshotError(
      "unknown-marker",
      `既定サンプルmarker ${JSON.stringify(markerRaw)}には未対応です`,
      BOX_DEFAULT_EXAMPLE_SEEDED_KEY,
    );
  }

  const entries = raw === null ? [] : strictTargetEntries(raw);
  const expectedDefault = createDefaultBoxExampleEntry("2000-01-01T00:00:00.000Z");
  const defaultEntry = entries.find((entry) => entry.id === expectedDefault.id) ?? null;
  let defaultDisposition: MigrationDefaultDisposition;
  if (raw === null && markerRaw === null) {
    defaultDisposition = "fresh";
  } else if (defaultEntry && sameDefaultSemantics(defaultEntry, expectedDefault)) {
    defaultDisposition = "untouched";
  } else if (defaultEntry) {
    defaultDisposition = "modified";
  } else if (marker === "seeded") {
    // A seeded marker without the example is a user deletion and must remain
    // an explicit intent. The controller must not silently reseed it.
    defaultDisposition = "deleted";
  } else {
    defaultDisposition = "unseeded";
  }

  const deviceEntries = defaultDisposition === "untouched" || defaultDisposition === "fresh"
    ? entries.filter((entry) => entry.id !== expectedDefault.id)
    : entries;
  const fingerprint: MigrationSnapshotFingerprint = {
    entries: entriesFingerprint("target-box", deviceEntries),
    logical: makeLogicalFingerprint("target-box", deviceEntries, defaultDisposition),
    targetBox: makeLogicalFingerprint("target-box", deviceEntries, defaultDisposition),
  };
  return {
    kind: "target-box",
    raw,
    entries,
    deviceEntries,
    defaultEntry,
    defaultDisposition,
    summary: {
      kind: "target-box",
      initialized: raw !== null,
      marker,
      entryCount: entries.length,
      deviceEntryCount: deviceEntries.length,
      defaultDisposition,
      defaultPresent: defaultEntry !== null,
      deletedDefaultIntent: defaultDisposition === "deleted",
    },
    fingerprint,
  };
};

const makeEnemySnapshot = (raw: string | null): EnemyBoxMigrationSnapshot => {
  const entries = raw === null ? [] : strictEnemyEntries(raw);
  const deviceEntries = entries;
  const logical = makeLogicalFingerprint("enemy-box", deviceEntries, "unseeded");
  return {
    kind: "enemy-box",
    raw,
    entries,
    deviceEntries,
    defaultEntry: null,
    defaultDisposition: "unseeded",
    summary: {
      kind: "enemy-box",
      initialized: raw !== null,
      marker: "absent",
      entryCount: entries.length,
      deviceEntryCount: deviceEntries.length,
      defaultDisposition: "not-applicable",
      defaultPresent: false,
      deletedDefaultIntent: false,
    },
    fingerprint: {
      entries: entriesFingerprint("enemy-box", deviceEntries),
      logical,
      enemyBox: logical,
    },
  };
};

/**
 * Capture all three legacy keys without invoking either normal box loader.
 * `storage` is read-only by type and no write method is ever called here.
 */
export const captureLegacyMigrationSnapshot = (
  storage: MigrationRawStorageLike | null | undefined = undefined,
): CapturedLegacyMigrationSnapshot => {
  const resolvedStorage = resolveBrowserReadStorage(storage);
  if (!resolvedStorage) {
    throw new MigrationSnapshotError("unavailable", "移行元のブラウザ保存を利用できません");
  }
  const targetRaw = readLegacyRaw(resolvedStorage, BOX_STORAGE_KEY);
  const enemyRaw = readLegacyRaw(resolvedStorage, ENEMY_BOX_STORAGE_KEY);
  const markerRaw = readLegacyRaw(resolvedStorage, BOX_DEFAULT_EXAMPLE_SEEDED_KEY);
  const targetBox = makeTargetSnapshot(targetRaw, markerRaw);
  const enemyBox = makeEnemySnapshot(enemyRaw);
  const raw: MigrationSnapshotRaw = {
    targetBox: targetRaw,
    enemyBox: enemyRaw,
    defaultMarker: markerRaw,
    box: targetRaw,
    enemy: enemyRaw,
  };
  const combined = sha256Hex(stableStringify({
    target: targetBox.fingerprint.logical,
    enemy: enemyBox.fingerprint.logical,
  }));
  const fingerprint: MigrationSnapshotFingerprint = {
    logical: combined,
    entries: combined,
    targetBox: targetBox.fingerprint.logical,
    enemyBox: enemyBox.fingerprint.logical,
    combined,
  };
  const summary = { targetBox: targetBox.summary, enemyBox: enemyBox.summary };
  return {
    raw,
    targetBox,
    enemyBox,
    target: targetBox,
    enemy: enemyBox,
    summary,
    fingerprint: combined,
    fingerprints: fingerprint,
    defaultExampleState: targetBox.defaultDisposition === "deleted"
      ? "deleted"
      : targetBox.defaultDisposition === "modified"
        ? "modified"
        : targetBox.defaultDisposition === "untouched"
          ? "untouched"
          : "uninitialized",
    targetEntries: targetBox.entries,
    enemyEntries: enemyBox.entries,
    targetDeviceEntries: targetBox.deviceEntries,
    enemyDeviceEntries: enemyBox.deviceEntries,
    deletedDefaultIntent: targetBox.defaultDisposition === "deleted",
  };
};

export const captureMigrationSnapshot = captureLegacyMigrationSnapshot;
export const readLegacyMigrationSnapshot = captureLegacyMigrationSnapshot;

export const captureTargetBoxMigrationSnapshot = (
  storage: MigrationRawStorageLike | null | undefined = undefined,
): TargetBoxMigrationSnapshot => captureLegacyMigrationSnapshot(storage).targetBox;

export const captureEnemyBoxMigrationSnapshot = (
  storage: MigrationRawStorageLike | null | undefined = undefined,
): EnemyBoxMigrationSnapshot => captureLegacyMigrationSnapshot(storage).enemyBox;

export const fingerprintMigrationSnapshot = (
  snapshot: LegacyMigrationSnapshot,
): string => snapshot.fingerprint;

export const summarizeMigrationSnapshot = (
  snapshot: LegacyMigrationSnapshot,
): LegacyMigrationSnapshot["summary"] => snapshot.summary;
