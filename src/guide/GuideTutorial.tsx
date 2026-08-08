import { useCallback, useMemo, useState } from "react";
import { App } from "../App";
import { parseBoxBackupDocument } from "../ui/boxStorage";
import type { SearchStatus } from "../ui/defenceSearchUi";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";
import tutorialPresetJson from "./tutorial-preset.json";

const tutorialSteps = [
  { id: 1, label: "条件を確認" },
  { id: 2, label: "計算する" },
  { id: 3, label: "候補を比較" },
  { id: 4, label: "配分を適用" },
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

const getTutorialMessage = (status: SearchStatus, candidateApplied: boolean): string => {
  if (candidateApplied) {
    return "候補のSP配分を調整対象へ適用できました。入力値が変わったことを確認してみよう。";
  }
  if (status === "complete") {
    return "計算完了！候補を開くと、各条件のPASS結果とダメージ内訳を確認できます。";
  }
  if (status === "running") {
    return "本体と同じWorkerで全条件を評価しています。途中結果が候補一覧へ順次表示されます。";
  }
  if (status === "error") {
    return "入力内容を確認して、もう一度計算してください。サンプルに戻すこともできます。";
  }
  if (status === "canceled") {
    return "計算を中断しました。条件を変えて、いつでも再実行できます。";
  }
  return "サンプル入力を確認したら、作業台の「計算開始」を押してみよう。入力内容は自由に変更できます。";
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
          <span className="guide-live-badge"><i aria-hidden="true" />実際に操作できます</span>
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
