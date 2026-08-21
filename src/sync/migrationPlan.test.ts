import { describe, expect, it } from "vitest";
import {
  createBoxEntryFromState,
  createDefaultBoxExampleEntry,
  type BoxEntry,
} from "../ui/boxStorage";
import { createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { createEnemyBoxEntryFromScenarios, type EnemyBoxEntry } from "../ui/enemyBoxStorage";
import { sha256Hex } from "./firestoreSyncRepository";
import { encodeSyncPayload } from "./syncPayload";
import { createEmptyLocalSyncState, makeSyncRecordKey, type SyncRecord } from "./syncTypes";
import { enqueueSyncMutation } from "./syncOutbox";
import {
  planLocalMigration,
  type LegacyMigrationSnapshot,
} from "./migrationPlan";

const snapshot = (
  targetEntries: readonly BoxEntry[] = [],
  enemyEntries: readonly EnemyBoxEntry[] = [],
  defaultExampleState: LegacyMigrationSnapshot["defaultExampleState"] = "uninitialized",
): LegacyMigrationSnapshot => ({
  targetEntries,
  enemyEntries,
  defaultExampleState,
  fingerprint: "snapshot-fingerprint",
});

const targetEntry = (id: string, pokemonInput = "メガマフォクシー"): BoxEntry => (
  createBoxEntryFromState(
    { ...createDefaultTargetForm(), pokemonInput },
    createDefaultScenarioForms(),
    { id, now: "2026-08-21T00:00:00.000Z" },
  )
);

const enemyEntry = (id: string): EnemyBoxEntry => (
  createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
    id,
    now: "2026-08-21T00:00:00.000Z",
  })
);

const remoteRecord = (
  ownerUid: string,
  kind: "target-box" | "enemy-box",
  entry: BoxEntry | EnemyBoxEntry,
  revision = 1,
): SyncRecord => {
  const state = createEmptyLocalSyncState(ownerUid);
  const result = enqueueSyncMutation(state, {
    kind,
    entry: entry as never,
    now: "2026-08-21T01:00:00.000Z",
    mutationId: `remote-${kind}-${entry.id}-${revision}`,
  });
  if (result.status === "error") {
    throw result.error;
  }
  return {
    ...result.record,
    revision,
    baseRevision: Math.max(0, revision - 1),
  };
};

describe("migrationPlan", () => {
  it("seeds cloud records and leaves cloud selection without local mutations", () => {
    const cloud = remoteRecord("uid-1", "target-box", targetEntry("cloud"));
    const result = planLocalMigration({
      decision: "cloud",
      ownerUid: "uid-1",
      snapshot: snapshot([targetEntry("device")]),
      remote: [cloud],
    });

    expect(Object.keys(result.state.records)).toEqual([makeSyncRecordKey("target-box", "cloud")]);
    expect(result.state.outbox).toEqual([]);
    expect(result.summary.finalRecordCount).toBe(1);
  });

  it("deduplicates canonical payloads and keeps a conflicting local payload as a deterministic copy", () => {
    const local = targetEntry("shared");
    const remote = remoteRecord("uid-1", "target-box", local);
    const conflict = targetEntry("shared", "メガゲンガー");
    const first = planLocalMigration({
      decision: "merge",
      ownerUid: "uid-1",
      snapshot: snapshot([conflict]),
      remote: [remote],
    });
    const second = planLocalMigration({
      decision: "merge",
      ownerUid: "uid-1",
      snapshot: snapshot([conflict]),
      remote: [remote],
    });
    const copyId = `m3-device-${sha256Hex([
      "target-box",
      conflict.id,
      encodeSyncPayload("target-box", conflict),
      "",
    ].join("\u001f"))}`;

    expect(first.state.records[makeSyncRecordKey("target-box", "shared")]).toEqual(remote);
    expect(first.state.records[makeSyncRecordKey("target-box", copyId)]).toMatchObject({
      entryId: copyId,
      tombstone: false,
    });
    expect(first.state.outbox).toHaveLength(1);
    expect(first.state.outbox[0]?.entryId).toBe(copyId);
    expect(first.state.outbox[0]?.payload).toContain("（このブラウザ）");
    expect(first.state).toEqual(second.state);
    expect(first.summary.conflictCopyCount).toBe(1);
  });

  it("does not overwrite a deterministic copy edited by another device on retry", () => {
    const originalRemote = remoteRecord("uid-1", "target-box", targetEntry("shared-retry"));
    const localConflict = targetEntry("shared-retry", "メガゲンガー");
    const first = planLocalMigration({
      decision: "merge",
      ownerUid: "uid-1",
      snapshot: snapshot([localConflict]),
      remote: [originalRemote],
    });
    const firstCopy = Object.values(first.state.records).find((record) => (
      record.entryId.startsWith("m3-device-")
    ));
    expect(firstCopy).toBeDefined();
    if (!firstCopy) return;
    const independentlyEdited = remoteRecord(
      "uid-1",
      "target-box",
      targetEntry(firstCopy.entryId, "ハバタクカミ"),
      2,
    );

    const retried = planLocalMigration({
      decision: "merge",
      ownerUid: "uid-1",
      snapshot: snapshot([localConflict]),
      remote: [originalRemote, independentlyEdited],
    });

    expect(retried.state.records[firstCopy.recordKey]).toEqual(independentlyEdited);
    expect(Object.values(retried.state.records).filter((record) => !record.tombstone)).toHaveLength(3);
    expect(retried.state.outbox).toHaveLength(1);
    expect(retried.state.outbox[0]?.entryId).not.toBe(firstCopy.entryId);
  });

  it("uses the device as truth, revisioning shared differences and tombstoning remote-only active slots", () => {
    const local = targetEntry("shared", "メガマフォクシー");
    const cloudVersion = targetEntry("shared", "メガゲンガー");
    const remoteOnly = enemyEntry("remote-only");
    const result = planLocalMigration({
      decision: "device",
      ownerUid: "uid-1",
      snapshot: snapshot([local]),
      remote: [
        remoteRecord("uid-1", "target-box", cloudVersion, 4),
        remoteRecord("uid-1", "enemy-box", remoteOnly),
      ],
    });

    const shared = result.state.records[makeSyncRecordKey("target-box", "shared")];
    const deleted = result.state.records[makeSyncRecordKey("enemy-box", "remote-only")];
    expect(shared).toMatchObject({ revision: 5, baseRevision: 4, tombstone: false });
    expect(deleted).toMatchObject({ revision: 2, baseRevision: 1, tombstone: true });
    expect(result.state.outbox.map((mutation) => mutation.tombstone)).toEqual([false, true]);
    expect(result.summary.remoteOnlyTombstoneCount).toBe(1);
  });

  it("creates a deterministic default seed and tombstone when a deleted sample has no cloud record", () => {
    const first = planLocalMigration({
      decision: "merge",
      ownerUid: "uid-1",
      snapshot: snapshot([], [], "deleted"),
      remote: [],
    });
    const second = planLocalMigration({
      decision: "merge",
      ownerUid: "uid-1",
      snapshot: snapshot([], [], "deleted"),
      remote: [],
    });
    const key = makeSyncRecordKey("target-box", createDefaultBoxExampleEntry().id);

    expect(first.state.records[key]).toMatchObject({ tombstone: true, entryId: createDefaultBoxExampleEntry().id });
    expect(first.state.outbox).toHaveLength(2);
    expect(first.state.outbox[0]?.tombstone).toBe(false);
    expect(first.state.outbox[1]?.tombstone).toBe(true);
    expect(first.state).toEqual(second.state);
    expect(first.summary.deletedDefaultTombstoneCount).toBe(1);
  });

  it("preserves inputs and does not delete a modified cloud default for a local delete intent", () => {
    const modifiedCloudDefault = targetEntry("default-example-mega-delphox", "メガゲンガー");
    const remote = remoteRecord("uid-1", "target-box", modifiedCloudDefault);
    const before = JSON.stringify(remote);
    const result = planLocalMigration({
      decision: "device",
      ownerUid: "uid-1",
      snapshot: snapshot([], [], "deleted"),
      remote: [remote],
    });

    expect(JSON.stringify(remote)).toBe(before);
    expect(result.state.records[makeSyncRecordKey("target-box", modifiedCloudDefault.id)]).toMatchObject({
      tombstone: false,
    });
    expect(result.state.outbox).toEqual([]);
  });

  it("tombstones an untouched cloud default even when its seed timestamps differ", () => {
    const cloudDefault = createDefaultBoxExampleEntry("2026-08-21T01:00:00.000Z");
    const remote = remoteRecord("uid-1", "target-box", cloudDefault);
    const result = planLocalMigration({
      decision: "device",
      ownerUid: "uid-1",
      snapshot: snapshot([], [], "deleted"),
      remote: [remote],
    });

    expect(result.state.records[makeSyncRecordKey("target-box", cloudDefault.id)]).toMatchObject({
      tombstone: true,
      revision: 2,
    });
    expect(result.summary.deletedDefaultTombstoneCount).toBe(1);
  });
});
