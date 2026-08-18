import { describe, expect, it, vi } from "vitest";
import {
  BOX_STORAGE_KEY,
  createBoxEntryFromState,
  parseBoxStorageDocument,
  saveBoxEntriesToBrowser,
} from "./boxStorage";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./defenceSearchUi";
import {
  DRAFT_STORAGE_KEY,
  discardDraftFromBrowser,
  loadDraftFromBrowser,
  saveDraftToBrowser,
  type DraftMutationResult,
} from "./draftStorage";
import { persistCurrentWorkToBoxAndDiscardDraft } from "./currentWorkPersistence";

const createMemoryStorage = () => {
  const values = new Map<string, string>();
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

describe("currentWorkPersistence", () => {
  it("persists the current target box and removes its superseded draft", () => {
    const target = { ...createDefaultTargetForm(), pokemonInput: "オオニューラ" };
    const scenarios = createDefaultScenarioForms();
    const entry = createBoxEntryFromState(target, scenarios, {
      id: "current-work",
      now: "2026-08-18T00:00:00.000Z",
    });
    const memory = createMemoryStorage();
    saveDraftToBrowser(target, scenarios, {
      storage: memory.storage,
      now: new Date("2026-08-18T00:00:01.000Z"),
    });

    const result = persistCurrentWorkToBoxAndDiscardDraft([entry], {
      saveBoxEntries: (entries) => saveBoxEntriesToBrowser(entries, memory.storage),
      discardDraft: () => discardDraftFromBrowser(memory.storage),
    });

    expect(result).toMatchObject({
      status: "box-saved",
      discardResult: { status: "success" },
    });
    const boxEntries = parseBoxStorageDocument(memory.values.get(BOX_STORAGE_KEY) ?? "");
    const draft = loadDraftFromBrowser(memory.storage);
    expect(boxEntries[0]?.payload.target).toEqual(target);
    expect(boxEntries[0]?.payload.scenarios).toEqual(scenarios);
    expect(draft).toEqual({ status: "empty" });
    expect(memory.values.has(DRAFT_STORAGE_KEY)).toBe(false);
  });

  it("does not discard the draft when the target-box save fails", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms();
    const entry = createBoxEntryFromState(target, scenarios);
    const memory = createMemoryStorage();
    saveDraftToBrowser(target, scenarios, { storage: memory.storage });
    const discardDraft = vi.fn<() => DraftMutationResult>(() => ({ status: "success" }));

    const result = persistCurrentWorkToBoxAndDiscardDraft([entry], {
      saveBoxEntries: () => "ブラウザ保存に失敗しました",
      discardDraft,
    });

    expect(result).toEqual({
      status: "box-error",
      message: "ブラウザ保存に失敗しました",
    });
    expect(discardDraft).not.toHaveBeenCalled();
    expect(loadDraftFromBrowser(memory.storage).status).toBe("success");
  });

  it("keeps the successful box write while returning a draft-discard error", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms();
    const entry = createBoxEntryFromState(target, scenarios);
    const discardError: DraftMutationResult = {
      status: "error",
      reason: "unavailable",
      message: "下書きを削除できませんでした。ブラウザの保存機能を利用できません",
    };

    const result = persistCurrentWorkToBoxAndDiscardDraft([entry], {
      saveBoxEntries: () => null,
      discardDraft: () => discardError,
    });

    expect(result).toEqual({
      status: "box-saved",
      discardResult: discardError,
    });
  });
});
