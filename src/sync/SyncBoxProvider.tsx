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
import type { BoxEntry } from "../ui/boxStorage";
import type { EnemyBoxEntry } from "../ui/enemyBoxStorage";
import { useAuthSession } from "./authSessionContext";
import type { AuthSessionState } from "./authSession";
import { getFirebaseClient } from "./firebaseClient";
import { createFirestoreSyncRepository } from "./firestoreSyncRepository";
import { createLocalSyncRepository } from "./localSyncRepository";
import {
  createSyncBoxRepository,
  type SyncBoxRepository,
  type SyncBoxSnapshot,
} from "./syncBoxRepository";
import type { SyncTrigger } from "./syncCoordinator";
import {
  useSyncMigrationReadiness,
  type SyncMigrationReadiness,
} from "./SyncMigrationGate";

export interface SyncBoxContextValue {
  readonly mode: "account";
  readonly ownerUid: string;
  readonly sourceKey: string;
  readonly snapshot: SyncBoxSnapshot;
  readonly isAvailable: boolean;
  readonly isSynchronizing: boolean;
  readonly lastSyncError: string | null;
  readonly issueCount: number;
  readonly saveTargetEntries: (
    entries: readonly BoxEntry[],
    baseEntries: readonly BoxEntry[],
  ) => string | null;
  readonly saveEnemyEntries: (
    entries: readonly EnemyBoxEntry[],
    baseEntries: readonly EnemyBoxEntry[],
  ) => string | null;
  readonly synchronize: (trigger?: SyncTrigger) => Promise<void>;
}

export type SyncBoxRepositoryFactory = (ownerUid: string) => SyncBoxRepository;

export interface SyncBoxProviderProps {
  readonly children: ReactNode;
  readonly repositoryFactory?: SyncBoxRepositoryFactory;
}

const SyncBoxContext = createContext<SyncBoxContextValue | null>(null);

const emptySnapshot = (): SyncBoxSnapshot => ({
  targetEntries: [],
  enemyEntries: [],
  outboxCount: 0,
  conflictCount: 0,
  targetConflictCount: 0,
  enemyConflictCount: 0,
});

const defaultRepositoryCache = new Map<string, SyncBoxRepository>();

const createDefaultRepository: SyncBoxRepositoryFactory = (ownerUid) => {
  const cached = defaultRepositoryCache.get(ownerUid);
  if (cached) return cached;

  const client = getFirebaseClient();
  if (client.status !== "ready") {
    throw new Error("アカウントのボックス同期を利用できません");
  }
  const repository = createSyncBoxRepository({
    local: createLocalSyncRepository(ownerUid),
    cloud: createFirestoreSyncRepository({ client, uid: ownerUid }),
  });
  defaultRepositoryCache.set(ownerUid, repository);
  return repository;
};

interface ActiveRepository {
  readonly ownerUid: string;
  readonly sourceKey: string;
  readonly repository: SyncBoxRepository | null;
  readonly snapshot: SyncBoxSnapshot;
  readonly isAvailable: boolean;
  readonly errorMessage: string | null;
}

interface ProviderState {
  readonly sourceKey: string;
  readonly snapshot: SyncBoxSnapshot;
  readonly isAvailable: boolean;
  readonly isSynchronizing: boolean;
  readonly lastSyncError: string | null;
  readonly issueCount: number;
}

const toStableErrorMessage = (error: unknown): string => (
  error instanceof Error && error.message
    ? error.message
    : "アカウントのボックス同期を利用できません"
);

const sameEntries = (
  left: readonly BoxEntry[] | readonly EnemyBoxEntry[],
  right: readonly BoxEntry[] | readonly EnemyBoxEntry[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const isSyncBoxEntryBaseCurrent = (
  kind: "target" | "enemy",
  baseEntries: readonly BoxEntry[] | readonly EnemyBoxEntry[],
  latest: SyncBoxSnapshot,
): boolean => kind === "target"
  ? sameEntries(baseEntries, latest.targetEntries)
  : sameEntries(baseEntries, latest.enemyEntries);

const STALE_BOX_MESSAGE = "別の端末から保存一覧が更新されました。内容を確認してもう一度操作してください";

export const getSyncBoxOwnerUid = (
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

/**
 * M4 runtime owner. It activates only after M3 reports a completed migration,
 * so normal pull/push work can never race the one-time migration controller.
 * Signed-out, deferred, review, and failed migration states keep using the
 * existing guest/localStorage path owned by App.
 */
export function SyncBoxProvider({
  children,
  repositoryFactory = createDefaultRepository,
}: SyncBoxProviderProps) {
  const { state: authState } = useAuthSession();
  const migration = useSyncMigrationReadiness();
  const operationRef = useRef(0);

  const active = useMemo<ActiveRepository | null>(() => {
    const ownerUid = getSyncBoxOwnerUid(authState, migration);
    if (!ownerUid) return null;

    const sourceKey = `account:${ownerUid}`;
    try {
      const repository = repositoryFactory(ownerUid);
      const loaded = repository.loadSnapshot();
      if (loaded.status === "error") {
        return {
          ownerUid,
          sourceKey,
          repository,
          snapshot: loaded.snapshot ?? emptySnapshot(),
          isAvailable: loaded.snapshot !== undefined,
          errorMessage: loaded.error.message,
        };
      }
      return {
        ownerUid,
        sourceKey,
        repository,
        snapshot: loaded.snapshot,
        isAvailable: true,
        errorMessage: null,
      };
    } catch (error) {
      return {
        ownerUid,
        sourceKey,
        repository: null,
        snapshot: emptySnapshot(),
        isAvailable: false,
        errorMessage: toStableErrorMessage(error),
      };
    }
  }, [authState.user?.uid, migration.ownerUid, migration.status, repositoryFactory]);

  const [providerState, setProviderState] = useState<ProviderState | null>(null);
  const currentState = active
    ? providerState?.sourceKey === active.sourceKey
      ? providerState
      : {
          sourceKey: active.sourceKey,
          snapshot: active.snapshot,
          isAvailable: active.isAvailable,
          isSynchronizing: false,
          lastSyncError: active.errorMessage,
          issueCount: 0,
        }
    : null;

  const synchronize = useCallback(async (trigger: SyncTrigger = "manual") => {
    if (!active?.repository) return;
    const operation = ++operationRef.current;
    setProviderState((current) => ({
      sourceKey: active.sourceKey,
      snapshot: current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot,
      isAvailable: current?.sourceKey === active.sourceKey
        ? current.isAvailable
        : active.isAvailable,
      isSynchronizing: true,
      lastSyncError: current?.sourceKey === active.sourceKey
        ? current.lastSyncError
        : active.errorMessage,
      issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
    }));

    try {
      const result = await active.repository.synchronize(trigger);
      if (operation !== operationRef.current) return;
      const issueMessage = result.issues.length > 0
        ? "一部のクラウド保存を読み込めませんでした。元データは保持しています"
        : null;
      setProviderState((current) => {
        const previous = current?.sourceKey === active.sourceKey
          ? current
          : {
              sourceKey: active.sourceKey,
              snapshot: active.snapshot,
              isAvailable: active.isAvailable,
              isSynchronizing: false,
              lastSyncError: active.errorMessage,
              issueCount: 0,
            };
        return {
          sourceKey: active.sourceKey,
          snapshot: result.snapshot ?? previous.snapshot,
          isAvailable: result.status === "success" ? true : previous.isAvailable,
          isSynchronizing: false,
          lastSyncError: result.status === "error" ? result.error.message : issueMessage,
          issueCount: result.issues.length,
        };
      });
    } catch (error) {
      if (operation !== operationRef.current) return;
      setProviderState((current) => ({
        sourceKey: active.sourceKey,
        snapshot: current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot,
        isAvailable: current?.sourceKey === active.sourceKey
          ? current.isAvailable
          : active.isAvailable,
        isSynchronizing: false,
        lastSyncError: toStableErrorMessage(error),
        issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
      }));
    }
  }, [active]);

  useEffect(() => {
    operationRef.current += 1;
    if (!active) {
      setProviderState(null);
      return undefined;
    }

    setProviderState({
      sourceKey: active.sourceKey,
      snapshot: active.snapshot,
      isAvailable: active.isAvailable,
      isSynchronizing: false,
      lastSyncError: active.errorMessage,
      issueCount: 0,
    });
    if (active.repository && active.isAvailable) {
      void synchronize("launch");
    }

    const handleFocus = () => void synchronize("focus");
    const handleOnline = () => void synchronize("online");
    if (active.isAvailable) {
      globalThis.addEventListener?.("focus", handleFocus);
      globalThis.addEventListener?.("online", handleOnline);
    }
    return () => {
      operationRef.current += 1;
      globalThis.removeEventListener?.("focus", handleFocus);
      globalThis.removeEventListener?.("online", handleOnline);
    };
  }, [active, synchronize]);

  const saveTargetEntries = useCallback((
    entries: readonly BoxEntry[],
    baseEntries: readonly BoxEntry[],
  ): string | null => {
    if (!active?.repository || !currentState?.isAvailable) {
      return currentState?.lastSyncError
        ?? active?.errorMessage
        ?? "アカウントのボックス保存を利用できません";
    }
    const latest = active.repository.loadSnapshot();
    if (latest.status === "error") {
      setProviderState((current) => ({
        sourceKey: active.sourceKey,
        snapshot: current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot,
        isAvailable: false,
        isSynchronizing: false,
        lastSyncError: latest.error.message,
        issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
      }));
      return latest.error.message;
    }
    if (!isSyncBoxEntryBaseCurrent("target", baseEntries, latest.snapshot)) {
      setProviderState({
        sourceKey: active.sourceKey,
        snapshot: latest.snapshot,
        isAvailable: true,
        isSynchronizing: false,
        lastSyncError: null,
        issueCount: 0,
      });
      return STALE_BOX_MESSAGE;
    }
    const result = active.repository.saveTargetEntries(entries);
    if (result.status === "error") return result.error.message;
    setProviderState((current) => ({
      sourceKey: active.sourceKey,
      snapshot: result.snapshot,
      isAvailable: true,
      isSynchronizing: current?.sourceKey === active.sourceKey && current.isSynchronizing,
      lastSyncError: current?.sourceKey === active.sourceKey ? current.lastSyncError : null,
      issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
    }));
    void synchronize("manual");
    return null;
  }, [active, currentState, synchronize]);

  const saveEnemyEntries = useCallback((
    entries: readonly EnemyBoxEntry[],
    baseEntries: readonly EnemyBoxEntry[],
  ): string | null => {
    if (!active?.repository || !currentState?.isAvailable) {
      return currentState?.lastSyncError
        ?? active?.errorMessage
        ?? "アカウントの仮想敵ボックス保存を利用できません";
    }
    const latest = active.repository.loadSnapshot();
    if (latest.status === "error") {
      setProviderState((current) => ({
        sourceKey: active.sourceKey,
        snapshot: current?.sourceKey === active.sourceKey ? current.snapshot : active.snapshot,
        isAvailable: false,
        isSynchronizing: false,
        lastSyncError: latest.error.message,
        issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
      }));
      return latest.error.message;
    }
    if (!isSyncBoxEntryBaseCurrent("enemy", baseEntries, latest.snapshot)) {
      setProviderState({
        sourceKey: active.sourceKey,
        snapshot: latest.snapshot,
        isAvailable: true,
        isSynchronizing: false,
        lastSyncError: null,
        issueCount: 0,
      });
      return STALE_BOX_MESSAGE;
    }
    const result = active.repository.saveEnemyEntries(entries);
    if (result.status === "error") return result.error.message;
    setProviderState((current) => ({
      sourceKey: active.sourceKey,
      snapshot: result.snapshot,
      isAvailable: true,
      isSynchronizing: current?.sourceKey === active.sourceKey && current.isSynchronizing,
      lastSyncError: current?.sourceKey === active.sourceKey ? current.lastSyncError : null,
      issueCount: current?.sourceKey === active.sourceKey ? current.issueCount : 0,
    }));
    void synchronize("manual");
    return null;
  }, [active, currentState, synchronize]);

  const value = useMemo<SyncBoxContextValue | null>(() => (
    active && currentState
      ? {
          mode: "account",
          ownerUid: active.ownerUid,
          sourceKey: active.sourceKey,
          snapshot: currentState.snapshot,
          isAvailable: currentState.isAvailable,
          isSynchronizing: currentState.isSynchronizing,
          lastSyncError: currentState.lastSyncError,
          issueCount: currentState.issueCount,
          saveTargetEntries,
          saveEnemyEntries,
          synchronize,
        }
      : null
  ), [active, currentState, saveEnemyEntries, saveTargetEntries, synchronize]);

  return <SyncBoxContext.Provider value={value}>{children}</SyncBoxContext.Provider>;
}

export function useOptionalSyncBox(): SyncBoxContextValue | null {
  return useContext(SyncBoxContext);
}

export function resetSyncBoxRepositoryCacheForTests(): void {
  defaultRepositoryCache.clear();
}
