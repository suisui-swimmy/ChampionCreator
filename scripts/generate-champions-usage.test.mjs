import { describe, expect, it, vi } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  calculateNatureDigest,
  ChampionsUsageDataError,
  collectNatureUsageFromFiles,
  createEmptyPayload,
  extractBulkArchive,
  makeCatalogs,
  parseNatureCsv,
  resolveArchiveCsvPath,
  run,
  transformApiData,
  validateArchiveEntries,
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

const natureCatalogs = {
  ...catalogs,
  nature: new Map([
    ["jolly", "Jolly"],
    ["adamant", "Adamant"],
    ["hardy", "Hardy"],
  ]),
};

const currentPaths = (name) => [
  { season: "Current", format: "Singles", path: `pokemon_champions_assets/battle_data/Singles/${name}.csv` },
  { season: "Current", format: "Doubles", path: `pokemon_champions_assets/battle_data/Doubles/${name}.csv` },
];

const natureEntry = (showdownId, fileName = showdownId) => ({
  ...entry(showdownId, {
    move: ["Thunderbolt"],
    held_item: ["Choice Scarf"],
    ability: ["Static"],
  }, {
    move: ["Thunderbolt"],
    held_item: ["Choice Scarf"],
    ability: ["Static"],
  }),
  battleDataCsvs: currentPaths(fileName),
});

const natureCsv = ({ jolly = "66.2%", adamant = "31.3%" } = {}) => [
  "pokemon,column_position,category,rank,name,percentage,stat_up,stat_down",
  `Pikachu,1,move,1,Thunderbolt,90.0%,,,`,
  `Pikachu,1,stat_alignment,1,Jolly,${jolly},Speed,Attack`,
  `Pikachu,1,stat_alignment,2,Adamant,${adamant},Attack,Speed`,
].join("\n");

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

  it("canonicalizes stat_alignment names and preserves a true zero percent", () => {
    const parsed = parseNatureCsv([
      "pokemon,column_position,category,rank,name,percentage,stat_up,stat_down",
      "Pikachu,1,stat_alignment,1,Jolly,0.0%,Speed,Attack",
      "Pikachu,1,stat_alignment,2,Hardy,,Attack,Attack",
    ].join("\n"), { natureMap: natureCatalogs.nature });

    expect(parsed).toEqual([
      { canonicalName: "Jolly", rank: 1, percentage: 0 },
      { canonicalName: "Hardy", rank: 2, percentage: null },
    ]);
  });

  it("fails on malformed or out-of-range nature percentages", () => {
    expect(() => parseNatureCsv([
      "pokemon,column_position,category,rank,name,percentage,stat_up,stat_down",
      "Pikachu,1,stat_alignment,1,Jolly,not-a-percent,Speed,Attack",
    ].join("\n"), { natureMap: natureCatalogs.nature })).toThrow(/percentage is invalid/);
    expect(() => parseNatureCsv([
      "pokemon,column_position,category,rank,name,percentage,stat_up,stat_down",
      "Pikachu,1,stat_alignment,1,Jolly,100.1%,Speed,Attack",
    ].join("\n"), { natureMap: natureCatalogs.nature })).toThrow(/outside 0 through 100/);
  });

  it("maps the index path, warns for missing files/rows, and expands Aegislash explicitly", async () => {
    const warn = vi.fn();
    const usage = await collectNatureUsageFromFiles({
      apiData: apiData([
        natureEntry("pikachu", "Pikachu"),
        natureEntry("aegislash", "Aegislash Shield Forme"),
        {
          ...natureEntry("rotomwash", "Rotom-Wash"),
          battleDataCsvs: currentPaths("Rotom-Wash"),
        },
      ]),
      catalogs: natureCatalogs,
      files: {
        "battle_data/Singles/Pikachu.csv": natureCsv(),
        "battle_data/Doubles/Pikachu.csv": natureCsv({ jolly: "55.0%", adamant: "40.0%" }),
        "battle_data/Singles/Aegislash Shield Forme.csv": natureCsv(),
        "battle_data/Doubles/Aegislash Shield Forme.csv": natureCsv(),
      },
      warn,
    });

    expect(usage.Singles.pikachu).toHaveLength(2);
    expect(usage.Doubles.pikachu[0]).toEqual({ canonicalName: "Jolly", rank: 1, percentage: 55 });
    expect(usage.Singles.aegislashshield).toEqual(usage.Singles.aegislashblade);
    expect(usage.Singles.aegislashshield).toEqual(usage.Singles.aegislashboth);
    expect(usage.Singles.rotomwash).toBeUndefined();
    expect(warn.mock.calls.flat().join("\n")).toContain("missing from bulk ZIP");
  });

  it("fails when the archive has no usable nature data and rejects traversal", async () => {
    expect(() => validateArchiveEntries(["battle_data/../outside.csv"])).toThrow(/parent traversal/);
    await expect(collectNatureUsageFromFiles({
      apiData: apiData([natureEntry("pikachu")]),
      catalogs: natureCatalogs,
      files: {
        "battle_data/Singles/Pikachu.csv": "pokemon,category,rank,name,percentage\nPikachu,move,1,Thunderbolt,90.0%",
        "battle_data/Doubles/Pikachu.csv": "pokemon,category,rank,name,percentage\nPikachu,move,1,Thunderbolt,90.0%",
      },
    })).rejects.toThrow(/no usable stat_alignment/);
  });

  it("fails when either Current format has no usable nature data", async () => {
    await expect(collectNatureUsageFromFiles({
      apiData: apiData([natureEntry("pikachu", "Pikachu")]),
      catalogs: natureCatalogs,
      files: {
        "battle_data/Singles/Pikachu.csv": natureCsv(),
        "battle_data/Doubles/Pikachu.csv": "pokemon,category,rank,name,percentage\nPikachu,move,1,Thunderbolt,90.0%",
      },
    })).rejects.toThrow(/Doubles/);
  });

  it("changes the composite digest when normalized nature usage changes", () => {
    const first = {
      Singles: { pikachu: [{ canonicalName: "Jolly", rank: 1, percentage: 66.2 }] },
      Doubles: { pikachu: [{ canonicalName: "Jolly", rank: 1, percentage: 55 }] },
    };
    const reordered = {
      Singles: { pikachu: [...first.Singles.pikachu] },
      Doubles: { pikachu: [...first.Doubles.pikachu] },
    };
    const changed = {
      ...reordered,
      Singles: { pikachu: [{ canonicalName: "Jolly", rank: 1, percentage: 66.3 }] },
    };
    expect(calculateNatureDigest(first)).toBe(calculateNatureDigest(reordered));
    expect(calculateNatureDigest(first)).not.toBe(calculateNatureDigest(changed));
  });

  it("resolves only the exact index path or the asset-root-stripped path", () => {
    expect(resolveArchiveCsvPath(
      "pokemon_champions_assets/battle_data/Singles/Renamed.csv",
      ["battle_data/Singles/Renamed.csv"],
    )).toBe("battle_data/Singles/Renamed.csv");
    expect(resolveArchiveCsvPath(
      "pokemon_champions_assets/battle_data/Singles/Renamed.csv",
      ["battle_data/Singles/Other.csv"],
    )).toBeUndefined();
  });

  it("extracts through unzip, validates the listing, and cleans the temporary directory", async () => {
    let directory;
    const calls = [];
    const execFileImpl = vi.fn(async (command, args) => {
      calls.push([command, args]);
      if (command === "unzip" && args[0] === "-Z1") {
        return { stdout: "battle_data/Singles/Pikachu.csv\nbattle_data/Doubles/Pikachu.csv\n" };
      }
      if (command === "unzip" && args[0] === "-q") return { stdout: "" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    });

    const extracted = await extractBulkArchive({
      zipBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      execFileImpl,
      tempDirectoryFactory: async () => {
        directory = await mkdtemp(join(tmpdir(), "champions-usage-test-"));
        return directory;
      },
    });
    try {
      expect(extracted.archiveEntries).toEqual(new Set([
        "battle_data/Singles/Pikachu.csv",
        "battle_data/Doubles/Pikachu.csv",
      ]));
      expect(calls.map(([command, args]) => [command, args[0]])).toEqual([
        ["unzip", "-Z1"],
        ["unzip", "-q"],
      ]);
    } finally {
      await extracted.cleanup();
    }
    await expect(access(directory)).rejects.toThrow();
  });

  it("falls back to tar when unzip is unavailable and cleans up after extraction failure", async () => {
    let directory;
    const calls = [];
    const execFileImpl = vi.fn(async (command, args) => {
      calls.push([command, args]);
      if (command === "unzip") throw new Error("unzip is unavailable");
      if (command === "tar" && args[0] === "-tf") {
        return { stdout: "battle_data/Singles/Pikachu.csv\n" };
      }
      if (command === "tar" && args[0] === "-xf") return { stdout: "" };
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    });

    const extracted = await extractBulkArchive({
      zipBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      execFileImpl,
      tempDirectoryFactory: async () => {
        directory = await mkdtemp(join(tmpdir(), "champions-usage-test-"));
        return directory;
      },
    });
    await extracted.cleanup();
    await expect(access(directory)).rejects.toThrow();
    expect(calls.map(([command, args]) => [command, args[0]])).toEqual([
      ["unzip", "-Z1"],
      ["tar", "-tf"],
      ["tar", "-xf"],
    ]);

    let failedDirectory;
    const failedExec = vi.fn(async (command, args) => {
      if (command === "unzip" && args[0] === "-Z1") {
        return { stdout: "battle_data/../outside.csv\n" };
      }
      throw new Error("the invalid listing should fail before extraction");
    });
    await expect(extractBulkArchive({
      zipBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      execFileImpl: failedExec,
      tempDirectoryFactory: async () => {
        failedDirectory = await mkdtemp(join(tmpdir(), "champions-usage-test-"));
        return failedDirectory;
      },
    })).rejects.toThrow(/parent traversal/);
    await expect(access(failedDirectory)).rejects.toThrow();
  });

  it("fetches the API and bulk ZIP exactly once and always cleans the injected extraction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "champions-usage-run-test-"));
    const outputPath = join(directory, "usage.json");
    const catalogEntries = {
      "move-options.gen.json": { entries: [{ id: "thunderbolt", showdownName: "Thunderbolt" }] },
      "ability-options.gen.json": { entries: [{ id: "static", showdownName: "Static" }] },
      "item-options.gen.json": { entries: [{ id: "choicescarf", showdownName: "Choice Scarf" }] },
      "pokemon-options.gen.json": { entries: [{ id: "pikachu", showdownName: "Pikachu" }] },
      "nature-options.gen.json": { entries: [
        { id: "jolly", showdownName: "Jolly" },
        { id: "adamant", showdownName: "Adamant" },
      ] },
    };
    await Promise.all(Object.entries(catalogEntries).map(([name, value]) => (
      writeFile(join(directory, name), `${JSON.stringify(value)}\n`, "utf8")
    )));

    const apiUrl = "https://example.test/api";
    const bulkZipUrl = "https://example.test/battle_data.zip";
    const sourceApiData = apiData([natureEntry("pikachu", "Pikachu")]);
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const fetchImpl = vi.fn(async (url) => {
      if (url === apiUrl) return { ok: true, status: 200, json: async () => sourceApiData };
      if (url === bulkZipUrl) return { ok: true, status: 200, arrayBuffer: async () => zipBytes.buffer };
      throw new Error(`unexpected fetch URL: ${url}`);
    });
    const cleanup = vi.fn(async () => {});
    const extractBulkArchiveImpl = vi.fn(async ({ zipBytes: receivedZipBytes }) => ({
      archiveEntries: [
        "battle_data/Singles/Pikachu.csv",
        "battle_data/Doubles/Pikachu.csv",
      ],
      readFileForPath: async () => natureCsv(),
      cleanup,
      receivedZipBytes,
    }));

    try {
      const result = await run({
        outputPath,
        apiUrl,
        bulkZipUrl,
        catalogDirectory: directory,
        fetchImpl,
        extractBulkArchiveImpl,
        warn: vi.fn(),
      });

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls.map(([url]) => url).sort()).toEqual([apiUrl, bulkZipUrl].sort());
      expect(extractBulkArchiveImpl).toHaveBeenCalledTimes(1);
      expect(extractBulkArchiveImpl.mock.calls[0][0].zipBytes).toEqual(zipBytes);
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(result.payload.formats.Singles.pikachu.nature).toEqual([
        { canonicalName: "Jolly", rank: 1, percentage: 66.2 },
        { canonicalName: "Adamant", rank: 2, percentage: 31.3 },
      ]);
      expect(result.payload.dataVersion).toMatch(/^20260814001700000\+nature-[0-9a-f]{64}$/);
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(result.payload);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts old schema v1 payloads without nature and rejects invalid nature rankings", () => {
    const legacyPayload = {
      ...createEmptyPayload(),
      formats: {
        Singles: { pikachu: { move: ["thunderbolt"], ability: [], item: [] } },
        Doubles: { pikachu: { move: ["thunderbolt"], ability: [], item: [] } },
      },
    };
    expect(validatePayload(legacyPayload)).toBe(legacyPayload);

    const withNature = (nature) => ({
      ...legacyPayload,
      formats: {
        ...legacyPayload.formats,
        Singles: { ...legacyPayload.formats.Singles, pikachu: { ...legacyPayload.formats.Singles.pikachu, nature } },
      },
    });
    expect(validatePayload(withNature([{ canonicalName: "Jolly", rank: 1, percentage: 0 }]))).toBeTruthy();
    expect(() => validatePayload(withNature([
      { canonicalName: "Jolly", rank: 1, percentage: 10 },
      { canonicalName: "Jolly", rank: 2, percentage: 20 },
    ]))).toThrow(/duplicate nature/);
    expect(() => validatePayload(withNature([
      { canonicalName: "Jolly", rank: 1, percentage: 10 },
      { canonicalName: "Adamant", rank: 1, percentage: 20 },
    ]))).toThrow(/duplicate rank/);
    expect(() => validatePayload(withNature([
      { canonicalName: "Jolly", rank: 1, percentage: 100.1 },
    ]))).toThrow(/percentage must be null or a number from 0 through 100/);
  });
});
