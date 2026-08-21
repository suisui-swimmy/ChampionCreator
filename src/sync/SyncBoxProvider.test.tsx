import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createBoxEntryFromState } from "../ui/boxStorage";
import { createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import type { AuthSessionState } from "./authSession";
import { AuthSessionContext } from "./authSessionContext";
import {
  getSyncBoxOwnerUid,
  isSyncBoxEntryBaseCurrent,
  SyncBoxProvider,
  useOptionalSyncBox,
} from "./SyncBoxProvider";
import {
  SyncBoxRepositoryError,
  type SyncBoxSnapshot,
} from "./syncBoxRepository";
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

describe("SyncBoxProvider activation boundary", () => {
  it("activates only for the same UID after migration completed", () => {
    expect(getSyncBoxOwnerUid(
      authState("signed-in", "account-a"),
      migrationState("ready", "account-a"),
    )).toBe("account-a");
    expect(getSyncBoxOwnerUid(
      authState("signed-in", "account-a"),
      migrationState("ready", "account-b"),
    )).toBeNull();
    expect(getSyncBoxOwnerUid(
      authState("signed-out", null),
      migrationState("guest", null),
    )).toBeNull();
  });

  it.each(["checking", "review", "deferred", "error"] as const)(
    "keeps %s migration state on the guest browser-storage path",
    (status) => {
      expect(getSyncBoxOwnerUid(
        authState("signed-in", "account-a"),
        migrationState(status, "account-a"),
      )).toBeNull();
    },
  );

  it("keeps the account namespace while sign-out is pending or failed", () => {
    const ready = migrationState("ready", "account-a");
    expect(getSyncBoxOwnerUid(authState("signing-out", "account-a"), ready))
      .toBe("account-a");
    expect(getSyncBoxOwnerUid(authState("error", "account-a"), ready))
      .toBe("account-a");
  });

  it("rejects a stale UI list only for the box kind that changed", () => {
    const empty: SyncBoxSnapshot = {
      targetEntries: [],
      enemyEntries: [],
      outboxCount: 0,
      conflictCount: 0,
      targetConflictCount: 0,
      enemyConflictCount: 0,
    };
    const target = createBoxEntryFromState(
      createDefaultTargetForm(),
      createDefaultScenarioForms(),
      { id: "remote-target", now: "2026-08-21T00:00:00.000Z" },
    );
    const latest: SyncBoxSnapshot = { ...empty, targetEntries: [target] };

    expect(isSyncBoxEntryBaseCurrent("target", [], latest)).toBe(false);
    expect(isSyncBoxEntryBaseCurrent("enemy", [], latest)).toBe(true);
  });

  it("marks a corrupt account namespace unavailable instead of presenting an empty box as valid", () => {
    function Probe() {
      const context = useOptionalSyncBox();
      return <output>{context ? `${context.isAvailable}:${context.lastSyncError}` : "guest"}</output>;
    }
    const state = authState("signed-in", "account-a");
    const repository = {
      loadSnapshot: () => ({
        status: "error",
        outcome: "error",
        error: new SyncBoxRepositoryError("corrupt", "同期用ローカルデータが壊れています"),
        changedCount: 0,
        queuedCount: 0,
        outboxCount: 0,
        conflictCount: 0,
        targetConflictCount: 0,
        enemyConflictCount: 0,
      }),
    };
    const html = renderToStaticMarkup(
      <AuthSessionContext.Provider value={{ state } as never}>
        <SyncMigrationReadinessContext.Provider value={{ status: "ready", ownerUid: "account-a" }}>
          <SyncBoxProvider repositoryFactory={() => repository as never}>
            <Probe />
          </SyncBoxProvider>
        </SyncMigrationReadinessContext.Provider>
      </AuthSessionContext.Provider>,
    );

    expect(html).toContain("false:同期用ローカルデータが壊れています");
    expect(html).not.toContain(">true:");
  });

  it("mounts normal sync inside migration readiness and keeps tutorial independent", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const guideMain = readFileSync(new URL("../guide/main.tsx", import.meta.url), "utf8");
    const provider = readFileSync(new URL("./SyncBoxProvider.tsx", import.meta.url), "utf8");
    expect(main).toContain('import { SyncBoxProvider } from "./sync/SyncBoxProvider"');
    expect(main).toMatch(/<SyncMigrationGate>[\s\S]*?<SyncBoxProvider>[\s\S]*?<App \/>[\s\S]*?<\/SyncBoxProvider>[\s\S]*?<\/SyncMigrationGate>/);
    expect(guideMain).not.toContain("SyncBoxProvider");
    expect(provider).toContain("active.repository && active.isAvailable");
    expect(provider).toContain('result.status === "success" ? true : previous.isAvailable');
  });
});
