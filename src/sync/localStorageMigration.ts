import type { FirebaseClient } from "./firebaseClient";
import { getFirebaseClient } from "./firebaseClient";
import {
  createFirestoreSyncRepository,
  type CloudSyncRepository,
  type SyncReadResult,
  type SyncRepositoryIssue,
} from "./firestoreSyncRepository";
import {
  createLocalSyncRepository,
  type LocalSyncRepository,
} from "./localSyncRepository";
import {
  buildMigrationPlan,
  type MigrationDecision as PlanDecision,
  type MigrationPlanSummary,
} from "./migrationPlan";
import {
  MIGRATION_STATE_SCHEMA_VERSION,
  MigrationSnapshotError,
  captureLegacyMigrationSnapshot,
  createMigrationStateRepository,
  type CapturedLegacyMigrationSnapshot,
  type MigrationRawStorageLike,
  type MigrationState,
  type MigrationStateRepository,
  type MigrationStateStorageLike,
} from "./migrationStorage";
import { createSyncCoordinator } from "./syncCoordinator";
import { decodeSyncPayload, encodeSyncPayload } from "./syncPayload";
import type { SyncRecord } from "./syncTypes";

export const MIGRATION_SOURCE_CLAIM_STORAGE_KEY = "championcreator.migration-source.v1";
export const MIGRATION_SOURCE_CLAIM_SCHEMA_VERSION = 1 as const;

export type LocalStorageMigrationDecision = "merge" | "cloud" | "device" | "later";

export type LocalStorageMigrationErrorCode =
  | "legacy-corrupt"
  | "legacy-unavailable"
  | "migration-state-corrupt"
  | "migration-state-unavailable"
  | "migration-state-quota"
  | "source-changed"
  | "source-claimed"
  | "cloud-network"
  | "cloud-permission"
  | "cloud-quota"
  | "cloud-invalid"
  | "cloud-unavailable"
  | "local-corrupt"
  | "local-unavailable"
  | "local-quota"
  | "local-existing-data"
  | "sync-conflict"
  | "sync-incomplete"
  | "firebase-unavailable"
  | "unknown";

export class LocalStorageMigrationError extends Error {
  readonly code: LocalStorageMigrationErrorCode;
  readonly retryable: boolean;

  constructor(code: LocalStorageMigrationErrorCode, message: string, retryable = true) {
    super(message);
    this.name = "LocalStorageMigrationError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface LocalStorageMigrationSummary {
  readonly deviceTargetCount: number;
  readonly deviceEnemyCount: number;
  readonly cloudTargetCount: number;
  readonly cloudEnemyCount: number;
  readonly sameCount: number;
  readonly conflictCount: number;
}

export interface LocalStorageMigrationResult {
  readonly status: MigrationState["status"];
  readonly state: MigrationState;
  readonly summary: LocalStorageMigrationSummary;
  readonly requiresDecision: boolean;
  readonly canUseDevice: boolean;
  readonly error?: LocalStorageMigrationError;
  readonly planSummary?: MigrationPlanSummary;
}

export interface LocalStorageMigrationControllerOptions {
  readonly ownerUid: string;
  readonly migrationState: MigrationStateRepository;
  readonly local: LocalSyncRepository;
  readonly cloud: CloudSyncRepository;
  readonly legacyStorage?: MigrationRawStorageLike | null;
  readonly claimStorage: MigrationStateStorageLike;
  readonly snapshot?: CapturedLegacyMigrationSnapshot;
  readonly now?: string | Date | (() => string | Date);
}

export interface BrowserLocalStorageMigrationOptions {
  readonly storage?: MigrationStateStorageLike | null;
  readonly snapshot?: CapturedLegacyMigrationSnapshot;
  readonly client?: FirebaseClient;
  readonly now?: LocalStorageMigrationControllerOptions["now"];
}

interface MigrationSourceClaim {
  readonly schemaVersion: typeof MIGRATION_SOURCE_CLAIM_SCHEMA_VERSION;
  readonly ownerUid: string;
  readonly sourceFingerprint: string;
  readonly claimedAt: string;
}

const MIGRATION_LOCK_NAME = "championcreator-sync-migration-source";
let fallbackMigrationLock: Promise<void> = Promise.resolve();

const withMigrationLock = async <T>(task: () => Promise<T>): Promise<T> => {
  const locks = typeof globalThis.navigator === "undefined"
    ? undefined
    : globalThis.navigator.locks;
  if (locks) {
    return locks.request(MIGRATION_LOCK_NAME, { mode: "exclusive" }, task);
  }

  const previous = fallbackMigrationLock;
  let release: () => void = () => undefined;
  fallbackMigrationLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
};

const emptySummary = (): LocalStorageMigrationSummary => ({
  deviceTargetCount: 0,
  deviceEnemyCount: 0,
  cloudTargetCount: 0,
  cloudEnemyCount: 0,
  sameCount: 0,
  conflictCount: 0,
});

const resolveNow = (
  value: LocalStorageMigrationControllerOptions["now"],
): string => {
  try {
    const resolved = typeof value === "function" ? value() : value;
    if (resolved instanceof Date) {
      return resolved.toISOString();
    }
    if (typeof resolved === "string" && Number.isFinite(Date.parse(resolved))) {
      return new Date(resolved).toISOString();
    }
  } catch {
    // Fall through to the process clock. No provider error is retained.
  }
  return new Date().toISOString();
};

const defaultState = (ownerUid: string): MigrationState => ({
  schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
  ownerUid,
  status: "not-started",
});

const stateDecisionToPlan = (decision: MigrationState["decision"]): PlanDecision | null => {
  if (decision === "merge") return "merge";
  if (decision === "use-cloud") return "cloud";
  if (decision === "use-device") return "device";
  return null;
};

const planDecisionToState = (decision: PlanDecision): NonNullable<MigrationState["decision"]> => (
  decision === "cloud" ? "use-cloud" : decision === "device" ? "use-device" : "merge"
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const parseClaim = (raw: string): MigrationSourceClaim => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new LocalStorageMigrationError(
      "migration-state-corrupt",
      "このブラウザの移行元アカウント情報を読み込めません",
      false,
    );
  }
  if (!isRecord(parsed)
    || parsed.schemaVersion !== MIGRATION_SOURCE_CLAIM_SCHEMA_VERSION
    || typeof parsed.ownerUid !== "string"
    || parsed.ownerUid.length === 0
    || typeof parsed.sourceFingerprint !== "string"
    || parsed.sourceFingerprint.length === 0
    || typeof parsed.claimedAt !== "string"
    || !Number.isFinite(Date.parse(parsed.claimedAt))) {
    throw new LocalStorageMigrationError(
      "migration-state-corrupt",
      "このブラウザの移行元アカウント情報が不正です",
      false,
    );
  }
  return {
    schemaVersion: MIGRATION_SOURCE_CLAIM_SCHEMA_VERSION,
    ownerUid: parsed.ownerUid,
    sourceFingerprint: parsed.sourceFingerprint,
    claimedAt: parsed.claimedAt,
  };
};

const cloudError = (result: SyncReadResult): LocalStorageMigrationError => {
  const kind = result.error?.kind;
  if (kind === "permission-denied") {
    return new LocalStorageMigrationError("cloud-permission", "クラウド保存へのアクセスが拒否されました");
  }
  if (kind === "quota") {
    return new LocalStorageMigrationError("cloud-quota", "クラウド保存の利用上限に達しました");
  }
  if (kind === "network") {
    return new LocalStorageMigrationError("cloud-network", "クラウド保存へ接続できません");
  }
  return new LocalStorageMigrationError("cloud-unavailable", "クラウド保存を読み込めません");
};

const issueError = (issues: readonly SyncRepositoryIssue[]): LocalStorageMigrationError => (
  new LocalStorageMigrationError(
    "cloud-invalid",
    `クラウド保存に確認が必要なデータがあります (${issues[0]?.code ?? "unknown"})`,
    false,
  )
);

const localSaveError = (status: string): LocalStorageMigrationError => {
  if (status === "quota") {
    return new LocalStorageMigrationError("local-quota", "アカウント用のブラウザ保存容量が不足しています");
  }
  if (status === "corrupt") {
    return new LocalStorageMigrationError("local-corrupt", "アカウント用のブラウザ保存データが不正です", false);
  }
  return new LocalStorageMigrationError("local-unavailable", "アカウント用のブラウザ保存を利用できません");
};

const canonicalRemotePayload = (record: SyncRecord): string => {
  const decoded = decodeSyncPayload(record.kind, record.payload, record.entryId);
  if (decoded.status === "error") {
    throw decoded.error;
  }
  return decoded.kind === "target-box"
    ? encodeSyncPayload("target-box", decoded.entry)
    : encodeSyncPayload("enemy-box", decoded.entry);
};

const summarize = (
  snapshot: CapturedLegacyMigrationSnapshot,
  records: readonly SyncRecord[],
): LocalStorageMigrationSummary => {
  const localPayloads = new Map<string, string>();
  for (const entry of snapshot.targetDeviceEntries) {
    localPayloads.set(`target-box:${entry.id}`, encodeSyncPayload("target-box", entry));
  }
  for (const entry of snapshot.enemyDeviceEntries) {
    localPayloads.set(`enemy-box:${entry.id}`, encodeSyncPayload("enemy-box", entry));
  }

  let cloudTargetCount = 0;
  let cloudEnemyCount = 0;
  let sameCount = 0;
  let conflictCount = 0;
  for (const record of records) {
    if (!record.tombstone) {
      if (record.kind === "target-box") cloudTargetCount += 1;
      else cloudEnemyCount += 1;
    }
    const localPayload = localPayloads.get(`${record.kind}:${record.entryId}`);
    if (localPayload === undefined) {
      continue;
    }
    if (!record.tombstone && localPayload === canonicalRemotePayload(record)) {
      sameCount += 1;
    } else {
      conflictCount += 1;
    }
  }

  return {
    deviceTargetCount: snapshot.targetDeviceEntries.length,
    deviceEnemyCount: snapshot.enemyDeviceEntries.length,
    cloudTargetCount,
    cloudEnemyCount,
    sameCount,
    conflictCount,
  };
};

export class LocalStorageMigrationController {
  readonly ownerUid: string;
  readonly migrationState: MigrationStateRepository;
  readonly local: LocalSyncRepository;
  readonly cloud: CloudSyncRepository;

  private readonly legacyStorage?: MigrationRawStorageLike | null;
  private readonly claimStorage: MigrationStateStorageLike;
  private readonly initialSnapshot?: CapturedLegacyMigrationSnapshot;
  private readonly clock: LocalStorageMigrationControllerOptions["now"];
  private lastSnapshot?: CapturedLegacyMigrationSnapshot;
  private lastSummary: LocalStorageMigrationSummary = emptySummary();
  private inspectionInFlight?: Promise<LocalStorageMigrationResult>;

  constructor(options: LocalStorageMigrationControllerOptions) {
    this.ownerUid = options.ownerUid;
    this.migrationState = options.migrationState;
    this.local = options.local;
    this.cloud = options.cloud;
    this.legacyStorage = options.legacyStorage;
    this.claimStorage = options.claimStorage;
    this.initialSnapshot = options.snapshot;
    this.clock = options.now;
  }

  private loadState(): MigrationState {
    const loaded = this.migrationState.load();
    if (loaded.status === "missing") {
      return defaultState(this.ownerUid);
    }
    if (loaded.status === "valid") {
      return loaded.state;
    }
    throw new LocalStorageMigrationError(
      loaded.status === "corrupt" ? "migration-state-corrupt" : "migration-state-unavailable",
      loaded.error.message,
      loaded.status !== "corrupt",
    );
  }

  private saveState(state: MigrationState): MigrationState {
    const saved = this.migrationState.save(state);
    if (saved.status === "valid") {
      return saved.state;
    }
    throw new LocalStorageMigrationError(
      saved.status === "quota"
        ? "migration-state-quota"
        : saved.status === "corrupt"
          ? "migration-state-corrupt"
          : "migration-state-unavailable",
      saved.error.message,
      saved.status !== "corrupt",
    );
  }

  private captureSnapshot(useInitial = false): CapturedLegacyMigrationSnapshot {
    try {
      const snapshot = useInitial && this.initialSnapshot
        ? this.initialSnapshot
        : captureLegacyMigrationSnapshot(this.legacyStorage);
      this.lastSnapshot = snapshot;
      return snapshot;
    } catch (error) {
      if (error instanceof MigrationSnapshotError) {
        throw new LocalStorageMigrationError(
          error.code === "unavailable" ? "legacy-unavailable" : "legacy-corrupt",
          error.message,
          error.code === "unavailable",
        );
      }
      throw new LocalStorageMigrationError("unknown", "移行元の保存データを確認できません");
    }
  }

  private readClaim(): MigrationSourceClaim | null {
    let raw: string | null;
    try {
      raw = this.claimStorage.getItem(MIGRATION_SOURCE_CLAIM_STORAGE_KEY);
    } catch {
      throw new LocalStorageMigrationError("migration-state-unavailable", "移行元アカウント情報を読み込めません");
    }
    return raw === null ? null : parseClaim(raw);
  }

  private canClaimSource(): boolean {
    const claim = this.readClaim();
    return claim === null || claim.ownerUid === this.ownerUid;
  }

  private claimSource(snapshot: CapturedLegacyMigrationSnapshot): void {
    const current = this.readClaim();
    if (current && current.ownerUid !== this.ownerUid) {
      throw new LocalStorageMigrationError(
        "source-claimed",
        "このブラウザの旧保存データは別のアカウントへ移行済みです",
        false,
      );
    }
    const claim: MigrationSourceClaim = {
      schemaVersion: MIGRATION_SOURCE_CLAIM_SCHEMA_VERSION,
      ownerUid: this.ownerUid,
      sourceFingerprint: snapshot.fingerprint,
      claimedAt: resolveNow(this.clock),
    };
    try {
      this.claimStorage.setItem(MIGRATION_SOURCE_CLAIM_STORAGE_KEY, JSON.stringify(claim));
    } catch {
      throw new LocalStorageMigrationError("migration-state-unavailable", "移行元アカウント情報を保存できません");
    }
  }

  private async readCloud(): Promise<SyncReadResult> {
    let result: SyncReadResult;
    try {
      result = await this.cloud.readAll();
    } catch {
      throw new LocalStorageMigrationError("cloud-network", "クラウド保存へ接続できません");
    }
    if (result.status === "error") {
      throw cloudError(result);
    }
    if (result.issues.length > 0) {
      throw issueError(result.issues);
    }
    return result;
  }

  private assertLocalNamespaceCanBeStaged(
    snapshot: CapturedLegacyMigrationSnapshot,
    decision: PlanDecision,
    plannedState: ReturnType<typeof buildMigrationPlan>["state"],
  ): void {
    const loaded = this.local.load();
    if (loaded.status === "missing") {
      return;
    }
    if (loaded.status !== "valid") {
      throw localSaveError(loaded.status);
    }
    const state = loaded.state;
    const hasOwnedData = Object.keys(state.records).length > 0
      || state.outbox.length > 0
      || Object.keys(state.conflicts).length > 0;
    if (!hasOwnedData) {
      return;
    }
    const taggedFingerprint = state.metadata.migrationSourceFingerprint;
    const taggedDecision = state.metadata.migrationDecision;
    const allowedMutationIds = typeof state.metadata.migrationMutationIds === "string"
      ? new Set(state.metadata.migrationMutationIds.split(",").filter(Boolean))
      : new Set<string>();
    const hasOnlyMigrationOutbox = state.outbox.every((mutation) => (
      allowedMutationIds.has(mutation.mutationId)
    ));
    const plannedKeys = new Set(Object.keys(plannedState.records));
    const hasOnlyPlannedRecords = Object.keys(state.records).every((key) => plannedKeys.has(key));
    const hasNoConflicts = Object.keys(state.conflicts).length === 0;

    if (
      taggedFingerprint === snapshot.fingerprint
      && taggedDecision === decision
      && hasOnlyMigrationOutbox
      && hasOnlyPlannedRecords
      && hasNoConflicts
    ) {
      return;
    }
    if (
      typeof taggedFingerprint === "string"
      && state.outbox.length === 0
      && hasOnlyPlannedRecords
      && hasNoConflicts
    ) {
      // A previous migration reached a fully acknowledged local snapshot but
      // the legacy source changed before its completed marker. Replanning from
      // the freshly-read cloud is safe; no unsent mutation is discarded.
      return;
    }
    throw new LocalStorageMigrationError(
      "local-existing-data",
      "このアカウントのブラウザ同期領域に未処理データがあります。上書きせず確認を待ちます",
      false,
    );
  }

  private result(
    state: MigrationState,
    options: {
      requiresDecision?: boolean;
      canUseDevice?: boolean;
      error?: LocalStorageMigrationError;
      planSummary?: MigrationPlanSummary;
    } = {},
  ): LocalStorageMigrationResult {
    return {
      status: state.status,
      state,
      summary: this.lastSummary,
      requiresDecision: options.requiresDecision ?? false,
      canUseDevice: options.canUseDevice ?? true,
      error: options.error,
      planSummary: options.planSummary,
    };
  }

  private errorResult(
    error: LocalStorageMigrationError,
    fallback?: MigrationState,
  ): LocalStorageMigrationResult {
    const base = fallback ?? defaultState(this.ownerUid);
    return this.result(base, { error, canUseDevice: error.code !== "source-claimed" });
  }

  inspect(): Promise<LocalStorageMigrationResult> {
    if (this.inspectionInFlight) {
      return this.inspectionInFlight;
    }
    const running = withMigrationLock(() => this.runInspect());
    this.inspectionInFlight = running;
    const clear = () => {
      if (this.inspectionInFlight === running) {
        this.inspectionInFlight = undefined;
      }
    };
    void running.then(clear, clear);
    return running;
  }

  private async runInspect(): Promise<LocalStorageMigrationResult> {
    let state: MigrationState;
    try {
      state = this.loadState();
    } catch (error) {
      return this.errorResult(error as LocalStorageMigrationError);
    }
    if (state.status === "completed") {
      return this.result(state);
    }

    let snapshot: CapturedLegacyMigrationSnapshot;
    try {
      snapshot = this.captureSnapshot(state.status === "not-started");
    } catch (error) {
      return this.errorResult(error as LocalStorageMigrationError, state);
    }

    if (state.sourceFingerprint && state.sourceFingerprint !== snapshot.fingerprint) {
      const changed = new LocalStorageMigrationError(
        "source-changed",
        "移行の確認中にこのブラウザの保存データが変更されました。内容を確認し直してください",
      );
      try {
        state = this.saveState({
          ...state,
          status: "needs-review",
          updatedAt: resolveNow(this.clock),
          sourceFingerprint: snapshot.fingerprint,
          reviewReason: changed.code,
          decision: undefined,
        });
      } catch (saveError) {
        return this.errorResult(saveError as LocalStorageMigrationError, state);
      }
      return this.result(state, { requiresDecision: false, error: changed });
    }

    const pendingDecision = state.status === "in-progress"
      ? stateDecisionToPlan(state.decision)
      : null;
    if (pendingDecision) {
      return this.applyDecision(pendingDecision, snapshot, state);
    }

    let remote: SyncReadResult;
    try {
      remote = await this.readCloud();
    } catch (error) {
      const migrationError = error as LocalStorageMigrationError;
      try {
        state = this.saveState({
          ...state,
          status: "in-progress",
          updatedAt: resolveNow(this.clock),
          sourceFingerprint: snapshot.fingerprint,
          reviewReason: migrationError.code,
        });
      } catch (saveError) {
        return this.errorResult(saveError as LocalStorageMigrationError, state);
      }
      return this.result(state, { error: migrationError });
    }

    this.lastSummary = summarize(snapshot, remote.records);
    const hasDevice = snapshot.targetDeviceEntries.length > 0
      || snapshot.enemyDeviceEntries.length > 0
      || snapshot.deletedDefaultIntent;
    const hasCloud = remote.records.length > 0;
    let canUseDevice: boolean;
    try {
      canUseDevice = this.canClaimSource();
    } catch (error) {
      return this.errorResult(error as LocalStorageMigrationError, state);
    }

    if (hasDevice && hasCloud) {
      state = this.saveState({
        ...state,
        status: "needs-review",
        updatedAt: resolveNow(this.clock),
        sourceFingerprint: snapshot.fingerprint,
        reviewReason: canUseDevice ? "both-sides-have-data" : "source-claimed",
        decision: undefined,
      });
      return this.result(state, { requiresDecision: true, canUseDevice });
    }
    if (hasDevice) {
      if (!canUseDevice) {
        const claimed = new LocalStorageMigrationError(
          "source-claimed",
          "このブラウザの旧保存データは別のアカウントへ移行済みです",
          false,
        );
        state = this.saveState({
          ...state,
          status: "needs-review",
          updatedAt: resolveNow(this.clock),
          sourceFingerprint: snapshot.fingerprint,
          reviewReason: claimed.code,
          decision: undefined,
        });
        return this.result(state, { requiresDecision: true, canUseDevice: false, error: claimed });
      }
      return this.applyDecision("device", snapshot, state);
    }
    return this.applyDecision("cloud", snapshot, state);
  }

  decide(decision: LocalStorageMigrationDecision): Promise<LocalStorageMigrationResult> {
    return withMigrationLock(() => this.runDecision(decision));
  }

  private async runDecision(
    decision: LocalStorageMigrationDecision,
  ): Promise<LocalStorageMigrationResult> {
    let state: MigrationState;
    try {
      state = this.loadState();
    } catch (error) {
      return this.errorResult(error as LocalStorageMigrationError);
    }
    if (state.status === "completed") {
      return this.result(state);
    }
    let snapshot: CapturedLegacyMigrationSnapshot;
    try {
      snapshot = this.captureSnapshot(false);
    } catch (error) {
      return this.errorResult(error as LocalStorageMigrationError, state);
    }
    if (state.sourceFingerprint && state.sourceFingerprint !== snapshot.fingerprint) {
      const changed = new LocalStorageMigrationError(
        "source-changed",
        "統合方法を選ぶ前にこのブラウザの保存データが変更されました。内容を確認し直してください",
      );
      try {
        state = this.saveState({
          ...state,
          status: "needs-review",
          updatedAt: resolveNow(this.clock),
          sourceFingerprint: snapshot.fingerprint,
          reviewReason: changed.code,
          decision: undefined,
        });
      } catch (error) {
        return this.errorResult(error as LocalStorageMigrationError, state);
      }
      return this.result(state, { error: changed });
    }
    if (decision === "later") {
      try {
        state = this.saveState({
          ...state,
          status: "needs-review",
          updatedAt: resolveNow(this.clock),
          sourceFingerprint: snapshot.fingerprint,
          reviewReason: "deferred",
          decision: "defer",
        });
      } catch (error) {
        return this.errorResult(error as LocalStorageMigrationError, state);
      }
      let canUseDevice = false;
      try {
        canUseDevice = this.canClaimSource();
      } catch (error) {
        return this.errorResult(error as LocalStorageMigrationError, state);
      }
      return this.result(state, { requiresDecision: true, canUseDevice });
    }
    return this.applyDecision(decision, snapshot, state);
  }

  async retry(): Promise<LocalStorageMigrationResult> {
    return this.inspect();
  }

  /**
   * Resume an interrupted migration from its persisted marker. The marker is
   * the source of truth, so a new controller instance (or an account UI retry)
   * can safely call this after a network/quota failure without replaying a
   * completed migration or deleting the legacy source.
   */
  async resume(): Promise<LocalStorageMigrationResult> {
    return this.inspect();
  }

  private async applyDecision(
    decision: PlanDecision,
    snapshot: CapturedLegacyMigrationSnapshot,
    previousState: MigrationState,
  ): Promise<LocalStorageMigrationResult> {
    let state = previousState;
    const startedAt = state.startedAt ?? resolveNow(this.clock);
    try {
      state = this.saveState({
        ...state,
        status: "in-progress",
        startedAt,
        updatedAt: resolveNow(this.clock),
        sourceFingerprint: snapshot.fingerprint,
        decision: planDecisionToState(decision),
        reviewReason: undefined,
      });

      const currentSnapshot = captureLegacyMigrationSnapshot(this.legacyStorage);
      if (currentSnapshot.fingerprint !== snapshot.fingerprint) {
        const changed = new LocalStorageMigrationError(
          "source-changed",
          "移行の開始後にこのブラウザの保存データが変更されました",
        );
        state = this.saveState({
          ...state,
          status: "needs-review",
          updatedAt: resolveNow(this.clock),
          sourceFingerprint: currentSnapshot.fingerprint,
          reviewReason: changed.code,
          decision: undefined,
        });
        return this.result(state, { error: changed });
      }

      // Always refresh after the decision. The inspection read is only for
      // presentation; it must not become the write base if cloud changed
      // while the user was choosing an option.
      const remote = await this.readCloud();
      if (decision !== "cloud") {
        this.claimSource(currentSnapshot);
      }
      this.lastSummary = summarize(currentSnapshot, remote.records);
      const plan = buildMigrationPlan({
        decision,
        ownerUid: this.ownerUid,
        snapshot: currentSnapshot,
        remote: remote.records,
      });
      this.assertLocalNamespaceCanBeStaged(currentSnapshot, decision, plan.state);
      const plannedState = {
        ...plan.state,
        metadata: {
          ...plan.state.metadata,
          migrationSourceFingerprint: currentSnapshot.fingerprint,
          migrationDecision: decision,
          migrationMutationIds: plan.state.outbox
            .map((mutation) => mutation.mutationId)
            .sort()
            .join(","),
        },
      };
      const savedLocal = this.local.save(plannedState);
      if (savedLocal.status !== "valid") {
        throw localSaveError(savedLocal.status);
      }

      // Even a cloud-only or fully deduplicated plan gets one coordinator
      // pull. This closes the decision/read race before the completed marker
      // is committed, while still producing no writes when the outbox is empty.
      const synchronized = await createSyncCoordinator({
        local: this.local,
        cloud: this.cloud,
        now: this.clock,
      }).synchronize("manual");
      const finalState = synchronized.state;
      if (synchronized.status === "error") {
        throw new LocalStorageMigrationError(
          synchronized.error.code === "permission-denied"
            ? "cloud-permission"
            : synchronized.error.code === "quota"
              ? "cloud-quota"
              : synchronized.error.code === "network"
                ? "cloud-network"
                : "sync-incomplete",
          synchronized.error.message,
        );
      }
      if (synchronized.issues.length > 0) {
        throw issueError(synchronized.issues);
      }
      if (finalState.outbox.length > 0) {
        throw new LocalStorageMigrationError("sync-incomplete", "未送信の移行データが残っています");
      }
      if (Object.keys(finalState.conflicts).length > 0) {
        throw new LocalStorageMigrationError("sync-conflict", "移行データに競合が見つかりました", false);
      }

      const completedSource = captureLegacyMigrationSnapshot(this.legacyStorage);
      if (completedSource.fingerprint !== currentSnapshot.fingerprint) {
        const changed = new LocalStorageMigrationError(
          "source-changed",
          "移行中にこのブラウザの保存データが変更されました。クラウド反映済みの内容を保持して確認し直します",
        );
        state = this.saveState({
          ...state,
          status: "needs-review",
          updatedAt: resolveNow(this.clock),
          sourceFingerprint: completedSource.fingerprint,
          reviewReason: changed.code,
          decision: undefined,
        });
        return this.result(state, { error: changed, planSummary: plan.summary });
      }

      state = this.saveState({
        ...state,
        status: "completed",
        completedAt: resolveNow(this.clock),
        updatedAt: resolveNow(this.clock),
        reviewReason: undefined,
      });
      return this.result(state, { planSummary: plan.summary });
    } catch (error) {
      const migrationError = error instanceof LocalStorageMigrationError
        ? error
        : error instanceof MigrationSnapshotError
          ? new LocalStorageMigrationError(
              error.code === "unavailable" ? "legacy-unavailable" : "legacy-corrupt",
              error.message,
            )
          : new LocalStorageMigrationError("unknown", "保存データの移行を完了できませんでした");
      return this.result(state, { error: migrationError });
    }
  }
}

export const createLocalStorageMigrationController = (
  options: LocalStorageMigrationControllerOptions,
): LocalStorageMigrationController => new LocalStorageMigrationController(options);

const resolveBrowserStorage = (
  supplied?: MigrationStateStorageLike | null,
): MigrationStateStorageLike | null => {
  if (supplied !== undefined) return supplied;
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) return null;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export const createBrowserLocalStorageMigrationController = (
  ownerUid: string,
  options: BrowserLocalStorageMigrationOptions = {},
): LocalStorageMigrationController => {
  const storage = resolveBrowserStorage(options.storage);
  const client = options.client ?? getFirebaseClient();
  if (client.status !== "ready") {
    throw new LocalStorageMigrationError(
      "firebase-unavailable",
      "Firebase同期を利用できません",
    );
  }
  if (!storage) {
    throw new LocalStorageMigrationError(
      "legacy-unavailable",
      "ブラウザの保存機能を利用できないため移行を開始できません",
    );
  }
  return createLocalStorageMigrationController({
    ownerUid,
    migrationState: createMigrationStateRepository(ownerUid, { storage }),
    local: createLocalSyncRepository(ownerUid, { storage }),
    cloud: createFirestoreSyncRepository({ client, uid: ownerUid }),
    legacyStorage: storage,
    claimStorage: storage,
    snapshot: options.snapshot,
    now: options.now,
  });
};
