import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CandidateResult } from "./domain/model";
import {
  App,
  CandidateStatPointBars,
  CandidateStatPointSpread,
  ResultsPanel,
  clampTargetStatPointChange,
  getOffenseDefenderStatKeys,
  getPokemonSuggestionKeyAction,
  formatLocalizedDamageDescription,
  formatScenarioResultStatusLabel,
  getDropdownEntityOptions,
  getNatureModifierDirection,
  isUnresolvedEntityInput,
  normalizeNumericInputText,
} from "./App";
import {
  createDefaultScenarioForms,
} from "./ui/defenceSearchUi";
import { appVersionInfo } from "./appVersion";

describe("App", () => {
  it("keeps type and item dropdown candidates separated", () => {
    const typeOptions = getDropdownEntityOptions("type", "");
    const itemOptions = getDropdownEntityOptions("item", "");

    expect(typeOptions.some((option) => option.value === "ほのお")).toBe(true);
    expect(typeOptions.some((option) => option.value === "Crucibellite")).toBe(false);
    expect(itemOptions.some((option) => option.value === "Crucibellite")).toBe(true);
  });

  it("supports keyboard navigation and Tab selection for Pokemon suggestions", () => {
    expect(getPokemonSuggestionKeyAction("ArrowDown", 0, 2)).toEqual({ type: "move", index: 1 });
    expect(getPokemonSuggestionKeyAction("ArrowDown", 1, 2)).toEqual({ type: "move", index: 0 });
    expect(getPokemonSuggestionKeyAction("ArrowUp", 0, 2)).toEqual({ type: "move", index: 1 });
    expect(getPokemonSuggestionKeyAction("Tab", 0, 2)).toEqual({ type: "select" });
    expect(getPokemonSuggestionKeyAction("Enter", 0, 2)).toEqual({ type: "select" });
    expect(getPokemonSuggestionKeyAction("Escape", 0, 2)).toEqual({ type: "close" });
  });

  it("renders the M0 workbench sections", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("ChampionCreator");
    expect(html).toContain('class="brand-line"');
    expect(html).toContain(`app v${appVersionInfo.appVersion} / calc ${appVersionInfo.smogonCalcVersion} / data ${appVersionInfo.localizationEntries}`);
    expect(html).not.toContain("Pokemon Champions 自動耐久調整");
    expect(html).toContain("調整対象");
    expect(html).toContain("仮想敵シナリオ");
    expect(html).toContain('aria-label="シナリオ1 調整種別"');
    expect(html).toContain('aria-label="シナリオ2 調整種別"');
    expect(html).toContain('aria-label="シナリオ3 調整種別"');
    expect(html).toContain('class="scenario-row defence"');
    expect(html).toContain('class="scenario-row offense"');
    expect(html).toContain('class="scenario-row speed"');
    expect(html).toContain(">耐久調整</span>");
    expect(html).toContain(">火力調整</span>");
    expect(html).toContain(">素早さ調整</span>");
    expect(html).toContain('value="耐久調整A"');
    expect(html).toContain('value="火力調整A"');
    expect(html).toContain('value="素早さ調整A"');
    expect(html).toContain(">確定抜き</span>");
    expect(html).toContain(">任意S値</span>");
    expect(html).toContain(">素早さ条件</h3>");
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値"');
    expect(html).toContain('class="number-stepper speed-offset-input"');
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値を1下げる"');
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値を1上げる"');
    expect(html).toContain(">技補正</span>");
    expect(html).not.toContain("speed-tailwind-toggle");
    expect(html).toContain('class="scenario-cell number-cell number-labeled-field speed-manual-target-input"');
    expect(html).toContain('inputMode="numeric"');
    expect(html.match(/>任意S値<\/span>/g)).toHaveLength(1);
    expect(html).not.toContain("同速以上");
    expect(html).not.toContain(">目標S<");
    expect(html).not.toContain(">S条件</h3>");
    expect(html).toContain('value="90"');
    expect(html).toContain('value="80"');
    expect(html).toContain('value="メガゲンガー"');
    expect(html).toContain("assets/ui/arrow-left-circle.svg");
    expect(html).toContain("assets/ui/arrow-right-circle.svg");
    expect(html).toContain('aria-label="耐久調整A 耐久調整。クリックで火力調整に切り替え"');
    expect(html).toContain('aria-label="火力調整A 火力調整。クリックで素早さ調整に切り替え"');
    expect(html).toContain('aria-label="素早さ調整A 素早さ調整。クリックで耐久調整に切り替え"');
    expect(html).toContain("assets/ui/arrow-up-circle.svg");
    expect(html).not.toContain("assets/ui/arrow-down-circle.svg");
    expect(html).not.toContain('aria-label="Sライン結果"');
    expect(html).toContain("シナリオを追加");
    expect(html).toContain('aria-label="探索操作"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("0 / - 候補");
    expect(html).toContain(">キャンセル<");
    expect(html).toContain(">計算開始<");
    expect(html).toContain("候補一覧");
    expect(html).toContain("計算結果");
    expect(html).not.toContain("計算開始で Worker 経由の候補がここに出ます");
    expect(html).toContain('aria-label="権利表記"');
    expect(html).toContain("© 2026 suisui-swimmy");
    expect(html).toContain("本ツールは非公式のファンツールであり、画像、名称などに関する著作権は 任天堂 / クリーチャーズ / ゲームフリーク に帰属します");
    expect(html).not.toContain("ゲームフリーク に帰属します。");
    expect(html).toContain('href="https://x.com/peixe0307"');
    expect(html).toContain("不具合報告 / お問い合わせ");
    expect(html).not.toContain("不具合報告 / お問い合わせ :");
    expect(html).toContain("assets/social/x-logo.svg");
    expect(html).not.toContain("火力ライン結果");
    expect(html).not.toContain("pokemon-artwork-meta");
    expect(html).not.toContain("将来の詳細パネル用空き領域");
    expect(html.indexOf('aria-label="探索操作"')).toBeLessThan(html.indexOf('aria-label="候補一覧"'));
  });

  it("normalizes full-width numeric input text before parsing", () => {
    expect(normalizeNumericInputText("１２３４５")).toBe("12345");
    expect(normalizeNumericInputText(" ＋１２．５ ")).toBe("+12.5");
    expect(normalizeNumericInputText("－６")).toBe("-6");
  });

  it("renders exact 32-cell SP allocation sliders", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemax="32"');
    expect(html).toContain('aria-label="H SP配分"');
    expect(html).toContain('class="sp-cell-bar hp"');
    expect(html).toContain(">ランク<");
    expect(html).toContain('aria-label="Bランク: 0"');
    expect(html).toContain('aria-label="Dランク: 0"');
    expect(html).not.toContain("assets/ui/lock-open.svg");
    expect(html).not.toContain("assets/ui/lock-closed.svg");
    expect(html).not.toContain('class="allocation-lock');
    expect(html).not.toContain("固定状態");
    expect(html).not.toContain('aria-label="状態異常: なし"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
  });

  it("renders only A and C parameter rows for each virtual attacker", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain(">耐久条件<");
    expect(html).toContain(">状況条件<");
    expect(html).toContain('aria-label="耐久調整A 能力"');
    expect(html.indexOf(">状況条件<")).toBeLessThan(html.indexOf('class="attack-stat-section'));
    expect(html).not.toContain('id="scenario-defence-attack-a-stat-title">能力</h3>');
    expect(html).toContain(">調整対象条件<");
    expect(html).toContain(">耐久回数<");
    expect(html).toContain(">耐久確立<");
    expect(html).not.toContain("<span>詳細補正</span>");
    expect(html).not.toContain(">補正なし<");
    expect(html).toContain(">攻撃回数<");
    expect(html).toContain('aria-label="耐久調整A 参照能力"');
    expect(html).toContain('aria-label="耐久調整A A SP"');
    expect(html).toContain('aria-label="耐久調整A Aランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A C SP"');
    expect(html).not.toContain('aria-label="耐久調整A Cランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A H SP"');
    expect(html).not.toContain('aria-label="耐久調整A B SP"');
    expect(html).not.toContain('aria-label="耐久調整A D SP"');
    expect(html).not.toContain('aria-label="耐久調整A S SP"');
    expect(html).not.toContain('aria-label="耐久調整A Bランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A Dランク: 0"');
    expect(html).toContain('aria-label="耐久調整A 調整対象条件"');
    expect(html).toContain('aria-label="耐久調整A 調整対象Bランク: 0"');
    expect(html).toContain('aria-label="耐久調整A 調整対象Dランク: 0"');
    expect(html).not.toContain("（この攻撃のみ）");
  });

  it("shows only relevant defender stats for offense adjustment moves", () => {
    expect(getOffenseDefenderStatKeys("サイコキネシス")).toEqual(["hp", "spd"]);
    expect(getOffenseDefenderStatKeys("ふいうち")).toEqual(["hp", "def"]);
    expect(getOffenseDefenderStatKeys("イカサマ")).toEqual(["hp", "atk", "def"]);
    expect(getOffenseDefenderStatKeys("ジャイロボール")).toEqual(["hp", "def", "spe"]);
    expect(getOffenseDefenderStatKeys("")).toEqual(["hp", "def", "spd"]);

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('aria-label="火力調整A 仮想敵能力"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵D SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵Dランク: 0"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵A SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵B SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵C SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵S SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵Bランク');
  });

  it("renders nature stat modifiers beside target and attacker SP fields", () => {
    expect(getNatureModifierDirection("ひかえめ", "spa")).toBe("up");
    expect(getNatureModifierDirection("ひかえめ", "atk")).toBe("down");
    expect(getNatureModifierDirection("いじっぱり", "atk")).toBe("up");
    expect(getNatureModifierDirection("いじっぱり", "spa")).toBe("down");
    expect(getNatureModifierDirection("おくびょう", "spe")).toBe("up");
    expect(getNatureModifierDirection("おくびょう", "atk")).toBe("down");
    expect(getNatureModifierDirection("ひかえめ", "hp")).toBeNull();
    expect(getNatureModifierDirection("がんばりや", "atk")).toBeNull();

    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="nature-stat-modifier up" aria-label="S 上昇"');
    expect(html).toContain('class="nature-stat-modifier down" aria-label="A 下降"');
    expect(html).toContain('class="nature-stat-modifier up" aria-label="A 上昇"');
    expect(html).not.toContain('class="nature-stat-modifier down" aria-label="C 下降"');
  });

  it("marks only non-empty unresolved entity inputs as invalid", () => {
    expect(isUnresolvedEntityInput("pokemon", "テラスタイプ")).toBe(true);
    expect(isUnresolvedEntityInput("pokemon", "メガスターミー")).toBe(false);
    expect(isUnresolvedEntityInput("item", "")).toBe(false);
  });

  it("caps target SP edits at the total 66 budget", () => {
    expect(clampTargetStatPointChange({
      hp: 10,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "hp", 32)).toBe(26);

    expect(clampTargetStatPointChange({
      hp: 26,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "atk", 5)).toBe(5);
  });

  it("renders candidate H/A/B/C/D/S SP values", () => {
    const html = renderToStaticMarkup(<CandidateStatPointSpread statPoints={{
      hp: 0,
      atk: 12,
      def: 16,
      spa: 20,
      spd: 32,
      spe: 4,
    }} />);

    expect(html).toContain('aria-label="H 0 / A 12 / B 16 / C 20 / D 32 / S 4 SP"');
    expect(html).toContain('class="candidate-stat-value hp"');
    expect(html).toContain(">H</span><span>0</span>");
    expect(html).toContain(">A</span><span>12</span>");
    expect(html).toContain(">C</span><span>20</span>");
    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 0 / A 12 / B 16 / C 20 / D 32 / S 4"');
  });

  it("renders compact SP bars for candidate rows", () => {
    const html = renderToStaticMarkup(<CandidateStatPointBars statPoints={{
      hp: 9,
      atk: 0,
      def: 30,
      spa: 7,
      spd: 0,
      spe: 0,
    }} />);

    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 9 / A 0 / B 30 / C 7 / D 0 / S 0"');
    expect(html).toContain('class="candidate-sp-bar hp"');
    expect(html).toContain('style="width:28.125%"');
    expect(html).toContain('class="candidate-sp-bar def"');
    expect(html).toContain('style="width:93.75%"');
    expect(html).toContain('class="candidate-sp-bar spa"');
  });

  it("labels failed scenario results as FAIL", () => {
    expect(formatScenarioResultStatusLabel(true)).toBe("PASS");
    expect(formatScenarioResultStatusLabel(false)).toBe("FAIL");
  });

  it("localizes Smogon damage descriptions for the selected candidate detail", () => {
    expect(formatLocalizedDamageDescription(
      "252+ Atk Kingambit Sucker Punch vs. 92 HP / 52 Def Starmie-Mega: 122-146 (82.9 - 99.3%) -- guaranteed 2HKO",
    )).toBe("A32+ ドドゲザン ふいうち → H12 / B7 メガスターミー : 122-146 (82.9-99.3%) / 確定2発");
    expect(formatLocalizedDamageDescription(
      "252+ Atk Kingambit Sucker Punch vs. 68 HP / 236 Def Delphox-Mega: 134-158 (84.2 - 99.3%) -- guaranteed 2HKO",
    )).toBe("A32+ ドドゲザン ふいうち → H9 / B30 メガマフォクシー : 134-158 (84.2-99.3%) / 確定2発");
  });

  it("integrates the selected candidate detail into the candidate list", () => {
    const candidate: CandidateResult = {
      id: "candidate-2",
      rank: 2,
      candidate: { hp: 6, def: 13, spd: 0 },
      appliedStatPoints: { hp: 6, atk: 0, def: 13, spa: 0, spd: 0, spe: 0 },
      appliedEvs: { hp: 44, atk: 0, def: 100, spa: 0, spd: 0, spe: 0 },
      usedStatPointBudget: 19,
      remainingStatPointBudget: 47,
      usedEvBudget: 144,
      remainingEvBudget: 366,
      passed: true,
      bottleneckLabel: "シナリオA +0.0%",
      scenarioResults: [{
        scenarioId: "scenario-a",
        passed: true,
        survivalProbability: 1,
        requiredSurvivedHits: 1,
        minSurvivalProbability: 1,
        bottleneckLabel: "シナリオA +0.0%",
        hitEvaluations: [{
          hitId: "hit-a",
          damageRolls: [122, 146],
          damageRange: { min: 122, max: 146, percentMin: 82.9, percentMax: 99.3 },
          description: "252+ Atk Kingambit Sucker Punch vs. 92 HP / 52 Def Starmie-Mega: 122-146 (82.9 - 99.3%) -- guaranteed 2HKO",
        }],
      }],
    };
    const [scenario] = createDefaultScenarioForms();
    const offenseScenario = {
      ...scenario,
      id: "scenario-offense-test",
      label: "シナリオ2",
      adjustmentType: "offense" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-offense-test",
        label: "火力調整A",
        attackerPokemonInput: "メガゲンガー",
        moveInput: "サイコキネシス",
      }],
    };
    const offenseResults = [{
      id: "scenario-offense-test:attack-offense-test:spa",
      scenarioId: "scenario-offense-test",
      scenarioLabel: "シナリオ2",
      attackId: "attack-offense-test",
      attackLabel: "火力調整A",
      result: {
        id: "offense-result-test",
        status: "pass" as const,
        passed: true,
        label: "Cライン",
        owner: "attacker" as const,
        stat: "spa" as const,
        role: "damage" as const,
        canApply: false,
        requiredStatPoints: 7,
        actualStat: 186,
        koProbability: 1,
        targetKoProbability: 1,
        damageRange: { min: 168, max: 198, percentMin: 100.6, percentMax: 118.6 },
        reason: "PASS",
      },
    }];
    const resultsPanelBaseProps = {
      offenseResults,
      speedResults: [],
      strictestFailureLabel: null,
      targetLabel: "メガマフォクシー",
      resultAlertMessage: null,
    };
    const closedHtml = renderToStaticMarkup(
      <ResultsPanel
        {...resultsPanelBaseProps}
        candidates={[candidate]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[{ ...scenario, id: "scenario-a", label: "シナリオA" }, offenseScenario]}
        status="complete"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...resultsPanelBaseProps}
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[{ ...scenario, id: "scenario-a", label: "シナリオA" }, offenseScenario]}
        status="complete"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain(">最厳条件<");
    expect(html).toContain(">H/A/B/C/D/S<");
    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 6 / A 0 / B 13 / C 0 / D 0 / S 0"');
    expect(html).toContain(">H</span><span>6</span>");
    expect(html).toContain(">A</span><span>0</span>");
    expect(html).toContain(">B</span><span>13</span>");
    expect(html).toContain(">適用<");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-state="open"');
    expect(html).toContain('class="candidate-disclosure"');
    expect(html).not.toContain("▼");
    expect(html).not.toContain("▲");
    expect(html).toContain("シナリオA</strong><span>A32+ ドドゲザン ふいうち → H12 / B7 メガスターミー : 122-146 (82.9-99.3%) / 確定2発");
    expect(html).toContain("シナリオ2</strong><span>KO率 100.0%");
    expect(html).toContain("シナリオ2</strong><span>C7 メガマフォクシー サイコキネシス → メガゲンガー : 168-198 (100.6-118.6%) / KO率 100.0%");
    expect(html).not.toContain("火力ライン結果");
    expect(closedHtml).toContain('aria-expanded="false"');
    expect(closedHtml).toContain('data-state="closed"');
    expect(closedHtml).not.toContain("▼");
    expect(closedHtml).not.toContain("▲");
    expect(closedHtml).not.toContain("A32+ ドドゲザン ふいうち");
    expect(closedHtml).not.toContain("C7 メガマフォクシー サイコキネシス");
  });

  it("places integrated firepower failures in the candidate list", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel="シナリオ1 -6.3%"
        targetLabel="メガマフォクシー"
        resultAlertMessage="火力調整条件を候補一覧へ統合できません: シナリオ2 / 火力調整A: 最大SPでも指定KO率に届きません"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("候補一覧");
    expect(html).toContain(">FAIL</strong>");
    expect(html).toContain("すべてのシナリオを満たす候補を作れません");
    expect(html).toContain("最厳条件: シナリオ2 / 火力調整A: 最大SPでも指定KO率に届きません");
    expect(html).not.toContain("最厳条件: シナリオ1 -6.3%");
    expect(html).not.toContain("火力ライン結果");
  });

  it("shows the strictest condition when a completed search has no candidates", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel="シナリオ1 -6.3%"
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain(">FAIL</strong>");
    expect(html).toContain("すべてのシナリオを満たす候補が見つかりません");
    expect(html).not.toContain("必要耐久・生存率・固定SPをゆるめてください");
    expect(html).toContain("最厳条件: シナリオ1 -6.3%");
  });

  it("keeps speed line details inside expanded candidates without the separate result panel", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = {
      ...scenario,
      id: "scenario-speed-test",
      label: "素早さ調整",
      adjustmentType: "speed" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-speed-test",
        label: "最速ピカチュウ",
        attackerPokemonInput: "ピカチュウ",
        speedTargetMode: "manual" as const,
        speedTargetValue: 150,
      }],
    };
    const candidate: CandidateResult = {
      id: "candidate-speed",
      rank: 1,
      candidate: { hp: 3, def: 32, spd: 0 },
      appliedStatPoints: { hp: 3, atk: 0, def: 32, spa: 2, spd: 0, spe: 12 },
      appliedEvs: { hp: 20, atk: 0, def: 252, spa: 12, spd: 0, spe: 92 },
      usedStatPointBudget: 49,
      remainingStatPointBudget: 17,
      usedEvBudget: 376,
      remainingEvBudget: 132,
      passed: true,
      bottleneckLabel: "シナリオ1 +3.7%",
      scenarioResults: [],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[speedScenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[{
          id: "scenario-speed-test-attack-speed-test-speed-line",
          scenarioId: "scenario-speed-test",
          scenarioLabel: "素早さ調整",
          attackId: "attack-speed-test",
          attackLabel: "最速ピカチュウ",
          result: {
            id: "speed-line",
            status: "pass",
            passed: true,
            canApply: true,
            label: "Sライン",
            comparison: "outspeed",
            orderMode: "normal",
            relation: "outspeed",
            requiredStatPoints: 12,
            actualSpeed: 151,
            targetSpeed: 150,
            requiredSpeed: 151,
            targetStatPoints: 0,
            notes: ["こだわりスカーフ 1.5倍"],
            reason: "確定抜きは S12 SPで達成します",
          },
        }]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).not.toContain("Sライン結果");
    expect(html).not.toContain("候補一覧の固定Sへ自動統合されます");
    expect(html).not.toContain("S適用");
    expect(html).toContain("素早さ調整</strong>");
    expect(html).toContain("相手S 150");
    expect(html).toContain(">PASS</em>");
    expect(html).toContain("S12 メガマフォクシー → 任意S150 : 自分 151 / 相手 150 / 抜ける / こだわりスカーフ 1.5倍");
    expect(html).toContain('aria-label="SPバー: H 3 / A 0 / B 32 / C 2 / D 0 / S 12"');
    expect(html).toContain("自分 151");
    expect(html).toContain("相手 150");
    expect(html).toContain("抜ける");
    expect(html).toContain("こだわりスカーフ 1.5倍");
  });

  it("omits speed note text when no speed modifiers are applied", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = {
      ...scenario,
      id: "scenario-speed-no-note",
      label: "素早さ調整",
      adjustmentType: "speed" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-speed-no-note",
        label: "最速ゲンガー",
        attackerPokemonInput: "メガゲンガー",
        speedTargetMode: "manual" as const,
        speedTargetValue: 200,
      }],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[speedScenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[{
          id: "scenario-speed-no-note-attack-speed-no-note-speed-line",
          scenarioId: "scenario-speed-no-note",
          scenarioLabel: "素早さ調整",
          attackId: "attack-speed-no-note",
          attackLabel: "最速ゲンガー",
          result: {
            id: "speed-line",
            status: "pass",
            passed: true,
            canApply: true,
            label: "Sライン",
            comparison: "outspeed",
            orderMode: "normal",
            relation: "outspeed",
            requiredStatPoints: 29,
            actualSpeed: 201,
            targetSpeed: 200,
            requiredSpeed: 201,
            targetStatPoints: 0,
            notes: [],
            reason: "確定抜きは S29 SPで達成します",
          },
        }]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).not.toContain("Sライン結果");
    expect(html).not.toContain("自動補正なし");
    expect(html).not.toContain("抜ける /");
  });

  it("wires resolver-backed datalist candidates to free-text entity fields", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('value="ドドゲザン"');
    expect(html).toContain('value="メガマフォクシー"');
    expect(html).toContain('value="メガゲンガー"');
    expect(html).toContain('value="サイコキネシス"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP" placeholder="H SP"');
    expect(html).toContain('value="32"');
    expect(html).not.toContain('value="Dragonite"');
    expect(html).not.toContain('label="Dragonite"');
    expect(html).not.toContain("calc: Delphox-Mega");
    expect(html).not.toContain("名前を解決できません");
    expect(html).not.toContain(">Delphox-Mega<");
    expect(html).not.toContain(">Illuminate<");
    expect(html).not.toContain('list="entity-options-pokemon');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).not.toContain('list="entity-options-move');
    expect(html).toContain('class="nature-trigger"');
    expect(html).toContain('aria-label="性格: おくびょう"');
    expect(html).toContain('class="disclosure-chevron"');
    expect(html).not.toContain("▾");
    expect(html).not.toContain("C↑ / A↓");
    expect(html).not.toContain("A↑ / C↓");
    expect(html).not.toContain('list="entity-options-ability');
    expect(html).toContain('class="dropdown-menu-trigger"');
    expect(html).toContain('aria-label="特性候補を開く"');
    expect(html).toContain('aria-label="持ち物候補を開く"');
    expect(html).toContain('aria-label="技候補を開く"');
    expect(html).toContain('class="scenario-defender-status"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
    expect(html).toContain(">なし</span>");
    expect(html).not.toContain('aria-label="状態異常: なし"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
    expect(html).not.toContain('value="まけんき"');
    expect(html).not.toContain('value="もうか"');
    expect(html).not.toContain('list="entity-options-item');
    expect(html).not.toContain('list="entity-options-type');
    expect(html).toContain('aria-label="テラスタル"');
    expect(html).toContain('aria-label="攻撃テラス"');
    expect(html).toContain("tera-off.svg");
    expect(html).toContain("mega-off.svg");
    expect(html).toContain("dmax-off.svg");
  });
});
