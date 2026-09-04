import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s　・･_\-‐‑–—]/g, "");

const fail = (messages) => {
  for (const message of messages) {
    console.error(message);
  }
  process.exitCode = 1;
};

const catalog = await readJson("src/data/generated/localized-catalog.gen.json");
const aliasOverrides = await readJson("src/data/overrides/ja-aliases.json");
const labelOverrides = await readJson("src/data/overrides/ja-label-overrides.json");
const megaStoneLabels = await readJson("src/data/overrides/mega-stone-labels-ja.json");
const userOptionExclusions = await readJson("src/data/overrides/user-option-exclusions.json");
const optionFiles = [
  "src/data/generated/pokemon-options.gen.json",
  "src/data/generated/move-options.gen.json",
  "src/data/generated/item-options.gen.json",
  "src/data/generated/ability-options.gen.json",
  "src/data/generated/nature-options.gen.json",
  "src/data/generated/type-options.gen.json",
];

const errors = [];
const warnings = [];
const catalogKeys = new Set();
const resolverKeys = new Set();
const indexKeys = new Map();
const optionPayloadsByKind = new Map();
let itemOptionsPayload;

if (catalog.schemaVersion !== 1) {
  errors.push("localized catalog schemaVersion must be 1");
}

for (const entry of catalog.entries ?? []) {
  const key = `${entry.kind}:${entry.id}`;
  if (catalogKeys.has(key)) {
    errors.push(`duplicate catalog entry: ${key}`);
  }
  catalogKeys.add(key);
  resolverKeys.add(key);

  for (const field of ["kind", "id", "canonicalName", "displayNameJa"]) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      errors.push(`catalog ${key} has empty ${field}`);
    }
  }

  if (!Array.isArray(entry.searchText)) {
    errors.push(`catalog ${key} searchText must be an array`);
  }

  for (const text of [entry.id, entry.canonicalName, entry.displayNameJa, ...(entry.searchText ?? [])]) {
    const normalized = normalize(text);
    if (!normalized) {
      errors.push(`catalog ${key} has empty searchable text`);
      continue;
    }
    const indexKey = `${entry.kind}:${normalized}`;
    const current = indexKeys.get(indexKey) ?? new Set();
    current.add(key);
    indexKeys.set(indexKey, current);
  }
}

for (const file of optionFiles) {
  const payload = await readJson(file);
  const kind = String(payload.kind ?? "").replace(/-options$/, "");

  if (payload.schemaVersion !== 1) {
    errors.push(`${file} schemaVersion must be 1`);
  }

  if (!["pokemon", "move", "item", "ability", "nature", "type"].includes(kind)) {
    errors.push(`${file} kind must be an entity option kind`);
    continue;
  }

  if (kind === "item") {
    itemOptionsPayload = payload;
  }
  optionPayloadsByKind.set(kind, payload);

  if (payload.summary?.totalOptions !== payload.entries?.length) {
    errors.push(`${file} summary.totalOptions must match its entry count`);
  }

  for (const entry of payload.entries ?? []) {
    const key = `${kind}:${entry.id}`;
    resolverKeys.add(key);

    for (const field of ["id", "label", "showdownName", "searchText"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") {
        errors.push(`${file} ${key} has empty ${field}`);
      }
    }

    if ("minHits" in entry || "maxHits" in entry) {
      if (!Number.isInteger(entry.minHits) || !Number.isInteger(entry.maxHits)) {
        errors.push(`${file} ${key} minHits/maxHits must be integers`);
      } else if (entry.minHits < 1 || entry.maxHits < 1 || entry.minHits > entry.maxHits) {
        errors.push(`${file} ${key} has invalid hit count range: ${entry.minHits}-${entry.maxHits}`);
      } else if (kind !== "move") {
        errors.push(`${file} ${key} minHits/maxHits are only supported for move options`);
      }
    }

    for (const text of [entry.id, entry.showdownName, entry.label, ...(entry.searchText ?? "").split(/\s+/)]) {
      const normalized = normalize(text);
      if (!normalized) {
        continue;
      }
      const indexKey = `${kind}:${normalized}`;
      const current = indexKeys.get(indexKey) ?? new Set();
      current.add(key);
      indexKeys.set(indexKey, current);
    }
  }
}

const entityKinds = ["pokemon", "move", "item", "ability", "nature", "type"];
const exclusionCategories = ["smogon-cap", "calc-internal"];
const exclusionEntriesByKind = Object.fromEntries(entityKinds.map((kind) => [kind, []]));
const exclusionKeys = new Set();

if (userOptionExclusions.schemaVersion !== 1) {
  errors.push("user-option-exclusions schemaVersion must be 1");
}
if (typeof userOptionExclusions.source?.pokemonShowdownCommit !== "string"
  || !/^[0-9a-f]{40}$/u.test(userOptionExclusions.source.pokemonShowdownCommit)) {
  errors.push("user-option-exclusions must record a full Pokemon Showdown commit");
}

for (const entry of userOptionExclusions.entries ?? []) {
  if (!entityKinds.includes(entry?.kind) || !exclusionCategories.includes(entry?.category)) {
    errors.push(`invalid user option exclusion: ${JSON.stringify(entry)}`);
    continue;
  }
  if (typeof entry.id !== "string" || !entry.id || typeof entry.showdownName !== "string" || !entry.showdownName) {
    errors.push(`invalid user option exclusion identity: ${JSON.stringify(entry)}`);
    continue;
  }
  const expectedId = entry.kind === "type" && entry.showdownName === "???"
    ? "unknown"
    : entry.showdownName.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  if (entry.id !== expectedId) {
    errors.push(`user option exclusion id mismatch: ${entry.kind}:${entry.id} / ${entry.showdownName}`);
  }
  const key = `${entry.kind}:${entry.id}`;
  if (exclusionKeys.has(key)) {
    errors.push(`duplicate user option exclusion: ${key}`);
    continue;
  }
  exclusionKeys.add(key);
  exclusionEntriesByKind[entry.kind].push(entry);
}

for (const catalogEntry of catalog.entries ?? []) {
  if (exclusionKeys.has(`${catalogEntry.kind}:${catalogEntry.id}`)) {
    errors.push(`localized catalog exposes excluded entry: ${catalogEntry.kind}:${catalogEntry.id}`);
  }
}

const expectedAbsentExclusionKeys = new Set(userOptionExclusions.expectedAbsentFromCurrentCalc ?? []);
for (const key of expectedAbsentExclusionKeys) {
  if (!exclusionKeys.has(key)) {
    errors.push(`user-option-exclusions expectedAbsentFromCurrentCalc references missing entry: ${key}`);
  }
}

for (const category of exclusionCategories) {
  for (const kind of entityKinds) {
    const expectedCount = userOptionExclusions.expectedCounts?.[category]?.[kind];
    const actualCount = exclusionEntriesByKind[kind].filter((entry) => entry.category === category).length;
    if (expectedCount !== actualCount) {
      errors.push(`user-option-exclusions ${category}:${kind} count mismatch: ${actualCount} / ${expectedCount}`);
    }
  }
}

for (const kind of entityKinds) {
  const payload = optionPayloadsByKind.get(kind);
  if (!payload) {
    errors.push(`missing generated option payload for ${kind}`);
    continue;
  }
  if (payload.source?.userOptionExclusions !== "src/data/overrides/user-option-exclusions.json") {
    errors.push(`${kind} options must record the user option exclusion source`);
  }
  const generatedIds = new Set((payload.entries ?? []).map((entry) => entry.id));
  for (const exclusion of exclusionEntriesByKind[kind]) {
    if (generatedIds.has(exclusion.id)) {
      errors.push(`${kind} options expose excluded entry: ${exclusion.id}`);
    }
  }

  const presentExclusions = exclusionEntriesByKind[kind].filter((entry) => (
    !expectedAbsentExclusionKeys.has(`${kind}:${entry.id}`)
  ));
  const expectedSmogonOriginalCount = presentExclusions.filter((entry) => entry.category === "smogon-cap").length;
  const expectedInternalCount = presentExclusions.filter((entry) => entry.category === "calc-internal").length;
  const expectedAbsentSmogonOriginalIds = exclusionEntriesByKind[kind]
    .filter((entry) => entry.category === "smogon-cap"
      && expectedAbsentExclusionKeys.has(`${kind}:${entry.id}`))
    .map((entry) => entry.id)
    .sort();
  const generatedAbsentSmogonOriginalIds = [...(payload.summary?.knownSmogonOriginalAbsentFromCalcIds ?? [])].sort();

  if (payload.summary?.excludedSmogonOriginal !== expectedSmogonOriginalCount) {
    errors.push(`${kind} options excludedSmogonOriginal is stale`);
  }
  if (payload.summary?.excludedInternal !== expectedInternalCount) {
    errors.push(`${kind} options excludedInternal is stale`);
  }
  if (payload.summary?.knownSmogonOriginalAbsentFromCalc !== expectedAbsentSmogonOriginalIds.length
    || JSON.stringify(generatedAbsentSmogonOriginalIds) !== JSON.stringify(expectedAbsentSmogonOriginalIds)) {
    errors.push(`${kind} options known Smogon-original absence is stale`);
  }
}

const validateOverridePayload = (payload, label) => {
  if (payload.schemaVersion !== 1) {
    errors.push(`${label} schemaVersion must be 1`);
  }

  for (const entry of payload.entries ?? []) {
    const key = `${entry.kind}:${entry.id}`;
    if (!resolverKeys.has(key)) {
      errors.push(`${label} references missing resolver entry: ${key}`);
    }
  }
};

validateOverridePayload(aliasOverrides, "ja-aliases");
validateOverridePayload(labelOverrides, "ja-label-overrides");

if (megaStoneLabels.schemaVersion !== 1) {
  errors.push("mega-stone-labels-ja schemaVersion must be 1");
}
if (megaStoneLabels.scope?.officialMegaStones !== megaStoneLabels.entries?.length) {
  errors.push("mega-stone-labels-ja officialMegaStones must match its entry count");
}

const itemOptionsById = new Map((itemOptionsPayload?.entries ?? []).map((entry) => [entry.id, entry]));
const megaStoneLabelIds = new Set();
for (const entry of megaStoneLabels.entries ?? []) {
  if (megaStoneLabelIds.has(entry.id)) {
    errors.push(`mega-stone-labels-ja has duplicate id: ${entry.id}`);
    continue;
  }
  megaStoneLabelIds.add(entry.id);

  const generated = itemOptionsById.get(entry.id);
  if (!generated) {
    errors.push(`mega-stone-labels-ja references missing item option: ${entry.id}`);
    continue;
  }
  if (generated.showdownName !== entry.showdownName) {
    errors.push(`mega-stone-labels-ja canonical mismatch for ${entry.id}`);
  }
  if (generated.label !== entry.labelJa || generated.sourceStatus !== "manual") {
    errors.push(`generated Mega Stone label is stale for ${entry.id}`);
  }
  if (!Array.isArray(generated.megaStoneMappings) || generated.megaStoneMappings.length === 0) {
    errors.push(`generated Mega Stone mappings are missing for ${entry.id}`);
  }
  if (entry.championCreatorCurrentLabel) {
    const aliases = String(generated.searchText ?? "").split(/\s+/).map(normalize);
    if (!aliases.includes(normalize(entry.championCreatorCurrentLabel))) {
      errors.push(`generated Mega Stone legacy alias is missing for ${entry.id}`);
    }
  }
}

if (megaStoneLabelIds.has("crucibellite")) {
  errors.push("mega-stone-labels-ja must not include the non-official Crucibellite");
}

for (const entry of aliasOverrides.entries ?? []) {
  const aliases = new Set();
  for (const alias of entry.aliasesJa ?? []) {
    const normalized = normalize(alias);
    if (!normalized) {
      errors.push(`ja-aliases ${entry.kind}:${entry.id} has empty alias`);
      continue;
    }
    if (aliases.has(normalized)) {
      errors.push(`ja-aliases ${entry.kind}:${entry.id} has duplicate alias: ${alias}`);
    }
    aliases.add(normalized);
  }
  if (entry.displayAliasesJa !== undefined && !Array.isArray(entry.displayAliasesJa)) {
    errors.push(`ja-aliases ${entry.kind}:${entry.id} displayAliasesJa must be an array`);
    continue;
  }
  for (const displayAlias of entry.displayAliasesJa ?? []) {
    if (entry.kind !== "pokemon") {
      errors.push(`ja-aliases ${entry.kind}:${entry.id} displayAliasesJa is only supported for pokemon`);
    }
    if (!displayAlias || typeof displayAlias.displayNameJa !== "string") {
      errors.push(`ja-aliases ${entry.kind}:${entry.id} has invalid display alias`);
      continue;
    }
    const normalized = normalize(displayAlias.displayNameJa);
    if (!normalized) {
      errors.push(`ja-aliases ${entry.kind}:${entry.id} has empty display alias`);
      continue;
    }
    if (aliases.has(normalized)) {
      errors.push(`ja-aliases ${entry.kind}:${entry.id} has duplicate alias: ${displayAlias.displayNameJa}`);
    }
    aliases.add(normalized);
    if (displayAlias.artwork !== undefined
      && (typeof displayAlias.artwork !== "string" || !displayAlias.artwork.startsWith("/assets/"))) {
      errors.push(`ja-aliases ${entry.kind}:${entry.id} has invalid display alias artwork`);
    }
  }
}

for (const entry of labelOverrides.entries ?? []) {
  if (typeof entry.displayNameJa !== "string" || entry.displayNameJa.trim() === "") {
    errors.push(`ja-label-overrides ${entry.kind}:${entry.id} has empty displayNameJa`);
  }
  if (entry.artwork !== undefined
    && (entry.kind !== "pokemon" || typeof entry.artwork !== "string" || !entry.artwork.startsWith("/assets/"))) {
    errors.push(`ja-label-overrides ${entry.kind}:${entry.id} has invalid artwork`);
  }
}

for (const [indexKey, keys] of indexKeys) {
  if (keys.size > 1) {
    warnings.push(`${indexKey} is ambiguous across ${Array.from(keys).join(", ")}`);
  }
}

console.log(`Validated ${catalogKeys.size} localization catalog entries and ${resolverKeys.size} resolver entries.`);
if (warnings.length > 0) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 10)) {
    console.log(`- ${warning}`);
  }
}

if (errors.length > 0) {
  fail(errors);
}
