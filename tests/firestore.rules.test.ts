import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const PROJECT_ID = "demo-championcreator";
const DOCUMENT_PATH = "users/alice/syncRecords/record-1";
const RULES_PATH = resolve(process.cwd(), "firestore.rules");

type SyncRecord = {
  ownerUid?: unknown;
  kind?: unknown;
  schemaVersion?: unknown;
  payload?: unknown;
  [field: string]: unknown;
};

const validRecord = (overrides: Partial<SyncRecord> = {}): SyncRecord => ({
  ownerUid: "alice",
  kind: "target-box",
  schemaVersion: 1,
  payload: "{}",
  ...overrides,
});

let testEnv: RulesTestEnvironment;

const aliceDocument = () =>
  testEnv.authenticatedContext("alice").firestore().doc(DOCUMENT_PATH);

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

  it("allows the owner to create, read, and update, but denies delete", async () => {
    const document = aliceDocument();

    await assertSucceeds(document.set(validRecord()));
    const snapshot = await assertSucceeds(document.get());
    expect(snapshot.data()).toEqual(validRecord());
    const list = await assertSucceeds(
      testEnv.authenticatedContext("alice").firestore().collection("users/alice/syncRecords").get(),
    );
    expect(list.docs).toHaveLength(1);

    await assertSucceeds(document.update({
      ownerUid: "alice",
      kind: "enemy-box",
      schemaVersion: 1,
      payload: '{"revision":2}',
    }));
    const updated = await assertSucceeds(document.get());
    expect(updated.data()).toEqual({
      ownerUid: "alice",
      kind: "enemy-box",
      schemaVersion: 1,
      payload: '{"revision":2}',
    });

    await assertFails(document.delete());
    await assertSucceeds(document.get());
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
      "users/bob/syncRecords/record-1",
    ).set(validRecord()));
    await assertFails(alice.doc(DOCUMENT_PATH).set(validRecord({ ownerUid: "bob" })));

    const bob = testEnv.authenticatedContext("bob").firestore();
    await assertFails(bob.doc(DOCUMENT_PATH).set(validRecord({ ownerUid: "bob" })));
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
    ["missing payload", (() => {
      const record = validRecord();
      delete record.payload;
      return record;
    })()],
    ["extra field", validRecord({ extra: true })],
    ["ownerUid is not a string", validRecord({ ownerUid: 1 })],
    ["kind is not a string", validRecord({ kind: 1 })],
    ["kind is not supported", validRecord({ kind: "draft" })],
    ["schemaVersion is not an integer", validRecord({ schemaVersion: 1.5 })],
    ["schemaVersion is unsupported", validRecord({ schemaVersion: 2 })],
    ["payload is not a string", validRecord({ payload: { value: "{}" } })],
  ] as const)("rejects %s", async (_label, record) => {
    await assertFails(aliceDocument().set(record));
  });

  it("accepts a payload at the 200000-character boundary", async () => {
    await assertSucceeds(aliceDocument().set(validRecord({
      payload: "A".repeat(200000),
    })));
  });

  it("rejects a payload over the 200000-character limit", async () => {
    await assertFails(aliceDocument().set(validRecord({
      payload: "A".repeat(200001),
    })));
  });

  it("rejects owner changes and extra fields during update", async () => {
    const document = aliceDocument();
    await assertSucceeds(document.set(validRecord()));

    await assertFails(document.update(validRecord({ ownerUid: "bob" })));
    await assertFails(document.update({
      ownerUid: "alice",
      kind: "target-box",
      schemaVersion: 1,
      payload: "{}",
      extra: true,
    }));
  });
});
