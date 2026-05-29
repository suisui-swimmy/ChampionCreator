import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const publicRoot = resolve(projectRoot, "public");
const pokemonOptionsPath = resolve(projectRoot, "src/data/generated/pokemon-options.gen.json");
const officialArtworkDir = resolve(publicRoot, "assets/official-artwork");

const toPublicPath = (assetPath) =>
  resolve(publicRoot, String(assetPath).replace(/^\/+/, "").replaceAll("/", sep));

const toAssetRef = (filePath) =>
  `/${relative(publicRoot, filePath).split(sep).join("/")}`;

const formatSizeMb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const collectFiles = async (dirPath) => {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const payload = JSON.parse(await readFile(pokemonOptionsPath, "utf8"));
const entries = Array.isArray(payload.entries) ? payload.entries : [];
const artworkRefs = new Set(
  entries.map((entry) => entry.artwork).filter((artwork) => typeof artwork === "string"),
);

const invalidRefs = [];
const missingRefs = [];

for (const artworkRef of artworkRefs) {
  const filePath = toPublicPath(artworkRef);

  if (!filePath.startsWith(`${publicRoot}${sep}`)) {
    invalidRefs.push(artworkRef);
    continue;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      missingRefs.push(artworkRef);
    }
  } catch {
    missingRefs.push(artworkRef);
  }
}

let assetFiles = [];
try {
  assetFiles = await collectFiles(officialArtworkDir);
} catch {
  assetFiles = [];
}

const pngAssetFiles = assetFiles.filter((filePath) => filePath.toLowerCase().endsWith(".png"));
const assetRefs = new Set(pngAssetFiles.map(toAssetRef));
const unusedRefs = [...assetRefs].filter((assetRef) => !artworkRefs.has(assetRef)).sort();
const totalAssetBytes = (
  await Promise.all(pngAssetFiles.map(async (filePath) => (await stat(filePath)).size))
).reduce((sum, size) => sum + size, 0);

const summary = {
  optionEntries: entries.length,
  uniqueArtworkRefs: artworkRefs.size,
  availablePngAssets: pngAssetFiles.length,
  missingRefs: missingRefs.length,
  invalidRefs: invalidRefs.length,
  unusedPngAssets: unusedRefs.length,
  assetSize: formatSizeMb(totalAssetBytes),
};

console.log("Artwork asset validation summary:");
for (const [key, value] of Object.entries(summary)) {
  console.log(`- ${key}: ${value}`);
}

if (unusedRefs.length > 0) {
  console.log(`Unused asset samples: ${unusedRefs.slice(0, 10).join(", ")}`);
}

if (invalidRefs.length > 0) {
  console.error(`Invalid artwork refs: ${invalidRefs.slice(0, 20).join(", ")}`);
}

if (missingRefs.length > 0) {
  console.error(`Missing artwork refs: ${missingRefs.slice(0, 20).join(", ")}`);
}

if (invalidRefs.length > 0 || missingRefs.length > 0) {
  process.exit(1);
}
