import { describe, expect, it } from "vitest";
import {
  ACCOUNT_SYNC_STATUS_LABELS,
  ACCOUNT_SYNC_STATUS_PRIORITY,
  deriveAccountSyncStatus,
  getAccountSyncStatusLabel,
  normalizeAccountSyncProviderStatus,
  selectAccountSyncStatus,
  type AccountSyncStatus,
} from "./accountSyncStatus";

const statuses: AccountSyncStatus[] = [
  "local-only",
  "unsynced",
  "syncing",
  "synced",
  "offline",
  "conflict",
  "error",
];

describe("accountSyncStatus", () => {
  it("keeps the seven user-facing labels exact", () => {
    expect(statuses.map(getAccountSyncStatusLabel)).toEqual([
      "このブラウザのみ",
      "未同期",
      "同期中…",
      "同期済み",
      "オフライン",
      "競合あり",
      "同期エラー",
    ]);
    expect(ACCOUNT_SYNC_STATUS_LABELS).toEqual({
      "local-only": "このブラウザのみ",
      unsynced: "未同期",
      syncing: "同期中…",
      synced: "同期済み",
      offline: "オフライン",
      conflict: "競合あり",
      error: "同期エラー",
    });
  });

  it("uses a deterministic actionable priority", () => {
    expect(ACCOUNT_SYNC_STATUS_PRIORITY.conflict).toBeGreaterThan(
      ACCOUNT_SYNC_STATUS_PRIORITY.error,
    );
    expect(ACCOUNT_SYNC_STATUS_PRIORITY.error).toBeGreaterThan(
      ACCOUNT_SYNC_STATUS_PRIORITY.offline,
    );
    expect(ACCOUNT_SYNC_STATUS_PRIORITY.offline).toBeGreaterThan(
      ACCOUNT_SYNC_STATUS_PRIORITY.syncing,
    );
    expect(ACCOUNT_SYNC_STATUS_PRIORITY.syncing).toBeGreaterThan(
      ACCOUNT_SYNC_STATUS_PRIORITY.unsynced,
    );
    expect(ACCOUNT_SYNC_STATUS_PRIORITY.unsynced).toBeGreaterThan(
      ACCOUNT_SYNC_STATUS_PRIORITY.synced,
    );
    expect(ACCOUNT_SYNC_STATUS_PRIORITY.synced).toBeGreaterThan(
      ACCOUNT_SYNC_STATUS_PRIORITY["local-only"],
    );
    expect(selectAccountSyncStatus(["synced", "error", "conflict", "unsynced"])).toBe(
      "conflict",
    );
    expect(selectAccountSyncStatus([])).toBe("local-only");
  });

  it("maps existing provider statuses and counts without leaking them", () => {
    expect(normalizeAccountSyncProviderStatus("idle")).toBe("local-only");
    expect(normalizeAccountSyncProviderStatus("queued")).toBe("unsynced");
    expect(normalizeAccountSyncProviderStatus({ status: "synced", outboxCount: 1 })).toBe(
      "unsynced",
    );
    expect(normalizeAccountSyncProviderStatus({ status: "synced", conflictCount: 1 })).toBe(
      "conflict",
    );
    expect(normalizeAccountSyncProviderStatus({ status: "synced", issueCount: 1 })).toBe(
      "error",
    );
  });

  it("keeps guests local-only and makes signed-in lifecycle states explicit", () => {
    expect(deriveAccountSyncStatus({ authenticated: false, box: "error" })).toBe("local-only");
    expect(deriveAccountSyncStatus({ authenticated: true, migrationReady: false, draft: "syncing" }))
      .toBe("syncing");
    expect(deriveAccountSyncStatus({
      authenticated: true,
      migrationReady: false,
      migrationStatus: "deferred",
    })).toBe("unsynced");
    expect(deriveAccountSyncStatus({
      authenticated: true,
      migrationReady: false,
      migrationStatus: "error",
    })).toBe("error");
    expect(deriveAccountSyncStatus({
      authenticated: true,
      migrationReady: true,
      online: false,
      box: "synced",
    })).toBe("offline");
    expect(deriveAccountSyncStatus({
      authenticated: true,
      migrationReady: true,
      online: false,
      box: { status: "synced", conflictCount: 1 },
    })).toBe("conflict");
    expect(deriveAccountSyncStatus({
      authenticated: true,
      migrationReady: true,
      box: { status: "synced" },
      draft: { status: "queued" },
    })).toBe("unsynced");
  });
});
