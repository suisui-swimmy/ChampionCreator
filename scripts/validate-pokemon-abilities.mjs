import { readFile } from "node:fs/promises";
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

const fail = (messages) => {
  for (const message of messages) {
    console.error(message);
  }
  process.exitCode = 1;
};

const pokemonOptions = await readJson("src/data/generated/pokemon-options.gen.json");
const abilityOptions = await readJson("src/data/generated/ability-options.gen.json");
const pokemonAbilities = await readJson("src/data/generated/pokemon-abilities.gen.json");
const pokeapiPokemon = await readCsv("others/pokeapi/data/v2/csv/pokemon.csv");
const pokeapiForms = await readCsv("others/pokeapi/data/v2/csv/pokemon_forms.csv");
const pokeapiAbilities = await readCsv("others/pokeapi/data/v2/csv/abilities.csv");
const pokeapiPokemonAbilities = await readCsv("others/pokeapi/data/v2/csv/pokemon_abilities.csv");

const errors = [];
const warnings = [];
const speciesData = SPECIES[9];
const abilityOptionIds = new Set(abilityOptions.entries.map((entry) => entry.id));
const pokemonOptionsById = new Map(pokemonOptions.entries.map((entry) => [entry.id, entry]));
const abilityEntriesByPokemonId = new Map();
const pokeapiAbilityById = new Map(pokeapiAbilities.map((entry) => [entry.id, entry]));
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

const toCalcExpectedAbilities = (pokemonOption) => (
  Array.from(new Set(Object.values(speciesData[pokemonOption.showdownName]?.abilities ?? {}).map((ability) => toID(ability))))
    .map((id, index) => ({
      id,
      slot: String(index),
      isHidden: false,
      source: "calc-fallback",
    }))
);

const toPokeapiExpectedAbilities = (pokemonId) => (
  (pokeapiAbilityRowsByPokemonId.get(pokemonId) ?? []).map((row) => {
    const pokeapiAbility = pokeapiAbilityById.get(row.ability_id);
    return {
      id: normalizeIdentifier(pokeapiAbility?.identifier ?? ""),
      slot: String(row.slot),
      isHidden: row.is_hidden === "1",
      source: "pokeapi",
    };
  })
);

const getExpectedAbilities = (pokemonOption) => {
  const calcAbilities = toCalcExpectedAbilities(pokemonOption);
  const pokeapiMatch = findPokeapiMatch(pokemonOption.showdownName);
  if (!pokeapiMatch) {
    warnings.push(`${pokemonOption.showdownName} has no PokeAPI match; validating calc fallback`);
    return calcAbilities;
  }

  const pokeapiAbilitiesForPokemon = toPokeapiExpectedAbilities(pokeapiMatch.pokemonId);
  if (pokeapiAbilitiesForPokemon.length === 0) {
    warnings.push(`${pokemonOption.showdownName} has no PokeAPI ability rows; validating calc fallback`);
    return calcAbilities;
  }

  const pokeapiAbilityIds = new Set(pokeapiAbilitiesForPokemon.map((ability) => ability.id));
  const compatibleWithCalc = calcAbilities.every((ability) => pokeapiAbilityIds.has(ability.id));
  if (!compatibleWithCalc) {
    warnings.push(`${pokemonOption.showdownName} PokeAPI abilities conflict with @smogon/calc; validating calc fallback`);
    return calcAbilities;
  }

  return pokeapiAbilitiesForPokemon;
};

if (pokemonAbilities.schemaVersion !== 1) {
  errors.push("pokemon-abilities.gen.json schemaVersion must be 1");
}

if (pokemonAbilities.kind !== "pokemon-abilities") {
  errors.push("pokemon-abilities.gen.json kind must be pokemon-abilities");
}

for (const entry of pokemonAbilities.entries ?? []) {
  const key = `pokemon:${entry.id}`;
  const pokemonOption = pokemonOptionsById.get(entry.id);
  if (!pokemonOption) {
    errors.push(`pokemon-abilities references missing pokemon option: ${key}`);
    continue;
  }

  if (abilityEntriesByPokemonId.has(entry.id)) {
    errors.push(`duplicate pokemon ability entry: ${key}`);
  }
  abilityEntriesByPokemonId.set(entry.id, entry);

  if (entry.showdownName !== pokemonOption.showdownName) {
    errors.push(`${key} showdownName mismatch: ${entry.showdownName} != ${pokemonOption.showdownName}`);
  }

  const species = speciesData[pokemonOption.showdownName];
  if (!species) {
    errors.push(`${key} missing @smogon/calc species data: ${pokemonOption.showdownName}`);
    continue;
  }

  const expectedAbilities = getExpectedAbilities(pokemonOption);
  const actualAbilityIds = (entry.abilities ?? []).map((ability) => ability.id);
  if (expectedAbilities.map((ability) => ability.id).join("|") !== actualAbilityIds.join("|")) {
    errors.push(`${key} ability list mismatch: ${actualAbilityIds.join(",")} != ${expectedAbilities.map((ability) => ability.id).join(",")}`);
  }

  for (const [index, ability] of (entry.abilities ?? []).entries()) {
    const expected = expectedAbilities[index];
    const abilityKey = `ability:${ability.id}`;
    for (const field of ["id", "label", "showdownName", "slot", "source"]) {
      if (typeof ability[field] !== "string" || ability[field].trim() === "") {
        errors.push(`${key} has ability with empty ${field}`);
      }
    }

    if (typeof ability.isHidden !== "boolean") {
      errors.push(`${key} ${abilityKey} isHidden must be boolean`);
    }

    if (expected && ability.slot !== expected.slot) {
      errors.push(`${key} ${abilityKey} slot mismatch: ${ability.slot} != ${expected.slot}`);
    }
    if (expected && ability.isHidden !== expected.isHidden) {
      errors.push(`${key} ${abilityKey} isHidden mismatch: ${ability.isHidden} != ${expected.isHidden}`);
    }
    if (expected && ability.source !== expected.source) {
      errors.push(`${key} ${abilityKey} source mismatch: ${ability.source} != ${expected.source}`);
    }

    if (!abilityOptionIds.has(ability.id)) {
      if (ability.fallback?.reason) {
        warnings.push(`${key} uses fallback label for missing ${abilityKey}`);
      } else {
        errors.push(`${key} references missing ability option: ${abilityKey}`);
      }
    }
  }
}

for (const pokemonOption of pokemonOptions.entries ?? []) {
  if (!abilityEntriesByPokemonId.has(pokemonOption.id)) {
    errors.push(`missing pokemon ability entry for pokemon:${pokemonOption.id}`);
  }
}

console.log(`Validated ${abilityEntriesByPokemonId.size} pokemon ability entries.`);
if (warnings.length > 0) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 12)) {
    console.log(`- ${warning}`);
  }
}

if (errors.length > 0) {
  fail(errors);
}
