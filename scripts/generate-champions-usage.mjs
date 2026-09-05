import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const API_URL = "https://championsbattledata.com/api";
export const BULK_ZIP_URL = "https://championsbattledata.com/pokemon_champions_assets/battle_data.zip";
export const DEFAULT_OUTPUT_PATH = "public/data/champions-usage-current.json";
export const CATALOG_DIRECTORY = "src/data/generated";
export const FORMATS = ["Singles", "Doubles"];
export const CATEGORIES = ["move", "ability", "item"];
export const EMPTY_SOURCE_GENERATED_AT = "1970-01-01T00:00:00.000Z";
export const DEFAULT_ASSET_ROOT = "pokemon_champions_assets";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const execFileAsync = promisify(execFileCallback);

// The API uses Showdown IDs. Keep this generator dependency-free so the
// scheduled workflow can validate and generate data before running npm ci.
const toID = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "");

const EMPTY_RANKING = Object.fromEntries(
  CATEGORIES.map((category) => [category, []]),
);

const emitWarning = (message) => {
  const output = process.env.GITHUB_ACTIONS === "true"
    ? `::warning::${message}`
    : message;
  console.warn(output);
};

export class ChampionsUsageDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChampionsUsageDataError";
  }
}

export const createEmptyPayload = () => ({
  schemaVersion: 1,
  dataVersion: "empty",
  // Keep the fallback parseable by the strict client schema. The UI treats
  // dataVersion=empty as unavailable and renders the date as 未取得.
  sourceGeneratedAt: EMPTY_SOURCE_GENERATED_AT,
  formats: Object.fromEntries(
    FORMATS.map((format) => [format, {}]),
  ),
});

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const assertNonEmptyString = (value, path) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ChampionsUsageDataError(`${path} must be a non-empty string`);
  }
};

const validateNatureRanking = (values, path) => {
  if (!Array.isArray(values)) {
    throw new ChampionsUsageDataError(`${path} must be an array`);
  }
  const seenNames = new Set();
  const seenRanks = new Set();
  for (const [index, value] of values.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!isObject(value)) {
      throw new ChampionsUsageDataError(`${entryPath} must be an object`);
    }
    assertNonEmptyString(value.canonicalName, `${entryPath}.canonicalName`);
    if (seenNames.has(value.canonicalName)) {
      throw new ChampionsUsageDataError(`${path} has duplicate nature ${JSON.stringify(value.canonicalName)}`);
    }
    seenNames.add(value.canonicalName);
    if (!Number.isInteger(value.rank) || value.rank < 1 || value.rank > 10) {
      throw new ChampionsUsageDataError(`${entryPath}.rank must be an integer from 1 through 10`);
    }
    if (seenRanks.has(value.rank)) {
      throw new ChampionsUsageDataError(`${path} has duplicate rank ${value.rank}`);
    }
    seenRanks.add(value.rank);
    if (value.percentage !== null && (
      typeof value.percentage !== "number"
      || !Number.isFinite(value.percentage)
      || value.percentage < 0
      || value.percentage > 100
    )) {
      throw new ChampionsUsageDataError(`${entryPath}.percentage must be null or a number from 0 through 100`);
    }
  }
};

/** Validate the v1 static payload before it is copied into a Pages build. */
export const validatePayload = (payload) => {
  if (!isObject(payload)) {
    throw new ChampionsUsageDataError("usage payload must be an object");
  }
  if (payload.schemaVersion !== 1) {
    throw new ChampionsUsageDataError("usage payload schemaVersion must be 1");
  }
  assertNonEmptyString(payload.dataVersion, "usage payload dataVersion");
  assertNonEmptyString(payload.sourceGeneratedAt, "usage payload sourceGeneratedAt");
  if (Number.isNaN(Date.parse(payload.sourceGeneratedAt))) {
    throw new ChampionsUsageDataError("usage payload sourceGeneratedAt must be an ISO-compatible date");
  }
  if (!isObject(payload.formats)) {
    throw new ChampionsUsageDataError("usage payload formats must be an object");
  }
  for (const format of FORMATS) {
    const entries = payload.formats[format];
    if (!isObject(entries)) {
      throw new ChampionsUsageDataError(`usage payload formats.${format} must be an object`);
    }
    for (const [pokemonId, ranking] of Object.entries(entries)) {
      assertNonEmptyString(pokemonId, `usage payload formats.${format} Pokemon key`);
      if (!isObject(ranking)) {
        throw new ChampionsUsageDataError(`usage payload formats.${format}.${pokemonId} must be an object`);
      }
      if (ranking.pokemonRank !== undefined
        && (!Number.isSafeInteger(ranking.pokemonRank) || ranking.pokemonRank < 1)) {
        throw new ChampionsUsageDataError(`usage payload formats.${format}.${pokemonId}.pokemonRank must be a positive integer`);
      }
      for (const category of CATEGORIES) {
        const values = ranking[category];
        if (!Array.isArray(values)) {
          throw new ChampionsUsageDataError(`usage payload formats.${format}.${pokemonId}.${category} must be an array`);
        }
        const seen = new Set();
        for (const [index, value] of values.entries()) {
          assertNonEmptyString(value, `usage payload formats.${format}.${pokemonId}.${category}[${index}]`);
          if (seen.has(value)) {
            throw new ChampionsUsageDataError(`usage payload formats.${format}.${pokemonId}.${category} has duplicate ${JSON.stringify(value)}`);
          }
          seen.add(value);
        }
      }
      if (Object.prototype.hasOwnProperty.call(ranking, "nature")) {
        validateNatureRanking(ranking.nature, `usage payload formats.${format}.${pokemonId}.nature`);
      }
    }
  }
  return payload;
};

const assertApiShape = (apiData) => {
  if (!isObject(apiData)) {
    throw new ChampionsUsageDataError("Champions usage API response must be an object");
  }
  if (typeof apiData.dataVersion !== "string" || apiData.dataVersion.trim() === "") {
    throw new ChampionsUsageDataError("Champions usage API response is missing dataVersion");
  }
  if (typeof apiData.generatedAt !== "string" || apiData.generatedAt.trim() === "") {
    throw new ChampionsUsageDataError("Champions usage API response is missing generatedAt");
  }
  if (Number.isNaN(Date.parse(apiData.generatedAt))) {
    throw new ChampionsUsageDataError("Champions usage API response has invalid generatedAt");
  }
  if (!Array.isArray(apiData.pokemon) || apiData.pokemon.length === 0) {
    throw new ChampionsUsageDataError("Champions usage API response has no pokemon records");
  }

  const current = Object.fromEntries(FORMATS.map((format) => [format, 0]));
  for (const entry of apiData.pokemon) {
    const currentSummary = entry?.summary?.battleSummary?.Current;
    for (const format of FORMATS) {
      if (isObject(currentSummary?.[format])) current[format] += 1;
    }
  }

  for (const format of FORMATS) {
    if (current[format] === 0) {
      throw new ChampionsUsageDataError(`Current ${format} data is missing`);
    }
  }
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const makeCanonicalMap = (payload, { useEntryId = false } = {}) => {
  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  const byName = new Map();
  for (const entry of entries) {
    if (typeof entry?.id !== "string" || entry.id.trim() === "") continue;
    const canonicalName = useEntryId
      ? entry.id
      : typeof entry.showdownName === "string" && entry.showdownName.trim() !== ""
      ? entry.showdownName
      : entry.id;
    const names = [entry.id, entry.showdownName, entry.name, entry.label];
    for (const name of names) {
      if (typeof name !== "string" || name.trim() === "") continue;
      const id = toID(name);
      if (id && !byName.has(id)) byName.set(id, canonicalName);
    }
  }
  return byName;
};

export const makeCatalogs = ({ moves, abilities, items, pokemon, natures }) => ({
  move: makeCanonicalMap(moves),
  ability: makeCanonicalMap(abilities),
  item: makeCanonicalMap(items),
  pokemon: makeCanonicalMap(pokemon, { useEntryId: true }),
  nature: makeCanonicalMap(natures),
});

export const loadCatalogs = async (catalogDirectory = join(projectRoot, CATALOG_DIRECTORY)) => {
  const [moves, abilities, items, pokemon, natures] = await Promise.all([
    readJson(join(catalogDirectory, "move-options.gen.json")),
    readJson(join(catalogDirectory, "ability-options.gen.json")),
    readJson(join(catalogDirectory, "item-options.gen.json")),
    readJson(join(catalogDirectory, "pokemon-options.gen.json")),
    readJson(join(catalogDirectory, "nature-options.gen.json")).catch((error) => {
      // Keep the old four-catalog generator contract readable in local tests;
      // the nature collection step will still fail closed if no nature catalog
      // entries can be canonicalized.
      if (error?.code === "ENOENT") return { entries: [] };
      throw error;
    }),
  ]);
  return makeCatalogs({ moves, abilities, items, pokemon, natures });
};

const getFormatValues = (entry, format) => entry?.summary?.battleSummary?.Current?.[format]?.values ?? {};

const getPokemonUsageRank = (entry, format) => {
  const summary = entry?.summary?.battleSummary?.Current?.[format];
  // The provider's Meta view uses CSV column_position / JSON position as the
  // Pokemon's overall rank. A row's `rank` is its move/item/etc. rank instead.
  // Source: https://championsbattledata.com/meta.js (positionOf), checked 2026-09-05.
  const rows = Array.isArray(summary?.rows) ? summary.rows : Object.values(summary?.top ?? {});
  const positions = new Set();
  for (const row of rows) {
    for (const position of [row?.position, row?.column_position]) {
      if (position === undefined || position === null || position === "") continue;
      if (!Number.isSafeInteger(position) || position < 1) {
        throw new ChampionsUsageDataError(`Invalid Pokemon position for ${entry.showdownId} (${format})`);
      }
      positions.add(position);
    }
  }
  if (positions.size > 1) {
    throw new ChampionsUsageDataError(`Conflicting Pokemon positions for ${entry.showdownId} (${format})`);
  }
  return positions.values().next().value;
};

const getCategoryValues = (values, category) => {
  if (!isObject(values)) return [];
  const sourceKey = category === "item" ? "held_item" : category;
  return Array.isArray(values[sourceKey]) ? values[sourceKey] : [];
};

const normalizeValue = (value) => {
  if (typeof value === "string") return value;
  if (isObject(value) && typeof value.name === "string") return value.name;
  return "";
};

const mapRankedValues = ({ values, category, canonicalMap, sourceId, format, warn }) => {
  const result = [];
  const seen = new Set();
  for (const rawValue of values) {
    const displayName = normalizeValue(rawValue);
    const lookupId = toID(displayName);
    if (!lookupId) {
      warn(`[champions-usage] dropped empty ${category} for ${sourceId} (${format})`);
      continue;
    }
    const canonicalId = canonicalMap.get(lookupId);
    if (!canonicalId) {
      warn(`[champions-usage] dropped unknown ${category} "${displayName}" for ${sourceId} (${format})`);
      continue;
    }
    if (seen.has(canonicalId)) continue;
    seen.add(canonicalId);
    result.push(canonicalId);
  }
  return result;
};

const resolvePokemonTargets = ({ sourceId, pokemonMap, warn }) => {
  const normalizedId = toID(sourceId);
  if (normalizedId === "aegislash") {
    return ["aegislashshield", "aegislashblade", "aegislashboth"];
  }
  const canonicalId = pokemonMap.get(normalizedId);
  if (canonicalId) return [canonicalId];
  warn(`[champions-usage] dropped unknown pokemon "${sourceId}"`);
  return [];
};

const emptyRanking = () => ({ ...EMPTY_RANKING, move: [], ability: [], item: [] });

const getNatureForTarget = (natureUsageByFormat, format, target) => {
  if (!natureUsageByFormat) return undefined;
  const values = natureUsageByFormat[format];
  if (!values) return undefined;
  if (values instanceof Map) return values.get(target);
  return values[target];
};

export const transformApiData = (apiData, {
  catalogs,
  warn = emitWarning,
  natureUsageByFormat,
  natureDigest,
  dataVersion,
} = {}) => {
  assertApiShape(apiData);
  if (!catalogs?.move || !catalogs?.ability || !catalogs?.item || !catalogs?.pokemon) {
    throw new ChampionsUsageDataError("Generated option catalogs are required");
  }

  const formats = Object.fromEntries(FORMATS.map((format) => [format, {}]));
  const usableValues = Object.fromEntries(FORMATS.map((format) => [format, 0]));

  for (const entry of apiData.pokemon) {
    const sourceId = entry?.showdownId;
    if (typeof sourceId !== "string" || sourceId.trim() === "") {
      warn("[champions-usage] dropped pokemon record without showdownId");
      continue;
    }
    const targets = resolvePokemonTargets({ sourceId, pokemonMap: catalogs.pokemon, warn });
    if (targets.length === 0) continue;

    const rankingsByFormat = Object.fromEntries(FORMATS.map((format) => [format, emptyRanking()]));
    for (const format of FORMATS) {
      const values = getFormatValues(entry, format);
      for (const category of CATEGORIES) {
        const ranked = mapRankedValues({
          values: getCategoryValues(values, category),
          category,
          canonicalMap: catalogs[category],
          sourceId,
          format,
          warn,
        });
        rankingsByFormat[format][category] = ranked;
        usableValues[format] += ranked.length;
      }
    }

    for (const format of FORMATS) {
      const pokemonRank = getPokemonUsageRank(entry, format);
      for (const target of targets) {
        const targetRanking = {
          move: [...rankingsByFormat[format].move],
          ability: [...rankingsByFormat[format].ability],
          item: [...rankingsByFormat[format].item],
        };
        // The aggregate Aegislash entry is selected as its initial Shield form.
        // Its battle-form suggestion data is shared above; its overall rank
        // must not be duplicated across Shield, Blade and the internal Both.
        if (pokemonRank !== undefined && target === targets[0]) {
          targetRanking.pokemonRank = pokemonRank;
        }
        const nature = getNatureForTarget(natureUsageByFormat, format, target);
        if (Array.isArray(nature) && nature.length > 0) {
          targetRanking.nature = nature.map((datum) => ({ ...datum }));
        }
        formats[format][target] = targetRanking;
      }
    }
  }

  if (FORMATS.some((format) => usableValues[format] === 0)) {
    throw new ChampionsUsageDataError("Champions usage API response has no usable move, ability, or item data for every Current format");
  }

  const resolvedDataVersion = natureUsageByFormat
    ? composeDataVersion(apiData.dataVersion, natureDigest ?? calculateNatureDigest(natureUsageByFormat))
    : dataVersion ?? apiData.dataVersion;

  return validatePayload({
    schemaVersion: 1,
    dataVersion: resolvedDataVersion,
    sourceGeneratedAt: apiData.generatedAt,
    formats,
  });
};

export const fetchApiData = async (apiUrl = API_URL, fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== "function") {
    throw new ChampionsUsageDataError("Global fetch is unavailable");
  }
  const response = await fetchImpl(apiUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new ChampionsUsageDataError(`Champions usage API request failed: HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ChampionsUsageDataError(`Champions usage API returned invalid JSON: ${error.message}`);
  }
};

export const fetchBulkZip = async (zipUrl = BULK_ZIP_URL, fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== "function") {
    throw new ChampionsUsageDataError("Global fetch is unavailable");
  }
  const response = await fetchImpl(zipUrl, {
    headers: { accept: "application/zip, application/octet-stream" },
  });
  if (!response.ok) {
    throw new ChampionsUsageDataError(`Champions usage bulk ZIP request failed: HTTP ${response.status}`);
  }
  if (typeof response.arrayBuffer !== "function") {
    throw new ChampionsUsageDataError("Champions usage bulk ZIP response has no arrayBuffer method");
  }
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    throw new ChampionsUsageDataError(`Champions usage bulk ZIP response could not be read: ${error.message}`);
  }
};

const normalizePathForArchive = (value, pathLabel = "archive path") => {
  assertNonEmptyString(value, pathLabel);
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  if (normalized === "") {
    throw new ChampionsUsageDataError(`${pathLabel} must name a file or directory`);
  }
  if (normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new ChampionsUsageDataError(`${pathLabel} must be a safe relative path`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new ChampionsUsageDataError(`${pathLabel} must not contain parent traversal`);
  }
  if (segments.some((segment) => segment === "" || segment === ".")) {
    throw new ChampionsUsageDataError(`${pathLabel} contains an empty or dot path segment`);
  }
  return segments.join("/");
};

export const validateArchiveEntries = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ChampionsUsageDataError("Champions usage bulk ZIP contains no archive entries");
  }
  const normalized = new Set();
  for (const rawEntry of entries) {
    const entry = normalizePathForArchive(rawEntry, "bulk ZIP archive path");
    if (normalized.has(entry)) {
      throw new ChampionsUsageDataError(`Champions usage bulk ZIP contains duplicate archive path ${entry}`);
    }
    normalized.add(entry);
  }
  return normalized;
};

const normalizeAssetRoot = (assetRoot) => normalizePathForArchive(assetRoot, "API assetRoot");

/**
 * Convert an API index Current path into a safe archive-relative path.
 * The path is intentionally taken from the API index; no filename is derived
 * from showdownId or a display name.
 */
export const normalizeCurrentCsvPath = (sourcePath, { assetRoot = DEFAULT_ASSET_ROOT } = {}) => {
  const normalized = normalizePathForArchive(sourcePath, "API Current CSV path");
  if (!normalized.toLowerCase().endsWith(".csv")) {
    throw new ChampionsUsageDataError(`API Current CSV path must point to a CSV: ${normalized}`);
  }
  const battleDataMarker = "battle_data/";
  if (!normalized.includes(battleDataMarker)) {
    throw new ChampionsUsageDataError(`API Current CSV path is outside battle_data: ${normalized}`);
  }
  const root = normalizeAssetRoot(assetRoot);
  const rootPrefix = `${root}/`;
  if (normalized.startsWith(rootPrefix)) {
    return normalized.slice(rootPrefix.length);
  }
  return normalized;
};

export const mapCurrentCsvPaths = (apiData, { assetRoot = apiData?.assetRoot ?? DEFAULT_ASSET_ROOT, warn = emitWarning } = {}) => {
  if (!isObject(apiData) || !Array.isArray(apiData.pokemon)) {
    throw new ChampionsUsageDataError("Champions usage API response has no pokemon index");
  }
  const result = Object.fromEntries(FORMATS.map((format) => [format, new Map()]));
  for (const entry of apiData.pokemon) {
    const sourceId = entry?.showdownId;
    if (typeof sourceId !== "string" || sourceId.trim() === "") {
      warn("[champions-usage] cannot map Current CSV without showdownId");
      continue;
    }
    const csvs = Array.isArray(entry.battleDataCsvs) ? entry.battleDataCsvs : [];
    for (const format of FORMATS) {
      const current = csvs.filter((csv) => csv?.season === "Current" && csv?.format === format);
      if (current.length === 0) {
        warn(`[champions-usage] Current ${format} CSV path is missing for ${sourceId}`);
        continue;
      }
      if (current.length > 1) {
        throw new ChampionsUsageDataError(`API index has multiple Current ${format} CSV paths for ${sourceId}`);
      }
      const sourcePath = current[0]?.path;
      const archivePath = normalizeCurrentCsvPath(sourcePath, { assetRoot });
      result[format].set(sourceId, { sourcePath, archivePath });
    }
  }
  return result;
};

const getArchivePathCandidates = (sourcePath, assetRoot) => {
  const normalizedSource = normalizePathForArchive(sourcePath, "API Current CSV path");
  const root = normalizeAssetRoot(assetRoot);
  const candidates = [normalizedSource];
  const rootPrefix = `${root}/`;
  if (normalizedSource.startsWith(rootPrefix)) {
    candidates.push(normalizedSource.slice(rootPrefix.length));
  }
  const marker = "battle_data/";
  const markerIndex = normalizedSource.indexOf(marker);
  if (markerIndex > 0) candidates.push(normalizedSource.slice(markerIndex));
  return [...new Set(candidates)];
};

export const resolveArchiveCsvPath = (sourcePath, archiveEntries, { assetRoot = DEFAULT_ASSET_ROOT } = {}) => {
  const entries = archiveEntries instanceof Set
    ? archiveEntries
    : validateArchiveEntries(archiveEntries);
  return getArchivePathCandidates(sourcePath, assetRoot).find((candidate) => entries.has(candidate));
};

const parseCsvRecords = (text) => {
  if (typeof text !== "string") {
    throw new ChampionsUsageDataError("Champions usage CSV must be text");
  }
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell === "") {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new ChampionsUsageDataError("Champions usage CSV contains an unterminated quoted field");
  if (cell !== "" || row.length > 0) {
    row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
};

export const parsePercentage = (value, path = "CSV percentage") => {
  const normalized = String(value ?? "").trim();
  if (normalized === "") return null;
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)%$/.test(normalized)) {
    throw new ChampionsUsageDataError(`${path} is invalid: ${JSON.stringify(value)}`);
  }
  const percentage = Number(normalized.slice(0, -1));
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new ChampionsUsageDataError(`${path} is outside 0 through 100: ${JSON.stringify(value)}`);
  }
  return percentage;
};

/** Parse the top ten stat_alignment rows from one official battle CSV. */
export const parseNatureCsv = (csvText, { natureMap, sourcePath = "CSV", warn = emitWarning } = {}) => {
  if (!(natureMap instanceof Map)) {
    throw new ChampionsUsageDataError("Nature catalog is required to parse battle CSV");
  }
  const rows = parseCsvRecords(csvText);
  if (rows.length === 0) return [];
  const headers = rows[0].map((header, index) => String(header ?? "").replace(/^\uFEFF/, "").trim().toLowerCase() || `column_${index}`);
  const column = (name) => headers.indexOf(name);
  const categoryColumn = column("category");
  const rankColumn = column("rank");
  const nameColumn = column("name");
  const percentageColumn = column("percentage");
  if ([categoryColumn, rankColumn, nameColumn, percentageColumn].some((value) => value < 0)) {
    throw new ChampionsUsageDataError(`${sourcePath} is missing a required category/rank/name/percentage column`);
  }

  const result = [];
  const seenNames = new Set();
  const seenRanks = new Set();
  for (const rawRow of rows.slice(1)) {
    const category = String(rawRow[categoryColumn] ?? "").trim().toLowerCase();
    if (category !== "stat_alignment") continue;
    const rankText = String(rawRow[rankColumn] ?? "").trim();
    if (!/^\d+$/.test(rankText)) {
      throw new ChampionsUsageDataError(`${sourcePath} has invalid stat_alignment rank ${JSON.stringify(rankText)}`);
    }
    const rank = Number(rankText);
    if (!Number.isInteger(rank) || rank < 1) {
      throw new ChampionsUsageDataError(`${sourcePath} has invalid stat_alignment rank ${JSON.stringify(rankText)}`);
    }
    const displayName = String(rawRow[nameColumn] ?? "").trim();
    const percentage = parsePercentage(
      rawRow[percentageColumn],
      `${sourcePath} ${displayName || "(unnamed nature)"} percentage`,
    );
    // The published API contract is top 10. Ignore any extra rows in a CSV
    // while still validating their rank and percentage fields.
    if (rank > 10) continue;
    if (!displayName) {
      warn(`[champions-usage] dropped empty nature for ${sourcePath}`);
      continue;
    }
    const canonicalName = natureMap.get(toID(displayName));
    if (!canonicalName) {
      warn(`[champions-usage] dropped unknown nature "${displayName}" for ${sourcePath}`);
      continue;
    }
    if (seenNames.has(canonicalName) || seenRanks.has(rank)) {
      // A few upstream CSVs currently repeat a nature/rank row. Keep the
      // first published occurrence so the generated schema remains unique,
      // while making the data-quality issue visible in the workflow log.
      warn(`[champions-usage] dropped duplicate stat_alignment nature or rank for ${sourcePath}: ${displayName} (${rank})`);
      continue;
    }
    seenNames.add(canonicalName);
    seenRanks.add(rank);
    result.push({ canonicalName, rank, percentage });
  }
  result.sort((left, right) => left.rank - right.rank);
  return result;
};

const mapLikeEntries = (value) => {
  if (value instanceof Map) return [...value.entries()];
  if (isObject(value)) return Object.entries(value);
  return [];
};

/** Stable digest input: format and Pokemon keys are sorted, rows retain rank order. */
export const normalizeNatureUsageForDigest = (natureUsageByFormat) => Object.fromEntries(
  FORMATS.map((format) => [
    format,
    Object.fromEntries(
      mapLikeEntries(natureUsageByFormat?.[format])
        .sort(([left], [right]) => {
          const leftText = String(left);
          const rightText = String(right);
          return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
        })
        .map(([pokemon, values]) => [
          pokemon,
          Array.isArray(values)
            ? [...values]
              .sort((left, right) => left.rank - right.rank)
              .map(({ canonicalName, rank, percentage }) => ({ canonicalName, rank, percentage }))
            : [],
        ]),
    ),
  ]),
);

export const calculateNatureDigest = (natureUsageByFormat) => createHash("sha256")
  .update(JSON.stringify(normalizeNatureUsageForDigest(natureUsageByFormat)))
  .digest("hex");

export const composeDataVersion = (apiDataVersion, natureDigest) => {
  assertNonEmptyString(apiDataVersion, "API dataVersion");
  assertNonEmptyString(natureDigest, "nature digest");
  return `${apiDataVersion}+nature-${natureDigest}`;
};

const safeJoinExtractedPath = (directory, archivePath) => {
  const normalized = normalizePathForArchive(archivePath, "archive file path");
  return join(directory, ...normalized.split("/"));
};

const readCommandOutput = async (execFileImpl, command, args) => {
  try {
    const result = await execFileImpl(command, args, { encoding: "utf8" });
    return typeof result === "string" ? result : result?.stdout ?? "";
  } catch (error) {
    throw new ChampionsUsageDataError(`${command} ${args.join(" ")} failed: ${error.message}`);
  }
};

/**
 * Extract a ZIP into a dedicated temporary directory. `unzip` is preferred;
 * Windows runners commonly provide `tar`, which is used as a fallback. The
 * archive is listed and every path is validated before extraction to prevent
 * traversal outside the temporary directory.
 */
export const extractBulkArchive = async ({
  zipBytes,
  execFileImpl = execFileAsync,
  tempDirectoryFactory = () => mkdtemp(join(tmpdir(), "champions-usage-")),
} = {}) => {
  if (!(zipBytes instanceof Uint8Array) && !Buffer.isBuffer(zipBytes)) {
    throw new ChampionsUsageDataError("Champions usage bulk ZIP bytes are required");
  }
  const directory = await tempDirectoryFactory();
  const zipPath = join(directory, "battle_data.zip");
  try {
    await writeFile(zipPath, zipBytes);
    let listCommand;
    let listing;
    try {
      listing = await readCommandOutput(execFileImpl, "unzip", ["-Z1", zipPath]);
      listCommand = "unzip";
    } catch {
      listing = await readCommandOutput(execFileImpl, "tar", ["-tf", zipPath]);
      listCommand = "tar";
    }
    const archiveEntries = validateArchiveEntries(listing.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));

    try {
      if (listCommand === "unzip") {
        await readCommandOutput(execFileImpl, "unzip", ["-q", zipPath, "-d", directory]);
      } else {
        await readCommandOutput(execFileImpl, "tar", ["-xf", zipPath, "-C", directory]);
      }
    } catch (error) {
      if (listCommand !== "unzip") throw error;
      await readCommandOutput(execFileImpl, "tar", ["-xf", zipPath, "-C", directory]);
    }

    return {
      directory,
      archiveEntries,
      readFileForPath: (archivePath) => readFile(safeJoinExtractedPath(directory, archivePath), "utf8"),
      cleanup: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    if (error instanceof ChampionsUsageDataError) throw error;
    throw new ChampionsUsageDataError(`Champions usage bulk ZIP extraction failed: ${error.message}`);
  }
};

const getCurrentPathRecord = (pathIndex, format, sourceId) => {
  const formatIndex = pathIndex?.[format];
  if (!formatIndex) return undefined;
  return formatIndex instanceof Map ? formatIndex.get(sourceId) : formatIndex[sourceId];
};

/**
 * Parse nature rows from extracted Current CSV files. Missing files/rows are
 * warnings and leave that Pokemon/form without a nature field; a completely
 * unusable archive is a hard error so a bad ZIP cannot replace last-good data.
 */
export const collectNatureUsage = async ({
  apiData,
  catalogs,
  archiveEntries,
  readFileForPath,
  assetRoot = apiData?.assetRoot ?? DEFAULT_ASSET_ROOT,
  warn = emitWarning,
} = {}) => {
  assertApiShape(apiData);
  if (!(catalogs?.nature instanceof Map)) {
    throw new ChampionsUsageDataError("Nature catalog is required");
  }
  if (typeof readFileForPath !== "function") {
    throw new ChampionsUsageDataError("A bulk archive file reader is required");
  }
  const pathIndex = mapCurrentCsvPaths(apiData, { assetRoot, warn });
  const entries = archiveEntries === undefined
    ? undefined
    : archiveEntries instanceof Set
    ? archiveEntries
    : validateArchiveEntries(archiveEntries);
  const usageByFormat = Object.fromEntries(FORMATS.map((format) => [format, {}]));
  const readCache = new Map();
  const usableNatureCount = Object.fromEntries(FORMATS.map((format) => [format, 0]));

  for (const entry of apiData.pokemon) {
    const sourceId = entry?.showdownId;
    if (typeof sourceId !== "string" || sourceId.trim() === "") continue;
    const targets = resolvePokemonTargets({ sourceId, pokemonMap: catalogs.pokemon, warn });
    if (targets.length === 0) continue;
    for (const format of FORMATS) {
      const pathRecord = getCurrentPathRecord(pathIndex, format, sourceId);
      if (!pathRecord) continue;
      const archivePath = entries
        ? resolveArchiveCsvPath(pathRecord.sourcePath, entries, { assetRoot })
        : pathRecord.archivePath;
      if (!archivePath) {
        warn(`[champions-usage] Current ${format} CSV is missing from bulk ZIP for ${sourceId}: ${pathRecord.sourcePath}`);
        continue;
      }
      let natureRanking = readCache.get(archivePath);
      if (!natureRanking) {
        let csvText;
        try {
          csvText = await readFileForPath(archivePath);
        } catch (error) {
          warn(`[champions-usage] could not read Current ${format} CSV for ${sourceId}: ${pathRecord.sourcePath} (${error.message})`);
          continue;
        }
        natureRanking = parseNatureCsv(csvText, {
          natureMap: catalogs.nature,
          sourcePath: pathRecord.sourcePath,
          warn,
        });
        readCache.set(archivePath, natureRanking);
      }
      if (natureRanking.length === 0) {
        warn(`[champions-usage] Current ${format} CSV has no stat_alignment rows for ${sourceId}: ${pathRecord.sourcePath}`);
        continue;
      }
      usableNatureCount[format] += natureRanking.length;
      for (const target of targets) {
        if (usageByFormat[format][target]) continue;
        usageByFormat[format][target] = natureRanking.map((datum) => ({ ...datum }));
      }
    }
  }

  const unusableFormats = FORMATS.filter((format) => usableNatureCount[format] === 0);
  if (unusableFormats.length > 0) {
    throw new ChampionsUsageDataError(
      `Champions usage bulk ZIP has no usable stat_alignment nature data for ${unusableFormats.join(", ")}`,
    );
  }
  return usageByFormat;
};

export const collectNatureUsageFromFiles = async ({
  apiData,
  catalogs,
  files,
  assetRoot = apiData?.assetRoot ?? DEFAULT_ASSET_ROOT,
  warn = emitWarning,
} = {}) => {
  const fileMap = files instanceof Map ? files : new Map(Object.entries(files ?? {}));
  const archiveEntries = validateArchiveEntries([...fileMap.keys()]);
  return collectNatureUsage({
    apiData,
    catalogs,
    archiveEntries,
    readFileForPath: async (archivePath) => {
      const value = fileMap.get(archivePath);
      if (value === undefined) throw new Error("file is not present in test archive");
      return value;
    },
    assetRoot,
    warn,
  });
};

export const writePayload = async (outputPath, payload) => {
  const absolutePath = resolve(projectRoot, outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
};

const getOption = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

export const run = async ({
  outputPath = process.env.CHAMPIONS_USAGE_OUTPUT ?? DEFAULT_OUTPUT_PATH,
  apiUrl = process.env.CHAMPIONS_USAGE_API_URL ?? API_URL,
  bulkZipUrl = process.env.CHAMPIONS_USAGE_BULK_URL ?? BULK_ZIP_URL,
  catalogDirectory = process.env.CHAMPIONS_USAGE_CATALOG_DIR ?? join(projectRoot, CATALOG_DIRECTORY),
  fetchImpl = globalThis.fetch,
  warn = emitWarning,
  extractBulkArchiveImpl = extractBulkArchive,
  zipBytes,
  execFileImpl,
} = {}) => {
  // Keep each upstream request exactly once per generation. They are
  // independent, so fetching in parallel also avoids holding the ZIP in a
  // temporary directory while waiting on the JSON response.
  const [apiData, resolvedZipBytes, catalogs] = await Promise.all([
    fetchApiData(apiUrl, fetchImpl),
    zipBytes ?? fetchBulkZip(bulkZipUrl, fetchImpl),
    loadCatalogs(catalogDirectory),
  ]);
  const extracted = await extractBulkArchiveImpl({
    zipBytes: resolvedZipBytes,
    apiData,
    assetRoot: apiData.assetRoot ?? DEFAULT_ASSET_ROOT,
    execFileImpl,
  });
  try {
    const natureUsageByFormat = await collectNatureUsage({
      apiData,
      catalogs,
      archiveEntries: extracted.archiveEntries,
      readFileForPath: extracted.readFileForPath,
      assetRoot: apiData.assetRoot ?? DEFAULT_ASSET_ROOT,
      warn,
    });
    const natureDigest = calculateNatureDigest(natureUsageByFormat);
    const payload = transformApiData(apiData, {
      catalogs,
      warn,
      natureUsageByFormat,
      natureDigest,
    });
    const absolutePath = await writePayload(outputPath, payload);
    return { absolutePath, payload, natureDigest };
  } finally {
    if (typeof extracted.cleanup === "function") await extracted.cleanup();
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const outputPath = getOption(args, "--output") ?? (args[0]?.startsWith("--") ? undefined : args[0]);
  const apiUrl = getOption(args, "--api-url");
  const bulkZipUrl = getOption(args, "--bulk-url");
  const validatePath = getOption(args, "--validate");
  try {
    if (validatePath) {
      const payload = validatePayload(JSON.parse(await readFile(resolve(projectRoot, validatePath), "utf8")));
      console.log(`[champions-usage] validated ${validatePath} (dataVersion=${payload.dataVersion})`);
    } else {
      const { absolutePath, payload } = await run({ outputPath, apiUrl, bulkZipUrl });
      console.log(`[champions-usage] wrote ${absolutePath} (dataVersion=${payload.dataVersion})`);
    }
  } catch (error) {
    console.error(`[champions-usage] ${error.message}`);
    process.exitCode = 1;
  }
}
