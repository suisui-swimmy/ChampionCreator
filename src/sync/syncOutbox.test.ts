import { describe, expect, it } from "vitest";
import {
  createBoxEntryFromState,
} from "../ui/boxStorage";
import { createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { SHARE_SCHEMA_VERSION } from "../ui/shareState";
import { createEmptyLocalSyncState, makeSyncRecordKey } from "./syncTypes";
import {
  enqueueSyncMutation,
  enqueueSyncMutationOrThrow,
  enqueueSyncTombstone,
} from "./syncOutbox";

const makeEntry = (id: string) => createBoxEntryFromState(
  createDefaultTargetForm(),
  createDefaultScenarioForms(),
  { id, now: "2026-08-21T00:00:00.000Z" },
);

describe("syncOutbox", () => {
  it("copy-on-write enqueues an upsert with per-slot revisions and FIFO sequence", () => {
    const initial = createEmptyLocalSyncState("user/一");
    const entry = makeEntry("id/ Unicode　space");
    const first = enqueueSyncMutation(initial, {
      kind: "target-box",
      entry,
      now: "2026-08-21T01:00:00.000Z",
      mutationId: "mutation-1",
    });

    expect(first.status).toBe("success");
    expect(initial.records).toEqual({});
    expect(initial.outbox).toEqual([]);
    if (first.status !== "success") {
      return;
    }
    expect(first.record).toMatchObject({
      ownerUid: "user/一",
      entryId: entry.id,
      revision: 1,
      baseRevision: 0,
      tombstone: false,
      deletedAt: null,
      mutationId: "mutation-1",
      updatedAt: "2026-08-21T01:00:00.000Z",
    });
    expect(first.mutation.sequence).toBe(1);
    expect(first.mutation.baseMutationId).toBeNull();
    expect(first.state.nextSequence).toBe(2);

    const second = enqueueSyncMutation(first.state, {
      kind: "target-box",
      entry: { ...entry, name: "変更後" },
      now: "2026-08-21T02:00:00.000Z",
      mutationId: "mutation-2",
    });
    expect(second.status).toBe("success");
    if (second.status === "success") {
      expect(second.record).toMatchObject({ revision: 2, baseRevision: 1 });
      expect(second.mutation.sequence).toBe(2);
      expect(second.mutation.baseMutationId).toBe("mutation-1");
      expect(second.state.outbox.map((mutation) => mutation.mutationId)).toEqual([
        "mutation-1",
        "mutation-2",
      ]);
    }
  });

  it("keeps target and enemy entries with the same id in different slots", () => {
    const state = createEmptyLocalSyncState("user-1");
    const target = enqueueSyncMutation(state, {
      kind: "target-box",
      entry: makeEntry("shared"),
      now: "2026-08-21T00:00:00.000Z",
      mutationId: "target-mutation",
    });
    expect(target.status).toBe("success");
    if (target.status !== "success") {
      return;
    }
    const enemy = {
      id: "shared",
      name: "enemy",
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      summary: {
        pokemonName: "敵",
        conditionSummary: "条件なし",
        statPointSummary: "0シナリオ / 0攻撃",
      },
      payload: {
        schemaVersion: SHARE_SCHEMA_VERSION as typeof SHARE_SCHEMA_VERSION,
        scenarios: createDefaultScenarioForms(),
      },
    };
    const both = enqueueSyncMutation(target.state, {
      kind: "enemy-box",
      entry: enemy,
      now: "2026-08-21T00:01:00.000Z",
      mutationId: "enemy-mutation",
    });
    expect(both.status).toBe("success");
    if (both.status === "success") {
      expect(Object.keys(both.state.records)).toEqual([
        makeSyncRecordKey("target-box", "shared"),
        makeSyncRecordKey("enemy-box", "shared"),
      ]);
      expect(both.state.records[makeSyncRecordKey("target-box", "shared")].revision).toBe(1);
      expect(both.state.records[makeSyncRecordKey("enemy-box", "shared")].revision).toBe(1);
    }
  });

  it("retains the previous payload in a tombstone and advances the slot revision", () => {
    const first = enqueueSyncMutation(createEmptyLocalSyncState("user-1"), {
      kind: "target-box",
      entry: makeEntry("delete-me"),
      now: "2026-08-21T00:00:00.000Z",
      mutationId: "upsert",
    });
    expect(first.status).toBe("success");
    if (first.status !== "success") {
      return;
    }
    const deleted = enqueueSyncTombstone(first.state, {
      kind: "target-box",
      entryId: "delete-me",
      now: "2026-08-21T00:02:00.000Z",
      mutationId: "delete",
    });
    expect(deleted.status).toBe("success");
    if (deleted.status === "success") {
      expect(deleted.record).toMatchObject({
        revision: 2,
        baseRevision: 1,
        tombstone: true,
        deletedAt: "2026-08-21T00:02:00.000Z",
        payload: first.record.payload,
      });
      expect(deleted.mutation.payload).toBe(first.record.payload);
      expect(deleted.mutation.baseMutationId).toBe("upsert");
    }
  });

  it("rejects writes while the slot is conflicted without changing the state", () => {
    const first = enqueueSyncMutation(createEmptyLocalSyncState("user-1"), {
      kind: "target-box",
      entry: makeEntry("conflicted"),
      now: "2026-08-21T00:00:00.000Z",
      mutationId: "upsert",
    });
    expect(first.status).toBe("success");
    if (first.status !== "success") {
      return;
    }
    const conflicted = {
      ...first.state,
      conflicts: {
        [first.record.recordKey]: {
          recordKey: first.record.recordKey,
          kind: "target-box" as const,
          entryId: first.record.entryId,
          local: first.record,
          detectedAt: "2026-08-21T00:01:00.000Z",
        },
      },
    };
    const result = enqueueSyncMutation(conflicted, {
      kind: "target-box",
      entry: makeEntry("conflicted"),
      now: "2026-08-21T00:02:00.000Z",
      mutationId: "blocked",
    });
    expect(result).toMatchObject({ status: "error", reason: "conflict" });
    expect(conflicted.records[first.record.recordKey].revision).toBe(1);
    expect(conflicted.outbox).toHaveLength(1);
  });

  it("rejects an empty id and missing-record tombstone", () => {
    const state = createEmptyLocalSyncState("user-1");
    expect(enqueueSyncMutation(state, {
      kind: "target-box",
      entry: makeEntry(""),
      mutationId: "bad",
    })).toMatchObject({ status: "error", reason: "invalid-entry" });
    expect(enqueueSyncTombstone(state, {
      kind: "target-box",
      entryId: "missing",
      mutationId: "bad-delete",
    })).toMatchObject({ status: "error", reason: "missing-record" });
  });

  it("offers a throwing variant for coordinator transaction code", () => {
    const state = createEmptyLocalSyncState("user-1");
    const result = enqueueSyncMutationOrThrow(state, {
      kind: "target-box",
      entry: makeEntry("throwing"),
      mutationId: "m1",
    });
    expect(result.status).toBe("success");
  });
});
