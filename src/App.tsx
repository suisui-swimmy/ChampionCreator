import { type ChangeEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { CandidateResult, StatKey, StatTable, Terrain, Weather } from "./domain/model";
import {
  applyTopCandidateToTarget,
  buildDefenceSearchInput,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  createInitialSearchUiState,
  searchUiReducer,
  startDefenceSearchFromUi,
  type ScenarioFormState,
  type TargetFormState,
} from "./ui/defenceSearchUi";
import {
  DefenceSearchWorkerClient,
  type ActiveDefenceSearchRequest,
} from "./worker/defenceSearchWorkerClient";

const statLabels: Record<StatKey, string> = {
  hp: "H",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

const statKeys = ["hp", "atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];
const defenceStatKeys = ["hp", "def", "spd"] as const satisfies readonly StatKey[];
const fixedStatKeys = ["atk", "spa", "spe"] as const satisfies readonly StatKey[];
const defenceStatKeySet = new Set<StatKey>(defenceStatKeys);

const weatherOptions: Array<{ value: Weather; label: string }> = [
  { value: "none", label: "なし" },
  { value: "sun", label: "晴れ" },
  { value: "rain", label: "雨" },
  { value: "sand", label: "砂" },
  { value: "snow", label: "雪" },
];

const terrainOptions: Array<{ value: Terrain; label: string }> = [
  { value: "none", label: "なし" },
  { value: "electric", label: "エレキ" },
  { value: "grassy", label: "グラス" },
  { value: "misty", label: "ミスト" },
  { value: "psychic", label: "サイコ" },
];

const toNumber = (value: string, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sumEvs = (evs: StatTable): number => statKeys.reduce((total, key) => total + evs[key], 0);

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const formatDamageRange = (min: number, max: number): string =>
  min === max ? String(min) : `${min}-${max}`;

const createScenario = (index: number): ScenarioFormState => ({
  ...createDefaultScenarioForms()[index % createDefaultScenarioForms().length],
  id: `scenario-${Date.now()}-${index}`,
  label: `シナリオ${index + 1}`,
});

export function App() {
  const [targetForm, setTargetForm] = useState<TargetFormState>(() => createDefaultTargetForm());
  const [scenarioForms, setScenarioForms] = useState<ScenarioFormState[]>(() => createDefaultScenarioForms());
  const [searchState, dispatchSearch] = useReducer(searchUiReducer, undefined, createInitialSearchUiState);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [applyLabel, setApplyLabel] = useState("1位を適用");
  const workerClientRef = useRef<DefenceSearchWorkerClient | null>(null);
  const activeRequestRef = useRef<ActiveDefenceSearchRequest | null>(null);
  const applyTimerRef = useRef<number | null>(null);

  const selectedCandidate = useMemo(() => {
    if (searchState.candidates.length === 0) {
      return null;
    }
    return searchState.candidates.find((candidate) => candidate.id === selectedCandidateId)
      ?? searchState.candidates[0];
  }, [searchState.candidates, selectedCandidateId]);

  const previewInput = useMemo(() => {
    try {
      return { input: buildDefenceSearchInput(targetForm, scenarioForms), error: null };
    } catch (error) {
      return { input: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [targetForm, scenarioForms]);

  useEffect(() => {
    return () => {
      activeRequestRef.current?.cancel();
      workerClientRef.current?.dispose();
      if (applyTimerRef.current !== null) {
        window.clearTimeout(applyTimerRef.current);
      }
    };
  }, []);

  const updateTargetField = <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => {
    setTargetForm((current) => ({ ...current, [key]: value }));
  };

  const updateTargetEv = (key: StatKey, value: number) => {
    setTargetForm((current) => ({
      ...current,
      evs: { ...current.evs, [key]: value },
    }));
  };

  const updateScenario = <K extends keyof ScenarioFormState>(
    id: string,
    key: K,
    value: ScenarioFormState[K],
  ) => {
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === id ? { ...scenario, [key]: value } : scenario
    )));
  };

  const updateScenarioAttackerEv = (id: string, key: StatKey, value: number) => {
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === id
        ? { ...scenario, attackerEvs: { ...scenario.attackerEvs, [key]: value } }
        : scenario
    )));
  };

  const handleAddScenario = () => {
    setScenarioForms((current) => [...current, createScenario(current.length)]);
  };

  const handleRemoveScenario = (id: string) => {
    setScenarioForms((current) => (
      current.length <= 1 ? current : current.filter((scenario) => scenario.id !== id)
    ));
  };

  const handleRun = () => {
    if (searchState.status === "running") {
      return;
    }

    try {
      workerClientRef.current ??= new DefenceSearchWorkerClient();
      const { request } = startDefenceSearchFromUi(
        workerClientRef.current,
        targetForm,
        scenarioForms,
        dispatchSearch,
      );
      activeRequestRef.current = request;
      setSelectedCandidateId(null);
    } catch (error) {
      dispatchSearch({
        type: "validationError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCancel = () => {
    activeRequestRef.current?.cancel();
    dispatchSearch({ type: "cancel", requestId: activeRequestRef.current?.requestId });
    activeRequestRef.current = null;
  };

  const handleApplyTopCandidate = () => {
    setTargetForm((current) => applyTopCandidateToTarget(current, searchState.candidates));
    setApplyLabel("適用済み");
    if (applyTimerRef.current !== null) {
      window.clearTimeout(applyTimerRef.current);
    }
    applyTimerRef.current = window.setTimeout(() => setApplyLabel("1位を適用"), 1200);
  };

  return (
    <div className={`app-shell${searchState.status === "running" ? " is-running" : ""}`}>
      <header className="topbar">
        <div>
          <h1>ChampionCreator</h1>
          <p>Pokemon Champions 自動耐久調整</p>
        </div>
        <div className="topbar-actions">
          <div className="run-meter" aria-live="polite">
            <strong>{Math.round(searchState.progress * 100)}%</strong>
            <span>{searchState.searchedCandidates} / {searchState.totalCandidates || "-"} candidates</span>
          </div>
          <button
            className="ghost-button"
            type="button"
            onClick={handleCancel}
            disabled={searchState.status !== "running"}
          >
            キャンセル
          </button>
          <button
            className="primary-button"
            type="button"
            id="runButton"
            onClick={handleRun}
            disabled={searchState.status === "running"}
          >
            {searchState.status === "running" ? "計算中..." : "計算開始"}
          </button>
        </div>
      </header>

      {searchState.errorMessage ? (
        <div className="status-banner error" role="alert">{searchState.errorMessage}</div>
      ) : null}
      {previewInput.error ? (
        <div className="status-banner warning" role="status">{previewInput.error}</div>
      ) : null}

      <main className="workbench">
        <TargetPanel
          targetForm={targetForm}
          onUpdateField={updateTargetField}
          onUpdateEv={updateTargetEv}
          canonicalPokemon={previewInput.input?.build.pokemon.canonicalName}
          totalEv={sumEvs(targetForm.evs)}
        />
        <ScenarioPanel
          scenarios={scenarioForms}
          onAddScenario={handleAddScenario}
          onRemoveScenario={handleRemoveScenario}
          onUpdateScenario={updateScenario}
          onUpdateAttackerEv={updateScenarioAttackerEv}
        />
        <ResultsPanel
          candidates={searchState.candidates}
          selectedCandidate={selectedCandidate}
          status={searchState.status}
          onSelectCandidate={setSelectedCandidateId}
        />
        <DetailPanel
          candidate={selectedCandidate}
          scenarios={scenarioForms}
          applyLabel={applyLabel}
          canApply={searchState.candidates.length > 0}
          onApply={handleApplyTopCandidate}
        />
      </main>
    </div>
  );
}

type TargetPanelProps = {
  targetForm: TargetFormState;
  canonicalPokemon?: string;
  totalEv: number;
  onUpdateField: <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => void;
  onUpdateEv: (key: StatKey, value: number) => void;
};

function TargetPanel({ targetForm, canonicalPokemon, totalEv, onUpdateField, onUpdateEv }: TargetPanelProps) {
  return (
    <section className="target-panel" aria-labelledby="target-title">
      <div className="section-heading">
        <div>
          <h2 id="target-title">調整対象</h2>
          <span>{canonicalPokemon ? `calc: ${canonicalPokemon}` : "resolver 未確定"}</span>
        </div>
      </div>

      <div className="target-summary compact">
        <label>
          ポケモン
          <input
            value={targetForm.pokemonInput}
            onChange={(event) => onUpdateField("pokemonInput", event.target.value)}
          />
        </label>
        <label>
          性格
          <input
            value={targetForm.natureInput}
            onChange={(event) => onUpdateField("natureInput", event.target.value)}
          />
        </label>
        <label>
          Lv.
          <input
            type="number"
            min="1"
            max="100"
            value={targetForm.level}
            onChange={(event) => onUpdateField("level", toNumber(event.target.value, 50))}
          />
        </label>
        <label>
          持ち物
          <input
            value={targetForm.itemInput}
            placeholder="任意"
            onChange={(event) => onUpdateField("itemInput", event.target.value)}
          />
        </label>
        <label>
          特性
          <input
            value={targetForm.abilityInput}
            placeholder="任意"
            onChange={(event) => onUpdateField("abilityInput", event.target.value)}
          />
        </label>
        <label>
          テラ
          <input
            value={targetForm.teraTypeInput}
            placeholder="任意"
            onChange={(event) => onUpdateField("teraTypeInput", event.target.value)}
          />
        </label>
      </div>

      <div className="ev-table" aria-label="調整対象の努力値">
        <div className="ev-header">
          <span>能力</span>
          <span>EV</span>
          <span>探索</span>
          <span>固定</span>
        </div>
        {statKeys.map((key) => (
          <div className={`ev-row ${key}`} key={key}>
            <strong>{statLabels[key]}</strong>
            <input
              type="number"
              min="0"
              max="252"
              step="4"
              value={targetForm.evs[key]}
              aria-label={`${statLabels[key]} EV`}
              onChange={(event) => onUpdateEv(key, toNumber(event.target.value))}
            />
            <div className="bar"><i style={{ width: `${Math.min(100, (targetForm.evs[key] / 252) * 100)}%` }} /></div>
            <span className={defenceStatKeySet.has(key) ? "search-chip" : "fixed-chip"}>
              {defenceStatKeySet.has(key) ? "HBD" : "固定"}
            </span>
          </div>
        ))}
      </div>

      <div className="sp-summary">
        <span>合計EV</span>
        <strong>{totalEv} / 508</strong>
      </div>
    </section>
  );
}

type ScenarioPanelProps = {
  scenarios: ScenarioFormState[];
  onAddScenario: () => void;
  onRemoveScenario: (id: string) => void;
  onUpdateScenario: <K extends keyof ScenarioFormState>(
    id: string,
    key: K,
    value: ScenarioFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
};

function ScenarioPanel({
  scenarios,
  onAddScenario,
  onRemoveScenario,
  onUpdateScenario,
  onUpdateAttackerEv,
}: ScenarioPanelProps) {
  return (
    <section className="scenario-panel" aria-labelledby="scenario-title">
      <div className="section-heading">
        <div>
          <h2 id="scenario-title">仮想敵シナリオ</h2>
          <span>有効な条件を Worker で同時評価</span>
        </div>
        <button className="ghost-button" type="button" onClick={onAddScenario}>+ シナリオを追加</button>
      </div>

      <div className="scenario-grid">
        {scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            onRemoveScenario={onRemoveScenario}
            onUpdateScenario={onUpdateScenario}
            onUpdateAttackerEv={onUpdateAttackerEv}
          />
        ))}
      </div>
    </section>
  );
}

type ScenarioCardProps = {
  scenario: ScenarioFormState;
  onRemoveScenario: (id: string) => void;
  onUpdateScenario: <K extends keyof ScenarioFormState>(
    id: string,
    key: K,
    value: ScenarioFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
};

function ScenarioCard({
  scenario,
  onRemoveScenario,
  onUpdateScenario,
  onUpdateAttackerEv,
}: ScenarioCardProps) {
  const onInput = <K extends keyof ScenarioFormState>(key: K) => (
    event: ChangeEvent<HTMLInputElement>,
  ) => onUpdateScenario(scenario.id, key, event.target.value as ScenarioFormState[K]);

  return (
    <article className={`scenario-card${scenario.enabled ? "" : " disabled"}`}>
      <div className="scenario-header">
        <label className="switch">
          <input
            type="checkbox"
            checked={scenario.enabled}
            onChange={(event) => onUpdateScenario(scenario.id, "enabled", event.target.checked)}
          />
          <span />
        </label>
        <div>
          <input
            className="inline-title-input"
            value={scenario.label}
            aria-label="シナリオ名"
            onChange={onInput("label")}
          />
          <small>{scenario.requiredSurvivedHits} hit / {scenario.minSurvivalProbabilityPercent}% 以上</small>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label={`${scenario.label}を削除`}
          onClick={() => onRemoveScenario(scenario.id)}
        >
          ×
        </button>
      </div>

      <div className="scenario-fields">
        <label>
          攻撃側
          <input value={scenario.attackerPokemonInput} onChange={onInput("attackerPokemonInput")} />
        </label>
        <label>
          技
          <input value={scenario.moveInput} onChange={onInput("moveInput")} />
        </label>
        <label>
          性格
          <input value={scenario.attackerNatureInput} onChange={onInput("attackerNatureInput")} />
        </label>
        <label>
          持ち物
          <input value={scenario.attackerItemInput} placeholder="任意" onChange={onInput("attackerItemInput")} />
        </label>
        <label>
          Lv.
          <input
            type="number"
            min="1"
            max="100"
            value={scenario.attackerLevel}
            onChange={(event) => onUpdateScenario(scenario.id, "attackerLevel", toNumber(event.target.value, 50))}
          />
        </label>
        <label>
          回数
          <input
            type="number"
            min="1"
            max="10"
            value={scenario.repeat}
            onChange={(event) => onUpdateScenario(scenario.id, "repeat", toNumber(event.target.value, 1))}
          />
        </label>
        <label>
          必要耐久
          <input
            type="number"
            min="1"
            max="10"
            value={scenario.requiredSurvivedHits}
            onChange={(event) => onUpdateScenario(scenario.id, "requiredSurvivedHits", toNumber(event.target.value, 1))}
          />
        </label>
        <label>
          生存率%
          <input
            type="number"
            min="0"
            max="100"
            value={scenario.minSurvivalProbabilityPercent}
            onChange={(event) => onUpdateScenario(scenario.id, "minSurvivalProbabilityPercent", toNumber(event.target.value, 100))}
          />
        </label>
      </div>

      <div className="attacker-evs" aria-label={`${scenario.label} 攻撃側努力値`}>
        {fixedStatKeys.map((key) => (
          <label key={key}>
            {statLabels[key]} EV
            <input
              type="number"
              min="0"
              max="252"
              step="4"
              value={scenario.attackerEvs[key]}
              onChange={(event) => onUpdateAttackerEv(scenario.id, key, toNumber(event.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="scenario-options">
        <label><input type="checkbox" checked={scenario.critical} onChange={(event) => onUpdateScenario(scenario.id, "critical", event.target.checked)} /> 急所</label>
        <label><input type="checkbox" checked={scenario.reflect} onChange={(event) => onUpdateScenario(scenario.id, "reflect", event.target.checked)} /> リフレクター</label>
        <label><input type="checkbox" checked={scenario.lightScreen} onChange={(event) => onUpdateScenario(scenario.id, "lightScreen", event.target.checked)} /> ひかりのかべ</label>
        <label><input type="checkbox" checked={scenario.auroraVeil} onChange={(event) => onUpdateScenario(scenario.id, "auroraVeil", event.target.checked)} /> オーロラベール</label>
        <label><input type="checkbox" checked={scenario.helpingHand} onChange={(event) => onUpdateScenario(scenario.id, "helpingHand", event.target.checked)} /> てだすけ</label>
      </div>

      <div className="scenario-fields short">
        <label>
          天候
          <select
            value={scenario.weather}
            onChange={(event) => onUpdateScenario(scenario.id, "weather", event.target.value as Weather)}
          >
            {weatherOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          フィールド
          <select
            value={scenario.terrain}
            onChange={(event) => onUpdateScenario(scenario.id, "terrain", event.target.value as Terrain)}
          >
            {terrainOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
    </article>
  );
}

type ResultsPanelProps = {
  candidates: CandidateResult[];
  selectedCandidate: CandidateResult | null;
  status: string;
  onSelectCandidate: (id: string) => void;
};

function ResultsPanel({ candidates, selectedCandidate, status, onSelectCandidate }: ResultsPanelProps) {
  return (
    <section className="results-panel" aria-labelledby="results-title">
      <div className="section-heading">
        <div>
          <h2 id="results-title">候補一覧</h2>
          <span>{status === "running" ? "探索中" : `候補 ${candidates.length} 件`}</span>
        </div>
      </div>

      <div className="candidate-table" role="table" aria-label="候補一覧">
        <div className="candidate-row header" role="row">
          <span>順位</span><span>H/B/D</span><span>使用EV</span><span>残りEV</span><span>ボトルネック</span>
        </div>
        {candidates.length === 0 ? (
          <div className="empty-result">計算開始で Worker 経由の候補がここに出ます</div>
        ) : candidates.map((candidate) => (
          <button
            className={`candidate-row${selectedCandidate?.id === candidate.id ? " selected" : ""}`}
            type="button"
            key={candidate.id}
            onClick={() => onSelectCandidate(candidate.id)}
          >
            <span className={`rank${candidate.rank === 1 ? " crown" : ""}`}>{candidate.rank}</span>
            <span className="allocation compact-allocation">
              <b>{candidate.candidate.hp}</b>
              <b>{candidate.candidate.def}</b>
              <b>{candidate.candidate.spd}</b>
              <i />
            </span>
            <span>{candidate.usedEvBudget}</span>
            <span>{candidate.remainingEvBudget}</span>
            <span>{candidate.bottleneckLabel}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

type DetailPanelProps = {
  candidate: CandidateResult | null;
  scenarios: ScenarioFormState[];
  applyLabel: string;
  canApply: boolean;
  onApply: () => void;
};

function DetailPanel({ candidate, scenarios, applyLabel, canApply, onApply }: DetailPanelProps) {
  const scenarioLabels = new Map(scenarios.map((scenario) => [scenario.id, scenario.label]));

  return (
    <aside className="detail-panel" aria-live="polite">
      <div className="section-heading">
        <div>
          <h2>選択候補詳細 {candidate ? <span>#{candidate.rank}</span> : null}</h2>
          <span>{candidate?.bottleneckLabel ?? "候補未選択"}</span>
        </div>
        <button className="primary-button small" type="button" onClick={onApply} disabled={!canApply}>{applyLabel}</button>
      </div>

      {candidate ? (
        <>
          <div className="detail-allocation">
            {statKeys.map((key) => <span key={key}>{statLabels[key]}</span>)}
            {statKeys.map((key) => <strong key={key}>{candidate.appliedEvs[key]}</strong>)}
          </div>

          <div className="check-list">
            {candidate.scenarioResults.map((result) => (
              <div key={result.scenarioId}>
                <span className={`badge ${result.passed ? "green" : "red"}`} />
                <strong>{scenarioLabels.get(result.scenarioId) ?? result.scenarioId}</strong>
                <span>{formatPercent(result.survivalProbability)}</span>
                <em className={result.passed ? "" : "fail-badge"}>{result.passed ? "PASS" : "FAIL"}</em>
                <small>{result.bottleneckLabel}</small>
                <ul>
                  {result.hitEvaluations.map((hit) => (
                    <li key={hit.hitId}>
                      damage {formatDamageRange(hit.damageRange.min, hit.damageRange.max)}
                      {" / "}
                      {hit.damageRange.percentMin.toFixed(1)}-{hit.damageRange.percentMax.toFixed(1)}%
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-detail">候補を計算すると scenario ごとの pass / survivalProbability / damage range を確認できます</div>
      )}
    </aside>
  );
}
