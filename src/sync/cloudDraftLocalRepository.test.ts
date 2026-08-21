import { describe, expect, it } from "vitest";
import {
  createDraftStorageDocument,
  stringifyDraftStorageDocument,
} from "../ui/draftStorage";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "../ui/defenceSearchUi";
import {
  CLOUD_DRAFT_SCHEMA_VERSION,
  createEmptyCloudDraftLocalState,
  type CloudDraftLocalState,
} from "./cloudDraftTypes";
import {
  createCloudDraftLocalRepository,
  createMemoryCloudDraftLocalRepository,
  makeCloudDraftStorageKey,
  parseCloudDraftLocalState,
  stringifyCloudDraftLocalState,
  type CloudDraftStorageLike,
} from "./cloudDraftLocalRepository";

const OWNER_UID = "owner/日本語";
const DEVICE_ID = "device/one";
const OTHER_DEVICE_ID = "device/two";
const payload = stringifyDraftStorageDocument(createDraftStorageDocument(
  createDefaultTargetForm(),
  createDefaultScenarioForms(),
  new Date("2026-08-21T00:00:00.000Z"),
));

const record = (deviceId: string, deletedAt: string | null = null) => ({
  ownerUid: OWNER_UID,
  deviceId,
  deviceLabel: `Device ${deviceId}`,
  schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
  payload,
  revision: 1,
  baseRevision: 0,
  mutationId: `mutation-${deviceId}`,
  updatedAt: "2026-08-21T00:00:00.000Z",
  expiresAt: "2026-09-20T00:00:00.000Z",
  deletedAt,
});

const stateWithRecord = (deviceId = OTHER_DEVICE_ID): CloudDraftLocalState => ({
  ...createEmptyCloudDraftLocalState(OWNER_UID, DEVICE_ID),
  records: { [deviceId]: record(deviceId) },
  outbox: [{
    ...record(deviceId),
    sequence: 1,
    queuedAt: "2026-08-21T00:00:01.000Z",
    baseMutationId: null,
  }],
  nextSequence: 2,
});

const createMemoryStorage = (initial: Record<string, string | null> = {}) => {
  const values = new Map(Object.entries(initial));
  const reads: string[] = [];
  const writes: Array<[string, string]> = [];
  const storage: CloudDraftStorageLike = {
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

describe("cloudDraftLocalRepository", () => {
  it("uses an owner/device-scoped key and saves the whole state atomically", () => {
    const memory = createMemoryStorage();
    const repository = createCloudDraftLocalRepository(OWNER_UID, DEVICE_ID, {
      storage: memory.storage,
    });
    expect(repository.storageKey).toBe(makeCloudDraftStorageKey(OWNER_UID, DEVICE_ID));
    expect(repository.load()).toEqual({ status: "missing" });

    const saved = repository.save(stateWithRecord());
    expect(saved).toMatchObject({ status: "valid" });
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0]?.[0]).toBe(repository.storageKey);
    const loaded = repository.load();
    expect(loaded).toMatchObject({
      status: "valid",
      state: {
        ownerUid: OWNER_UID,
        currentDeviceId: DEVICE_ID,
        nextSequence: 2,
      },
    });
    if (loaded.status === "valid") {
      expect(loaded.state.records[OTHER_DEVICE_ID]?.deviceId).toBe(OTHER_DEVICE_ID);
      expect(loaded.state.outbox[0]?.sequence).toBe(1);
    }
  });

  it("keeps guest/other device slots separate", () => {
    const memory = createMemoryStorage();
    const first = createCloudDraftLocalRepository(OWNER_UID, DEVICE_ID, { storage: memory.storage });
    const second = createCloudDraftLocalRepository(OWNER_UID, OTHER_DEVICE_ID, { storage: memory.storage });
    expect(first.storageKey).not.toBe(second.storageKey);
    first.save(stateWithRecord());
    expect(second.load()).toEqual({ status: "missing" });
  });

  it("rejects malformed JSON, future schema, invalid payload, and too many active records", () => {
    const owner = OWNER_UID;
    const device = DEVICE_ID;
    const repository = createMemoryCloudDraftLocalRepository(owner, device, "not-json");
    expect(repository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });

    const future = { ...createEmptyCloudDraftLocalState(owner, device), schemaVersion: 999 };
    repository.setRaw(JSON.stringify(future));
    expect(repository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });

    const malformedPayload = {
      ...createEmptyCloudDraftLocalState(owner, device),
      records: { [OTHER_DEVICE_ID]: { ...record(OTHER_DEVICE_ID), payload: "{}" } },
    };
    repository.setRaw(JSON.stringify(malformedPayload));
    expect(repository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });

    const tooMany = createEmptyCloudDraftLocalState(owner, device);
    const records = Object.fromEntries(Array.from({ length: 11 }, (_, index) => {
      const id = `device-${index}`;
      return [id, record(id)];
    }));
    repository.setRaw(JSON.stringify({ ...tooMany, records }));
    expect(repository.load()).toMatchObject({ status: "corrupt", error: { code: "corrupt" } });
  });

  it("retains tombstone payloads while counting only active records toward the limit", () => {
    const state = createEmptyCloudDraftLocalState(OWNER_UID, DEVICE_ID);
    const records = Object.fromEntries(Array.from({ length: 11 }, (_, index) => {
      const id = `device-${index}`;
      return [id, record(id, index === 10 ? "2026-08-21T00:00:02.000Z" : null)];
    }));
    const parsed = parseCloudDraftLocalState(
      JSON.stringify({ ...state, records }),
      OWNER_UID,
      DEVICE_ID,
    );
    expect(Object.keys(parsed.records)).toHaveLength(11);
    expect(parsed.records["device-10"]?.payload).toBe(payload);
    expect(parsed.records["device-10"]?.deletedAt).not.toBeNull();
  });

  it("distinguishes unavailable and quota failures", () => {
    const repository = createCloudDraftLocalRepository(OWNER_UID, DEVICE_ID, { storage: null });
    expect(repository.load()).toMatchObject({ status: "unavailable", error: { code: "unavailable" } });
    expect(repository.save(createEmptyCloudDraftLocalState(OWNER_UID, DEVICE_ID)))
      .toMatchObject({ status: "unavailable", error: { code: "unavailable" } });

    const memory = createMemoryStorage();
    memory.storage.setItem = () => {
      throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
    };
    const quotaRepository = createCloudDraftLocalRepository(OWNER_UID, DEVICE_ID, { storage: memory.storage });
    expect(quotaRepository.save(createEmptyCloudDraftLocalState(OWNER_UID, DEVICE_ID)))
      .toMatchObject({ status: "quota", error: { code: "quota" } });
  });

  it("round-trips the strict state serializer", () => {
    const state = stateWithRecord();
    const raw = stringifyCloudDraftLocalState(state);
    expect(parseCloudDraftLocalState(raw, OWNER_UID, DEVICE_ID)).toEqual(state);
  });
});

