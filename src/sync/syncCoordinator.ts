import {
  enqueueSyncMutation,
  enqueueSyncTombstone,
  type SyncMutationId,
  type SyncMutationOptions,
  type SyncTombstoneInput,
  type SyncUpsertInput,
} from "./syncOutbox";
import type {
  CloudSyncRepository,
  SyncReadResult,
  SyncRepositoryError,
  SyncRepositoryIssue,
  SyncWriteResult,
} from "./firestoreSyncRepository";
import type {
  LocalSyncRepository,
  SyncRepositoryLoadResult,
  SyncRepositorySaveResult,
} from "./localSyncRepository";
import {
  cloneLocalSyncState,
  createEmptyLocalSyncState,
  makeSyncRecordKey,
  type LocalSyncState,
  type SyncConflict,
  type SyncKind,
  type SyncMetadata,
  type SyncMutation,
  type SyncRecord,
} from "./syncTypes";

/** The lifecycle that caused a coordinator run. */
export const SYNC_TRIGGERS = ["launch", "focus", "online", "manual"] as const;
export type SyncTrigger = (typeof SYNC_TRIGGERS)[number];

export type SyncCoordinatorErrorCode =
  | "corrupt"
  | "unavailable"
  | "quota"
  | "network"
  | "permission-denied"
  | "unknown"
  | "enqueue"
  | "invalid"
  | "conflict"
  | "invalid-entry"
  | "invalid-state"
  | "missing-record";

/**
 * Errors crossing the coordinator boundary contain only stable, app-owned
 * fields.  In particular, Firebase error objects and storage exceptions are
 * never persisted in metadata or returned to callers.
 */
export class SyncCoordinatorError extends Error {
  readonly code: SyncCoordinatorErrorCode;
  readonly reason: SyncCoordinatorErrorCode;

  constructor(code: SyncCoordinatorErrorCode, message: string) {
    super(message);
    this.name = "SyncCoordinatorError";
    this.code = code;
    this.reason = code;
  }
}

export interface SyncCoordinatorOptions {
  readonly local?: LocalSyncRepository;
  readonly cloud?: CloudSyncRepository;
  /** Long-form aliases make the dependency boundary explicit at call sites. */
  readonly localRepository?: LocalSyncRepository;
  readonly cloudRepository?: CloudSyncRepository;
  /** A deterministic clock is useful for tests and is also the source of all
   * coordinator metadata timestamps. */
  readonly now?: string | Date | (() => string | Date);
  readonly clock?: string | Date | (() => string | Date);
}

export interface SyncCoordinatorDependencies {
  readonly local: LocalSyncRepository;
  readonly cloud: CloudSyncRepository;
}

export interface SyncQueueSuccess {
  readonly status: "success";
  readonly outcome: "saved";
  readonly saved: true;
  readonly state: LocalSyncState;
  readonly record: SyncRecord;
  readonly mutation: SyncMutation;
}

export interface SyncQueueFailure {
  readonly status: "error";
  readonly outcome: "error";
  readonly saved: false;
  readonly state?: LocalSyncState;
  readonly reason?: string;
  readonly error: SyncCoordinatorError;
}

export type SyncQueueResult = SyncQueueSuccess | SyncQueueFailure;

export interface SyncCoordinatorResultBase {
  readonly trigger: SyncTrigger;
  readonly state: LocalSyncState;
  readonly records: Readonly<Record<string, SyncRecord>>;
  readonly outbox: readonly SyncMutation[];
  readonly conflicts: Readonly<Record<string, SyncConflict>>;
  readonly metadata: SyncMetadata;
  readonly remoteStatus: "success" | "empty" | "error";
  readonly pulledRecords: number;
  readonly pushedMutations: number;
  readonly acknowledgedMutationIds: readonly string[];
  readonly issues: readonly SyncRepositoryIssue[];
}

export interface SyncCoordinatorSuccess extends SyncCoordinatorResultBase {
  readonly status: "success";
  readonly outcome: "success";
  readonly error?: undefined;
}

export interface SyncCoordinatorFailure extends SyncCoordinatorResultBase {
  readonly status: "error";
  readonly outcome: "error";
  readonly error: SyncCoordinatorError;
}

export type SynchronizeResult = SyncCoordinatorSuccess | SyncCoordinatorFailure;
export type SyncResult = SynchronizeResult;
export type SyncCoordinatorResult = SynchronizeResult;

export interface SyncQueueUpsertRequest<K extends SyncKind = SyncKind>
  extends SyncUpsertInput<K> {}

export interface SyncQueueDeleteRequest extends SyncTombstoneInput {}

type QueueUpsertInput<K extends SyncKind> =
  | SyncQueueUpsertRequest<K>
  | { readonly kind: K; readonly entry: SyncQueueUpsertRequest<K>["entry"] };

type QueueDeleteInput = SyncQueueDeleteRequest;

interface InternalSyncResult {
  state: LocalSyncState;
  remoteStatus: "success" | "empty" | "error";
  pulledRecords: number;
  pushedMutations: number;
  acknowledgedMutationIds: string[];
  issues: SyncRepositoryIssue[];
  error?: SyncCoordinatorError;
}

interface MergeResult {
  readonly state: LocalSyncState;
  readonly conflicts: readonly SyncConflict[];
}

const primitive = (value: unknown): value is string | number | boolean | null => (
  value === null
  || typeof value === "string"
  || typeof value === "number"
  || typeof value === "boolean"
);

const isTrigger = (value: string): value is SyncTrigger => (
  (SYNC_TRIGGERS as readonly string[]).includes(value)
);

const resolveTime = (
  value: string | Date | (() => string | Date) | undefined,
): string => {
  try {
    const resolved = typeof value === "function" ? value() : value;
    if (resolved instanceof Date && !Number.isNaN(resolved.getTime())) {
      return resolved.toISOString();
    }
    if (typeof resolved === "string" && resolved.length > 0) {
      return resolved;
    }
  } catch {
    // A clock is a diagnostic convenience.  A broken injected clock must not
    // prevent local-first data from being queued.
  }
  return new Date().toISOString();
};

const stableLocalError = (
  result: Extract<SyncRepositoryLoadResult | SyncRepositorySaveResult, { status: "corrupt" | "unavailable" | "quota" }>,
): SyncCoordinatorError => {
  const code = result.error.code;
  const messageByCode = {
    corrupt: "同期用ローカルデータが壊れています",
    unavailable: "同期用ローカル保存を利用できません",
    quota: "同期用ローカル保存の容量が不足しています",
  } as const;
  return new SyncCoordinatorError(code, messageByCode[code]);
};

const stableCloudError = (error: SyncRepositoryError | undefined): SyncCoordinatorError => {
  const kind = error?.kind ?? "unknown";
  const messageByKind = {
    network: "同期サーバーへ接続できません",
    "permission-denied": "同期データへのアクセス権がありません",
    quota: "同期の利用上限に達しました",
    unavailable: "同期サーバーが一時的に利用できません",
    unknown: "同期処理に失敗しました",
  } as const;
  return new SyncCoordinatorError(kind, messageByKind[kind]);
};

const unexpectedError = (): SyncCoordinatorError => (
  new SyncCoordinatorError("unknown", "同期処理に失敗しました")
);

const enqueueError = (reason: string, message: string): SyncCoordinatorError => {
  const code: SyncCoordinatorErrorCode = (
    reason === "conflict"
    || reason === "invalid-entry"
    || reason === "invalid-state"
    || reason === "missing-record"
  ) ? reason : "enqueue";
  return new SyncCoordinatorError(code, message);
};

const makeMetadata = (
  state: LocalSyncState,
  patch: Readonly<Record<string, string | number | boolean | null>>,
): LocalSyncState => ({
  ...state,
  metadata: {
    ...state.metadata,
    ...Object.fromEntries(
      Object.entries(patch).filter(([, value]) => primitive(value)),
    ),
  },
});

const makeResult = (
  trigger: SyncTrigger,
  internal: InternalSyncResult,
): SynchronizeResult => {
  const state = cloneLocalSyncState(internal.state);
  const common = {
    trigger,
    state,
    records: state.records,
    outbox: state.outbox,
    conflicts: state.conflicts,
    metadata: state.metadata,
    remoteStatus: internal.remoteStatus,
    pulledRecords: internal.pulledRecords,
    pushedMutations: internal.pushedMutations,
    acknowledgedMutationIds: [...internal.acknowledgedMutationIds],
    issues: [...internal.issues],
  } as const;
  return internal.error
    ? { ...common, status: "error", outcome: "error", error: internal.error }
    : { ...common, status: "success", outcome: "success" };
};

const recordKeyOf = (record: Pick<SyncRecord, "kind" | "entryId"> & Partial<Pick<SyncRecord, "recordKey">>): string => (
  record.recordKey ?? makeSyncRecordKey(record.kind, record.entryId)
);

/** Compare a remote record to a local mutation while ignoring server/local
 * clock differences. */
const sameMutationContent = (left: SyncRecord, right: SyncRecord): boolean => (
  left.kind === right.kind
  && left.entryId === right.entryId
  && left.revision === right.revision
  && left.baseRevision === right.baseRevision
  && left.payload === right.payload
  && left.tombstone === right.tombstone
  && left.mutationId === right.mutationId
);

const sameRecordContent = (left: SyncRecord, right: SyncRecord): boolean => (
  sameMutationContent(left, right)
  && left.recordKey === right.recordKey
);

const pendingForKey = (state: LocalSyncState, key: string): SyncMutation[] => (
  state.outbox
    .filter((mutation) => mutation.recordKey === key)
    .sort((left, right) => left.sequence - right.sequence)
);

const makeConflict = (
  state: LocalSyncState,
  key: string,
  remote: SyncRecord | undefined,
  reason: string,
  detectedAt: string,
): SyncConflict | undefined => {
  const local = state.records[key] ?? state.outbox.find((mutation) => mutation.recordKey === key);
  if (!local) {
    return undefined;
  }
  return {
    recordKey: key,
    kind: local.kind,
    entryId: local.entryId,
    local,
    remote,
    detectedAt,
    reason,
  };
};

const putConflict = (
  state: LocalSyncState,
  conflict: SyncConflict | undefined,
): LocalSyncState => {
  if (!conflict || Object.prototype.hasOwnProperty.call(state.conflicts, conflict.recordKey)) {
    return state;
  }
  return {
    ...state,
    conflicts: {
      ...state.conflicts,
      [conflict.recordKey]: conflict,
    },
    outbox: state.outbox.filter((mutation) => mutation.recordKey !== conflict.recordKey),
  };
};

const removeAckedMutation = (
  state: LocalSyncState,
  mutation: SyncMutation,
): LocalSyncState => ({
  ...state,
  // Remove only the mutation whose response we received.  A queue operation
  // during the awaited write may have appended a later mutation for the same
  // slot; that record and mutation must survive this acknowledgement.
  outbox: state.outbox.filter((candidate) => !(
    candidate.recordKey === mutation.recordKey
    && candidate.sequence === mutation.sequence
    && candidate.mutationId === mutation.mutationId
  )),
});

const toIssue = (result: SyncWriteResult): readonly SyncRepositoryIssue[] => (
  result.issues ?? (result.issue ? [result.issue] : [])
);

const isFatalReadResult = (result: SyncReadResult): result is SyncReadResult & {
  readonly status: "error";
  readonly error: SyncRepositoryError;
} => result.status === "error";

const isNetworkLike = (error: SyncCoordinatorError): boolean => (
  error.code === "network"
  || error.code === "permission-denied"
  || error.code === "quota"
  || error.code === "unavailable"
  || error.code === "unknown"
);

/**
 * Owns the local-first state transition and the cloud pull/push lifecycle.
 * The coordinator deliberately knows nothing about box localStorage keys or
 * Firebase SDK details; those concerns stay in the two repositories.
 */
export class SyncCoordinator {
  readonly local: LocalSyncRepository;
  readonly cloud: CloudSyncRepository;

  private readonly clock: string | Date | (() => string | Date) | undefined;
  private inFlight?: Promise<SynchronizeResult>;

  constructor(options: SyncCoordinatorOptions);
  constructor(local: LocalSyncRepository, cloud: CloudSyncRepository, options?: Omit<SyncCoordinatorOptions, "local" | "cloud">);
  constructor(
    optionsOrLocal: SyncCoordinatorOptions | LocalSyncRepository,
    cloud?: CloudSyncRepository,
    options: Omit<SyncCoordinatorOptions, "local" | "cloud"> = {},
  ) {
    if (cloud) {
      this.local = optionsOrLocal as LocalSyncRepository;
      this.cloud = cloud;
      this.clock = options.now ?? options.clock;
    } else {
      const resolved = optionsOrLocal as SyncCoordinatorOptions;
      this.local = resolved.local ?? resolved.localRepository as LocalSyncRepository;
      this.cloud = resolved.cloud ?? resolved.cloudRepository as CloudSyncRepository;
      this.clock = resolved.now ?? resolved.clock;
    }
  }

  /** Read the current namespace without creating a storage entry. */
  loadState(): { readonly status: "valid"; readonly state: LocalSyncState }
    | { readonly status: "error"; readonly error: SyncCoordinatorError } {
    try {
      const loaded = this.local.load();
      if (loaded.status === "missing") {
        return { status: "valid", state: createEmptyLocalSyncState(this.local.ownerUid) };
      }
      if (loaded.status === "valid") {
        return { status: "valid", state: cloneLocalSyncState(loaded.state) };
      }
      return { status: "error", error: stableLocalError(loaded) };
    } catch {
      return { status: "error", error: new SyncCoordinatorError("unavailable", "同期用ローカル保存を利用できません") };
    }
  }

  /**
   * Queue local data first.  Exactly one repository.save call is made after
   * the outbox helper returns, and no cloud method is touched here.
   */
  queueUpsert<K extends SyncKind>(request: SyncQueueUpsertRequest<K>): SyncQueueResult;
  queueUpsert<K extends SyncKind>(kind: K, entry: SyncQueueUpsertRequest<K>["entry"], options?: SyncMutationOptions): SyncQueueResult;
  queueUpsert<K extends SyncKind>(
    requestOrKind: SyncQueueUpsertRequest<K> | K,
    entry?: SyncQueueUpsertRequest<K>["entry"],
    options: SyncMutationOptions = {},
  ): SyncQueueResult {
    const request = typeof requestOrKind === "string"
      ? { kind: requestOrKind, entry, ...options } as SyncQueueUpsertRequest<K>
      : requestOrKind;
    const loaded = this.loadState();
    if (loaded.status === "error") {
      return { status: "error", outcome: "error", saved: false, error: loaded.error };
    }
    const enqueued = enqueueSyncMutation(loaded.state, request);
    if (enqueued.status === "error") {
      return {
        status: "error",
        outcome: "error",
        saved: false,
        state: loaded.state,
        reason: enqueued.reason,
        error: enqueueError(enqueued.reason, enqueued.message),
      };
    }
    return this.saveQueuedState(enqueued.state, enqueued.record, enqueued.mutation, loaded.state);
  }

  queueDelete(request: SyncQueueDeleteRequest): SyncQueueResult;
  queueDelete(kind: SyncKind, entryId: string, options?: SyncMutationOptions): SyncQueueResult;
  queueDelete(
    requestOrKind: QueueDeleteInput | SyncKind,
    entryId?: string,
    options: SyncMutationOptions = {},
  ): SyncQueueResult {
    const request = typeof requestOrKind === "string"
      ? { kind: requestOrKind, entryId: entryId ?? "", ...options }
      : requestOrKind;
    const loaded = this.loadState();
    if (loaded.status === "error") {
      return { status: "error", outcome: "error", saved: false, error: loaded.error };
    }
    const enqueued = enqueueSyncTombstone(loaded.state, request);
    if (enqueued.status === "error") {
      return {
        status: "error",
        outcome: "error",
        saved: false,
        state: loaded.state,
        reason: enqueued.reason,
        error: enqueueError(enqueued.reason, enqueued.message),
      };
    }
    return this.saveQueuedState(enqueued.state, enqueued.record, enqueued.mutation, loaded.state);
  }

  private saveQueuedState(
    state: LocalSyncState,
    record: SyncRecord,
    mutation: SyncMutation,
    persistedState: LocalSyncState,
  ): SyncQueueResult {
    try {
      const saved = this.local.save(state);
      if (saved.status !== "valid") {
        return {
          status: "error",
          outcome: "error",
          saved: false,
          state: persistedState,
          error: stableLocalError(saved),
        };
      }
      const savedState = cloneLocalSyncState(saved.state);
      const savedRecord = savedState.records[record.recordKey];
      const savedMutation = savedState.outbox.find((candidate) => (
        candidate.recordKey === mutation.recordKey
        && candidate.sequence === mutation.sequence
        && candidate.mutationId === mutation.mutationId
      ));
      if (!savedRecord || !savedMutation) {
        return {
          status: "error",
          outcome: "error",
          saved: false,
          state: savedState,
          error: new SyncCoordinatorError("unavailable", "同期用ローカル保存を確認できません"),
        };
      }
      return {
        status: "success",
        outcome: "saved",
        saved: true,
        state: savedState,
        record: savedRecord,
        mutation: savedMutation,
      };
    } catch {
      return {
        status: "error",
        outcome: "error",
        saved: false,
        state: persistedState,
        error: new SyncCoordinatorError("unavailable", "同期用ローカル保存を利用できません"),
      };
    }
  }

  /**
   * Pull, merge, then push in outbox sequence order.  Calls made while a run
   * is active share the same promise, preventing duplicate reads/writes.
   */
  synchronize(trigger: SyncTrigger): Promise<SynchronizeResult> {
    if (!isTrigger(trigger)) {
      return Promise.resolve(this.makeFailureResult("manual", unexpectedError()));
    }
    if (this.inFlight) {
      return this.inFlight;
    }
    const running = this.runSynchronize(trigger);
    this.inFlight = running.finally(() => {
      if (this.inFlight === this.inFlightPromise) {
        this.inFlight = undefined;
      }
    });
    // Keep a stable self-reference for the finally callback above.  The
    // callback is invoked after this assignment in every normal Promise turn.
    this.inFlightPromise = this.inFlight;
    return this.inFlight;
  }

  private inFlightPromise?: Promise<SynchronizeResult>;

  private makeFailureResult(trigger: SyncTrigger, error: SyncCoordinatorError): SynchronizeResult {
    const loaded = this.loadState();
    const state = loaded.status === "valid" ? loaded.state : createEmptyLocalSyncState(this.local.ownerUid);
    return makeResult(trigger, {
      state,
      remoteStatus: "error",
      pulledRecords: 0,
      pushedMutations: 0,
      acknowledgedMutationIds: [],
      issues: [],
      error,
    });
  }

  private async runSynchronize(trigger: SyncTrigger): Promise<SynchronizeResult> {
    const loaded = this.loadState();
    if (loaded.status === "error") {
      return this.makeFailureResult(trigger, loaded.error);
    }

    let state = loaded.state;
    const attemptTime = resolveTime(this.clock);
    const persistedBeforeAttempt = state;
    const attemptState = makeMetadata(state, {
      lastAttempt: attemptTime,
      trigger,
      error: null,
    });
    const attemptSave = this.saveState(attemptState);
    if (attemptSave.status === "error") {
      return makeResult(trigger, {
        state: persistedBeforeAttempt,
        remoteStatus: "error",
        pulledRecords: 0,
        pushedMutations: 0,
        acknowledgedMutationIds: [],
        issues: [],
        error: attemptSave.error,
      });
    }
    state = attemptSave.state;

    let remote: SyncReadResult;
    try {
      remote = await this.cloud.readAll();
    } catch {
      remote = {
        status: "error",
        records: [],
        issues: [],
        error: { kind: "network", message: "同期サーバーへ接続できません" },
      };
    }

    // `readAll` yields to the event loop. A local queue operation may have
    // completed while the pull was in flight, so never merge into the state
    // snapshot from before the await.
    const latestAfterRead = this.loadState();
    if (latestAfterRead.status === "error") {
      return makeResult(trigger, {
        state,
        remoteStatus: remote.status,
        pulledRecords: remote.records.length,
        pushedMutations: 0,
        acknowledgedMutationIds: [],
        issues: [...remote.issues],
        error: latestAfterRead.error,
      });
    }
    state = latestAfterRead.state;

    if (isFatalReadResult(remote)) {
      const error = stableCloudError(remote.error);
      const persistedBeforeError = state;
      const errorState = makeMetadata(state, { error: error.code });
      state = this.trySaveState(errorState) ?? persistedBeforeError;
      return makeResult(trigger, {
        state,
        remoteStatus: "error",
        pulledRecords: 0,
        pushedMutations: 0,
        acknowledgedMutationIds: [],
        issues: [...remote.issues],
        error,
      });
    }

    const issues = [...remote.issues];
    const merged = this.mergeRemote(state, remote, resolveTime(this.clock));
    const pullState = makeMetadata(merged.state, {
      lastPull: resolveTime(this.clock),
      error: issues.length > 0 ? issues[0].code : null,
    });
    const pullSave = this.saveState(pullState);
    if (pullSave.status === "error") {
      return makeResult(trigger, {
        state,
        remoteStatus: remote.status,
        pulledRecords: remote.records.length,
        pushedMutations: 0,
        acknowledgedMutationIds: [],
        issues,
        error: pullSave.error,
      });
    }
    state = pullSave.state;

    const push = await this.pushOutbox(state, issues, merged.conflicts);
    return makeResult(trigger, {
      state: push.state,
      remoteStatus: remote.status,
      pulledRecords: remote.records.length,
      pushedMutations: push.pushedMutations,
      acknowledgedMutationIds: [...push.acknowledgedMutationIds],
      issues: [...push.issues],
      error: push.error,
    });
  }

  private saveState(state: LocalSyncState):
    | { readonly status: "valid"; readonly state: LocalSyncState }
    | { readonly status: "error"; readonly error: SyncCoordinatorError } {
    try {
      const saved = this.local.save(state);
      if (saved.status === "valid") {
        return { status: "valid", state: cloneLocalSyncState(saved.state) };
      }
      return { status: "error", error: stableLocalError(saved) };
    } catch {
      return { status: "error", error: new SyncCoordinatorError("unavailable", "同期用ローカル保存を利用できません") };
    }
  }

  private trySaveState(state: LocalSyncState): LocalSyncState | undefined {
    try {
      const saved = this.saveState(state);
      return saved.status === "valid" ? saved.state : undefined;
    } catch {
      // Preserve the cloud error as the meaningful result.  The unsent
      // outbox remains in the previously persisted snapshot and is retried.
      return undefined;
    }
  }

  private mergeRemote(
    initial: LocalSyncState,
    remote: SyncReadResult,
    detectedAt: string,
  ): MergeResult {
    let state = cloneLocalSyncState(initial);
    const conflicts: SyncConflict[] = [];
    const seenRemoteKeys = new Set<string>();

    // A previously blocked key must not regain an outbox mutation through a
    // malformed or hand-built local state.
    const blockedKeys = new Set(Object.keys(state.conflicts));
    if (blockedKeys.size > 0) {
      state = {
        ...state,
        outbox: state.outbox.filter((mutation) => !blockedKeys.has(mutation.recordKey)),
      };
    }

    for (const remoteRecord of remote.records) {
      const key = recordKeyOf(remoteRecord);
      seenRemoteKeys.add(key);
      if (blockedKeys.has(key) || Object.prototype.hasOwnProperty.call(state.conflicts, key)) {
        continue;
      }
      const pending = pendingForKey(state, key);
      const local = state.records[key];

      if (pending.length > 0) {
        const first = pending[0];
        const matched = pending.find((mutation) => mutation.mutationId === remoteRecord.mutationId);
        if (matched) {
          if (sameMutationContent(matched, remoteRecord)) {
            const hasLaterPending = pending.some((mutation) => mutation.sequence > matched.sequence);
            state = {
              ...state,
              records: hasLaterPending
                ? state.records
                : { ...state.records, [key]: remoteRecord },
              outbox: state.outbox.filter((mutation) => (
                mutation.recordKey !== key || mutation.sequence > matched.sequence
              )),
            };
          } else {
            const conflict = makeConflict(state, key, remoteRecord, "mutation-id-reuse", detectedAt);
            if (conflict) {
              state = putConflict(state, conflict);
              conflicts.push(conflict);
            }
          }
          continue;
        }

        // The server still has exactly the revision from which the first
        // pending mutation was made.  It is a safe base, so keep local data.
        if (remoteRecord.revision === first.baseRevision) {
          if (first.baseRevision === 0 || remoteRecord.mutationId === first.baseMutationId) {
            continue;
          }
          const conflict = makeConflict(
            state,
            key,
            remoteRecord,
            "same-revision-base-diverged",
            detectedAt,
          );
          if (conflict) {
            state = putConflict(state, conflict);
            conflicts.push(conflict);
          }
          continue;
        }

        const conflict = makeConflict(state, key, remoteRecord, "base-revision-mismatch", detectedAt);
        if (conflict) {
          state = putConflict(state, conflict);
          conflicts.push(conflict);
        }
        continue;
      }

      if (!local) {
        state = {
          ...state,
          records: { ...state.records, [key]: remoteRecord },
        };
        continue;
      }
      if (sameRecordContent(local, remoteRecord)) {
        continue;
      }
      // A newer remote revision is an ordinary remote pull when this slot has
      // no local pending mutation.  It may contain several remote updates
      // since the previous pull; do not mistake a revision gap for a local
      // conflict.  Same-revision mutations and older remote records remain a
      // review conflict, so this is not LWW resolution.
      if (remoteRecord.revision > local.revision) {
        state = {
          ...state,
          records: { ...state.records, [key]: remoteRecord },
        };
        continue;
      }
      const conflict = makeConflict(state, key, remoteRecord, "same-slot-diverged", detectedAt);
      if (conflict) {
        state = putConflict(state, conflict);
        conflicts.push(conflict);
      }
    }

    // A successful non-empty collection lets us distinguish a missing slot
    // from a collection-level empty result.  With any malformed documents,
    // that conclusion would be unsafe, so leave pending mutations untouched
    // and surface the repository issue to the caller.
    if (remote.status === "success" && remote.issues.length === 0) {
      for (const key of new Set(state.outbox.map((mutation) => mutation.recordKey))) {
        if (seenRemoteKeys.has(key) || Object.prototype.hasOwnProperty.call(state.conflicts, key)) {
          continue;
        }
        const pending = pendingForKey(state, key);
        const first = pending[0];
        if (!first || first.baseRevision === 0) {
          continue;
        }
        const conflict = makeConflict(state, key, undefined, "remote-record-missing", detectedAt);
        if (conflict) {
          state = putConflict(state, conflict);
          conflicts.push(conflict);
        }
      }
    }

    return { state, conflicts };
  }

  private async pushOutbox(
    initial: LocalSyncState,
    inheritedIssues: readonly SyncRepositoryIssue[],
    mergeConflicts: readonly SyncConflict[],
  ): Promise<{
    readonly state: LocalSyncState;
    readonly pushedMutations: number;
    readonly acknowledgedMutationIds: readonly string[];
    readonly issues: readonly SyncRepositoryIssue[];
    readonly error?: SyncCoordinatorError;
  }> {
    let state = initial;
    let pushedMutations = 0;
    const acknowledgedMutationIds: string[] = [];
    const issues = [...inheritedIssues];
    // `mergeConflicts` is intentionally consumed as data by the result; the
    // state already contains their canonical review objects.
    void mergeConflicts;

    while (state.outbox.length > 0) {
      const mutation = [...state.outbox].sort((left, right) => left.sequence - right.sequence)[0];
      if (!mutation) {
        break;
      }
      if (Object.prototype.hasOwnProperty.call(state.conflicts, mutation.recordKey)) {
        const persistedBeforeBlocked = state;
        const blockedState = {
          ...state,
          outbox: state.outbox.filter((candidate) => candidate.recordKey !== mutation.recordKey),
        };
        const savedBlocked = this.saveState(blockedState);
        if (savedBlocked.status === "error") {
          return {
            state: persistedBeforeBlocked,
            pushedMutations,
            acknowledgedMutationIds,
            issues,
            error: savedBlocked.error,
          };
        }
        state = savedBlocked.state;
        continue;
      }

      let written: SyncWriteResult;
      try {
        // Send the exact mutation snapshot, including its original mutationId
        // and baseRevision.  Rebuilding it here would defeat retry idempotency.
        written = await this.cloud.write(mutation);
      } catch {
        const error = new SyncCoordinatorError("network", "同期サーバーへ接続できません");
        const latestAfterWriteError = this.loadState();
        if (latestAfterWriteError.status === "valid") {
          const persistedBeforeError = latestAfterWriteError.state;
          const errorState = makeMetadata(persistedBeforeError, { error: error.code });
          state = this.trySaveState(errorState) ?? persistedBeforeError;
        }
        return { state, pushedMutations, acknowledgedMutationIds, issues, error };
      }

      // The write also yielded. Reload before acknowledging or conflict
      // handling so queueUpsert/queueDelete calls made during the request
      // (including same-slot later revisions) remain in the state we save.
      const latestAfterWrite = this.loadState();
      if (latestAfterWrite.status === "error") {
        return {
          state,
          pushedMutations,
          acknowledgedMutationIds,
          issues,
          error: latestAfterWrite.error,
        };
      }
      state = latestAfterWrite.state;

      const writeIssues = [...toIssue(written)];
      issues.push(...writeIssues);
      if (written.status === "written" || written.status === "duplicate") {
        const persistedBeforeAck = state;
        const ackState = makeMetadata(removeAckedMutation(state, mutation), {
          lastPush: resolveTime(this.clock),
          error: writeIssues.length > 0 ? writeIssues[0].code : null,
        });
        const saved = this.saveState(ackState);
        if (saved.status === "error") {
          return {
            state: persistedBeforeAck,
            pushedMutations,
            acknowledgedMutationIds,
            issues,
            error: saved.error,
          };
        }
        state = saved.state;
        pushedMutations += 1;
        acknowledgedMutationIds.push(mutation.mutationId);
        continue;
      }

      if (written.status === "conflict" || written.status === "invalid") {
        const conflict = makeConflict(
          state,
          mutation.recordKey,
          written.remote,
          written.issue?.code ?? (written.status === "invalid" ? "invalid-mutation" : "base-revision-mismatch"),
          resolveTime(this.clock),
        );
        const persistedBeforeConflict = state;
        const conflictState = makeMetadata(
          putConflict(state, conflict),
          { error: written.issue?.code ?? written.status },
        );
        const saved = this.saveState(conflictState);
        if (saved.status === "error") {
          return {
            state: persistedBeforeConflict,
            pushedMutations,
            acknowledgedMutationIds,
            issues,
            error: saved.error,
          };
        }
        state = saved.state;
        // A conflict is slot-local; the next FIFO mutation from another slot
        // is still safe to attempt.
        continue;
      }

      const error = stableCloudError(written.error);
      if (isNetworkLike(error)) {
        const persistedBeforeError = state;
        state = this.trySaveState(makeMetadata(state, { error: error.code })) ?? persistedBeforeError;
        return { state, pushedMutations, acknowledgedMutationIds, issues, error };
      }
      const persistedBeforeError = state;
      state = this.trySaveState(makeMetadata(state, { error: error.code })) ?? persistedBeforeError;
      return { state, pushedMutations, acknowledgedMutationIds, issues, error };
    }

    // Keep the latest pull issue visible while idle; a conflict itself is
    // represented in `state.conflicts`, not as a nested metadata object.
    if (state.outbox.length === 0 && state.metadata.error === undefined) {
      const persistedBeforeIdle = state;
      const saved = this.saveState(makeMetadata(state, { error: null }));
      if (saved.status === "valid") {
        state = saved.state;
      } else {
        return {
          state: persistedBeforeIdle,
          pushedMutations,
          acknowledgedMutationIds,
          issues,
          error: saved.error,
        };
      }
    }
    return { state, pushedMutations, acknowledgedMutationIds, issues };
  }
}

export const createSyncCoordinator = (
  options: SyncCoordinatorOptions,
): SyncCoordinator => new SyncCoordinator(options);

export const createCoordinator = createSyncCoordinator;
export const createSyncCoordinatorDependencies = (
  dependencies: SyncCoordinatorDependencies,
): SyncCoordinator => new SyncCoordinator(dependencies);

// Keep the option type import visible to downstream callers that only import
// coordinator APIs.  This also documents that mutation ids are deliberately
// delegated to syncOutbox rather than generated by the coordinator.
export type { SyncMutationId };
