import { parseShareStateDocument } from "../ui/shareState";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { comparableShareJson, decodeSharedAdjustment, encodeSharedAdjustment, MAX_SHARE_JSON_BYTES, MAX_SHARE_TOKEN_LENGTH } from "./urlShareCodec";
import { createShareTestDocument as createLegacyShareTestDocument, SHARE_TEST_CASES } from "./testFixtures/fixtures";
import { createDefaultBeatUpParticipants } from "../ui/defenceSearchUi";

const createShareTestDocument: typeof createLegacyShareTestDocument = (fixture) => parseShareStateDocument(JSON.stringify(createLegacyShareTestDocument(fixture)));

const provenance = { app: "0.31.3", calc: "test" };
const encode = (document: Parameters<typeof encodeSharedAdjustment>[0]) => encodeSharedAdjustment(document, provenance);
const decode = async (token: string) => (await decodeSharedAdjustment(token)).document;
const tokenFrom = (value: unknown, version: unknown = provenance) => {
  const envelope = typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value, v: version } : value;
  return `s1.${gzipSync(JSON.stringify(envelope)).toString("base64url")}`;
};

describe("URL share transport", () => {
  it("preserves a frozen s2 link with one use per offense card", async () => {
    const token = readFileSync(new URL("./testFixtures/example.s2.txt", import.meta.url), "utf8").trim();
    const shared = await decodeSharedAdjustment(token);
    expect(comparableShareJson(shared.document)).toBe(comparableShareJson(createShareTestDocument(SHARE_TEST_CASES[0])));
    expect(shared.provenance).toEqual({ app: "0.33.1", calc: "compatibility-fixture" });
    expect(shared.document.scenarios.filter((scenario) => scenario.adjustmentType === "offense")
      .flatMap((scenario) => scenario.attacks).every((attack) => (attack.offenseMoveUses ?? 1) === 1)).toBe(true);
  });
  it("preserves a link generated before removing the standalone pages", async () => {
    const token = readFileSync(new URL("./testFixtures/example.s1.txt", import.meta.url), "utf8").trim();
    const shared = await decodeSharedAdjustment(token);
    expect(comparableShareJson(shared.document)).toBe(comparableShareJson(createShareTestDocument(SHARE_TEST_CASES[0])));
    expect(shared.provenance).toEqual({ app: "0.31.3", calc: "compatibility-fixture" });
  });

  it("requires valid source versions and rejects the retired probe format", async () => {
    const original = createShareTestDocument(SHARE_TEST_CASES[0]);
    const token = await encode(original);
    await expect(decodeSharedAdjustment(token.replace("s4.", "p1."))).rejects.toThrow("バージョン");
    expect(() => encodeSharedAdjustment(original, { app: "<invalid>", calc: "test" })).toThrow("作成バージョン");
    await expect(decodeSharedAdjustment(tokenFrom({ s: 13, t: {}, c: [] }, { app: "0.31.3" }))).rejects.toThrow("作成バージョン");
  });

  it.each(SHARE_TEST_CASES)("round-trips every field of $id without preserving UI identifiers", async (fixture) => {
    const original = createShareTestDocument(fixture);
    const before = JSON.stringify(original);
    const token = await encode(original);
    const restored = await decode(token);
    expect(comparableShareJson(restored)).toBe(comparableShareJson(original));
    expect(restored.target.statPoints).toEqual({ hp: 4, atk: 0, def: 27, spa: 10, spd: 0, spe: 25 });
    expect(new Set(restored.scenarios.flatMap((s) => s.attacks.map((a) => a.id))).size)
      .toBe(restored.scenarios.reduce((n, s) => n + s.attacks.length, 0));
    expect(JSON.stringify(original)).toBe(before);
    expect(token).toMatch(/^s4\.[A-Za-z0-9_-]+$/);
  });

  it("preserves manual types, power, levels, HP-event order, beat-up slots, and disabled scenarios", async () => {
    const original = createShareTestDocument(SHARE_TEST_CASES[0]);
    original.target.level = 75;
    original.target.levelMode = "manual";
    original.target.typeOverride = { type1Input: "ほのお", type2Input: "ひこう", addedTypeInput: "" };
    original.target.teraEnabled = true;
    original.target.teraTypeInput = "みず";
    original.target.boosts = { atk: 2, def: -1, spa: 3, spd: 0, spe: 1 };
    const attack = original.scenarios[0].attacks[0];
    attack.moveInput = "ふくろだたき";
    attack.gameType = "doubles";
    attack.beatUpParticipants = createDefaultBeatUpParticipants(attack.id);
    attack.hpEvents = [
      { id: "hp-1", effectId: "life-orb-recoil", enabled: true },
      { id: "hp-2", effectId: "life-orb-recoil", enabled: false },
    ];
    original.scenarios[1].enabled = false;
    const restored = await decode(await encode(original));
    expect(comparableShareJson(restored)).toBe(comparableShareJson(original));
    expect(restored.scenarios[0].attacks[0].hpEvents.map((e) => e.id)).toEqual(["share-hp-0-0-0", "share-hp-0-0-1"]);
  });

  it("rejects unsupported versions, bad alphabet, truncation, and too-long tokens", async () => {
    const token = await encode(createShareTestDocument(SHARE_TEST_CASES[0]));
    await expect(decode(token.replace("s4.", "s5."))).rejects.toThrow("バージョン");
    await expect(decode(`${token}%20`)).rejects.toThrow("不正");
    await expect(decode(token.slice(0, -10))).rejects.toThrow();
    await expect(decode("s1." + "A".repeat(MAX_SHARE_TOKEN_LENGTH))).rejects.toThrow("長すぎ");
  });

  it("bounds decompressed data before JSON parsing, even for a tiny compressed input", async () => {
    const token = tokenFrom("x".repeat(MAX_SHARE_JSON_BYTES + 1));
    expect(token.length).toBeLessThan(1000);
    await expect(decode(token)).rejects.toThrow("サイズが上限");
  });

  it("rejects unknown fields, illegal SP, wrong primitive types, and excessive counts", async () => {
    await expect(decode(tokenFrom({ s: 13, t: { ownerUid: "not-allowed" }, c: [] }))).rejects.toThrow("形式");
    await expect(decode(tokenFrom({ s: 13, t: { statPoints: { hp: 33 } }, c: [] }))).rejects.toThrow("SP");
    await expect(decode(tokenFrom({ s: 13, t: { statPoints: { hp: 32, atk: 32, def: 32 } }, c: [] }))).rejects.toThrow("SP");
    await expect(decode(tokenFrom({ s: 13, t: { teraEnabled: "false" }, c: [] }))).rejects.toThrow("形式");
    await expect(decode(tokenFrom({ s: 13, t: {}, c: Array.from({ length: 65 }, () => ({ attacks: [] })) }))).rejects.toThrow();
    await expect(decode(tokenFrom(JSON.parse('{"s":13,"t":{"__proto__":{}},"c":[]}')))).rejects.toThrow("形式");
  });

  it("does not accept values that the existing parser would silently repair", async () => {
    await expect(decode(tokenFrom({ s: 13, t: {}, c: [{ adjustmentType: "other", attacks: [] }] }))).rejects.toThrow("正しく復元");
  });
});
