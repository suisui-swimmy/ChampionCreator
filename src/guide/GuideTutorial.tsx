import { useCallback, useMemo, useState } from "react";
import { App } from "../App";
import { parseBoxBackupDocument } from "../ui/boxStorage";
import type { SearchStatus } from "../ui/defenceSearchUi";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";
import tutorialPresetJson from "./tutorial-preset.json";

const tutorialSteps = [
  { id: 1, label: "入力内容を確認する" },
  { id: 2, label: "「計算開始」を押す" },
  { id: 3, label: "候補の詳細を見る" },
  { id: 4, label: "候補を適用する" },
] as const;

const loadTutorialPreset = () => {
  const result = parseBoxBackupDocument(JSON.stringify(tutorialPresetJson));
  if (result.status === "error") {
    throw new Error(`チュートリアル用バックアップを読み込めません: ${result.message}`);
  }

  const entry = result.entries.find((candidate) => candidate.id === "default-example-mega-delphox")
    ?? result.entries[0];
  if (!entry) {
    throw new Error("チュートリアル用バックアップに保存スロットがありません");
  }

  return {
    target: structuredClone(entry.payload.target),
    scenarios: structuredClone(entry.payload.scenarios),
  };
};

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
    return "上部の「調整対象」を確認してください。選んだ候補のSP配分が反映されています。";
  }
  if (status === "complete") {
    return "候補を1つ開き、各条件の「PASS」表示とダメージ詳細を確認してみましょう。";
  }
  if (status === "running") {
    return "条件に合うSP配分を探索しています。計算が完了するまで、そのままお待ちください。";
  }
  if (status === "error") {
    return "エラーが表示されている入力欄を確認してください。右上のボタンからサンプルの初期状態へ戻すこともできます。";
  }
  if (status === "canceled") {
    return "条件を変更したあと、もう一度「計算開始」を押すと再計算できます。";
  }
  return "必要な条件は、あらかじめ入力されています。まずは「計算開始」を押してください。";
};

export function GuideTutorial() {
  const [resetKey, setResetKey] = useState(0);
  const [searchStatus, setSearchStatus] = useState<SearchStatus>("idle");
  const [candidateApplied, setCandidateApplied] = useState(false);
  const preset = useMemo(loadTutorialPreset, [resetKey]);
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
          <span className="guide-live-badge"><i aria-hidden="true" />このサンプルは実際に操作できます。</span>
          <h2 id="interactive-tutorial-title">サンプル入力で計算してみよう</h2>
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
          initialTargetForm={preset.target}
          initialScenarioForms={preset.scenarios}
          onSearchStatusChange={handleStatusChange}
          onCandidateApplied={() => setCandidateApplied(true)}
        />
      </div>
    </section>
  );
}
