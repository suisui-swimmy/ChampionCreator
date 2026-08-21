import { describe, expect, it } from "vitest";
import {
  BOX_DEFAULT_EXAMPLE_SEEDED_KEY,
  BOX_STORAGE_KEY,
  createBoxEntryFromState,
  createDefaultBoxExampleEntry,
  parseBoxBackupDocument,
  stringifyBoxBackupDocument,
  stringifyBoxStorageDocument,
  type BoxEntry,
} from "../ui/boxStorage";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "../ui/defenceSearchUi";
import {
  ENEMY_BOX_STORAGE_KEY,
  createEnemyBoxEntryFromScenarios,
  stringifyEnemyBoxStorageDocument,
  type EnemyBoxEntry,
} from "../ui/enemyBoxStorage";
import type {
  CloudSyncRepository,
  SyncReadResult,
  SyncRecordInput,
  SyncWriteResult,
} from "./firestoreSyncRepository";
import {
  createLocalSyncRepository,
  type LocalSyncRepository,
} from "./localSyncRepository";
import {
  createLocalStorageMigrationController,
  MIGRATION_SOURCE_CLAIM_STORAGE_KEY,
} from "./localStorageMigration";
import {
  createMigrationStateRepository,
  makeMigrationStateStorageKey,
  MigrationStateRepositoryError,
  type MigrationStateRepository,
  type MigrationStateStorageLike,
} from "./migrationStorage";
import { decodeSyncPayload } from "./syncPayload";
import {
  createEmptyLocalSyncState,
  makeSyncRecordKey,
  makeSyncStorageKey,
  type SyncRecord,
} from "./syncTypes";
import { enqueueSyncMutation } from "./syncOutbox";

const OWNER = "migration-owner-a";
const NOW = "2026-08-21T09:00:00.000Z";

const makeStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  const writes: Array<{ key: string; value: string }> = [];
  const storage: MigrationStateStorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      writes.push({ key, value });
      values.set(key, value);
    },
  };
  return { values, writes, storage };
};

const targetEntry = (id: string, pokemonInput = "メガマフォクシー"): BoxEntry => (
  createBoxEntryFromState(
    { ...createDefaultTargetForm(), pokemonInput },
    createDefaultScenarioForms(),
    { id, now: NOW },
  )
);

const enemyEntry = (id: string): EnemyBoxEntry => (
  createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), { id, now: NOW })
);

const toRemote = (
  ownerUid: string,
  kind: "target-box" | "enemy-box",
  entry: BoxEntry | EnemyBoxEntry,
  mutationId = `remote-${entry.id}`,
): SyncRecord => {
  const queued = enqueueSyncMutation(createEmptyLocalSyncState(ownerUid), {
    kind,
    entry: entry as never,
    now: NOW,
    mutationId,
  });
  if (queued.status === "error") throw queued.error;
  return queued.record;
};

const sameMutationContent = (left: SyncRecord, right: SyncRecord): boolean => (
  left.ownerUid === right.ownerUid
  && left.kind === right.kind
  && left.entryId === right.entryId
  && left.revision === right.revision
  && left.baseRevision === right.baseRevision
  && left.payload === right.payload
  && left.tombstone === right.tombstone
  && left.deletedAt === right.deletedAt
  && left.mutationId === right.mutationId
);

const makeCloud = (
  initial: readonly SyncRecord[] = [],
  options: {
    lostFirstWrite?: boolean;
    readError?: SyncReadResult;
    onWrite?: (record: SyncRecord) => void;
  } = {},
): CloudSyncRepository & {
  readonly records: Map<string, SyncRecord>;
  readonly writes: SyncRecord[];
  readonly readCount: number;
} => {
  const records = new Map(initial.map((record) => [record.recordKey, record]));
  const writes: SyncRecord[] = [];
  let readCount = 0;
  let loseNextWrite = options.lostFirstWrite === true;
  return {
    records,
    writes,
    get readCount() {
      return readCount;
    },
    readAll: async () => {
      readCount += 1;
      if (options.readError) return options.readError;
      const remote = [...records.values()];
      return {
        status: remote.length > 0 ? "success" as const : "empty" as const,
        records: remote,
        issues: [],
      };
    },
    write: async (input: SyncRecordInput): Promise<SyncWriteResult> => {
      const record = input as SyncRecord;
      writes.push(record);
      const current = records.get(record.recordKey);
      if (current?.mutationId === record.mutationId) {
        return sameMutationContent(current, record)
          ? { status: "duplicate", record, remote: current, issues: [] }
          : { status: "conflict", record, remote: current, issues: [] };
      }
      if ((current?.revision ?? 0) !== record.baseRevision) {
        return { status: "conflict", record, remote: current, issues: [] };
      }
      records.set(record.recordKey, record);
      options.onWrite?.(record);
      if (loseNextWrite) {
        loseNextWrite = false;
        return {
          status: "error",
          issues: [],
          error: { kind: "network", message: "lost response" },
        };
      }
      return { status: "written", record, remote: current, issues: [] };
    },
  };
};

const makeController = (
  ownerUid: string,
  storage: MigrationStateStorageLike,
  cloud: CloudSyncRepository,
  local: LocalSyncRepository = createLocalSyncRepository(ownerUid, { storage }),
) => createLocalStorageMigrationController({
  ownerUid,
  migrationState: createMigrationStateRepository(ownerUid, { storage }),
  local,
  cloud,
  legacyStorage: storage,
  claimStorage: storage,
  now: NOW,
});

describe("LocalStorageMigrationController", () => {
  it("uploads local-only target and enemy entries, then commits completed last", async () => {
    const target = targetEntry("local-target");
    const enemy = enemyEntry("local-enemy");
    const defaultEntry = createDefaultBoxExampleEntry(NOW);
    const targetRaw = stringifyBoxStorageDocument([defaultEntry, target]);
    const enemyRaw = stringifyEnemyBoxStorageDocument([enemy]);
    const memory = makeStorage({
      [BOX_STORAGE_KEY]: targetRaw,
      [ENEMY_BOX_STORAGE_KEY]: enemyRaw,
      [BOX_DEFAULT_EXAMPLE_SEEDED_KEY]: "1",
    });
    const cloud = makeCloud();

    const result = await makeController(OWNER, memory.storage, cloud).inspect();

    expect(result.status).toBe("completed");
    expect(result.summary).toMatchObject({ deviceTargetCount: 1, deviceEnemyCount: 1 });
    expect([...cloud.records.keys()].sort()).toEqual([
      makeSyncRecordKey("enemy-box", "local-enemy"),
      makeSyncRecordKey("target-box", "local-target"),
    ]);
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe(targetRaw);
    expect(memory.values.get(ENEMY_BOX_STORAGE_KEY)).toBe(enemyRaw);
    expect(memory.values.get(BOX_DEFAULT_EXAMPLE_SEEDED_KEY)).toBe("1");
    expect(memory.values.has(makeSyncStorageKey(OWNER))).toBe(true);
    expect(JSON.parse(memory.values.get(makeMigrationStateStorageKey(OWNER)) ?? "{}")).toMatchObject({
      status: "completed",
      decision: "use-device",
    });
    const markerWrites = memory.writes
      .filter(({ key }) => key === makeMigrationStateStorageKey(OWNER))
      .map(({ value }) => JSON.parse(value).status);
    expect(markerWrites.at(0)).toBe("in-progress");
    expect(markerWrites.at(-1)).toBe("completed");
  });

  it("shares one in-flight inspection so StrictMode cannot duplicate migration writes", async () => {
    const entry = targetEntry("strict-mode-local");
    const memory = makeStorage({
      [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([entry]),
    });
    const cloud = makeCloud();
    const controller = makeController(OWNER, memory.storage, cloud);

    const first = controller.inspect();
    const second = controller.inspect();

    expect(second).toBe(first);
    expect((await first).status).toBe("completed");
    expect(cloud.writes).toHaveLength(1);
  });

  it("keeps a completed one-time marker completed when a stale caller decides again", async () => {
    const entry = targetEntry("completed-once");
    const memory = makeStorage({ [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([entry]) });
    const cloud = makeCloud();
    const controller = makeController(OWNER, memory.storage, cloud);
    expect((await controller.inspect()).status).toBe("completed");
    const writes = cloud.writes.length;

    const staleDecision = await controller.decide("device");

    expect(staleDecision.status).toBe("completed");
    expect(cloud.writes).toHaveLength(writes);
    expect(JSON.parse(memory.values.get(makeMigrationStateStorageKey(OWNER)) ?? "{}").status)
      .toBe("completed");
  });

  it("pulls cloud-only data without issuing a cloud write", async () => {
    const remote = toRemote(OWNER, "target-box", targetEntry("cloud-only"));
    const memory = makeStorage();
    const cloud = makeCloud([remote]);

    const result = await makeController(OWNER, memory.storage, cloud).inspect();

    expect(result.status).toBe("completed");
    expect(cloud.writes).toEqual([]);
    expect(JSON.parse(memory.values.get(makeSyncStorageKey(OWNER)) ?? "{}").records)
      .toHaveProperty(makeSyncRecordKey("target-box", "cloud-only"));
  });

  it("completes both-empty migration without creating a box or cloud write", async () => {
    const memory = makeStorage();
    const cloud = makeCloud();

    const result = await makeController(OWNER, memory.storage, cloud).inspect();

    expect(result.status).toBe("completed");
    expect(result.summary).toEqual({
      deviceTargetCount: 0,
      deviceEnemyCount: 0,
      cloudTargetCount: 0,
      cloudEnemyCount: 0,
      sameCount: 0,
      conflictCount: 0,
    });
    expect(cloud.writes).toEqual([]);
    expect(memory.values.has(BOX_STORAGE_KEY)).toBe(false);
    expect(memory.values.has(ENEMY_BOX_STORAGE_KEY)).toBe(false);
  });

  it("asks even for identical data and deduplicates it after union", async () => {
    const entry = targetEntry("same-slot");
    const raw = stringifyBoxStorageDocument([entry]);
    const memory = makeStorage({ [BOX_STORAGE_KEY]: raw });
    const cloud = makeCloud([toRemote(OWNER, "target-box", entry)]);
    const controller = makeController(OWNER, memory.storage, cloud);

    const inspection = await controller.inspect();
    expect(inspection).toMatchObject({
      status: "needs-review",
      requiresDecision: true,
      summary: { sameCount: 1, conflictCount: 0 },
    });
    expect(cloud.writes).toEqual([]);

    const completed = await controller.decide("merge");
    expect(completed.status).toBe("completed");
    expect(cloud.records).toHaveLength(1);
    expect(cloud.writes).toEqual([]);
  });

  it("keeps both same-id different payloads with a deterministic device copy", async () => {
    const local = targetEntry("shared", "マフォクシー");
    const remote = targetEntry("shared", "ドドゲザン");
    const raw = stringifyBoxStorageDocument([local]);
    const memory = makeStorage({ [BOX_STORAGE_KEY]: raw });
    const cloud = makeCloud([toRemote(OWNER, "target-box", remote)]);
    const controller = makeController(OWNER, memory.storage, cloud);

    expect((await controller.inspect()).summary.conflictCount).toBe(1);
    const result = await controller.decide("merge");

    expect(result.status).toBe("completed");
    const active = [...cloud.records.values()].filter((record) => !record.tombstone);
    expect(active).toHaveLength(2);
    const decodedNames = active.map((record) => {
      const decoded = decodeSyncPayload("target-box", record.payload, record.entryId);
      return decoded.status === "success" ? decoded.entry.name : "invalid";
    });
    expect(decodedNames).toContain("マフォクシー（このブラウザ）");
    expect([...cloud.records.keys()].some((key) => key.startsWith("target-box:m3-device-"))).toBe(true);
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe(raw);
  });

  it("can keep only cloud data while retaining the untouched legacy source", async () => {
    const local = targetEntry("local-choice");
    const remote = targetEntry("cloud-choice");
    const raw = stringifyBoxStorageDocument([local]);
    const memory = makeStorage({ [BOX_STORAGE_KEY]: raw });
    const cloud = makeCloud([toRemote(OWNER, "target-box", remote)]);
    const controller = makeController(OWNER, memory.storage, cloud);

    await controller.inspect();
    const result = await controller.decide("cloud");

    expect(result.status).toBe("completed");
    expect(cloud.writes).toEqual([]);
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe(raw);
    const saved = JSON.parse(memory.values.get(makeSyncStorageKey(OWNER)) ?? "{}");
    expect(saved.records).toHaveProperty(makeSyncRecordKey("target-box", "cloud-choice"));
    expect(saved.records).not.toHaveProperty(makeSyncRecordKey("target-box", "local-choice"));
  });

  it("defers without writing local sync or cloud data", async () => {
    const local = targetEntry("later-local");
    const remote = toRemote(OWNER, "target-box", targetEntry("later-cloud"));
    const memory = makeStorage({ [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([local]) });
    const cloud = makeCloud([remote]);
    const controller = makeController(OWNER, memory.storage, cloud);

    await controller.inspect();
    const result = await controller.decide("later");

    expect(result).toMatchObject({ status: "needs-review", requiresDecision: true });
    expect(cloud.writes).toEqual([]);
    expect(memory.values.has(makeSyncStorageKey(OWNER))).toBe(false);
  });

  it("uses the device explicitly and tombstones remote-only slots", async () => {
    const local = targetEntry("device-slot", "マフォクシー");
    const remoteSameId = toRemote(OWNER, "target-box", targetEntry("device-slot", "ドドゲザン"));
    const remoteOnly = toRemote(OWNER, "enemy-box", enemyEntry("remote-only"));
    const memory = makeStorage({ [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([local]) });
    const cloud = makeCloud([remoteSameId, remoteOnly]);
    const controller = makeController(OWNER, memory.storage, cloud);

    await controller.inspect();
    const result = await controller.decide("device");

    expect(result.status).toBe("completed");
    expect(cloud.records.get(makeSyncRecordKey("enemy-box", "remote-only"))?.tombstone).toBe(true);
    const deviceRecord = cloud.records.get(makeSyncRecordKey("target-box", "device-slot"));
    expect(deviceRecord).toMatchObject({ revision: 2, baseRevision: 1, tombstone: false });
  });

  it("resumes idempotently after a lost write response", async () => {
    const local = targetEntry("lost-response");
    const raw = stringifyBoxStorageDocument([local]);
    const memory = makeStorage({ [BOX_STORAGE_KEY]: raw });
    const cloud = makeCloud([], { lostFirstWrite: true });
    const controller = makeController(OWNER, memory.storage, cloud);

    const failed = await controller.inspect();
    expect(failed.status).toBe("in-progress");
    expect(failed.error?.code).toBe("cloud-network");
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe(raw);
    expect(cloud.records).toHaveLength(1);

    const resumed = await controller.retry();
    expect(resumed.status).toBe("completed");
    expect(cloud.records).toHaveLength(1);
    expect(cloud.writes).toHaveLength(1);
  });

  it("exposes resume as the persisted-marker retry API", async () => {
    const local = targetEntry("resume-api");
    const memory = makeStorage({ [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([local]) });
    const cloud = makeCloud([], { lostFirstWrite: true });
    const controller = makeController(OWNER, memory.storage, cloud);

    expect((await controller.inspect()).status).toBe("in-progress");
    const resumed = await controller.resume();

    expect(resumed.status).toBe("completed");
    expect(JSON.parse(memory.values.get(makeMigrationStateStorageKey(OWNER)) ?? "{}").status)
      .toBe("completed");
  });

  it("does not erase a normal outbox mutation queued after a failed migration", async () => {
    const migrationEntry = targetEntry("migration-pending");
    const memory = makeStorage({
      [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([migrationEntry]),
    });
    const cloud = makeCloud([], { lostFirstWrite: true });
    const controller = makeController(OWNER, memory.storage, cloud);
    expect((await controller.inspect()).status).toBe("in-progress");

    const local = createLocalSyncRepository(OWNER, { storage: memory.storage });
    const loaded = local.load();
    expect(loaded.status).toBe("valid");
    if (loaded.status !== "valid") return;
    const normal = enqueueSyncMutation(loaded.state, {
      kind: "target-box",
      entry: targetEntry("normal-after-failure"),
      now: NOW,
      mutationId: "normal-after-failure",
    });
    if (normal.status === "error") throw normal.error;
    expect(local.save(normal.state).status).toBe("valid");
    const beforeRetry = memory.values.get(makeSyncStorageKey(OWNER));

    const retried = await makeController(OWNER, memory.storage, cloud, local).retry();

    expect(retried.status).toBe("in-progress");
    expect(retried.error?.code).toBe("local-existing-data");
    expect(memory.values.get(makeSyncStorageKey(OWNER))).toBe(beforeRetry);
    expect(JSON.parse(beforeRetry ?? "{}").outbox.map((mutation: SyncRecord) => mutation.mutationId))
      .toContain("normal-after-failure");
  });

  it("keeps in-progress when cloud read fails and retries without touching legacy data", async () => {
    const entry = targetEntry("offline-local");
    const raw = stringifyBoxStorageDocument([entry]);
    const memory = makeStorage({ [BOX_STORAGE_KEY]: raw });
    const backup = stringifyBoxBackupDocument([entry], NOW);
    const cloud = makeCloud([], {
      readError: {
        status: "error",
        records: [],
        issues: [],
        error: { kind: "network", message: "offline" },
      },
    });

    const result = await makeController(OWNER, memory.storage, cloud).inspect();

    expect(result.status).toBe("in-progress");
    expect(result.error?.code).toBe("cloud-network");
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe(raw);
    expect(memory.values.has(makeSyncStorageKey(OWNER))).toBe(false);
    expect(parseBoxBackupDocument(backup)).toMatchObject({
      status: "success",
      entries: [{ id: "offline-local" }],
    });
  });

  it("does not mark completed when the final migration marker write fails", async () => {
    const entry = targetEntry("marker-failure");
    const raw = stringifyBoxStorageDocument([entry]);
    const memory = makeStorage({ [BOX_STORAGE_KEY]: raw });
    const cloud = makeCloud();
    const baseState = createMigrationStateRepository(OWNER, { storage: memory.storage });
    const failingState: MigrationStateRepository = {
      ...baseState,
      save: (state) => state.status === "completed"
        ? {
            status: "quota",
            error: new MigrationStateRepositoryError("quota", "marker quota"),
          }
        : baseState.save(state),
    };
    const first = createLocalStorageMigrationController({
      ownerUid: OWNER,
      migrationState: failingState,
      local: createLocalSyncRepository(OWNER, { storage: memory.storage }),
      cloud,
      legacyStorage: memory.storage,
      claimStorage: memory.storage,
      now: NOW,
    });

    const failed = await first.inspect();
    expect(failed.status).toBe("in-progress");
    expect(failed.error?.code).toBe("migration-state-quota");
    expect(cloud.records).toHaveLength(1);
    expect(JSON.parse(memory.values.get(makeMigrationStateStorageKey(OWNER)) ?? "{}").status)
      .toBe("in-progress");

    const resumed = await makeController(OWNER, memory.storage, cloud).retry();
    expect(resumed.status).toBe("completed");
    expect(cloud.records).toHaveLength(1);
    expect(cloud.writes).toHaveLength(1);
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe(raw);
  });

  it("does not complete when the UID local state cannot be saved", async () => {
    const localEntry = targetEntry("quota-local");
    const memory = makeStorage({ [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([localEntry]) });
    const cloud = makeCloud();
    const validLocal = createLocalSyncRepository(OWNER, { storage: memory.storage });
    const failingLocal: LocalSyncRepository = {
      ...validLocal,
      save: () => ({
        status: "quota",
        error: Object.assign(new Error("quota"), { code: "quota" as const, reason: "quota" as const }),
      }),
    };

    const result = await makeController(OWNER, memory.storage, cloud, failingLocal).inspect();

    expect(result.status).toBe("in-progress");
    expect(result.error?.code).toBe("local-quota");
    expect(cloud.writes).toEqual([]);
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe(stringifyBoxStorageDocument([localEntry]));
  });

  it("fails closed instead of overwriting a pre-existing UID sync outbox", async () => {
    const migrationEntry = targetEntry("legacy-migration");
    const existingEntry = targetEntry("existing-outbox");
    const memory = makeStorage({
      [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([migrationEntry]),
    });
    const local = createLocalSyncRepository(OWNER, { storage: memory.storage });
    const existing = enqueueSyncMutation(createEmptyLocalSyncState(OWNER), {
      kind: "target-box",
      entry: existingEntry,
      now: NOW,
      mutationId: "existing-outbox-mutation",
    });
    if (existing.status === "error") throw existing.error;
    expect(local.save(existing.state).status).toBe("valid");
    const before = memory.values.get(makeSyncStorageKey(OWNER));
    const cloud = makeCloud();

    const result = await makeController(OWNER, memory.storage, cloud, local).inspect();

    expect(result.status).toBe("in-progress");
    expect(result.error?.code).toBe("local-existing-data");
    expect(memory.values.get(makeSyncStorageKey(OWNER))).toBe(before);
    expect(cloud.writes).toEqual([]);
  });

  it("rechecks the legacy fingerprint after cloud writes before completing", async () => {
    const first = targetEntry("before-write");
    const late = targetEntry("during-write");
    const firstRaw = stringifyBoxStorageDocument([first]);
    const memory = makeStorage({ [BOX_STORAGE_KEY]: firstRaw });
    const cloud = makeCloud([], {
      onWrite: () => {
        memory.storage.setItem(BOX_STORAGE_KEY, stringifyBoxStorageDocument([first, late]));
      },
    });

    const result = await makeController(OWNER, memory.storage, cloud).inspect();

    expect(result.status).toBe("needs-review");
    expect(result.error?.code).toBe("source-changed");
    expect(cloud.records).toHaveLength(1);
    expect(JSON.parse(memory.values.get(makeMigrationStateStorageKey(OWNER)) ?? "{}").status)
      .toBe("needs-review");

    expect((await makeController(OWNER, memory.storage, cloud).retry()).requiresDecision).toBe(true);
    const completed = await makeController(OWNER, memory.storage, cloud).decide("merge");
    expect(completed.status).toBe("completed");
    expect([...cloud.records.values()].filter((record) => !record.tombstone)).toHaveLength(2);
  });

  it("keeps a deleted default example deleted across the cloud namespace", async () => {
    const cloudDefault = createDefaultBoxExampleEntry("2026-07-27T00:00:00.000Z");
    const memory = makeStorage({
      [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([]),
      [BOX_DEFAULT_EXAMPLE_SEEDED_KEY]: "1",
    });
    const cloud = makeCloud([toRemote(OWNER, "target-box", cloudDefault)]);
    const controller = makeController(OWNER, memory.storage, cloud);

    const review = await controller.inspect();
    expect(review.status).toBe("needs-review");
    const result = await controller.decide("merge");

    expect(result.status).toBe("completed");
    expect(cloud.records.get(makeSyncRecordKey("target-box", cloudDefault.id))?.tombstone).toBe(true);
    expect(memory.values.get(BOX_DEFAULT_EXAMPLE_SEEDED_KEY)).toBe("1");
  });

  it("does not offer one legacy source to a second account", async () => {
    const entry = targetEntry("claimed-local");
    const memory = makeStorage({ [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([entry]) });
    const cloudA = makeCloud();
    expect((await makeController(OWNER, memory.storage, cloudA).inspect()).status).toBe("completed");
    expect(JSON.parse(memory.values.get(MIGRATION_SOURCE_CLAIM_STORAGE_KEY) ?? "{}").ownerUid).toBe(OWNER);

    const ownerB = "migration-owner-b";
    const result = await makeController(ownerB, memory.storage, makeCloud()).inspect();

    expect(result).toMatchObject({
      status: "needs-review",
      requiresDecision: true,
      canUseDevice: false,
      error: { code: "source-claimed" },
    });
    expect(makeMigrationStateStorageKey(ownerB)).not.toBe(makeMigrationStateStorageKey(OWNER));
    expect(JSON.parse(memory.values.get(makeMigrationStateStorageKey(OWNER)) ?? "{}")).toMatchObject({
      ownerUid: OWNER,
      status: "completed",
    });
    expect(JSON.parse(memory.values.get(makeMigrationStateStorageKey(ownerB)) ?? "{}")).toMatchObject({
      ownerUid: ownerB,
      status: "needs-review",
    });
    expect(memory.values.has(makeSyncStorageKey(OWNER))).toBe(true);
    expect(memory.values.has(makeSyncStorageKey(ownerB))).toBe(false);
  });

  it("serializes concurrent account claims so only one UID receives the legacy source", async () => {
    const entry = targetEntry("concurrent-claim");
    const memory = makeStorage({ [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([entry]) });
    const cloudA = makeCloud();
    const cloudB = makeCloud();
    const ownerB = "migration-owner-concurrent-b";

    const [resultA, resultB] = await Promise.all([
      makeController(OWNER, memory.storage, cloudA).inspect(),
      makeController(ownerB, memory.storage, cloudB).inspect(),
    ]);

    expect([resultA.status, resultB.status].sort()).toEqual(["completed", "needs-review"]);
    expect(cloudA.writes.length + cloudB.writes.length).toBe(1);
    expect([resultA.canUseDevice, resultB.canUseDevice]).toContain(false);
  });

  it("reopens review when device data changes after the first inspection", async () => {
    const firstLocal = targetEntry("first-local");
    const remote = toRemote(OWNER, "target-box", targetEntry("remote-review"));
    const memory = makeStorage({
      [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([firstLocal]),
    });
    const cloud = makeCloud([remote]);
    const controller = makeController(OWNER, memory.storage, cloud);
    expect((await controller.inspect()).status).toBe("needs-review");

    memory.storage.setItem(
      BOX_STORAGE_KEY,
      stringifyBoxStorageDocument([firstLocal, targetEntry("late-local")]),
    );
    const result = await controller.decide("merge");

    expect(result.status).toBe("needs-review");
    expect(result.error?.code).toBe("source-changed");
    expect(cloud.writes).toEqual([]);
  });

  it("reports corrupt legacy JSON without reading or overwriting cloud", async () => {
    const memory = makeStorage({ [BOX_STORAGE_KEY]: "not-json" });
    const cloud = makeCloud();

    const result = await makeController(OWNER, memory.storage, cloud).inspect();

    expect(result.error?.code).toBe("legacy-corrupt");
    expect(result.status).toBe("not-started");
    expect(cloud.readCount).toBe(0);
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe("not-json");
  });
});
