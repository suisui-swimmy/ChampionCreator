import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CurrentBuildResults, ResultsPanel } from "../App";
import { createAdjustmentExampleState } from "./adjustmentExample";
import { buildCurrentBuildEvaluationInput } from "./currentBuildEvaluationUi";
import { evaluateCurrentBuild } from "../search/currentBuildEvaluation";
import { CalculationProgress } from "./CalculationProgress";

describe("current allocation results", () => {
  it("keeps progress and a disabled common cancel button visible in either idle tab", () => {
    for (const view of ["candidates", "current"] as const) {
      const html = renderToStaticMarkup(<CalculationProgress
        search={{ status: "idle", progress: 0, searchedCandidates: 0, totalCandidates: 0 }}
        current={{ status: "idle" }} view={view} onCancelSearch={() => undefined} onCancelCurrent={() => undefined} />);
      expect(html).toContain('role="progressbar"');
      expect(html).not.toContain('hidden=""');
      expect(html).toMatch(/<button[^>]*aria-label="計算を中止"[^>]*disabled=""/);
      expect(html).toContain("assets/ui/circle-x.svg");
    }
  });
  it("shows the active operation's progress even when its result tab is not selected", () => {
    const html = renderToStaticMarkup(<CalculationProgress
      search={{ status: "complete", progress: 1, searchedCandidates: 1089, totalCandidates: 1089 }}
      current={{ status: "running", progress: 0.5, evaluatedConditions: 2, totalConditions: 4 }}
      view="candidates" onCancelSearch={() => undefined} onCancelCurrent={() => undefined} />);
    expect(html).toContain('aria-label="配分確認の進捗"');
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain("評価 2 / 4");
    expect(html).not.toContain("1089");
    expect(html).not.toContain('disabled=""');
  });
  it("shows current values and requirements with details, without an apply action", () => {
    const { target, scenarios } = createAdjustmentExampleState();
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios));
    const html = renderToStaticMarkup(<CurrentBuildResults state={{ status: "complete", result }} onCheck={() => undefined} />);
    expect(html).toContain("すべての条件を満たしています。");
    expect(html).toContain("現在の結果");
    expect(html).toContain("必要条件");
    expect(html).toContain("ひかえめ");
    expect(html).toContain('class="allocation compact-allocation candidate-stat-spread"');
    expect(html).toContain('aria-label="H 4 / A 0 / B 27 / C 10 / D 0 / S 25 SP"');
    expect(html).toContain("実効S 145");
    expect(html).toContain("S 145以上");
    expect(html.match(/<details /g)).toHaveLength(3);
    expect(html).not.toContain(">適用<");
    expect(html).not.toContain("最低SP");
  });
  it("replaces previous verdicts with an explicit recheck state after editing", () => {
    const html = renderToStaticMarkup(<CurrentBuildResults state={{ status: "stale" }} onCheck={() => undefined} />);
    expect(html).toContain("入力が変更されました。現在の配分は未確認です。");
    expect(html).toContain(">再確認<");
    expect(html).not.toContain("PASS");
    expect(html).not.toContain("FAIL");
  });
  it("offers two labelled tab panels while retaining the existing candidate panel", () => {
    const html = renderToStaticMarkup(<ResultsPanel currentBuildCheckState={{ status: "idle" }} resultView="current"
      candidates={[]} selectedCandidateId={null} appliedCandidateId={null} scenarios={[]} status="idle"
      offenseResults={[]} speedResults={[]} strictestFailureLabel={null} targetLabel="" resultAlertMessage={null}
      onSelectCandidate={() => undefined} onApplyCandidate={() => undefined} />);
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(2);
    expect(html).toContain(">探索候補<");
    expect(html).toContain(">現在の配分<");
    expect(html).toMatch(/candidates-panel" role="tabpanel"[^>]*hidden=""/);
    expect(html).toContain("候補一覧");
  });
  it("uses role-specific control sizes and explicit focus indicators", () => {
    const css = readFileSync(new URL("./currentBuildEvaluation.css", import.meta.url), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
    const desktop = css.slice(0, css.indexOf("@media (max-width: 720px)"));
    expect(desktop).toMatch(/\.current-build-results \.current-build-check-button\s*\{[^}]*min-height: var\(--desktop-control-primary\)/);
    expect(mobile).toMatch(/\.current-build-results \.current-build-check-button\s*\{[^}]*min-height: var\(--mobile-control-primary\)/);
    expect(mobile).toMatch(/\.result-view-tabs button\s*\{[^}]*min-height: var\(--mobile-control-standard\)/);
    expect(css).toContain(".current-build-condition summary:focus-visible");
    expect(css).toContain(".result-view-tabs button:focus-visible");
  });
});
