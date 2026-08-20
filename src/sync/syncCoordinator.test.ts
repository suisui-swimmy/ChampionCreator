import { describe, expect, it, vi } from "vitest";
import { createDefaultBoxExampleEntry, type BoxEntry } from "../ui/boxStorage";
import { createDefaultScenarioForms } from "../ui/defenceSearchUi";
import type { EnemyBoxEntry } from "../ui/enemyBoxStorage";
import { createMemorySyncRepository } from "./localSyncRepository";
import {
  createSyncCoordinator,
  type SyncCoordinatorResult,
} from "./syncCoordinator";
import type {
  CloudSyncRepository,
  SyncReadResult,
  SyncWriteResult,
} from "./firestoreSyncRepository";
import { makeSyncRecordKey, type SyncRecord } from "./syncTypes";

const OWNER = "sync-coordinator-test";
const at = (seconds: number): string => `2026-08-21T00:00:${String(seconds).padStart(2, "0")}.000Z`;

const entry = (id: string, name = id): BoxEntry => ({
  ...createDefaultBoxExampleEntry(at(0)),
  id,
  name,
});

const enemyEntry = (id: string, name = id): EnemyBoxEntry => ({
  id,
  name,
  createdAt: at(0),
  updatedAt: at(0),
  summary: {
    pokemonName: "敵",
    conditionSummary: "条件なし",
    statPointSummary: "0シナリオ / 0攻撃",
  },
  payload: {
    schemaVersion: 11,
    scenarios: createDefaultScenarioForms(),
  },
});

const readEmpty = (): SyncReadResult => ({ status: "empty", records: [], issues: [] });

const createCloud = (options: {
  readonly read?: () => Promise<SyncReadResult>;
  readonly write?: (record: SyncRecord) => Promise<SyncWriteResult>;
} = {}): CloudSyncRepository & {
  readonly readCalls: number;
  readonly writeCalls: SyncRecord[];
} => {
  let readCalls = 0;
  const writeCalls: SyncRecord[] = [];
  return {
    get readCalls() {
      return readCalls;
    },
    writeCalls,
    readAll: async () => {
      readCalls += 1;
      return options.read ? options.read() : readEmpty();
    },
    write: async (record) => {
      writeCalls.push(record as SyncRecord);
      return options.write
        ? options.write(record as SyncRecord)
        : { status: "written", record: record as SyncRecord, issues: [] };
    },
  };
};

const queue = (id: string, options: { readonly name?: string; readonly owner?: string } = {}) => {
  const local = createMemorySyncRepository(options.owner ?? OWNER);
  const cloud = createCloud();
  const coordinator = createSyncCoordinator({ local, cloud, now: at(1) });
  const result = coordinator.queueUpsert({
    kind: "target-box",
    entry: entry(id, options.name ?? id),
    now: at(1),
    mutationId: `${id}-mutation`,
  });
  if (result.status !== "success") {
    throw new Error(result.error.message);
  }
  return { local, cloud, coordinator, state: result.state, record: result.record, mutation: result.mutation };
};

const successfulResult = (result: SyncCoordinatorResult): SyncCoordinatorResult => result;

describe("SyncCoordinator", () => {
  it("queues local state and outbox in one save without calling cloud", () => {
    const local = createMemorySyncRepository(OWNER);
    const save = vi.spyOn(local, "save");
    const cloud = createCloud();
    const coordinator = createSyncCoordinator({ local, cloud });

    const result = coordinator.queueUpsert({
      kind: "target-box",
      entry: entry("local-first"),
      mutationId: "local-first-mutation",
    });

    expect(result.status).toBe("success");
    expect(save).toHaveBeenCalledTimes(1);
    expect(cloud.readCalls).toBe(0);
    expect(cloud.writeCalls).toHaveLength(0);
    expect(result.status === "success" && result.state.outbox).toHaveLength(1);
  });

  it("keeps FIFO mutations offline and resumes in sequence", async () => {
    const local = createMemorySyncRepository(OWNER);
    let online = false;
    const cloud = createCloud({
      write: async (record) => online
        ? { status: "written", record, issues: [] }
        : {
            status: "error",
            issues: [],
            error: { kind: "network", message: "同期サーバーへ接続できません" },
          },
    });
    const coordinator = createSyncCoordinator({ local, cloud, now: at(2) });
    expect(coordinator.queueUpsert({ kind: "target-box", entry: entry("fifo-a"), mutationId: "fifo-a" }).status)
      .toBe("success");
    expect(coordinator.queueUpsert({ kind: "target-box", entry: entry("fifo-b"), mutationId: "fifo-b" }).status)
      .toBe("success");

    const offline = await coordinator.synchronize("online");
    expect(offline.status).toBe("error");
    expect(offline.outbox.map((mutation) => mutation.mutationId)).toEqual(["fifo-a", "fifo-b"]);
    expect(cloud.writeCalls.map((record) => record.mutationId)).toEqual(["fifo-a"]);

    online = true;
    const resumed = await coordinator.synchronize("manual");
    expect(resumed.status).toBe("success");
    expect(resumed.outbox).toEqual([]);
    expect(cloud.writeCalls.map((record) => record.mutationId)).toEqual(["fifo-a", "fifo-a", "fifo-b"]);
  });

  it("unions distinct target and enemy slots and never erases local data on remote empty", async () => {
    const localOnly = queue("local-slot");
    const remoteOnly = queue("remote-slot");
    const cloud = createCloud({
      read: async () => ({ status: "success", records: [remoteOnly.record], issues: [] }),
    });
    const coordinator = createSyncCoordinator({ local: localOnly.local, cloud, now: at(3) });
    const result = await coordinator.synchronize("launch");
    expect(result.records[makeSyncRecordKey("target-box", "local-slot")]).toBeDefined();
    expect(result.records[makeSyncRecordKey("target-box", "remote-slot")]).toBeDefined();

    const emptyCloud = createCloud();
    const emptyResult = await createSyncCoordinator({ local: localOnly.local, cloud: emptyCloud, now: at(4) })
      .synchronize("focus");
    expect(emptyResult.records[makeSyncRecordKey("target-box", "local-slot")]).toBeDefined();
  });

  it("keeps target-box and enemy-box entries with one shared entry id as separate slots", async () => {
    const local = createMemorySyncRepository(OWNER);
    const seed = createSyncCoordinator({ local, cloud: createCloud(), now: at(4) });
    const target = seed.queueUpsert({
      kind: "target-box",
      entry: entry("shared-entry-id", "target"),
      mutationId: "target-shared",
    });
    expect(target.status).toBe("success");

    const remoteLocal = createMemorySyncRepository(OWNER);
    const remoteSeed = createSyncCoordinator({ local: remoteLocal, cloud: createCloud(), now: at(4) });
    const enemy = remoteSeed.queueUpsert({
      kind: "enemy-box",
      entry: enemyEntry("shared-entry-id", "enemy"),
      mutationId: "enemy-shared",
    });
    expect(enemy.status).toBe("success");
    if (enemy.status !== "success") return;

    const result = await createSyncCoordinator({
      local,
      cloud: createCloud({ read: async () => ({ status: "success", records: [enemy.record], issues: [] }) }),
      now: at(5),
    }).synchronize("manual");
    expect(result.records[makeSyncRecordKey("target-box", "shared-entry-id")]).toBeDefined();
    expect(result.records[makeSyncRecordKey("enemy-box", "shared-entry-id")]).toBeDefined();
  });

  it("does not push after a read error, preserves outbox, and passes corrupt issues through", async () => {
    const queued = queue("read-error");
    const errorCloud = createCloud({
      read: async () => ({
        status: "error",
        records: [],
        issues: [],
        error: { kind: "permission-denied", message: "同期データへのアクセス権がありません" },
      }),
    });
    const errorResult = await createSyncCoordinator({ local: queued.local, cloud: errorCloud, now: at(5) })
      .synchronize("manual");
    expect(errorResult.status).toBe("error");
    expect(errorResult.outbox).toHaveLength(1);
    expect(errorCloud.writeCalls).toHaveLength(0);

    const issue = {
      code: "invalid-payload" as const,
      reason: "invalid-payload" as const,
      type: "invalid-payload" as const,
      message: "同期payloadが不正です",
    };
    const issueCloud = createCloud({
      read: async () => ({ status: "success", records: [], issues: [issue] }),
    });
    const issueResult = await createSyncCoordinator({ local: queued.local, cloud: issueCloud, now: at(6) })
      .synchronize("manual");
    expect(issueResult.issues).toContainEqual(issue);
  });

  it("keeps same-slot concurrent mutations as review conflicts in both update/delete directions", async () => {
    const first = queue("same-id");
    const remoteUpdate = {
      ...first.record,
      payload: first.record.payload.replace('"name":"same-id"', '"name":"remote-content"'),
      mutationId: "remote-update",
    };
    const updateResult = await createSyncCoordinator({
      local: first.local,
      cloud: createCloud({ read: async () => ({ status: "success", records: [remoteUpdate], issues: [] }) }),
      now: at(7),
    }).synchronize("manual");
    expect(updateResult.conflicts[makeSyncRecordKey("target-box", "same-id")]).toBeDefined();
    expect(updateResult.outbox).toHaveLength(0);

    const deleted = queue("delete-vs-update");
    const deleteRecord: SyncRecord = {
      ...deleted.record,
      revision: 2,
      baseRevision: 1,
      tombstone: true,
      deletedAt: at(8),
      mutationId: "remote-delete",
    };
    const localUpdate = deleted.coordinator.queueUpsert({
      kind: "target-box",
      entry: entry("delete-vs-update", "local-update"),
      mutationId: "local-update",
    });
    expect(localUpdate.status).toBe("success");
    const reverse = await createSyncCoordinator({
      local: deleted.local,
      cloud: createCloud({ read: async () => ({ status: "success", records: [deleteRecord], issues: [] }) }),
      now: at(9),
    }).synchronize("manual");
    expect(reverse.conflicts[makeSyncRecordKey("target-box", "delete-vs-update")]).toBeDefined();
  });

  it("keeps a local tombstone and remote update together for review", async () => {
    const local = createMemorySyncRepository(OWNER);
    const seed = createSyncCoordinator({ local, cloud: createCloud(), now: at(9) });
    const original = seed.queueUpsert({
      kind: "target-box",
      entry: entry("tombstone-vs-update", "original"),
      mutationId: "original",
    });
    expect(original.status).toBe("success");
    if (original.status !== "success") return;
    const deleted = seed.queueDelete({
      kind: "target-box",
      entryId: "tombstone-vs-update",
      mutationId: "local-delete",
    });
    expect(deleted.status).toBe("success");
    if (deleted.status !== "success") return;
    const remoteUpdate: SyncRecord = {
      ...original.record,
      revision: 2,
      baseRevision: 1,
      payload: original.record.payload.replace('"name":"original"', '"name":"remote-update"'),
      mutationId: "remote-update",
    };
    const result = await createSyncCoordinator({
      local,
      cloud: createCloud({ read: async () => ({ status: "success", records: [remoteUpdate], issues: [] }) }),
      now: at(10),
    }).synchronize("manual");
    const conflict = result.conflicts[makeSyncRecordKey("target-box", "tombstone-vs-update")];
    expect(conflict).toMatchObject({
      local: { tombstone: true, payload: original.record.payload },
      remote: { tombstone: false, mutationId: "remote-update" },
    });
    expect(result.outbox).toEqual([]);
  });

  it("acks a lost write response on the next pull with the same mutation id", async () => {
    const local = createMemorySyncRepository(OWNER);
    let remote: SyncRecord | undefined;
    const cloud = createCloud({
      read: async () => remote
        ? { status: "success", records: [remote], issues: [] }
        : readEmpty(),
      write: async (record) => {
        remote = record;
        throw new Error("response lost");
      },
    });
    const coordinator = createSyncCoordinator({ local, cloud, now: at(10) });
    const queued = coordinator.queueUpsert({ kind: "target-box", entry: entry("lost-ack"), mutationId: "lost-ack" });
    expect(queued.status).toBe("success");
    const first = await coordinator.synchronize("manual");
    expect(first.status).toBe("error");
    expect(first.outbox).toHaveLength(1);
    const second = await coordinator.synchronize("manual");
    expect(second.status).toBe("success");
    expect(second.outbox).toHaveLength(0);
    expect(cloud.writeCalls.map((record) => record.mutationId)).toEqual(["lost-ack"]);
  });

  it("continues another slot after a conflict and does not duplicate an existing conflict", async () => {
    const local = createMemorySyncRepository(OWNER);
    const coordinator = createSyncCoordinator({ local, cloud: createCloud(), now: at(11) });
    const a = coordinator.queueUpsert({ kind: "target-box", entry: entry("conflict-a"), mutationId: "a" });
    const b = coordinator.queueUpsert({ kind: "target-box", entry: entry("continue-b"), mutationId: "b" });
    expect(a.status).toBe("success");
    expect(b.status).toBe("success");
    if (a.status !== "success" || b.status !== "success") return;
    const remoteA = {
      ...a.record,
      payload: a.record.payload.replace('"name":"conflict-a"', '"name":"remote-a"'),
      mutationId: "remote-a",
    };
    const cloud = createCloud({
      read: async () => ({ status: "success", records: [remoteA], issues: [] }),
    });
    const writes: string[] = [];
    cloud.writeCalls.length = 0;
    (cloud as unknown as { write: (record: SyncRecord) => Promise<SyncWriteResult> }).write = async (record: SyncRecord) => {
      writes.push(record.mutationId);
      return { status: "written", record: record as SyncRecord, issues: [] };
    };
    const run = createSyncCoordinator({ local, cloud, now: at(12) });
    const first = await run.synchronize("manual");
    expect(first.conflicts[makeSyncRecordKey("target-box", "conflict-a")]).toBeDefined();
    expect(writes).toEqual(["b"]);
    const second = await run.synchronize("manual");
    expect(Object.keys(second.conflicts)).toEqual([makeSyncRecordKey("target-box", "conflict-a")]);
    expect(writes).toEqual(["b"]);
  });

  it("treats same-revision different mutations as conflict and allows multi-revision remote pulls", async () => {
    const localOnly = queue("same-revision");
    const sameRevision = {
      ...localOnly.record,
      mutationId: "other-mutation",
      payload: localOnly.record.payload.replace('"name":"same-revision"', '"name":"other"'),
    };
    const sameResult = await createSyncCoordinator({
      local: localOnly.local,
      cloud: createCloud({ read: async () => ({ status: "success", records: [sameRevision], issues: [] }) }),
      now: at(13),
    }).synchronize("manual");
    // The original record is pending, so a revision 1 remote is a divergence.
    expect(sameResult.conflicts[makeSyncRecordKey("target-box", "same-revision")]).toBeDefined();

    const remoteBase = queue("remote-gap");
    const remoteRevision = { ...remoteBase.record, revision: 3, baseRevision: 2, mutationId: "remote-3" };
    const pull = await createSyncCoordinator({
      local: createMemorySyncRepository(OWNER),
      cloud: createCloud({ read: async () => ({ status: "success", records: [remoteRevision], issues: [] }) }),
      now: at(14),
    }).synchronize("manual");
    expect(pull.records[remoteRevision.recordKey]).toMatchObject({ revision: 3 });
    expect(pull.conflicts).toEqual({});
  });

  it("does not accept a same-revision base from a different mutation", async () => {
    const local = createMemorySyncRepository(OWNER);
    const seed = createSyncCoordinator({ local, cloud: createCloud(), now: at(18) });
    const first = seed.queueUpsert({
      kind: "target-box",
      entry: entry("base-fork"),
      mutationId: "base-mutation",
    });
    expect(first.status).toBe("success");
    if (first.status !== "success") return;
    const second = seed.queueUpsert({
      kind: "target-box",
      entry: entry("base-fork", "local-next"),
      mutationId: "local-next",
    });
    expect(second.status).toBe("success");
    if (second.status !== "success") return;
    // Model a prior acknowledgement of revision 1 while revision 2 remains
    // pending. The remote revision 1 has a different mutation identity.
    local.save({
      ...second.state,
      outbox: [second.mutation],
    });
    const remoteBase = {
      ...first.record,
      mutationId: "other-base-mutation",
    };
    const result = await createSyncCoordinator({
      local,
      cloud: createCloud({ read: async () => ({ status: "success", records: [remoteBase], issues: [] }) }),
      now: at(19),
    }).synchronize("manual");
    expect(result.conflicts[makeSyncRecordKey("target-box", "base-fork")]).toMatchObject({
      reason: "same-revision-base-diverged",
    });
    expect(result.outbox).toEqual([]);
  });

  it("shares one in-flight pull for concurrent triggers", async () => {
    let resolveRead: ((value: SyncReadResult) => void) | undefined;
    const read = vi.fn(() => new Promise<SyncReadResult>((resolve) => {
      resolveRead = resolve;
    }));
    const cloud = createCloud({ read });
    const coordinator = createSyncCoordinator({
      local: createMemorySyncRepository(OWNER),
      cloud,
      now: at(15),
    });
    const first = coordinator.synchronize("launch");
    const second = coordinator.synchronize("focus");
    expect(first).toBe(second);
    expect(read).toHaveBeenCalledTimes(1);
    resolveRead?.(readEmpty());
    await first;
  });

  it("retains a mutation queued while readAll is deferred and pushes it in the same run", async () => {
    let resolveRead: ((value: SyncReadResult) => void) | undefined;
    const cloud = createCloud({
      read: () => new Promise<SyncReadResult>((resolve) => {
        resolveRead = resolve;
      }),
    });
    const local = createMemorySyncRepository(OWNER);
    const coordinator = createSyncCoordinator({ local, cloud, now: at(16) });
    expect(coordinator.queueUpsert({
      kind: "target-box",
      entry: entry("deferred-read-a"),
      mutationId: "deferred-read-a",
    }).status).toBe("success");

    const running = coordinator.synchronize("manual");
    expect(coordinator.queueUpsert({
      kind: "target-box",
      entry: entry("deferred-read-b"),
      mutationId: "deferred-read-b",
    }).status).toBe("success");
    resolveRead?.(readEmpty());

    const result = await running;
    expect(result.status).toBe("success");
    expect(cloud.writeCalls.map((record) => record.mutationId)).toEqual([
      "deferred-read-a",
      "deferred-read-b",
    ]);
    expect(result.outbox).toEqual([]);
  });

  it("retains a mutation queued while write is deferred and pushes it after the acknowledged one", async () => {
    let resolveWrite: ((value: SyncWriteResult) => void) | undefined;
    let firstWrite = true;
    const cloud = createCloud({
      write: (record) => {
        if (firstWrite) {
          firstWrite = false;
          return new Promise<SyncWriteResult>((resolve) => {
            resolveWrite = resolve;
          });
        }
        return Promise.resolve({ status: "written", record, issues: [] });
      },
    });
    const local = createMemorySyncRepository(OWNER);
    const coordinator = createSyncCoordinator({ local, cloud, now: at(17) });
    expect(coordinator.queueUpsert({
      kind: "target-box",
      entry: entry("deferred-write-a"),
      mutationId: "deferred-write-a",
    }).status).toBe("success");

    const running = coordinator.synchronize("manual");
    expect(coordinator.queueUpsert({
      kind: "target-box",
      entry: entry("deferred-write-b"),
      mutationId: "deferred-write-b",
    }).status).toBe("success");
    // Let the immediate empty pull continuation reach the deferred write.
    await Promise.resolve();
    const first = cloud.writeCalls[0];
    expect(first?.mutationId).toBe("deferred-write-a");
    resolveWrite?.({ status: "written", record: first, issues: [] });

    const result = await running;
    expect(result.status).toBe("success");
    expect(cloud.writeCalls.map((record) => record.mutationId)).toEqual([
      "deferred-write-a",
      "deferred-write-b",
    ]);
    expect(result.outbox).toEqual([]);
  });

  it("stores primitive lifecycle metadata", async () => {
    const queued = queue("metadata");
    const result = successfulResult(await queued.coordinator.synchronize("manual"));
    expect(result.metadata.trigger).toBe("manual");
    for (const key of ["lastAttempt", "lastPull", "lastPush", "error", "trigger"]) {
      const value = result.metadata[key];
      expect(value === null || ["string", "number", "boolean"].includes(typeof value)).toBe(true);
    }
  });
});
