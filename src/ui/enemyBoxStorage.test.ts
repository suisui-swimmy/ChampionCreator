import { describe, expect, it } from "vitest";
import {
  ENEMY_BOX_STORAGE_KEY,
  ENEMY_BOX_STORAGE_SCHEMA_VERSION,
  createEnemyBoxBackupFileName,
  createEnemyBoxEntryFromScenarios,
  createEnemyBoxEntrySummary,
  duplicateEnemyBoxEntry,
  loadEnemyBoxEntriesFromBrowser,
  parseEnemyBoxBackupDocument,
  parseEnemyBoxStorageDocument,
  saveEnemyBoxEntriesToBrowser,
  stringifyEnemyBoxBackupDocument,
  stringifyEnemyBoxStorageDocument,
} from "./enemyBoxStorage";
import { createDefaultScenarioForms } from "./defenceSearchUi";

describe("enemyBoxStorage", () => {
  it("creates a compact summary from enabled virtual-enemy scenarios", () => {
    const summary = createEnemyBoxEntrySummary(createDefaultScenarioForms());

    expect(summary).toEqual({
      pokemonName: "ドドゲザン",
      conditionSummary: "耐久 1 / 火力 1 / 素早さ 1",
      statPointSummary: "3シナリオ / 3攻撃",
    });
  });

  it("round-trips scenario-only entries without a target payload", () => {
    const entry = createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
      id: "enemy-box-1",
      now: "2026-07-29T00:00:00.000Z",
    });

    const parsed = parseEnemyBoxStorageDocument(
      stringifyEnemyBoxStorageDocument([entry]),
    );

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "enemy-box-1",
      name: "ドドゲザン",
      summary: {
        conditionSummary: "耐久 1 / 火力 1 / 素早さ 1",
      },
      payload: {
        scenarios: entry.payload.scenarios,
      },
    });
    expect(parsed[0]?.payload).not.toHaveProperty("target");
  });

  it("ignores invalid localStorage documents instead of throwing", () => {
    expect(parseEnemyBoxStorageDocument("not-json")).toEqual([]);
    expect(parseEnemyBoxStorageDocument(JSON.stringify({
      schemaVersion: ENEMY_BOX_STORAGE_SCHEMA_VERSION,
      entries: [{ id: "bad", payload: { schemaVersion: 999 } }],
    }))).toEqual([]);
  });

  it("loads and saves entries through its own browser key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const entry = createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
      id: "enemy-box-storage",
      now: "2026-07-29T00:00:00.000Z",
    });

    expect(saveEnemyBoxEntriesToBrowser([entry], storage)).toBeNull();
    expect(loadEnemyBoxEntriesFromBrowser(storage)).toEqual([entry]);
    expect(parseEnemyBoxStorageDocument(values.get(ENEMY_BOX_STORAGE_KEY) ?? null))
      .toEqual([entry]);
  });

  it("reports browser storage write failures", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    expect(saveEnemyBoxEntriesToBrowser([], storage))
      .toBe("仮想敵ボックスのブラウザ保存に失敗しました");
  });

  it("duplicates entries with a fresh id and copied name", () => {
    const entry = createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
      id: "enemy-original",
      now: "2026-07-29T00:00:00.000Z",
    });

    expect(duplicateEnemyBoxEntry(entry, {
      id: "enemy-copy",
      now: "2026-07-29T01:00:00.000Z",
    })).toMatchObject({
      id: "enemy-copy",
      name: "ドドゲザン コピー",
      createdAt: "2026-07-29T01:00:00.000Z",
      updatedAt: "2026-07-29T01:00:00.000Z",
      payload: entry.payload,
    });
  });

  it("round-trips backups and warns about unreadable slots", () => {
    const entry = createEnemyBoxEntryFromScenarios(createDefaultScenarioForms(), {
      id: "enemy-readable",
      now: "2026-07-29T00:00:00.000Z",
    });
    const result = parseEnemyBoxBackupDocument(JSON.stringify({
      schemaVersion: ENEMY_BOX_STORAGE_SCHEMA_VERSION,
      entries: [
        entry,
        { id: "bad", payload: { schemaVersion: 999 } },
      ],
    }));

    expect(result).toMatchObject({
      status: "success",
      entries: [entry],
      skippedCount: 1,
      warnings: ["1件の仮想敵スロットを読み込めませんでした"],
    });
    expect(parseEnemyBoxBackupDocument(
      stringifyEnemyBoxBackupDocument([entry], "2026-07-29T02:00:00.000Z"),
    )).toMatchObject({
      status: "success",
      entries: [entry],
      skippedCount: 0,
      warnings: [],
    });
  });

  it("reports malformed backups and creates stable filenames", () => {
    expect(parseEnemyBoxBackupDocument("not-json")).toMatchObject({
      status: "error",
      message: "仮想敵バックアップJSONを読み込めません",
    });
    expect(parseEnemyBoxBackupDocument(JSON.stringify({
      schemaVersion: 999,
      entries: [],
    }))).toMatchObject({
      status: "error",
      message: "対応していない仮想敵バックアップです (schemaVersion 1 のみ対応)",
    });
    expect(createEnemyBoxBackupFileName(new Date("2026-07-29T09:30:00.000Z")))
      .toBe("championcreator-enemy-box-backup-2026-07-29.json");
  });
});
