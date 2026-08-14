import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const API_URL = "https://championsbattledata.com/api";
export const DEFAULT_OUTPUT_PATH = "public/data/champions-usage-current.json";
export const CATALOG_DIRECTORY = "src/data/generated";
export const FORMATS = ["Singles", "Doubles"];
export const CATEGORIES = ["move", "ability", "item"];
export const EMPTY_SOURCE_GENERATED_AT = "1970-01-01T00:00:00.000Z";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

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
    const names = [entry.id, entry.showdownName, entry.name];
    for (const name of names) {
      if (typeof name !== "string" || name.trim() === "") continue;
      const id = toID(name);
      if (id && !byName.has(id)) byName.set(id, canonicalName);
    }
  }
  return byName;
};

export const makeCatalogs = ({ moves, abilities, items, pokemon }) => ({
  move: makeCanonicalMap(moves),
  ability: makeCanonicalMap(abilities),
  item: makeCanonicalMap(items),
  pokemon: makeCanonicalMap(pokemon, { useEntryId: true }),
});

export const loadCatalogs = async (catalogDirectory = join(projectRoot, CATALOG_DIRECTORY)) => {
  const [moves, abilities, items, pokemon] = await Promise.all([
    readJson(join(catalogDirectory, "move-options.gen.json")),
    readJson(join(catalogDirectory, "ability-options.gen.json")),
    readJson(join(catalogDirectory, "item-options.gen.json")),
    readJson(join(catalogDirectory, "pokemon-options.gen.json")),
  ]);
  return makeCatalogs({ moves, abilities, items, pokemon });
};

const getFormatValues = (entry, format) => entry?.summary?.battleSummary?.Current?.[format]?.values ?? {};

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

export const transformApiData = (apiData, { catalogs, warn = emitWarning } = {}) => {
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
      for (const target of targets) {
        formats[format][target] = {
          move: [...rankingsByFormat[format].move],
          ability: [...rankingsByFormat[format].ability],
          item: [...rankingsByFormat[format].item],
        };
      }
    }
  }

  if (FORMATS.some((format) => usableValues[format] === 0)) {
    throw new ChampionsUsageDataError("Champions usage API response has no usable move, ability, or item data for every Current format");
  }

  return validatePayload({
    schemaVersion: 1,
    dataVersion: apiData.dataVersion,
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
  catalogDirectory = process.env.CHAMPIONS_USAGE_CATALOG_DIR ?? join(projectRoot, CATALOG_DIRECTORY),
  fetchImpl = globalThis.fetch,
  warn = emitWarning,
} = {}) => {
  const apiData = await fetchApiData(apiUrl, fetchImpl);
  const catalogs = await loadCatalogs(catalogDirectory);
  const payload = transformApiData(apiData, { catalogs, warn });
  const absolutePath = await writePayload(outputPath, payload);
  return { absolutePath, payload };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const outputPath = getOption(args, "--output") ?? (args[0]?.startsWith("--") ? undefined : args[0]);
  const apiUrl = getOption(args, "--api-url");
  const validatePath = getOption(args, "--validate");
  try {
    if (validatePath) {
      const payload = validatePayload(JSON.parse(await readFile(resolve(projectRoot, validatePath), "utf8")));
      console.log(`[champions-usage] validated ${validatePath} (dataVersion=${payload.dataVersion})`);
    } else {
      const { absolutePath, payload } = await run({ outputPath, apiUrl });
      console.log(`[champions-usage] wrote ${absolutePath} (dataVersion=${payload.dataVersion})`);
    }
  } catch (error) {
    console.error(`[champions-usage] ${error.message}`);
    process.exitCode = 1;
  }
}
