import {
  cloneLocalSyncState,
  createEmptyLocalSyncState,
  isSyncKind,
  makeSyncRecordKey,
  makeSyncStorageKey,
  LOCAL_SYNC_STATE_SCHEMA_VERSION,
  type LocalSyncState,
  type SyncConflict,
  type SyncMetadata,
  type SyncMutation,
  type SyncRecord,
} from "./syncTypes";
import { decodeSyncPayload } from "./syncPayload";

export interface SyncStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type SyncRepositoryErrorCode = "corrupt" | "unavailable" | "quota";

export class SyncRepositoryError extends Error {
  readonly code: SyncRepositoryErrorCode;
  /** `reason` is kept as a stable app-owned alias for UI/coordinator code. */
  readonly reason: SyncRepositoryErrorCode;

  constructor(code: SyncRepositoryErrorCode, message: string) {
    super(message);
    this.name = "SyncRepositoryError";
    this.code = code;
    this.reason = code;
  }
}

export type SyncRepositoryLoadResult =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly state: LocalSyncState }
  | { readonly status: "corrupt"; readonly error: SyncRepositoryError } 
  | { readonly status: "unavailable"; readonly error: SyncRepositoryError };

export type SyncRepositorySaveResult =
  | { readonly status: "valid"; readonly state: LocalSyncState }
  | { readonly status: "corrupt"; readonly error: SyncRepositoryError }
  | { readonly status: "unavailable"; readonly error: SyncRepositoryError }
  | { readonly status: "quota"; readonly error: SyncRepositoryError };

export interface LocalSyncRepository {
  readonly ownerUid: string;
  readonly storageKey: string;
  load(): SyncRepositoryLoadResult;
  save(state: LocalSyncState): SyncRepositorySaveResult;
}

export type SyncRepository = LocalSyncRepository;

export interface LocalSyncRepositoryOptions {
  readonly storage?: SyncStorageLike | null;
}

export interface MemorySyncRepository extends LocalSyncRepository {
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

const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === "number" && Number.isInteger(value) && value >= 0
);

const isPositiveInteger = (value: unknown): value is number => (
  typeof value === "number" && Number.isInteger(value) && value > 0
);

const isNullableString = (value: unknown): value is string | null => (
  value === null || typeof value === "string"
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

const corrupt = (message: string): SyncRepositoryError => (
  new SyncRepositoryError("corrupt", message)
);

const unavailable = (message: string): SyncRepositoryError => (
  new SyncRepositoryError("unavailable", message)
);

const quota = (message: string): SyncRepositoryError => (
  new SyncRepositoryError("quota", message)
);

const parseRecord = (
  value: unknown,
  ownerUid: string,
  key: string | undefined,
): SyncRecord | null => {
  if (!isRecord(value)
    || value.ownerUid !== ownerUid
    || !isSyncKind(value.kind)
    || !isNonEmptyString(value.entryId)
    || !isNonEmptyString(value.recordKey)
    || value.recordKey !== makeSyncRecordKey(value.kind, value.entryId)
    || (key !== undefined && key !== value.recordKey)
    || !isPositiveInteger(value.revision)
    || !isNonNegativeInteger(value.baseRevision)
    || value.revision !== value.baseRevision + 1
    || typeof value.payload !== "string"
    || value.payload.length === 0
    || typeof value.tombstone !== "boolean"
    || !isNullableString(value.deletedAt)
    || (value.tombstone ? value.deletedAt === null : value.deletedAt !== null)
    || !isNonEmptyString(value.updatedAt)
    || !isNonEmptyString(value.mutationId)) {
    return null;
  }
  const decoded = decodeSyncPayload(value.kind, value.payload, value.entryId);
  if (decoded.status === "error") {
    return null;
  }
  return {
    ownerUid: value.ownerUid,
    kind: value.kind,
    entryId: value.entryId,
    recordKey: value.recordKey,
    revision: value.revision,
    baseRevision: value.baseRevision,
    payload: value.payload,
    tombstone: value.tombstone,
    deletedAt: value.deletedAt,
    updatedAt: value.updatedAt,
    mutationId: value.mutationId,
  };
};

const parseMutation = (value: unknown, ownerUid: string): SyncMutation | null => {
  if (!isRecord(value) || !isPositiveInteger(value.sequence) || !isNonEmptyString(value.queuedAt)) {
    return null;
  }
  const baseMutationId = value.baseMutationId;
  const record = parseRecord(value, ownerUid, undefined);
  if (!record) {
    return null;
  }
  if (record.baseRevision === 0) {
    if (baseMutationId !== null) {
      return null;
    }
    return {
      ...record,
      sequence: value.sequence,
      queuedAt: value.queuedAt,
      baseMutationId: null,
    };
  }
  if (!isNonEmptyString(baseMutationId)) {
    return null;
  }
  return {
    ...record,
    sequence: value.sequence,
    queuedAt: value.queuedAt,
    baseMutationId,
  };
};

const parseConflict = (value: unknown, ownerUid: string): SyncConflict | null => {
  if (!isRecord(value)
    || !isNonEmptyString(value.recordKey)
    || !isSyncKind(value.kind)
    || !isNonEmptyString(value.entryId)
    || value.recordKey !== makeSyncRecordKey(value.kind, value.entryId)
    || !isNonEmptyString(value.detectedAt)) {
    return null;
  }
  const local = parseRecord(value.local, ownerUid, undefined);
  if (!local || local.recordKey !== value.recordKey) {
    return null;
  }
  const parsedRemote = value.remote === undefined
    ? undefined
    : parseRecord(value.remote, ownerUid, undefined);
  if (value.remote !== undefined && !parsedRemote) {
    return null;
  }
  const remote: SyncRecord | undefined = parsedRemote ?? undefined;
  return {
    recordKey: value.recordKey,
    kind: value.kind,
    entryId: value.entryId,
    local,
    remote,
    detectedAt: value.detectedAt,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
};

const parseLocalSyncStateValue = (
  value: unknown,
  expectedOwnerUid?: string,
): LocalSyncState => {
  if (!isRecord(value)) {
    throw corrupt("同期状態のJSONオブジェクトが不正です");
  }
  if (value.schemaVersion !== LOCAL_SYNC_STATE_SCHEMA_VERSION) {
    throw corrupt(`対応していない同期状態です (schemaVersion ${LOCAL_SYNC_STATE_SCHEMA_VERSION} のみ対応)`);
  }
  const nextSequence = value.nextSequence;
  if (!isNonEmptyString(value.ownerUid)
    || (expectedOwnerUid !== undefined && value.ownerUid !== expectedOwnerUid)) {
    throw corrupt("同期状態のownerUidが不正です");
  }
  if (!isRecord(value.records) || !Array.isArray(value.outbox)
    || !isRecord(value.conflicts) || !isRecord(value.metadata)
    || !isPositiveInteger(nextSequence)) {
    throw corrupt("同期状態のrecords / outbox / conflicts / metadataが不正です");
  }

  const records: Record<string, SyncRecord> = {};
  for (const [key, rawRecord] of Object.entries(value.records)) {
    const record = parseRecord(rawRecord, value.ownerUid, key);
    if (!record) {
      throw corrupt("同期状態のrecordが不正です");
    }
    records[key] = record;
  }

  const outbox: SyncMutation[] = [];
  let previousSequence = 0;
  for (const rawMutation of value.outbox) {
    const mutation = parseMutation(rawMutation, value.ownerUid);
    if (!mutation || mutation.sequence <= previousSequence) {
      throw corrupt("同期状態のoutbox順序が不正です");
    }
    previousSequence = mutation.sequence;
    outbox.push(mutation);
  }
  if (outbox.some((mutation) => mutation.sequence >= nextSequence)) {
    throw corrupt("同期状態のnextSequenceが不正です");
  }

  const conflicts: Record<string, SyncConflict> = {};
  for (const [key, rawConflict] of Object.entries(value.conflicts)) {
    const conflict = parseConflict(rawConflict, value.ownerUid);
    if (!conflict || key !== conflict.recordKey) {
      throw corrupt("同期状態のconflictが不正です");
    }
    conflicts[key] = conflict;
  }

  const metadata: SyncMetadata = { ...value.metadata };
  return {
    schemaVersion: LOCAL_SYNC_STATE_SCHEMA_VERSION,
    ownerUid: value.ownerUid,
    records,
    outbox,
    conflicts,
    metadata,
    nextSequence,
  };
};

export const parseLocalSyncState = (
  raw: string,
  expectedOwnerUid?: string,
): LocalSyncState => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw corrupt("同期状態JSONを読み込めません");
  }
  return parseLocalSyncStateValue(parsed, expectedOwnerUid);
};

export const isLocalSyncState = (
  value: unknown,
  expectedOwnerUid?: string,
): value is LocalSyncState => {
  try {
    parseLocalSyncStateValue(value, expectedOwnerUid);
    return true;
  } catch {
    return false;
  }
};

export const stringifyLocalSyncState = (state: LocalSyncState): string => {
  // Reuse the same strict checks as load, including owner/kind/slot
  // invariants, before writing anything to storage.
  const normalized = parseLocalSyncStateValue(state, state.ownerUid);
  try {
    return JSON.stringify(normalized);
  } catch {
    throw corrupt("同期状態をJSONへ変換できません");
  }
};

export const serializeLocalSyncState = stringifyLocalSyncState;

const resolveBrowserStorage = (
  supplied?: SyncStorageLike | null,
): SyncStorageLike | null => {
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

const makeBrowserRepository = (
  ownerUid: string,
  storage: SyncStorageLike | null | undefined,
): LocalSyncRepository => {
  const resolvedStorage = resolveBrowserStorage(storage);
  const storageKey = makeSyncStorageKey(ownerUid);
  return {
    ownerUid,
    storageKey,
    load: (): SyncRepositoryLoadResult => {
      if (!resolvedStorage) {
        return {
          status: "unavailable",
          error: unavailable("同期用ブラウザ保存を利用できません"),
        };
      }
      let raw: string | null;
      try {
        raw = resolvedStorage.getItem(storageKey);
      } catch {
        return {
          status: "unavailable",
          error: unavailable("同期用ブラウザ保存を読み込めません"),
        };
      }
      if (raw === null) {
        return { status: "missing" };
      }
      try {
        return {
          status: "valid",
          state: parseLocalSyncState(raw, ownerUid),
        };
      } catch (error) {
        const repositoryError = error instanceof SyncRepositoryError
          ? error
          : corrupt("同期状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
    },
    save: (state: LocalSyncState): SyncRepositorySaveResult => {
      if (!resolvedStorage) {
        return {
          status: "unavailable",
          error: unavailable("同期用ブラウザ保存を利用できません"),
        };
      }
      let serialized: string;
      try {
        serialized = stringifyLocalSyncState(state);
        // One setItem call is the localStorage transaction boundary: callers
        // never observe partially written records/outbox pieces.
        resolvedStorage.setItem(storageKey, serialized);
      } catch (error) {
        if (error instanceof SyncRepositoryError) {
          return { status: "corrupt", error };
        }
        return isQuotaExceededError(error)
          ? { status: "quota", error: quota("同期状態を保存できる容量がありません") }
          : { status: "unavailable", error: unavailable("同期用ブラウザ保存へ書き込めません") };
      }
      return { status: "valid", state: cloneLocalSyncState(state) };
    },
  };
};

export function createLocalSyncRepository(
  ownerUid: string,
  options?: LocalSyncRepositoryOptions,
): LocalSyncRepository;
export function createLocalSyncRepository(
  storage: SyncStorageLike | null,
  ownerUid: string,
): LocalSyncRepository;
export function createLocalSyncRepository(
  first: string | SyncStorageLike | null,
  second?: LocalSyncRepositoryOptions | string,
): LocalSyncRepository {
  if (typeof first === "string") {
    return makeBrowserRepository(first, (second as LocalSyncRepositoryOptions | undefined)?.storage);
  }
  return makeBrowserRepository(second as string, first);
}

export const createBrowserLocalSyncRepository = createLocalSyncRepository;
export const createBrowserSyncRepository = createLocalSyncRepository;

export const createMemorySyncRepository = (
  ownerUid: string,
  initial?: LocalSyncState | string | null,
): MemorySyncRepository => {
  let raw = typeof initial === "string"
    ? initial
    : initial === null || initial === undefined
      ? null
      : stringifyLocalSyncState(initial);
  const storageKey = makeSyncStorageKey(ownerUid);
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
    load: (): SyncRepositoryLoadResult => {
      if (raw === null) {
        return { status: "missing" };
      }
      try {
        return { status: "valid", state: parseLocalSyncState(raw, ownerUid) };
      } catch (error) {
        const repositoryError = error instanceof SyncRepositoryError
          ? error
          : corrupt("同期状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
    },
    save: (state: LocalSyncState): SyncRepositorySaveResult => {
      let serialized: string;
      try {
        serialized = stringifyLocalSyncState(state);
      } catch (error) {
        const repositoryError = error instanceof SyncRepositoryError
          ? error
          : corrupt("同期状態を検証できません");
        return { status: "corrupt", error: repositoryError };
      }
      raw = serialized;
      return { status: "valid", state: cloneLocalSyncState(state) };
    },
  };
};

export const createInMemorySyncRepository = createMemorySyncRepository;

/** Convenience initializer for coordinator tests and first-login setup. */
export const createEmptySyncState = createEmptyLocalSyncState;
