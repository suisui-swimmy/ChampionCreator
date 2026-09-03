import { describe, expect, it } from "vitest";
import {
  createBoxEntryFromState,
  stringifyBoxStorageDocument,
  type BoxEntry,
} from "../ui/boxStorage";
import {
  createEnemyBoxEntryFromScenarios,
  stringifyEnemyBoxStorageDocument,
} from "../ui/enemyBoxStorage";
import { createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { SHARE_SCHEMA_VERSION } from "../ui/shareState";
import {
  decodeSyncPayload,
  encodeSyncPayload,
  encodeTargetBoxSyncPayload,
} from "./syncPayload";

const targetEntry = (id = "target-1"): BoxEntry => createBoxEntryFromState(
  createDefaultTargetForm(),
  createDefaultScenarioForms(),
  { id, now: "2026-08-21T00:00:00.000Z" },
);

describe("syncPayload", () => {
  it("encodes and normalizes a target-box payload through the existing parser", () => {
    const entry = targetEntry("target/ Unicode　id");
    const raw = encodeTargetBoxSyncPayload(entry);
    const result = decodeSyncPayload("target-box", raw, entry.id);

    expect(result).toMatchObject({ status: "success", kind: "target-box", entryId: entry.id });
    if (result.status === "success") {
      expect(result.entry.id).toBe(entry.id);
      expect(result.entry.payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    }
  });

  it("round-trips the enemy-box storage document as a separate kind", () => {
    const entry = createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
      id: "shared-id",
      now: "2026-08-21T00:00:00.000Z",
    });
    const raw = encodeSyncPayload("enemy-box", entry);
    const result = decodeSyncPayload("enemy-box", raw, "shared-id");

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.entry.id).toBe("shared-id");
      expect(result.entry.payload).not.toHaveProperty("target");
    }
  });

  it.each([
    ["not-json", "invalid-payload"],
    [JSON.stringify({ schemaVersion: 1, entries: [] }), "invalid-payload"],
    [JSON.stringify({ schemaVersion: 1, entries: [targetEntry(), targetEntry("two")] }), "invalid-payload"],
    [JSON.stringify({ schemaVersion: 999, entries: [] }), "unknown-future-schema"],
  ] as const)("classifies %s without letting the existing parser hide it", (raw, reason) => {
    const result = decodeSyncPayload("target-box", raw);
    expect(result).toMatchObject({ status: "error", reason });
  });

  it("classifies a future inner share schema separately", () => {
    const entry = targetEntry();
    const parsed = JSON.parse(encodeSyncPayload("target-box", entry)) as {
      entries: Array<{ payload: { schemaVersion: number } }>;
    };
    parsed.entries[0].payload.schemaVersion = 999;

    expect(decodeSyncPayload("target-box", JSON.stringify(parsed))).toMatchObject({
      status: "error",
      reason: "unknown-future-schema",
    });
  });

  it("requires one non-empty entry id and an exact expected id", () => {
    const entry = targetEntry(" ");
    const raw = encodeSyncPayload("target-box", entry);
    expect(decodeSyncPayload("target-box", raw, " ")).toMatchObject({ status: "success" });
    expect(decodeSyncPayload("target-box", raw, "other")).toMatchObject({
      status: "error",
      reason: "invalid-payload",
    });

    const emptyId = JSON.parse(raw) as { entries: Array<{ id: string }> };
    emptyId.entries[0].id = "";
    expect(decodeSyncPayload("target-box", JSON.stringify(emptyId))).toMatchObject({
      status: "error",
      reason: "invalid-payload",
    });
  });

  it("does not accept a target payload as an enemy payload", () => {
    const raw = stringifyBoxStorageDocument([targetEntry()]);
    expect(decodeSyncPayload("enemy-box", raw)).toMatchObject({
      status: "error",
      reason: "invalid-payload",
    });

    const enemy = createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), { id: "enemy" });
    expect(decodeSyncPayload("target-box", stringifyEnemyBoxStorageDocument([enemy]))).toMatchObject({
      status: "error",
      reason: "invalid-payload",
    });
  });
});
