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

  it("accepts optional nature usage while preserving null and real zero percentages", () => {
    const result = parseChampionsUsageData({
      ...validPayload,
      formats: {
        ...validPayload.formats,
        Singles: {
          pikachu: {
            ...validPayload.formats.Singles.pikachu,
            nature: [
              { canonicalName: "Jolly", rank: 1, percentage: 0 },
              { canonicalName: "Timid", rank: 2, percentage: null },
            ],
          },
        },
      },
    });

    expect(result.formats.Singles.pikachu.nature).toEqual([
      { canonicalName: "Jolly", rank: 1, percentage: 0 },
      { canonicalName: "Timid", rank: 2, percentage: null },
    ]);
  });

  it("keeps an old v1 payload without nature valid and omits the optional field", () => {
    const result = parseChampionsUsageData(validPayload);
    expect(result.formats.Singles.pikachu).not.toHaveProperty("nature");
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

  it.each([
    ["duplicate canonical names", [
      { canonicalName: "Jolly", rank: 1, percentage: 10 },
      { canonicalName: "Jolly", rank: 2, percentage: 5 },
    ], /canonicalName.*duplicate/],
    ["duplicate ranks", [
      { canonicalName: "Jolly", rank: 1, percentage: 10 },
      { canonicalName: "Timid", rank: 1, percentage: 5 },
    ], /rank.*duplicate/],
    ["zero rank", [{ canonicalName: "Jolly", rank: 0, percentage: 10 }], /rank/],
    ["fractional rank", [{ canonicalName: "Jolly", rank: 1.5, percentage: 10 }], /rank/],
    ["rank above top ten", [{ canonicalName: "Jolly", rank: 11, percentage: 10 }], /rank/],
    ["negative percentage", [{ canonicalName: "Jolly", rank: 1, percentage: -0.1 }], /percentage/],
    ["percentage above 100", [{ canonicalName: "Jolly", rank: 1, percentage: 100.1 }], /percentage/],
    ["string percentage", [{ canonicalName: "Jolly", rank: 1, percentage: "10" }], /percentage/],
    ["missing percentage", [{ canonicalName: "Jolly", rank: 1 }], /percentage/],
  ])("rejects malformed nature ranking: %s", (_label, nature, message) => {
    expect(() => parseChampionsUsageData({
      ...validPayload,
      formats: {
        ...validPayload.formats,
        Singles: {
          pikachu: {
            ...validPayload.formats.Singles.pikachu,
            nature,
          },
        },
      },
    })).toThrow(message);
  });

  it("rejects non-finite nature percentages", () => {
    expect(() => parseChampionsUsageData({
      ...validPayload,
      formats: {
        ...validPayload.formats,
        Singles: {
          pikachu: {
            ...validPayload.formats.Singles.pikachu,
            nature: [{ canonicalName: "Jolly", rank: 1, percentage: Number.NaN }],
          },
        },
      },
    })).toThrow(/percentage/);

    expect(() => parseChampionsUsageData({
      ...validPayload,
      formats: {
        ...validPayload.formats,
        Singles: {
          pikachu: {
            ...validPayload.formats.Singles.pikachu,
            nature: [{ canonicalName: "Jolly", rank: 1, percentage: Number.POSITIVE_INFINITY }],
          },
        },
      },
    })).toThrow(/percentage/);
  });
});
