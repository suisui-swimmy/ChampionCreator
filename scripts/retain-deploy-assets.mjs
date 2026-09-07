import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const ASSET_HISTORY_PATH = "assets/asset-history.json";
export const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RETAINED_BYTES = 512 * 1024 * 1024;
const ASSET_PATH = /^assets\/[\w-]+-[\w-]{8}\.(?:js|css)$/;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function parseAssetHistory(raw, now = new Date()) {
  const value = JSON.parse(raw);
  if (value?.schemaVersion !== 1 || !Array.isArray(value.assets) || value.assets.length > 5000) {
    throw new Error("Invalid asset history schema.");
  }
  const paths = new Set();
  for (const entry of value.assets) {
    if (!entry || !ASSET_PATH.test(entry.path) || paths.has(entry.path)
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_FILE_BYTES
      || typeof entry.lastSeen !== "string" || !Number.isFinite(Date.parse(entry.lastSeen))
      || Date.parse(entry.lastSeen) > now.getTime() + 5 * 60_000) {
      throw new Error("Invalid or duplicate asset history entry.");
    }
    paths.add(entry.path);
  }
  return value.assets;
}

// Bootstrap older deployments that do not yet publish a manifest. These are
// literal Vite output references (including Worker URLs and preload maps),
// never executable remote code. Only same-origin hashed JS/CSS is accepted.
export function discoverAssetPaths(source, documentUrl, baseUrl) {
  const base = new URL(baseUrl);
  const paths = new Set();
  for (const match of source.matchAll(/["']([^"'\s<>]+\.(?:js|css))["']/g)) {
    const url = new URL(match[1], match[1].startsWith("assets/") ? base : documentUrl);
    const path = url.pathname.slice(base.pathname.length);
    if (url.origin === base.origin && url.pathname.startsWith(base.pathname) && ASSET_PATH.test(path)) {
      paths.add(path);
    }
  }
  return [...paths];
}

async function fetchBytes(url, fetchImpl, optional = false) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
      });
      if (optional && response.status === 404) return null;
      if (!response.ok) throw new Error(`Asset retention fetch failed: ${response.status} ${url}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_FILE_BYTES) throw new Error(`Oversized asset: ${url}`);
      return buffer;
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function bootstrapHistory(baseUrl, now, fetchImpl) {
  const pending = new Set();
  const files = new Map();
  for (const page of ["", "guide/", "privacy/"]) {
    const url = new URL(page, baseUrl).href;
    const html = await fetchBytes(url, fetchImpl);
    discoverAssetPaths(html.toString("utf8"), url, baseUrl).forEach((path) => pending.add(path));
  }
  if (pending.size === 0) throw new Error("Live deployment has no discoverable assets; refusing an empty retention seed.");
  for (const path of pending) {
    if (pending.size > 200) throw new Error("Unexpectedly large bootstrap asset graph.");
    const url = new URL(path, baseUrl).href;
    const bytes = await fetchBytes(url, fetchImpl);
    files.set(path, bytes);
    discoverAssetPaths(bytes.toString("utf8"), url, baseUrl).forEach((child) => pending.add(child));
  }
  return {
    files,
    assets: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: digest(bytes), lastSeen: now.toISOString() })),
  };
}

export async function retainDeployAssets({ distDir, baseUrl, now = new Date(), fetchImpl = fetch }) {
  const root = resolve(distDir);
  // A second pass over the merged output would mistake retained files for
  // current build inputs and extend their expiration indefinitely.
  const alreadyMerged = await access(join(root, ASSET_HISTORY_PATH)).then(() => true, (error) => {
    if (error.code !== "ENOENT") throw error;
    return false;
  });
  if (alreadyMerged) throw new Error("Asset history already exists in dist; run a clean production build before retention.");
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || !base.pathname.endsWith("/") || base.search || base.hash || base.username || base.password) {
    throw new Error("Asset retention requires an HTTPS site base URL ending in /.");
  }
  const current = new Map();
  for (const name of await readdir(join(root, "assets"))) {
    const path = `assets/${name}`;
    if (!ASSET_PATH.test(path)) continue;
    const bytes = await readFile(join(root, path));
    if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) throw new Error(`Invalid build asset size: ${path}`);
    current.set(path, { path, bytes: bytes.length, sha256: digest(bytes), lastSeen: now.toISOString() });
  }
  if (current.size === 0) throw new Error("Build assets are missing; run the production build first.");
  const manifest = await fetchBytes(new URL(ASSET_HISTORY_PATH, base).href, fetchImpl, true);
  const previous = manifest
    ? { assets: parseAssetHistory(manifest.toString("utf8"), now), files: new Map() }
    : await bootstrapHistory(base, now, fetchImpl);
  const retained = [];
  let retainedBytes = 0;
  for (const entry of previous.assets) {
    const matching = current.get(entry.path);
    if (matching) {
      if (matching.sha256 !== entry.sha256) throw new Error(`Immutable asset collision: ${entry.path}`);
      continue;
    }
    if (Date.parse(entry.lastSeen) < now.getTime() - RETENTION_DAYS * DAY_MS) continue;
    retainedBytes += entry.bytes;
    retained.push(entry);
  }
  if (retainedBytes > MAX_RETAINED_BYTES) throw new Error("Retained assets exceed 512 MiB; review retention before deploying.");
  for (const entry of retained) {
    const bytes = previous.files.get(entry.path) ?? await fetchBytes(new URL(entry.path, base).href, fetchImpl);
    if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) throw new Error(`Asset integrity mismatch: ${entry.path}`);
    await mkdir(dirname(join(root, entry.path)), { recursive: true });
    await writeFile(join(root, entry.path), bytes);
  }
  const assets = [...current.values(), ...retained].sort((a, b) => a.path.localeCompare(b.path, "en"));
  await writeFile(join(root, ASSET_HISTORY_PATH), JSON.stringify({ schemaVersion: 1, retentionDays: RETENTION_DAYS, assets }, null, 2) + "\n");
  return { current: current.size, retained: retained.length, retainedBytes, bootstrapped: !manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [distDir = "dist", baseUrl = "https://championcreator.suisui-swimmy.com/"] = process.argv.slice(2);
  console.log("Asset retention:", await retainDeployAssets({ distDir, baseUrl }));
}
