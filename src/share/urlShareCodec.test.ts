import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { comparableShareJson, decodeShareToken, encodeShareToken, MAX_SHARE_JSON_BYTES, MAX_SHARE_TOKEN_LENGTH } from "./urlShareCodec";
import { createProbeDocument, PROBE_CASES } from "./probe/fixtures";
import { createDefaultBeatUpParticipants } from "../ui/defenceSearchUi";

const tokenFrom = (value: unknown) => `p1.${gzipSync(JSON.stringify(value)).toString("base64url")}`;

describe("URL share transport", () => {
  it.each(PROBE_CASES)("round-trips every field of $id without preserving UI identifiers", async (fixture) => {
    const original = createProbeDocument(fixture);
    const before = JSON.stringify(original);
    const token = await encodeShareToken(original);
    const restored = await decodeShareToken(token);
    expect(comparableShareJson(restored)).toBe(comparableShareJson(original));
    expect(restored.target.statPoints).toEqual({ hp: 4, atk: 0, def: 27, spa: 10, spd: 0, spe: 25 });
    expect(new Set(restored.scenarios.flatMap((s) => s.attacks.map((a) => a.id))).size)
      .toBe(restored.scenarios.reduce((n, s) => n + s.attacks.length, 0));
    expect(JSON.stringify(original)).toBe(before);
    expect(token).toMatch(/^p1\.[A-Za-z0-9_-]+$/);
  });

  it("preserves manual types, power, levels, HP-event order, beat-up slots, and disabled scenarios", async () => {
    const original = createProbeDocument(PROBE_CASES[0]);
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
    const restored = await decodeShareToken(await encodeShareToken(original));
    expect(comparableShareJson(restored)).toBe(comparableShareJson(original));
    expect(restored.scenarios[0].attacks[0].hpEvents.map((e) => e.id)).toEqual(["share-hp-0-0-0", "share-hp-0-0-1"]);
  });

  it("rejects unsupported versions, bad alphabet, truncation, and too-long tokens", async () => {
    const token = await encodeShareToken(createProbeDocument(PROBE_CASES[0]));
    await expect(decodeShareToken(token.replace("p1.", "p2."))).rejects.toThrow("バージョン");
    await expect(decodeShareToken(`${token}%20`)).rejects.toThrow("不正");
    await expect(decodeShareToken(token.slice(0, -10))).rejects.toThrow();
    await expect(decodeShareToken("p1." + "A".repeat(MAX_SHARE_TOKEN_LENGTH))).rejects.toThrow("長すぎ");
  });

  it("bounds decompressed data before JSON parsing, even for a tiny compressed input", async () => {
    const token = tokenFrom("x".repeat(MAX_SHARE_JSON_BYTES + 1));
    expect(token.length).toBeLessThan(1000);
    await expect(decodeShareToken(token)).rejects.toThrow("サイズが上限");
  });

  it("rejects unknown fields, illegal SP, wrong primitive types, and excessive counts", async () => {
    await expect(decodeShareToken(tokenFrom({ s: 13, t: { ownerUid: "not-allowed" }, c: [] }))).rejects.toThrow("形式");
    await expect(decodeShareToken(tokenFrom({ s: 13, t: { statPoints: { hp: 33 } }, c: [] }))).rejects.toThrow("SP");
    await expect(decodeShareToken(tokenFrom({ s: 13, t: { statPoints: { hp: 32, atk: 32, def: 32 } }, c: [] }))).rejects.toThrow("SP");
    await expect(decodeShareToken(tokenFrom({ s: 13, t: { teraEnabled: "false" }, c: [] }))).rejects.toThrow("形式");
    await expect(decodeShareToken(tokenFrom({ s: 13, t: {}, c: Array.from({ length: 65 }, () => ({ attacks: [] })) }))).rejects.toThrow();
    await expect(decodeShareToken(tokenFrom(JSON.parse('{"s":13,"t":{"__proto__":{}},"c":[]}')))).rejects.toThrow("形式");
  });

  it("does not accept values that the existing parser would silently repair", async () => {
    await expect(decodeShareToken(tokenFrom({ s: 13, t: {}, c: [{ adjustmentType: "other", attacks: [] }] }))).rejects.toThrow("正しく復元");
  });
});
