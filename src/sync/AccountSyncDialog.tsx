import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "../ui/primitives";

/** The small, app-owned view model needed by the account dialog. */
export type AccountSyncMode = "signed-out" | "signed-in";

/**
 * These labels are intentionally the public sync contract. Keep them in one
 * place so a provider cannot accidentally replace them with implementation
 * state such as `idle` or `outbox`.
 */
export type AccountSyncStatusLabel =
  | "このブラウザのみ"
  | "未同期"
  | "同期中…"
  | "同期済み"
  | "オフライン"
  | "競合あり"
  | "同期エラー";

type AccountSyncStatusKey =
  | "local-only"
  | "unsynced"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export interface AccountSyncUser {
  readonly displayName?: string | null;
  readonly email?: string | null;
}

export type AccountConflictAction = "keep-both" | "local" | "remote";

export interface AccountSyncConflictState {
  readonly count: number;
  readonly message?: string | null;
  readonly onAction?: (action: AccountConflictAction) => void;
  readonly busy?: boolean;
}

export type AccountMigrationStatus =
  | "idle"
  | "checking"
  | "review"
  | "error"
  | "deferred"
  | "in-progress"
  | "needs-review"
  | "completed";

export interface AccountMigrationState {
  readonly status: AccountMigrationStatus;
  readonly message?: string | null;
  readonly onRetry?: () => void;
  readonly busy?: boolean;
}

export type AccountDeletionStage =
  | "idle"
  | "confirm"
  | "deleting"
  | "error"
  | "complete";

export interface AccountDeletionState {
  readonly stage: AccountDeletionStage;
  readonly message?: string | null;
  readonly onRetry?: () => void;
  readonly busy?: boolean;
  readonly canCancel?: boolean;
}

export interface AccountSyncDialogProps {
  /** Which account surface is currently active. Defaults to signed-in. */
  readonly mode?: AccountSyncMode;
  readonly user?: AccountSyncUser | null;
  /** One of the exact user-facing sync labels, or a provider-owned detail. */
  readonly status?: AccountSyncStatusLabel | string | null;
  readonly statusMessage?: string | null;
  readonly busy?: boolean;
  readonly errorMessage?: string | null;

  readonly migration?: AccountMigrationState | null;
  readonly draftsCount?: number;
  readonly onOpenDrafts?: () => void;
  readonly onExport?: () => void;
  readonly onSync?: () => void;

  readonly conflicts?: AccountSyncConflictState | null;
  readonly deletion?: AccountDeletionState | null;

  /** Called by the signed-out surface. No provider scope is requested here. */
  readonly onSignIn?: () => void | Promise<unknown>;
  readonly onRequestLogout?: () => void;
  readonly onConfirmLogout?: () => void | Promise<unknown>;
  readonly onCancelLogout?: () => void;
  readonly logoutPending?: boolean;
  readonly pendingCount?: number;
  readonly conflictCount?: number;

  /** Called after the user has typed the exact confirmation word. */
  readonly onDeleteAccount?: (confirmation: string) => void | Promise<unknown>;
  readonly onCancelDeleteAccount?: () => void;

  /** Close only the presentation surface; it must not sign out implicitly. */
  readonly onClose?: () => void;
  readonly children?: ReactNode;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const clampCount = (value: number | undefined): number => (
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
);

const accountSyncStatusLabels: Readonly<Record<AccountSyncStatusKey, AccountSyncStatusLabel>> = {
  "local-only": "このブラウザのみ",
  unsynced: "未同期",
  syncing: "同期中…",
  synced: "同期済み",
  offline: "オフライン",
  conflict: "競合あり",
  error: "同期エラー",
};

const getDisplayStatus = (status: string | null | undefined): string => {
  if (!status) {
    return "このブラウザのみ";
  }
  return accountSyncStatusLabels[status as AccountSyncStatusKey] ?? status;
};

const run = (callback: (() => void | Promise<unknown>) | undefined): void => {
  if (!callback) {
    return;
  }
  // The owner of an async action owns its error state. The dialog intentionally
  // does not retain a provider error or a credential in React state.
  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch {
    // Synchronous failures are likewise represented by the owner's error
    // state; a rejected click handler must not become an unhandled rejection.
  }
};

/**
 * Account, synchronization, export, and destructive-account controls.
 *
 * This component is deliberately presentational: it does not read storage,
 * Firebase, or browser account state. Providers pass stable callbacks and
 * state in, which keeps the destructive operation ordering in the account
 * service and makes this surface straightforward to test in isolation.
 */
export function AccountSyncDialog({
  mode = "signed-in",
  user,
  status,
  statusMessage,
  busy = false,
  errorMessage,
  migration,
  draftsCount = 0,
  onOpenDrafts,
  onExport,
  onSync,
  conflicts,
  deletion,
  onSignIn,
  onRequestLogout,
  onConfirmLogout,
  onCancelLogout,
  logoutPending = false,
  pendingCount = 0,
  conflictCount = 0,
  onDeleteAccount,
  onCancelDeleteAccount,
  onClose,
  children,
}: AccountSyncDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const deletionInputRef = useRef<HTMLInputElement | null>(null);
  const deletionStatusRef = useRef<HTMLParagraphElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [localLogoutPending, setLocalLogoutPending] = useState(false);
  const [localDeleteRequested, setLocalDeleteRequested] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const deletionDescriptionId = useId();
  const deletionInputId = useId();
  const isSignedIn = mode === "signed-in";
  const isBusy = busy || Boolean(migration?.busy) || Boolean(conflicts?.busy) || Boolean(deletion?.busy);
  const isLogoutPending = logoutPending || localLogoutPending;
  const deletionStage = deletion?.stage ?? "idle";
  const controlsLocked = deletion?.canCancel === false;
  const migrationIsError = migration?.status === "error";
  const migrationIsChecking = migration?.status === "checking" || migration?.status === "in-progress";
  const migrationIsDeferred = migration?.status === "deferred";
  const showDeletionConfirm = localDeleteRequested
    || deletionStage === "confirm"
    || deletionStage === "deleting"
    || deletionStage === "error";
  const canDelete = (
    (deletionStage === "error" && Boolean(deletion?.onRetry))
    || confirmation === "削除"
  ) && !isBusy && deletionStage !== "deleting";

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return undefined;
  }, []);

  useEffect(() => {
    if (!showDeletionConfirm) return;
    if (deletionStage === "deleting") {
      deletionStatusRef.current?.focus();
      return;
    }
    deletionInputRef.current?.focus();
  }, [deletionStage, showDeletionConfirm]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof document === "undefined") {
      return undefined;
    }

    const overlay = dialog.closest<HTMLElement>(".account-sync-overlay");
    const siblings = overlay?.parentElement
      ? Array.from(overlay.parentElement.children).filter((element) => element !== overlay)
      : [];
    const previousSiblingState = siblings.map((element) => ({
      element,
      inert: (element as HTMLElement).inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of siblings) {
      (element as HTMLElement).inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      for (const previous of previousSiblingState) {
        (previous.element as HTMLElement).inert = previous.inert;
        if (previous.ariaHidden === null) {
          previous.element.removeAttribute("aria-hidden");
        } else {
          previous.element.setAttribute("aria-hidden", previous.ariaHidden);
        }
      }
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    (focusable[0] ?? dialog).focus();

    const keepFocusInside = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const currentFocusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (currentFocusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = currentFocusable[0];
      const last = currentFocusable[currentFocusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    dialog.addEventListener("keydown", keepFocusInside);
    return () => dialog.removeEventListener("keydown", keepFocusInside);
  }, []);

  const requestLogout = () => {
    setLocalLogoutPending(true);
    if (onRequestLogout) {
      onRequestLogout();
    }
  };

  const cancelLogout = () => {
    setLocalLogoutPending(false);
    onCancelLogout?.();
  };

  const confirmLogout = () => {
    setLocalLogoutPending(false);
    run(onConfirmLogout);
  };

  const closeDeletion = () => {
    setLocalDeleteRequested(false);
    setConfirmation("");
    onCancelDeleteAccount?.();
  };

  const submitDeletion = () => {
    if (!canDelete) {
      return;
    }
    if (deletion?.stage === "error" && deletion.onRetry) {
      run(deletion.onRetry);
      return;
    }
    run(() => onDeleteAccount?.(confirmation));
  };

  return (
    <div className="account-sync-overlay">
      <div className="account-sync-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="account-sync-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-live="polite"
        aria-busy={isBusy}
        tabIndex={-1}
      >
        <header className="account-sync-header">
          <div>
            <span className="account-sync-kicker">アカウントと同期</span>
            <h2 id={titleId}>{isSignedIn ? "アカウント管理" : "ログイン"}</h2>
            <p id={descriptionId} className="account-sync-description">
              {isSignedIn
                ? "保存データの同期、下書き、アカウントの管理を行えます。"
                : "Googleアカウントでログインすると、保存データをブラウザ間で同期できます。"}
            </p>
          </div>
          {onClose ? (
            <Button variant="ghost" size="icon" aria-label="アカウント画面を閉じる" onClick={onClose}>×</Button>
          ) : null}
        </header>

        {!isSignedIn ? (
          <section className="account-sync-signed-out" aria-labelledby={`${titleId}-signed-out`}>
            <h3 id={`${titleId}-signed-out`}>Googleアカウントでログイン</h3>
            <p>
              Googleログインでは、表示名・メールアドレス・プロフィール画像と、アカウントを区別するためのIDを受け取ります。Google Driveのファイル、連絡先、Gmailのメール本文を見る権限は求めません。
            </p>
            {errorMessage ? (
              <p className="account-sync-error" role="alert" aria-live="assertive">{errorMessage}</p>
            ) : null}
            {statusMessage ? (
              <p className="account-sync-status-message" role="status" aria-live="polite">{statusMessage}</p>
            ) : null}
            <Button
              variant="primary"
              disabled={isBusy || !onSignIn}
              onClick={() => run(onSignIn)}
            >
              Googleでログイン
            </Button>
            <p className="account-sync-local-data-note" role="note">
              ログインしない場合も、このブラウザだけで従来どおり利用できます。ブラウザだけのデータはアカウントの保存領域と分けて管理されます。
            </p>
            <a className="account-sync-privacy-link" href="/privacy/">プライバシーと保存データについて</a>
          </section>
        ) : (
          <>
            <section className="account-sync-account" aria-labelledby={`${titleId}-account`}>
              <h3 id={`${titleId}-account`}>ログイン中</h3>
              {user?.displayName ? <p>{user.displayName}</p> : null}
              {user?.email ? <p className="account-sync-email">{user.email}</p> : null}
            </section>

            <section className="account-sync-status" aria-labelledby={`${titleId}-status`}>
              <h3 id={`${titleId}-status`}>同期状態</h3>
              <p id={statusId} className="account-sync-status-value" role="status" data-sync-status={getDisplayStatus(status)}>
                {getDisplayStatus(status)}
              </p>
              {statusMessage ? <p className="account-sync-status-message">{statusMessage}</p> : null}
              {errorMessage ? <p className="account-sync-error" role="alert" aria-live="assertive">{errorMessage}</p> : null}
              <Button variant="primary" disabled={isBusy || controlsLocked || !onSync} onClick={() => run(onSync)}>
                今すぐ同期
              </Button>
            </section>

            {migration && (migrationIsError || migrationIsChecking || migrationIsDeferred || migration.status === "review" || migration.status === "needs-review") ? (
              <section className="account-sync-migration" aria-labelledby={`${titleId}-migration`}>
                <h3 id={`${titleId}-migration`}>初回統合</h3>
                <p role={migrationIsError ? "alert" : "status"} aria-live={migrationIsError ? "assertive" : "polite"}>
                  {migration.message ?? (migrationIsChecking
                    ? "保存データを確認中です。"
                    : migrationIsDeferred
                      ? "初回統合は保留中です。同期を始める前に再開してください。"
                      : migration.status === "review" || migration.status === "needs-review"
                      ? "保存データの扱いを選択してください。"
                      : "保存データの確認に失敗しました。")}
                </p>
                {migrationIsError || migrationIsDeferred ? (
                  <Button variant="ghost" disabled={isBusy || controlsLocked} onClick={() => run(migration.onRetry)}>
                    {migrationIsDeferred ? "初回統合を続ける" : "移行を再試行"}
                  </Button>
                ) : null}
              </section>
            ) : null}

            <section className="account-sync-actions" aria-label="アカウント保存の操作">
              <Button variant="ghost" disabled={isBusy || controlsLocked || !onOpenDrafts} onClick={onOpenDrafts}>
                下書きを表示（{clampCount(draftsCount)}件）
              </Button>
              <Button variant="ghost" disabled={isBusy || controlsLocked || !onExport} onClick={onExport}>
                アカウントデータを書き出す
              </Button>
            </section>

            {conflicts && conflicts.count > 0 ? (
              <section className="account-sync-conflicts" aria-labelledby={`${titleId}-conflicts`}>
                <h3 id={`${titleId}-conflicts`}>競合あり（{clampCount(conflicts.count)}件）</h3>
                <p>{conflicts.message ?? "同じ保存 slot が別のブラウザで変更されています。扱いを選んでください。"}</p>
                <div className="account-sync-conflict-actions" aria-label="競合の解決方法">
                  <Button variant="primary" disabled={isBusy || controlsLocked} onClick={() => conflicts.onAction?.("keep-both")}>
                    両方残す
                  </Button>
                  <Button variant="ghost" disabled={isBusy || controlsLocked} onClick={() => conflicts.onAction?.("local")}>
                    このブラウザを使用
                  </Button>
                  <Button variant="ghost" disabled={isBusy || controlsLocked} onClick={() => conflicts.onAction?.("remote")}>
                    クラウドを使用
                  </Button>
                </div>
              </section>
            ) : null}

            {!showDeletionConfirm ? (
              <section className="account-sync-danger-zone" aria-labelledby={`${titleId}-danger`}>
                <h3 id={`${titleId}-danger`}>アカウントの削除</h3>
                <p>アカウントのクラウド保存と認証情報を削除します。ブラウザだけのデータや従来のブラウザ保存領域は残ります。</p>
                <Button
                  variant="danger"
                  disabled={isBusy || !onDeleteAccount}
                  onClick={() => {
                    setConfirmation("");
                    setLocalDeleteRequested(true);
                  }}
                >
                  アカウントを削除
                </Button>
              </section>
            ) : (
              <section className="account-sync-delete-confirm" aria-labelledby={`${titleId}-delete-confirm`}>
                <h3 id={`${titleId}-delete-confirm`}>アカウントを完全に削除しますか？</h3>
                <p id={deletionDescriptionId}>
                  再認証（Google）→クラウドデータ削除→認証アカウント削除の順に処理します。途中で失敗した場合は認証アカウントを削除せず、再試行できます。
                </p>
                {deletion?.stage === "deleting" ? (
                  <p ref={deletionStatusRef} role="status" aria-live="polite" tabIndex={-1}>
                    再認証とクラウドデータの削除を処理中です。
                  </p>
                ) : (
                  <>
                    {deletion?.stage === "error" && deletion.message ? (
                      <p className="account-sync-error" role="alert" aria-live="assertive">{deletion.message}</p>
                    ) : null}
                    <label htmlFor={deletionInputId}>確認のため「削除」と入力してください</label>
                    <input
                       ref={deletionInputRef}
                       id={deletionInputId}
                       type="text"
                       value={confirmation}
                      onChange={(event) => setConfirmation(event.currentTarget.value)}
                      autoComplete="off"
                      aria-describedby={deletionDescriptionId}
                      disabled={isBusy}
                    />
                    <div className="account-sync-delete-actions">
                      <Button variant="danger" disabled={!canDelete} onClick={submitDeletion}>
                        {deletion?.stage === "error" ? "削除を再試行" : "アカウントを完全に削除"}
                      </Button>
                      {deletion?.canCancel === false ? null : (
                        <Button variant="ghost" disabled={isBusy} onClick={closeDeletion}>
                          キャンセル
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </section>
            )}

            <section className="account-sync-session-actions" aria-label="ログイン状態の操作">
              {!isLogoutPending ? (
                <Button variant="ghost" disabled={isBusy || controlsLocked} onClick={requestLogout}>ログアウト</Button>
              ) : (
                <div className="account-sync-logout-confirm" role="alert" aria-live="assertive">
                  <p>
                    ログアウトしますか？
                    {clampCount(pendingCount) > 0
                      ? `未同期の変更が${clampCount(pendingCount)}件あります。このブラウザには残りますが、ログアウト中は送信されません。`
                      : clampCount(conflictCount) > 0
                        ? `同期競合が${clampCount(conflictCount)}件あります。このブラウザのアカウント保存領域へ保持したままログアウトします。`
                      : "このブラウザのアカウント保存領域はログアウト後もゲスト領域と分けて保持されます。"}
                  </p>
                  <Button variant="danger" disabled={isBusy} onClick={confirmLogout}>ログアウトを確定</Button>
                  <Button variant="ghost" disabled={isBusy} onClick={cancelLogout}>キャンセル</Button>
                </div>
              )}
            </section>
          </>
        )}
        {children}
      </section>
    </div>
  );
}
