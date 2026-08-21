/**
 * The account-level sync status shown by the persistent account UI.
 *
 * Box and cloud-draft providers deliberately have slightly different
 * internal state machines (`queued`/`idle` versus outbox/conflict counts).
 * This module is the small app-owned vocabulary that lets the header expose
 * one stable status without leaking either provider's implementation details.
 */
export type AccountSyncStatus =
  | "local-only"
  | "unsynced"
  | "syncing"
  | "synced"
  | "offline"
  | "conflict"
  | "error";

export const ACCOUNT_SYNC_STATUS_LABELS: Readonly<Record<AccountSyncStatus, string>> = {
  "local-only": "このブラウザのみ",
  unsynced: "未同期",
  syncing: "同期中…",
  synced: "同期済み",
  offline: "オフライン",
  conflict: "競合あり",
  error: "同期エラー",
};

/**
 * Higher values win when box and draft state are reduced to one label.
 * A conflict is kept most prominent because silently hiding it can lose a
 * user's chance to resolve two different edits. An error follows, then
 * connectivity/active-work states, with healthy states at the bottom.
 */
export const ACCOUNT_SYNC_STATUS_PRIORITY: Readonly<Record<AccountSyncStatus, number>> = {
  "local-only": 0,
  synced: 10,
  unsynced: 20,
  syncing: 30,
  offline: 40,
  error: 50,
  conflict: 60,
};

export const getAccountSyncStatusLabel = (status: AccountSyncStatus): string => (
  ACCOUNT_SYNC_STATUS_LABELS[status]
);

export const compareAccountSyncStatus = (
  left: AccountSyncStatus,
  right: AccountSyncStatus,
): number => ACCOUNT_SYNC_STATUS_PRIORITY[left] - ACCOUNT_SYNC_STATUS_PRIORITY[right];

/** Pick the most actionable status from zero or more provider states. */
export const selectAccountSyncStatus = (
  statuses: readonly AccountSyncStatus[],
  fallback: AccountSyncStatus = "local-only",
): AccountSyncStatus => {
  let selected = fallback;
  for (const status of statuses) {
    if (compareAccountSyncStatus(status, selected) > 0) {
      selected = status;
    }
  }
  return selected;
};

export const combineAccountSyncStatuses = selectAccountSyncStatus;

export type AccountSyncProviderStatus =
  | AccountSyncStatus
  | "idle"
  | "queued";

/** A provider snapshot may expose counts in addition to its internal status. */
export interface AccountSyncProviderSnapshot {
  readonly status?: AccountSyncProviderStatus;
  readonly outboxCount?: number;
  readonly conflictCount?: number;
  readonly issueCount?: number;
}

const isPositive = (value: number | undefined): boolean => (
  typeof value === "number" && Number.isFinite(value) && value > 0
);

/** Convert the cloud-draft/box vocabulary into the account vocabulary. */
export const normalizeAccountSyncProviderStatus = (
  snapshot: AccountSyncProviderSnapshot | AccountSyncProviderStatus,
): AccountSyncStatus => {
  if (typeof snapshot === "string") {
    switch (snapshot) {
      case "idle":
        return "local-only";
      case "queued":
        return "unsynced";
      default:
        return snapshot;
    }
  }

  if (isPositive(snapshot.conflictCount)) return "conflict";
  if (isPositive(snapshot.issueCount)) return "error";
  if (isPositive(snapshot.outboxCount)) return "unsynced";
  switch (snapshot.status) {
    case "idle":
      return "local-only";
    case "queued":
      return "unsynced";
    case "syncing":
    case "synced":
    case "offline":
    case "conflict":
    case "error":
    case "local-only":
    case "unsynced":
      return snapshot.status;
    default:
      return "local-only";
  }
};

export interface AccountSyncSnapshot {
  /** Guest has no cloud sync contract; signed-in migration states stay explicit. */
  readonly authenticated?: boolean;
  readonly migrationReady?: boolean;
  readonly authStatus?: "unavailable" | "loading" | "signed-out" | "signing-in" | "signed-in" | "signing-out" | "error";
  readonly migrationStatus?: "guest" | "checking" | "review" | "ready" | "deferred" | "error";
  readonly online?: boolean;
  readonly box?: AccountSyncProviderSnapshot | AccountSyncProviderStatus;
  readonly draft?: AccountSyncProviderSnapshot | AccountSyncProviderStatus;
}

/** Reduce account providers to the one exact label used by the header. */
export const deriveAccountSyncStatus = (
  snapshot: AccountSyncSnapshot,
): AccountSyncStatus => {
  if (snapshot.authenticated === false) {
    if (snapshot.authStatus === "loading" || snapshot.authStatus === "signing-in") {
      return "syncing";
    }
    if (snapshot.authStatus === "error") return "error";
    return "local-only";
  }
  const providers: AccountSyncStatus[] = [];
  if (snapshot.box !== undefined) {
    providers.push(normalizeAccountSyncProviderStatus(snapshot.box));
  }
  if (snapshot.draft !== undefined) {
    providers.push(normalizeAccountSyncProviderStatus(snapshot.draft));
  }
  if (snapshot.migrationStatus === "checking") providers.push("syncing");
  if (snapshot.migrationStatus === "review" || snapshot.migrationStatus === "deferred") {
    providers.push("unsynced");
  }
  if (snapshot.migrationStatus === "error") providers.push("error");
  if (snapshot.migrationReady === false && snapshot.migrationStatus === undefined) {
    providers.push("unsynced");
  }
  if (snapshot.online === false) providers.push("offline");
  if (snapshot.authStatus === "loading"
    || snapshot.authStatus === "signing-in"
    || snapshot.authStatus === "signing-out") {
    providers.push("syncing");
  }
  if (snapshot.authStatus === "error") providers.push("error");
  return selectAccountSyncStatus(providers);
};

export const resolveAccountSyncStatus = deriveAccountSyncStatus;
