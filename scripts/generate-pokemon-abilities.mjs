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
const megaAbilityManifest = await readJson("src/data/overrides/mega-ability-manifest.json");
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
const megaOverridePokemon = new Set();
const megaUnconfirmedPokemon = new Set();

const isMegaShowdownName = (showdownName) => /-Mega(?:-[XYZ])?$/u.test(showdownName);
const megaAbilityManifestEntries = megaAbilityManifest.entries ?? [];
const megaAbilityManifestByShowdownName = new Map();
if (megaAbilityManifest.schemaVersion !== 1 || megaAbilityManifest.kind !== "mega-ability-manifest") {
  throw new Error("mega-ability-manifest must use schemaVersion 1 and kind mega-ability-manifest");
}
for (const entry of megaAbilityManifestEntries) {
  if (!entry || typeof entry.showdownName !== "string" || !isMegaShowdownName(entry.showdownName)) {
    throw new Error(`Invalid Mega ability manifest entry: ${JSON.stringify(entry)}`);
  }
  if (megaAbilityManifestByShowdownName.has(entry.showdownName)) {
    throw new Error(`Duplicate Mega ability manifest entry: ${entry.showdownName}`);
  }
  if (entry.status !== "confirmed" && entry.status !== "unconfirmed") {
    throw new Error(`Invalid Mega ability manifest status for ${entry.showdownName}: ${entry.status}`);
  }
  if (entry.status === "confirmed" && (typeof entry.ability !== "string" || entry.ability.trim() === "")) {
    throw new Error(`Confirmed Mega ability manifest entry must have an ability: ${entry.showdownName}`);
  }
  if (entry.status === "unconfirmed" && entry.ability !== null) {
    throw new Error(`Unconfirmed Mega ability manifest entry must have a null ability: ${entry.showdownName}`);
  }
  megaAbilityManifestByShowdownName.set(entry.showdownName, entry);
}

const megaPokemonOptions = pokemonOptions.entries.filter((entry) => isMegaShowdownName(entry.showdownName));
if (megaAbilityManifestEntries.length !== megaPokemonOptions.length) {
  throw new Error(
    `Mega ability manifest must cover ${megaPokemonOptions.length} forms: ${megaAbilityManifestEntries.length} entries provided`,
  );
}
for (const pokemonOption of megaPokemonOptions) {
  if (!megaAbilityManifestByShowdownName.has(pokemonOption.showdownName)) {
    throw new Error(`Mega ability manifest is missing ${pokemonOption.showdownName}`);
  }
}

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

const explicitPokeapiIdentifierByPokemonOptionId = new Map([
  ["maushold", "maushold-family-of-three"],
  ["mausholdfour", "maushold-family-of-four"],
]);

const findUniquePokemonMatch = (matches) => {
  const uniqueByPokemonId = new Map(matches.map((candidate) => [candidate.pokemonId, candidate]));
  return uniqueByPokemonId.size === 1
    ? Array.from(uniqueByPokemonId.values())[0]
    : undefined;
};

const findUniqueDefaultPokeapiPokemon = (showdownName) => {
  const normalized = normalizeIdentifier(showdownName);
  return findUniquePokemonMatch(pokeapiCandidates.filter((candidate) => (
    candidate.source === "pokeapi-pokemon"
    && candidate.isDefault
    && candidate.normalized.startsWith(normalized)
  )));
};

const getPokeapiAbilityIds = (pokemonId) => (
  (pokeapiAbilityRowsByPokemonId.get(pokemonId) ?? [])
    .slice()
    .sort((a, b) => Number(a.slot) - Number(b.slot))
    .map((row) => pokeapiAbilityById.get(row.ability_id))
    .filter(Boolean)
    .map((ability) => normalizeIdentifier(ability.identifier))
);

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
  const uniquePrefixMatch = findUniquePokemonMatch(prefixMatches);
  if (uniquePrefixMatch) {
    return uniquePrefixMatch;
  }

  const uniqueSpeciesDefaultMatch = findUniquePokemonMatch(prefixMatches.filter((candidate) => (
    candidate.source === "pokeapi-pokemon" && candidate.isDefault
  )));
  if (uniqueSpeciesDefaultMatch) {
    return uniqueSpeciesDefaultMatch;
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

const toMegaOverrideAbilityEntries = (pokemonOption, manifestEntry) => {
  const abilityId = toID(manifestEntry.ability);
  const abilityOption = abilityOptionsById.get(abilityId);
  if (!abilityOption) {
    throw new Error(
      `Mega ability manifest references missing ability option ${manifestEntry.ability} for ${pokemonOption.showdownName}`,
    );
  }

  megaOverridePokemon.add(pokemonOption.id);
  return [{
    id: abilityId,
    showdownName: abilityOption.showdownName,
    label: abilityOption.label,
    slot: "1",
    isHidden: false,
    source: "mega-override",
    override: {
      manifest: "src/data/overrides/mega-ability-manifest.json",
      dataVersion: megaAbilityManifest.dataVersion,
      status: "confirmed",
    },
  }];
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
  const explicitPokeapiIdentifier = explicitPokeapiIdentifierByPokemonOptionId.get(pokemonOption.id);
  const formFamilyPokeapiIdentifier = pokemonOption.fallback?.reason === "same-form-family"
    ? pokemonOption.fallback.from
    : undefined;
  const canonicalPokeapiMatch = findPokeapiMatch(pokemonOption.showdownName);
  const preferredPokeapiIdentifier = explicitPokeapiIdentifier
    ?? (canonicalPokeapiMatch ? undefined : formFamilyPokeapiIdentifier);
  const pokeapiMatch = preferredPokeapiIdentifier
    ? pokeapiMatchesByIdentifier.get(normalizeIdentifier(preferredPokeapiIdentifier))
    : canonicalPokeapiMatch;
  if (preferredPokeapiIdentifier && !pokeapiMatch) {
    throw new Error(`Missing preferred PokeAPI match ${preferredPokeapiIdentifier} for ${pokemonOption.showdownName}`);
  }
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

// Source-level assertions stay with generation so CI validation does not depend on local-only others/ CSVs.
const assertPokeapiSourceSelection = (pokemonOption, abilities) => {
  if (!abilities.every((ability) => ability.source === "calc-fallback")) {
    return;
  }

  if (abilities.some((ability) => ability.fallback?.reason === "missing-pokeapi-match")) {
    const defaultPokeapiMatch = findUniqueDefaultPokeapiPokemon(pokemonOption.showdownName);
    if (defaultPokeapiMatch) {
      throw new Error(
        `${pokemonOption.showdownName} should use PokeAPI species default ${defaultPokeapiMatch.identifier} instead of calc fallback`,
      );
    }
  }

  if (pokemonOption.fallback?.reason !== "same-form-family" || !pokemonOption.fallback.from) {
    return;
  }

  const formFamilyMatch = pokeapiMatchesByIdentifier.get(normalizeIdentifier(pokemonOption.fallback.from));
  if (!formFamilyMatch) {
    return;
  }

  const pokeapiAbilityIds = getPokeapiAbilityIds(formFamilyMatch.pokemonId);
  const calcAbilityIds = Object.values(speciesData[pokemonOption.showdownName]?.abilities ?? {}).map(toID);
  const containsCalcAbilities = calcAbilityIds.every((id) => pokeapiAbilityIds.includes(id));
  if (containsCalcAbilities && pokeapiAbilityIds.length > 0) {
    throw new Error(
      `${pokemonOption.showdownName} should use PokeAPI form-family match ${formFamilyMatch.identifier} instead of calc fallback`,
    );
  }
};

const entries = pokemonOptions.entries.map((pokemonOption) => {
  const manifestEntry = megaAbilityManifestByShowdownName.get(pokemonOption.showdownName);
  const abilities = manifestEntry?.status === "confirmed"
    ? toMegaOverrideAbilityEntries(pokemonOption, manifestEntry)
    : toPokeapiAbilityEntries(pokemonOption);
  if (manifestEntry?.status === "unconfirmed") {
    megaUnconfirmedPokemon.add(pokemonOption.id);
    if (!abilities.every((ability) => ability.source === "calc-fallback")) {
      throw new Error(`Unconfirmed Mega ability must remain Calc fallback: ${pokemonOption.showdownName}`);
    }
  }
  assertPokeapiSourceSelection(pokemonOption, abilities);
  return {
    id: pokemonOption.id,
    showdownName: pokemonOption.showdownName,
    abilities,
  };
});

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
    upstreamCommit: pokemonOptions.source?.upstreamCommit,
    compatibilityPatchId: pokemonOptions.source?.compatibilityPatchId,
    compatibilityManifest: pokemonOptions.source?.compatibilityManifest,
    pokemonOptions: "src/data/generated/pokemon-options.gen.json",
    abilityOptions: "src/data/generated/ability-options.gen.json",
    megaAbilityManifest: "src/data/overrides/mega-ability-manifest.json",
    megaAbilityManifestVersion: megaAbilityManifest.dataVersion,
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
    megaOverridePokemon: megaOverridePokemon.size,
    megaUnconfirmedPokemon: megaUnconfirmedPokemon.size,
    missingAbilityOptions: missingAbilityOptions.size,
  },
};

await mkdir("src/data/generated", { recursive: true });
await writeFile("src/data/generated/pokemon-abilities.gen.json", `${JSON.stringify(payload)}\n`);

console.log(`Wrote ${entries.length} pokemon ability entries.`);
console.log(`PokeAPI matched ${pokeapiMatchedPokemon} pokemon, calc fallback ${calcFallbackPokemon.size}, Mega overrides ${megaOverridePokemon.size}, multi-ability ${multiAbilityPokemon}.`);
if (pokeapiConflictFallbackPokemon.size > 0) {
  console.warn(`Warnings: ${pokeapiConflictFallbackPokemon.size} PokeAPI matches conflicted with @smogon/calc and used calc fallback.`);
}
if (missingAbilityOptions.size > 0) {
  console.warn(`Warnings: ${missingAbilityOptions.size} abilities were not found in ability-options.gen.json.`);
  for (const [id, showdownName] of missingAbilityOptions) {
    console.warn(`- ${id}: ${showdownName}`);
  }
}
