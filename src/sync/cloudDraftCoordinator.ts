import {
  parseDraftStorageDocument,
  stringifyDraftStorageDocument,
  type DraftStorageDocument,
} from "../ui/draftStorage";
import type {
  CloudDraftLocalRepository,
  CloudDraftRepositoryErrorCode as LocalRepositoryErrorCode,
} from "./cloudDraftLocalRepository";
import type {
  CloudDraftReadResult,
  CloudDraftRepository,
  CloudDraftRepositoryErrorKind,
  CloudDraftRepositoryIssue,
} from "./firestoreCloudDraftRepository";
import {
  CLOUD_DRAFT_DELAY_MS,
  CLOUD_DRAFT_MAX_ACTIVE_RECORDS,
  CLOUD_DRAFT_RETENTION_MS,
  CLOUD_DRAFT_SCHEMA_VERSION,
  createEmptyCloudDraftLocalState,
  type CloudDraftLocalState,
  type CloudDraftMutation,
  type CloudDraftRecord,
} from "./cloudDraftTypes";
import { generateOpaqueDeviceId } from "./deviceIdentity";

export type CloudDraftSyncTrigger = "launch" | "focus" | "online" | "manual" | "timer";

export type CloudDraftCoordinatorErrorKind =
  | LocalRepositoryErrorCode
  | CloudDraftRepositoryErrorKind
  | "conflict"
  | "invalid";

export class CloudDraftCoordinatorError extends Error {
  readonly kind: CloudDraftCoordinatorErrorKind;

  constructor(kind: CloudDraftCoordinatorErrorKind, message: string) {
    super(message);
    this.name = "CloudDraftCoordinatorError";
    this.kind = kind;
  }
}

export interface CloudDraftSnapshot {
  readonly records: readonly CloudDraftRecord[];
  readonly currentDraft: CloudDraftRecord | null;
  readonly otherDrafts: readonly CloudDraftRecord[];
  readonly outboxCount: number;
  readonly nextEligibleAt: string | null;
  readonly issueCount: number;
}

export type CloudDraftLocalMutationResult =
  | {
      readonly status: "success";
      readonly state: CloudDraftLocalState;
      readonly snapshot: CloudDraftSnapshot;
    }
  | {
      readonly status: "error";
      readonly error: CloudDraftCoordinatorError;
      readonly snapshot?: CloudDraftSnapshot;
    };

export type CloudDraftLoadResult = CloudDraftLocalMutationResult;

export type CloudDraftSynchronizeResult =
  | {
      readonly status: "success";
      readonly trigger: CloudDraftSyncTrigger;
      readonly state: CloudDraftLocalState;
      readonly snapshot: CloudDraftSnapshot;
      readonly issues: readonly CloudDraftRepositoryIssue[];
    }
  | {
      readonly status: "error";
      readonly trigger: CloudDraftSyncTrigger;
      readonly error: CloudDraftCoordinatorError;
      readonly state?: CloudDraftLocalState;
      readonly snapshot?: CloudDraftSnapshot;
      readonly issues: readonly CloudDraftRepositoryIssue[];
    };

export interface CloudDraftCoordinatorOptions {
  readonly local: CloudDraftLocalRepository;
  readonly cloud: CloudDraftRepository;
  readonly deviceLabel: string;
  readonly now?: () => Date;
  readonly createMutationId?: () => string;
}

const toRecord = (mutation: CloudDraftMutation): CloudDraftRecord => ({
  ownerUid: mutation.ownerUid,
  deviceId: mutation.deviceId,
  deviceLabel: mutation.deviceLabel,
  schemaVersion: mutation.schemaVersion,
  payload: mutation.payload,
  revision: mutation.revision,
  baseRevision: mutation.baseRevision,
  mutationId: mutation.mutationId,
  updatedAt: mutation.updatedAt,
  expiresAt: mutation.expiresAt,
  deletedAt: mutation.deletedAt,
});

const sortNewestFirst = (left: CloudDraftRecord, right: CloudDraftRecord): number => (
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  || left.deviceId.localeCompare(right.deviceId)
);

const getEligibleAtMillis = (mutation: CloudDraftMutation): number => (
  Date.parse(mutation.queuedAt) + (mutation.deletedAt === null ? CLOUD_DRAFT_DELAY_MS : 0)
);

export const createCloudDraftSnapshot = (
  state: CloudDraftLocalState,
  now = new Date(),
  issueCount = 0,
): CloudDraftSnapshot => {
  const nowMillis = now.getTime();
  const records = Object.values(state.records)
    .filter((record) => record.deletedAt === null && Date.parse(record.expiresAt) > nowMillis)
    .sort(sortNewestFirst);
  const currentDraft = records.find((record) => record.deviceId === state.currentDeviceId) ?? null;
  const nextEligibleMillis = state.outbox.length === 0
    ? null
    : Math.min(...state.outbox.map(getEligibleAtMillis));
  return {
    records,
    currentDraft,
    otherDrafts: records.filter((record) => record.deviceId !== state.currentDeviceId),
    outboxCount: state.outbox.length,
    nextEligibleAt: nextEligibleMillis === null ? null : new Date(nextEligibleMillis).toISOString(),
    issueCount,
  };
};

const normalizePayload = (payload: string | DraftStorageDocument): string => {
  const document = typeof payload === "string"
    ? parseDraftStorageDocument(payload)
    : payload;
  return stringifyDraftStorageDocument(document);
};

const localError = (
  kind: LocalRepositoryErrorCode,
  message: string,
): CloudDraftCoordinatorError => new CloudDraftCoordinatorError(kind, message);

const remoteError = (
  kind: CloudDraftRepositoryErrorKind,
  message: string,
): CloudDraftCoordinatorError => new CloudDraftCoordinatorError(kind, message);

const replaceMutation = (
  outbox: readonly CloudDraftMutation[],
  mutation: CloudDraftMutation,
): readonly CloudDraftMutation[] => [
  ...outbox.filter((candidate) => candidate.deviceId !== mutation.deviceId),
  mutation,
].sort((left, right) => left.sequence - right.sequence);

const removeMutation = (
  outbox: readonly CloudDraftMutation[],
  mutationId: string,
): readonly CloudDraftMutation[] => outbox.filter((candidate) => candidate.mutationId !== mutationId);

const withRecord = (
  state: CloudDraftLocalState,
  record: CloudDraftRecord,
): CloudDraftLocalState => ({
  ...state,
  records: { ...state.records, [record.deviceId]: record },
});

export class CloudDraftCoordinator {
  readonly local: CloudDraftLocalRepository;
  readonly cloud: CloudDraftRepository;
  readonly deviceLabel: string;
  private readonly now: () => Date;
  private readonly createMutationId: () => string;
  private running: Promise<CloudDraftSynchronizeResult> | null = null;

  constructor(options: CloudDraftCoordinatorOptions) {
    this.local = options.local;
    this.cloud = options.cloud;
    this.deviceLabel = options.deviceLabel;
    this.now = options.now ?? (() => new Date());
    this.createMutationId = options.createMutationId ?? (() => generateOpaqueDeviceId());
  }

  loadSnapshot(): CloudDraftLoadResult {
    const loaded = this.local.load();
    if (loaded.status === "missing") {
      const state = createEmptyCloudDraftLocalState(
        this.local.ownerUid,
        this.local.currentDeviceId,
      );
      return {
        status: "success",
        state,
        snapshot: createCloudDraftSnapshot(state, this.now()),
      };
    }
    if (loaded.status !== "valid") {
      return {
        status: "error",
        error: localError(loaded.error.code, loaded.error.message),
      };
    }
    return {
      status: "success",
      state: loaded.state,
      snapshot: createCloudDraftSnapshot(loaded.state, this.now()),
    };
  }

  queueCurrentDraft(payload: string | DraftStorageDocument): CloudDraftLocalMutationResult {
    let normalizedPayload: string;
    try {
      normalizedPayload = normalizePayload(payload);
    } catch (error) {
      return {
        status: "error",
        error: new CloudDraftCoordinatorError(
          "invalid",
          error instanceof Error ? error.message : "クラウド下書きの内容が不正です",
        ),
      };
    }
    const loaded = this.loadSnapshot();
    if (loaded.status === "error") return loaded;
    const now = this.now();
    const state = this.enqueue(
      loaded.state,
      this.local.currentDeviceId,
      this.deviceLabel,
      normalizedPayload,
      false,
      now,
    );
    return this.persist(this.queueCleanupMutations(state, now), now);
  }

  queueDelete(deviceId: string): CloudDraftLocalMutationResult {
    const loaded = this.loadSnapshot();
    if (loaded.status === "error") return loaded;
    const existing = loaded.state.records[deviceId];
    const pending = loaded.state.outbox.find((mutation) => mutation.deviceId === deviceId);
    if (!existing && !pending) {
      return loaded;
    }
    const source = pending ?? existing;
    const now = this.now();
    const state = this.enqueue(
      loaded.state,
      deviceId,
      source.deviceLabel,
      source.payload,
      true,
      now,
    );
    return this.persist(state, now);
  }

  synchronize(trigger: CloudDraftSyncTrigger = "manual"): Promise<CloudDraftSynchronizeResult> {
    if (this.running) return this.running;
    const running = this.runSynchronize(trigger).finally(() => {
      if (this.running === running) this.running = null;
    });
    this.running = running;
    return running;
  }

  private enqueue(
    state: CloudDraftLocalState,
    deviceId: string,
    deviceLabel: string,
    payload: string,
    tombstone: boolean,
    now: Date,
  ): CloudDraftLocalState {
    const pending = state.outbox.find((mutation) => mutation.deviceId === deviceId);
    const current = state.records[deviceId];
    const baseRevision = pending?.baseRevision ?? current?.revision ?? 0;
    // `null` is meaningful for a first revision. Do not let nullish
    // coalescing replace a pending mutation's null base id with the current
    // record mutation id: the local repository validates this pair together.
    const baseMutationId = pending !== undefined
      ? pending.baseMutationId
      : current?.mutationId ?? null;
    const sequence = pending?.sequence ?? state.nextSequence;
    const timestamp = now.toISOString();
    const mutation: CloudDraftMutation = {
      ownerUid: state.ownerUid,
      deviceId,
      deviceLabel,
      schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
      payload,
      revision: baseRevision + 1,
      baseRevision,
      mutationId: this.createMutationId(),
      updatedAt: timestamp,
      expiresAt: new Date(now.getTime() + CLOUD_DRAFT_RETENTION_MS).toISOString(),
      deletedAt: tombstone ? timestamp : null,
      sequence,
      queuedAt: timestamp,
      baseMutationId,
    };
    return {
      ...state,
      records: { ...state.records, [deviceId]: toRecord(mutation) },
      outbox: replaceMutation(state.outbox, mutation),
      nextSequence: pending ? state.nextSequence : state.nextSequence + 1,
    };
  }

  private persist(state: CloudDraftLocalState, now: Date): CloudDraftLocalMutationResult {
    const saved = this.local.save(state);
    if (saved.status !== "valid") {
      return {
        status: "error",
        error: localError(saved.error.code, saved.error.message),
        snapshot: createCloudDraftSnapshot(state, now),
      };
    }
    return {
      status: "success",
      state: saved.state,
      snapshot: createCloudDraftSnapshot(saved.state, now),
    };
  }

  private mergeRemote(
    state: CloudDraftLocalState,
    remoteResult: CloudDraftReadResult,
    now: Date,
  ): CloudDraftLocalState {
    const remoteRecords: Record<string, CloudDraftRecord> = Object.fromEntries(
      remoteResult.drafts.map((record) => [record.deviceId, record]),
    );
    // A malformed/future remote document is excluded by the adapter. Keep a
    // previously validated local copy instead of turning one bad server row
    // into silent local data loss; explicit remote tombstones still overlay it.
    const records: Record<string, CloudDraftRecord> = {
      ...state.records,
      ...remoteRecords,
    };
    const nextOutbox: CloudDraftMutation[] = [];

    for (const original of state.outbox) {
      const remote = remoteRecords[original.deviceId];
      if (remote?.mutationId === original.mutationId) {
        records[remote.deviceId] = remote;
        continue;
      }
      let pending = original;
      if (remote && remote.revision !== original.baseRevision) {
        pending = {
          ...original,
          revision: remote.revision + 1,
          baseRevision: remote.revision,
          baseMutationId: remote.mutationId,
          mutationId: this.createMutationId(),
        };
      } else if (!remote && original.deletedAt !== null) {
        // A delete queued before its first upsert reached Firestore has
        // nothing to tombstone. Dropping it here also handles normal cancel;
        // if a lost response actually created the remote row, the branch
        // above rebases the tombstone onto that returned revision instead.
        delete records[original.deviceId];
        continue;
      } else if (!remote && original.baseRevision !== 0) {
        pending = {
          ...original,
          revision: 1,
          baseRevision: 0,
          baseMutationId: null,
          mutationId: this.createMutationId(),
        };
      }
      records[pending.deviceId] = toRecord(pending);
      nextOutbox.push(pending);
    }

    let merged: CloudDraftLocalState = {
      ...state,
      records,
      outbox: nextOutbox.sort((left, right) => left.sequence - right.sequence),
      metadata: {
        ...state.metadata,
        lastPulledAt: now.toISOString(),
      },
    };
    merged = this.queueCleanupMutations(merged, now);
    merged = this.compactExpiredLocalTombstones(merged, now);
    return merged;
  }

  private compactExpiredLocalTombstones(
    state: CloudDraftLocalState,
    now: Date,
  ): CloudDraftLocalState {
    const cutoff = now.getTime() - CLOUD_DRAFT_RETENTION_MS;
    const pendingDeviceIds = new Set(state.outbox.map((mutation) => mutation.deviceId));
    const records = Object.fromEntries(Object.entries(state.records).filter(([, record]) => (
      record.deletedAt === null
      || pendingDeviceIds.has(record.deviceId)
      || Date.parse(record.deletedAt) > cutoff
    )));
    return { ...state, records };
  }

  private queueCleanupMutations(
    state: CloudDraftLocalState,
    now: Date,
  ): CloudDraftLocalState {
    const nowMillis = now.getTime();
    const active = Object.values(state.records)
      .filter((record) => record.deletedAt === null);
    const expired = active.filter((record) => Date.parse(record.expiresAt) <= nowMillis);
    const unexpired = active
      .filter((record) => Date.parse(record.expiresAt) > nowMillis)
      .sort((left, right) => {
        if (left.deviceId === state.currentDeviceId) return -1;
        if (right.deviceId === state.currentDeviceId) return 1;
        return sortNewestFirst(left, right);
      });
    const overLimit = unexpired.slice(CLOUD_DRAFT_MAX_ACTIVE_RECORDS);
    let next = state;
    for (const record of [...expired, ...overLimit]) {
      next = this.enqueue(
        next,
        record.deviceId,
        record.deviceLabel,
        record.payload,
        true,
        now,
      );
    }
    return next;
  }

  private async runSynchronize(
    trigger: CloudDraftSyncTrigger,
  ): Promise<CloudDraftSynchronizeResult> {
    const loaded = this.loadSnapshot();
    if (loaded.status === "error") {
      return { status: "error", trigger, error: loaded.error, issues: [] };
    }

    const remoteResult = await this.cloud.readAll();
    if (remoteResult.status === "error") {
      const error = remoteResult.error ?? {
        kind: "unknown" as const,
        message: "クラウド下書きを読み込めませんでした",
      };
      return {
        status: "error",
        trigger,
        error: remoteError(error.kind, error.message),
        state: loaded.state,
        snapshot: loaded.snapshot,
        issues: remoteResult.issues,
      };
    }

    const latestLocal = this.local.load();
    if (latestLocal.status !== "valid" && latestLocal.status !== "missing") {
      return {
        status: "error",
        trigger,
        error: localError(latestLocal.error.code, latestLocal.error.message),
        state: loaded.state,
        snapshot: loaded.snapshot,
        issues: remoteResult.issues,
      };
    }
    const now = this.now();
    const latestState = latestLocal.status === "valid"
      ? latestLocal.state
      : createEmptyCloudDraftLocalState(this.local.ownerUid, this.local.currentDeviceId);
    // Re-read after the awaited pull so a draft queued while the network was
    // in flight is merged, never overwritten by the pre-pull snapshot.
    let state = this.mergeRemote(latestState, remoteResult, now);
    const mergedSave = this.local.save(state);
    if (mergedSave.status !== "valid") {
      return {
        status: "error",
        trigger,
        error: localError(mergedSave.error.code, mergedSave.error.message),
        snapshot: createCloudDraftSnapshot(state, now, remoteResult.issues.length),
        issues: remoteResult.issues,
      };
    }
    state = mergedSave.state;
    const issues = [...remoteResult.issues];
    let firstError: CloudDraftCoordinatorError | null = null;

    for (const mutation of [...state.outbox].sort((left, right) => left.sequence - right.sequence)) {
      if (getEligibleAtMillis(mutation) > now.getTime()) continue;
      const written = await this.cloud.write(mutation);
      issues.push(...written.issues);
      if (written.status === "written" || written.status === "duplicate") {
        // queueCurrentDraft() is synchronous and may have replaced this
        // mutation while the remote write was in flight (for example when a
        // tab is backgrounded or a pagehide handler queued the latest draft).
        // Reload the one-record local transaction before acknowledging so an
        // old response cannot erase that newer outbox entry.
        const latest = this.local.load();
        if (latest.status !== "valid") {
          firstError ??= latest.status === "missing"
            ? localError("unavailable", "クラウド下書きのローカル状態が見つかりません")
            : localError(latest.error.code, latest.error.message);
          break;
        }
        const latestState = latest.state;
        const current = latestState.records[mutation.deviceId];
        const isSameMutation = current?.mutationId === mutation.mutationId;
        const record = written.record ?? written.draft;
        state = {
          ...latestState,
          records: record && isSameMutation
            ? { ...latestState.records, [record.deviceId]: record }
            : latestState.records,
          outbox: removeMutation(latestState.outbox, mutation.mutationId),
          metadata: { ...latestState.metadata, lastPushedAt: now.toISOString() },
        };
        const saved = this.local.save(state);
        if (saved.status !== "valid") {
          firstError ??= localError(saved.error.code, saved.error.message);
          break;
        }
        state = saved.state;
        continue;
      }
      if (written.status === "conflict") {
        firstError ??= new CloudDraftCoordinatorError(
          "conflict",
          written.issue?.message ?? "クラウド下書きが別の操作と競合しました",
        );
        continue;
      }
      if (written.status === "invalid") {
        firstError ??= new CloudDraftCoordinatorError(
          "invalid",
          written.issue?.message ?? "クラウド下書きmutationが不正です",
        );
        continue;
      }
      const error = written.error ?? { kind: "unknown" as const, message: "クラウド下書きを保存できませんでした" };
      firstError ??= remoteError(error.kind, error.message);
      break;
    }

    const snapshot = createCloudDraftSnapshot(state, now, issues.length);
    return firstError
      ? { status: "error", trigger, error: firstError, state, snapshot, issues }
      : { status: "success", trigger, state, snapshot, issues };
  }
}

export const createCloudDraftCoordinator = (
  options: CloudDraftCoordinatorOptions,
): CloudDraftCoordinator => new CloudDraftCoordinator(options);
