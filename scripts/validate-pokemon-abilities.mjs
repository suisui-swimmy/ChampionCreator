import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { SPECIES, toID } from "@smogon/calc";

// Keep this CI validator limited to tracked artifacts and installed dependencies.
// Raw PokeAPI source checks belong in generate-pokemon-abilities.mjs because others/ is local-only.
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const fail = (messages) => {
  for (const message of messages) {
    console.error(message);
  }
  process.exitCode = 1;
};

const pokemonOptions = await readJson("src/data/generated/pokemon-options.gen.json");
const abilityOptions = await readJson("src/data/generated/ability-options.gen.json");
const pokemonAbilities = await readJson("src/data/generated/pokemon-abilities.gen.json");
const megaAbilityManifest = await readJson("src/data/overrides/mega-ability-manifest.json");
const userOptionExclusions = await readJson("src/data/overrides/user-option-exclusions.json");
const calcPackage = await readJson("node_modules/@smogon/calc/package.json");

const errors = [];
const warnings = [];
const speciesData = SPECIES[9];
const abilityOptionIds = new Set(abilityOptions.entries.map((entry) => entry.id));
const excludedPokemonIds = new Set((userOptionExclusions.entries ?? [])
  .filter((entry) => entry.kind === "pokemon")
  .map((entry) => entry.id));
const excludedAbilityIds = new Set((userOptionExclusions.entries ?? [])
  .filter((entry) => entry.kind === "ability")
  .map((entry) => entry.id));
const missingAbilityOptionIds = new Set();
const pokemonOptionsById = new Map(pokemonOptions.entries.map((entry) => [entry.id, entry]));
const pokemonOptionsByShowdownName = new Map(
  pokemonOptions.entries.map((entry) => [entry.showdownName, entry]),
);
const abilityEntriesByPokemonId = new Map();
const validSources = new Set(["pokeapi", "calc-fallback", "mega-override"]);
const isMegaShowdownName = (showdownName) => /-Mega(?:-[XYZ])?$/u.test(showdownName);
const megaPokemonOptions = pokemonOptions.entries.filter((entry) => isMegaShowdownName(entry.showdownName));
const megaManifestEntries = megaAbilityManifest.entries ?? [];
const megaManifestByShowdownName = new Map();
const megaManifestStatusCounts = { confirmed: 0, unconfirmed: 0 };

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

if (megaAbilityManifest.schemaVersion !== 1) {
  errors.push("mega-ability-manifest.json schemaVersion must be 1");
}

if (megaAbilityManifest.kind !== "mega-ability-manifest") {
  errors.push("mega-ability-manifest.json kind must be mega-ability-manifest");
}

for (const [field, value] of Object.entries({
  dataVersion: megaAbilityManifest.dataVersion,
  authority: megaAbilityManifest.source?.authority,
  applicableVersion: megaAbilityManifest.source?.applicableVersion,
  checkedAt: megaAbilityManifest.source?.checkedAt,
  canonicalBasis: megaAbilityManifest.source?.canonicalBasis,
  calcBase: megaAbilityManifest.source?.calcBase,
})) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`mega-ability-manifest.json ${field} must be a non-empty string`);
  }
}

const expectedMegaManifestSummary = {
  totalForms: 97,
  confirmed: 86,
  unconfirmed: 11,
};
const expectedMegaManifestSignature = "b6e9c7b2a8665a6d3297b64cf4a7dd311b5e8701838ab0dfcf0882c52e3d46aa";
if (megaPokemonOptions.length !== expectedMegaManifestSummary.totalForms) {
  errors.push(`pokemon-options Mega form count mismatch: ${megaPokemonOptions.length} != ${expectedMegaManifestSummary.totalForms}`);
}
for (const [field, value] of Object.entries(expectedMegaManifestSummary)) {
  if (megaAbilityManifest.summary?.[field] !== value) {
    errors.push(`mega-ability-manifest summary.${field} mismatch: ${megaAbilityManifest.summary?.[field]} != ${value}`);
  }
}

for (const entry of megaManifestEntries) {
  const key = `pokemon:${entry?.showdownName}`;
  if (typeof entry?.showdownName !== "string" || entry.showdownName.trim() === "") {
    errors.push("mega-ability-manifest entries must have a non-empty showdownName");
    continue;
  }
  if (!isMegaShowdownName(entry.showdownName)) {
    errors.push(`mega-ability-manifest references unsupported Mega form: ${entry.showdownName}`);
  }
  const unexpectedFields = Object.keys(entry).filter((field) => !["showdownName", "status", "ability"].includes(field));
  if (unexpectedFields.length > 0) {
    errors.push(`${key} has unexpected manifest fields: ${unexpectedFields.join(", ")}`);
  }
  if (!pokemonOptionsByShowdownName.has(entry.showdownName)) {
    errors.push(`${key} references missing pokemon option`);
  }
  if (megaManifestByShowdownName.has(entry.showdownName)) {
    errors.push(`duplicate Mega ability manifest entry: ${entry.showdownName}`);
    continue;
  }
  if (entry.status !== "confirmed" && entry.status !== "unconfirmed") {
    errors.push(`${key} has invalid Mega ability status: ${entry.status}`);
    continue;
  }
  megaManifestStatusCounts[entry.status] += 1;

  if (entry.status === "confirmed") {
    if (typeof entry.ability !== "string" || entry.ability.trim() === "") {
      errors.push(`${key} confirmed Mega ability must have an ability`);
    } else if (!abilityOptionIds.has(toID(entry.ability))) {
      errors.push(`${key} references missing ability option: ability:${toID(entry.ability)}`);
    }
  } else if (entry.ability !== null) {
    errors.push(`${key} unconfirmed Mega ability must have null ability`);
  }
  megaManifestByShowdownName.set(entry.showdownName, entry);
}

if (megaManifestEntries.length !== megaPokemonOptions.length) {
  errors.push(
    `mega-ability-manifest must cover ${megaPokemonOptions.length} Mega forms: ${megaManifestEntries.length} entries provided`,
  );
}
for (const pokemonOption of megaPokemonOptions) {
  if (!megaManifestByShowdownName.has(pokemonOption.showdownName)) {
    errors.push(`mega-ability-manifest is missing ${pokemonOption.showdownName}`);
  }
}
for (const [field, value] of Object.entries({
  confirmed: megaManifestStatusCounts.confirmed,
  unconfirmed: megaManifestStatusCounts.unconfirmed,
})) {
  if (value !== expectedMegaManifestSummary[field]) {
    errors.push(`mega-ability-manifest ${field} count mismatch: ${value} != ${expectedMegaManifestSummary[field]}`);
  }
}

const megaManifestSignature = megaManifestEntries
  .slice()
  .sort((left, right) => String(left?.showdownName ?? "").localeCompare(
    String(right?.showdownName ?? ""),
    "en",
  ))
  .map((entry) => [entry?.showdownName ?? "", entry?.status ?? "", entry?.ability ?? ""].join(":"))
  .join("\n");
const actualMegaManifestSignature = createHash("sha256")
  .update(megaManifestSignature)
  .digest("hex");
if (actualMegaManifestSignature !== expectedMegaManifestSignature) {
  errors.push(
    `mega-ability-manifest full mapping signature mismatch: ${actualMegaManifestSignature}`,
  );
}

const expectedMegaCorrections = new Map([
  ["Skarmory-Mega", "Stalwart"],
  ["Hawlucha-Mega", "No Guard"],
  ["Absol-Mega-Z", "Sharpness"],
  ["Garchomp-Mega-Z", "Levitate"],
  ["Lucario-Mega-Z", "Aura Guard"],
]);
for (const [showdownName, ability] of expectedMegaCorrections) {
  const entry = megaManifestByShowdownName.get(showdownName);
  if (entry?.status !== "confirmed" || entry.ability !== ability) {
    errors.push(`Mega correction mismatch for ${showdownName}: ${entry?.ability ?? "<missing>"} != ${ability}`);
  }
}

const expectedUnconfirmedMegaNames = [
  "Baxcalibur-Mega",
  "Darkrai-Mega",
  "Golisopod-Mega",
  "Heatran-Mega",
  "Magearna-Mega",
  "Magearna-Original-Mega",
  "Tatsugiri-Curly-Mega",
  "Tatsugiri-Droopy-Mega",
  "Tatsugiri-Stretchy-Mega",
  "Zeraora-Mega",
  "Zygarde-Mega",
];
const actualUnconfirmedMegaNames = megaManifestEntries
  .filter((entry) => entry?.status === "unconfirmed")
  .map((entry) => entry.showdownName)
  .sort();
if (JSON.stringify(actualUnconfirmedMegaNames) !== JSON.stringify(expectedUnconfirmedMegaNames)) {
  errors.push(
    `mega-ability-manifest unconfirmed forms mismatch: ${actualUnconfirmedMegaNames.join(", ")} != ${expectedUnconfirmedMegaNames.join(", ")}`,
  );
}

const expectedDataVersion = pokemonOptions.dataVersion ?? `calc-${calcPackage.version}-gen9`;
if (pokemonAbilities.dataVersion !== expectedDataVersion) {
  errors.push(`pokemon-abilities.gen.json dataVersion mismatch: ${pokemonAbilities.dataVersion} != ${expectedDataVersion}`);
}
if (pokemonAbilities.source?.megaAbilityManifest !== "src/data/overrides/mega-ability-manifest.json") {
  errors.push(
    `pokemon-abilities.gen.json source.megaAbilityManifest mismatch: ${pokemonAbilities.source?.megaAbilityManifest}`,
  );
}
if (pokemonAbilities.source?.megaAbilityManifestVersion !== megaAbilityManifest.dataVersion) {
  errors.push(
    `pokemon-abilities.gen.json source.megaAbilityManifestVersion mismatch: ${pokemonAbilities.source?.megaAbilityManifestVersion}`,
  );
}
for (const field of ["upstreamCommit", "compatibilityPatchId", "compatibilityManifest"]) {
  if (pokemonAbilities.source?.[field] !== pokemonOptions.source?.[field]) {
    errors.push(
      `pokemon-abilities.gen.json source.${field} mismatch: ${pokemonAbilities.source?.[field]} != ${pokemonOptions.source?.[field]}`,
    );
  }
}

for (const entry of pokemonAbilities.entries ?? []) {
  const key = `pokemon:${entry.id}`;
  if (excludedPokemonIds.has(entry.id)) {
    errors.push(`pokemon-abilities exposes excluded ${key}`);
  }
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

  const manifestEntry = megaManifestByShowdownName.get(pokemonOption.showdownName);
  const isMega = isMegaShowdownName(pokemonOption.showdownName);
  if (isMega && !manifestEntry) {
    errors.push(`${key} is missing Mega ability manifest entry`);
  }
  if (!isMega && manifestEntry) {
    errors.push(`${key} unexpectedly has Mega ability manifest entry`);
  }
  const isMegaOverride = manifestEntry?.status === "confirmed";

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
    if (excludedAbilityIds.has(ability.id)) {
      errors.push(`${key} exposes excluded ${abilityKey}`);
    }
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

    if (ability.source === "mega-override") {
      if (!isMegaOverride) {
        errors.push(`${key} ${abilityKey} uses Mega override without a confirmed manifest entry`);
      }
      if (ability.override?.manifest !== "src/data/overrides/mega-ability-manifest.json") {
        errors.push(`${key} ${abilityKey} has invalid Mega override provenance`);
      }
      if (ability.override?.status !== "confirmed") {
        errors.push(`${key} ${abilityKey} Mega override status must be confirmed`);
      }
      if (ability.override?.dataVersion !== megaAbilityManifest.dataVersion) {
        errors.push(`${key} ${abilityKey} Mega override dataVersion mismatch`);
      }
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

  if (isMegaOverride) {
    const actual = entry.abilities;
    const expectedId = toID(manifestEntry.ability);
    if (actual.length !== 1 || actual[0]?.id !== expectedId || actual[0]?.source !== "mega-override") {
      errors.push(`${key} Mega override mismatch: expected ${expectedId} from manifest`);
    }
    if (actual.some((ability) => ability.isHidden)) {
      errors.push(`${key} Mega override must not contain a hidden ability`);
    }
  }

  const expectedCalcAbilities = calcExpectedAbilities(pokemonOption);
  const actualAbilityIds = new Set(entry.abilities.map((ability) => ability.id));
  if (!isMegaOverride) {
    for (const expected of expectedCalcAbilities) {
      if (!actualAbilityIds.has(expected.id)) {
        errors.push(`${key} is missing @smogon/calc ability: ability:${expected.id}`);
      }
    }
  }

  const usesOnlyCalcFallback = entry.abilities.every((ability) => ability.source === "calc-fallback");
  if (usesOnlyCalcFallback) {
    const actualSignature = entry.abilities.map((ability) => `${ability.id}:${ability.slot}`).join("|");
    const expectedSignature = expectedCalcAbilities.map((ability) => `${ability.id}:${ability.slot}`).join("|");
    if (actualSignature !== expectedSignature) {
      errors.push(`${key} calc fallback mismatch: ${actualSignature} != ${expectedSignature}`);
    }
    warnings.push(`${entry.showdownName} uses @smogon/calc fallback abilities`);
  }
}

for (const pokemonOption of pokemonOptions.entries ?? []) {
  if (!abilityEntriesByPokemonId.has(pokemonOption.id)) {
    errors.push(`missing pokemon ability entry for pokemon:${pokemonOption.id}`);
  }
}

for (const [showdownName, manifestEntry] of megaManifestByShowdownName) {
  if (manifestEntry.status !== "unconfirmed") {
    continue;
  }

  const pokemonOption = pokemonOptionsByShowdownName.get(showdownName);
  if (!pokemonOption || !isMegaShowdownName(showdownName)) {
    errors.push(`unconfirmed Mega ability references unsupported Mega form: ${showdownName}`);
    continue;
  }
  const generatedEntry = abilityEntriesByPokemonId.get(pokemonOption.id);
  if (!generatedEntry?.abilities?.every((ability) => ability.source === "calc-fallback")) {
    errors.push(`unconfirmed Mega ability no longer uses only calc fallback: ${showdownName}`);
  }

  const species = speciesData[showdownName];
  const baseSpecies = species?.baseSpecies ? speciesData[species.baseSpecies] : undefined;
  const baseAbilityIds = new Set(Object.values(baseSpecies?.abilities ?? {}).map(toID));
  const megaAbilityIds = Object.values(species?.abilities ?? {}).map(toID);
  if (megaAbilityIds.length === 0 || megaAbilityIds.some((id) => !baseAbilityIds.has(id))) {
    errors.push(`unconfirmed Mega ability may now be resolved in @smogon/calc: ${showdownName}`);
  }
  const generatedAbilityIds = new Set(generatedEntry?.abilities?.map((ability) => ability.id) ?? []);
  if (generatedAbilityIds.size > 0 && Array.from(generatedAbilityIds).some((id) => !baseAbilityIds.has(id))) {
    errors.push(`unconfirmed Mega ability generated value is not a pre-Mega ability: ${showdownName}`);
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
  megaOverridePokemon: entries.filter((entry) => (
    (entry.abilities ?? []).some((ability) => ability.source === "mega-override")
  )).length,
  megaUnconfirmedPokemon: entries.filter((entry) => (
    megaManifestByShowdownName.get(entry.showdownName)?.status === "unconfirmed"
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
