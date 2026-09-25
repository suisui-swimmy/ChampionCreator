import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CurrentBuildResults, ResultsPanel } from "../App";
import { createAdjustmentExampleState } from "./adjustmentExample";
import { buildCurrentBuildEvaluationInput } from "./currentBuildEvaluationUi";
import { evaluateCurrentBuild } from "../search/currentBuildEvaluation";
import { CalculationProgress } from "./CalculationProgress";
import { initializeOffenseScenario } from "./defenceSearchUi";

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
    expect(html).toContain("実数値 S 145");
    expect(html).not.toContain("実効S");
    expect(html).toContain('class="current-condition-chevron disclosure-chevron"');
    expect(html).toContain("S 145以上");
    expect(html).toContain("シナリオ1 / 耐久調整A / いわなだれ");
    expect(html).toContain("シナリオ2 / 火力調整A / ソーラービーム");
    expect(html).toContain("シナリオ3 / 素早さ調整A");
    expect(html).toContain("S25 / 自分 145 / 相手 143 / 抜ける");
    expect(html).not.toContain('class="current-condition-label"');
    expect(html).not.toContain("攻撃A / いわなだれ");
    expect(html.match(/<details /g)).toHaveLength(3);
    expect(html).not.toContain(">適用<");
    expect(html).not.toContain("最低SP");
  });
  it("limits verdict styling to the same status dots and badges used by candidate details", () => {
    const { target, scenarios } = createAdjustmentExampleState();
    scenarios[0].attacks[0].minSurvivalProbabilityPercent = 100;
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios));
    const html = renderToStaticMarkup(<CurrentBuildResults state={{ status: "complete", result }} onCheck={() => undefined} />);
    expect(html).toContain('class="current-build-condition" data-status="fail"');
    expect(html).toContain('class="current-build-condition" data-status="pass"');
    expect(html).toContain('class="candidate-scenario-status current-condition-heading"');
    expect(html).toContain('class="status-dot badge red"');
    expect(html).toContain('class="current-condition-status fail-badge">FAIL</em>');
    expect(html).toContain('class="current-condition-status">PASS</em>');
    expect(html).not.toMatch(/class="current-build-(?:condition|summary) (?:pass|fail)"/);
    expect(html).toContain("生存率 93.8%");
    expect(html).toContain("1回耐久・100.0%以上");
    const css = readFileSync(new URL("./currentBuildEvaluation.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.current-condition-details\s*\{[^}]*color: var\(--text\);[^}]*font-weight: 400;/);
    expect(css).toMatch(/\.current-condition-detail-label\s*\{[^}]*color: var\(--gold\);/);
  });
  it.each([
    ["incomplete", "入力不足"], ["unresolved", "未解決"], ["unsupported", "計算未対応"], ["invalid", "入力エラー"],
  ] as const)("keeps %s distinct from FAIL while keeping its explanation readable", (status, label) => {
    const html = renderToStaticMarkup(<CurrentBuildResults state={{ status: "complete", result: {
      status: "blocked", conditions: [{ id: "issue", scenarioId: "s1", scenarioLabel: "シナリオ1", label: "シナリオ1", kind: "defence", status, message: "条件を確認してください" }],
    } }} onCheck={() => undefined} />);
    expect(html).toContain(`class="current-condition-status current-condition-unchecked">${label}</em>`);
    expect(html).toContain("条件を確認してください");
    expect(html).not.toContain("FAIL");
  });
  it("preserves sequence counts and custom card names in the same detail structure", () => {
    const { target, scenarios } = createAdjustmentExampleState();
    scenarios[0].attacks[0].label = "スカーフ / 岩技";
    scenarios[1] = initializeOffenseScenario(scenarios[1]);
    scenarios[1].attacks[0].label = "攻撃A";
    scenarios[1].attacks[0].offenseMoveUses = 2;
    scenarios[1].attacks.push({ ...scenarios[1].attacks[0], id: "second", label: "追撃", offenseMoveUses: 1 });
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios));
    const html = renderToStaticMarkup(<CurrentBuildResults state={{ status: "complete", result }} onCheck={() => undefined} />);
    expect(html).toContain("シナリオ1 / スカーフ / 岩技 / いわなだれ");
    expect(html).toContain("シナリオ2 / 火力調整A / ソーラービーム");
    expect(html).toContain("シナリオ2 / 追撃 / ソーラービーム");
    expect(html).toContain("攻撃回数 2 / 累計回数 2");
    expect(html).toContain("攻撃回数 1 / 累計回数 3");
    expect(html).toContain("攻撃後の残りHP");
  });
  it("identifies multiple speed conditions in one scenario even while collapsed", () => {
    const { target, scenarios } = createAdjustmentExampleState();
    scenarios[2].attacks.push({ ...scenarios[2].attacks[0], id: "second-speed", label: "S調整B" });
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios));
    const html = renderToStaticMarkup(<CurrentBuildResults state={{ status: "complete", result }} onCheck={() => undefined} />);
    expect(html).toContain('class="current-condition-label">素早さ調整A</span>');
    expect(html).toContain('class="current-condition-label">素早さ調整B</span>');
  });
  it("reads each collapsed row in name, current value, requirement, verdict order", () => {
    const { target, scenarios } = createAdjustmentExampleState();
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios));
    const html = renderToStaticMarkup(<CurrentBuildResults state={{ status: "complete", result }} onCheck={() => undefined} />);
    const summaries = [...html.matchAll(/<summary\b[^>]*>(.*?)<\/summary>/g)].map((match) => match[1]);
    expect(summaries).toHaveLength(3);
    for (const summary of summaries) {
      const columns = ["current-condition-name", "current-condition-actual", "current-condition-requirement", "current-condition-status", "current-condition-chevron"];
      const positions = columns.map((column) => summary.indexOf(column));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
    const css = readFileSync(new URL("./currentBuildEvaluation.css", import.meta.url), "utf8");
    const wide = css.slice(0, css.indexOf("@container"));
    const compact = css.slice(css.indexOf("@container current-build-results (max-width: 44em)"), css.indexOf("@container current-build-results (max-width: 18em)"));
    expect(wide).toContain('grid-template-areas: "name actual requirement status chevron"');
    expect(compact).toContain('grid-template-areas: "name actual status chevron" "requirement requirement requirement ."');
    expect(compact).toMatch(/\.current-condition-requirement\s*\{[^}]*padding-inline-start: calc\(var\(--current-condition-dot-size\) \+ var\(--current-condition-name-gap\)\);/);
    expect(wide).toMatch(/\.current-build-condition \.current-condition-heading\s*\{[^}]*color: var\(--text\);[^}]*font-size: inherit;/);
    expect(wide).toMatch(/\.current-condition-requirement > span:first-child\s*\{[^}]*color: var\(--muted\)/);
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
    const sharedCss = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(sharedCss).toMatch(/\.disclosure-chevron\s*\{[^}]*transition: transform 140ms ease;/);
    expect(css).toMatch(/\.current-build-condition\[open\] \.current-condition-chevron\s*\{[^}]*transform: rotate\(90deg\);/);
  });
});
