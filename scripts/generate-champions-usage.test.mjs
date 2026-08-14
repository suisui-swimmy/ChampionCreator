import { describe, expect, it, vi } from "vitest";
import {
  ChampionsUsageDataError,
  createEmptyPayload,
  makeCatalogs,
  transformApiData,
  validatePayload,
} from "./generate-champions-usage.mjs";

const makeCatalogEntry = (id, showdownName = id) => ({ id, showdownName });

const catalogs = makeCatalogs({
  moves: {
    entries: [
      makeCatalogEntry("thunderbolt", "Thunderbolt"),
      makeCatalogEntry("protect", "Protect"),
      makeCatalogEntry("shadowball", "Shadow Ball"),
    ],
  },
  abilities: {
    entries: [
      makeCatalogEntry("static", "Static"),
      makeCatalogEntry("levitate", "Levitate"),
    ],
  },
  items: {
    entries: [
      makeCatalogEntry("choicescarf", "Choice Scarf"),
      makeCatalogEntry("leftovers", "Leftovers"),
    ],
  },
  pokemon: {
    entries: [
      makeCatalogEntry("pikachu", "Pikachu"),
      makeCatalogEntry("rotomwash", "Rotom-Wash"),
      makeCatalogEntry("rotomfan", "Rotom-Fan"),
      makeCatalogEntry("aegislashshield", "Aegislash-Shield"),
      makeCatalogEntry("aegislashblade", "Aegislash-Blade"),
      makeCatalogEntry("aegislashboth", "Aegislash-Both"),
    ],
  },
});

const values = ({ move = [], held_item = [], ability = [] } = {}) => ({
  move,
  held_item,
  ability,
});

const entry = (showdownId, singles = {}, doubles = {}) => ({
  showdownId,
  summary: {
    battleSummary: {
      Current: {
        Singles: { values: values(singles) },
        Doubles: { values: values(doubles) },
      },
    },
  },
});

const apiData = (pokemon) => ({
  generatedAt: "2026-08-14T00:17:00.000Z",
  dataVersion: "20260814001700000",
  pokemon,
});

describe("generate-champions-usage", () => {
  it("converts Current Singles/Doubles rankings to canonical names", () => {
    const payload = transformApiData(apiData([
      entry(
        "pikachu",
        {
          move: ["Thunderbolt", "Unknown Move", "Protect"],
          held_item: ["Choice Scarf"],
          ability: ["Static"],
        },
        {
          move: ["Shadow Ball"],
          held_item: ["Leftovers"],
          ability: ["Levitate"],
        },
      ),
    ]), { catalogs, warn: vi.fn() });

    expect(payload).toMatchObject({
      schemaVersion: 1,
      dataVersion: "20260814001700000",
      sourceGeneratedAt: "2026-08-14T00:17:00.000Z",
    });
    expect(payload.formats.Singles.pikachu).toEqual({
      move: ["Thunderbolt", "Protect"],
      ability: ["Static"],
      item: ["Choice Scarf"],
    });
    expect(payload.formats.Doubles.pikachu).toEqual({
      move: ["Shadow Ball"],
      ability: ["Levitate"],
      item: ["Leftovers"],
    });
  });

  it("warns and drops unknown ranked values without dropping known values", () => {
    const warn = vi.fn();
    const payload = transformApiData(apiData([
      entry("pikachu", {
        move: ["Unknown Move", "Thunderbolt"],
        held_item: ["Unknown Item", "Choice Scarf"],
        ability: ["Unknown Ability", "Static"],
      }, {
        move: ["Thunderbolt"],
        held_item: ["Choice Scarf"],
        ability: ["Static"],
      }),
    ]), { catalogs, warn });

    expect(payload.formats.Singles.pikachu).toEqual({
      move: ["Thunderbolt"],
      ability: ["Static"],
      item: ["Choice Scarf"],
    });
    expect(warn.mock.calls.flat().join("\n")).toContain("unknown move");
    expect(warn.mock.calls.flat().join("\n")).toContain("unknown item");
    expect(warn.mock.calls.flat().join("\n")).toContain("unknown ability");
  });

  it("applies only the explicit Aegislash override and does not inherit other forms", () => {
    const payload = transformApiData(apiData([
      entry("aegislash", {
        move: ["Shadow Ball"],
        held_item: ["Leftovers"],
        ability: ["Levitate"],
      }, {
        move: ["Shadow Ball"],
        held_item: ["Leftovers"],
        ability: ["Levitate"],
      }),
      entry("rotomwash", {
        move: ["Thunderbolt"],
        held_item: ["Choice Scarf"],
        ability: ["Levitate"],
      }, {
        move: ["Thunderbolt"],
        held_item: ["Choice Scarf"],
        ability: ["Levitate"],
      }),
    ]), { catalogs, warn: vi.fn() });

    for (const format of ["Singles", "Doubles"]) {
      expect(payload.formats[format].aegislashshield.move).toEqual(["Shadow Ball"]);
      expect(payload.formats[format].aegislashblade.move).toEqual(["Shadow Ball"]);
      expect(payload.formats[format].aegislashboth.move).toEqual(["Shadow Ball"]);
      expect(payload.formats[format].rotomwash.move).toEqual(["Thunderbolt"]);
      expect(payload.formats[format]).not.toHaveProperty("rotomfan");
    }
  });

  it("requires Current data for both formats and usable ranked data", () => {
    const singlesOnly = {
      generatedAt: "2026-08-14T00:17:00.000Z",
      dataVersion: "v1",
      pokemon: [{
        showdownId: "pikachu",
        summary: { battleSummary: { Current: { Singles: { values: values({ move: ["Thunderbolt"] }) } } } },
      }],
    };
    expect(() => transformApiData(singlesOnly, { catalogs })).toThrow(ChampionsUsageDataError);

    expect(() => transformApiData(apiData([
      entry("pikachu"),
    ]), { catalogs })).toThrow("no usable");
  });

  it("creates a schema-valid empty payload for deployment fallback", () => {
    const emptyPayload = createEmptyPayload();
    expect(emptyPayload).toEqual({
      schemaVersion: 1,
      dataVersion: "empty",
      sourceGeneratedAt: "1970-01-01T00:00:00.000Z",
      formats: { Singles: {}, Doubles: {} },
    });
    expect(validatePayload(emptyPayload)).toBe(emptyPayload);
  });

  it("strictly validates static payload categories and duplicate rankings", () => {
    const payload = transformApiData(apiData([
      entry("pikachu", { move: ["Thunderbolt"], ability: ["Static"], held_item: ["Choice Scarf"] }, { move: ["Protect"] }),
    ]), { catalogs, warn: vi.fn() });
    expect(() => validatePayload({
      ...payload,
      formats: {
        ...payload.formats,
        Singles: {
          ...payload.formats.Singles,
          pikachu: { ...payload.formats.Singles.pikachu, item: ["Choice Scarf", "Choice Scarf"] },
        },
      },
    })).toThrow(/duplicate/);
    expect(() => validatePayload({ ...payload, formats: { Singles: {}, Doubles: null } })).toThrow(/Doubles/);
  });
});
