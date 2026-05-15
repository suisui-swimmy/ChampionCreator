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

const TOKEN_ALIASES = new Map([
  ["f", ["female"]],
  ["m", ["male"]],
  ["four", ["familyoffour"]],
  ["blue", ["blueplumage", "bluestriped"]],
  ["white", ["whiteplumage", "whitestriped"]],
  ["yellow", ["yellowplumage"]],
  ["aqua", ["aquabreed"]],
  ["blaze", ["blazebreed"]],
  ["combat", ["combatbreed"]],
  ["cornerstone", ["cornerstonemask"]],
  ["hearthflame", ["hearthflamemask"]],
  ["wellspring", ["wellspringmask"]],
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
const sourceFileCache = new Map();

const hasArtworkFile = async (row) => {
  if (!sourceFileCache.has(row.filename)) {
    sourceFileCache.set(row.filename, await fileExists(join(artworkDir, row.filename)));
  }

  return sourceFileCache.get(row.filename);
};

const getBaseId = (species) => toID(species.baseSpecies || species.showdownName.split("-")[0]);

const getFormTokens = (species, baseId) => {
  const [, ...nameParts] = species.showdownName.split("-");
  const nameTokens = nameParts.map(toID).filter(Boolean);

  if (nameTokens.length > 0) {
    return nameTokens;
  }

  const suffix = species.id.startsWith(baseId) ? species.id.slice(baseId.length) : "";
  return suffix.match(/[a-z]+|[0-9]+/g) ?? [];
};

const tokenMatches = (rowId, token) => {
  if (rowId.includes(token)) {
    return true;
  }

  return (TOKEN_ALIASES.get(token) ?? []).some((alias) => rowId.includes(alias));
};

const scoreFallbackRow = (species, row) => {
  const rowId = toID(row.pokemon_api_name);
  const baseId = getBaseId(species);
  const formTokens = getFormTokens(species, baseId);

  if (rowId === species.id) {
    return { score: 100, reason: "exact" };
  }

  if (rowId !== baseId && !rowId.startsWith(baseId) && !baseId.startsWith(rowId)) {
    return null;
  }

  let score = rowId === baseId ? 50 : 40;
  const matchedTokens = formTokens.filter((token) => tokenMatches(rowId, token));
  score += matchedTokens.length * 35;

  if (/^\d+\.png$/.test(row.filename)) {
    score += 20;
  }

  return {
    score,
    reason: rowId === baseId ? "base" : matchedTokens.length > 0 ? "same-form-family" : "same-base",
  };
};

const findFallbackRow = async (species) => {
  const explicitFallbackId = SHARED_FORM_FALLBACKS.get(species.id);

  if (explicitFallbackId) {
    return {
      row: rowById.get(explicitFallbackId),
      fallbackFromCalcId: explicitFallbackId,
      fallbackReason: "explicit-shared-form",
    };
  }

  const scoredRows = [];

  for (const row of normalRows) {
    if (!(await hasArtworkFile(row))) {
      continue;
    }

    const score = scoreFallbackRow(species, row);
    if (score) {
      scoredRows.push({ row, ...score });
    }
  }

  scoredRows.sort(
    (a, b) => b.score - a.score || a.row.filename.localeCompare(b.row.filename, "en"),
  );

  const best = scoredRows[0];
  if (!best || best.reason === "exact") {
    return {
      row: best?.row,
      fallbackFromCalcId: undefined,
      fallbackReason: undefined,
    };
  }

  return {
    row: best.row,
    fallbackFromCalcId: toID(best.row.pokemon_api_name),
    fallbackReason: best.reason,
  };
};

for (const species of speciesCatalog.entries) {
  const directRow = rowById.get(species.id);
  const fallback = directRow
    ? { row: directRow, fallbackFromCalcId: undefined, fallbackReason: undefined }
    : await findFallbackRow(species);
  const { row, fallbackFromCalcId, fallbackReason } = fallback;

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
    fallbackFromCalcId,
    fallbackReason,
    appSupportStatus: species.appSupportStatus,
    artwork: hasSourceFile
      ? {
          filename: row.filename,
          sourcePath: normalizePath(join("others", "official-artwork", row.filename)),
          suggestedPublicPath: `/assets/official-artwork/${row.filename}`,
          fallbackFromCalcId,
          fallbackReason,
        }
      : null,
    sourceStatus: hasSourceFile
      ? fallbackFromCalcId
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
