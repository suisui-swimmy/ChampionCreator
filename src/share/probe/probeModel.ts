import { comparableShareJson, decodeShareToken, encodeShareToken } from "../urlShareCodec";
import { createProbeDocument, PROBE_CASES, type ProbeCase } from "./fixtures";
import type { ShareStateDocument } from "../../ui/shareState";

export type ProbeLink = { fixture: ProbeCase; url: string; scenarioCount: number; attackCount: number };
export type ProbeResult =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "error"; message: string; urlLength: number }
  | { status: "success"; fixture: ProbeCase; document: ShareStateDocument; urlLength: number; tokenLength: number };

export const createProbeLink = async (pageUrl: string, fixture: ProbeCase): Promise<ProbeLink> => {
  const document = createProbeDocument(fixture);
  const url = new URL(pageUrl);
  url.search = "";
  url.searchParams.set("case", fixture.id);
  url.hash = `share=${await encodeShareToken(document)}`;
  return { fixture, url: url.href, scenarioCount: document.scenarios.length, attackCount: document.scenarios.reduce((n, s) => n + s.attacks.length, 0) };
};

export const inspectProbeUrl = async (href: string): Promise<ProbeResult> => {
  try {
    const url = new URL(href);
    const cases = url.searchParams.getAll("case");
    if (cases.length === 0 && !url.hash) return { status: "idle" };
    const fixture = PROBE_CASES.find((item) => item.id === cases[0]);
    if (cases.length !== 1 || !fixture) throw new Error("検証ケースを特定できません。元の検証URLをコピーし直してください。");
    // The query survives separately from the fragment: losing the entire #share
    // must be reported as a failure, not mistaken for the generator landing page.
    if (!url.hash.startsWith("#share=")) throw new Error("URL内の共有データが届いていません。リンクの末尾が削られた可能性があります。");
    const token = url.hash.slice("#share=".length);
    const document = await decodeShareToken(token);
    if (comparableShareJson(document) !== comparableShareJson(createProbeDocument(fixture))) {
      throw new Error("復元した内容が元データと一致しません。このリンクは検証不合格です。");
    }
    return { status: "success", fixture, document, urlLength: href.length, tokenLength: token.length };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "検証できませんでした", urlLength: href.length };
  }
};

export const formatProbeReport = (result: ProbeResult, href: string, userAgent: string): string => {
  const page = new URL(href);
  return [
    "ChampionCreator URL共有テスト / 検証版1",
    `結果: ${result.status === "success" ? "復元成功・元データと完全一致" : result.status === "error" ? result.message : "未受信"}`,
    `ケース: ${page.searchParams.get("case") ?? "未指定"}`,
    `URL: ${href.length}文字`,
    `確認日時: ${new Date().toISOString()}`,
    `ブラウザ: ${userAgent}`,
    "経由したSNS: （記入）",
    "開き方: （アプリ内 / Safari・Chrome / PC）",
  ].join("\n");
};
