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

const findFallbackRow = (species) => {
  const explicitFallbackId = SHARED_FORM_FALLBACKS.get(species.id);

  if (explicitFallbackId) {
    return {
      row: rowById.get(explicitFallbackId),
      fallbackFromCalcId: explicitFallbackId,
      fallbackReason: "explicit-shared-form",
    };
  }

  const scoredRows = normalRows
    .map((row) => ({ row, score: scoreFallbackRow(species, row) }))
    .filter((entry) => entry.score)
    .map((entry) => ({ row: entry.row, ...entry.score }));

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

const speciesEntries = speciesCatalog.entries.map((species) => {
  const directRow = rowById.get(species.id);
  const fallback = directRow
    ? { row: directRow, fallbackFromCalcId: undefined, fallbackReason: undefined }
    : findFallbackRow(species);
  const { row, fallbackFromCalcId, fallbackReason } = fallback;
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
    fallbackFromCalcId,
    fallbackReason,
    sourceStatus: row
      ? fallbackFromCalcId
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
