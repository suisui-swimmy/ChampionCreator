import { getDefenceCumulativeCountLimit } from "../ui/defenceSearchUi";
import { appVersionInfo } from "../appVersion";
import { resolveEntityWithCanonicalHint } from "../localization/resolver";
import type { ShareStateDocument } from "../ui/shareState";
import { decodeSharedAdjustment, encodeSharedAdjustment, type SharedAdjustment } from "./urlShareCodec";

export const SHARE_URL_WARNING_LENGTH = 2_000;
export const SHARE_URL_MAX_LENGTH = 4_000;

const requireValue = (valid: boolean, label: string) => { if (!valid) throw new Error(`共有データの${label}が不正です`); };
const inRange = (value: number, min: number, max: number) => Number.isInteger(value) && value >= min && value <= max;
const statuses = ["none", "slp", "psn", "brn", "frz", "par", "tox"];
const multipliers = ["auto", "2", "1.5", "0.5"];

/** External links must not rely on the UI conversion layer clamping invalid input. */
export const validateSharedConditions = (document: ShareStateDocument, legacyCumulativeLimit = false): void => {
  for (const scenario of document.scenarios) {
    for (const attack of scenario.attacks) {
      requireValue(inRange(attack.repeat, 1, 10), "攻撃回数");
      requireValue(inRange(attack.requiredSurvivedHits, 1,
        !legacyCumulativeLimit && scenario.adjustmentType === "defence" ? getDefenceCumulativeCountLimit(scenario) : 10), "累計回数");
      requireValue(Number.isFinite(attack.minSurvivalProbabilityPercent) && attack.minSurvivalProbabilityPercent >= 0 && attack.minSurvivalProbabilityPercent <= 100
        && Number.isFinite(attack.targetKoProbabilityPercent) && attack.targetKoProbabilityPercent >= 0 && attack.targetKoProbabilityPercent <= 100, "確率");
      requireValue([attack.attackerStatus, attack.defenderStatus, attack.speedTargetStatus].every((v) => statuses.includes(v)), "状態異常");
      requireValue(["none", "sun", "rain", "sand", "snow"].includes(attack.weather), "天候");
      requireValue(["none", "electric", "grassy", "misty", "psychic"].includes(attack.terrain), "フィールド");
      requireValue([attack.speedTargetItemMultiplier, attack.speedTargetAbilityMultiplier, attack.speedItemMultiplier, attack.speedAbilityMultiplier].every((v) => multipliers.includes(v)), "素早さ補正");
      requireValue(inRange(attack.speedTargetValue, 0, 10_000) && inRange(attack.speedRequiredOffset, 0, 10_000), "素早さ条件");
      for (const event of attack.hpEvents) {
        requireValue(typeof event.enabled === "boolean", "HP効果");
        if (event.toxicStage !== undefined) requireValue(inRange(event.toxicStage, 1, 15), "もうどくの段階");
        if (event.spikesLayers !== undefined) requireValue(inRange(event.spikesLayers, 1, 3), "まきびしの層数");
      }
    }
  }
};

export const createSharedAdjustmentUrl = async (document: ShareStateDocument, applicationUrl: string): Promise<string> => {
  const target = resolveEntityWithCanonicalHint("pokemon", document.target.pokemonInput, document.target.pokemonCanonicalName);
  if (target.status !== "exact" && target.status !== "alias") throw new Error("共有する調整対象のポケモンを選択してください");
  validateSharedConditions(document);
  const base = new URL(applicationUrl);
  base.search = ""; base.hash = "";
  const url = new URL("./", base);
  url.searchParams.set("import-share", "1");
  url.hash = `share=${await encodeSharedAdjustment(document, { app: appVersionInfo.appVersion, calc: appVersionInfo.smogonCalcVersion })}`;
  if (url.href.length > SHARE_URL_MAX_LENGTH) throw new Error(`共有URLが${url.href.length.toLocaleString()}文字になりました。4,000文字以内になるよう、不要なシナリオや攻撃を減らしてください。`);
  return url.href;
};

export const readSharedAdjustmentHash = async (hash: string): Promise<SharedAdjustment> => {
  if (!hash.startsWith("#share=")) throw new Error("共有データが見つかりません。リンク全体をコピーして開き直してください。");
  const shared = await decodeSharedAdjustment(hash.slice(7));
  validateSharedConditions(shared.document, hash.startsWith("#share=s1."));
  return shared;
};

export const hasShareImportRequest = (href: string): boolean => new URL(href).searchParams.has("import-share");
export const clearShareImportHref = (href: string): string => {
  const url = new URL(href);
  url.searchParams.delete("import-share");
  if (url.hash.startsWith("#share=")) url.hash = "";
  return url.href;
};
