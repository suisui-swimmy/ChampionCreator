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
