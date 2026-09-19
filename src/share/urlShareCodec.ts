import { parseShareStateDocument, type ShareStateDocument } from "../ui/shareState";
import { SHARE_ATTACK_V1, SHARE_SCENARIO_V1, SHARE_TARGET_V1 } from "./urlShareDefaultsV1";

const SHARE_LINK_PREFIX = "s1.";
export type ShareProvenance = { app: string; calc: string };
export type SharedAdjustment = { document: ShareStateDocument; provenance: ShareProvenance };
export const MAX_SHARE_TOKEN_LENGTH = 16_384;
export const MAX_SHARE_JSON_BYTES = 200_000;
const MAX_SCENARIOS = 64;
const MAX_ATTACKS = 256;
type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const fail = (message = "共有データの形式が不正です"): never => { throw new Error(message); };

// Sorted keys give an order-independent comparison. UI IDs are reissued on decode.
const comparable = (value: unknown, depth = 0): unknown => {
  if (depth > 12) return fail("共有データの入れ子が深すぎます");
  if (typeof value === "string" && value.length > 512) return fail("共有データの文字列が長すぎます");
  if (typeof value === "number" && !Number.isFinite(value)) return fail();
  if (Array.isArray(value)) {
    if (value.length > MAX_ATTACKS) return fail("共有データの件数が多すぎます");
    return value.map((v) => comparable(v, depth + 1));
  }
  if (!isObject(value)) return value;
  const result: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    if (["__proto__", "constructor", "prototype"].includes(key)) return fail();
    if (key !== "id" && value[key] !== undefined) result[key] = comparable(value[key], depth + 1);
  }
  return result;
};

export const comparableShareJson = (document: unknown): string => JSON.stringify(comparable(document));

const compact = (value: JsonObject, base: JsonObject): JsonObject => Object.fromEntries(
  Object.entries(value)
    .filter(([key, entry]) => comparableShareJson(entry) !== comparableShareJson(base[key]))
    .map(([key, entry]) => [key, isObject(entry) && isObject(base[key]) ? compact(entry, base[key]) : entry]),
);

const expand = (base: object, patch: unknown, optional: string[] = []): JsonObject => {
  if (!isObject(patch)) return fail();
  const result = structuredClone(base) as JsonObject;
  for (const [key, value] of Object.entries(patch)) {
    if (key === "id" || (!Object.hasOwn(base, key) && !optional.includes(key))) return fail();
    const original = result[key];
    if (original !== undefined) {
      if (Array.isArray(original) !== Array.isArray(value) || typeof original !== typeof value || value === null) return fail();
      if (isObject(original)) {
        result[key] = expand(original, value);
        continue;
      }
    }
    result[key] = value;
  }
  return result;
};

const checkStats = (value: unknown, enforceTotal: boolean) => {
  if (!isObject(value)) return fail();
  const stats = ["hp", "atk", "def", "spa", "spd", "spe"].map((key) => value[key]);
  if (stats.some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 32)
    || (enforceTotal && (stats as number[]).reduce((sum, v) => sum + v, 0) > 66)) return fail("共有データのSP配分が不正です");
};

const decodeCompact = (value: unknown): ShareStateDocument => {
  comparable(value); // Limits and unsafe-key rejection before object expansion.
  if (!isObject(value) || value.s !== 13 || Object.keys(value).some((key) => !["s", "t", "c"].includes(key))
    || !Array.isArray(value.c) || value.c.length > MAX_SCENARIOS) return fail();
  const target = expand(SHARE_TARGET_V1, value.t, ["pokemonCanonicalName", "typeOverride"]);
  checkStats(target.statPoints, true);
  if (Object.values(target.boosts as JsonObject).some((n) => typeof n !== "number" || !Number.isInteger(n) || n < -6 || n > 6)) return fail();
  let attackCount = 0;
  const scenarios = value.c.map((scenario, i) => {
    if (!isObject(scenario) || !Array.isArray(scenario.attacks) || scenario.attacks.length > 16) return fail();
    attackCount += scenario.attacks.length;
    if (attackCount > MAX_ATTACKS) return fail("共有データの攻撃件数が多すぎます");
    const { attacks, ...fields } = scenario;
    return {
      ...expand(SHARE_SCENARIO_V1, fields), id: `share-s-${i}`,
      attacks: attacks.map((attack, j) => {
        const expanded = expand(SHARE_ATTACK_V1, attack, ["attackerPokemonCanonicalName", "attackerTypeOverride"]);
        // Existing opponent forms retain values for multiple adjustment axes;
        // even the built-in speed example keeps A32/C32/S32. Preserve them.
        checkStats(expanded.attackerStatPoints, false);
        for (const key of ["attackerBoosts", "defenderBoosts"]) {
          if (Object.values(expanded[key] as JsonObject).some((n) => typeof n !== "number" || !Number.isInteger(n) || n < -6 || n > 6)) return fail();
        }
        if (!Array.isArray(expanded.hpEvents) || expanded.hpEvents.length > 32
          || !Array.isArray(expanded.beatUpParticipants) || expanded.beatUpParticipants.length > 4) return fail();
        const withIds = (items: unknown[], kind: string) => items.map((item, k) => {
          if (!isObject(item)) return fail();
          return { ...item, id: `share-${kind}-${i}-${j}-${k}` };
        });
        return {
          ...expanded, id: `share-a-${i}-${j}`,
          hpEvents: withIds(expanded.hpEvents, "hp"),
          beatUpParticipants: withIds(expanded.beatUpParticipants, "beat"),
        };
      }),
    };
  });
  const document = { schemaVersion: 13, target, scenarios };
  const parsed = parseShareStateDocument(JSON.stringify(document));
  // A damaged link must not appear valid after the legacy parser fills/clamps values.
  if (comparableShareJson(parsed) !== comparableShareJson(document)) return fail("共有データの値を正しく復元できません");
  return parsed;
};

const readBounded = async (stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return fail("共有データのサイズが上限を超えています");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
};

const ensureCompression = () => {
  if (typeof CompressionStream === "undefined" || typeof DecompressionStream === "undefined") {
    return fail("このブラウザはURLの圧縮・復元に対応していません。最新版のSafariまたはChromeで開いてください。");
  }
};

const encodeEnvelope = async (document: ShareStateDocument, provenance: ShareProvenance): Promise<string> => {
  ensureCompression();
  if (document.schemaVersion !== 13) return fail("この共有形式では条件schema 13のみ共有できます");
  const clean = JSON.parse(comparableShareJson(document)) as ShareStateDocument;
  const payload = {
    s: 13,
    t: compact(clean.target as unknown as JsonObject, SHARE_TARGET_V1 as unknown as JsonObject),
    c: clean.scenarios.map(({ attacks, ...fields }) => ({
      ...compact(fields, SHARE_SCENARIO_V1),
      attacks: attacks.map((attack) => compact(attack as unknown as JsonObject, SHARE_ATTACK_V1 as unknown as JsonObject)),
    })),
  };
  decodeCompact(payload);
  const bytes = new TextEncoder().encode(JSON.stringify({ ...payload, v: provenance }));
  if (bytes.length > MAX_SHARE_JSON_BYTES) return fail("共有データのサイズが上限を超えています");
  const compressed = await readBounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")), MAX_SHARE_JSON_BYTES);
  const token = SHARE_LINK_PREFIX + btoa(Array.from(compressed, (v) => String.fromCharCode(v)).join(""))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (token.length > MAX_SHARE_TOKEN_LENGTH) return fail("共有URLが長すぎます");
  return token;
};

const decodeEnvelope = async (token: string): Promise<unknown> => {
  ensureCompression();
  if (token.length > MAX_SHARE_TOKEN_LENGTH) return fail("共有URLが長すぎます");
  if (!token.startsWith(SHARE_LINK_PREFIX)) return fail("対応していない共有URLのバージョンです");
  const encoded = token.slice(SHARE_LINK_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length % 4 === 1) return fail("共有URLの文字列が欠けているか、不正です");
  try {
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), (v) => v.charCodeAt(0));
    const decoded = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")), MAX_SHARE_JSON_BYTES);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch (error) {
    if (error instanceof Error && /共有|条件JSON/.test(error.message)) throw error;
    return fail("共有URLを復元できません。リンクが途中で切れていないか確認してください。");
  }
};

const validateProvenance = (value: unknown): ShareProvenance => {
  if (!isObject(value) || Object.keys(value).sort().join() !== "app,calc"
    || typeof value.app !== "string" || typeof value.calc !== "string"
    || !/^[a-zA-Z0-9.+_-]{1,128}$/.test(value.app) || !/^[a-zA-Z0-9.+_-]{1,256}$/.test(value.calc)) return fail("共有URLの作成バージョンが不正です");
  return { app: value.app, calc: value.calc };
};

export const encodeSharedAdjustment = (document: ShareStateDocument, provenance: ShareProvenance): Promise<string> =>
  encodeEnvelope(document, validateProvenance(provenance));

export const decodeSharedAdjustment = async (token: string): Promise<SharedAdjustment> => {
  const envelope = await decodeEnvelope(token);
  if (!isObject(envelope)) return fail();
  const { v, ...payload } = envelope;
  return { document: decodeCompact(payload), provenance: validateProvenance(v) };
};
