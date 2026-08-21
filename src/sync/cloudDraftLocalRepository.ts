import {
  parseDraftStorageDocument,
  type DraftStorageDocument,
} from "../ui/draftStorage";
import {
  CLOUD_DRAFT_MAX_ACTIVE_RECORDS,
  CLOUD_DRAFT_SCHEMA_VERSION,
  createEmptyCloudDraftLocalState,
  makeCloudDraftRecordKey,
  type CloudDraftEnvelope,
  type CloudDraftLocalState,
  type CloudDraftMetadata,
  type CloudDraftMutation,
  type CloudDraftRecord,
} from "./cloudDraftTypes";

export const CLOUD_DRAFT_LOCAL_STORAGE_KEY_PREFIX = "championcreator.cloud-draft.v1";

export const makeCloudDraftStorageKey = (
  ownerUid: string,
  deviceId: string,
): string => (
  `${CLOUD_DRAFT_LOCAL_STORAGE_KEY_PREFIX}.${encodeURIComponent(ownerUid)}.${encodeURIComponent(deviceId)}`
);

export const makeCloudDraftLocalStorageKey = makeCloudDraftStorageKey;
export const createCloudDraftStorageKey = makeCloudDraftStorageKey;
export const getCloudDraftStorageKey = makeCloudDraftStorageKey;

export interface CloudDraftStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type CloudDraftRepositoryErrorCode = "corrupt" | "unavailable" | "quota";

export class CloudDraftRepositoryError extends Error {
  readonly code: CloudDraftRepositoryErrorCode;
  readonly reason: CloudDraftRepositoryErrorCode;

  constructor(code: CloudDraftRepositoryErrorCode, message: string) {
    super(message);
    this.name = "CloudDraftRepositoryError";
    this.code = code;
    this.reason = code;
  }
}

export type CloudDraftRepositoryLoadResult =
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly state: CloudDraftLocalState }
  | { readonly status: "corrupt"; readonly error: CloudDraftRepositoryError }
  | { readonly status: "unavailable"; readonly error: CloudDraftRepositoryError };

export type CloudDraftRepositorySaveResult =
  | { readonly status: "valid"; readonly state: CloudDraftLocalState }
  | { readonly status: "corrupt"; readonly error: CloudDraftRepositoryError }
  | { readonly status: "unavailable"; readonly error: CloudDraftRepositoryError }
  | { readonly status: "quota"; readonly error: CloudDraftRepositoryError };

export interface CloudDraftLocalRepository {
  readonly ownerUid: string;
  readonly currentDeviceId: string;
  readonly storageKey: string;
  load(): CloudDraftRepositoryLoadResult;
  save(state: CloudDraftLocalState): CloudDraftRepositorySaveResult;
}

export type LocalCloudDraftRepository = CloudDraftLocalRepository;

export interface CloudDraftLocalRepositoryOptions {
  readonly storage?: CloudDraftStorageLike | null;
}

export interface MemoryCloudDraftLocalRepository extends CloudDraftLocalRepository {
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

const isPositiveInteger = (value: unknown): value is number => (
  typeof value === "number" && Number.isInteger(value) && value > 0
);

const isNonNegativeInteger = (value: unknown): value is number => (
  typeof value === "number" && Number.isInteger(value) && value >= 0
);

const isIsoDateString = (value: unknown): value is string => (
  isNonEmptyString(value) && Number.isFinite(Date.parse(value))
);

const isNullableIsoDateString = (value: unknown): value is string | null => (
  value === null || isIsoDateString(value)
);

const isSafeDeviceLabel = (value: unknown): value is string => (
  isNonEmptyString(value)
  && value.length <= 80
  && !/[\u0000-\u001f\u007f]/u.test(value)
);

const corrupt = (message: string): CloudDraftRepositoryError => (
  new CloudDraftRepositoryError("corrupt", message)
);

const unavailable = (message: string): CloudDraftRepositoryError => (
  new CloudDraftRepositoryError("unavailable", message)
);

const quota = (message: string): CloudDraftRepositoryError => (
  new CloudDraftRepositoryError("quota", message)
);

const isQuotaExceededError = (error: unknown): boolean => (
  isRecord(error)
  && (error.name === "QuotaExceededError"
    || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error.code === 22
    || error.code === 1014)
);

const parsePayload = (value: unknown): string | null => {
  if (!isNonEmptyString(value)) {
    return null;
  }
  try {
    // This is the existing DraftStorageDocument parser, so cloud payloads
    // cannot introduce a second or weaker validation boundary.
    parseDraftStorageDocument(value);
    return value;
  } catch {
    return null;
  }
};

const parseEnvelopeValue = (
  value: unknown,
  expectedOwnerUid?: string,
): CloudDraftEnvelope | null => {
  if (!isRecord(value)
    || value.schemaVersion !== CLOUD_DRAFT_SCHEMA_VERSION
    || !isNonEmptyString(value.ownerUid)
    || (expectedOwnerUid !== undefined && value.ownerUid !== expectedOwnerUid)
    || !isNonEmptyString(value.deviceId)
    || !isSafeDeviceLabel(value.deviceLabel)
    || !isPositiveInteger(value.revision)
    || !isNonNegativeInteger(value.baseRevision)
    || value.revision !== value.baseRevision + 1
    || !isNonEmptyString(value.mutationId)
    || !isIsoDateString(value.updatedAt)
    || !isIsoDateString(value.expiresAt)
    || !isNullableIsoDateString(value.deletedAt)) {
    return null;
  }
  const payload = parsePayload(value.payload);
  if (payload === null) {
    return null;
  }
  return {
    ownerUid: value.ownerUid,
    deviceId: value.deviceId,
    deviceLabel: value.deviceLabel,
    schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
    payload,
    revision: value.revision,
    baseRevision: value.baseRevision,
    mutationId: value.mutationId,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    deletedAt: value.deletedAt,
  };
};

export const parseCloudDraftEnvelope = (
  value: unknown,
  expectedOwnerUid?: string,
): CloudDraftEnvelope | null => parseEnvelopeValue(value, expectedOwnerUid);

export const parseCloudDraftRecord = (
  value: unknown,
  expectedOwnerUid?: string,
): CloudDraftRecord | null => parseEnvelopeValue(value, expectedOwnerUid);

const parseMutationValue = (
  value: unknown,
  expectedOwnerUid?: string,
): CloudDraftMutation | null => {
  if (!isRecord(value)
    || !isPositiveInteger(value.sequence)
    || !isIsoDateString(value.queuedAt)) {
    return null;
  }
  const record = parseEnvelopeValue(value, expectedOwnerUid);
  if (!record) {
    return null;
  }
  if (record.baseRevision === 0) {
    if (value.baseMutationId !== null) {
      return null;
    }
  } else if (!isNonEmptyString(value.baseMutationId)) {
    return null;
  }
  return {
    ...record,
    sequence: value.sequence,
    queuedAt: value.queuedAt,
    baseMutationId: value.baseMutationId,
  };
};

export const parseCloudDraftMutation = (
  value: unknown,
  expectedOwnerUid?: string,
): CloudDraftMutation | null => parseMutationValue(value, expectedOwnerUid);

const parseLocalStateValue = (
  value: unknown,
  expectedOwnerUid?: string,
  expectedDeviceId?: string,
): CloudDraftLocalState => {
  if (!isRecord(value)
    || value.schemaVersion !== CLOUD_DRAFT_SCHEMA_VERSION
    || !isNonEmptyString(value.ownerUid)
    || (expectedOwnerUid !== undefined && value.ownerUid !== expectedOwnerUid)
    || !isNonEmptyString(value.currentDeviceId)
    || (expectedDeviceId !== undefined && value.currentDeviceId !== expectedDeviceId)
    || !isRecord(value.records)
    || !Array.isArray(value.outbox)
    || !isPositiveInteger(value.nextSequence)
    || !isRecord(value.metadata)) {
    throw corrupt("クラウド下書きのローカル状態が不正です");
  }

  const records: Record<string, CloudDraftRecord> = {};
  let activeRecordCount = 0;
  for (const [key, rawRecord] of Object.entries(value.records)) {
    const record = parseEnvelopeValue(rawRecord, value.ownerUid);
    if (!record || key !== makeCloudDraftRecordKey(record.deviceId)) {
      throw corrupt("クラウド下書きのrecordが不正です");
    }
    if (record.deletedAt === null) {
      activeRecordCount += 1;
    }
    records[key] = record;
  }
  if (activeRecordCount > CLOUD_DRAFT_MAX_ACTIVE_RECORDS) {
    throw corrupt(`クラウド下書きの有効件数が上限(${CLOUD_DRAFT_MAX_ACTIVE_RECORDS})を超えています`);
  }

  const outbox: CloudDraftMutation[] = [];
  const nextSequence = value.nextSequence;
  let previousSequence = 0;
  for (const rawMutation of value.outbox) {
    const mutation = parseMutationValue(rawMutation, value.ownerUid);
    if (!mutation || mutation.sequence <= previousSequence) {
      throw corrupt("クラウド下書きのoutbox順序が不正です");
    }
    previousSequence = mutation.sequence;
    outbox.push(mutation);
  }
  if (outbox.some((mutation) => mutation.sequence >= nextSequence)) {
    throw corrupt("クラウド下書きのnextSequenceが不正です");
  }

  const metadata: CloudDraftMetadata = { ...value.metadata };
  return {
    schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
    ownerUid: value.ownerUid,
    currentDeviceId: value.currentDeviceId,
    records,
    outbox,
    nextSequence,
    metadata,
  };
};

export const parseCloudDraftLocalState = (
  raw: string,
  expectedOwnerUid?: string,
  expectedDeviceId?: string,
): CloudDraftLocalState => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw corrupt("クラウド下書きのローカル状態JSONを読み込めません");
  }
  return parseLocalStateValue(parsed, expectedOwnerUid, expectedDeviceId);
};

export const isCloudDraftLocalState = (
  value: unknown,
  expectedOwnerUid?: string,
  expectedDeviceId?: string,
): value is CloudDraftLocalState => {
  try {
    parseLocalStateValue(value, expectedOwnerUid, expectedDeviceId);
    return true;
  } catch {
    return false;
  }
};

export const stringifyCloudDraftLocalState = (
  state: CloudDraftLocalState,
): string => {
  const normalized = parseLocalStateValue(state, state.ownerUid, state.currentDeviceId);
  try {
    return JSON.stringify(normalized);
  } catch {
    throw corrupt("クラウド下書きのローカル状態をJSONへ変換できません");
  }
};

export const serializeCloudDraftLocalState = stringifyCloudDraftLocalState;

const cloneState = (state: CloudDraftLocalState): CloudDraftLocalState => (
  parseLocalStateValue(state, state.ownerUid, state.currentDeviceId)
);

const resolveStorage = (
  storage?: CloudDraftStorageLike | null,
): CloudDraftStorageLike | null => {
  if (storage !== undefined) {
    return storage;
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

const createBrowserRepository = (
  ownerUid: string,
  currentDeviceId: string,
  storage?: CloudDraftStorageLike | null,
): CloudDraftLocalRepository => {
  const resolvedStorage = resolveStorage(storage);
  const storageKey = makeCloudDraftStorageKey(ownerUid, currentDeviceId);
  return {
    ownerUid,
    currentDeviceId,
    storageKey,
    load: (): CloudDraftRepositoryLoadResult => {
      if (!resolvedStorage) {
        return {
          status: "unavailable",
          error: unavailable("クラウド下書きのローカル保存を利用できません"),
        };
      }
      let raw: string | null;
      try {
        raw = resolvedStorage.getItem(storageKey);
      } catch {
        return {
          status: "unavailable",
          error: unavailable("クラウド下書きのローカル保存を読み込めません"),
        };
      }
      if (raw === null) {
        return { status: "missing" };
      }
      try {
        return {
          status: "valid",
          state: parseCloudDraftLocalState(raw, ownerUid, currentDeviceId),
        };
      } catch (error) {
        return {
          status: "corrupt",
          error: error instanceof CloudDraftRepositoryError
            ? error
            : corrupt("クラウド下書きのローカル状態を検証できません"),
        };
      }
    },
    save: (state: CloudDraftLocalState): CloudDraftRepositorySaveResult => {
      if (!resolvedStorage) {
        return {
          status: "unavailable",
          error: unavailable("クラウド下書きのローカル保存を利用できません"),
        };
      }
      let serialized: string;
      try {
        serialized = stringifyCloudDraftLocalState(state);
      } catch (error) {
        return {
          status: "corrupt",
          error: error instanceof CloudDraftRepositoryError
            ? error
            : corrupt("クラウド下書きのローカル状態が不正です"),
        };
      }
      try {
        // One setItem call is the localStorage transaction boundary. The
        // state is never exposed as separately-written records or outbox rows.
        resolvedStorage.setItem(storageKey, serialized);
      } catch (error) {
        return isQuotaExceededError(error)
          ? { status: "quota", error: quota("クラウド下書きを保存できる容量がありません") }
          : { status: "unavailable", error: unavailable("クラウド下書きのローカル保存へ書き込めません") };
      }
      return { status: "valid", state: cloneState(state) };
    },
  };
};

export function createCloudDraftLocalRepository(
  ownerUid: string,
  currentDeviceId: string,
  options?: CloudDraftLocalRepositoryOptions,
): CloudDraftLocalRepository;
export function createCloudDraftLocalRepository(
  storage: CloudDraftStorageLike | null,
  ownerUid: string,
  currentDeviceId: string,
): CloudDraftLocalRepository;
export function createCloudDraftLocalRepository(
  first: string | CloudDraftStorageLike | null,
  second: string,
  third?: CloudDraftLocalRepositoryOptions | string,
): CloudDraftLocalRepository {
  if (typeof first === "string") {
    return createBrowserRepository(first, second, (third as CloudDraftLocalRepositoryOptions | undefined)?.storage);
  }
  return createBrowserRepository(second, third as string, first);
}

export const createLocalCloudDraftRepository = createCloudDraftLocalRepository;
export const createBrowserCloudDraftLocalRepository = createCloudDraftLocalRepository;
export const createBrowserLocalCloudDraftRepository = createCloudDraftLocalRepository;

export const createMemoryCloudDraftLocalRepository = (
  ownerUid: string,
  currentDeviceId: string,
  initial?: CloudDraftLocalState | string | null,
): MemoryCloudDraftLocalRepository => {
  let raw = initial === undefined || initial === null
    ? null
    : typeof initial === "string"
      ? initial
      : stringifyCloudDraftLocalState(initial);
  const storageKey = makeCloudDraftStorageKey(ownerUid, currentDeviceId);
  return {
    ownerUid,
    currentDeviceId,
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
    load: (): CloudDraftRepositoryLoadResult => {
      if (raw === null) {
        return { status: "missing" };
      }
      try {
        return {
          status: "valid",
          state: parseCloudDraftLocalState(raw, ownerUid, currentDeviceId),
        };
      } catch (error) {
        return {
          status: "corrupt",
          error: error instanceof CloudDraftRepositoryError
            ? error
            : corrupt("クラウド下書きのローカル状態を検証できません"),
        };
      }
    },
    save: (state): CloudDraftRepositorySaveResult => {
      try {
        raw = stringifyCloudDraftLocalState(state);
        return { status: "valid", state: cloneState(state) };
      } catch (error) {
        return {
          status: "corrupt",
          error: error instanceof CloudDraftRepositoryError
            ? error
            : corrupt("クラウド下書きのローカル状態が不正です"),
        };
      }
    },
  };
};

export const createInMemoryCloudDraftLocalRepository = createMemoryCloudDraftLocalRepository;
export const createEmptyCloudDraftState = createEmptyCloudDraftLocalState;
