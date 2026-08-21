import { describe, expect, it, vi } from "vitest";
import {
  createDraftStorageDocument,
  stringifyDraftStorageDocument,
} from "../ui/draftStorage";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "../ui/defenceSearchUi";
import {
  createBoxEntryFromState,
  type BoxEntry,
} from "../ui/boxStorage";
import {
  buildAccountExport,
  downloadAccountExport,
  exportAccountData,
  parseAccountExportDocument,
} from "./accountDataExport";
import type {
  CloudDraftRepository,
} from "./firestoreCloudDraftRepository";
import type { CloudDraftRecord } from "./cloudDraftTypes";
import type {
  CloudSyncRepository,
  SyncReadResult,
} from "./firestoreSyncRepository";
import { enqueueSyncMutation } from "./syncOutbox";
import { createEmptyLocalSyncState, type SyncRecord } from "./syncTypes";

const UID = "account-export-owner";
const NOW = "2026-08-21T09:00:00.000Z";

const entry = (id: string): BoxEntry => createBoxEntryFromState(
  { ...createDefaultTargetForm(), pokemonInput: "メガマフォクシー" },
  createDefaultScenarioForms(),
  { id, now: NOW },
);

const syncRecord = (id = "box-1"): SyncRecord => {
  const queued = enqueueSyncMutation(createEmptyLocalSyncState(UID), {
    kind: "target-box",
    entry: entry(id),
    now: NOW,
    mutationId: `mutation-${id}`,
  });
  if (queued.status === "error") throw queued.error;
  return queued.record;
};

const draftRecord = (deviceId = "device-a"): CloudDraftRecord => ({
  ownerUid: UID,
  deviceId,
  deviceLabel: "テスト端末",
  schemaVersion: 1,
  payload: stringifyDraftStorageDocument(createDraftStorageDocument(
    createDefaultTargetForm(),
    createDefaultScenarioForms(),
    new Date(NOW),
  )),
  revision: 1,
  baseRevision: 0,
  mutationId: `draft-${deviceId}`,
  updatedAt: NOW,
  expiresAt: "2026-09-01T09:00:00.000Z",
  deletedAt: null,
});

const syncRead = (records: readonly SyncRecord[] = []): SyncReadResult => ({
  status: records.length > 0 ? "success" : "empty",
  records,
  issues: [],
});

const draftRead = (records: readonly CloudDraftRecord[] = []) => ({
  status: records.length > 0 ? "success" as const : "empty" as const,
  drafts: records,
  records,
  issues: [],
});

describe("accountDataExport", () => {
  it("normalizes sync and draft payloads through the existing parsers", () => {
    const result = buildAccountExport({
      uid: UID,
      profile: {
        displayName: "テストユーザー",
        email: "user@example.test",
        photoURL: "https://example.test/avatar.png",
      },
      syncRecords: [syncRecord()],
      draftRecords: [draftRecord()],
      exportedAt: NOW,
    });

    expect(result.status).toBe("complete");
    if (result.status === "error") return;
    expect(result.document).toMatchObject({
      schemaVersion: 1,
      exportedAt: NOW,
      uid: UID,
      complete: true,
      syncRecords: [{ ownerUid: UID, entryId: "box-1", tombstone: false }],
      draftRecords: [{ ownerUid: UID, deviceId: "device-a", deletedAt: null }],
    });
    expect(parseAccountExportDocument(result.json)).toEqual(result.document);
  });

  it("never exports credentials or arbitrary profile fields", () => {
    const result = buildAccountExport({
      uid: UID,
      profile: {
        displayName: "name",
        email: "mail@example.test",
        photoURL: "photo",
      },
      syncRecords: [],
      draftRecords: [],
      exportedAt: NOW,
    });
    if (result.status === "error") throw result.error;
    expect(result.json).not.toContain("accessToken");
    expect(result.json).not.toContain("refreshToken");
    expect(result.json).not.toContain("credential");
    expect(result.json).not.toContain("password");
    expect(result.document.profile).toEqual({
      displayName: "name",
      email: "mail@example.test",
      photoURL: "photo",
    });
  });

  it("marks pending synchronization and repository issues partial", async () => {
    const calls: string[] = [];
    const syncRepository: CloudSyncRepository = {
      readAll: async () => {
        calls.push("sync-read");
        return { ...syncRead([syncRecord()]), issues: [{
          code: "invalid-document",
          reason: "invalid-document",
          type: "invalid-document",
          message: "broken",
        }] };
      },
      write: async () => ({ status: "error", issues: [], error: { kind: "unknown", message: "unused" } }),
    };
    const draftRepository: CloudDraftRepository = {
      readAll: async () => {
        calls.push("draft-read");
        return draftRead([draftRecord()]);
      },
      write: async () => ({ status: "error", issues: [], error: { kind: "unknown", message: "unused" } }),
    };

    const result = await exportAccountData({
      uid: UID,
      syncRepository,
      draftRepository,
      synchronize: async () => {
        calls.push("synchronize");
        return { status: "success", outboxCount: 1, conflictCount: 0, issues: [] };
      },
      exportedAt: NOW,
    });

    expect(calls).toEqual(["synchronize", "sync-read", "draft-read"]);
    expect(result.status).toBe("partial");
    if (result.status === "error") return;
    expect(result.document.complete).toBe(false);
    expect(result.document.warnings.map(({ code }) => code)).toEqual([
      "synchronization-incomplete",
      "sync-issues",
    ]);
  });

  it("does not produce a document when either server read fails", async () => {
    const draftRepository: CloudDraftRepository = {
      readAll: async () => draftRead(),
      write: async () => ({ status: "error", issues: [], error: { kind: "unknown", message: "unused" } }),
    };
    const syncRepository: CloudSyncRepository = {
      readAll: async () => ({
        status: "error",
        records: [],
        issues: [],
        error: { kind: "network", message: "offline" },
      }),
      write: async () => ({ status: "error", issues: [], error: { kind: "unknown", message: "unused" } }),
    };

    const result = await exportAccountData({ uid: UID, syncRepository, draftRepository });

    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.code).toBe("sync-read-failed");
  });

  it("retains tombstones by default and can omit them explicitly", () => {
    const tombstone = { ...syncRecord("deleted"), tombstone: true, deletedAt: NOW };
    const deletedDraft = { ...draftRecord("deleted-device"), deletedAt: NOW };
    const withTombstones = buildAccountExport({
      uid: UID,
      syncRecords: [tombstone],
      draftRecords: [deletedDraft],
      exportedAt: NOW,
    });
    const withoutTombstones = buildAccountExport({
      uid: UID,
      syncRecords: [tombstone],
      draftRecords: [deletedDraft],
      includeTombstones: false,
      exportedAt: NOW,
    });
    if (withTombstones.status === "error" || withoutTombstones.status === "error") {
      throw new Error("unexpected export error");
    }
    expect(withTombstones.document.syncRecords).toHaveLength(1);
    expect(withTombstones.document.draftRecords).toHaveLength(1);
    expect(withoutTombstones.document.syncRecords).toHaveLength(0);
    expect(withoutTombstones.document.draftRecords).toHaveLength(0);
  });

  it("revokes the Blob URL after downloading", () => {
    const result = buildAccountExport({ uid: UID, syncRecords: [], draftRecords: [], exportedAt: NOW });
    if (result.status === "error") throw result.error;
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    const click = vi.fn();
    const document = {
      createElement: vi.fn(() => ({ href: "", download: "", click })),
    } as unknown as Document;
    const filename = downloadAccountExport(result, {
      document,
      urlApi: { createObjectURL, revokeObjectURL },
      filename: "account.json",
    });
    expect(filename).toBe("account.json");
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});
