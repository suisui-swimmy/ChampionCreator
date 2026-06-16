import { describe, expect, it } from "vitest";
import {
  BOX_STORAGE_SCHEMA_VERSION,
  createBoxBackupFileName,
  createBoxEntryFromState,
  createBoxEntrySummary,
  duplicateBoxEntry,
  loadBoxEntriesFromBrowser,
  parseBoxBackupDocument,
  parseBoxStorageDocument,
  saveBoxEntriesToBrowser,
  stringifyBoxBackupDocument,
  stringifyBoxStorageDocument,
} from "./boxStorage";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./defenceSearchUi";

describe("boxStorage", () => {
  it("creates minimal summaries for saved conditions", () => {
    const summary = createBoxEntrySummary(createDefaultTargetForm(), createDefaultScenarioForms());

    expect(summary).toEqual({
      pokemonName: "メガマフォクシー",
      conditionSummary: "耐久 1 / 火力 1 / 素早さ 1",
      statPointSummary: "H0 / A0 / B0 / C0 / D0 / S0",
    });
  });

  it("round-trips box entries as versioned browser storage", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms();
    const entry = createBoxEntryFromState(target, scenarios, {
      id: "box-1",
      now: "2026-06-11T00:00:00.000Z",
    });

    const parsed = parseBoxStorageDocument(stringifyBoxStorageDocument([entry]));

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: "box-1",
      name: "メガマフォクシー",
      summary: {
        pokemonName: "メガマフォクシー",
        statPointSummary: "H0 / A0 / B0 / C0 / D0 / S0",
      },
    });
    expect(parsed[0]?.payload.target.pokemonInput).toBe("メガマフォクシー");
  });

  it("ignores invalid localStorage payloads instead of throwing", () => {
    expect(parseBoxStorageDocument("not-json")).toEqual([]);
    expect(parseBoxStorageDocument(JSON.stringify({
      schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
      entries: [{ id: "bad", payload: { schemaVersion: 999 } }],
    }))).toEqual([]);
  });

  it("loads and saves entries through browser storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const entry = createBoxEntryFromState(createDefaultTargetForm(), createDefaultScenarioForms(), {
      id: "box-storage",
      now: "2026-06-11T00:00:00.000Z",
    });

    expect(saveBoxEntriesToBrowser([entry], storage)).toBeNull();
    expect(loadBoxEntriesFromBrowser(storage)).toEqual([entry]);
  });

  it("reports browser storage write failures", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };

    expect(saveBoxEntriesToBrowser([], storage)).toBe("ブラウザ保存に失敗しました");
  });

  it("duplicates saved entries with a fresh id and copied name", () => {
    const entry = createBoxEntryFromState(createDefaultTargetForm(), createDefaultScenarioForms(), {
      id: "box-original",
      now: "2026-06-11T00:00:00.000Z",
    });

    expect(duplicateBoxEntry(entry, {
      id: "box-copy",
      now: "2026-06-11T01:00:00.000Z",
    })).toMatchObject({
      id: "box-copy",
      name: "メガマフォクシー コピー",
      createdAt: "2026-06-11T01:00:00.000Z",
      updatedAt: "2026-06-11T01:00:00.000Z",
      payload: entry.payload,
    });
  });

  it("round-trips all entries as a readable backup document", () => {
    const entry = createBoxEntryFromState(createDefaultTargetForm(), createDefaultScenarioForms(), {
      id: "box-backup",
      now: "2026-06-11T00:00:00.000Z",
    });

    const result = parseBoxBackupDocument(stringifyBoxBackupDocument(
      [entry],
      "2026-06-12T00:00:00.000Z",
    ));

    expect(result).toMatchObject({
      status: "success",
      entries: [entry],
      skippedCount: 0,
      warnings: [],
    });
  });

  it("reports unsupported or malformed backup documents", () => {
    expect(parseBoxBackupDocument("not-json")).toMatchObject({
      status: "error",
      message: "バックアップJSONを読み込めません",
    });
    expect(parseBoxBackupDocument(JSON.stringify({
      schemaVersion: 999,
      entries: [],
    }))).toMatchObject({
      status: "error",
      message: "対応していないバックアップです (schemaVersion 1 のみ対応)",
    });
    expect(parseBoxBackupDocument(JSON.stringify({
      schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
    }))).toMatchObject({
      status: "error",
      message: "バックアップJSONに entries がありません",
    });
  });

  it("imports readable backup entries and warns about skipped slots", () => {
    const entry = createBoxEntryFromState(createDefaultTargetForm(), createDefaultScenarioForms(), {
      id: "box-readable",
      now: "2026-06-11T00:00:00.000Z",
    });
    const result = parseBoxBackupDocument(JSON.stringify({
      schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
      entries: [
        entry,
        { id: "bad", payload: { schemaVersion: 999 } },
      ],
    }));

    expect(result).toMatchObject({
      status: "success",
      entries: [entry],
      skippedCount: 1,
      warnings: ["1件の保存スロットを読み込めませんでした"],
    });
  });

  it("creates stable backup filenames from dates", () => {
    expect(createBoxBackupFileName(new Date("2026-06-12T09:30:00.000Z"))).toBe(
      "championcreator-box-backup-2026-06-12.json",
    );
  });
});
