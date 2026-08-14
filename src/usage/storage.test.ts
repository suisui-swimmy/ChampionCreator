import { describe, expect, it } from "vitest";
import {
  loadSuggestionFormat,
  saveSuggestionFormat,
  SUGGESTION_FORMAT_STORAGE_KEY,
} from "./storage";

const createStorage = (initial?: string) => {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
    read: () => value,
  };
};

describe("suggestion format storage", () => {
  it("defaults to Singles and persists a versioned preference", () => {
    const storage = createStorage();
    expect(loadSuggestionFormat(storage)).toBe("Singles");
    expect(saveSuggestionFormat("Doubles", storage)).toBe(true);
    expect(storage.read()).toBe(JSON.stringify({ schemaVersion: 1, format: "Doubles" }));
    expect(loadSuggestionFormat(storage)).toBe("Doubles");
  });

  it.each([
    null,
    "not-json",
    JSON.stringify({ format: "Doubles" }),
    JSON.stringify({ schemaVersion: 1, format: "Triples" }),
    JSON.stringify({ schemaVersion: 2, format: "Doubles" }),
  ])("falls back for invalid persisted value %s", (raw) => {
    expect(loadSuggestionFormat(createStorage(raw ?? undefined))).toBe("Singles");
  });

  it("uses the dedicated key and swallows storage exceptions", () => {
    let key = "";
    const storage = {
      getItem: (requestedKey: string) => {
        key = requestedKey;
        return JSON.stringify({ schemaVersion: 1, format: "Singles" });
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadSuggestionFormat(storage)).toBe("Singles");
    expect(key).toBe(SUGGESTION_FORMAT_STORAGE_KEY);
    expect(saveSuggestionFormat("Doubles", storage)).toBe(false);
    expect(saveSuggestionFormat("Triples" as never, storage)).toBe(false);
  });
});

