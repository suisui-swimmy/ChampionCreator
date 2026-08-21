import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  makeAccountDraftStorageKey,
  type DraftStorageDocument,
} from "../ui/draftStorage";
import type { AuthSessionState } from "./authSession";
import { useAuthSession } from "./authSessionContext";
import {
  createCloudDraftCoordinator,
  createCloudDraftSnapshot,
  type CloudDraftCoordinator,
  type CloudDraftSnapshot,
  type CloudDraftSyncTrigger,
} from "./cloudDraftCoordinator";
import { createCloudDraftLocalRepository } from "./cloudDraftLocalRepository";
import { loadOrCreateDeviceIdentity, type DeviceIdentity } from "./deviceIdentity";
import { getFirebaseClient } from "./firebaseClient";
import { createFirestoreCloudDraftRepository } from "./firestoreCloudDraftRepository";
import {
  createEmptyCloudDraftLocalState,
} from "./cloudDraftTypes";
import {
  useSyncMigrationReadiness,
  type SyncMigrationReadiness,
} from "./SyncMigrationGate";

export type CloudDraftRuntimeStatus =
  | "idle"
  | "queued"
  | "syncing"
  | "synced"
  | "offline"
  | "error";

/**
 * Keep the user-facing wording for the cloud-draft lifecycle in one place.
 * `queued` intentionally means the local outbox has the latest draft while
 * the remote write is waiting for its debounce window; it is not an error.
 */
export const CLOUD_DRAFT_STATUS_LABELS: Readonly<Record<CloudDraftRuntimeStatus, string>> = {
  idle: "この端末のみ",
  queued: "未同期",
  syncing: "同期中…",
  synced: "同期済み",
  offline: "オフライン",
  error: "同期エラー",
};

export const getCloudDraftStatusLabel = (
  status: CloudDraftRuntimeStatus,
): string => CLOUD_DRAFT_STATUS_LABELS[status];

export interface CloudDraftContextValue {
  readonly mode: "account";
  readonly ownerUid: string;
  readonly deviceId: string | null;
  readonly deviceLabel: string | null;
  readonly sourceKey: string;
  readonly localDraftStorageKey: string | null;
  readonly snapshot: CloudDraftSnapshot;
  readonly isAvailable: boolean;
  readonly status: CloudDraftRuntimeStatus;
  readonly lastError: string | null;
  readonly issueCount: number;
  readonly queueCurrentDraft: (draft: DraftStorageDocument) => string | null;
  readonly deleteDraft: (deviceId: string) => string | null;
  readonly synchronize: (trigger?: CloudDraftSyncTrigger) => Promise<void>;
}

export interface CloudDraftRuntime {
  readonly ownerUid: string;
  readonly identity: DeviceIdentity;
  readonly coordinator: CloudDraftCoordinator;
}

export type CloudDraftRuntimeFactory = (ownerUid: string) => CloudDraftRuntime;

export interface CloudDraftProviderProps {
  readonly children: ReactNode;
  readonly runtimeFactory?: CloudDraftRuntimeFactory;
}

const CloudDraftContext = createContext<CloudDraftContextValue | null>(null);
const defaultRuntimeCache = new Map<string, CloudDraftRuntime>();

const createDefaultRuntime: CloudDraftRuntimeFactory = (ownerUid) => {
  const cached = defaultRuntimeCache.get(ownerUid);
  if (cached) return cached;
  const identityResult = loadOrCreateDeviceIdentity();
  if (identityResult.status !== "success") {
    throw new Error(identityResult.message);
  }
  const client = getFirebaseClient();
  if (client.status !== "ready") {
    throw new Error("クラウド下書きを利用できません");
  }
  const coordinator = createCloudDraftCoordinator({
    local: createCloudDraftLocalRepository(ownerUid, identityResult.identity.deviceId),
    cloud: createFirestoreCloudDraftRepository({ client, uid: ownerUid }),
    deviceLabel: identityResult.identity.deviceLabel,
  });
  const runtime = { ownerUid, identity: identityResult.identity, coordinator };
  defaultRuntimeCache.set(ownerUid, runtime);
  return runtime;
};

export const getCloudDraftOwnerUid = (
  authState: AuthSessionState,
  migration: SyncMigrationReadiness,
): string | null => {
  const ownerUid = authState.user?.uid ?? null;
  return migration.status === "ready"
    && ownerUid !== null
    && migration.ownerUid === ownerUid
    ? ownerUid
    : null;
};

const emptySnapshot = (ownerUid: string, deviceId = "unavailable"): CloudDraftSnapshot => (
  createCloudDraftSnapshot(createEmptyCloudDraftLocalState(ownerUid, deviceId))
);

interface ActiveRuntime {
  readonly ownerUid: string;
  readonly sourceKey: string;
  readonly runtime: CloudDraftRuntime | null;
  readonly snapshot: CloudDraftSnapshot;
  readonly errorMessage: string | null;
}

interface ProviderState {
  readonly sourceKey: string;
  readonly snapshot: CloudDraftSnapshot;
  readonly isAvailable: boolean;
  readonly status: CloudDraftRuntimeStatus;
  readonly lastError: string | null;
  readonly issueCount: number;
}

const stableErrorMessage = (error: unknown): string => (
  error instanceof Error && error.message
    ? error.message
    : "クラウド下書きを利用できません"
);

const isOffline = (): boolean => (
  typeof navigator !== "undefined" && navigator.onLine === false
);

export function CloudDraftProvider({
  children,
  runtimeFactory = createDefaultRuntime,
}: CloudDraftProviderProps) {
  const { state: authState } = useAuthSession();
  const migration = useSyncMigrationReadiness();
  const operationRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const synchronizeRef = useRef<(trigger?: CloudDraftSyncTrigger) => Promise<void>>(async () => {});

  const active = useMemo<ActiveRuntime | null>(() => {
    const ownerUid = getCloudDraftOwnerUid(authState, migration);
    if (!ownerUid) return null;
    try {
      const runtime = runtimeFactory(ownerUid);
      const loaded = runtime.coordinator.loadSnapshot();
      const sourceKey = `account:${ownerUid}:draft:${runtime.identity.deviceId}`;
      if (loaded.status === "error") {
        return {
          ownerUid,
          sourceKey,
          runtime,
          snapshot: loaded.snapshot ?? emptySnapshot(ownerUid, runtime.identity.deviceId),
          errorMessage: loaded.error.message,
        };
      }
      return {
        ownerUid,
        sourceKey,
        runtime,
        snapshot: loaded.snapshot,
        errorMessage: null,
      };
    } catch (error) {
      return {
        ownerUid,
        sourceKey: `account:${ownerUid}:draft:unavailable`,
        runtime: null,
        snapshot: emptySnapshot(ownerUid),
        errorMessage: stableErrorMessage(error),
      };
    }
  }, [authState.user?.uid, migration.ownerUid, migration.status, runtimeFactory]);

  const [providerState, setProviderState] = useState<ProviderState | null>(null);
  const currentState: ProviderState | null = active
    ? providerState?.sourceKey === active.sourceKey
      ? providerState
      : {
          sourceKey: active.sourceKey,
          snapshot: active.snapshot,
          isAvailable: active.runtime !== null && active.errorMessage === null,
          status: active.errorMessage ? "error" : active.snapshot.outboxCount > 0 ? "queued" : "idle",
          lastError: active.errorMessage,
          issueCount: 0,
        }
    : null;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleSnapshot = useCallback((snapshot: CloudDraftSnapshot) => {
    clearTimer();
    if (!snapshot.nextEligibleAt || snapshot.outboxCount === 0) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const delay = Math.max(0, Date.parse(snapshot.nextEligibleAt) - Date.now());
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = null;
      void synchronizeRef.current("timer");
    }, delay);
  }, [clearTimer]);

  const synchronize = useCallback(async (trigger: CloudDraftSyncTrigger = "manual") => {
    if (!active?.runtime) return;
    if (isOffline()) {
      clearTimer();
      setProviderState((current) => ({
        sourceKey: active.sourceKey,
        snapshot: current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot,
        isAvailable: true,
        status: "offline",
        lastError: "オフラインのため、クラウド下書きはあとで再送します",
        issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
      }));
      return;
    }
    clearTimer();
    const operation = ++operationRef.current;
    setProviderState((current) => ({
      sourceKey: active.sourceKey,
      snapshot: current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot,
      isAvailable: true,
      status: "syncing",
      lastError: null,
      issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
    }));
    try {
      const result = await active.runtime.coordinator.synchronize(trigger);
      if (operation !== operationRef.current) return;
      const snapshot = result.snapshot ?? active.snapshot;
      const issueMessage = result.issues.length > 0
        ? "一部のクラウド下書きを読み込めませんでした。正常な下書きは保持しています"
        : null;
      const errorMessage = result.status === "error" ? result.error.message : issueMessage;
      const status: CloudDraftRuntimeStatus = result.status === "error"
        ? isOffline() ? "offline" : "error"
        : snapshot.outboxCount > 0 ? "queued" : "synced";
      setProviderState({
        sourceKey: active.sourceKey,
        snapshot,
        isAvailable: true,
        status,
        lastError: errorMessage,
        issueCount: result.issues.length,
      });
      if (status === "queued") scheduleSnapshot(snapshot);
    } catch (error) {
      if (operation !== operationRef.current) return;
      setProviderState((current) => ({
        sourceKey: active.sourceKey,
        snapshot: current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot,
        isAvailable: true,
        status: isOffline() ? "offline" : "error",
        lastError: stableErrorMessage(error),
        issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
      }));
    }
  }, [active, clearTimer, scheduleSnapshot]);
  synchronizeRef.current = synchronize;

  useEffect(() => {
    operationRef.current += 1;
    clearTimer();
    if (!active) {
      setProviderState(null);
      return undefined;
    }
    setProviderState({
      sourceKey: active.sourceKey,
      snapshot: active.snapshot,
      isAvailable: active.runtime !== null && active.errorMessage === null,
      status: active.errorMessage ? "error" : active.snapshot.outboxCount > 0 ? "queued" : "idle",
      lastError: active.errorMessage,
      issueCount: 0,
    });
    if (!active.runtime || active.errorMessage) return undefined;
    void synchronize("launch");

    const handleFocus = () => void synchronize("focus");
    const handleOnline = () => void synchronize("online");
    const handleOffline = () => {
      clearTimer();
      setProviderState((current) => current?.sourceKey === active.sourceKey
        ? {
            ...current,
            status: "offline",
            lastError: "オフラインのため、クラウド下書きはあとで再送します",
          }
        : current);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        setProviderState((current) => current?.sourceKey === active.sourceKey
          && current.snapshot.outboxCount > 0
          ? { ...current, status: isOffline() ? "offline" : "queued" }
          : current);
      } else {
        void synchronize("focus");
      }
    };
    const handlePageHide = () => {
      clearTimer();
      setProviderState((current) => current?.sourceKey === active.sourceKey
        && current.snapshot.outboxCount > 0
        ? { ...current, status: isOffline() ? "offline" : "queued" }
        : current);
    };
    globalThis.addEventListener?.("focus", handleFocus);
    globalThis.addEventListener?.("online", handleOnline);
    globalThis.addEventListener?.("offline", handleOffline);
    globalThis.addEventListener?.("pagehide", handlePageHide);
    document?.addEventListener?.("visibilitychange", handleVisibilityChange);
    return () => {
      operationRef.current += 1;
      clearTimer();
      globalThis.removeEventListener?.("focus", handleFocus);
      globalThis.removeEventListener?.("online", handleOnline);
      globalThis.removeEventListener?.("offline", handleOffline);
      globalThis.removeEventListener?.("pagehide", handlePageHide);
      document?.removeEventListener?.("visibilitychange", handleVisibilityChange);
    };
  }, [active, clearTimer, synchronize]);

  const applyLocalMutation = useCallback((
    mutate: (coordinator: CloudDraftCoordinator) => ReturnType<CloudDraftCoordinator["queueDelete"]>,
  ): string | null => {
    if (!active?.runtime || !currentState?.isAvailable) {
      return currentState?.lastError ?? active?.errorMessage ?? "クラウド下書きを利用できません";
    }
    const result = mutate(active.runtime.coordinator);
    if (result.status === "error") {
      setProviderState((current) => ({
        sourceKey: active.sourceKey,
        snapshot: result.snapshot
          ?? (current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot),
        isAvailable: result.error.kind !== "corrupt" && result.error.kind !== "unavailable",
        status: "error",
        lastError: result.error.message,
        issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
      }));
      return result.error.message;
    }
    const status: CloudDraftRuntimeStatus = isOffline() ? "offline" : "queued";
    setProviderState((current) => ({
      sourceKey: active.sourceKey,
      snapshot: result.snapshot,
      isAvailable: true,
      status,
      lastError: status === "offline" ? "オフラインのため、クラウド下書きはあとで再送します" : null,
      issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
    }));
    if (status === "queued") scheduleSnapshot(result.snapshot);
    return null;
  }, [active, currentState, scheduleSnapshot]);

  const queueCurrentDraft = useCallback((draft: DraftStorageDocument): string | null => (
    applyLocalMutation((coordinator) => coordinator.queueCurrentDraft(draft))
  ), [applyLocalMutation]);

  const deleteDraft = useCallback((deviceId: string): string | null => (
    applyLocalMutation((coordinator) => coordinator.queueDelete(deviceId))
  ), [applyLocalMutation]);

  const value = useMemo<CloudDraftContextValue | null>(() => {
    if (!active || !currentState) return null;
    const identity = active.runtime?.identity ?? null;
    return {
      mode: "account",
      ownerUid: active.ownerUid,
      deviceId: identity?.deviceId ?? null,
      deviceLabel: identity?.deviceLabel ?? null,
      sourceKey: active.sourceKey,
      localDraftStorageKey: identity
        ? makeAccountDraftStorageKey(active.ownerUid, identity.deviceId)
        : null,
      snapshot: currentState.snapshot,
      isAvailable: currentState.isAvailable,
      status: currentState.status,
      lastError: currentState.lastError,
      issueCount: currentState.issueCount,
      queueCurrentDraft,
      deleteDraft,
      synchronize,
    };
  }, [active, currentState, deleteDraft, queueCurrentDraft, synchronize]);

  return <CloudDraftContext.Provider value={value}>{children}</CloudDraftContext.Provider>;
}

export function useOptionalCloudDraft(): CloudDraftContextValue | null {
  return useContext(CloudDraftContext);
}

export function resetCloudDraftRuntimeCacheForTests(): void {
  defaultRuntimeCache.clear();
}
