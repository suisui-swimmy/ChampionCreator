import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getShareImportSummary, ShareImportSummary } from "./ShareImportSummary";
import { ShareImportDialog } from "./ShareImportDialog";
import { createProbeDocument, PROBE_CASES } from "./probe/fixtures";

describe("share import preview", () => {
  it("shows the stored six-stat allocation and actual stats without changing the input", () => {
    const document = createProbeDocument(PROBE_CASES[0]);
    const original = JSON.stringify(document);
    expect(getShareImportSummary(document.target).actualStats).toEqual({ hp: 157, atk: 111, def: 125, spa: 207, spd: 135, spe: 145 });
    const html = renderToStaticMarkup(<ShareImportSummary target={document.target} scenarioCount={3} />);
    expect(html).toContain("メガリザードンY");
    expect(html).toContain("/ 3シナリオ");
    expect(html).toContain("assets/official-artwork/6-mega-y.png");
    expect([...html.matchAll(/class="stat-icon share-import-stat-icon"[^>]*alt="([HABCDS])"/g)].map((match) => match[1])).toEqual(["H", "A", "B", "C", "D", "S"]);
    for (const stat of ["H", "A", "B", "C", "D", "S"]) expect(html).toContain(`assets/stat-icons/${stat}.svg`);
    expect(html).toContain('aria-label="H 4SP"');
    expect(html).toContain('aria-label="A 0SP"');
    expect(html).toContain('aria-label="H 実数値 157"');
    expect(html).toContain('aria-label="S 実数値 145"');
    expect(html).not.toContain("Charizard-Mega-Y");
    expect(JSON.stringify(document)).toBe(original);
  });

  it("recalculates different allocations and uses maxHP for Dynamax", () => {
    const { target } = createProbeDocument(PROBE_CASES[0]);
    target.statPoints = { hp: 32, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
    expect(getShareImportSummary(target).actualStats?.hp).toBe(185);
    target.dmaxEnabled = true;
    expect(getShareImportSummary(target).actualStats?.hp).toBe(370);
  });

  it("keeps SP visible while marking an unresolved actual-stat preview unavailable", () => {
    const { target } = createProbeDocument(PROBE_CASES[0]);
    target.pokemonInput = "未登録のポケモン";
    delete target.pokemonCanonicalName;
    const html = renderToStaticMarkup(<ShareImportSummary target={target} scenarioCount={0} />);
    expect(html).toContain('aria-label="H 4SP"');
    expect(html).toContain('aria-label="H 実数値 表示できません"');
    expect(html).toContain("実数値を表示できません");
    expect(html).toContain("share-import-artwork-placeholder");
  });

  it("groups the three actions together and uses the shared close asset and primitive", () => {
    const shared = { document: createProbeDocument(PROBE_CASES[0]), provenance: { app: "0.31.2", calc: "test" } };
    const html = renderToStaticMarkup(<ShareImportDialog state={{ status: "ready", shared }} error="" hasWork canImport scopeLabel="このブラウザ" onUse={() => {}} onSave={() => {}} onClose={() => {}} />);
    const start = html.indexOf('class="share-actions share-import-actions"');
    const actions = html.slice(start, html.indexOf("</div>", start));
    expect(actions.match(/<button /g)).toHaveLength(3);
    expect(actions.indexOf("作業に読み込む")).toBeLessThan(actions.indexOf("ボックスに追加"));
    expect(actions.indexOf("ボックスに追加")).toBeLessThan(actions.indexOf("キャンセル"));
    expect(html).toContain("assets/ui/close.svg");
    expect(html).toContain("ui-button-ghost ui-button-icon ghost-button share-close");
    const css = readFileSync(new URL("./share.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.share-import-actions \{[^}]*flex-wrap: nowrap;/);
    expect(css).toMatch(/\.share-import-cancel \{[^}]*margin-left: auto;/);
    expect(css).toMatch(/\.share-close\.ui-button \{[^}]*width: var\(--desktop-control-standard\);[^}]*height: var\(--desktop-control-standard\);/);
    expect(css).toMatch(/\.share-import-stats \.share-import-stat-icon \{[^}]*filter: brightness\(0\) invert\(1\);/);
  });
});
