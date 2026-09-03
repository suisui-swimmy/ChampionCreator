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

const fail = (messages) => {
  for (const message of messages) {
    console.error(message);
  }
  process.exitCode = 1;
};

const pokemonOptions = await readJson("src/data/generated/pokemon-options.gen.json");
const abilityOptions = await readJson("src/data/generated/ability-options.gen.json");
const pokemonAbilities = await readJson("src/data/generated/pokemon-abilities.gen.json");
const calcPackage = await readJson("node_modules/@smogon/calc/package.json");
const pokeapiPokemon = await readCsv("others/pokeapi/data/v2/csv/pokemon.csv");
const pokeapiForms = await readCsv("others/pokeapi/data/v2/csv/pokemon_forms.csv");
const pokeapiAbilities = await readCsv("others/pokeapi/data/v2/csv/abilities.csv");
const pokeapiPokemonAbilities = await readCsv("others/pokeapi/data/v2/csv/pokemon_abilities.csv");

const errors = [];
const warnings = [];
const speciesData = SPECIES[9];
const abilityOptionIds = new Set(abilityOptions.entries.map((entry) => entry.id));
const missingAbilityOptionIds = new Set();
const pokemonOptionsById = new Map(pokemonOptions.entries.map((entry) => [entry.id, entry]));
const abilityEntriesByPokemonId = new Map();
const validSources = new Set(["pokeapi", "calc-fallback"]);
const pokeapiAbilityIdByNumericId = new Map(
  pokeapiAbilities.map((entry) => [entry.id, toID(entry.identifier)]),
);
const pokeapiAbilityRowsByPokemonId = new Map();
for (const row of pokeapiPokemonAbilities) {
  const rows = pokeapiAbilityRowsByPokemonId.get(row.pokemon_id) ?? [];
  rows.push(row);
  pokeapiAbilityRowsByPokemonId.set(row.pokemon_id, rows);
}
const pokeapiMatchByIdentifier = new Map();
for (const entry of pokeapiPokemon) {
  pokeapiMatchByIdentifier.set(toID(entry.identifier), { pokemonId: entry.id, identifier: entry.identifier });
}
for (const entry of pokeapiForms) {
  const identifier = toID(entry.identifier);
  if (!pokeapiMatchByIdentifier.has(identifier)) {
    pokeapiMatchByIdentifier.set(identifier, { pokemonId: entry.pokemon_id, identifier: entry.identifier });
  }
}
const defaultPokeapiPokemon = pokeapiPokemon
  .filter((entry) => entry.is_default === "1")
  .map((entry) => ({
    pokemonId: entry.id,
    identifier: entry.identifier,
    normalized: toID(entry.identifier),
  }));

const findUniqueDefaultPokeapiPokemon = (showdownName) => {
  const normalized = toID(showdownName);
  const matches = defaultPokeapiPokemon.filter((candidate) => candidate.normalized.startsWith(normalized));
  const uniqueByPokemonId = new Map(matches.map((candidate) => [candidate.pokemonId, candidate]));
  return uniqueByPokemonId.size === 1
    ? Array.from(uniqueByPokemonId.values())[0]
    : undefined;
};

const getPokeapiAbilityIds = (pokemonId) => (
  (pokeapiAbilityRowsByPokemonId.get(pokemonId) ?? [])
    .slice()
    .sort((a, b) => Number(a.slot) - Number(b.slot))
    .map((row) => pokeapiAbilityIdByNumericId.get(row.ability_id))
    .filter(Boolean)
);

const calcExpectedAbilities = (pokemonOption) => (
  Object.entries(speciesData[pokemonOption.showdownName]?.abilities ?? {}).flatMap(([slot, showdownName]) => {
    const id = toID(showdownName);
    return id ? [{ id, slot: String(slot) }] : [];
  })
);

if (pokemonAbilities.schemaVersion !== 1) {
  errors.push("pokemon-abilities.gen.json schemaVersion must be 1");
}

if (pokemonAbilities.kind !== "pokemon-abilities") {
  errors.push("pokemon-abilities.gen.json kind must be pokemon-abilities");
}

const expectedDataVersion = pokemonOptions.dataVersion ?? `calc-${calcPackage.version}-gen9`;
if (pokemonAbilities.dataVersion !== expectedDataVersion) {
  errors.push(`pokemon-abilities.gen.json dataVersion mismatch: ${pokemonAbilities.dataVersion} != ${expectedDataVersion}`);
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

  if (!Array.isArray(entry.abilities) || entry.abilities.length === 0) {
    errors.push(`${key} must have at least one ability`);
    continue;
  }

  const seenAbilityIds = new Set();
  for (const ability of entry.abilities) {
    const abilityKey = `ability:${ability.id}`;
    for (const field of ["id", "label", "showdownName", "slot", "source"]) {
      if (typeof ability[field] !== "string" || ability[field].trim() === "") {
        errors.push(`${key} has ability with empty ${field}`);
      }
    }

    if (seenAbilityIds.has(ability.id)) {
      errors.push(`${key} has duplicate ${abilityKey}`);
    }
    seenAbilityIds.add(ability.id);

    if (typeof ability.isHidden !== "boolean") {
      errors.push(`${key} ${abilityKey} isHidden must be boolean`);
    }

    if (!validSources.has(ability.source)) {
      errors.push(`${key} ${abilityKey} has invalid source: ${ability.source}`);
    }

    if (ability.source === "calc-fallback" && !ability.fallback?.reason) {
      errors.push(`${key} ${abilityKey} calc-fallback must include fallback.reason`);
    }

    if (ability.source === "pokeapi" && ability.fallback && ability.fallback.reason !== "pokeapi-form-match") {
      errors.push(`${key} ${abilityKey} has invalid PokeAPI fallback reason: ${ability.fallback.reason}`);
    }

    if (!abilityOptionIds.has(ability.id)) {
      missingAbilityOptionIds.add(ability.id);
      if (ability.fallback?.reason) {
        warnings.push(`${key} uses fallback label for missing ${abilityKey}`);
      } else {
        errors.push(`${key} references missing ability option: ${abilityKey}`);
      }
    }
  }

  const expectedCalcAbilities = calcExpectedAbilities(pokemonOption);
  const actualAbilityIds = new Set(entry.abilities.map((ability) => ability.id));
  for (const expected of expectedCalcAbilities) {
    if (!actualAbilityIds.has(expected.id)) {
      errors.push(`${key} is missing @smogon/calc ability: ability:${expected.id}`);
    }
  }

  const usesOnlyCalcFallback = entry.abilities.every((ability) => ability.source === "calc-fallback");
  if (usesOnlyCalcFallback) {
    const actualSignature = entry.abilities.map((ability) => `${ability.id}:${ability.slot}`).join("|");
    const expectedSignature = expectedCalcAbilities.map((ability) => `${ability.id}:${ability.slot}`).join("|");
    if (actualSignature !== expectedSignature) {
      errors.push(`${key} calc fallback mismatch: ${actualSignature} != ${expectedSignature}`);
    }
    if (entry.abilities.some((ability) => ability.fallback?.reason === "missing-pokeapi-match")) {
      const defaultPokeapiMatch = findUniqueDefaultPokeapiPokemon(entry.showdownName);
      if (defaultPokeapiMatch) {
        errors.push(
          `${key} should use PokeAPI species default ${defaultPokeapiMatch.identifier} instead of calc fallback`,
        );
      }
    }
    if (pokemonOption.fallback?.reason === "same-form-family" && pokemonOption.fallback.from) {
      const formFamilyMatch = pokeapiMatchByIdentifier.get(toID(pokemonOption.fallback.from));
      if (formFamilyMatch) {
        const pokeapiAbilityIds = getPokeapiAbilityIds(formFamilyMatch.pokemonId);
        const containsCalcAbilities = expectedCalcAbilities.every(({ id }) => pokeapiAbilityIds.includes(id));
        if (containsCalcAbilities && pokeapiAbilityIds.length > 0) {
          errors.push(
            `${key} should use PokeAPI form-family match ${formFamilyMatch.identifier} instead of calc fallback`,
          );
        }
      }
    }
    warnings.push(`${entry.showdownName} uses @smogon/calc fallback abilities`);
  }
}

for (const pokemonOption of pokemonOptions.entries ?? []) {
  if (!abilityEntriesByPokemonId.has(pokemonOption.id)) {
    errors.push(`missing pokemon ability entry for pokemon:${pokemonOption.id}`);
  }
}

const entries = pokemonAbilities.entries ?? [];
const abilities = entries.flatMap((entry) => entry.abilities ?? []);
const calculatedSummary = {
  totalPokemon: entries.length,
  withAbilities: entries.filter((entry) => (entry.abilities ?? []).length > 0).length,
  totalAbilityRefs: abilities.length,
  uniqueAbilities: new Set(abilities.map((ability) => ability.id)).size,
  multiAbilityPokemon: entries.filter((entry) => (entry.abilities ?? []).length > 1).length,
  hiddenAbilityRefs: abilities.filter((ability) => ability.isHidden).length,
  pokeapiMatchedPokemon: entries.filter((entry) => (
    (entry.abilities ?? []).some((ability) => ability.source === "pokeapi")
  )).length,
  calcFallbackPokemon: entries.filter((entry) => (
    (entry.abilities ?? []).some((ability) => ability.source === "calc-fallback")
  )).length,
  pokeapiConflictFallbackPokemon: entries.filter((entry) => (
    (entry.abilities ?? []).some((ability) => ability.fallback?.reason === "pokeapi-conflicts-with-calc")
  )).length,
  missingAbilityOptions: missingAbilityOptionIds.size,
};

for (const [field, value] of Object.entries(calculatedSummary)) {
  if (pokemonAbilities.summary?.[field] !== value) {
    errors.push(`pokemon-abilities summary.${field} mismatch: ${pokemonAbilities.summary?.[field]} != ${value}`);
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
