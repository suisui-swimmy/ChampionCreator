import type { AuthSessionState } from "./authSession";
import type { CloudDraftContextValue } from "./CloudDraftProvider";
import type { SyncBoxContextValue } from "./SyncBoxProvider";
import type { SyncMigrationReadiness } from "./SyncMigrationGate";

export interface StartupSnapshot {
  readonly auth: AuthSessionState;
  readonly migration: SyncMigrationReadiness;
  readonly box: Pick<SyncBoxContextValue,
    "ownerUid" | "isAvailable" | "initialSyncSettled" | "lastSyncError"> | null;
  readonly draft: Pick<CloudDraftContextValue,
    "ownerUid" | "isAvailable" | "initialSyncSettled" | "lastError"> | null;
  readonly online: boolean;
  readonly slow: boolean;
}

export interface StartupReadiness {
  readonly phase: "ready" | "loading" | "attention" | "migration";
  readonly canContinue: boolean;
  readonly message: string;
}

/** Startup is not the header's aggregate sync status or an empty outbox. */
export function getStartupReadiness({ auth, migration, box, draft, online, slow }: StartupSnapshot): StartupReadiness {
  const ready: StartupReadiness = { phase: "ready", canContinue: false, message: "" };
  const waiting = (message: string, canContinue = false, failed = false): StartupReadiness => ({
    phase: failed || slow ? "attention" : "loading",
    canContinue: canContinue && (failed || slow),
    message: failed || slow ? message : "データを読み込んでいます…",
  });

  if (auth.status === "unavailable" || auth.status === "signed-out") return ready;
  if (auth.status !== "signed-in" || !auth.user) {
    return waiting("ログイン状態を確認できませんでした。再試行してください。", false, auth.status === "error");
  }
  const ownerUid = auth.user.uid;
  if (migration.ownerUid !== ownerUid) {
    return waiting("保存先の確認に時間がかかっています。");
  }
  // The migration owner presents its own decision/error dialog. Never overlay
  // another dialog or show a guest draft while that account choice is pending.
  if (migration.status === "review" || migration.status === "error") {
    return { phase: "migration", canContinue: false, message: "保存先を確認してください。" };
  }
  if (migration.status === "deferred") return ready;
  if (migration.status !== "ready") return waiting("保存先の確認に時間がかかっています。");
  if (box?.ownerUid !== ownerUid || draft?.ownerUid !== ownerUid) {
    return waiting("アカウントの保存データを確認しています。");
  }

  // This escape hatch is only for this UID's valid local repositories. Unknown
  // auth, other accounts, and corrupt/unavailable local storage cannot use it.
  const canContinue = box.isAvailable && draft.isAvailable;
  const error = box.lastSyncError ?? draft.lastError;
  if (!canContinue || error) {
    return waiting(error ?? "アカウントの保存データを読み込めませんでした。", canContinue, true);
  }
  if (!online) return waiting("オフラインのため、クラウドを確認できません。", canContinue, true);
  if (box.initialSyncSettled && draft.initialSyncSettled) return ready;
  return waiting("クラウドの確認に時間がかかっています。", canContinue);
}
