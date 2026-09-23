import { describe, expect, it } from "vitest";
import { decodeSyncPayload } from "../sync/syncPayload";
import { createDefaultScenarioForms, createDefaultTargetForm } from "./defenceSearchUi";
import { createBoxEntryFromState, parseBoxBackupDocument, parseBoxStorageDocument, stringifyBoxStorageDocument } from "./boxStorage";
import { createEnemyBoxEntryFromScenarios, parseEnemyBoxBackupDocument, parseEnemyBoxStorageDocument, stringifyEnemyBoxStorageDocument } from "./enemyBoxStorage";
import { createDraftStorageDocument, parseDraftStorageDocument } from "./draftStorage";
import { SHARE_SCHEMA_VERSION } from "./shareState";

const fixture = () => {
  const target = createDefaultTargetForm();
  const scenarios = createDefaultScenarioForms().slice(0, 1);
  scenarios[0].attacks[0].gameType = "doubles";
  scenarios[0].attacks[0].friendGuard = true;
  scenarios[0].attacks.push({ ...scenarios[0].attacks[0], id: "old-support", moveInput: "", attackerAbilityInput: "バッテリー" });
  return { target, scenarios };
};
const legacyPayload = () => ({ ...fixture(), schemaVersion: 15 });
const expected = { targetAlly: ["Friend Guard"], opponentAlly: ["Battery"] };

describe("field abilities across persistence boundaries", () => {
  it.each(["target-box", "enemy-box"] as const)("migrates %s storage, JSON backup and sync through the same parser", (kind) => {
    const { target, scenarios } = fixture();
    const entry = kind === "target-box" ? createBoxEntryFromState(target, scenarios) : createEnemyBoxEntryFromScenarios(scenarios);
    const payload = legacyPayload();
    const oldEntry = { ...entry, payload: kind === "target-box" ? payload : { schemaVersion: 15, scenarios: payload.scenarios } };
    const raw = JSON.stringify({ schemaVersion: 1, entries: [oldEntry] });
    const stored = kind === "target-box" ? parseBoxStorageDocument(raw) : parseEnemyBoxStorageDocument(raw);
    const backup = kind === "target-box" ? parseBoxBackupDocument(raw) : parseEnemyBoxBackupDocument(raw);
    const cloud = decodeSyncPayload(kind, raw, entry.id);
    expect(stored[0].payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(stored[0].payload.scenarios[0].attacks).toHaveLength(1);
    expect(stored[0].payload.scenarios[0].attacks[0].battleAbilities).toEqual(expected);
    expect(backup.status === "success" && backup.entries[0].payload).toEqual(stored[0].payload);
    expect(cloud.status === "success" && cloud.entry.payload).toEqual(stored[0].payload);
  });

  it("migrates the browser/cloud draft envelope and retains its timestamp", () => {
    const { target, scenarios } = fixture();
    const draft = createDraftStorageDocument(target, scenarios);
    const parsed = parseDraftStorageDocument(JSON.stringify({ ...draft, payload: legacyPayload() }));
    expect(parsed.savedAt).toBe(draft.savedAt);
    expect(parsed.payload.scenarios[0].attacks).toHaveLength(1);
    expect(parsed.payload.scenarios[0].attacks[0].battleAbilities).toEqual(expected);
    expect(parseDraftStorageDocument(JSON.stringify(parsed))).toEqual(parsed);
  });

  it("saves explicit selections in both boxes without re-inferring neighboring abilities", () => {
    const { target, scenarios } = fixture();
    scenarios[0].attacks[0].battleAbilities = { targetAlly: [], opponentAlly: ["Power Spot"] };
    scenarios[0].attacks[1].moveInput = "10まんボルト";
    const targetEntry = createBoxEntryFromState(target, scenarios);
    const enemyEntry = createEnemyBoxEntryFromScenarios(scenarios);
    const entries = [parseBoxStorageDocument(stringifyBoxStorageDocument([targetEntry]))[0],
      parseEnemyBoxStorageDocument(stringifyEnemyBoxStorageDocument([enemyEntry]))[0]];
    for (const entry of entries) {
      expect(entry.payload.scenarios[0].attacks).toHaveLength(2);
      expect(entry.payload.scenarios[0].attacks[0]).toMatchObject({ friendGuard: false, battleAbilities: { targetAlly: [], opponentAlly: ["Power Spot"] } });
    }
  });
});
