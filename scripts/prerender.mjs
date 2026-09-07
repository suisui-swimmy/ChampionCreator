import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

export function injectPrerenderedApp(html, markup) {
  const marker = '<div id="root"></div>';
  if (html.split(marker).length !== 2 || !markup.includes('class="app-shell"') || !markup.includes("調整対象")) {
    throw new Error("Prerender failed: expected one empty root and a complete app shell.");
  }
  return html.replace(marker, () => `<div id="root">${markup}</div>`);
}

export function pngToIco(png) {
  if (png.readUInt32BE(0) !== 0x89504e47 || png.readUInt32BE(16) !== 32 || png.readUInt32BE(20) !== 32) {
    throw new Error("The favicon source must be a 32 x 32 PNG.");
  }
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  header[6] = 32; header[7] = 32;
  header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

export async function prerender(distDir = "dist") {
  const server = await createServer({
    configFile: false, envFile: false, mode: "production", base: "./",
    server: { middlewareMode: true, watch: null }, appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: "automatic" }, logLevel: "error",
  });
  try {
    const { renderInitialApp, renderGuideExample } = await server.ssrLoadModule("/src/seo/prerender.tsx");
    const path = resolve(distDir, "index.html");
    const html = injectPrerenderedApp(await readFile(path, "utf8"), renderInitialApp());
    await writeFile(path, html);
    const guidePath = resolve(distDir, "guide/index.html");
    const guide = await readFile(guidePath, "utf8");
    if (guide.split("<!--GUIDE_CALCULATION_EXAMPLE-->").length !== 2) throw new Error("Guide example placeholder is missing or duplicated.");
    await writeFile(guidePath, guide.replace("<!--GUIDE_CALCULATION_EXAMPLE-->", () => renderGuideExample()));
    await writeFile(resolve(distDir, "favicon.ico"), pngToIco(await readFile("public/assets/icons/favicon-32.png")));
    console.log("Prerendered app HTML and generated favicon.ico.");
  } finally { await server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await prerender(process.argv[2]);
