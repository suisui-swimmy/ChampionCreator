import { describe, expect, it } from "vitest";
import {
  createDefaultBoxExampleEntry,
  type BoxEntry,
} from "../ui/boxStorage";
import { encodeSyncPayload } from "./syncPayload";
import {
  createFirestoreSyncRepository,
  makeSyncDocumentId,
  sha256Hex,
  type FirestoreSyncDependencies,
} from "./firestoreSyncRepository";
import { makeSyncRecordKey, type SyncRecord } from "./syncTypes";

type FakeStoredDocument = {
  readonly id: string;
  data: Record<string, unknown>;
};

type FakeDatabase = {
  readonly documents: Map<string, FakeStoredDocument>;
};

const makeEntry = (id: string): BoxEntry => ({
  ...createDefaultBoxExampleEntry("2026-08-21T00:00:00.000Z"),
  id,
});

const makePayload = (id: string): string => encodeSyncPayload("target-box", makeEntry(id));

const makeTimestamp = (value: string) => ({
  toDate: () => new Date(value),
});

const makeRecord = (
  entryId: string,
  overrides: Partial<SyncRecord> = {},
): SyncRecord => {
  const kind = "target-box" as const;
  return {
    ownerUid: "uid-a",
    kind,
    entryId,
    recordKey: makeSyncRecordKey(kind, entryId),
    revision: 1,
    baseRevision: 0,
    payload: makePayload(entryId),
    tombstone: false,
    deletedAt: null,
    updatedAt: "2026-08-21T00:00:00.000Z",
    mutationId: "mutation-1",
    ...overrides,
  };
};

const toRaw = (record: SyncRecord): Record<string, unknown> => ({
  ownerUid: record.ownerUid,
  kind: record.kind,
  schemaVersion: 1,
  entryId: record.entryId,
  payload: record.payload,
  revision: record.revision,
  baseRevision: record.baseRevision,
  mutationId: record.mutationId,
  updatedAt: makeTimestamp(record.updatedAt),
  deletedAt: record.deletedAt === null ? null : makeTimestamp(record.deletedAt),
});

const createFakeDependencies = (
  database: FakeDatabase,
  options: { readonly readError?: unknown } = {},
): FirestoreSyncDependencies => ({
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
  serverTimestamp: () => ({
    __serverTimestamp: true,
    toDate: () => new Date("2026-08-21T00:00:02.000Z"),
  }),
});

const createRepository = (
  database: FakeDatabase,
  options: { readonly readError?: unknown } = {},
) => createFirestoreSyncRepository({
  firestore: database,
  uid: "uid-a",
  dependencies: createFakeDependencies(database, options),
});

describe("FirestoreSyncRepository", () => {
  it("uses SHA-256(kind + ':' + entryId) and preserves arbitrary entry ids", async () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );

    const database: FakeDatabase = { documents: new Map() };
    const entryId = "  任意/slash id  ";
    const record = makeRecord(entryId);
    const result = await createRepository(database).write(record);

    expect(result.status).toBe("written");
    expect(database.documents.has(makeSyncDocumentId("target-box", entryId))).toBe(true);
    expect(database.documents.get(makeSyncDocumentId("target-box", entryId))?.data.entryId)
      .toBe(entryId);
  });

  it("returns empty only when the server collection has zero raw documents", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const result = await createRepository(database).readAll();
    expect(result.status).toBe("empty");
    expect(result.records).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it("keeps valid documents when one remote document is corrupt", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const valid = makeRecord("valid");
    const validId = makeSyncDocumentId(valid.kind, valid.entryId);
    const invalidId = makeSyncDocumentId("target-box", "invalid");
    database.documents.set(validId, { id: validId, data: toRaw(valid) });
    database.documents.set(invalidId, {
      id: invalidId,
      data: { ...toRaw(makeRecord("invalid")), payload: "not-json" },
    });

    const result = await createRepository(database).readAll();
    expect(result.status).toBe("success");
    expect(result.records.map((record) => record.entryId)).toEqual(["valid"]);
    expect(result.issues.map((item) => item.code)).toContain("invalid-payload");
  });

  it("separates future envelope and payload schema issues", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const futureEnvelopeId = makeSyncDocumentId("target-box", "future-envelope");
    const futurePayloadId = makeSyncDocumentId("target-box", "future-payload");
    database.documents.set(futureEnvelopeId, {
      id: futureEnvelopeId,
      data: { ...toRaw(makeRecord("future-envelope")), schemaVersion: 2 },
    });
    database.documents.set(futurePayloadId, {
      id: futurePayloadId,
      data: {
        ...toRaw(makeRecord("future-payload")),
        payload: JSON.stringify({ schemaVersion: 2, entries: [] }),
      },
    });

    const result = await createRepository(database).readAll();
    expect(result.issues.map((item) => item.code)).toEqual([
      "future-envelope-schema",
      "future-payload-schema",
    ]);
  });

  it("enforces the exact remote shape, Timestamp-like times, and UTF-8 limits", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const extra = makeRecord("extra-field");
    const extraId = makeSyncDocumentId(extra.kind, extra.entryId);
    database.documents.set(extraId, {
      id: extraId,
      data: { ...toRaw(extra), unexpected: true },
    });
    const stringTimestamp = makeRecord("string-time");
    const stringTimestampId = makeSyncDocumentId(stringTimestamp.kind, stringTimestamp.entryId);
    database.documents.set(stringTimestampId, {
      id: stringTimestampId,
      data: { ...toRaw(stringTimestamp), updatedAt: "2026-08-21T00:00:00.000Z" },
    });
    const longEntryId = "あ".repeat(2049);
    const longEntry = makeRecord(longEntryId);
    const longEntryIdHash = makeSyncDocumentId(longEntry.kind, longEntry.entryId);
    database.documents.set(longEntryIdHash, {
      id: longEntryIdHash,
      data: toRaw(longEntry),
    });

    const read = await createRepository(database).readAll();
    expect(read.records).toEqual([]);
    expect(read.issues.map((item) => item.code)).toEqual([
      "invalid-document",
      "invalid-document",
      "invalid-document",
    ]);

    const oversizedPayload = makeRecord("oversized-payload", {
      payload: "x".repeat(200_001),
    });
    const write = await createRepository({ documents: new Map() }).write(oversizedPayload);
    expect(write.status).toBe("invalid");
    expect(write.issue?.code).toBe("invalid-mutation");
  });

  it("uses transaction CAS and makes same mutation id idempotent", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const repository = createRepository(database);
    const first = makeRecord("cas");
    expect((await repository.write(first)).status).toBe("written");
    expect((await repository.write(first)).status).toBe("duplicate");

    const reused = makeRecord("cas", {
      payload: encodeSyncPayload("target-box", {
        ...makeEntry("cas"),
        name: "different-content",
      }),
      mutationId: first.mutationId,
    });
    const reuseResult = await repository.write(reused);
    expect(reuseResult.status).toBe("conflict");
    expect(reuseResult.issue?.code).toBe("mutation-id-reuse");

    const stale = makeRecord("cas", {
      revision: 1,
      baseRevision: 0,
      mutationId: "mutation-stale",
    });
    const staleResult = await repository.write(stale);
    expect(staleResult.status).toBe("conflict");
    expect(staleResult.issue?.code).toBe("base-revision-mismatch");
  });

  it("writes tombstones with server timestamps and never physically deletes", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const repository = createRepository(database);
    const tombstone = makeRecord("deleted", {
      tombstone: true,
      deletedAt: "2026-08-21T00:00:01.000Z",
    });
    const result = await repository.write(tombstone);
    expect(result.status).toBe("written");
    const stored = database.documents.get(makeSyncDocumentId("target-box", "deleted"));
    expect(stored?.data.deletedAt).toMatchObject({ __serverTimestamp: true });
    expect(stored?.data.updatedAt).toMatchObject({ __serverTimestamp: true });

    const read = await repository.readAll();
    expect(read.records[0]?.tombstone).toBe(true);
  });

  it("sanitizes Firestore errors without exposing raw error text", async () => {
    const database: FakeDatabase = { documents: new Map() };
    const result = await createRepository(database, { readError: { code: "permission-denied", message: "secret" } })
      .readAll();
    expect(result.status).toBe("error");
    expect(result.error?.kind).toBe("permission-denied");
    expect(result.error?.message).not.toContain("secret");
  });

  it.each([
    ["deadline-exceeded", "network"],
    ["permission-denied", "permission-denied"],
    ["resource-exhausted", "quota"],
    ["unavailable", "unavailable"],
  ] as const)("classifies %s without collapsing remote failures", async (code, expectedKind) => {
    const database: FakeDatabase = { documents: new Map() };
    const result = await createRepository(database, { readError: { code } }).readAll();

    expect(result).toMatchObject({
      status: "error",
      error: { kind: expectedKind },
    });
  });
});
