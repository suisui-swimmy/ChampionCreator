import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useAuthSession } from "./authSessionContext";
import type {
  LocalStorageMigrationDecision,
  LocalStorageMigrationResult,
} from "./localStorageMigration";
import { SyncMigrationDialog } from "./SyncMigrationDialog";
import { getSyncMigrationMode } from "./syncMigrationView";

export interface SyncMigrationControllerLike {
  inspect(): Promise<LocalStorageMigrationResult>;
  decide(decision: LocalStorageMigrationDecision): Promise<LocalStorageMigrationResult>;
  retry(): Promise<LocalStorageMigrationResult>;
}

export type SyncMigrationControllerFactory = (
  ownerUid: string,
) => SyncMigrationControllerLike | Promise<SyncMigrationControllerLike>;

export interface SyncMigrationGateProps {
  readonly children: ReactNode;
  readonly controllerFactory?: SyncMigrationControllerFactory;
}

type DialogState = {
  readonly mode: "checking" | "review" | "error";
  readonly result?: LocalStorageMigrationResult;
  readonly errorMessage?: string;
};

const defaultControllerCache = new Map<string, Promise<SyncMigrationControllerLike>>();

const defaultFactory: SyncMigrationControllerFactory = (ownerUid) => {
  const cached = defaultControllerCache.get(ownerUid);
  if (cached) return cached;
  const controller = import("./localStorageMigration")
    .then(({ createBrowserLocalStorageMigrationController }) => (
      createBrowserLocalStorageMigrationController(ownerUid)
    ))
    .catch((error) => {
      defaultControllerCache.delete(ownerUid);
      throw error;
    });
  defaultControllerCache.set(ownerUid, controller);
  return controller;
};

/**
 * Runtime-only M3 bridge. The existing App box handlers remain on the legacy
 * localStorage keys until M4; this gate only owns the one-time account import.
 * GuideTutorial never mounts this component.
 */
export function SyncMigrationGate({
  children,
  controllerFactory = defaultFactory,
}: SyncMigrationGateProps) {
  const { state: authState } = useAuthSession();
  const controllerRef = useRef<SyncMigrationControllerLike | null>(null);
  const ownerRef = useRef<string | null>(null);
  const operationRef = useRef(0);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissedOwner, setDismissedOwner] = useState<string | null>(null);

  const presentResult = useCallback((result: LocalStorageMigrationResult) => {
    const mode = getSyncMigrationMode(result);
    setDialog(mode === null
      ? null
      : {
          mode,
          result,
          errorMessage: result.error?.message,
        });
  }, []);

  const createController = useCallback(async (ownerUid: string): Promise<SyncMigrationControllerLike> => {
    if (ownerRef.current !== ownerUid || !controllerRef.current) {
      controllerRef.current = await controllerFactory(ownerUid);
      ownerRef.current = ownerUid;
    }
    return controllerRef.current;
  }, [controllerFactory]);

  const inspect = useCallback(async (ownerUid: string) => {
    const operation = ++operationRef.current;
    setBusy(true);
    // A Firestore server read can be slow while offline. Keep the existing
    // local-first App interactive until an actual decision or error exists.
    setDialog(null);
    try {
      const controller = await createController(ownerUid);
      const result = await controller.inspect();
      if (operation === operationRef.current) {
        presentResult(result);
      }
    } catch (error) {
      if (operation === operationRef.current) {
        const message = error instanceof Error
          ? error.message
          : "保存データの移行を確認できませんでした";
        setDialog({ mode: "error", errorMessage: message });
      }
    } finally {
      if (operation === operationRef.current) {
        setBusy(false);
      }
    }
  }, [createController, presentResult]);

  useEffect(() => {
    const ownerUid = authState.user?.uid ?? null;
    if (!ownerUid) {
      operationRef.current += 1;
      controllerRef.current = null;
      ownerRef.current = null;
      setDialog(null);
      setBusy(false);
      setDismissedOwner(null);
      return;
    }
    // Keep an existing migration surface while sign-out is pending or failed
    // with the same authenticated user. Only a confirmed signed-in state may
    // start a new inspection.
    if (authState.status !== "signed-in") {
      setBusy(false);
      return;
    }
    if (dismissedOwner !== ownerUid) {
      void inspect(ownerUid);
    }
    return () => {
      operationRef.current += 1;
    };
  }, [authState.status, authState.user?.uid, dismissedOwner, inspect]);

  const handleDecision = useCallback(async (decision: LocalStorageMigrationDecision) => {
    const ownerUid = authState.user?.uid;
    if (!ownerUid || !controllerRef.current) return;
    const operation = ++operationRef.current;
    setBusy(true);
    try {
      const result = await controllerRef.current.decide(decision);
      if (operation !== operationRef.current) return;
      if (decision === "later") {
        // Deferral must never prevent normal local-first use, even when its
        // marker cannot be saved. The legacy keys remain untouched either way.
        setDismissedOwner(ownerUid);
        setDialog(null);
        return;
      }
      presentResult(result);
    } catch (error) {
      if (operation === operationRef.current) {
        setDialog({
          mode: "error",
          errorMessage: error instanceof Error
            ? error.message
            : "保存データの移行を完了できませんでした",
        });
      }
    } finally {
      if (operation === operationRef.current) setBusy(false);
    }
  }, [authState.user?.uid, presentResult]);

  const handleRetry = useCallback(() => {
    const ownerUid = authState.user?.uid;
    if (!ownerUid) return;
    controllerRef.current = null;
    ownerRef.current = null;
    void inspect(ownerUid);
  }, [authState.user?.uid, inspect]);

  const summary = dialog?.result?.summary ?? {
    deviceTargetCount: 0,
    deviceEnemyCount: 0,
    cloudTargetCount: 0,
    cloudEnemyCount: 0,
    sameCount: 0,
    conflictCount: 0,
  };

  return (
    <>
      {children}
      {dialog ? (
        <SyncMigrationDialog
          mode={dialog.mode}
          summary={summary}
          busy={busy}
          errorMessage={dialog.errorMessage}
          canUseDevice={dialog.result?.canUseDevice ?? true}
          onDecision={(decision) => void handleDecision(decision)}
          onRetry={handleRetry}
        />
      ) : null}
    </>
  );
}
