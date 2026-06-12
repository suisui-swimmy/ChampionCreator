import { readFile, writeFile } from "node:fs/promises";
import { Generations } from "@smogon/calc";

const MOVE_OPTIONS_PATH = "src/data/generated/move-options.gen.json";
const POKEAPI_MOVE_META_PATH = "others/pokeapi/data/v2/csv/move_meta.csv";
const POKEAPI_MOVE_NAMES_PATH = "others/pokeapi/data/v2/csv/move_names.csv";

const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (quoted && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
};

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const readCsv = async (path) => {
  const [headerLine, ...lines] = (await readFile(path, "utf8")).trim().split(/\r?\n/);
  const header = parseCsvLine(headerLine);
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]));
  });
};

const parsePositiveInt = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const toHitRange = (multihit) => {
  if (typeof multihit === "number") {
    return { minHits: multihit, maxHits: multihit };
  }
  if (Array.isArray(multihit) && multihit.length === 2) {
    const [minHits, maxHits] = multihit;
    if (Number.isInteger(minHits) && Number.isInteger(maxHits)) {
      return { minHits, maxHits };
    }
  }
  return null;
};

const buildPokeApiHitRanges = async () => {
  const moveMetaRows = await readCsv(POKEAPI_MOVE_META_PATH);
  const moveNameRows = await readCsv(POKEAPI_MOVE_NAMES_PATH);
  const englishNamesByMoveId = new Map(
    moveNameRows
      .filter((row) => row.local_language_id === "9")
      .map((row) => [row.move_id, row.name]),
  );
  const ranges = new Map();

  for (const row of moveMetaRows) {
    const minHits = parsePositiveInt(row.min_hits);
    const maxHits = parsePositiveInt(row.max_hits);
    const englishName = englishNamesByMoveId.get(row.move_id);
    if (!englishName || !minHits || !maxHits) {
      continue;
    }
    ranges.set(normalizeName(englishName), { minHits, maxHits });
  }

  return ranges;
};

const moveOptions = await readJson(MOVE_OPTIONS_PATH);
const pokeApiHitRanges = await buildPokeApiHitRanges();
const gen = Generations.get(9);

let annotated = 0;
let fromSmogon = 0;
let fromPokeApi = 0;

const entries = moveOptions.entries.map((entry) => {
  const smogonRange = toHitRange(gen.moves.get(entry.id)?.multihit);
  const pokeApiRange = pokeApiHitRanges.get(normalizeName(entry.showdownName));
  const hitRange = smogonRange ?? pokeApiRange ?? null;
  const nextEntry = { ...entry };

  delete nextEntry.minHits;
  delete nextEntry.maxHits;

  if (hitRange && hitRange.maxHits > 1) {
    annotated += 1;
    if (smogonRange) {
      fromSmogon += 1;
    } else {
      fromPokeApi += 1;
    }
    nextEntry.minHits = hitRange.minHits;
    nextEntry.maxHits = hitRange.maxHits;
  }

  return nextEntry;
});

const nextPayload = {
  ...moveOptions,
  source: {
    ...moveOptions.source,
    moveHitCounts: {
      primary: "@smogon/calc gen9 move.multihit",
      fallback: `${POKEAPI_MOVE_META_PATH} + ${POKEAPI_MOVE_NAMES_PATH}`,
    },
  },
  entries,
  summary: {
    ...moveOptions.summary,
    multiHitOptions: annotated,
    multiHitOptionsFromSmogon: fromSmogon,
    multiHitOptionsFromPokeApi: fromPokeApi,
  },
};

await writeFile(MOVE_OPTIONS_PATH, `${JSON.stringify(nextPayload)}\n`);

console.log(
  `Annotated ${annotated} multi-hit moves (${fromSmogon} from @smogon/calc, ${fromPokeApi} from PokeAPI fallback).`,
);
