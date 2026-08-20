import {
  cloneLocalSyncState,
  makeSyncRecordKey,
  type LocalSyncState,
  type SyncEntryForKind,
  type SyncKind,
  type SyncMutation,
  type SyncRecord,
} from "./syncTypes";
import { encodeSyncPayload } from "./syncPayload";

export type SyncClockValue = string | Date;
export type SyncClock = SyncClockValue | (() => SyncClockValue);
export type SyncMutationId = string | (() => string);

export interface SyncMutationOptions {
  readonly now?: SyncClock;
  readonly mutationId?: SyncMutationId;
}

export interface SyncUpsertInput<K extends SyncKind = SyncKind> extends SyncMutationOptions {
  readonly kind: K;
  readonly entry: SyncEntryForKind<K>;
}

export interface SyncTombstoneInput extends SyncMutationOptions {
  readonly kind: SyncKind;
  readonly entryId: string;
}

export type SyncOutboxFailureReason =
  | "conflict"
  | "invalid-state"
  | "invalid-entry"
  | "missing-record";

export class SyncOutboxError extends Error {
  readonly reason: SyncOutboxFailureReason;

  constructor(reason: SyncOutboxFailureReason, message: string) {
    super(message);
    this.name = "SyncOutboxError";
    this.reason = reason;
  }
}

export interface SyncEnqueueSuccess {
  readonly status: "success";
  readonly state: LocalSyncState;
  readonly record: SyncRecord;
  readonly mutation: SyncMutation;
}

export interface SyncEnqueueFailure {
  readonly status: "error";
  readonly reason: SyncOutboxFailureReason;
  readonly message: string;
  readonly error: SyncOutboxError;
}

export type SyncEnqueueResult = SyncEnqueueSuccess | SyncEnqueueFailure;

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === "string" && value.length > 0
);

const resolveClock = (value: SyncClock | undefined): string => {
  const resolved = typeof value === "function" ? value() : value;
  if (resolved instanceof Date) {
    return resolved.toISOString();
  }
  return resolved ?? new Date().toISOString();
};

const resolveMutationId = (value: SyncMutationId | undefined): string => {
  const resolved = typeof value === "function" ? value() : value;
  if (resolved !== undefined) {
    return resolved;
  }
  if (globalThis.crypto && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `sync-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const failure = (
  reason: SyncOutboxFailureReason,
  message: string,
): SyncEnqueueFailure => {
  const error = new SyncOutboxError(reason, message);
  return { status: "error", reason, message, error };
};

const hasConflict = (state: LocalSyncState, key: string): boolean => (
  Object.prototype.hasOwnProperty.call(state.conflicts, key)
);

const isValidStateShape = (state: LocalSyncState): boolean => (
  state.schemaVersion === 1
  && isNonEmptyString(state.ownerUid)
  && state.records !== null
  && typeof state.records === "object"
  && !Array.isArray(state.records)
  && Array.isArray(state.outbox)
  && state.conflicts !== null
  && typeof state.conflicts === "object"
  && !Array.isArray(state.conflicts)
  && state.metadata !== null
  && typeof state.metadata === "object"
  && !Array.isArray(state.metadata)
  && Number.isInteger(state.nextSequence)
  && state.nextSequence > 0
);

const makeBaseRecord = (
  state: LocalSyncState,
  input: {
    kind: SyncKind;
    entryId: string;
    payload: string;
    tombstone: boolean;
    deletedAt: string | null;
    now: string;
    mutationId: string;
  },
): SyncEnqueueSuccess => {
  const recordKey = makeSyncRecordKey(input.kind, input.entryId);
  const previous = state.records[recordKey];
  const previousRevision = previous?.revision ?? 0;
  const revision = previousRevision + 1;
  const baseRevision = previousRevision;
  const record: SyncRecord = {
    ownerUid: state.ownerUid,
    kind: input.kind,
    entryId: input.entryId,
    recordKey,
    revision,
    baseRevision,
    payload: input.payload,
    tombstone: input.tombstone,
    deletedAt: input.deletedAt,
    updatedAt: input.now,
    mutationId: input.mutationId,
  };
  const mutation: SyncMutation = {
    ...record,
    sequence: state.nextSequence,
    queuedAt: input.now,
    baseMutationId: previous?.mutationId ?? null,
  };
  const nextState: LocalSyncState = {
    ...state,
    records: {
      ...state.records,
      [recordKey]: record,
    },
    outbox: [...state.outbox, mutation],
    conflicts: { ...state.conflicts },
    metadata: { ...state.metadata },
    nextSequence: state.nextSequence + 1,
  };
  return { status: "success", record, mutation, state: nextState };
};

/**
 * Add an upsert to the slot and FIFO outbox without mutating the input state
 * or the caller-owned entry.  Revisions are scoped to kind + entry id.
 */
export const enqueueSyncMutation = <K extends SyncKind>(
  state: LocalSyncState,
  input: SyncUpsertInput<K>,
): SyncEnqueueResult => {
  if (!isValidStateShape(state)) {
    return failure("invalid-state", "同期状態の形式が不正です");
  }
  const entryId = input.entry?.id;
  if (!isNonEmptyString(entryId)) {
    return failure("invalid-entry", "同期entry idが空です");
  }
  const recordKey = makeSyncRecordKey(input.kind, entryId);
  if (hasConflict(state, recordKey)) {
    return failure("conflict", "競合中の同期slotは更新できません");
  }
  const previous = state.records[recordKey];
  if (previous && previous.kind !== input.kind) {
    return failure("invalid-state", "同期slotのkindが一致しません");
  }
  const payload = encodeSyncPayload(input.kind, input.entry);
  const now = resolveClock(input.now);
  const mutationId = resolveMutationId(input.mutationId);
  if (!isNonEmptyString(mutationId)) {
    return failure("invalid-entry", "同期mutationIdが空です");
  }
  return makeBaseRecord(state, {
    kind: input.kind,
    entryId,
    payload,
    tombstone: false,
    deletedAt: null,
    now,
    mutationId,
  });
};

export const enqueueSyncUpsert = enqueueSyncMutation;
export const enqueueSyncRecord = enqueueSyncMutation;

/**
 * Add a tombstone while retaining the most recent payload.  Keeping the
 * payload lets a later coordinator inspect or restore the deleted entry and
 * prevents an update from silently turning a delete into an empty record.
 */
export const enqueueSyncTombstone = (
  state: LocalSyncState,
  input: SyncTombstoneInput,
): SyncEnqueueResult => {
  if (!isValidStateShape(state)) {
    return failure("invalid-state", "同期状態の形式が不正です");
  }
  if (!isNonEmptyString(input.entryId)) {
    return failure("invalid-entry", "同期entry idが空です");
  }
  const recordKey = makeSyncRecordKey(input.kind, input.entryId);
  if (hasConflict(state, recordKey)) {
    return failure("conflict", "競合中の同期slotは削除できません");
  }
  const previous = state.records[recordKey];
  if (!previous) {
    return failure("missing-record", "削除する同期recordがありません");
  }
  if (previous.kind !== input.kind || previous.entryId !== input.entryId) {
    return failure("invalid-state", "同期slotのkindまたはentry idが一致しません");
  }
  const now = resolveClock(input.now);
  const mutationId = resolveMutationId(input.mutationId);
  if (!isNonEmptyString(mutationId)) {
    return failure("invalid-entry", "同期mutationIdが空です");
  }
  return makeBaseRecord(state, {
    kind: input.kind,
    entryId: input.entryId,
    payload: previous.payload,
    tombstone: true,
    deletedAt: now,
    now,
    mutationId,
  });
};

export const enqueueSyncDelete = enqueueSyncTombstone;

/** Throwing variants are convenient for coordinator code that already uses
 * exceptions for an aborted transaction; the result variants above keep UI
 * and storage adapters able to render stable reasons without try/catch. */
export const enqueueSyncMutationOrThrow = <K extends SyncKind>(
  state: LocalSyncState,
  input: SyncUpsertInput<K>,
): SyncEnqueueSuccess => {
  const result = enqueueSyncMutation(state, input);
  if (result.status === "error") {
    throw result.error;
  }
  return result;
};

export const enqueueSyncTombstoneOrThrow = (
  state: LocalSyncState,
  input: SyncTombstoneInput,
): SyncEnqueueSuccess => {
  const result = enqueueSyncTombstone(state, input);
  if (result.status === "error") {
    throw result.error;
  }
  return result;
};

/** Public alias for callers that need to make the copy-on-write guarantee
 * explicit before applying a custom mutation. */
export const cloneSyncStateForMutation = cloneLocalSyncState;
