import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toID } from "@smogon/calc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const outputDir = join(projectRoot, "src", "data", "generated");
const csvPath = join(projectRoot, "others", "official_artwork_japanese_names.csv");
const speciesPath = join(outputDir, "calc-species.gen.json");
const outputPath = join(outputDir, "localized-search-index.gen.json");

const SHARED_FORM_FALLBACKS = new Map([
  ["magearnaoriginalmega", "magearnamega"],
  ["meowsticfmega", "meowsticmega"],
  ["meowsticmmega", "meowsticmega"],
  ["tatsugiricurlymega", "tatsugiristretchymega"],
  ["tatsugiridroopymega", "tatsugiristretchymega"],
]);

const parseCsv = (content) => {
  const [headerLine, ...lines] = content.trim().split(/\r?\n/);
  const headers = headerLine.split(",");

  return lines
    .map((line) => {
      const columns = line.split(",");
      return Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""]));
    })
    .filter((row) => row.pokemon_api_name);
};

const normalizeSearchText = (value) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");

const csvRows = parseCsv(await readFile(csvPath, "utf8"));
const normalRows = csvRows.filter(
  (row) => row.status === "ok" && !row.directory.toLowerCase().includes("shiny"),
);

const rowById = new Map();
for (const row of normalRows) {
  rowById.set(toID(row.pokemon_api_name), row);
}

const speciesCatalog = JSON.parse(await readFile(speciesPath, "utf8"));

const speciesEntries = speciesCatalog.entries.map((species) => {
  const fallbackCalcId = SHARED_FORM_FALLBACKS.get(species.id);
  const row = rowById.get(species.id) ?? rowById.get(fallbackCalcId);
  const displayNameJa = row?.japanese_display_name || row?.japanese_species_name || species.showdownName;
  const aliasesJa = [
    row?.japanese_species_name,
    row?.japanese_form_name,
    displayNameJa,
    species.showdownName,
  ]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  return {
    kind: "species",
    calcId: species.id,
    showdownName: species.showdownName,
    displayNameJa,
    aliasesJa,
    normalizedSearchText: normalizeSearchText(`${aliasesJa.join(" ")} ${species.id}`),
    appSupportStatus: species.appSupportStatus,
    fallbackFromCalcId: fallbackCalcId,
    sourceStatus: row
      ? fallbackCalcId
        ? "adapter-temporary"
        : "supported"
      : "unsupported-temporary",
  };
});

const payload = {
  schemaVersion: 1,
  dataVersion: speciesCatalog.dataVersion,
  source: {
    speciesCatalog: "src/data/generated/calc-species.gen.json",
    japaneseNameCsv: "others/official_artwork_japanese_names.csv",
  },
  generatedBy: "scripts/generate-localized-search-index.mjs",
  entries: speciesEntries,
  summary: {
    totalSpecies: speciesEntries.length,
    localizedSpecies: speciesEntries.filter((entry) => entry.sourceStatus === "supported").length,
    fallbackLocalizedSpecies: speciesEntries.filter(
      (entry) => entry.sourceStatus === "adapter-temporary",
    ).length,
    missingLocalizedSpecies: speciesEntries.filter(
      (entry) => entry.sourceStatus === "unsupported-temporary",
    ).length,
    defaultUiSpecies: speciesEntries.filter(
      (entry) => entry.appSupportStatus === "supported",
    ).length,
  },
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      output: "src/data/generated/localized-search-index.gen.json",
      summary: payload.summary,
    },
    null,
    2,
  ),
);
