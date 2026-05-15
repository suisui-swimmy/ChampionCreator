import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const sourceDir = join(projectRoot, "others", "official-artwork");
const outputDir = join(projectRoot, "public", "assets", "official-artwork");

await mkdir(outputDir, { recursive: true });

const files = (await readdir(sourceDir))
  .filter((fileName) => fileName.endsWith(".png"))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

let copied = 0;
let skipped = 0;

for (const fileName of files) {
  const sourcePath = join(sourceDir, fileName);
  const outputPath = join(outputDir, fileName);
  const sourceStat = await stat(sourcePath);

  let outputStat = null;
  try {
    outputStat = await stat(outputPath);
  } catch {
    outputStat = null;
  }

  if (outputStat?.size === sourceStat.size) {
    skipped += 1;
    continue;
  }

  await copyFile(sourcePath, outputPath);
  copied += 1;
}

console.log(
  JSON.stringify(
    {
      output: "public/assets/official-artwork",
      total: files.length,
      copied,
      skipped,
    },
    null,
    2,
  ),
);
