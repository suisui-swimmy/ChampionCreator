import { describe, expect, it } from "vitest";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./../ui/defenceSearchUi";
import {
  createDraftStorageDocument,
  stringifyDraftStorageDocument,
} from "../ui/draftStorage";
import {
  createFirestoreCloudDraftRepository,
  getCloudDraftCollectionPath,
  type FirestoreCloudDraftDependencies,
} from "./firestoreCloudDraftRepository";

type FakeStoredDocument = {
  readonly id: string;
  data: Record<string, unknown>;
};

type FakeDatabase = {
  readonly documents: Map<string, FakeStoredDocument>;
};

const makeTimestamp = (value: string) => ({
  toDate: () => new Date(value),
});

const makePayload = (): string => stringifyDraftStorageDocument(createDraftStorageDocument(
  createDefaultTargetForm(),
  createDefaultScenarioForms(),
  new Date("2026-08-21T00:00:00.000Z"),
));

const makeMutation = (
  deviceId = "device-a",
  overrides: Partial<{
    readonly deviceLabel: string;
    readonly payload: string;
    readonly revision: number;
    readonly baseRevision: number;
    readonly mutationId: string;
    readonly expiresAt: string;
    readonly deletedAt: string | null;
    readonly tombstone: boolean;
  }> = {},
) => ({
  ownerUid: "uid-a",
  deviceId,
  deviceLabel: "Windows / Chrome",
  payload: makePayload(),
  revision: 1,
  baseRevision: 0,
  mutationId: "mutation-1",
  expiresAt: "2026-09-20T00:00:00.000Z",
  ...overrides,
});

const createFakeDependencies = (
  database: FakeDatabase,
  options: { readonly readError?: unknown } = {},
): FirestoreCloudDraftDependencies => ({
  collection: (_firestore, path) => ({ path }),
  doc: (_collection, id) => ({ id }),
  getDocsFromServer: async () => {
    if (options.readError !== undefined) {
      throw options.readError;
    }
    return {
      docs: [...database.documents.values()].map((stored) => ({
        id: stored.id,
        exists: () => true,
        data: () => stored.data,
      })),
      size: database.documents.size,
    };
  },
  runTransaction: async (_firestore, updateFunction) => {
    const writes: Array<{ readonly id: string; readonly data: Record<string, unknown> }> = [];
    const result = await updateFunction({
      get: async (reference) => {
        const stored = database.documents.get(reference.id ?? "");
        return {
          id: reference.id ?? "",
          exists: () => Boolean(stored),
          data: () => stored?.data,
        };
      },
      set: (reference, data) => {
        writes.push({ id: reference.id ?? "", data });
      },
    });
    if ((result as { status?: string }).status === "written") {
      for (const write of writes) {
        database.documents.set(write.id, { id: write.id, data: write.data });
      }
    }
    return result;
  },
  serverTimestamp: () => makeTimestamp("2026-08-21T00:00:02.000Z"),
  timestampFromDate: (date) => makeTimestamp(date.toISOString()),
});

const createRepository = (
  database: FakeDatabase,
  options: { readonly readError?: unknown } = {},
) => createFirestoreCloudDraftRepository({
  firestore: database,
  uid: "uid-a",
  dependencies: createFakeDependencies(database, options),
});

describe("FirestoreCloudDraftRepository", () => {
  it("uses the per-user drafts path and creates normalized revision one records", async () => {
    expect(getCloudDraftCollectionPath("uid-a")).toBe("users/uid-a/drafts");
    const database: FakeDatabase = { documents: new Map() };
    const repository = createRepository(database);
    const result = await repository.write(makeMutation());

    expect(result.status).toBe("written");
    expect(result.draft).toMatchObject({ revision: 1, baseRevision: 0, deviceId: "device-a" });
    const stored = database.documents.get("device-a");
    expect(stored?.data).toEqual(expect.objectContaining({
      ownerUid: "uid-a",
      deviceId: "device-a",
      deviceLabel: "Windows / Chrome",
      schemaVersion: 1,
      revision: 1,
      baseRevision: 0,
      mutationId: "mutation-1",
      updatedAt: expect.any(Object),
      expiresAt: expect.any(Object),
      deletedAt: null,
    }));
    expect(stored?.data.payload).toBe(makePayload());
    expect(Object.keys(stored?.data ?? {}).sort()).toEqual([
      "baseRevision",
      "deletedAt",
      "deviceId",
      "deviceLabel",
      "expiresAt",
      "mutationId",
      "ownerUid",
      "payload",
      "revision",
      "schemaVersion",
      "updatedAt",
    ]);
  });

  it("updates with transaction CAS and makes duplicate mutations idempotent", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const repository = createRepository(database);
    const first = makeMutation();
    expect((await repository.write(first)).status).toBe("written");
    expect((await repository.write(first)).status).toBe("duplicate");

    const second = makeMutation("device-a", {
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      deviceLabel: "Android / Chrome",
    });
    expect((await repository.write(second)).draft).toMatchObject({ revision: 2, baseRevision: 1 });

    const stale = makeMutation("device-a", {
      revision: 1,
      baseRevision: 0,
      mutationId: "mutation-stale",
    });
    const staleResult = await repository.write(stale);
    expect(staleResult.status).toBe("conflict");
    expect(staleResult.issue?.code).toBe("base-revision-mismatch");

    const reused = makeMutation("device-a", {
      revision: 1,
      baseRevision: 0,
      mutationId: "mutation-2",
      payload: `${makePayload()} `,
    });
    const reusedResult = await repository.write(reused);
    expect(reusedResult.status).toBe("conflict");
    expect(reusedResult.issue?.code).toBe("mutation-id-reuse");
  });

  it("writes a tombstone with a server timestamp and never physically deletes", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const repository = createRepository(database);
    await repository.write(makeMutation());
    const result = await repository.write(makeMutation("device-a", {
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-delete",
      tombstone: true,
    }));

    expect(result.status).toBe("written");
    expect(database.documents.get("device-a")?.data.deletedAt).toMatchObject({
      toDate: expect.any(Function),
    });
    expect(database.documents.size).toBe(1);
    const read = await repository.readAll();
    expect(read.drafts[0]?.deletedAt).toBe("2026-08-21T00:00:02.000Z");
  });

  it("isolates corrupt and future documents while retaining valid drafts", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const valid = makeMutation();
    await createRepository(database).write(valid);
    database.documents.set("future", {
      id: "future",
      data: {
        ...database.documents.get("device-a")?.data,
        deviceId: "future",
        schemaVersion: 2,
      },
    });
    database.documents.set("bad-payload", {
      id: "bad-payload",
      data: {
        ...database.documents.get("device-a")?.data,
        deviceId: "bad-payload",
        payload: "not-json",
      },
    });

    const result = await createRepository(database).readAll();
    expect(result.status).toBe("success");
    expect(result.drafts.map((draft) => draft.deviceId)).toEqual(["device-a"]);
    expect(result.issues.map((item) => item.code)).toEqual([
      "future-envelope-schema",
      "invalid-payload",
    ]);
  });

  it("rejects exact-shape, timestamp, device, label, and payload violations", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const repository = createRepository(database);
    const extra = await repository.write(makeMutation("extra", { payload: makePayload() }));
    expect(extra.status).toBe("written");
    database.documents.set("extra", {
      id: "extra",
      data: { ...database.documents.get("extra")?.data, unexpected: true },
    });
    const read = await repository.readAll();
    expect(read.drafts).toEqual([]);
    expect(read.issues[0]?.code).toBe("invalid-document");

    const oversized = await repository.write(makeMutation("too-long", {
      deviceLabel: "あ".repeat(101),
    }));
    expect(oversized.status).toBe("invalid");
    expect(oversized.issue?.code).toBe("invalid-mutation");

    const oversizedPayload = await repository.write(makeMutation("payload-too-long", {
      payload: "x".repeat(200_001),
    }));
    expect(oversizedPayload.status).toBe("invalid");
    expect(oversizedPayload.issue?.code).toBe("invalid-payload");

    const overRetention = await repository.write(makeMutation("retention-too-long", {
      expiresAt: "2027-08-21T00:00:00.000Z",
    }));
    expect(overRetention.status).toBe("invalid");
    expect(overRetention.issue?.code).toBe("invalid-mutation");
  });

  it("classifies transport errors without exposing raw error text", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const result = await createRepository(database, {
      readError: { code: "permission-denied", message: "secret backend details" },
    }).readAll();
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("permission-denied");
    expect(result.error?.message).not.toContain("secret backend details");
  });
});
