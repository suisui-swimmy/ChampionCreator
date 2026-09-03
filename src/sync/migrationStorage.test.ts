import { describe, expect, it } from "vitest";
import {
  BOX_DEFAULT_EXAMPLE_SEEDED_KEY,
  BOX_STORAGE_KEY,
  createDefaultBoxExampleEntry,
  stringifyBoxStorageDocument,
} from "../ui/boxStorage";
import {
  ENEMY_BOX_STORAGE_KEY,
  createEnemyBoxEntryFromScenarios,
  stringifyEnemyBoxStorageDocument,
} from "../ui/enemyBoxStorage";
import { createDefaultScenarioForms } from "../ui/defenceSearchUi";
import { SHARE_SCHEMA_VERSION } from "../ui/shareState";
import {
  MIGRATION_STATE_SCHEMA_VERSION,
  createMigrationStateRepository,
  createMemoryMigrationStateRepository,
  captureLegacyMigrationSnapshot,
  makeMigrationStateStorageKey,
  type MigrationRawStorageLike,
  type MigrationStateStorageLike,
} from "./migrationStorage";

const makeStorage = (
  initial: Record<string, string | null> = {},
) => {
  const values = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: Array<[string, string]> = [];
  const storage: MigrationStateStorageLike = {
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

describe("migrationStorage snapshots", () => {
  it("captures only raw legacy keys and does not seed a fresh device", () => {
    const memory = makeStorage();
    const snapshot = captureLegacyMigrationSnapshot(memory.storage);

    expect(memory.reads).toEqual([
      BOX_STORAGE_KEY,
      ENEMY_BOX_STORAGE_KEY,
      BOX_DEFAULT_EXAMPLE_SEEDED_KEY,
    ]);
    expect(memory.writes).toEqual([]);
    expect(snapshot.raw.targetBox).toBeNull();
    expect(snapshot.raw.enemyBox).toBeNull();
    expect(snapshot.raw.defaultMarker).toBeNull();
    expect(snapshot.targetEntries).toEqual([]);
    expect(snapshot.defaultExampleState).toBe("uninitialized");
  });

  it("gives fresh and App-seeded untouched defaults the same logical fingerprint", () => {
    const fresh = captureLegacyMigrationSnapshot(makeStorage().storage);
    const defaultEntry = createDefaultBoxExampleEntry("2026-08-21T00:00:00.000Z");
    const seeded = captureLegacyMigrationSnapshot(makeStorage({
      [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([defaultEntry]),
      [BOX_DEFAULT_EXAMPLE_SEEDED_KEY]: "1",
    }).storage);

    expect(seeded.targetBox.defaultDisposition).toBe("untouched");
    expect(seeded.targetDeviceEntries).toEqual([]);
    expect(seeded.fingerprint).toBe(fresh.fingerprint);
    expect(seeded.targetBox.fingerprint.logical).toBe(fresh.targetBox.fingerprint.logical);
  });

  it("keeps a modified default as a device entry", () => {
    const defaultEntry = createDefaultBoxExampleEntry("2026-08-21T00:00:00.000Z");
    const modified = {
      ...defaultEntry,
      name: "自分用に変更した調整例",
      updatedAt: "2026-08-22T00:00:00.000Z",
    };
    const snapshot = captureLegacyMigrationSnapshot(makeStorage({
      [BOX_STORAGE_KEY]: stringifyBoxStorageDocument([modified]),
      [BOX_DEFAULT_EXAMPLE_SEEDED_KEY]: "1",
    }).storage);

    expect(snapshot.defaultExampleState).toBe("modified");
    expect(snapshot.targetEntries).toHaveLength(1);
    expect(snapshot.targetDeviceEntries).toEqual(snapshot.targetEntries);
    expect(snapshot.targetDeviceEntries[0]?.name).toBe("自分用に変更した調整例");
  });

  it("preserves a deleted-default intent and never recreates the default", () => {
    const snapshot = captureLegacyMigrationSnapshot(makeStorage({
      [BOX_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, entries: [] }),
      [BOX_DEFAULT_EXAMPLE_SEEDED_KEY]: "1",
    }).storage);

    expect(snapshot.defaultExampleState).toBe("deleted");
    expect(snapshot.deletedDefaultIntent).toBe(true);
    expect(snapshot.targetBox.summary.deletedDefaultIntent).toBe(true);
    expect(snapshot.targetEntries).toEqual([]);
  });

  it("rejects an unknown marker instead of treating it as seeded", () => {
    expect(() => captureLegacyMigrationSnapshot(makeStorage({
      [BOX_DEFAULT_EXAMPLE_SEEDED_KEY]: "yes",
    }).storage)).toThrow(/marker/);
  });

  it("strictly rejects malformed outer envelopes, ids, timestamps, and payloads", () => {
    const valid = createDefaultBoxExampleEntry("2026-08-21T00:00:00.000Z");
    const cases: unknown[] = [
      { schemaVersion: 999, entries: [] },
      { schemaVersion: 1, entries: [{ ...valid, id: "" }] },
      { schemaVersion: 1, entries: [{ ...valid, updatedAt: "not-a-date" }] },
      { schemaVersion: 1, entries: [{ ...valid, payload: null }] },
    ];

    for (const document of cases) {
      expect(() => captureLegacyMigrationSnapshot(makeStorage({
        [BOX_STORAGE_KEY]: JSON.stringify(document),
      }).storage)).toThrow();
    }
  });

  it("canonicalizes legacy payloads through the existing backup parser", () => {
    const entry = createDefaultBoxExampleEntry("2026-08-21T00:00:00.000Z");
    const rawEntry = JSON.parse(JSON.stringify(entry)) as typeof entry;
    rawEntry.payload = {
      ...rawEntry.payload,
      schemaVersion: 10,
    } as unknown as typeof entry.payload;
    const snapshot = captureLegacyMigrationSnapshot(makeStorage({
      [BOX_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, entries: [rawEntry] }),
    }).storage);

    expect(snapshot.targetEntries[0]?.payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(snapshot.targetBox.defaultDisposition).toBe("untouched");
  });

  it("canonicalizes enemy entries without touching the target marker", () => {
    const enemy = createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
      id: "enemy-1",
      now: "2026-08-21T00:00:00.000Z",
    });
    const snapshot = captureLegacyMigrationSnapshot(makeStorage({
      [ENEMY_BOX_STORAGE_KEY]: stringifyEnemyBoxStorageDocument([enemy]),
    }).storage);

    expect(snapshot.enemyEntries[0]?.id).toBe("enemy-1");
    expect(snapshot.enemyBox.deviceEntries).toHaveLength(1);
    expect(snapshot.defaultExampleState).toBe("uninitialized");
  });
});

describe("migration state repository", () => {
  it("uses a UID-scoped key and distinguishes missing from valid state", () => {
    const memory = makeStorage();
    const ownerUid = "uid/日本語";
    const repository = createMigrationStateRepository(ownerUid, { storage: memory.storage });

    expect(repository.storageKey).toBe(makeMigrationStateStorageKey(ownerUid));
    expect(repository.load()).toEqual({ status: "missing" });
    expect(memory.reads).toEqual([makeMigrationStateStorageKey(ownerUid)]);
    expect(memory.reads).not.toContain(BOX_STORAGE_KEY);

    expect(repository.save({
      schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
      ownerUid,
      status: "not-started",
    })).toMatchObject({ status: "valid", state: { ownerUid, status: "not-started" } });
    expect(repository.load()).toMatchObject({ status: "valid", state: { ownerUid } });
  });

  it("classifies corrupt, unavailable, and quota failures separately", () => {
    const corrupt = createMemoryMigrationStateRepository("owner-1", "not-json");
    expect(corrupt.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });

    const unavailable = createMigrationStateRepository("owner-1", { storage: null });
    expect(unavailable.load()).toMatchObject({
      status: "unavailable",
      error: { code: "unavailable", reason: "unavailable" },
    });
    expect(unavailable.save({
      schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
      ownerUid: "owner-1",
      status: "in-progress",
    })).toMatchObject({ status: "unavailable" });

    const memory = makeStorage();
    memory.storage.setItem = () => {
      const error = new Error("full");
      Object.defineProperty(error, "name", { value: "QuotaExceededError" });
      throw error;
    };
    const quota = createMigrationStateRepository("owner-1", { storage: memory.storage });
    expect(quota.save({
      schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
      ownerUid: "owner-1",
      status: "needs-review",
    })).toMatchObject({ status: "quota", error: { code: "quota" } });
  });

  it("rejects unknown status and another UID without changing legacy keys", () => {
    const state = createMemoryMigrationStateRepository("owner-1", JSON.stringify({
      schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
      ownerUid: "owner-1",
      status: "waiting",
    }));
    expect(state.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });

    const memory = makeStorage({ [BOX_STORAGE_KEY]: "legacy" });
    const repository = createMigrationStateRepository("owner-1", { storage: memory.storage });
    expect(repository.save({
      schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
      ownerUid: "owner-2",
      status: "completed",
    })).toMatchObject({ status: "corrupt" });
    expect(memory.values.get(BOX_STORAGE_KEY)).toBe("legacy");
  });
});
