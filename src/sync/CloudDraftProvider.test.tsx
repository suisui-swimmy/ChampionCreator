import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AuthSessionState } from "./authSession";
import { AuthSessionContext } from "./authSessionContext";
import {
  CloudDraftProvider,
  getCloudDraftOwnerUid,
  getCloudDraftStatusLabel,
  useOptionalCloudDraft,
  type CloudDraftRuntime,
  type CloudDraftRuntimeStatus,
} from "./CloudDraftProvider";
import { createCloudDraftCoordinator } from "./cloudDraftCoordinator";
import { createMemoryCloudDraftLocalRepository } from "./cloudDraftLocalRepository";
import type { CloudDraftRepository } from "./firestoreCloudDraftRepository";
import {
  SyncMigrationReadinessContext,
  type SyncMigrationReadiness,
} from "./SyncMigrationGate";

const authState = (
  status: AuthSessionState["status"],
  uid: string | null,
): AuthSessionState => ({
  status,
  availability: "available",
  user: uid
    ? { uid, displayName: null, email: null, photoURL: null }
    : null,
  error: null,
});

const migrationState = (
  status: SyncMigrationReadiness["status"],
  ownerUid: string | null,
): SyncMigrationReadiness => ({ status, ownerUid });

const emptyCloud: CloudDraftRepository = {
  readAll: async () => ({ status: "empty", drafts: [], records: [], issues: [] }),
  write: async () => ({ status: "written", issues: [] }),
};

const createRuntime = (ownerUid: string, deviceId = `device-${ownerUid}`): CloudDraftRuntime => ({
  ownerUid,
  identity: {
    deviceId,
    deviceLabel: `Test ${ownerUid}`,
  },
  coordinator: createCloudDraftCoordinator({
    local: createMemoryCloudDraftLocalRepository(ownerUid, deviceId),
    cloud: emptyCloud,
    deviceLabel: `Test ${ownerUid}`,
  }),
});

const renderContext = (
  uid: string,
  runtimeFactory: (ownerUid: string) => CloudDraftRuntime,
) => {
  function Probe() {
    const context = useOptionalCloudDraft();
    if (!context) return <output>guest</output>;
    return (
      <output>
        {[
          context.ownerUid,
          context.deviceId,
          context.deviceLabel,
          context.sourceKey,
          context.localDraftStorageKey,
          context.status,
          String(context.isAvailable),
          context.lastError,
        ].join("|")}
      </output>
    );
  }

  return renderToStaticMarkup(
    <AuthSessionContext.Provider value={{ state: authState("signed-in", uid) } as never}>
      <SyncMigrationReadinessContext.Provider value={migrationState("ready", uid)}>
        <CloudDraftProvider runtimeFactory={runtimeFactory}>
          <Probe />
        </CloudDraftProvider>
      </SyncMigrationReadinessContext.Provider>
    </AuthSessionContext.Provider>,
  );
};

describe("CloudDraftProvider activation and lifecycle boundary", () => {
  it("activates only when the authenticated UID matches ready migration", () => {
    expect(getCloudDraftOwnerUid(
      authState("signed-in", "account-a"),
      migrationState("ready", "account-a"),
    )).toBe("account-a");
    expect(getCloudDraftOwnerUid(
      authState("signed-in", "account-a"),
      migrationState("ready", "account-b"),
    )).toBeNull();
    expect(getCloudDraftOwnerUid(
      authState("signed-out", null),
      migrationState("guest", null),
    )).toBeNull();
  });

  it.each(["checking", "review", "deferred", "error"] as const)(
    "keeps %s migration state outside the account cloud-draft source",
    (status) => {
      expect(getCloudDraftOwnerUid(
        authState("signed-in", "account-a"),
        migrationState(status, "account-a"),
      )).toBeNull();
    },
  );

  it("exposes an account/device-isolated source and account draft storage key in SSR", () => {
    const html = renderContext("account-a", (ownerUid) => createRuntime(ownerUid, "device-a"));

    expect(html).toContain(
      "account-a|device-a|Test account-a|account:account-a:draft:device-a|championcreator.draft.v1.account-a.device-a|idle|true|",
    );
  });

  it("does not reuse a different account source or device identity", () => {
    const runtimes = new Map<string, CloudDraftRuntime>([
      ["account-a", createRuntime("account-a", "device-a")],
      ["account-b", createRuntime("account-b", "device-b")],
    ]);
    const first = renderContext("account-a", (ownerUid) => runtimes.get(ownerUid)!);
    const second = renderContext("account-b", (ownerUid) => runtimes.get(ownerUid)!);

    expect(first).toContain("account-a|device-a");
    expect(first).not.toContain("account-b|device-b");
    expect(second).toContain("account-b|device-b");
    expect(second).not.toContain("account-a|device-a");
  });

  it("keeps an unavailable runtime visible as an account error context", () => {
    const html = renderContext("account-error", () => {
      throw new Error("Firebase client is unavailable");
    });

    expect(html).toContain(
      "account-error|||account:account-error:draft:unavailable||error|false|Firebase client is unavailable",
    );
  });

  it("keeps lifecycle status labels stable", () => {
    const expected: Record<CloudDraftRuntimeStatus, string> = {
      idle: "この端末のみ",
      queued: "未同期",
      syncing: "同期中…",
      synced: "同期済み",
      offline: "オフライン",
      error: "同期エラー",
    };
    for (const [status, label] of Object.entries(expected) as [CloudDraftRuntimeStatus, string][]) {
      expect(getCloudDraftStatusLabel(status)).toBe(label);
    }
  });

  it("mounts in the application runtime but not in the guide tutorial", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const guideMain = readFileSync(new URL("../guide/main.tsx", import.meta.url), "utf8");
    expect(main).toContain('import { CloudDraftProvider } from "./sync/CloudDraftProvider"');
    expect(main).toMatch(/<SyncMigrationGate>[\s\S]*?<CloudDraftProvider>[\s\S]*?<SyncBoxProvider>/);
    expect(guideMain).not.toContain("CloudDraftProvider");
  });

  it("cancels hidden/pagehide timers without flushing from pagehide", () => {
    const source = readFileSync(new URL("./CloudDraftProvider.tsx", import.meta.url), "utf8");
    expect(source).toContain('globalThis.addEventListener?.("pagehide", handlePageHide)');
    expect(source).toContain("document?.addEventListener?.(\"visibilitychange\", handleVisibilityChange)");
    const pageHideBody = source.match(/const handlePageHide = \(\) => \{([\s\S]*?)\n    \};/)?.[1] ?? "";
    expect(pageHideBody).toContain("clearTimer()");
    expect(pageHideBody).not.toContain("synchronize(");
  });
});
