import { parseShareStateDocument } from "../ui/shareState";
import { describe, expect, it } from "vitest";
import { appVersionInfo } from "../appVersion";
import { createShareTestDocument as createLegacyShareTestDocument, SHARE_TEST_CASES } from "./testFixtures/fixtures";
import { comparableShareJson, encodeSharedAdjustment } from "./urlShareCodec";
import { clearShareImportHref, createSharedAdjustmentUrl, hasShareImportRequest, readSharedAdjustmentHash } from "./sharedAdjustment";

const createShareTestDocument: typeof createLegacyShareTestDocument = (fixture) => parseShareStateDocument(JSON.stringify(createLegacyShareTestDocument(fixture)));

describe("production sharing", () => {
  it("round-trips applied SP, every scenario, and source version without account state", async () => {
    const document = createShareTestDocument(SHARE_TEST_CASES[2]);
    const original = JSON.stringify(document);
    const url = new URL(await createSharedAdjustmentUrl(document, "https://example.com/cc/?tracking=ignored#old"));
    expect(url.pathname).toBe("/cc/");
    expect(url.search).toBe("?import-share=1");
    expect(hasShareImportRequest(url.href)).toBe(true);
    expect(url.hash).toMatch(/^#share=s4\./);
    const shared = await readSharedAdjustmentHash(url.hash);
    expect(comparableShareJson(shared.document)).toBe(comparableShareJson(document));
    expect(shared.provenance).toEqual({ app: appVersionInfo.appVersion, calc: appVersionInfo.smogonCalcVersion });
    expect(JSON.stringify(document)).toBe(original);
    expect(shared.document.scenarios.some((scenario) => !scenario.enabled)).toBe(true);
    expect(Object.keys(shared.document).sort()).toEqual(["scenarios", "schemaVersion", "target"]);
  });

  it("rejects an empty target, invalid external conditions, unsupported versions, and a missing fragment", async () => {
    const document = createShareTestDocument(SHARE_TEST_CASES[0]);
    document.target.pokemonInput = "";
    await expect(createSharedAdjustmentUrl(document, "https://example.com/")).rejects.toThrow("ポケモン");
    await expect(readSharedAdjustmentHash("")).rejects.toThrow("見つかりません");
    await expect(readSharedAdjustmentHash("#share=s99.invalid")).rejects.toThrow("バージョン");
    const malformed = createShareTestDocument(SHARE_TEST_CASES[0]);
    malformed.scenarios[0].attacks[0].repeat = 9999;
    const token = await encodeSharedAdjustment(malformed, { app: "0.31.0", calc: "test" });
    await expect(readSharedAdjustmentHash(`#share=${token}`)).rejects.toThrow("攻撃回数");
    malformed.scenarios[0].attacks[0].repeat = 1;
    malformed.scenarios[0].attacks[0].weather = "invalid" as never;
    await expect(createSharedAdjustmentUrl(malformed, "https://example.com/")).rejects.toThrow("天候");
  });

  it("keeps supported medium links and explicitly rejects oversized generation without deleting conditions", async () => {
    const medium = createShareTestDocument(SHARE_TEST_CASES[3]);
    const url = await createSharedAdjustmentUrl(medium, "https://championcreator.suisui-swimmy.com/");
    expect(url.length).toBeGreaterThan(2000);
    expect(url.length).toBeLessThanOrEqual(4000);
    expect((await readSharedAdjustmentHash(new URL(url).hash)).document.scenarios.flatMap((s) => s.attacks)).toHaveLength(60);
    await expect(createSharedAdjustmentUrl(createShareTestDocument(SHARE_TEST_CASES[6]), "https://championcreator.suisui-swimmy.com/")).rejects.toThrow("4,000文字以内");
  });

  it("detects direct imports and clears their markers without touching unrelated query state", () => {
    const href = "https://example.com/cc/?import-share=1#share=s1.test";
    expect(hasShareImportRequest(href)).toBe(true);
    expect(hasShareImportRequest("https://example.com/cc/")).toBe(false);
    expect(clearShareImportHref(href.replace("?import", "?keep=yes&import"))).toBe("https://example.com/cc/?keep=yes");
  });

  it("generates direct import links from index.html", async () => {
    const direct = await createSharedAdjustmentUrl(createShareTestDocument(SHARE_TEST_CASES[0]), "https://example.com/cc/index.html");
    const url = new URL(direct);
    expect(url.pathname).toBe("/cc/");
    expect(hasShareImportRequest(direct)).toBe(true);
    expect((await readSharedAdjustmentHash(url.hash)).document.target.statPoints).toEqual({ hp: 4, atk: 0, def: 27, spa: 10, spd: 0, spe: 25 });
  });
});
