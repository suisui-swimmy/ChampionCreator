import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getSyncMigrationMode } from "./syncMigrationView";

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

  it("leaves normal box handlers and cloud drafts outside the M3 gate", () => {
    const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
    const gate = readFileSync(new URL("./SyncMigrationGate.tsx", import.meta.url), "utf8");

    expect(app).toContain("loadBoxEntriesFromBrowser()");
    expect(app).toContain("loadEnemyBoxEntriesFromBrowser()");
    expect(app).not.toContain("createBrowserLocalStorageMigrationController");
    expect(gate).not.toContain("DRAFT_STORAGE_KEY");
    expect(gate).not.toContain("saveBoxEntriesToBrowser");
    expect(gate).not.toContain("saveEnemyBoxEntriesToBrowser");
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
});
