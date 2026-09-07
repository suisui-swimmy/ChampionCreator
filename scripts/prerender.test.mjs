import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { injectPrerenderedApp, pngToIco } from "./prerender.mjs";

describe("static app build", () => {
  it("preserves metadata and entry scripts while adding real body content", () => {
    const html = '<head><link rel="canonical" href="https://example.test/"></head><body><div id="root"></div><script src="./app.js"></script></body>';
    const markup = '<main class="app-shell"><h1>調整対象</h1><a href="./guide/">使い方ガイド</a></main>';
    expect(injectPrerenderedApp(html, markup)).toBe(html.replace('<div id="root"></div>', `<div id="root">${markup}</div>`));
    expect(() => injectPrerenderedApp(html, "")).toThrow();
    expect(() => injectPrerenderedApp(html + '<div id="root"></div>', markup)).toThrow();
  });
  it("packages the existing PNG as a valid single-image ICO without changing the artwork", () => {
    const png = readFileSync("public/assets/icons/favicon-32.png");
    const ico = pngToIco(png);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(1);
    expect(ico.readUInt32LE(18)).toBe(22);
    expect(ico.subarray(22)).toEqual(png);
  });
});
