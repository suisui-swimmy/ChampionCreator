import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { maximizeRemainingBulk } from "../search/maximizeRemainingBulk";
import { buildMaximizeRemainingBulkInputFromUi, createDefaultTargetForm, applyMaximizeRemainingBulkToTarget } from "./defenceSearchUi";
import { BulkMaximizeCandidates, BulkCandidateRow, getBulkCandidateKey, getBulkCandidatePage } from "./BulkMaximizeCandidates";

const target = { ...createDefaultTargetForm(), pokemonInput: "みがわり", natureInput: "", statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } };
const results = maximizeRemainingBulk(buildMaximizeRemainingBulkInputFromUi(target, [], { allowNatureChange: false }), { maxResults: 50 });

describe("bulk candidate comparison", () => {
  it("renders the annotated Garchomp stats with SP directly beneath each value and the shared apply style", () => {
    const form = { ...target, pokemonInput: "ガブリアス", natureInput: "ようき" };
    const candidates = maximizeRemainingBulk(buildMaximizeRemainingBulkInputFromUi(form, [], { allowNatureChange: false }), { maxResults: 50 });
    const html = renderToStaticMarkup(<BulkMaximizeCandidates results={candidates} appliedKey={null} onApply={() => undefined} />);
    expect(html).toContain("13652.5");
    expect(html).toContain('<strong>215</strong><span aria-label="H 32SP">(32)</span>');
    expect(html).toContain('<strong>127</strong><span aria-label="B 12SP">(12)</span>');
    expect(html).toContain('<strong>127</strong><span aria-label="D 22SP">(22)</span>');
    expect(html).not.toContain("詳細");
    expect(html).not.toContain("ui-button-primary");
    const css = readFileSync(new URL("./BulkMaximizeCandidates.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.bulk-candidate-stat dd\s*\{[^}]*display: grid;[^}]*justify-items: start;/);
    expect(css).toMatch(/\.bulk-candidate-layout > \.bulk-candidate-stats\s*\{[^}]*grid-column: 1;[^}]*grid-row: 2;[^}]*align-self: center;/);
    expect(css).toMatch(/\.bulk-candidate-layout > \.bulk-candidate-apply\s*\{[^}]*grid-column: 2;[^}]*grid-row: 2;[^}]*align-self: center;/);
    const metaStart = css.indexOf(".bulk-candidate-meta {");
    expect(css.slice(metaStart, css.indexOf("}", metaStart))).not.toContain("border-bottom");
  });

  it("keeps just one compact result on the main page and omits details while keeping comparison closed", () => {
    const html = renderToStaticMarkup(<BulkMaximizeCandidates results={results} appliedKey={null} onApply={() => undefined} />);
    expect(html).toContain("候補を比較（50件）");
    expect(html).toContain("19932");
    expect(html).toContain("302");
    expect(html).toContain(">(2)</span>");
    expect(html.match(/class="bulk-candidate-stats"/g)).toHaveLength(1);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("<dialog");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("詳細");
    expect(html).not.toContain("ui-button-primary");
    expect(html).not.toContain("残りSP");
    expect(html.indexOf("候補を比較（50件）")).toBeLessThan(html.indexOf('class="bulk-candidate-layout"'));
    expect(html.indexOf('class="bulk-candidate-meta"')).toBeLessThan(html.indexOf('class="bulk-candidate-stats"'));
  });

  it("paginates 50 results as 20/20/10 on desktop and five on mobile without mutating order", () => {
    const before = [...results];
    expect(getBulkCandidatePage(results, 1, 20).rows).toHaveLength(20);
    expect(getBulkCandidatePage(results, 2, 20).rows[0].result).toBe(results[20]);
    expect(getBulkCandidatePage(results, 3, 20).rows).toHaveLength(10);
    expect(getBulkCandidatePage(results, 10, 5).rows.at(-1)?.result).toBe(results[49]);
    expect(getBulkCandidatePage(results, 10, 20)).toMatchObject({ page: 3, pageCount: 3 });
    expect(results).toEqual(before);
  });

  it("assigns equal unrounded scores the same rank across page boundaries", () => {
    const scores = [100, 100, 99, 99, 99, 99, 98.04, 98.03];
    const rankedResults = scores.map((overallBulk) => ({ ...results[0], score: { ...results[0].score, overallBulk } }));
    expect(getBulkCandidatePage(rankedResults, 1, 5).rows.map((row) => row.rank)).toEqual([1, 1, 3, 3, 3]);
    expect(getBulkCandidatePage(rankedResults, 2, 5).rows.map((row) => row.rank)).toEqual([3, 7, 8]);
  });

  it("applies a lower-ranked result and identifies its nature and full SP allocation", () => {
    const selected = results[24];
    const applied = applyMaximizeRemainingBulkToTarget(target, selected);
    expect(applied.statPoints).toEqual(selected.candidate.statPoints);
    expect(applied.statPoints).not.toEqual(results[0].candidate.statPoints);
    expect(getBulkCandidateKey(selected)).not.toBe(getBulkCandidateKey(results[0]));
    const natureVariant = { ...selected, candidate: { ...selected.candidate, natureCanonicalName: "Bold" } };
    expect(getBulkCandidateKey(natureVariant)).not.toBe(getBulkCandidateKey(selected));
    const html = renderToStaticMarkup(<BulkCandidateRow result={selected} rank={25} applied onApply={() => undefined} />);
    expect(html).toContain("適用済み");
    expect(html).toContain('aria-label="25位');
    expect(html).not.toContain("物理耐久");
    expect(html).not.toContain("特殊耐久");
    expect(html).not.toContain("総合耐久の変化");
    expect(html).not.toContain("ui-button-primary");
    expect(html).not.toContain("<span>総合耐久指数</span>");
    expect(html).toContain('role="group" aria-label="総合耐久指数"');
    expect(html).not.toContain("詳細");
    expect(html).not.toMatch(/\(\d+SP\)/);
  });

  it("handles empty and single-result sets without inventing extra candidates", () => {
    expect(renderToStaticMarkup(<BulkMaximizeCandidates results={[]} appliedKey={null} onApply={() => undefined} />)).toBe("");
    expect(getBulkCandidatePage([results[0]], 2, 5)).toMatchObject({ page: 1, pageCount: 1, end: 1 });
    expect(renderToStaticMarkup(<BulkMaximizeCandidates results={[results[0]]} appliedKey={null} onApply={() => undefined} />)).toContain("候補を比較（1件）");
  });

  it("uses the CC modal, scrolling, mobile breakpoint and control-size contracts", () => {
    const css = readFileSync(new URL("./BulkMaximizeCandidates.css", import.meta.url), "utf8");
    const comparison = css.slice(css.indexOf(".bulk-comparison-dialog {"), css.length);
    expect(comparison).toContain("width: min(var(--bulk-comparison-width, 100%), calc(100% - 24px))");
    expect(comparison).not.toContain("820px");
    expect(comparison).toMatch(/\.bulk-comparison-close\.ui-button\s*\{[^}]*width: var\(--desktop-control-standard\);[^}]*height: var\(--desktop-control-standard\);/);
    expect(comparison).toMatch(/\.bulk-comparison-close img\s*\{[^}]*width: var\(--desktop-icon-standard\);/);
    expect(comparison).toContain("max-height: calc(100dvh - 48px)");
    expect(comparison).toContain(".bulk-comparison-dialog[open] { display: flex; flex-direction: column; }");
    expect(comparison).toContain("overscroll-behavior: contain");
    expect(comparison).toContain("@media (max-width: 720px)");
    expect(comparison).toContain("min-height: var(--desktop-control-primary)");
    expect(comparison).toContain("min-height: var(--mobile-control-primary)");
  });
});
