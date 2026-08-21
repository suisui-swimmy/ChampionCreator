import {
  type BoxEntry,
} from "../ui/boxStorage";
import {
  type EnemyBoxEntry,
} from "../ui/enemyBoxStorage";
import {
  type CloudSyncRepository,
  sha256Hex,
  type SyncRepositoryIssue,
} from "./firestoreSyncRepository";
import {
  type LocalSyncRepository,
} from "./localSyncRepository";
import {
  createSyncCoordinator,
  SyncCoordinator,
  type SyncCoordinatorError,
  type SyncCoordinatorResult,
  type SyncTrigger,
} from "./syncCoordinator";
import {
  decodeSyncPayload,
  encodeSyncPayload,
} from "./syncPayload";
import {
  enqueueSyncMutation,
  enqueueSyncTombstone,
  type SyncClock,
} from "./syncOutbox";
import {
  cloneLocalSyncState,
  makeSyncRecordKey,
  type LocalSyncState,
  type SyncEntryForKind,
  type SyncKind,
  type SyncConflict,
  type SyncRecord,
} from "./syncTypes";

/**
 * The data-facing snapshot used by box UI code.  Sync records and retained
 * tombstones stay behind this boundary; only normalized, currently active
 * entries are exposed.
 */
export interface SyncBoxSnapshot {
  readonly targetEntries: readonly BoxEntry[];
  readonly enemyEntries: readonly EnemyBoxEntry[];
  readonly outboxCount: number;
  readonly conflictCount: number;
  readonly targetConflictCount: number;
  readonly enemyConflictCount: number;
  /**
   * Decoded conflict views for the UI.  The raw sync records remain available
   * on each item so resolving a tombstone or a malformed hand-built fixture
   * never requires the box UI to know the local-storage schema.
   */
  readonly conflicts: readonly SyncBoxConflictDetail[];
  /** Descriptive alias for callers that do not want to confuse this with the
   * integer conflictCount field. */
  readonly conflictDetails: readonly SyncBoxConflictDetail[];
}

export type SyncBoxConflictDecision = "keep-both" | "keep-local" | "keep-remote";

export interface SyncBoxConflictDetail {
  readonly recordKey: string;
  readonly kind: SyncKind;
  readonly entryId: string;
  readonly detectedAt: string;
  readonly reason?: string;
  readonly localRecord: SyncRecord;
  readonly remoteRecord?: SyncRecord;
  readonly localEntry: SyncEntryForKind<SyncKind> | null;
  readonly remoteEntry: SyncEntryForKind<SyncKind> | null;
  /** Short aliases for view code that treats the detail as two branches. */
  readonly local: SyncEntryForKind<SyncKind> | null;
  readonly remote: SyncEntryForKind<SyncKind> | null;
  readonly localTombstone: boolean;
  readonly remoteTombstone: boolean;
  /** The original coordinator object is kept for diagnostics and decisions. */
  readonly conflict: SyncConflict;
}

export type SyncBoxRepositoryErrorCode =
  | "duplicate-id"
  | "conflict"
  | "invalid"
  | "corrupt"
  | "unavailable"
  | "quota"
  | "network"
  | "permission-denied"
  | "unknown";

/** Stable errors intentionally contain no storage, Firebase, or raw parser objects. */
export class SyncBoxRepositoryError extends Error {
  readonly code: SyncBoxRepositoryErrorCode;
  readonly reason: SyncBoxRepositoryErrorCode;

  constructor(code: SyncBoxRepositoryErrorCode, message: string) {
    super(message);
    this.name = "SyncBoxRepositoryError";
    this.code = code;
    this.reason = code;
  }
}

export interface SyncBoxRepositoryCounts {
  readonly outboxCount: number;
  readonly conflictCount: number;
  readonly targetConflictCount: number;
  readonly enemyConflictCount: number;
}

export interface SyncBoxRepositorySuccess extends SyncBoxRepositoryCounts {
  readonly status: "success";
  readonly outcome: "success";
  readonly snapshot: SyncBoxSnapshot;
  /** Number of records changed by this save operation. */
  readonly changedCount: number;
  /** Number of mutations appended to the outbox by this save operation. */
  readonly queuedCount: number;
}

export interface SyncBoxRepositoryFailure extends SyncBoxRepositoryCounts {
  readonly status: "error";
  readonly outcome: "error";
  readonly error: SyncBoxRepositoryError;
  /** The last readable snapshot, when local state could be loaded. */
  readonly snapshot?: SyncBoxSnapshot;
  readonly changedCount: 0;
  readonly queuedCount: 0;
}

export type SyncBoxRepositoryResult = SyncBoxRepositorySuccess | SyncBoxRepositoryFailure;
export type SyncBoxSnapshotResult = SyncBoxRepositoryResult;
export type SyncBoxSaveResult = SyncBoxRepositoryResult;

export interface SyncBoxSynchronizeSuccess extends SyncBoxRepositorySuccess {
  readonly trigger: SyncTrigger;
  readonly remoteStatus: SyncCoordinatorResult["remoteStatus"];
  readonly pulledRecords: number;
  readonly pushedMutations: number;
  readonly acknowledgedMutationIds: readonly string[];
  readonly issues: readonly SyncRepositoryIssue[];
}

export interface SyncBoxSynchronizeFailure extends SyncBoxRepositoryFailure {
  readonly trigger: SyncTrigger;
  readonly remoteStatus: SyncCoordinatorResult["remoteStatus"];
  readonly pulledRecords: number;
  readonly pushedMutations: number;
  readonly acknowledgedMutationIds: readonly string[];
  readonly issues: readonly SyncRepositoryIssue[];
}

export type SyncBoxSynchronizeResult =
  | SyncBoxSynchronizeSuccess
  | SyncBoxSynchronizeFailure;

export interface SyncBoxMutationContext {
  readonly kind: SyncKind;
  readonly entryId: string;
  readonly operation: "upsert" | "delete";
  readonly index: number;
}

export type SyncBoxMutationIdFactory = (context: SyncBoxMutationContext) => string;

export interface SyncBoxRepositoryOptions {
  readonly local?: LocalSyncRepository;
  readonly cloud?: CloudSyncRepository;
  readonly localRepository?: LocalSyncRepository;
  readonly cloudRepository?: CloudSyncRepository;
  /** An existing coordinator may be injected so its clock/in-flight lifecycle is reused. */
  readonly coordinator?: SyncCoordinator;
  readonly now?: SyncClock;
  readonly clock?: SyncClock;
  readonly mutationId?: string | (() => string);
  readonly mutationIdFactory?: SyncBoxMutationIdFactory;
}

interface NormalizedEntry<K extends SyncKind> {
  readonly id: string;
  readonly entry: SyncEntryForKind<K>;
  readonly payload: string;
}

interface PlannedMutation {
  readonly kind: SyncKind;
  readonly entryId: string;
  readonly operation: "upsert" | "delete";
  readonly entry?: SyncEntryForKind<SyncKind>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const nonEmptyId = (value: unknown): value is string => (
  typeof value === "string" && value.length > 0
);

const stableErrorMessage = (code: SyncBoxRepositoryErrorCode): string => {
  switch (code) {
    case "duplicate-id":
      return "同じボックス内に同じIDのentryがあります";
    case "conflict":
      return "競合中のボックスentryは更新できません";
    case "invalid":
      return "ボックスentryまたは同期状態が不正です";
    case "corrupt":
      return "同期用ローカルデータが壊れています";
    case "unavailable":
      return "同期用ローカル保存を利用できません";
    case "quota":
      return "同期用ローカル保存の容量が不足しています";
    case "network":
      return "同期サーバーへ接続できません";
    case "permission-denied":
      return "同期データへのアクセス権がありません";
    case "unknown":
    default:
      return "同期処理に失敗しました";
  }
};

const makeError = (
  code: SyncBoxRepositoryErrorCode,
  message = stableErrorMessage(code),
): SyncBoxRepositoryError => new SyncBoxRepositoryError(code, message);

const fromCoordinatorError = (error: SyncCoordinatorError): SyncBoxRepositoryError => {
  const code = error.code;
  switch (code) {
    case "corrupt":
    case "unavailable":
    case "quota":
    case "network":
    case "permission-denied":
    case "unknown":
      return makeError(code);
    case "conflict":
      return makeError("conflict");
    case "invalid-entry":
    case "invalid-state":
    case "missing-record":
    case "enqueue":
    default:
      return makeError("invalid");
  }
};

const fromLocalSaveCode = (code: string): SyncBoxRepositoryError => {
  if (code === "corrupt" || code === "unavailable" || code === "quota") {
    return makeError(code);
  }
  return makeError("unavailable");
};

const compareDescending = (left: string, right: string): number => {
  if (left === right) return 0;
  return left > right ? -1 : 1;
};

const compareEntry = (
  left: BoxEntry | EnemyBoxEntry,
  right: BoxEntry | EnemyBoxEntry,
): number => (
  compareDescending(left.createdAt, right.createdAt)
  || (left.id === right.id ? 0 : left.id < right.id ? -1 : 1)
);

const sortEntries = <K extends SyncKind>(
  entries: readonly SyncEntryForKind<K>[],
): SyncEntryForKind<K>[] => [...entries].sort(compareEntry);

const cloneState = (state: LocalSyncState): LocalSyncState => cloneLocalSyncState(state);

const decodeRecordEntry = (
  record: SyncRecord | undefined,
): SyncEntryForKind<SyncKind> | null => {
  if (!record || record.tombstone) return null;
  const decoded = decodeSyncPayload(record.kind, record.payload, record.entryId);
  return decoded.status === "success"
    ? decoded.entry as SyncEntryForKind<SyncKind>
    : null;
};

const conflictDetailsForState = (
  state: LocalSyncState,
): readonly SyncBoxConflictDetail[] => Object.values(state.conflicts)
  .sort((left, right) => (
    left.recordKey < right.recordKey ? -1 : left.recordKey > right.recordKey ? 1 : 0
  ))
  .map((conflict) => {
    const localEntry = decodeRecordEntry(conflict.local);
    const remoteEntry = decodeRecordEntry(conflict.remote);
    return {
      recordKey: conflict.recordKey,
      kind: conflict.kind,
      entryId: conflict.entryId,
      detectedAt: conflict.detectedAt,
      ...(conflict.reason === undefined ? {} : { reason: conflict.reason }),
      localRecord: conflict.local,
      remoteRecord: conflict.remote,
      localEntry,
      remoteEntry,
      local: localEntry,
      remote: remoteEntry,
      localTombstone: conflict.local.tombstone,
      remoteTombstone: conflict.remote?.tombstone ?? false,
      conflict,
    };
  });

/** Compare normalized payloads so formatting differences do not create a mutation. */
const canonicalPayloadForRecord = (record: SyncRecord): string | null => {
  const decoded = decodeSyncPayload(record.kind, record.payload, record.entryId);
  if (decoded.status === "error") return null;
  return encodeSyncPayload(record.kind, decoded.entry);
};

const activeSource = (
  state: LocalSyncState,
  kind: SyncKind,
  record: SyncRecord,
): SyncRecord => {
  const conflict = state.conflicts[record.recordKey];
  // A coordinator conflict retains the local branch.  It is the only branch
  // the box facade is allowed to expose or preserve for a later resolution.
  if (conflict?.local.kind === kind && conflict.local.entryId === record.entryId) {
    return conflict.local;
  }
  return record;
};

const normalizeEntry = <K extends SyncKind>(
  kind: K,
  value: unknown,
): { readonly status: "success"; readonly value: NormalizedEntry<K> }
  | { readonly status: "error"; readonly error: SyncBoxRepositoryError } => {
  if (!isRecord(value) || !nonEmptyId(value.id)) {
    return { status: "error", error: makeError("invalid") };
  }
  try {
    const payload = encodeSyncPayload(kind, value as SyncEntryForKind<K>);
    const decoded = decodeSyncPayload(kind, payload, value.id);
    if (decoded.status === "error") {
      return { status: "error", error: makeError("invalid") };
    }
    const decodedEntry = decoded.entry as SyncEntryForKind<K>;
    return {
      status: "success",
      value: {
        id: decoded.entryId,
        entry: decodedEntry,
        payload: encodeSyncPayload(kind, decodedEntry),
      },
    };
  } catch {
    return { status: "error", error: makeError("invalid") };
  }
};

const activeEntriesForKind = <K extends SyncKind>(
  state: LocalSyncState,
  kind: K,
): { readonly status: "success"; readonly entries: SyncEntryForKind<K>[] }
  | { readonly status: "error"; readonly error: SyncBoxRepositoryError } => {
  const entries: SyncEntryForKind<K>[] = [];
  const seen = new Set<string>();
  for (const record of Object.values(state.records)) {
    if (record.kind !== kind || record.tombstone) continue;
    const source = activeSource(state, kind, record);
    if (source.tombstone) continue;
    const decoded = decodeSyncPayload(kind, source.payload, source.entryId);
    if (decoded.status === "error") {
      return { status: "error", error: makeError("invalid") };
    }
    if (seen.has(decoded.entryId)) {
      return { status: "error", error: makeError("duplicate-id") };
    }
    seen.add(decoded.entryId);
    entries.push(decoded.entry as SyncEntryForKind<K>);
  }
  return { status: "success", entries: sortEntries(entries) };
};

const snapshotFromState = (
  state: LocalSyncState,
): { readonly status: "success"; readonly snapshot: SyncBoxSnapshot }
  | { readonly status: "error"; readonly error: SyncBoxRepositoryError } => {
  const targets = activeEntriesForKind(state, "target-box");
  if (targets.status === "error") return targets;
  const enemies = activeEntriesForKind(state, "enemy-box");
  if (enemies.status === "error") return enemies;
  const conflicts = conflictDetailsForState(state);
  return {
    status: "success",
    snapshot: {
      targetEntries: targets.entries,
      enemyEntries: enemies.entries,
      outboxCount: state.outbox.length,
      conflictCount: Object.keys(state.conflicts).length,
      targetConflictCount: Object.values(state.conflicts)
        .filter((conflict) => conflict.kind === "target-box").length,
      enemyConflictCount: Object.values(state.conflicts)
        .filter((conflict) => conflict.kind === "enemy-box").length,
      conflicts,
      conflictDetails: conflicts,
    },
  };
};

const countsForState = (state: LocalSyncState): SyncBoxRepositoryCounts => {
  const targetConflictCount = Object.values(state.conflicts)
    .filter((conflict) => conflict.kind === "target-box").length;
  const enemyConflictCount = Object.values(state.conflicts)
    .filter((conflict) => conflict.kind === "enemy-box").length;
  return {
    outboxCount: state.outbox.length,
    conflictCount: targetConflictCount + enemyConflictCount,
    targetConflictCount,
    enemyConflictCount,
  };
};

const failureFromState = (
  error: SyncBoxRepositoryError,
  state?: LocalSyncState,
): SyncBoxRepositoryFailure => {
  const snapshotResult = state ? snapshotFromState(state) : undefined;
  const snapshot = snapshotResult?.status === "success" ? snapshotResult.snapshot : undefined;
  const counts = state
    ? countsForState(state)
    : {
      outboxCount: 0,
      conflictCount: 0,
      targetConflictCount: 0,
      enemyConflictCount: 0,
    };
  return {
    status: "error",
    outcome: "error",
    error,
    snapshot,
    changedCount: 0,
    queuedCount: 0,
    ...counts,
  };
};

const successFromState = (
  state: LocalSyncState,
  changedCount: number,
  queuedCount: number,
): SyncBoxRepositorySuccess | SyncBoxRepositoryFailure => {
  const snapshotResult = snapshotFromState(state);
  if (snapshotResult.status === "error") return failureFromState(snapshotResult.error, state);
  const counts = countsForState(state);
  return {
    status: "success",
    outcome: "success",
    snapshot: snapshotResult.snapshot,
    changedCount,
    queuedCount,
    ...counts,
  };
};

const syncResultExtras = (result: SyncCoordinatorResult) => ({
  trigger: result.trigger,
  remoteStatus: result.remoteStatus,
  pulledRecords: result.pulledRecords,
  pushedMutations: result.pushedMutations,
  acknowledgedMutationIds: [...result.acknowledgedMutationIds],
  issues: [...result.issues],
});

const isConflictDecision = (value: unknown): value is SyncBoxConflictDecision => (
  value === "keep-both" || value === "keep-local" || value === "keep-remote"
);

const CONFLICT_COPY_PREFIX = "m6-local-";
const CONFLICT_COPY_SUFFIX = "（このブラウザ）";

/**
 * The copy id is derived only from the slot and local payload.  A retry after
 * a lost response therefore addresses the same copy instead of creating a
 * second visible entry.  A collision salt is used only when an independently
 * edited entry already occupies the deterministic id.
 */
const makeConflictCopyId = (
  kind: SyncKind,
  entryId: string,
  payload: string,
  collisionSalt = "",
): string => `${CONFLICT_COPY_PREFIX}${sha256Hex([
  kind,
  entryId,
  payload,
  collisionSalt,
].join("\u001f"))}`;

const copyConflictEntry = (
  kind: SyncKind,
  entry: SyncEntryForKind<SyncKind>,
  id: string,
): { readonly status: "success"; readonly value: NormalizedEntry<SyncKind> }
  | { readonly status: "error"; readonly error: SyncBoxRepositoryError } => normalizeEntry(
    kind,
    {
      ...entry,
      id,
      name: `${entry.name || "保存スロット"}${CONFLICT_COPY_SUFFIX}`,
    } as SyncEntryForKind<SyncKind>,
  );

const removeConflict = (state: LocalSyncState, recordKey: string): LocalSyncState => {
  const { [recordKey]: _removed, ...remainingConflicts } = state.conflicts;
  return {
    ...state,
    conflicts: remainingConflicts,
    outbox: state.outbox.filter((mutation) => mutation.recordKey !== recordKey),
  };
};

const replaceRecord = (
  state: LocalSyncState,
  recordKey: string,
  record: SyncRecord | undefined,
): LocalSyncState => {
  const records = { ...state.records };
  if (record) records[recordKey] = record;
  else delete records[recordKey];
  return { ...state, records };
};

export class SyncBoxRepository {
  readonly local: LocalSyncRepository;
  readonly cloud: CloudSyncRepository;
  readonly coordinator: SyncCoordinator;

  private readonly now: SyncClock | undefined;
  private readonly mutationId?: string | (() => string);
  private readonly mutationIdFactory?: SyncBoxMutationIdFactory;

  constructor(options: SyncBoxRepositoryOptions);
  constructor(
    local: LocalSyncRepository,
    cloud: CloudSyncRepository,
    options?: Omit<SyncBoxRepositoryOptions, "local" | "cloud" | "localRepository" | "cloudRepository">,
  );
  constructor(
    optionsOrLocal: SyncBoxRepositoryOptions | LocalSyncRepository,
    cloud?: CloudSyncRepository,
    options: Omit<SyncBoxRepositoryOptions, "local" | "cloud" | "localRepository" | "cloudRepository"> = {},
  ) {
    const supplied = cloud
      ? { ...options, local: optionsOrLocal as LocalSyncRepository, cloud }
      : optionsOrLocal as SyncBoxRepositoryOptions;
    this.coordinator = supplied.coordinator ?? createSyncCoordinator({
      local: supplied.local ?? supplied.localRepository as LocalSyncRepository,
      cloud: supplied.cloud ?? supplied.cloudRepository as CloudSyncRepository,
      now: supplied.now ?? supplied.clock,
    });
    this.local = supplied.local ?? supplied.localRepository ?? this.coordinator.local;
    this.cloud = supplied.cloud ?? supplied.cloudRepository ?? this.coordinator.cloud;
    this.now = supplied.now ?? supplied.clock;
    this.mutationId = supplied.mutationId;
    this.mutationIdFactory = supplied.mutationIdFactory;
  }

  /** Load both box kinds from one local state snapshot. */
  loadSnapshot(): SyncBoxSnapshotResult {
    const loaded = this.coordinator.loadState();
    if (loaded.status === "error") return failureFromState(fromCoordinatorError(loaded.error));
    return successFromState(loaded.state, 0, 0);
  }

  saveTargetEntries(entries: readonly BoxEntry[]): SyncBoxRepositoryResult {
    return this.saveEntries("target-box", entries);
  }

  saveEnemyEntries(entries: readonly EnemyBoxEntry[]): SyncBoxRepositoryResult {
    return this.saveEntries("enemy-box", entries);
  }

  /**
   * Return the currently retained review objects without exposing the local
   * state container.  `loadSnapshot().snapshot.conflicts` is normally enough
   * for UI code; this method is useful for callers that need an explicit
   * conflict-list operation and keeps that call site independent of snapshot
   * naming.
   */
  loadConflicts():
    | { readonly status: "success"; readonly conflicts: readonly SyncBoxConflictDetail[] }
    | { readonly status: "error"; readonly error: SyncBoxRepositoryError } {
    const loaded = this.coordinator.loadState();
    if (loaded.status === "error") {
      return { status: "error", error: fromCoordinatorError(loaded.error) };
    }
    return {
      status: "success",
      conflicts: conflictDetailsForState(loaded.state),
    };
  }

  /** Resolve one retained same-slot conflict and persist the whole decision
   * with one local repository save.  Cloud reconciliation is intentionally
   * separate: callers should invoke synchronize after this local-first step.
   */
  resolveConflict(
    kind: SyncKind,
    entryId: string,
    decision: SyncBoxConflictDecision,
  ): SyncBoxRepositoryResult;
  resolveConflict(
    recordKey: string,
    decision: SyncBoxConflictDecision,
  ): SyncBoxRepositoryResult;
  resolveConflict(request: {
    readonly kind: SyncKind;
    readonly entryId: string;
    readonly decision: SyncBoxConflictDecision;
  }): SyncBoxRepositoryResult;
  resolveConflict(
    first: SyncKind | string | {
      readonly kind: SyncKind;
      readonly entryId: string;
      readonly decision: SyncBoxConflictDecision;
    },
    second?: string | SyncBoxConflictDecision,
    third?: SyncBoxConflictDecision,
  ): SyncBoxRepositoryResult {
    const parsed = (() => {
      if (typeof first === "object") {
        return {
          kind: first.kind,
          entryId: first.entryId,
          decision: first.decision,
        };
      }
      if (third !== undefined) {
        return { kind: first as SyncKind, entryId: second as string, decision: third };
      }
      if (isConflictDecision(second)) {
        const separator = first.indexOf(":");
        if (separator > 0) {
          return {
            kind: first.slice(0, separator) as SyncKind,
            entryId: first.slice(separator + 1),
            decision: second,
          };
        }
      }
      return null;
    })();

    const loaded = this.coordinator.loadState();
    if (loaded.status === "error") return failureFromState(fromCoordinatorError(loaded.error));
    const initial = loaded.state;
    if (
      !parsed
      || (parsed.kind !== "target-box" && parsed.kind !== "enemy-box")
      || !nonEmptyId(parsed.entryId)
      || !isConflictDecision(parsed.decision)
    ) {
      return failureFromState(makeError("invalid"), initial);
    }

    const recordKey = makeSyncRecordKey(parsed.kind, parsed.entryId);
    const conflict = initial.conflicts[recordKey];
    if (!conflict || conflict.kind !== parsed.kind || conflict.entryId !== parsed.entryId) {
      return failureFromState(makeError("conflict"), initial);
    }

    let nextState = removeConflict(initial, recordKey);
    // The remote branch is the only safe base for a new local mutation.  This
    // turns keep-local into a CAS write against the remote revision instead of
    // retrying the stale local revision that caused the conflict.
    nextState = replaceRecord(nextState, recordKey, conflict.remote);
    let changedCount = 1;
    let queuedCount = 0;

    if (parsed.decision === "keep-remote") {
      return this.persistResolution(nextState, changedCount, queuedCount, initial);
    }

    const localEntry = decodeRecordEntry(conflict.local);
    if (parsed.decision === "keep-both" && conflict.remote && localEntry) {
      let collisionSalt = "";
      let copy: NormalizedEntry<SyncKind> | undefined;
      let reusedExistingCopy = false;
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const copyId = makeConflictCopyId(
          parsed.kind,
          parsed.entryId,
          conflict.local.payload,
          collisionSalt,
        );
        const normalized = copyConflictEntry(parsed.kind, localEntry, copyId);
        if (normalized.status === "error") {
          return failureFromState(normalized.error, initial);
        }
        const copyKey = makeSyncRecordKey(parsed.kind, normalized.value.id);
        const existing = nextState.records[copyKey];
        if (!existing) {
          copy = normalized.value;
          break;
        }
        const existingPayload = canonicalPayloadForRecord(existing);
        if (!existing.tombstone && existingPayload === normalized.value.payload) {
          // A previous invocation may have persisted the deterministic copy
          // before the caller lost its response.  Keep it and avoid queuing a
          // duplicate mutation.
          reusedExistingCopy = true;
          break;
        }
        collisionSalt = sha256Hex([
          collisionSalt,
          existing.payload,
          existing.mutationId,
          String(existing.revision),
        ].join("\u001f"));
      }
      if (!copy && !reusedExistingCopy) {
        return failureFromState(makeError("invalid"), initial);
      }
      if (copy) {
        const copyResult = enqueueSyncMutation(nextState, {
          kind: parsed.kind,
          entry: copy.entry,
          now: this.now,
          mutationId: this.resolveMutationId({
            kind: parsed.kind,
            entryId: copy.id,
            operation: "upsert",
            index: 0,
          }),
        });
        if (copyResult.status === "error") {
          return failureFromState(
            makeError(copyResult.reason === "conflict" ? "conflict" : "invalid"),
            initial,
          );
        }
        nextState = copyResult.state;
        queuedCount += 1;
        changedCount += 1;
      }
      return this.persistResolution(nextState, changedCount, queuedCount, initial);
    }

    // There is no visible local branch to copy when it is a tombstone.  Keep
    // the remote original at its original id and clear the review marker;
    // recreating a tombstone at that id here would silently turn keep-both
    // into keep-local.
    if (parsed.decision === "keep-both" && conflict.remote && !localEntry) {
      return this.persistResolution(nextState, changedCount, queuedCount, initial);
    }

    // keep-local, and keep-both when no remote original exists, retain the
    // local branch at its original slot.  A tombstone is represented by a new
    // tombstone mutation only when a remote base exists; if the remote branch
    // is absent, there is nothing to delete on the server.
    if (localEntry) {
      const result = enqueueSyncMutation(nextState, {
        kind: parsed.kind,
        entry: localEntry,
        now: this.now,
        mutationId: this.resolveMutationId({
          kind: parsed.kind,
          entryId: parsed.entryId,
          operation: "upsert",
          index: 0,
        }),
      });
      if (result.status === "error") {
        return failureFromState(
          makeError(result.reason === "conflict" ? "conflict" : "invalid"),
          initial,
        );
      }
      nextState = result.state;
      queuedCount += 1;
    } else if (conflict.remote && !conflict.remote.tombstone) {
      const result = enqueueSyncTombstone(nextState, {
        kind: parsed.kind,
        entryId: parsed.entryId,
        now: this.now,
        mutationId: this.resolveMutationId({
          kind: parsed.kind,
          entryId: parsed.entryId,
          operation: "delete",
          index: 0,
        }),
      });
      if (result.status === "error") {
        return failureFromState(
          makeError(result.reason === "conflict" ? "conflict" : "invalid"),
          initial,
        );
      }
      nextState = result.state;
      queuedCount += 1;
    }
    return this.persistResolution(nextState, changedCount, queuedCount, initial);
  }

  synchronize(trigger: SyncTrigger): Promise<SyncBoxSynchronizeResult> {
    return this.coordinator.synchronize(trigger)
      .then((result) => {
        const base = result.status === "success"
          ? successFromState(result.state, 0, 0)
          : failureFromState(fromCoordinatorError(result.error), result.state);
        const extras = syncResultExtras(result);
        return {
          ...base,
          ...extras,
        } as SyncBoxSynchronizeResult;
      })
      .catch(() => ({
        ...failureFromState(makeError("unknown")),
        trigger,
        remoteStatus: "error" as const,
        pulledRecords: 0,
        pushedMutations: 0,
        acknowledgedMutationIds: [],
        issues: [],
      }));
  }

  private saveEntries<K extends SyncKind>(
    kind: K,
    entries: readonly SyncEntryForKind<K>[],
  ): SyncBoxRepositoryResult {
    const loaded = this.coordinator.loadState();
    if (loaded.status === "error") return failureFromState(fromCoordinatorError(loaded.error));
    const initial = loaded.state;

    if (!Array.isArray(entries)) return failureFromState(makeError("invalid"), initial);

    const normalized = new Map<string, NormalizedEntry<K>>();
    for (const entry of entries) {
      const result = normalizeEntry(kind, entry);
      if (result.status === "error") return failureFromState(result.error, initial);
      if (normalized.has(result.value.id)) {
        return failureFromState(makeError("duplicate-id"), initial);
      }
      normalized.set(result.value.id, result.value);
    }

    const records = Object.values(initial.records)
      .filter((record) => record.kind === kind);
    const recordsById = new Map(records.map((record) => [record.entryId, record]));
    const activeIds = new Set<string>();
    for (const record of records) {
      const source = activeSource(initial, kind, record);
      if (!source.tombstone) activeIds.add(record.entryId);
    }

    const conflicts = new Set(
      Object.values(initial.conflicts)
        .filter((conflict) => conflict.kind === kind)
        .map((conflict) => conflict.entryId),
    );
    const planned: PlannedMutation[] = [];

    // All desired entries are normalized and validated before touching a
    // clone. Sorting IDs gives a stable outbox order independent of UI order.
    for (const id of [...normalized.keys()].sort()) {
      const desired = normalized.get(id);
      if (!desired) continue;
      const record = recordsById.get(id);
      if (conflicts.has(id)) {
        const localBranch = record ? activeSource(initial, kind, record) : undefined;
        const localPayload = localBranch && !localBranch.tombstone
          ? canonicalPayloadForRecord(localBranch)
          : null;
        if (localPayload === desired.payload) {
          // A conflict blocks only its own slot. Keeping the exact local
          // branch in the desired list must not prevent another slot in the
          // same box kind from being saved.
          activeIds.delete(id);
          continue;
        }
        return failureFromState(makeError("conflict"), initial);
      }
      if (!record || record.tombstone) {
        planned.push({ kind, entryId: id, operation: "upsert", entry: desired.entry });
        continue;
      }
      const existingPayload = canonicalPayloadForRecord(record);
      if (existingPayload === null) return failureFromState(makeError("invalid"), initial);
      if (existingPayload !== desired.payload) {
        planned.push({ kind, entryId: id, operation: "upsert", entry: desired.entry });
      }
      activeIds.delete(id);
    }

    // Every remaining active slot is absent from the desired list and needs a
    // retained-payload tombstone. Tombstones already absent from desired are
    // intentionally left untouched so restore can be an explicit upsert.
    for (const id of [...activeIds].sort()) {
      if (conflicts.has(id)) return failureFromState(makeError("conflict"), initial);
      const record = recordsById.get(id);
      if (record && !record.tombstone) {
        planned.push({ kind, entryId: id, operation: "delete" });
      }
    }

    if (planned.length === 0) return successFromState(initial, 0, 0);

    let nextState = cloneState(initial);
    for (let index = 0; index < planned.length; index += 1) {
      const mutation = planned[index];
      if (!mutation) continue;
      const mutationContext: SyncBoxMutationContext = {
        kind,
        entryId: mutation.entryId,
        operation: mutation.operation,
        index,
      };
      const mutationId = this.resolveMutationId(mutationContext);
      const result = mutation.operation === "upsert"
        ? enqueueSyncMutation(nextState, {
          kind,
          entry: mutation.entry as SyncEntryForKind<K>,
          now: this.now,
          mutationId,
        })
        : enqueueSyncTombstone(nextState, {
          kind,
          entryId: mutation.entryId,
          now: this.now,
          mutationId,
        });
      if (result.status === "error") {
        const errorCode = result.reason === "conflict" ? "conflict" : "invalid";
        return failureFromState(makeError(errorCode), initial);
      }
      nextState = result.state;
    }

    // This is the sole persistence boundary for the complete batch. If it
    // fails, the original local state has never been written or partially
    // updated.
    let saved;
    try {
      saved = this.local.save(nextState);
    } catch {
      return failureFromState(makeError("unavailable"), initial);
    }
    if (saved.status !== "valid") {
      return failureFromState(fromLocalSaveCode(saved.error.code), initial);
    }
    return successFromState(saved.state, planned.length, planned.length);
  }

  private resolveMutationId(context: SyncBoxMutationContext): string | (() => string) | undefined {
    if (this.mutationIdFactory) return this.mutationIdFactory(context);
    if (this.mutationId !== undefined) return this.mutationId;
    return undefined;
  }

  private persistResolution(
    nextState: LocalSyncState,
    changedCount: number,
    queuedCount: number,
    originalState: LocalSyncState,
  ): SyncBoxRepositoryResult {
    try {
      const saved = this.local.save(nextState);
      if (saved.status !== "valid") {
        return failureFromState(fromLocalSaveCode(saved.error.code), originalState);
      }
      return successFromState(saved.state, changedCount, queuedCount);
    } catch {
      return failureFromState(makeError("unavailable"), originalState);
    }
  }
}

export function createSyncBoxRepository(options: SyncBoxRepositoryOptions): SyncBoxRepository;
export function createSyncBoxRepository(
  local: LocalSyncRepository,
  cloud: CloudSyncRepository,
  options?: Omit<SyncBoxRepositoryOptions, "local" | "cloud" | "localRepository" | "cloudRepository">,
): SyncBoxRepository;
export function createSyncBoxRepository(
  optionsOrLocal: SyncBoxRepositoryOptions | LocalSyncRepository,
  cloud?: CloudSyncRepository,
  options: Omit<SyncBoxRepositoryOptions, "local" | "cloud" | "localRepository" | "cloudRepository"> = {},
): SyncBoxRepository {
  return cloud
    ? new SyncBoxRepository(optionsOrLocal as LocalSyncRepository, cloud, options)
    : new SyncBoxRepository(optionsOrLocal as SyncBoxRepositoryOptions);
}

export const createBoxSyncRepository = createSyncBoxRepository;
