import { useCallback, useMemo, useState } from "react";
import { App } from "../App";
import { createAdjustmentTutorialState } from "../ui/adjustmentExample";
import type { SearchStatus } from "../ui/defenceSearchUi";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";

const tutorialSteps = [
  { id: 1, label: "入力内容を確認する" },
  { id: 2, label: "「計算開始」を押す" },
  { id: 3, label: "候補の詳細を見る" },
  { id: 4, label: "候補を適用する" },
] as const;

export const guideTutorialSuggestionFormat = "Doubles" as const;
export const guideTutorialUsagePokemonAliases = {
  "Charizard-Mega-Y": "Charizard",
} as const;

const getActiveStep = (status: SearchStatus, candidateApplied: boolean): number => {
  if (candidateApplied) {
    return 4;
  }
  if (status === "complete") {
    return 3;
  }
  if (status === "running") {
    return 2;
  }
  return 1;
};

export const getTutorialMessage = (status: SearchStatus, candidateApplied: boolean): string => {
  if (candidateApplied) {
    return "「調整対象」に選んだSP配分が反映されました。";
  }
  if (status === "complete") {
    return "候補を開き、「PASS」とダメージを確認したら「適用」を押してみましょう。";
  }
  if (status === "running") {
    return "条件に合う配分を探しています。計算が終わるまでお待ちください。";
  }
  if (status === "error") {
    return "エラーのある入力欄を見直すか、「サンプルに戻す」でやり直してください。";
  }
  if (status === "canceled") {
    return "もう一度「計算開始」を押すと再計算できます。";
  }
  return "条件は入力済みです。「計算開始」を押してください。";
};

export function GuideTutorial() {
  const [resetKey, setResetKey] = useState(0);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [candidateApplied, setCandidateApplied] = useState(false);
  const preset = useMemo(createAdjustmentTutorialState, [resetKey]);
  const activeStep = getActiveStep(searchStatus, candidateApplied);

  const handleStatusChange = useCallback((status: SearchStatus) => {
    setSearchStatus(status);
    if (status === "idle" || status === "running") {
      setCandidateApplied(false);
    }
  }, []);

  const handleReset = () => {
    setSearchStatus("idle");
    setCandidateApplied(false);
    setResetKey((current) => current + 1);
  };

  return (
    <section className="guide-tutorial" aria-labelledby="interactive-tutorial-title">
      <header className="guide-tutorial-header">
        <div>
          <span className="guide-live-badge"><i aria-hidden="true" />操作できるサンプル</span>
          <h2 id="interactive-tutorial-title">サンプル入力で計算してみよう</h2>
          <p className="guide-tutorial-context guide-tutorial-storage-note">メガリザードンYのダブル向け調整を試せます。ここでの入力・計算結果は保存されません。</p>
        </div>
        <div className="guide-tutorial-actions">
          <button type="button" className="guide-reset-button" onClick={handleReset} aria-label="サンプルに戻す" title="サンプルに戻す">
            <img src={getPublicAssetUrl("assets/ui/refresh-ccw.svg")} alt="" aria-hidden="true" />
          </button>
        </div>
      </header>

      <ol className="guide-tutorial-steps" aria-label="計算チュートリアルの進行">
        {tutorialSteps.map((step) => (
          <li
            className={step.id === activeStep ? "active" : step.id < activeStep ? "complete" : ""}
            key={step.id}
            aria-current={step.id === activeStep ? "step" : undefined}
          >
            <span>{step.id}</span>
            <b>{step.label}</b>
          </li>
        ))}
      </ol>

      <div className="guide-tutorial-message" aria-live="polite">
        <span>STEP {activeStep} / {tutorialSteps.length}</span>
        <p>{getTutorialMessage(searchStatus, candidateApplied)}</p>
      </div>

      <div className="guide-workbench-frame">
        <App
          key={resetKey}
          variant="tutorial"
          suggestionFormat={guideTutorialSuggestionFormat}
          usagePokemonAliases={guideTutorialUsagePokemonAliases}
          initialTargetForm={preset.target}
          initialScenarioForms={preset.scenarios}
          onSearchStatusChange={handleStatusChange}
          onCandidateApplied={() => setCandidateApplied(true)}
        />
      </div>
    </section>
  );
}
