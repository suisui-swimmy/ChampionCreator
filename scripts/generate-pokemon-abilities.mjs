import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SPECIES, toID } from "@smogon/calc";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const readText = async (path) => readFile(path, "utf8");

const parseCsvLine = (line) => {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      quoted = !quoted;
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

const readCsv = async (path) => {
  const rows = (await readText(path)).trim().split(/\r?\n/);
  const headers = parseCsvLine(rows.shift() ?? "");
  return rows
    .filter(Boolean)
    .map((line) => Object.fromEntries(parseCsvLine(line).map((value, index) => [headers[index], value])));
};

const normalizeIdentifier = (value) => toID(value);

const calcPackage = await readJson("node_modules/@smogon/calc/package.json");
const pokemonOptions = await readJson("src/data/generated/pokemon-options.gen.json");
const abilityOptions = await readJson("src/data/generated/ability-options.gen.json");
const pokeapiPokemon = await readCsv("others/pokeapi/data/v2/csv/pokemon.csv");
const pokeapiForms = await readCsv("others/pokeapi/data/v2/csv/pokemon_forms.csv");
const pokeapiAbilities = await readCsv("others/pokeapi/data/v2/csv/abilities.csv");
const pokeapiPokemonAbilities = await readCsv("others/pokeapi/data/v2/csv/pokemon_abilities.csv");

const speciesData = SPECIES[9];
const abilityOptionsById = new Map(abilityOptions.entries.map((entry) => [entry.id, entry]));
const pokeapiAbilityById = new Map(pokeapiAbilities.map((entry) => [entry.id, entry]));
const missingAbilityOptions = new Map();
const calcFallbackPokemon = new Set();
const pokeapiConflictFallbackPokemon = new Set();

const pokeapiPokemonById = new Map(pokeapiPokemon.map((entry) => [entry.id, entry]));
const pokeapiAbilityRowsByPokemonId = new Map();
for (const row of pokeapiPokemonAbilities) {
  const rows = pokeapiAbilityRowsByPokemonId.get(row.pokemon_id) ?? [];
  rows.push(row);
  pokeapiAbilityRowsByPokemonId.set(row.pokemon_id, rows);
}

const pokeapiMatchesByIdentifier = new Map();
const addPokeapiMatch = (identifier, pokemonId, source) => {
  const normalized = normalizeIdentifier(identifier);
  if (normalized && !pokeapiMatchesByIdentifier.has(normalized)) {
    pokeapiMatchesByIdentifier.set(normalized, { pokemonId, identifier, source });
  }
};

for (const pokemon of pokeapiPokemon) {
  addPokeapiMatch(pokemon.identifier, pokemon.id, "pokeapi-pokemon");
}
for (const form of pokeapiForms) {
  addPokeapiMatch(form.identifier, form.pokemon_id, "pokeapi-form");
}

const pokeapiCandidates = [
  ...pokeapiPokemon.map((entry) => ({
    pokemonId: entry.id,
    identifier: entry.identifier,
    normalized: normalizeIdentifier(entry.identifier),
    isDefault: entry.is_default === "1",
    source: "pokeapi-pokemon",
  })),
  ...pokeapiForms.map((entry) => ({
    pokemonId: entry.pokemon_id,
    identifier: entry.identifier,
    normalized: normalizeIdentifier(entry.identifier),
    isDefault: entry.is_default === "1",
    source: "pokeapi-form",
  })),
];

const findPokeapiMatch = (showdownName) => {
  const normalized = normalizeIdentifier(showdownName);
  const exactMatch = pokeapiMatchesByIdentifier.get(normalized);
  if (exactMatch) {
    return exactMatch;
  }

  const genderExpanded = normalized.endsWith("f")
    ? `${normalized.slice(0, -1)}female`
    : normalized.endsWith("m")
      ? `${normalized.slice(0, -1)}male`
      : undefined;
  if (genderExpanded) {
    const genderMatch = pokeapiMatchesByIdentifier.get(genderExpanded);
    if (genderMatch) {
      return genderMatch;
    }
  }

  const prefixMatches = pokeapiCandidates.filter((candidate) => (
    candidate.normalized.startsWith(normalized)
    && (candidate.isDefault || candidate.source === "pokeapi-form")
  ));
  const uniqueByPokemonId = new Map(prefixMatches.map((candidate) => [candidate.pokemonId, candidate]));
  if (uniqueByPokemonId.size === 1) {
    return Array.from(uniqueByPokemonId.values())[0];
  }

  return undefined;
};

const toAbilityOptionEntry = ({ abilityId, showdownName, slot, isHidden, source, fallback }) => {
  const id = toID(abilityId);
  const abilityOption = abilityOptionsById.get(id);
  if (!abilityOption) {
    missingAbilityOptions.set(id, showdownName);
    return {
      id,
      showdownName,
      label: showdownName,
      slot: String(slot),
      isHidden: Boolean(isHidden),
      source,
      fallback: fallback ?? { reason: "missing-ability-option" },
    };
  }

  return {
    id,
    showdownName: abilityOption.showdownName,
    label: abilityOption.label,
    slot: String(slot),
    isHidden: Boolean(isHidden),
    source,
    ...(fallback ? { fallback } : {}),
  };
};

const toCalcAbilityEntries = (pokemonOption, fallbackReason = "missing-pokeapi-match") => {
  const species = speciesData[pokemonOption.showdownName];
  if (!species) {
    throw new Error(`Missing @smogon/calc species data for ${pokemonOption.showdownName}`);
  }

  calcFallbackPokemon.add(pokemonOption.id);
  const seenAbilityIds = new Set();
  return Object.entries(species.abilities ?? []).flatMap(([slot, showdownName]) => {
    const id = toID(showdownName);
    if (seenAbilityIds.has(id)) {
      return [];
    }
    seenAbilityIds.add(id);

    return [toAbilityOptionEntry({
      abilityId: id,
      showdownName,
      slot,
      isHidden: false,
      source: "calc-fallback",
      fallback: {
        reason: fallbackReason,
      },
    })];
  });
};

const toPokeapiAbilityEntries = (pokemonOption) => {
  const pokeapiMatch = findPokeapiMatch(pokemonOption.showdownName);
  if (!pokeapiMatch) {
    return toCalcAbilityEntries(pokemonOption);
  }

  const rows = pokeapiAbilityRowsByPokemonId.get(pokeapiMatch.pokemonId) ?? [];
  if (rows.length === 0) {
    return toCalcAbilityEntries(pokemonOption, "missing-pokeapi-ability-rows");
  }

  const pokeapiAbilityEntries = rows.map((row) => {
    const pokeapiAbility = pokeapiAbilityById.get(row.ability_id);
    if (!pokeapiAbility) {
      throw new Error(`Missing PokeAPI ability ${row.ability_id} for ${pokemonOption.showdownName}`);
    }

    return toAbilityOptionEntry({
      abilityId: normalizeIdentifier(pokeapiAbility.identifier),
      showdownName: pokeapiAbility.identifier,
      slot: row.slot,
      isHidden: row.is_hidden === "1",
      source: "pokeapi",
      fallback: pokeapiMatch.source === "pokeapi-form"
        ? {
          reason: "pokeapi-form-match",
          from: pokeapiMatch.identifier,
        }
        : undefined,
    });
  });

  const calcAbilityIds = new Set(Object.values(speciesData[pokemonOption.showdownName]?.abilities ?? {}).map(toID));
  const pokeapiAbilityIds = new Set(pokeapiAbilityEntries.map((ability) => ability.id));
  const isCompatibleWithCalc = Array.from(calcAbilityIds).every((id) => pokeapiAbilityIds.has(id));
  if (!isCompatibleWithCalc) {
    pokeapiConflictFallbackPokemon.add(pokemonOption.id);
    return toCalcAbilityEntries(pokemonOption, "pokeapi-conflicts-with-calc");
  }

  return pokeapiAbilityEntries;
};

const entries = pokemonOptions.entries.map((pokemonOption) => ({
  id: pokemonOption.id,
  showdownName: pokemonOption.showdownName,
  abilities: toPokeapiAbilityEntries(pokemonOption),
}));

const totalAbilityRefs = entries.reduce((total, entry) => total + entry.abilities.length, 0);
const uniqueAbilityIds = new Set(entries.flatMap((entry) => entry.abilities.map((ability) => ability.id)));
const pokeapiMatchedPokemon = entries.filter((entry) => entry.abilities.some((ability) => ability.source === "pokeapi")).length;
const hiddenAbilityRefs = entries.reduce(
  (total, entry) => total + entry.abilities.filter((ability) => ability.isHidden).length,
  0,
);
const multiAbilityPokemon = entries.filter((entry) => entry.abilities.length > 1).length;

const payload = {
  schemaVersion: 1,
  dataVersion: pokemonOptions.dataVersion ?? `calc-${calcPackage.version}-gen9`,
  source: {
    speciesData: "@smogon/calc SPECIES[9]",
    calcPackageVersion: calcPackage.version,
    pokemonOptions: "src/data/generated/pokemon-options.gen.json",
    abilityOptions: "src/data/generated/ability-options.gen.json",
    pokeapiPokemon: "others/pokeapi/data/v2/csv/pokemon.csv",
    pokeapiForms: "others/pokeapi/data/v2/csv/pokemon_forms.csv",
    pokeapiAbilities: "others/pokeapi/data/v2/csv/abilities.csv",
    pokeapiPokemonAbilities: "others/pokeapi/data/v2/csv/pokemon_abilities.csv",
  },
  generatedBy: "scripts/generate-pokemon-abilities.mjs",
  kind: "pokemon-abilities",
  entries,
  summary: {
    totalPokemon: entries.length,
    withAbilities: entries.filter((entry) => entry.abilities.length > 0).length,
    totalAbilityRefs,
    uniqueAbilities: uniqueAbilityIds.size,
    multiAbilityPokemon,
    hiddenAbilityRefs,
    pokeapiMatchedPokemon,
    calcFallbackPokemon: calcFallbackPokemon.size,
    pokeapiConflictFallbackPokemon: pokeapiConflictFallbackPokemon.size,
    missingAbilityOptions: missingAbilityOptions.size,
  },
};

await mkdir("src/data/generated", { recursive: true });
await writeFile("src/data/generated/pokemon-abilities.gen.json", `${JSON.stringify(payload)}\n`);

console.log(`Wrote ${entries.length} pokemon ability entries.`);
console.log(`PokeAPI matched ${pokeapiMatchedPokemon} pokemon, calc fallback ${calcFallbackPokemon.size}, multi-ability ${multiAbilityPokemon}.`);
if (pokeapiConflictFallbackPokemon.size > 0) {
  console.warn(`Warnings: ${pokeapiConflictFallbackPokemon.size} PokeAPI matches conflicted with @smogon/calc and used calc fallback.`);
}
if (missingAbilityOptions.size > 0) {
  console.warn(`Warnings: ${missingAbilityOptions.size} abilities were not found in ability-options.gen.json.`);
  for (const [id, showdownName] of missingAbilityOptions) {
    console.warn(`- ${id}: ${showdownName}`);
  }
}
