import { describe, expect, it } from "vitest";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "../ui/defenceSearchUi";
import {
  createDraftStorageDocument,
  stringifyDraftStorageDocument,
} from "../ui/draftStorage";
import { createMemoryCloudDraftLocalRepository } from "./cloudDraftLocalRepository";
import {
  createCloudDraftCoordinator,
  type CloudDraftCoordinatorErrorKind,
} from "./cloudDraftCoordinator";
import type {
  CloudDraftReadResult,
  CloudDraftRepository,
  CloudDraftRepositoryIssue,
  CloudDraftWriteResult,
} from "./firestoreCloudDraftRepository";
import type {
  CloudDraftMutation,
  CloudDraftRecord,
} from "./cloudDraftTypes";

const OWNER = "cloud-draft-test-user";
const DEVICE = "device-current";
const OTHER_DEVICE = "device-other";
const T0 = "2026-08-21T00:00:00.000Z";

const makePayload = (pokemonInput = "ピカチュウ"): string => stringifyDraftStorageDocument(
  createDraftStorageDocument(
    { ...createDefaultTargetForm(), pokemonInput },
    createDefaultScenarioForms(),
    new Date(T0),
  ),
);

const makeRecord = (
  deviceId: string,
  overrides: Partial<CloudDraftRecord> = {},
): CloudDraftRecord => ({
  ownerUid: OWNER,
  deviceId,
  deviceLabel: deviceId === DEVICE ? "Windows / Chrome" : "Android / Chrome",
  schemaVersion: 1,
  payload: makePayload(deviceId),
  revision: 1,
  baseRevision: 0,
  mutationId: `${deviceId}-mutation-1`,
  updatedAt: T0,
  expiresAt: "2026-09-20T00:00:00.000Z",
  deletedAt: null,
  ...overrides,
});

const emptyRead = (): CloudDraftReadResult => ({
  status: "empty",
  drafts: [],
  records: [],
  issues: [],
});

const createCloud = (options: {
  readonly read?: () => Promise<CloudDraftReadResult>;
  readonly write?: (mutation: CloudDraftMutation) => Promise<CloudDraftWriteResult>;
} = {}): CloudDraftRepository & {
  readonly writes: CloudDraftMutation[];
} => {
  const writes: CloudDraftMutation[] = [];
  return {
    writes,
    readAll: options.read ?? (async () => emptyRead()),
    write: async (mutation) => {
      const candidate = mutation as CloudDraftMutation;
      writes.push(candidate);
      return options.write
        ? options.write(candidate)
        : {
            status: "written",
            record: {
              ownerUid: candidate.ownerUid,
              deviceId: candidate.deviceId,
              deviceLabel: candidate.deviceLabel,
              schemaVersion: candidate.schemaVersion,
              payload: candidate.payload,
              revision: candidate.revision,
              baseRevision: candidate.baseRevision,
              mutationId: candidate.mutationId,
              updatedAt: candidate.updatedAt,
              expiresAt: candidate.expiresAt,
              deletedAt: candidate.deletedAt,
            },
            issues: [],
          };
    },
  };
};

const makeHarness = (options: {
  readonly now?: () => Date;
  readonly cloud?: ReturnType<typeof createCloud>;
} = {}) => {
  const local = createMemoryCloudDraftLocalRepository(OWNER, DEVICE);
  const cloud = options.cloud ?? createCloud();
  const coordinator = createCloudDraftCoordinator({
    local,
    cloud,
    deviceLabel: "Windows / Chrome",
    now: options.now ?? (() => new Date(T0)),
    createMutationId: (() => {
      let index = 0;
      return () => `test-mutation-${++index}`;
    })(),
  });
  return { local, cloud, coordinator };
};

const at = (seconds: number): Date => new Date(Date.parse(T0) + seconds * 1000);

describe("CloudDraftCoordinator", () => {
  it("coalesces current-device edits and delays the latest payload for two seconds", async () => {
    let now = at(0);
    const { coordinator, cloud } = makeHarness({ now: () => now });

    const first = coordinator.queueCurrentDraft(makePayload("最初"));
    expect(first.status).toBe("success");
    if (first.status !== "success") return;
    expect(first.snapshot.outboxCount).toBe(1);
    expect(first.snapshot.nextEligibleAt).toBe(at(2).toISOString());

    now = at(1);
    const second = coordinator.queueCurrentDraft(makePayload("最新"));
    expect(second.status).toBe("success");
    if (second.status !== "success") return;
    expect(second.state.outbox).toHaveLength(1);
    expect(second.state.outbox[0]?.payload).toContain("最新");
    expect(second.state.outbox[0]?.revision).toBe(1);
    expect(second.state.outbox[0]?.baseRevision).toBe(0);
    expect(second.snapshot.nextEligibleAt).toBe(at(3).toISOString());

    const tooSoon = await coordinator.synchronize("manual");
    expect(tooSoon.status).toBe("success");
    expect(cloud.writes).toHaveLength(0);

    now = at(3);
    const sent = await coordinator.synchronize("timer");
    expect(sent.status).toBe("success");
    expect(cloud.writes).toHaveLength(1);
    expect(cloud.writes[0]?.payload).toContain("最新");
    expect(sent.status === "success" && sent.snapshot.outboxCount).toBe(0);
  });

  it("merges another device without replacing the current-device draft", async () => {
    let now = at(3);
    const remote = makeRecord(OTHER_DEVICE, { updatedAt: at(2).toISOString() });
    const cloud = createCloud({
      read: async () => ({
        status: "success",
        drafts: [remote],
        records: [remote],
        issues: [],
      }),
    });
    const { coordinator } = makeHarness({ now: () => now, cloud });
    const queued = coordinator.queueCurrentDraft(makePayload("現在端末"));
    expect(queued.status).toBe("success");

    const result = await coordinator.synchronize("manual");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.snapshot.records.map((record) => record.deviceId)).toEqual([
      DEVICE,
      OTHER_DEVICE,
    ]);
    expect(result.state.records[DEVICE]?.payload).toContain("現在端末");
    expect(result.state.records[OTHER_DEVICE]?.payload).toContain(OTHER_DEVICE);
  });

  it("passes a read network failure through and keeps the outbox for retry", async () => {
    let now = at(3);
    const cloud = createCloud({
      read: async () => ({
        status: "error",
        drafts: [],
        records: [],
        issues: [],
        error: { kind: "network", message: "offline" },
      }),
    });
    const { coordinator, local } = makeHarness({ now: () => now, cloud });
    const queued = coordinator.queueCurrentDraft(makePayload());
    expect(queued.status).toBe("success");

    const result = await coordinator.synchronize("online");
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.error.kind satisfies CloudDraftCoordinatorErrorKind).toBe("network");
    expect(result.state?.outbox).toHaveLength(1);
    expect(local.load().status).toBe("valid");
  });

  it("keeps a draft queued while the remote read is in flight", async () => {
    let resolveRead: ((result: CloudDraftReadResult) => void) | undefined;
    const cloud = createCloud({
      read: async () => await new Promise<CloudDraftReadResult>((resolve) => {
        resolveRead = resolve;
      }),
    });
    const { coordinator } = makeHarness({ now: () => at(0), cloud });

    const syncing = coordinator.synchronize("launch");
    await Promise.resolve();
    expect(coordinator.queueCurrentDraft(makePayload("read中の最新入力")).status).toBe("success");
    resolveRead?.(emptyRead());

    const result = await syncing;
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.state.outbox).toHaveLength(1);
    expect(result.state.outbox[0]?.payload).toContain("read中の最新入力");
  });

  it("acknowledges duplicate and written responses without losing the latest record", async () => {
    let now = at(0);
    let writeCount = 0;
    const cloud = createCloud({
      write: async (mutation) => {
        writeCount += 1;
        return writeCount === 1
          ? { status: "duplicate", issues: [] }
          : {
              status: "written",
              record: { ...mutation },
              issues: [],
            };
      },
    });
    const { coordinator } = makeHarness({ now: () => now, cloud });
    expect(coordinator.queueCurrentDraft(makePayload("duplicate" )).status).toBe("success");

    now = at(3);
    const duplicate = await coordinator.synchronize("manual");
    expect(duplicate.status).toBe("success");
    expect(duplicate.status === "success" && duplicate.snapshot.outboxCount).toBe(0);

    now = at(6);
    expect(coordinator.queueCurrentDraft(makePayload("written")).status).toBe("success");
    now = at(9);
    const written = await coordinator.synchronize("manual");
    expect(written.status).toBe("success");
    expect(written.status === "success" && written.snapshot.outboxCount).toBe(0);
  });

  it("does not acknowledge away an edit queued while an older write is in flight", async () => {
    let now = at(0);
    let resolveWrite: (() => void) | undefined;
    const cloud = createCloud({
      write: async (mutation) => await new Promise<CloudDraftWriteResult>((resolve) => {
        resolveWrite = () => resolve({
          status: "written",
          record: { ...mutation } as CloudDraftRecord,
          issues: [],
        });
      }),
    });
    const { coordinator } = makeHarness({ now: () => now, cloud });
    expect(coordinator.queueCurrentDraft(makePayload("古い入力")).status).toBe("success");

    now = at(3);
    const syncing = coordinator.synchronize("manual");
    await Promise.resolve();
    now = at(4);
    expect(coordinator.queueCurrentDraft(makePayload("最新入力")).status).toBe("success");
    resolveWrite?.();

    const result = await syncing;
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.state.outbox).toHaveLength(1);
    expect(result.state.outbox[0]?.payload).toContain("最新入力");
  });

  it("queues immediate tombstones for expired and over-limit drafts while retaining current device", async () => {
    let now = at(40 * 24 * 60 * 60);
    const records = Array.from({ length: 12 }, (_, index) => {
      const deviceId = index === 0 ? DEVICE : `device-${index}`;
      return makeRecord(deviceId, {
        updatedAt: at(index + 1).toISOString(),
        expiresAt: index === 11
          ? at(1).toISOString()
          : at(40 * 24 * 60 * 60 + 10).toISOString(),
      });
    });
    const cloud = createCloud({
      read: async () => ({
        status: "success",
        drafts: records,
        records,
        issues: [],
      }),
    });
    const { coordinator } = makeHarness({ now: () => now, cloud });

    const result = await coordinator.synchronize("launch");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.snapshot.records).toHaveLength(10);
    expect(result.snapshot.currentDraft?.deviceId).toBe(DEVICE);
    expect(result.state.records["device-11"]?.deletedAt).not.toBeNull();
    expect(cloud.writes.every((mutation) => mutation.deletedAt !== null)).toBe(true);
    expect(cloud.writes.length).toBe(2);
  });

  it("drops an unsent first revision instead of creating an invalid tombstone", async () => {
    let now = at(0);
    const { coordinator, cloud } = makeHarness({ now: () => now });
    expect(coordinator.queueCurrentDraft(makePayload("削除対象")).status).toBe("success");

    now = at(1);
    const deleted = coordinator.queueDelete(DEVICE);
    expect(deleted.status).toBe("success");
    if (deleted.status !== "success") return;
    expect(deleted.state.outbox).toHaveLength(1);
    expect(deleted.state.outbox[0]?.deletedAt).not.toBeNull();
    expect(deleted.snapshot.nextEligibleAt).toBe(at(1).toISOString());

    const result = await coordinator.synchronize("manual");
    expect(result.status).toBe("success");
    expect(cloud.writes).toHaveLength(0);
    expect(result.status === "success" && result.snapshot.outboxCount).toBe(0);
    expect(result.status === "success" && result.snapshot.records).toHaveLength(0);
  });

  it("keeps the current device and tombstones the oldest other draft when ten are active", async () => {
    let now = at(20);
    const records = Array.from({ length: 10 }, (_, index) => makeRecord(`other-${index}`, {
      updatedAt: at(index).toISOString(),
      expiresAt: at(100).toISOString(),
    }));
    const cloud = createCloud({
      read: async () => ({ status: "success", drafts: records, records, issues: [] }),
    });
    const { coordinator } = makeHarness({ now: () => now, cloud });
    expect((await coordinator.synchronize("launch")).status).toBe("success");

    now = at(21);
    const queued = coordinator.queueCurrentDraft(makePayload("現在端末を優先"));
    expect(queued.status).toBe("success");
    if (queued.status !== "success") return;
    expect(queued.snapshot.records).toHaveLength(10);
    expect(queued.snapshot.currentDraft?.deviceId).toBe(DEVICE);
    expect(queued.state.records["other-0"]?.deletedAt).not.toBeNull();
    expect(queued.state.outbox).toHaveLength(2);
  });

  it("passes corrupt remote issues through while preserving usable records", async () => {
    const issue: CloudDraftRepositoryIssue = {
      code: "invalid-document",
      reason: "invalid-document",
      type: "invalid-document",
      message: "broken document",
      deviceId: "broken-device",
    };
    const good = makeRecord(OTHER_DEVICE);
    const cloud = createCloud({
      read: async () => ({
        status: "success",
        drafts: [good],
        records: [good],
        issues: [issue],
      }),
    });
    const { coordinator } = makeHarness({ now: () => at(3), cloud });

    const result = await coordinator.synchronize("manual");
    expect(result.status).toBe("success");
    expect(result.issues).toContainEqual(issue);
    expect(result.status === "success" && result.snapshot.records).toHaveLength(1);
  });

  it("keeps a validated local record when its remote document is excluded as corrupt", async () => {
    const localRecord = makeRecord(OTHER_DEVICE);
    let firstRead = true;
    const issue: CloudDraftRepositoryIssue = {
      code: "invalid-document",
      reason: "invalid-document",
      type: "invalid-document",
      message: "broken document",
      deviceId: OTHER_DEVICE,
    };
    const cloud = createCloud({
      read: async () => {
        if (firstRead) {
          firstRead = false;
          return { status: "success", drafts: [localRecord], records: [localRecord], issues: [] };
        }
        return { status: "success", drafts: [], records: [], issues: [issue] };
      },
    });
    const { coordinator } = makeHarness({ now: () => at(3), cloud });
    expect((await coordinator.synchronize("launch")).status).toBe("success");

    const result = await coordinator.synchronize("focus");
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.snapshot.records.map((record) => record.deviceId)).toContain(OTHER_DEVICE);
    expect(result.issues).toContainEqual(issue);
  });
});
