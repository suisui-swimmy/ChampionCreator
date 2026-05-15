import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const outputDir = join(projectRoot, "src", "data", "generated");
const speciesPath = join(outputDir, "calc-species.gen.json");
const localizedPath = join(outputDir, "localized-search-index.gen.json");
const assetsPath = join(outputDir, "pokemon-assets.gen.json");
const outputPath = join(outputDir, "pokemon-options.gen.json");

const normalizeSearchText = (value) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");

const makeSearchText = (tokens) =>
  Array.from(new Set(tokens.filter(Boolean).map(normalizeSearchText))).join(" ");

const withOptional = (entry) =>
  Object.fromEntries(
    Object.entries(entry).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      if (typeof value === "object") {
        return Object.keys(value).length > 0;
      }

      return true;
    }),
  );

const speciesCatalog = JSON.parse(await readFile(speciesPath, "utf8"));
const localizedIndex = JSON.parse(await readFile(localizedPath, "utf8"));
const assetManifest = JSON.parse(await readFile(assetsPath, "utf8"));

const localizedById = new Map(localizedIndex.entries.map((entry) => [entry.calcId, entry]));
const assetsById = new Map(assetManifest.entries.map((entry) => [entry.calcId, entry]));

const entries = speciesCatalog.entries
  .filter((species) => species.appSupportStatus === "supported")
  .map((species) => {
    const localized = localizedById.get(species.id);
    const asset = assetsById.get(species.id);
    const label = localized?.displayNameJa || species.showdownName;
    const aliases = [
      ...(localized?.aliasesJa ?? []),
      species.showdownName,
      species.id,
    ].filter((value, index, values) => value && values.indexOf(value) === index);

    const fallbackFromCalcId = asset?.fallbackFromCalcId ?? localized?.fallbackFromCalcId;
    const fallbackReason = asset?.fallbackReason ?? localized?.fallbackReason;

    return withOptional({
      id: species.id,
      label,
      showdownName: species.showdownName,
      types: species.types,
      searchText: makeSearchText(aliases),
      artwork: asset?.artwork?.suggestedPublicPath ?? null,
      fallback:
        fallbackFromCalcId || fallbackReason
          ? {
              from: fallbackFromCalcId,
              reason: fallbackReason,
              nameSourceStatus: localized?.sourceStatus,
              assetSourceStatus: asset?.sourceStatus,
            }
          : undefined,
    });
  })
  .sort((a, b) => a.id.localeCompare(b.id, "en"));

const payload = {
  schemaVersion: 1,
  dataVersion: speciesCatalog.dataVersion,
  source: {
    speciesCatalog: "src/data/generated/calc-species.gen.json",
    localizedSearchIndex: "src/data/generated/localized-search-index.gen.json",
    pokemonAssets: "src/data/generated/pokemon-assets.gen.json",
  },
  generatedBy: "scripts/generate-pokemon-options.mjs",
  kind: "pokemon-options",
  entries,
  summary: {
    totalOptions: entries.length,
    supportedSpeciesInCatalog: speciesCatalog.entries.filter(
      (entry) => entry.appSupportStatus === "supported",
    ).length,
    withArtwork: entries.filter((entry) => entry.artwork).length,
    directLocalized: localizedIndex.entries.filter(
      (entry) => entry.appSupportStatus === "supported" && entry.sourceStatus === "supported",
    ).length,
    fallbackLocalized: localizedIndex.entries.filter(
      (entry) =>
        entry.appSupportStatus === "supported" && entry.sourceStatus === "adapter-temporary",
    ).length,
    directArtwork: assetManifest.entries.filter(
      (entry) => entry.appSupportStatus === "supported" && entry.sourceStatus === "supported",
    ).length,
    fallbackArtwork: assetManifest.entries.filter(
      (entry) =>
        entry.appSupportStatus === "supported" && entry.sourceStatus === "adapter-temporary",
    ).length,
  },
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      output: "src/data/generated/pokemon-options.gen.json",
      summary: payload.summary,
    },
    null,
    2,
  ),
);
