import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { toID } from "@smogon/calc";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const outputDir = join(projectRoot, "src", "data", "generated");
const csvPath = join(projectRoot, "others", "official_artwork_japanese_names.csv");
const artworkDir = join(projectRoot, "others", "official-artwork");
const speciesPath = join(outputDir, "calc-species.gen.json");
const outputPath = join(outputDir, "pokemon-assets.gen.json");

const SHARED_FORM_FALLBACKS = new Map([
  ["magearnaoriginalmega", "magearnamega"],
  ["meowsticfmega", "meowsticmega"],
  ["meowsticmmega", "meowsticmega"],
  ["tatsugiricurlymega", "tatsugiristretchymega"],
  ["tatsugiridroopymega", "tatsugiristretchymega"],
]);

const normalizePath = (value) => value.split(sep).join("/");

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

const fileExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const csvRows = parseCsv(await readFile(csvPath, "utf8"));
const normalRows = csvRows.filter(
  (row) => row.status === "ok" && !row.directory.toLowerCase().includes("shiny"),
);

const rowById = new Map();
for (const row of normalRows) {
  rowById.set(toID(row.pokemon_api_name), row);
}

const speciesCatalog = JSON.parse(await readFile(speciesPath, "utf8"));
const entries = [];
const missing = [];

for (const species of speciesCatalog.entries) {
  const fallbackCalcId = SHARED_FORM_FALLBACKS.get(species.id);
  const row = rowById.get(species.id) ?? rowById.get(fallbackCalcId);

  if (!row) {
    missing.push({
      id: species.id,
      showdownName: species.showdownName,
      appSupportStatus: species.appSupportStatus,
      reason: "missing-csv-row",
    });
    entries.push({
      calcId: species.id,
      showdownName: species.showdownName,
      appSupportStatus: species.appSupportStatus,
      artwork: null,
      sourceStatus: "unsupported-temporary",
      notes: "No normal official-artwork CSV row found.",
    });
    continue;
  }

  const sourcePath = join(artworkDir, row.filename);
  const hasSourceFile = await fileExists(sourcePath);

  if (!hasSourceFile) {
    missing.push({
      id: species.id,
      showdownName: species.showdownName,
      appSupportStatus: species.appSupportStatus,
      reason: "missing-source-file",
      filename: row.filename,
    });
  }

  entries.push({
    calcId: species.id,
    showdownName: species.showdownName,
    displayNameJa: row.japanese_display_name || row.japanese_species_name || species.showdownName,
    sourceSpeciesNameJa: row.japanese_species_name || undefined,
    sourceFormNameJa: row.japanese_form_name || undefined,
    fallbackFromCalcId: fallbackCalcId,
    appSupportStatus: species.appSupportStatus,
    artwork: hasSourceFile
      ? {
          filename: row.filename,
          sourcePath: normalizePath(join("others", "official-artwork", row.filename)),
          suggestedPublicPath: `/assets/official-artwork/${row.filename}`,
          fallbackFromCalcId: fallbackCalcId,
        }
      : null,
    sourceStatus: hasSourceFile
      ? fallbackCalcId
        ? "adapter-temporary"
        : "supported"
      : "unsupported-temporary",
  });
}

const payload = {
  schemaVersion: 1,
  dataVersion: speciesCatalog.dataVersion,
  source: {
    speciesCatalog: "src/data/generated/calc-species.gen.json",
    japaneseNameCsv: "others/official_artwork_japanese_names.csv",
    artworkDirectory: "others/official-artwork",
  },
  generatedBy: "scripts/generate-pokemon-assets.mjs",
  entries,
  summary: {
    totalSpecies: entries.length,
    withArtwork: entries.filter((entry) => entry.artwork).length,
    missingArtwork: missing.length,
    supportedWithArtwork: entries.filter(
      (entry) => entry.appSupportStatus === "supported" && entry.artwork,
    ).length,
    supportedMissingArtwork: missing.filter((entry) => entry.appSupportStatus === "supported")
      .length,
  },
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      output: "src/data/generated/pokemon-assets.gen.json",
      summary: payload.summary,
    },
    null,
    2,
  ),
);
