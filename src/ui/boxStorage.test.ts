import { describe, expect, it } from "vitest";
import {
  BOX_DEFAULT_EXAMPLE_SEEDED_KEY,
  BOX_STORAGE_SCHEMA_VERSION,
  BOX_STORAGE_KEY,
  DEFAULT_BOX_EXAMPLE_ID,
  createBoxBackupFileName,
  createDefaultBoxExampleEntry,
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
import { SHARE_SCHEMA_VERSION } from "./shareState";

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
    const scenarios = createDefaultScenarioForms().map((scenario, scenarioIndex) => ({
      ...scenario,
      attacks: scenario.attacks.map((attack) => scenarioIndex === 0
        ? {
            ...attack,
            moveInput: "おはかまいり",
            movePowerMode: "assisted" as const,
            movePowerValue: 100,
          }
        : attack),
    }));
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
    expect(parsed[0]?.payload.scenarios[0].attacks[0]).toMatchObject({
      moveInput: "おはかまいり",
      movePowerMode: "assisted",
      movePowerValue: 100,
    });
  });

  it("migrates schema v7 box attacks without move-power fields", () => {
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      attacks: scenario.attacks.map(({
        movePowerMode: _movePowerMode,
        movePowerValue: _movePowerValue,
        ...attack
      }) => attack),
    }));
    const [entry] = parseBoxStorageDocument(JSON.stringify({
      schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
      entries: [{
        id: "legacy-power-box",
        name: "旧威力ボックス",
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
        payload: {
          schemaVersion: 7,
          target: createDefaultTargetForm(),
          scenarios,
        },
      }],
    }));

    expect(entry.payload.scenarios[0].attacks[0]).toMatchObject({
      movePowerMode: "auto",
      movePowerValue: 0,
    });
  });

  it.each([3, 4, 5] as const)(
    "keeps schema v%s HP events while dropping their user-selected timing and subject",
    (schemaVersion) => {
      const scenarios = createDefaultScenarioForms().map((scenario) => ({
        ...scenario,
        attacks: scenario.attacks.map((attack) => ({
          ...attack,
          hpEvents: [{
            id: "legacy-life-orb",
            effectId: "life-orb-recoil",
            enabled: true,
            subject: "target",
            timing: "endOfTurn",
          }],
        })),
      }));
      const [entry] = parseBoxStorageDocument(JSON.stringify({
        schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
        entries: [{
          id: "legacy-box",
          name: "旧ボックス",
          createdAt: "2026-07-31T00:00:00.000Z",
          updatedAt: "2026-07-31T00:00:00.000Z",
          payload: {
            schemaVersion,
            target: createDefaultTargetForm(),
            scenarios,
          },
        }],
      }));

      expect(entry.payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
      expect(entry.payload.scenarios[0].attacks[0].hpEvents).toEqual([{
        id: "legacy-life-orb",
        effectId: "life-orb-recoil",
        enabled: true,
      }]);
    },
  );

  it("creates the Mega Delphox adjustment as the default box example", () => {
    const entry = createDefaultBoxExampleEntry("2026-07-27T00:00:00.000Z");

    expect(entry).toMatchObject({
      id: DEFAULT_BOX_EXAMPLE_ID,
      name: "調整例：メガマフォクシー",
      createdAt: "2026-07-27T00:00:00.000Z",
      updatedAt: "2026-07-27T00:00:00.000Z",
      summary: {
        pokemonName: "メガマフォクシー",
        conditionSummary: "耐久 1 / 火力 1 / 素早さ 1",
      },
      payload: {
        target: {
          pokemonInput: "メガマフォクシー",
        },
      },
    });
    expect(entry.payload.scenarios).toHaveLength(3);
    expect(entry.payload).not.toHaveProperty("offenseAdjustment");
  });

  it("ignores invalid localStorage payloads instead of throwing", () => {
    expect(parseBoxStorageDocument("not-json")).toEqual([]);
    expect(parseBoxStorageDocument(JSON.stringify({
      schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
      entries: [{ id: "bad", payload: { schemaVersion: 999 } }],
    }))).toEqual([]);
  });

  it("seeds the default example once while preserving saved browser entries", () => {
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
    const firstLoad = loadBoxEntriesFromBrowser(storage);
    const secondLoad = loadBoxEntriesFromBrowser(storage);

    expect(firstLoad).toHaveLength(2);
    expect(firstLoad[0]).toMatchObject({
      id: DEFAULT_BOX_EXAMPLE_ID,
      name: "調整例：メガマフォクシー",
    });
    expect(firstLoad[1]).toEqual(entry);
    expect(secondLoad).toEqual(firstLoad);
    expect(values.get(BOX_DEFAULT_EXAMPLE_SEEDED_KEY)).toBe("1");
    expect(parseBoxStorageDocument(values.get(BOX_STORAGE_KEY) ?? null)).toEqual(firstLoad);
  });

  it("does not restore the default example after it has been removed", () => {
    const values = new Map<string, string>([
      [BOX_STORAGE_KEY, stringifyBoxStorageDocument([])],
      [BOX_DEFAULT_EXAMPLE_SEEDED_KEY, "1"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    expect(loadBoxEntriesFromBrowser(storage)).toEqual([]);
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

    const backupJson = stringifyBoxBackupDocument(
      [entry],
      "2026-06-12T00:00:00.000Z",
    );
    const result = parseBoxBackupDocument(backupJson);

    expect(backupJson).not.toContain("\"offenseAdjustment\"");
    expect(backupJson).not.toContain("ピチュー");
    expect(result).toMatchObject({
      status: "success",
      entries: [entry],
      skippedCount: 0,
      warnings: [],
    });
  });

  it("imports schema v6 backups and removes the legacy offense adjustment on re-export", () => {
    const legacyEntry = createBoxEntryFromState(createDefaultTargetForm(), createDefaultScenarioForms(), {
      id: "legacy-box-backup",
      now: "2026-06-11T00:00:00.000Z",
    });
    const legacyPayload = {
      ...legacyEntry.payload,
      schemaVersion: 6,
      offenseAdjustment: {
        defenderPokemonInput: "ピチュー",
        moveInput: "ふいうち",
      },
    };
    const result = parseBoxBackupDocument(JSON.stringify({
      schemaVersion: BOX_STORAGE_SCHEMA_VERSION,
      entries: [{ ...legacyEntry, payload: legacyPayload }],
    }));

    expect(result.status).toBe("success");
    if (result.status !== "success") {
      return;
    }

    expect(result.entries[0]?.payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(result.entries[0]?.payload).not.toHaveProperty("offenseAdjustment");
    expect(stringifyBoxBackupDocument(result.entries)).not.toContain("ピチュー");
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
