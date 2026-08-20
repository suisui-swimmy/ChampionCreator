import { describe, expect, it } from "vitest";
import { createBoxEntryFromState } from "../ui/boxStorage";
import { createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { enqueueSyncMutation } from "./syncOutbox";
import {
  createLocalSyncRepository,
  createMemorySyncRepository,
  parseLocalSyncState,
  stringifyLocalSyncState,
  type SyncStorageLike,
} from "./localSyncRepository";
import { createEmptyLocalSyncState, makeSyncStorageKey } from "./syncTypes";

const makeEntry = (id: string) => createBoxEntryFromState(
  createDefaultTargetForm(),
  createDefaultScenarioForms(),
  { id, now: "2026-08-21T00:00:00.000Z" },
);

const makeStorage = (initial: Record<string, string | null> = {}) => {
  const values = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: Array<[string, string]> = [];
  const storage: SyncStorageLike = {
    getItem(key) {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
  return { storage, values, reads, writes };
};

describe("localSyncRepository", () => {
  it("uses only the account-scoped sync key and distinguishes missing/valid", () => {
    const memory = makeStorage({
      "championcreator.box.v1": "legacy-target-box",
      "championcreator.enemy-box.v1": "legacy-enemy-box",
    });
    const ownerUid = "uid/日本語";
    const repository = createLocalSyncRepository(ownerUid, { storage: memory.storage });
    expect(repository.storageKey).toBe(makeSyncStorageKey(ownerUid));
    expect(repository.load()).toEqual({ status: "missing" });
    expect(memory.reads).toEqual([makeSyncStorageKey(ownerUid)]);
    expect(memory.reads).not.toContain("championcreator.box.v1");
    expect(memory.reads).not.toContain("championcreator.enemy-box.v1");

    const saved = repository.save(createEmptyLocalSyncState(ownerUid));
    expect(saved.status).toBe("valid");
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0]?.[0]).toBe(makeSyncStorageKey(ownerUid));
    expect(repository.load()).toMatchObject({ status: "valid", state: { ownerUid } });
  });

  it("saves the whole state with one atomic setItem and round-trips records/outbox", () => {
    const memory = makeStorage();
    const ownerUid = "owner-1";
    const repository = createLocalSyncRepository(ownerUid, { storage: memory.storage });
    const enqueued = enqueueSyncMutation(createEmptyLocalSyncState(ownerUid), {
      kind: "target-box",
      entry: makeEntry("id/ space"),
      now: "2026-08-21T00:00:00.000Z",
      mutationId: "m1",
    });
    expect(enqueued.status).toBe("success");
    if (enqueued.status !== "success") {
      return;
    }
    expect(repository.save(enqueued.state)).toMatchObject({ status: "valid" });
    expect(memory.writes).toHaveLength(1);
    const loaded = repository.load();
    expect(loaded.status).toBe("valid");
    if (loaded.status === "valid") {
      expect(loaded.state.records["target-box:id/ space"].entryId).toBe("id/ space");
      expect(loaded.state.outbox[0]).toMatchObject({ sequence: 1, mutationId: "m1" });
      expect(loaded.state.nextSequence).toBe(2);
    }
  });

  it("classifies malformed JSON and malformed payload as corrupt", () => {
    const ownerUid = "owner-1";
    const repository = createMemorySyncRepository(ownerUid, "not-json");
    expect(repository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });

    const state = createEmptyLocalSyncState(ownerUid);
    const enqueued = enqueueSyncMutation(state, {
      kind: "target-box",
      entry: makeEntry("future-payload"),
      mutationId: "m1",
    });
    expect(enqueued.status).toBe("success");
    if (enqueued.status !== "success") {
      return;
    }
    const parsed = JSON.parse(stringifyLocalSyncState(enqueued.state)) as {
      records: Record<string, { payload: string }>;
      outbox: Array<{ baseMutationId: string | null }>;
    };
    const payload = JSON.parse(parsed.records["target-box:future-payload"].payload) as {
      schemaVersion: number;
    };
    payload.schemaVersion = 999;
    parsed.records["target-box:future-payload"].payload = JSON.stringify(payload);
    repository.setRaw(JSON.stringify(parsed));
    expect(repository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });
  });

  it("rejects inconsistent baseMutationId values while loading the local state", () => {
    const ownerUid = "owner-1";
    const enqueued = enqueueSyncMutation(createEmptyLocalSyncState(ownerUid), {
      kind: "target-box",
      entry: makeEntry("base-mutation"),
      mutationId: "m1",
    });
    expect(enqueued.status).toBe("success");
    if (enqueued.status !== "success") {
      return;
    }
    const raw = JSON.parse(stringifyLocalSyncState(enqueued.state)) as {
      outbox: Array<{ baseMutationId: string | null }>;
    };
    raw.outbox[0].baseMutationId = "must-be-null";
    const repository = createMemorySyncRepository(ownerUid, JSON.stringify(raw));
    expect(repository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });

    const second = enqueueSyncMutation(enqueued.state, {
      kind: "target-box",
      entry: makeEntry("base-mutation"),
      mutationId: "m2",
    });
    expect(second.status).toBe("success");
    if (second.status !== "success") {
      return;
    }
    const secondRaw = JSON.parse(stringifyLocalSyncState(second.state)) as {
      outbox: Array<{ baseMutationId: string | null }>;
    };
    secondRaw.outbox[1].baseMutationId = null;
    const secondRepository = createMemorySyncRepository(ownerUid, JSON.stringify(secondRaw));
    expect(secondRepository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });
  });

  it("separates unavailable and quota failures with stable error codes", () => {
    const unavailableRepository = createLocalSyncRepository("owner-1", { storage: null });
    expect(unavailableRepository.load()).toMatchObject({
      status: "unavailable",
      error: { code: "unavailable", reason: "unavailable" },
    });
    expect(unavailableRepository.save(createEmptyLocalSyncState("owner-1"))).toMatchObject({
      status: "unavailable",
      error: { code: "unavailable" },
    });

    const memory = makeStorage();
    memory.storage.setItem = () => {
      const error = new Error("full");
      Object.defineProperty(error, "name", { value: "QuotaExceededError" });
      throw error;
    };
    const quotaRepository = createLocalSyncRepository("owner-1", { storage: memory.storage });
    expect(quotaRepository.save(createEmptyLocalSyncState("owner-1"))).toMatchObject({
      status: "quota",
      error: { code: "quota", reason: "quota" },
    });
  });

  it("rejects a state owned by another account and preserves arbitrary ids", () => {
    const ownerUid = "owner-1";
    const raw = stringifyLocalSyncState(createEmptyLocalSyncState(ownerUid));
    expect(() => parseLocalSyncState(raw, "owner-2")).toThrow();
    const memory = createMemorySyncRepository(ownerUid);
    const result = enqueueSyncMutation(createEmptyLocalSyncState(ownerUid), {
      kind: "target-box",
      entry: makeEntry("  /ユーザーID  "),
      mutationId: "m1",
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(memory.save(result.state)).toMatchObject({ status: "valid" });
      expect(memory.load()).toMatchObject({ status: "valid" });
    }
  });
});
