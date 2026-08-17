import { describe, expect, it, vi } from "vitest";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./defenceSearchUi";
import { SHARE_SCHEMA_VERSION } from "./shareState";
import {
  DRAFT_AUTOSAVE_DELAY_MS,
  DRAFT_STORAGE_KEY,
  DRAFT_STORAGE_SCHEMA_VERSION,
  createDraftFingerprint,
  discardDraftFromBrowser,
  loadDraftFromBrowser,
  parseDraftStorageDocument,
  saveDraftToBrowser,
  scheduleDraftAutosave,
} from "./draftStorage";

const createMemoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  };
};

describe("draftStorage", () => {
  it("round-trips only the current target and scenarios in a versioned draft", () => {
    const target = { ...createDefaultTargetForm(), pokemonInput: "オオニューラ" };
    const scenarios = createDefaultScenarioForms();
    const memory = createMemoryStorage();

    const saved = saveDraftToBrowser(target, scenarios, {
      storage: memory.storage,
      now: new Date("2026-08-17T03:04:05.000Z"),
    });
    const loaded = loadDraftFromBrowser(memory.storage);

    expect(saved).toMatchObject({
      status: "success",
      draft: {
        schemaVersion: DRAFT_STORAGE_SCHEMA_VERSION,
        savedAt: "2026-08-17T03:04:05.000Z",
      },
    });
    expect(loaded).toMatchObject({
      status: "success",
      draft: {
        payload: {
          schemaVersion: SHARE_SCHEMA_VERSION,
          target: { pokemonInput: "オオニューラ" },
          scenarios,
        },
      },
    });
    const stored = memory.values.get(DRAFT_STORAGE_KEY) ?? "";
    expect(stored).not.toContain("candidates");
    expect(stored).not.toContain("searchState");
    expect(stored).not.toContain("worker");
  });

  it("returns empty when no draft has been saved", () => {
    expect(loadDraftFromBrowser(createMemoryStorage().storage)).toEqual({ status: "empty" });
  });

  it("migrates an older ShareState payload through the existing parser", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms();
    const parsed = parseDraftStorageDocument(JSON.stringify({
      schemaVersion: DRAFT_STORAGE_SCHEMA_VERSION,
      savedAt: "2026-08-17T03:04:05.000Z",
      payload: {
        schemaVersion: 9,
        target,
        scenarios,
      },
    }));

    expect(parsed.payload.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed.payload.target).toMatchObject({
      pokemonInput: target.pokemonInput,
      level: target.level,
      levelMode: target.levelMode,
    });
  });

  it.each([
    ["broken JSON", "{"],
    ["future draft schema", JSON.stringify({ schemaVersion: 999, savedAt: "2026-08-17T03:04:05.000Z", payload: {} })],
    ["missing payload", JSON.stringify({ schemaVersion: DRAFT_STORAGE_SCHEMA_VERSION, savedAt: "2026-08-17T03:04:05.000Z" })],
    ["future payload schema", JSON.stringify({
      schemaVersion: DRAFT_STORAGE_SCHEMA_VERSION,
      savedAt: "2026-08-17T03:04:05.000Z",
      payload: { schemaVersion: 999, target: {}, scenarios: [] },
    })],
  ])("reports %s without silently replacing it with an empty draft", (_label, stored) => {
    const memory = createMemoryStorage({ [DRAFT_STORAGE_KEY]: stored });

    expect(loadDraftFromBrowser(memory.storage)).toMatchObject({
      status: "error",
      reason: "corrupt",
    });
    expect(memory.values.get(DRAFT_STORAGE_KEY)).toBe(stored);
  });

  it("distinguishes storage quota failures", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error("quota"), { name: "QuotaExceededError" });
      },
      removeItem: () => undefined,
    };

    expect(saveDraftToBrowser(
      createDefaultTargetForm(),
      createDefaultScenarioForms(),
      { storage },
    )).toEqual({
      status: "error",
      reason: "quota",
      message: "下書きを保存できませんでした。ブラウザの保存容量が不足しています",
    });
  });

  it("distinguishes unavailable browser storage from corrupt draft data", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    expect(loadDraftFromBrowser(storage)).toEqual({
      status: "error",
      reason: "unavailable",
      message: "ブラウザの保存機能を利用できないため、下書きを確認できませんでした",
    });
  });

  it("discards the draft only when explicitly requested", () => {
    const memory = createMemoryStorage();
    saveDraftToBrowser(createDefaultTargetForm(), createDefaultScenarioForms(), {
      storage: memory.storage,
    });

    expect(discardDraftFromBrowser(memory.storage)).toEqual({ status: "success" });
    expect(loadDraftFromBrowser(memory.storage)).toEqual({ status: "empty" });
  });

  it("waits 750ms before autosaving and cancels stale scheduled saves", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const staleSave = vi.fn();

    try {
      scheduleDraftAutosave(save);
      const cancelStaleSave = scheduleDraftAutosave(staleSave);
      cancelStaleSave();
      vi.advanceTimersByTime(749);
      expect(save).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(save).toHaveBeenCalledOnce();
      expect(staleSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores save timestamps in state fingerprints", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms();
    const fingerprint = createDraftFingerprint(target, scenarios);

    expect(DRAFT_AUTOSAVE_DELAY_MS).toBe(750);
    expect(fingerprint).not.toContain("savedAt");
    expect(createDraftFingerprint({ ...target, pokemonInput: "オオニューラ" }, scenarios))
      .not.toBe(fingerprint);
  });
});
