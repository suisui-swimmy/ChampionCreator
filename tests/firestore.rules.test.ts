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

type Draft = {
  ownerUid?: unknown;
  deviceId?: unknown;
  deviceLabel?: unknown;
  schemaVersion?: unknown;
  payload?: unknown;
  revision?: unknown;
  baseRevision?: unknown;
  mutationId?: unknown;
  updatedAt?: unknown;
  expiresAt?: unknown;
  deletedAt?: unknown;
  [field: string]: unknown;
};

const draftPath = (uid: string, deviceId: string): string => (
  `users/${uid}/drafts/${deviceId}`
);

const validDraft = (overrides: Partial<Draft> = {}): Draft => ({
  ownerUid: "alice",
  deviceId: "device-1",
  deviceLabel: "Alice laptop",
  schemaVersion: 1,
  payload: "{}",
  revision: 1,
  baseRevision: 0,
  mutationId: "mutation-1",
  updatedAt: serverTimestamp(),
  expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
  deletedAt: null,
  ...overrides,
});

const DRAFT_PATH = draftPath("alice", "device-1");

let draftTestEnv: RulesTestEnvironment;

const aliceDraft = (draft: Partial<Draft> = {}) => {
  const deviceId = typeof draft.deviceId === "string" ? draft.deviceId : "device-1";
  return draftTestEnv.authenticatedContext("alice").firestore().doc(
    draftPath("alice", deviceId),
  );
};

describe("Firestore draft rules", () => {
  beforeAll(async () => {
    draftTestEnv = await initializeTestEnvironment({
      projectId: `${PROJECT_ID}-drafts`,
      firestore: {
        rules: readFileSync(RULES_PATH, "utf8"),
      },
    });
  });

  afterEach(async () => {
    if (draftTestEnv) {
      await draftTestEnv.clearFirestore();
    }
  });

  afterAll(async () => {
    if (draftTestEnv) {
      await draftTestEnv.cleanup();
    }
  });

  it("denies unauthenticated create, read, list, update, and delete", async () => {
    const unauthed = draftTestEnv.unauthenticatedContext().firestore();
    const document = unauthed.doc(DRAFT_PATH);

    await assertFails(document.set(validDraft()));
    await assertFails(document.get());
    await assertFails(unauthed.collection("users/alice/drafts").get());

    await draftTestEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(DRAFT_PATH).set(validDraft());
    });
    await assertFails(document.update(validDraft({
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.delete());
  });

  it("allows the owner to create, read, list, update, tombstone, and resurrect, but denies delete", async () => {
    const document = aliceDraft();

    await assertSucceeds(document.set(validDraft()));
    const created = await assertSucceeds(document.get());
    expect(created.data()).toMatchObject({
      ownerUid: "alice",
      deviceId: "device-1",
      deviceLabel: "Alice laptop",
      schemaVersion: 1,
      payload: "{}",
      revision: 1,
      baseRevision: 0,
      mutationId: "mutation-1",
      deletedAt: null,
    });
    expect(created.data()?.updatedAt).toBeInstanceOf(Timestamp);
    expect(created.data()?.expiresAt).toBeInstanceOf(Timestamp);

    const list = await assertSucceeds(
      draftTestEnv.authenticatedContext("alice").firestore()
        .collection("users/alice/drafts").get(),
    );
    expect(list.docs).toHaveLength(1);

    await assertSucceeds(document.update({
      ownerUid: "alice",
      deviceId: "device-1",
      deviceLabel: "Alice desktop",
      schemaVersion: 1,
      payload: '{"step":2}',
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      deletedAt: null,
    }));
    const updated = await assertSucceeds(document.get());
    expect(updated.data()).toMatchObject({
      ownerUid: "alice",
      deviceId: "device-1",
      deviceLabel: "Alice desktop",
      payload: '{"step":2}',
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-2",
      deletedAt: null,
    });
    expect(updated.data()?.updatedAt).toBeInstanceOf(Timestamp);

    await assertSucceeds(document.update({
      ownerUid: "alice",
      deviceId: "device-1",
      deviceLabel: "Alice desktop",
      schemaVersion: 1,
      payload: '{"deleted":true}',
      revision: 3,
      baseRevision: 2,
      mutationId: "mutation-3",
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      deletedAt: serverTimestamp(),
    }));
    const tombstone = await assertSucceeds(document.get());
    expect(tombstone.data()?.deletedAt).toBeInstanceOf(Timestamp);
    expect(tombstone.data()?.updatedAt).toBeInstanceOf(Timestamp);

    await assertSucceeds(document.update({
      ownerUid: "alice",
      deviceId: "device-1",
      deviceLabel: "Alice desktop",
      schemaVersion: 1,
      payload: '{"deleted":false}',
      revision: 4,
      baseRevision: 3,
      mutationId: "mutation-4",
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      deletedAt: null,
    }));
    const resurrected = await assertSucceeds(document.get());
    expect(resurrected.data()).toMatchObject({
      revision: 4,
      baseRevision: 3,
      mutationId: "mutation-4",
      deletedAt: null,
    });
    expect(resurrected.data()?.updatedAt).toBeInstanceOf(Timestamp);

    await assertFails(document.delete());
    await assertSucceeds(document.get());
  });

  it("denies a different uid from reading, listing, or updating the owner's draft", async () => {
    await assertSucceeds(aliceDraft().set(validDraft()));

    const otherFirestore = draftTestEnv.authenticatedContext("bob").firestore();
    const otherDocument = otherFirestore.doc(DRAFT_PATH);
    await assertFails(otherDocument.get());
    await assertFails(otherDocument.update({
      ownerUid: "alice",
      deviceId: "device-1",
      deviceLabel: "Bob",
      schemaVersion: 1,
      payload: "bob",
      revision: 2,
      baseRevision: 1,
      mutationId: "bob-mutation",
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      deletedAt: null,
    }));
    await assertFails(otherFirestore.collection("users/alice/drafts").get());
  });

  it("requires the authenticated uid, path uid, ownerUid, and deviceId to match", async () => {
    const alice = draftTestEnv.authenticatedContext("alice").firestore();
    await assertFails(alice.doc(draftPath("bob", "device-1")).set(validDraft()));
    await assertFails(alice.doc(DRAFT_PATH).set(validDraft({ ownerUid: "bob" })));
    await assertFails(alice.doc(DRAFT_PATH).set(validDraft({ deviceId: "device-2" })));

    const bob = draftTestEnv.authenticatedContext("bob").firestore();
    await assertFails(bob.doc(DRAFT_PATH).set(validDraft({ ownerUid: "bob" })));
  });

  it("rejects physical delete and non-sequential or stale revisions", async () => {
    const document = aliceDraft();
    await assertSucceeds(document.set(validDraft()));

    await assertFails(document.update(validDraft({
      payload: "stale",
      revision: 1,
      baseRevision: 0,
      mutationId: "mutation-stale",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validDraft({
      payload: "flying",
      revision: 3,
      baseRevision: 2,
      mutationId: "mutation-flying",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validDraft({
      payload: "wrong-base",
      revision: 2,
      baseRevision: 0,
      mutationId: "mutation-wrong-base",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validDraft({
      ownerUid: "bob",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-owner",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.update(validDraft({
      deviceId: "device-2",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-device",
      updatedAt: serverTimestamp(),
    })));
    await assertFails(document.delete());
  });

  it.each([
    ["missing ownerUid", (() => { const draft = validDraft(); delete draft.ownerUid; return draft; })()],
    ["missing deviceId", (() => { const draft = validDraft(); delete draft.deviceId; return draft; })()],
    ["missing deviceLabel", (() => { const draft = validDraft(); delete draft.deviceLabel; return draft; })()],
    ["missing schemaVersion", (() => { const draft = validDraft(); delete draft.schemaVersion; return draft; })()],
    ["missing payload", (() => { const draft = validDraft(); delete draft.payload; return draft; })()],
    ["missing revision", (() => { const draft = validDraft(); delete draft.revision; return draft; })()],
    ["missing baseRevision", (() => { const draft = validDraft(); delete draft.baseRevision; return draft; })()],
    ["missing mutationId", (() => { const draft = validDraft(); delete draft.mutationId; return draft; })()],
    ["missing updatedAt", (() => { const draft = validDraft(); delete draft.updatedAt; return draft; })()],
    ["missing expiresAt", (() => { const draft = validDraft(); delete draft.expiresAt; return draft; })()],
    ["missing deletedAt", (() => { const draft = validDraft(); delete draft.deletedAt; return draft; })()],
    ["extra field", validDraft({ extra: true })],
    ["ownerUid is not a string", validDraft({ ownerUid: 1 })],
    ["deviceId is not a string", validDraft({ deviceId: 1 })],
    ["deviceLabel is not a string", validDraft({ deviceLabel: 1 })],
    ["schemaVersion is not an integer", validDraft({ schemaVersion: 1.5 })],
    ["schemaVersion is unsupported", validDraft({ schemaVersion: 2 })],
    ["payload is not a string", validDraft({ payload: { value: "{}" } })],
    ["revision is not an integer", validDraft({ revision: 1.5 })],
    ["revision is negative", validDraft({ revision: -1 })],
    ["baseRevision is not an integer", validDraft({ baseRevision: 0.5 })],
    ["baseRevision is negative", validDraft({ baseRevision: -1 })],
    ["mutationId is not a string", validDraft({ mutationId: 1 })],
    ["mutationId is empty", validDraft({ mutationId: "" })],
    ["updatedAt is not a timestamp", validDraft({ updatedAt: "server" })],
    ["expiresAt is not a timestamp", validDraft({ expiresAt: "future" })],
    ["expiresAt is not in the future", validDraft({ expiresAt: Timestamp.fromMillis(0) })],
    ["deletedAt is not null or a timestamp", validDraft({ deletedAt: "deleted" })],
  ] as const)("rejects %s", async (_label, draft) => {
    await assertFails(aliceDraft(draft).set(draft));
  });

  it("accepts the UTF-8 byte boundaries for deviceId, deviceLabel, mutationId, and payload", async () => {
    const deviceId = "あ".repeat(42) + "AA";
    const deviceLabel = "あ".repeat(66) + "AA";
    const mutationId = "あ".repeat(42) + "AB";
    const payload = "あ".repeat(66_666) + "AA";
    expect(utf8ByteLength(deviceId)).toBe(128);
    expect(utf8ByteLength(deviceLabel)).toBe(200);
    expect(utf8ByteLength(mutationId)).toBe(128);
    expect(utf8ByteLength(payload)).toBe(200000);

    const draft = validDraft({ deviceId, deviceLabel, mutationId, payload });
    await assertSucceeds(aliceDraft(draft).set(draft));
  });

  it("rejects UTF-8 values one byte over the deviceId, deviceLabel, mutationId, and payload limits", async () => {
    const deviceIdAtBoundary = "あ".repeat(42) + "AA";
    const deviceLabelAtBoundary = "あ".repeat(66) + "AA";
    const mutationIdAtBoundary = "あ".repeat(42) + "AB";
    const payloadAtBoundary = "あ".repeat(66_666) + "AA";
    const deviceIdDraft = validDraft({ deviceId: `${deviceIdAtBoundary}A` });
    const deviceLabelDraft = validDraft({ deviceLabel: `${deviceLabelAtBoundary}A` });
    const mutationIdDraft = validDraft({ mutationId: `${mutationIdAtBoundary}A` });
    const payloadDraft = validDraft({ payload: `${payloadAtBoundary}A` });
    expect(utf8ByteLength(deviceIdDraft.deviceId as string)).toBe(129);
    expect(utf8ByteLength(deviceLabelDraft.deviceLabel as string)).toBe(201);
    expect(utf8ByteLength(mutationIdDraft.mutationId as string)).toBe(129);
    expect(utf8ByteLength(payloadDraft.payload as string)).toBe(200001);

    await assertFails(aliceDraft(deviceIdDraft).set(deviceIdDraft));
    await assertFails(aliceDraft().set(deviceLabelDraft));
    await assertFails(aliceDraft().set(mutationIdDraft));
    await assertFails(aliceDraft().set(payloadDraft));
  });

  it("requires server updatedAt and future expiresAt on create and update", async () => {
    await assertFails(aliceDraft().set(validDraft({
      updatedAt: Timestamp.fromMillis(0),
    })));
    await assertFails(aliceDraft().set(validDraft({
      expiresAt: serverTimestamp(),
    })));
    await assertFails(aliceDraft().set(validDraft({
      expiresAt: Timestamp.fromMillis(Date.now() + 31 * 24 * 60 * 60 * 1000),
    })));
    await assertSucceeds(aliceDraft().set(validDraft()));

    await assertFails(aliceDraft().update(validDraft({
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-client-time",
      updatedAt: Timestamp.fromMillis(0),
    })));
    await assertFails(aliceDraft().update(validDraft({
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-expiry-time",
      updatedAt: serverTimestamp(),
      expiresAt: serverTimestamp(),
    })));
    await assertFails(aliceDraft().update(validDraft({
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-expiry-over-30-days",
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 31 * 24 * 60 * 60 * 1000),
    })));
  });

  it("requires server timestamps for tombstones and rejects client deletedAt timestamps", async () => {
    const document = aliceDraft();
    await assertSucceeds(document.set(validDraft()));

    await assertFails(document.update(validDraft({
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-client-delete-time",
      updatedAt: serverTimestamp(),
      deletedAt: Timestamp.fromMillis(0),
    })));
    await assertSucceeds(document.update(validDraft({
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-server-delete-time",
      updatedAt: serverTimestamp(),
      deletedAt: serverTimestamp(),
    })));
  });

  it("rejects unknown fields during update", async () => {
    const document = aliceDraft();
    await assertSucceeds(document.set(validDraft()));
    await assertFails(document.update({
      ownerUid: "alice",
      deviceId: "device-1",
      deviceLabel: "Alice laptop",
      schemaVersion: 1,
      payload: "updated",
      revision: 2,
      baseRevision: 1,
      mutationId: "mutation-extra",
      updatedAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + 60 * 60 * 1000),
      deletedAt: null,
      extra: true,
    }));
  });
});
