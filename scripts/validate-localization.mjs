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

const errors = [];
const warnings = [];
const catalogKeys = new Set();
const indexKeys = new Map();

if (catalog.schemaVersion !== 1) {
  errors.push("localized catalog schemaVersion must be 1");
}

for (const entry of catalog.entries ?? []) {
  const key = `${entry.kind}:${entry.id}`;
  if (catalogKeys.has(key)) {
    errors.push(`duplicate catalog entry: ${key}`);
  }
  catalogKeys.add(key);

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

const validateOverridePayload = (payload, label) => {
  if (payload.schemaVersion !== 1) {
    errors.push(`${label} schemaVersion must be 1`);
  }

  for (const entry of payload.entries ?? []) {
    const key = `${entry.kind}:${entry.id}`;
    if (!catalogKeys.has(key)) {
      errors.push(`${label} references missing catalog entry: ${key}`);
    }
  }
};

validateOverridePayload(aliasOverrides, "ja-aliases");
validateOverridePayload(labelOverrides, "ja-label-overrides");

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
}

for (const entry of labelOverrides.entries ?? []) {
  if (typeof entry.displayNameJa !== "string" || entry.displayNameJa.trim() === "") {
    errors.push(`ja-label-overrides ${entry.kind}:${entry.id} has empty displayNameJa`);
  }
}

for (const [indexKey, keys] of indexKeys) {
  if (keys.size > 1) {
    warnings.push(`${indexKey} is ambiguous across ${Array.from(keys).join(", ")}`);
  }
}

console.log(`Validated ${catalogKeys.size} localization catalog entries.`);
if (warnings.length > 0) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 10)) {
    console.log(`- ${warning}`);
  }
}

if (errors.length > 0) {
  fail(errors);
}
