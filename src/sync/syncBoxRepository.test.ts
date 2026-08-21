import { describe, expect, it, vi } from "vitest";
import {
  createBoxEntryFromState,
  type BoxEntry,
} from "../ui/boxStorage";
import {
  createEnemyBoxEntryFromScenarios,
  type EnemyBoxEntry,
} from "../ui/enemyBoxStorage";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "../ui/defenceSearchUi";
import type {
  CloudSyncRepository,
  SyncRecordInput,
  SyncWriteResult,
} from "./firestoreSyncRepository";
import { createMemorySyncRepository } from "./localSyncRepository";
import { enqueueSyncMutation } from "./syncOutbox";
import {
  createEmptyLocalSyncState,
  makeSyncRecordKey,
  type SyncConflict,
  type SyncKind,
  type SyncRecord,
} from "./syncTypes";
import { createSyncBoxRepository } from "./syncBoxRepository";

const OWNER = "sync-box-test-owner";
const NOW = "2026-08-21T12:00:00.000Z";

const targetEntry = (
  id: string,
  options: { readonly name?: string; readonly createdAt?: string; readonly now?: string } = {},
): BoxEntry => createBoxEntryFromState(
  { ...createDefaultTargetForm(), pokemonInput: options.name ?? id },
  createDefaultScenarioForms(),
  {
    id,
    createdAt: options.createdAt ?? NOW,
    now: options.now ?? NOW,
  },
);

const enemyEntry = (
  id: string,
  options: { readonly createdAt?: string; readonly now?: string } = {},
): EnemyBoxEntry => createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
  id,
  createdAt: options.createdAt ?? NOW,
  now: options.now ?? NOW,
});

const remoteRecord = (
  ownerUid: string,
  kind: SyncKind,
  entry: BoxEntry | EnemyBoxEntry,
): SyncRecord => {
  const result = enqueueSyncMutation(createEmptyLocalSyncState(ownerUid), {
    kind,
    entry: entry as never,
    now: NOW,
    mutationId: `remote-${kind}-${entry.id}`,
  });
  if (result.status === "error") throw result.error;
  return result.record;
};

const createCloud = (
  initial: readonly SyncRecord[] = [],
): CloudSyncRepository & { readonly writes: SyncRecord[] } => {
  const records = new Map(initial.map((record) => [record.recordKey, record]));
  const writes: SyncRecord[] = [];
  return {
    writes,
    readAll: async () => ({
      status: records.size > 0 ? "success" as const : "empty" as const,
      records: [...records.values()],
      issues: [],
    }),
    write: async (input: SyncRecordInput): Promise<SyncWriteResult> => {
      const record = input as SyncRecord;
      writes.push(record);
      records.set(record.recordKey, record);
      return { status: "written", record, issues: [] };
    },
  };
};

const makeRepository = (
  initial?: readonly SyncRecord[],
) => {
  const local = createMemorySyncRepository(OWNER);
  const cloud = createCloud(initial);
  const repository = createSyncBoxRepository({
    local,
    cloud,
    now: NOW,
    mutationIdFactory: ({ kind, entryId, operation, index }) => (
      `${operation}-${kind}-${entryId}-${index}`
    ),
  });
  return { local, cloud, repository };
};

describe("SyncBoxRepository", () => {
  it("keeps target and enemy entries with the same id in separate kinds", () => {
    const { repository } = makeRepository();
    const target = targetEntry("shared-id", { name: "target" });
    const enemy = enemyEntry("shared-id");

    expect(repository.saveTargetEntries([target]).status).toBe("success");
    expect(repository.saveEnemyEntries([enemy]).status).toBe("success");

    const snapshot = repository.loadSnapshot();
    expect(snapshot.status).toBe("success");
    if (snapshot.status !== "success") return;
    expect(snapshot.snapshot.targetEntries.map((entry) => entry.id)).toEqual(["shared-id"]);
    expect(snapshot.snapshot.enemyEntries.map((entry) => entry.id)).toEqual(["shared-id"]);
  });

  it("does not save or queue a semantic no-op", () => {
    const { local, repository } = makeRepository();
    const entry = targetEntry("no-op");
    const first = repository.saveTargetEntries([entry]);
    expect(first.status).toBe("success");
    const save = vi.spyOn(local, "save");

    const second = repository.saveTargetEntries([entry]);
    expect(second).toMatchObject({
      status: "success",
      changedCount: 0,
      queuedCount: 0,
      outboxCount: 1,
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("queues upsert, delete, and tombstone restore while hiding deleted entries", () => {
    const { local, repository } = makeRepository();
    const original = targetEntry("restore-me", { name: "first" });
    const updated = targetEntry("restore-me", { name: "second", now: "2026-08-21T12:01:00.000Z" });

    expect(repository.saveTargetEntries([original])).toMatchObject({
      status: "success",
      changedCount: 1,
      queuedCount: 1,
    });
    expect(repository.saveTargetEntries([updated])).toMatchObject({
      status: "success",
      changedCount: 1,
      queuedCount: 1,
    });
    const deleted = repository.saveTargetEntries([]);
    expect(deleted).toMatchObject({ status: "success", changedCount: 1, queuedCount: 1 });
    const hidden = repository.loadSnapshot();
    expect(hidden.status).toBe("success");
    if (hidden.status !== "success") return;
    expect(hidden.snapshot.targetEntries).toEqual([]);
    const stateAfterDelete = local.load();
    expect(stateAfterDelete.status).toBe("valid");
    if (stateAfterDelete.status !== "valid") return;
    expect(stateAfterDelete.state.records[makeSyncRecordKey("target-box", "restore-me")])
      .toMatchObject({ tombstone: true, payload: expect.any(String) });

    const restored = repository.saveTargetEntries([updated]);
    expect(restored).toMatchObject({ status: "success", changedCount: 1, queuedCount: 1 });
    const stateAfterRestore = local.load();
    expect(stateAfterRestore.status).toBe("valid");
    if (stateAfterRestore.status !== "valid") return;
    expect(stateAfterRestore.state.records[makeSyncRecordKey("target-box", "restore-me")])
      .toMatchObject({ tombstone: false });
    expect(repository.loadSnapshot()).toMatchObject({
      status: "success",
      snapshot: { targetEntries: [updated] },
    });
  });

  it("fails duplicate IDs atomically and preserves the other kind", () => {
    const { local, repository } = makeRepository();
    const enemy = enemyEntry("unchanged-enemy");
    expect(repository.saveEnemyEntries([enemy]).status).toBe("success");
    const before = local.raw;
    const save = vi.spyOn(local, "save");

    const result = repository.saveTargetEntries([targetEntry("duplicate"), targetEntry("duplicate")]);
    expect(result).toMatchObject({ status: "error", error: { code: "duplicate-id" } });
    expect(save).not.toHaveBeenCalled();
    expect(local.raw).toBe(before);
    expect(repository.loadSnapshot()).toMatchObject({
      status: "success",
      snapshot: { targetEntries: [], enemyEntries: [enemy] },
    });
  });

  it("fails a whole batch when one desired slot is conflicted", () => {
    const { local, repository } = makeRepository();
    const first = targetEntry("first");
    const conflicted = targetEntry("conflicted");
    expect(repository.saveTargetEntries([first, conflicted]).status).toBe("success");
    const stateResult = local.load();
    expect(stateResult.status).toBe("valid");
    if (stateResult.status !== "valid") return;
    const key = makeSyncRecordKey("target-box", conflicted.id);
    const record = stateResult.state.records[key];
    expect(record).toBeDefined();
    if (!record) return;
    const conflict: SyncConflict = {
      recordKey: key,
      kind: "target-box",
      entryId: conflicted.id,
      local: record,
      remote: {
        ...record,
        payload: remoteRecord(OWNER, "target-box", targetEntry(conflicted.id, { name: "remote" })).payload,
      },
      detectedAt: NOW,
      reason: "test-conflict",
    };
    const conflictedState = {
      ...stateResult.state,
      outbox: [],
      conflicts: { [key]: conflict },
    };
    expect(local.save(conflictedState).status).toBe("valid");
    const before = local.raw;
    const save = vi.spyOn(local, "save");

    const result = repository.saveTargetEntries([first, targetEntry("new-slot")]);
    expect(result).toMatchObject({ status: "error", error: { code: "conflict" } });
    expect(save).not.toHaveBeenCalled();
    expect(local.raw).toBe(before);
  });

  it("allows an unrelated slot update while preserving a conflicted local branch", () => {
    const { local, repository } = makeRepository();
    const conflicted = targetEntry("conflicted", { name: "local" });
    const editable = targetEntry("editable", { name: "before" });
    expect(repository.saveTargetEntries([conflicted, editable]).status).toBe("success");
    const loaded = local.load();
    expect(loaded.status).toBe("valid");
    if (loaded.status !== "valid") return;
    const key = makeSyncRecordKey("target-box", conflicted.id);
    const localRecord = loaded.state.records[key];
    expect(localRecord).toBeDefined();
    if (!localRecord) return;
    const conflict: SyncConflict = {
      recordKey: key,
      kind: "target-box",
      entryId: conflicted.id,
      local: localRecord,
      remote: {
        ...localRecord,
        payload: remoteRecord(
          OWNER,
          "target-box",
          targetEntry(conflicted.id, { name: "remote" }),
        ).payload,
      },
      detectedAt: NOW,
      reason: "test-conflict",
    };
    expect(local.save({
      ...loaded.state,
      outbox: [],
      conflicts: { [key]: conflict },
    }).status).toBe("valid");

    const updatedEditable = targetEntry("editable", {
      name: "after",
      now: "2026-08-21T12:05:00.000Z",
    });
    const result = repository.saveTargetEntries([conflicted, updatedEditable]);
    expect(result).toMatchObject({
      status: "success",
      changedCount: 1,
      queuedCount: 1,
      targetConflictCount: 1,
    });
    expect(repository.loadSnapshot()).toMatchObject({
      status: "success",
      snapshot: {
        targetEntries: expect.arrayContaining([conflicted, updatedEditable]),
        targetConflictCount: 1,
      },
    });
  });

  it("orders by createdAt descending and exposes the local conflict payload", () => {
    const { local, repository } = makeRepository();
    const older = targetEntry("z-id", { createdAt: "2026-08-21T10:00:00.000Z" });
    const newerLocal = targetEntry("a-id", {
      name: "local-branch",
      createdAt: "2026-08-21T11:00:00.000Z",
    });
    expect(repository.saveTargetEntries([older, newerLocal]).status).toBe("success");
    const loaded = local.load();
    expect(loaded.status).toBe("valid");
    if (loaded.status !== "valid") return;
    const key = makeSyncRecordKey("target-box", newerLocal.id);
    const record = loaded.state.records[key];
    expect(record).toBeDefined();
    if (!record) return;
    const remoteBranch = targetEntry("a-id", {
      name: "remote-branch",
      createdAt: "2026-08-21T11:00:00.000Z",
    });
    const conflict: SyncConflict = {
      recordKey: key,
      kind: "target-box",
      entryId: key.slice("target-box:".length),
      local: record,
      remote: {
        ...record,
        payload: remoteRecord(OWNER, "target-box", remoteBranch).payload,
      },
      detectedAt: NOW,
      reason: "test-conflict",
    };
    expect(local.save({
      ...loaded.state,
      outbox: [],
      conflicts: { [key]: conflict },
    }).status).toBe("valid");

    const snapshot = repository.loadSnapshot();
    expect(snapshot).toMatchObject({
      status: "success",
      targetConflictCount: 1,
      snapshot: {
        targetConflictCount: 1,
        conflictCount: 1,
        targetEntries: [newerLocal, older],
      },
    });
    if (snapshot.status !== "success") return;
    expect(snapshot.snapshot.targetEntries[0]?.name).toBe("local-branch");
  });

  it("returns a normalized remote snapshot after synchronize", async () => {
    const remoteTarget = targetEntry("remote-target", { createdAt: "2026-08-21T13:00:00.000Z" });
    const remoteEnemy = enemyEntry("remote-enemy", { createdAt: "2026-08-21T12:00:00.000Z" });
    const { repository } = makeRepository([
      remoteRecord(OWNER, "target-box", remoteTarget),
      remoteRecord(OWNER, "enemy-box", remoteEnemy),
    ]);

    const result = await repository.synchronize("manual");
    expect(result).toMatchObject({
      status: "success",
      trigger: "manual",
      remoteStatus: "success",
      pulledRecords: 2,
      snapshot: {
        targetEntries: [remoteTarget],
        enemyEntries: [remoteEnemy],
        outboxCount: 0,
        conflictCount: 0,
      },
    });
  });

  it("exposes decoded conflict details and keeps both branches with one atomic save", () => {
    const localEntry = targetEntry("same-slot", { name: "local" });
    const remoteEntry = targetEntry("same-slot", { name: "remote" });
    const { local, repository } = makeRepository([remoteRecord(OWNER, "target-box", remoteEntry)]);
    expect(repository.saveTargetEntries([localEntry]).status).toBe("success");

    const loaded = local.load();
    expect(loaded.status).toBe("valid");
    if (loaded.status !== "valid") return;
    const recordKey = makeSyncRecordKey("target-box", localEntry.id);
    const localRecord = loaded.state.records[recordKey];
    expect(localRecord).toBeDefined();
    if (!localRecord) return;
    const remote = remoteRecord(OWNER, "target-box", remoteEntry);
    const conflict: SyncConflict = {
      recordKey,
      kind: "target-box",
      entryId: localEntry.id,
      local: localRecord,
      remote,
      detectedAt: NOW,
      reason: "test-conflict",
    };
    expect(local.save({
      ...loaded.state,
      outbox: [],
      conflicts: { [recordKey]: conflict },
    }).status).toBe("valid");

    const save = vi.spyOn(local, "save");
    const before = repository.loadSnapshot();
    expect(before.status).toBe("success");
    if (before.status !== "success") return;
    expect(before.snapshot.conflicts).toHaveLength(1);
    expect(before.snapshot.conflicts[0]).toMatchObject({
      recordKey,
      localEntry,
      remoteEntry,
      localTombstone: false,
      remoteTombstone: false,
    });

    const result = repository.resolveConflict("target-box", localEntry.id, "keep-both");
    expect(result).toMatchObject({
      status: "success",
      changedCount: 2,
      queuedCount: 1,
      conflictCount: 0,
    });
    expect(save).toHaveBeenCalledTimes(1);
    if (result.status !== "success") return;
    expect(result.snapshot.conflicts).toEqual([]);
    expect(result.snapshot.targetEntries).toHaveLength(2);
    expect(result.snapshot.targetEntries).toEqual(expect.arrayContaining([
      remoteEntry,
      expect.objectContaining({
        id: expect.stringMatching(/^m6-local-[0-9a-f]{64}$/),
        name: "local（このブラウザ）",
      }),
    ]));
  });

  it.each([
    ["keep-local", "local"],
    ["keep-remote", "remote"],
  ] as const)("resolves %s at the original slot", (decision, expectedName) => {
    const localEntry = targetEntry("same-slot", { name: "local" });
    const remoteEntry = targetEntry("same-slot", { name: "remote" });
    const { local, repository } = makeRepository([remoteRecord(OWNER, "target-box", remoteEntry)]);
    expect(repository.saveTargetEntries([localEntry]).status).toBe("success");

    const loaded = local.load();
    expect(loaded.status).toBe("valid");
    if (loaded.status !== "valid") return;
    const recordKey = makeSyncRecordKey("target-box", localEntry.id);
    const localRecord = loaded.state.records[recordKey];
    if (!localRecord) return;
    const conflict: SyncConflict = {
      recordKey,
      kind: "target-box",
      entryId: localEntry.id,
      local: localRecord,
      remote: remoteRecord(OWNER, "target-box", remoteEntry),
      detectedAt: NOW,
      reason: "test-conflict",
    };
    expect(local.save({ ...loaded.state, outbox: [], conflicts: { [recordKey]: conflict } }).status)
      .toBe("valid");

    const result = repository.resolveConflict(recordKey, decision);
    expect(result).toMatchObject({ status: "success", conflictCount: 0 });
    if (result.status !== "success") return;
    expect(result.snapshot.targetEntries).toHaveLength(1);
    expect(result.snapshot.targetEntries[0]?.name).toBe(expectedName);
    expect(result.queuedCount).toBe(decision === "keep-local" ? 1 : 0);
    if (decision === "keep-local") {
      expect(result.snapshot.outboxCount).toBe(1);
    } else {
      expect(result.snapshot.outboxCount).toBe(0);
    }
  });
});
