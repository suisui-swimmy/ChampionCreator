import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthSessionContext } from "./authSessionContext";
import type { AuthSessionState } from "./authSession";
import {
  SyncMigrationGate,
  getSyncMigrationReadiness,
  useSyncMigrationReadiness,
} from "./SyncMigrationGate";
import {
  LocalStorageMigrationError,
  type LocalStorageMigrationResult,
} from "./localStorageMigration";
import { getSyncMigrationMode } from "./syncMigrationView";

const emptyResult = (
  overrides: Partial<LocalStorageMigrationResult> = {},
): LocalStorageMigrationResult => ({
  status: "not-started",
  state: {
    schemaVersion: 1,
    ownerUid: "account-a",
    status: "not-started",
  },
  summary: {
    deviceTargetCount: 0,
    deviceEnemyCount: 0,
    cloudTargetCount: 0,
    cloudEnemyCount: 0,
    sameCount: 0,
    conflictCount: 0,
  },
  requiresDecision: false,
  canUseDevice: true,
  ...overrides,
});

const authState = (overrides: Partial<AuthSessionState> = {}): AuthSessionState => ({
  status: "signed-out",
  availability: "available",
  user: null,
  error: null,
  ...overrides,
});

const renderReadiness = (state: AuthSessionState): string => {
  function ReadinessProbe() {
    const readiness = useSyncMigrationReadiness();
    return <output>{`${readiness.status}:${readiness.ownerUid ?? ""}`}</output>;
  }

  return renderToStaticMarkup(
    <AuthSessionContext.Provider value={{ state } as never}>
      <SyncMigrationGate controllerFactory={() => Promise.reject(new Error("not called during SSR"))}>
        <ReadinessProbe />
      </SyncMigrationGate>
    </AuthSessionContext.Provider>,
  );
};

describe("SyncMigrationGate runtime boundary", () => {
  it("mounts the one-time migration gate only around the default app entry", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    const guideMain = readFileSync(new URL("../guide/main.tsx", import.meta.url), "utf8");

    expect(main).toContain('import { SyncMigrationGate } from "./sync/SyncMigrationGate"');
    expect(main).toContain("<SyncMigrationGate>");
    expect(main).toContain("</SyncMigrationGate>");
    expect(guideMain).not.toContain("SyncMigrationGate");
    expect(guideMain).not.toContain("AuthSessionProvider");
  });

  it("gates M4 box sync by readiness while leaving guest storage and cloud drafts separate", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const gate = readFileSync(new URL("./SyncMigrationGate.tsx", import.meta.url), "utf8");
    const provider = readFileSync(new URL("./SyncBoxProvider.tsx", import.meta.url), "utf8");

    expect(app).toContain("loadBoxEntriesFromBrowser()");
    expect(app).toContain("loadEnemyBoxEntriesFromBrowser()");
    expect(app).toContain("useOptionalSyncBox()");
    expect(app).not.toContain("createBrowserLocalStorageMigrationController");
    expect(provider).toContain("useSyncMigrationReadiness()");
    expect(provider).toContain('synchronize("launch")');
    expect(provider).toContain('synchronize("focus")');
    expect(provider).toContain('synchronize("online")');
    expect(provider).toContain('synchronize("manual")');
    expect(gate).not.toContain("DRAFT_STORAGE_KEY");
    expect(gate).not.toContain("saveBoxEntriesToBrowser");
    expect(gate).not.toContain("saveEnemyBoxEntriesToBrowser");
    expect(provider).not.toContain("DRAFT_STORAGE_KEY");
  });

  it("keeps source-claimed results on the cloud-choice review surface", () => {
    expect(getSyncMigrationMode({
      status: "needs-review",
      state: {
        schemaVersion: 1,
        ownerUid: "account-b",
        status: "needs-review",
      },
      summary: {
        deviceTargetCount: 1,
        deviceEnemyCount: 0,
        cloudTargetCount: 0,
        cloudEnemyCount: 0,
        sameCount: 0,
        conflictCount: 0,
      },
      requiresDecision: true,
      canUseDevice: false,
      error: Object.assign(new Error("claimed"), {
        code: "source-claimed" as const,
        retryable: false,
      }),
    })).toBe("review");
  });

  it("exposes guest/checking readiness before an authenticated inspection settles", () => {
    expect(renderReadiness(authState())).toContain(">guest:</output>");
    expect(renderReadiness(authState({
      status: "unavailable",
      availability: "not-configured",
    }))).toContain(">guest:</output>");
    expect(renderReadiness(authState({
      status: "signed-in",
      user: {
        uid: "account-a",
        displayName: null,
        email: null,
        photoURL: null,
      },
    }))).toContain(">checking:account-a</output>");
  });

  it("maps inspection and decision results without making deferred data ready", () => {
    expect(getSyncMigrationReadiness("account-a", emptyResult())).toEqual({
      status: "checking",
      ownerUid: "account-a",
    });
    expect(getSyncMigrationReadiness("account-a", emptyResult({
      status: "needs-review",
    }))).toEqual({
      status: "review",
      ownerUid: "account-a",
    });
    expect(getSyncMigrationReadiness("account-a", emptyResult({
      requiresDecision: true,
    }))).toEqual({
      status: "review",
      ownerUid: "account-a",
    });
    expect(getSyncMigrationReadiness("account-a", emptyResult({
      error: new LocalStorageMigrationError("cloud-network", "failed"),
    }))).toEqual({
      status: "error",
      ownerUid: "account-a",
    });
    expect(getSyncMigrationReadiness("account-a", emptyResult({
      status: "completed",
    }))).toEqual({
      status: "ready",
      ownerUid: "account-a",
    });

    // `later` is represented by the gate's deferred state and is intentionally
    // not inferred from a needs-review result, so it can never be mistaken for
    // a completed migration.
    expect(getSyncMigrationReadiness("account-a", emptyResult({
      status: "needs-review",
      state: {
        schemaVersion: 1,
        ownerUid: "account-a",
        status: "needs-review",
        decision: "defer",
        reviewReason: "deferred",
      },
    })).status).not.toBe("ready");
  });
});
