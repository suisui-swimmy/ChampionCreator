import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { serverTimestamp, Timestamp } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-championcreator";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

type SyncRecord = {
  ownerUid?: unknown;
  kind?: unknown;
  schemaVersion?: unknown;
  entryId?: unknown;
  payload?: unknown;
  revision?: unknown;
  baseRevision?: unknown;
  mutationId?: unknown;
  updatedAt?: unknown;
  deletedAt?: unknown;
  [field: string]: unknown;
};

const validRecord = (overrides: Partial<SyncRecord> = {}): SyncRecord => ({
  ownerUid: "alice",
  kind: "target-box",
  schemaVersion: 1,
  entryId: "record-1",
  payload: "{}",
  revision: 1,
  baseRevision: 0,
  mutationId: "mutation-1",
  updatedAt: serverTimestamp(),
  deletedAt: null,
  ...overrides,
});

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).length;
const payloadAtUtf8Boundary = "あ".repeat(66_666) + "AA";
const entryIdAtUtf8Boundary = "あ".repeat(1_365) + "A";
const mutationIdAtUtf8Boundary = "あ".repeat(42) + "AB";

const canonicalDocumentId = (kind: string, entryId: string): string => (
  createHash("sha256").update(`${kind}:${entryId}`, "utf8").digest("hex")
);

const syncRecordPath = (uid: string, kind: string, entryId: string): string => (
  `users/${uid}/syncRecords/${canonicalDocumentId(kind, entryId)}`
);

const DOCUMENT_PATH = syncRecordPath("alice", "target-box", "record-1");
const NONCANONICAL_DOCUMENT_PATH = "users/alice/syncRecords/record-1";

let testEnv: RulesTestEnvironment;

const aliceDocument = (record: Partial<SyncRecord> = {}) => {
  const kind = typeof record.kind === "string" ? record.kind : "target-box";
  const entryId = typeof record.entryId === "string" ? record.entryId : "record-1";
  return testEnv.authenticatedContext("alice").firestore().doc(
    syncRecordPath("alice", kind, entryId),
  );
};

describe("Firestore sync record rules", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules: readFileSync(RULES_PATH, "utf8"),
      },
    });
  });

  afterEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it("denies unauthenticated create, read, update, and delete", async () => {
    const unauthed = testEnv.unauthenticatedContext().firestore();
    const document = unauthed.doc(DOCUMENT_PATH);

    await assertFails(document.set(validRecord()));
    await assertFails(document.get());

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(DOCUMENT_PATH).set(validRecord());
    });
    await assertFails(document.update({ payload: '{"revision":2}' }));
    await assertFails(document.delete());
  });

  it("allows the owner to create, read, list, and sequentially update, but denies delete", async () => {
    const document = aliceDocument();

    await assertSucceeds(document.set(validRecord()));
    const snapshot = await assertSucceeds(document.get());
    expect(snapshot.data()).toMatchObject({
      ownerUid: "alice",
      kind: "target-box",
      schemaVersion: 1,
      entryId: "record-1",
      payload: "{}",
      revision: 1,
      baseRevision: 0,
      mutationId: "mutation-1",
      deletedAt: null,
    });
    expect(snapshot.data()?.updatedAt).toBeInstanceOf(Timestamp);
    const list = await assertSucceeds(
      testEnv.authenticatedContext("alice").firestore().collection("users/alice/syncRecords").get(),
    );
    expect(list.docs).toHaveLength(1);

    await assertSucceeds(document.update({
      ownerUid: "alice",
      kind: "target-box",
      schemaVersion: 1,
      entryId: "record-1",
      payload: '{"revision":2}',
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      updatedAt: serverTimestamp(),
      deletedAt: null,
    }));
    const updated = await assertSucceeds(document.get());
    expect(updated.data()).toMatchObject({
      ownerUid: "alice",
      kind: "target-box",
      schemaVersion: 1,
      entryId: "record-1",
      payload: '{"revision":2}',
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      deletedAt: null,
    });
    expect(updated.data()?.updatedAt).toBeInstanceOf(Timestamp);

    await assertFails(document.delete());
    await assertSucceeds(document.get());
  });

  it("allows both supported sync record kinds", async () => {
    const record = validRecord({
      kind: "enemy-box",
    });
    await assertSucceeds(aliceDocument(record).set(record));
  });

  it("denies a different uid from reading or updating the owner's record", async () => {
    await assertSucceeds(aliceDocument().set(validRecord()));

    const otherDocument = testEnv
      .authenticatedContext("bob")
      .firestore()
      .doc(DOCUMENT_PATH);
    await assertFails(otherDocument.get());
    await assertFails(otherDocument.update(validRecord({ ownerUid: "alice" })));
    await assertFails(
      testEnv.authenticatedContext("bob").firestore().collection("users/alice/syncRecords").get(),
    );
  });

  it("requires the authenticated uid, path uid, and ownerUid to match", async () => {
    const alice = testEnv.authenticatedContext("alice").firestore();
    await assertFails(alice.doc(
      syncRecordPath("bob", "target-box", "record-1"),
    ).set(validRecord()));
    await assertFails(alice.doc(DOCUMENT_PATH).set(validRecord({ ownerUid: "bob" })));

    const bob = testEnv.authenticatedContext("bob").firestore();
    await assertFails(bob.doc(DOCUMENT_PATH).set(validRecord({ ownerUid: "bob" })));
  });

  it("rejects create and update at a noncanonical document ID", async () => {
    expect(DOCUMENT_PATH).toBe(syncRecordPath("alice", "target-box", "record-1"));
    expect(DOCUMENT_PATH).not.toBe(NONCANONICAL_DOCUMENT_PATH);

    const document = testEnv
      .authenticatedContext("alice")
      .firestore()
      .doc(NONCANONICAL_DOCUMENT_PATH);
    const record = validRecord();
    await assertFails(document.set(record));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(NONCANONICAL_DOCUMENT_PATH).set(record);
    });
    await assertFails(document.update(validRecord({
      payload: "updated",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      updatedAt: serverTimestamp(),
    })));
  });

  it.each([
    ["missing ownerUid", (() => {
      const record = validRecord();
      delete record.ownerUid;
      return record;
    })()],
    ["missing kind", (() => {
      const record = validRecord();
      delete record.kind;
      return record;
    })()],
    ["missing schemaVersion", (() => {
      const record = validRecord();
      delete record.schemaVersion;
      return record;
    })()],
    ["missing entryId", (() => {
      const record = validRecord();
      delete record.entryId;
      return record;
    })()],
    ["missing payload", (() => {
      const record = validRecord();
      delete record.payload;
      return record;
    })()],
    ["missing revision", (() => {
      const record = validRecord();
      delete record.revision;
      return record;
    })()],
    ["missing baseRevision", (() => {
      const record = validRecord();
      delete record.baseRevision;
      return record;
    })()],
    ["missing mutationId", (() => {
      const record = validRecord();
      delete record.mutationId;
      return record;
    })()],
    ["missing updatedAt", (() => {
      const record = validRecord();
      delete record.updatedAt;
      return record;
    })()],
    ["missing deletedAt", (() => {
      const record = validRecord();
      delete record.deletedAt;
      return record;
    })()],
    ["extra field", validRecord({ extra: true })],
    ["ownerUid is not a string", validRecord({ ownerUid: 1 })],
    ["kind is not a string", validRecord({ kind: 1 })],
    ["kind is not supported", validRecord({ kind: "draft" })],
    ["schemaVersion is not an integer", validRecord({ schemaVersion: 1.5 })],
    ["schemaVersion is unsupported", validRecord({ schemaVersion: 2 })],
    ["entryId is not a string", validRecord({ entryId: 1 })],
    ["entryId is empty", validRecord({ entryId: "" })],
    ["payload is not a string", validRecord({ payload: { value: "{}" } })],
    ["revision is not an integer", validRecord({ revision: 1.5 })],
    ["revision is negative", validRecord({ revision: -1 })],
    ["baseRevision is not an integer", validRecord({ baseRevision: 0.5 })],
    ["baseRevision is negative", validRecord({ baseRevision: -1 })],
    ["mutationId is not a string", validRecord({ mutationId: 1 })],
    ["mutationId is empty", validRecord({ mutationId: "" })],
    ["updatedAt is not a timestamp", validRecord({ updatedAt: "server" })],
    ["deletedAt is not null or a timestamp", validRecord({ deletedAt: "deleted" })],
  ] as const)("rejects %s", async (_label, record) => {
    await assertFails(aliceDocument(record).set(record));
  });

  it("uses server timestamps for create and rejects client timestamps", async () => {
    await assertSucceeds(aliceDocument().set(validRecord({
      updatedAt: serverTimestamp(),
    })));
    const record = validRecord({
      entryId: "record-2",
      updatedAt: Timestamp.fromMillis(0),
    });
    await assertFails(aliceDocument(record).set(record));
  });

  it("accepts the UTF-8 byte boundaries for entryId, mutationId, and payload", async () => {
    expect(utf8ByteLength(entryIdAtUtf8Boundary)).toBe(4096);
    expect(utf8ByteLength(mutationIdAtUtf8Boundary)).toBe(128);
    expect(utf8ByteLength(payloadAtUtf8Boundary)).toBe(200000);

    const record = validRecord({
      entryId: entryIdAtUtf8Boundary,
      mutationId: mutationIdAtUtf8Boundary,
      payload: payloadAtUtf8Boundary,
    });
    await assertSucceeds(aliceDocument(record).set(record));
  });

  it("rejects UTF-8 values one byte over the limits", async () => {
    expect(utf8ByteLength(`${entryIdAtUtf8Boundary}A`)).toBe(4097);
    expect(utf8ByteLength(`${mutationIdAtUtf8Boundary}A`)).toBe(129);
    expect(utf8ByteLength(`${payloadAtUtf8Boundary}A`)).toBe(200001);

    const entryIdRecord = validRecord({
      entryId: `${entryIdAtUtf8Boundary}A`,
    });
    await assertFails(aliceDocument(entryIdRecord).set(entryIdRecord));
    const mutationIdRecord = validRecord({
      entryId: "record-2",
      mutationId: `${mutationIdAtUtf8Boundary}A`,
    });
    await assertFails(aliceDocument(mutationIdRecord).set(mutationIdRecord));
    const payloadRecord = validRecord({
      entryId: "record-3",
      mutationId: "mutation-3",
      payload: `${payloadAtUtf8Boundary}A`,
    });
    await assertFails(aliceDocument(payloadRecord).set(payloadRecord));
  });

  it("accepts a payload at the 200000-byte ASCII boundary", async () => {
    await assertSucceeds(aliceDocument().set(validRecord({
      payload: "A".repeat(200000),
    })));
  });

  it("rejects a payload over the 200000-byte limit", async () => {
    await assertFails(aliceDocument().set(validRecord({
      payload: "A".repeat(200001),
    })));
  });

  it("rejects create tombstones and accepts server-timestamp tombstone updates", async () => {
    const document = aliceDocument();
    await assertSucceeds(document.set(validRecord()));

    const record = validRecord({
      entryId: "record-2",
      deletedAt: serverTimestamp(),
    });
    await assertFails(aliceDocument(record).set(record));

    await assertSucceeds(document.update(validRecord({
      payload: '{"deleted":true}',
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      updatedAt: serverTimestamp(),
      deletedAt: serverTimestamp(),
    })));
    const tombstone = await assertSucceeds(document.get());
    expect(tombstone.data()?.deletedAt).toBeInstanceOf(Timestamp);

    await assertSucceeds(document.update(validRecord({
      payload: '{"deleted":false}',
      revision: 3,
      baseRevision: 2,
      mutationId: "mutation-3",
      updatedAt: serverTimestamp(),
      deletedAt: null,
    })));
  });

  it("rejects stale and flying revisions", async () => {
    const document = aliceDocument();
    await assertSucceeds(document.set(validRecord()));

    await assertSucceeds(document.update(validRecord({
      payload: "v2",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      updatedAt: serverTimestamp(),
    })));

    await assertFails(document.update(validRecord({
      payload: "stale",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-stale",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validRecord({
      payload: "flying",
      revision: 4,
      baseRevision: 3,
      mutationId: "mutation-flying",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validRecord({
      payload: "wrong-base",
      revision: 3,
      baseRevision: 1,
      mutationId: "mutation-wrong-base",
      updatedAt: serverTimestamp(),
    })));
  });

  it("rejects immutable field changes and extra fields during update", async () => {
    const document = aliceDocument();
    await assertSucceeds(document.set(validRecord()));

    await assertFails(document.update(validRecord({
      kind: "enemy-box",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-kind",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validRecord({
      entryId: "record-2",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-entry",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validRecord({ ownerUid: "bob" })));
    await assertFails(document.update({
      ownerUid: "alice",
      kind: "target-box",
      schemaVersion: 1,
      entryId: "record-1",
      payload: "{}",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-extra",
      updatedAt: serverTimestamp(),
      deletedAt: null,
      extra: true,
    }));
  });
});
