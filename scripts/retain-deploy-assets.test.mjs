import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_HISTORY_PATH, discoverAssetPaths, parseAssetHistory, retainDeployAssets } from "./retain-deploy-assets.mjs";

const baseUrl = "https://example.test/";
const now = new Date("2026-09-07T12:00:00Z");
const directories = [];
const currentPath = "assets/app-abcdefgh.js";
const oldPath = "assets/app-12345678.js";
const checksum = (s) => createHash("sha256").update(s).digest("hex");
const entry = (path, body, lastSeen = "2026-09-01T12:00:00Z") => ({ path, bytes: Buffer.byteLength(body), sha256: checksum(body), lastSeen });
const history = (assets) => JSON.stringify({ schemaVersion: 1, assets });

async function build() {
  const dir = await mkdtemp(join(tmpdir(), "cc-asset-retention-"));
  directories.push(dir);
  await mkdir(join(dir, "assets"));
  await writeFile(join(dir, currentPath), "new code");
  return dir;
}
function responder(routes) {
  return vi.fn(async (url) => {
    const path = new URL(url).pathname.slice(1);
    const content = routes[path];
    return new Response(content ?? "missing", { status: content === undefined ? 404 : 200 });
  });
}
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    if (resolve(dir).startsWith(resolve(tmpdir())) && basename(dir).startsWith("cc-asset-retention-")) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("deployment asset retention", () => {
  it("keeps exact previous bytes, expires old releases, and does not extend old lastSeen", async () => {
    const distDir = await build();
    const expired = "assets/expired-87654321.css";
    const fetchImpl = responder({
      [ASSET_HISTORY_PATH]: history([entry(oldPath, "old code"), entry(expired, "old css", "2026-08-01T00:00:00Z")]),
      [oldPath]: "old code",
    });
    const result = await retainDeployAssets({ distDir, baseUrl, now, fetchImpl });
    expect(result.retained).toBe(1);
    expect(await readFile(join(distDir, oldPath), "utf8")).toBe("old code");
    const saved = parseAssetHistory(await readFile(join(distDir, ASSET_HISTORY_PATH), "utf8"), now);
    expect(saved.find((item) => item.path === oldPath)?.lastSeen).toBe("2026-09-01T12:00:00Z");
    expect(saved.find((item) => item.path === currentPath)?.lastSeen).toBe(now.toISOString());
    expect(saved.some((item) => item.path === expired)).toBe(false);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith(expired))).toBe(false);
    await expect(retainDeployAssets({ distDir, baseUrl, now, fetchImpl })).rejects.toThrow("clean production build");
  });

  it("refreshes the retention date of files still used by the new build", async () => {
    const distDir = await build();
    const fetchImpl = responder({ [ASSET_HISTORY_PATH]: history([entry(currentPath, "new code")]) });
    await retainDeployAssets({ distDir, baseUrl, now, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const saved = parseAssetHistory(await readFile(join(distDir, ASSET_HISTORY_PATH), "utf8"), now);
    expect(saved[0].lastSeen).toBe(now.toISOString());
  });

  it("bootstraps all page entries, preload maps, dynamic imports, and worker dependencies", async () => {
    const distDir = await build();
    const worker = "assets/worker-aaaaaaaa.js";
    const lazy = "assets/lazy-bbbbbbbb.js";
    const css = "assets/style-cccccccc.css";
    const fetchImpl = responder({
      "": `<script src="./${oldPath}"></script>`,
      "guide/": `<link href="../${css}" rel="stylesheet">`,
      "privacy/": "<p>Privacy</p>",
      [oldPath]: `const map=["${lazy}"]; import("./lazy-bbbbbbbb.js");new Worker(new URL("worker-aaaaaaaa.js",import.meta.url));`,
      [worker]: "self.onmessage=()=>{};", [lazy]: "export const a=1;", [css]: "body{color:white}",
    });
    expect((await retainDeployAssets({ distDir, baseUrl, now, fetchImpl })).retained).toBe(4);
    for (const path of [oldPath, worker, lazy, css]) expect(await readFile(join(distDir, path), "utf8")).not.toBe("");
  });

  it("blocks deployment when a required old asset cannot be fetched or its integrity differs", async () => {
    for (const body of [undefined, "tampered"]) {
      const distDir = await build();
      const fetchImpl = responder({ [ASSET_HISTORY_PATH]: history([entry(oldPath, "old code")]), [oldPath]: body });
      await expect(retainDeployAssets({ distDir, baseUrl, now, fetchImpl })).rejects.toThrow(/fetch failed|integrity mismatch/);
      await expect(readFile(join(distDir, ASSET_HISTORY_PATH))).rejects.toThrow();
    }
  });

  it("rejects a changed file using an existing immutable name", async () => {
    const distDir = await build();
    const fetchImpl = responder({ [ASSET_HISTORY_PATH]: history([entry(currentPath, "different content")]) });
    await expect(retainDeployAssets({ distDir, baseUrl, now, fetchImpl })).rejects.toThrow("Immutable asset collision");
  });

  it("rejects an oversized retention plan before downloading any old assets", async () => {
    const distDir = await build();
    const assets = Array.from({ length: 33 }, (_, index) => ({
      ...entry(`assets/large${index}-12345678.js`, "placeholder"), bytes: 16 * 1024 * 1024,
    }));
    const fetchImpl = responder({ [ASSET_HISTORY_PATH]: history(assets) });
    await expect(retainDeployAssets({ distDir, baseUrl, now, fetchImpl })).rejects.toThrow("exceed 512 MiB");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects traversal, duplicates, future dates, and unknown schema before writing", () => {
    for (const assets of [
      [entry("../outside.js", "bad")], [entry(oldPath, "a"), entry(oldPath, "a")],
      [entry(oldPath, "a", "2099-01-01T00:00:00Z")],
    ]) expect(() => parseAssetHistory(history(assets), now)).toThrow();
    expect(() => parseAssetHistory('{"schemaVersion":2,"assets":[]}', now)).toThrow();
    expect(discoverAssetPaths('"https://other.test/assets/a-aaaaaaaa.js" "../../x.js" "data:text/js,a.js"', baseUrl, baseUrl)).toEqual([]);
  });
});
