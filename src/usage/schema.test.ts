import { describe, expect, it } from "vitest";
import {
  parseChampionsUsageData,
  parseChampionsUsageDataJson,
  UsageDataValidationError,
} from "./schema";

const validPayload = {
  schemaVersion: 1,
  dataVersion: "current-2026-08-14",
  sourceGeneratedAt: "2026-08-14T00:00:00.000Z",
  formats: {
    Singles: {
      pikachu: {
        move: ["Thunderbolt", "Protect"],
        ability: ["Lightning Rod"],
        item: ["Focus Sash", "Life Orb"],
      },
    },
    Doubles: {},
  },
};

describe("parseChampionsUsageData", () => {
  it("validates and copies both formats while allowing empty rankings", () => {
    const result = parseChampionsUsageData({
      ...validPayload,
      formats: {
        ...validPayload.formats,
        Singles: {
          ...validPayload.formats.Singles,
          pikachu: {
            ...validPayload.formats.Singles.pikachu,
            move: [],
          },
        },
      },
      futureField: { nature: [] },
    });

    expect(result).toEqual({
      schemaVersion: 1,
      dataVersion: "current-2026-08-14",
      sourceGeneratedAt: "2026-08-14T00:00:00.000Z",
      formats: {
        Singles: {
          pikachu: {
            move: [],
            ability: ["Lightning Rod"],
            item: ["Focus Sash", "Life Orb"],
          },
        },
        Doubles: {},
      },
    });
  });

  it("parses JSON strings and rejects malformed JSON", () => {
    expect(parseChampionsUsageDataJson(JSON.stringify(validPayload)).dataVersion).toBe("current-2026-08-14");
    expect(() => parseChampionsUsageDataJson("{not-json"))
      .toThrow(UsageDataValidationError);
  });

  it.each([
    ["schemaVersion", { schemaVersion: 2 }],
    ["dataVersion", { dataVersion: "" }],
    ["sourceGeneratedAt", { sourceGeneratedAt: "not-a-date" }],
    ["formats", { formats: { Singles: {} } }],
  ])("rejects invalid %s", (_label, override) => {
    expect(() => parseChampionsUsageData({ ...validPayload, ...override })).toThrow(UsageDataValidationError);
  });

  it("requires every ranking category in every Pokemon entry", () => {
    const malformed = structuredClone(validPayload) as typeof validPayload;
    delete (malformed.formats.Singles.pikachu as Partial<typeof malformed.formats.Singles.pikachu>).item;
    expect(() => parseChampionsUsageData(malformed)).toThrow(/item/);
  });

  it("rejects empty canonical names and duplicate ranking values", () => {
    expect(() => parseChampionsUsageData({
      ...validPayload,
      formats: {
        ...validPayload.formats,
        Singles: {
          bad: {
            move: [""],
            ability: [],
            item: [],
          },
        },
      },
    })).toThrow(UsageDataValidationError);

    expect(() => parseChampionsUsageData({
      ...validPayload,
      formats: {
        ...validPayload.formats,
        Singles: {
          bad: {
            move: ["Protect", "Protect"],
            ability: [],
            item: [],
          },
        },
      },
    })).toThrow(/duplicate/);
  });
});

