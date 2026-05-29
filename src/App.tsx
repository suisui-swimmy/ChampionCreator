import { type ChangeEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  sumStatPoints,
} from "./domain/championsStats";
import type { CandidateResult, StatKey, StatTable, Terrain, Weather } from "./domain/model";
import {
  applyTopCandidateToTarget,
  createDefaultScenarioAttackForm,
  buildDefenceSearchInput,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  createInitialSearchUiState,
  searchUiReducer,
  startDefenceSearchFromUi,
  type ScenarioAttackFormState,
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

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const formatDamageRange = (min: number, max: number): string =>
  min === max ? String(min) : `${min}-${max}`;

const createBlankAttack = (index: number): ScenarioAttackFormState => ({
  ...createDefaultScenarioAttackForm(`attack-${Date.now()}-${index}`, `攻撃${String.fromCharCode(65 + index)}`),
  attackerPokemonInput: "",
  attackerNatureInput: "",
  attackerAbilityInput: "",
  attackerItemInput: "",
  attackerLevel: 50,
  attackerStatPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moveInput: "",
  repeat: 1,
  requiredSurvivedHits: 1,
  minSurvivalProbabilityPercent: 100,
  weather: "none",
  terrain: "none",
  critical: false,
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
});

const createBlankScenario = (index: number): ScenarioFormState => ({
  ...createDefaultScenarioForms()[0],
  id: `scenario-${Date.now()}-${index}`,
  label: `シナリオ${index + 1}`,
  enabled: false,
  attacks: [createBlankAttack(0)],
});

const createScenario = (index: number): ScenarioFormState => ({
  ...createBlankScenario(index),
  id: `scenario-${Date.now()}-${index}`,
  label: `シナリオ${index + 1}`,
});

export function App() {
  const [targetForm, setTargetForm] = useState<TargetFormState>(() => createDefaultTargetForm());
  const [scenarioForms, setScenarioForms] = useState<ScenarioFormState[]>(() => createDefaultScenarioForms());
  const [searchState, dispatchSearch] = useReducer(searchUiReducer, undefined, createInitialSearchUiState);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [applyLabel, setApplyLabel] = useState("1位を適用");
  const [actualStats, setActualStats] = useState<StatTable | null>(null);
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

  useEffect(() => {
    let canceled = false;

    if (!previewInput.input) {
      setActualStats(null);
      return () => {
        canceled = true;
      };
    }

    void import("./calc/smogonAdapter").then(({ toSmogonPokemon }) => {
      if (!canceled && previewInput.input) {
        setActualStats(toSmogonPokemon(previewInput.input.build).stats);
      }
    }).catch(() => {
      if (!canceled) {
        setActualStats(null);
      }
    });

    return () => {
      canceled = true;
    };
  }, [previewInput]);

  const updateTargetField = <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => {
    setTargetForm((current) => ({ ...current, [key]: value }));
  };

  const updateTargetEv = (key: StatKey, value: number) => {
    setTargetForm((current) => ({
      ...current,
      statPoints: { ...current.statPoints, [key]: value },
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
    const [scenarioId, attackId] = id.split(":");
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? {
            ...scenario,
            attacks: scenario.attacks.map((attack) => (
              attack.id === attackId
                ? { ...attack, attackerStatPoints: { ...attack.attackerStatPoints, [key]: value } }
                : attack
            )),
          }
        : scenario
    )));
  };

  const updateScenarioAttack = <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => {
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? {
            ...scenario,
            attacks: scenario.attacks.map((attack) => (
              attack.id === attackId ? { ...attack, [key]: value } : attack
            )),
          }
        : scenario
    )));
  };

  const handleAddAttack = (scenarioId: string) => {
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? {
            ...scenario,
            attacks: [...scenario.attacks, createBlankAttack(scenario.attacks.length)],
          }
        : scenario
    )));
  };

  const handleRemoveAttack = (scenarioId: string, attackId: string) => {
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? {
            ...scenario,
            attacks: scenario.attacks.length <= 1
              ? scenario.attacks
              : scenario.attacks.filter((attack) => attack.id !== attackId),
          }
        : scenario
    )));
  };

  const handleAddScenario = () => {
    const nextScenario = createScenario(scenarioForms.length);
    setScenarioForms((current) => [...current, nextScenario]);
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
          actualStats={actualStats}
          totalStatPoints={sumStatPoints(targetForm.statPoints)}
        />
        <ScenarioPanel
          scenarios={scenarioForms}
          onAddScenario={handleAddScenario}
          onRemoveScenario={handleRemoveScenario}
          onUpdateScenario={updateScenario}
          onAddAttack={handleAddAttack}
          onRemoveAttack={handleRemoveAttack}
          onUpdateAttack={updateScenarioAttack}
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
  actualStats: StatTable | null;
  totalStatPoints: number;
  onUpdateField: <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => void;
  onUpdateEv: (key: StatKey, value: number) => void;
};

function TargetPanel({
  targetForm,
  canonicalPokemon,
  actualStats,
  totalStatPoints,
  onUpdateField,
  onUpdateEv,
}: TargetPanelProps) {
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

      <div className="ev-table" aria-label="調整対象のSP">
        <div className="ev-header">
          <span>能力</span>
          <span>実数値</span>
          <span>現在SP</span>
          <span>SP配分</span>
          <span>固定</span>
        </div>
        {statKeys.map((key) => (
          <div className={`ev-row ${key}`} key={key}>
            <strong>{statLabels[key]}</strong>
            <span className="actual-stat">{actualStats?.[key] ?? "-"}</span>
            <input
              type="number"
              min="0"
              max={CHAMPIONS_MAX_STAT_POINTS_PER_STAT}
              step="1"
              value={targetForm.statPoints[key]}
              aria-label={`${statLabels[key]} SP`}
              onChange={(event) => onUpdateEv(key, toNumber(event.target.value))}
            />
            <div className="bar"><i style={{ width: `${Math.min(100, (targetForm.statPoints[key] / CHAMPIONS_MAX_STAT_POINTS_PER_STAT) * 100)}%` }} /></div>
            <span className={defenceStatKeySet.has(key) ? "search-chip" : "fixed-chip"}>
              {defenceStatKeySet.has(key) ? "HBD" : "固定"}
            </span>
          </div>
        ))}
      </div>

      <div className="sp-summary">
        <span>合計SP</span>
        <strong>{totalStatPoints} / {CHAMPIONS_TOTAL_STAT_POINTS}</strong>
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
  onAddAttack: (scenarioId: string) => void;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onUpdateAttack: <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
};

function ScenarioPanel({
  scenarios,
  onAddScenario,
  onRemoveScenario,
  onUpdateScenario,
  onAddAttack,
  onRemoveAttack,
  onUpdateAttack,
  onUpdateAttackerEv,
}: ScenarioPanelProps) {
  return (
    <section className="scenario-panel" aria-labelledby="scenario-title">
      <div className="section-heading">
        <div>
          <h2 id="scenario-title">仮想敵シナリオ</h2>
          <span>1行の中で攻撃A+Bを累積条件として同時評価</span>
        </div>
        <button className="ghost-button" type="button" onClick={onAddScenario}>+ シナリオを追加</button>
      </div>

      <div className="scenario-stack" aria-label="仮想敵シナリオ行">
        {scenarios.map((scenario) => (
          <ScenarioRow
            key={scenario.id}
            scenario={scenario}
            onAddAttack={onAddAttack}
            onRemoveAttack={onRemoveAttack}
            onRemoveScenario={onRemoveScenario}
            onUpdateScenario={onUpdateScenario}
            onUpdateAttack={onUpdateAttack}
            onUpdateAttackerEv={onUpdateAttackerEv}
          />
        ))}
        <button className="scenario-add-row" type="button" onClick={onAddScenario}>
          ダメージ計算を追加
        </button>
      </div>
    </section>
  );
}

type ScenarioRowProps = {
  scenario: ScenarioFormState;
  onAddAttack: (scenarioId: string) => void;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onRemoveScenario: (id: string) => void;
  onUpdateScenario: <K extends keyof ScenarioFormState>(
    id: string,
    key: K,
    value: ScenarioFormState[K],
  ) => void;
  onUpdateAttack: <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
};

function ScenarioRow({
  scenario,
  onAddAttack,
  onRemoveAttack,
  onRemoveScenario,
  onUpdateScenario,
  onUpdateAttack,
  onUpdateAttackerEv,
}: ScenarioRowProps) {
  return (
    <article className={`scenario-row${scenario.enabled ? "" : " disabled"}`} aria-label={scenario.label}>
      <div className="scenario-row-header">
        <label className="switch" aria-label={`${scenario.label}を有効化`}>
          <input
            type="checkbox"
            checked={scenario.enabled}
            onChange={(event) => onUpdateScenario(scenario.id, "enabled", event.target.checked)}
          />
          <span />
        </label>
        <input
          className="inline-title-input"
          value={scenario.label}
          aria-label="シナリオ名"
          onChange={(event) => onUpdateScenario(scenario.id, "label", event.target.value)}
        />
        <button
          className="ghost-button danger"
          type="button"
          aria-label={`${scenario.label}を削除`}
          onClick={() => onRemoveScenario(scenario.id)}
        >
          行を削除
        </button>
      </div>

      <div className="scenario-attack-lane">
        {scenario.attacks.map((attack, attackIndex) => (
          <AttackCard
            key={attack.id}
            attack={attack}
            attackIndex={attackIndex}
            scenarioId={scenario.id}
            canRemove={scenario.attacks.length > 1}
            onRemoveAttack={onRemoveAttack}
            onUpdateAttack={onUpdateAttack}
            onUpdateAttackerEv={onUpdateAttackerEv}
          />
        ))}
        <button
          className="attack-add-card"
          type="button"
          aria-label={`${scenario.label}に攻撃を追加`}
          onClick={() => onAddAttack(scenario.id)}
        >
          <span>+</span>
        </button>
      </div>
    </article>
  );
}

type AttackCardProps = {
  attack: ScenarioAttackFormState;
  attackIndex: number;
  scenarioId: string;
  canRemove: boolean;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onUpdateAttack: <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
};

function AttackCard({
  attack,
  attackIndex,
  scenarioId,
  canRemove,
  onRemoveAttack,
  onUpdateAttack,
  onUpdateAttackerEv,
}: AttackCardProps) {
  const onInput = <K extends keyof ScenarioAttackFormState>(key: K) => (
    event: ChangeEvent<HTMLInputElement>,
  ) => onUpdateAttack(scenarioId, attack.id, key, event.target.value as ScenarioAttackFormState[K]);
  const attackLabel = attack.label || `攻撃${String.fromCharCode(65 + attackIndex)}`;

  return (
    <section className="attack-condition-card" aria-label={attackLabel}>
      <div className="attack-card-header">
        <input
          className="inline-title-input"
          value={attack.label}
          aria-label="攻撃名"
          onChange={onInput("label")}
        />
        <button
          className="icon-button"
          type="button"
          aria-label={`${attackLabel}を削除`}
          disabled={!canRemove}
          onClick={() => onRemoveAttack(scenarioId, attack.id)}
        >
          ×
        </button>
      </div>

      <div className="attack-card-fields">
        <ScenarioTextField label="攻撃側" showLabel value={attack.attackerPokemonInput} onChange={onInput("attackerPokemonInput")} />
        <ScenarioTextField label="技" showLabel value={attack.moveInput} onChange={onInput("moveInput")} />
        <ScenarioTextField label="性格" showLabel value={attack.attackerNatureInput} onChange={onInput("attackerNatureInput")} />
        <ScenarioTextField label="持ち物" showLabel value={attack.attackerItemInput} placeholder="任意" onChange={onInput("attackerItemInput")} />
      </div>

      <div className="attack-number-grid">
        <ScenarioNumberField
          label="Lv."
          showLabel
          value={attack.attackerLevel}
          min={1}
          max={100}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerLevel", value)}
        />
        <ScenarioNumberField
          label="回数"
          showLabel
          value={attack.repeat}
          min={1}
          max={10}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "repeat", value)}
        />
        <ScenarioNumberField
          label="必要耐久"
          showLabel
          value={attack.requiredSurvivedHits}
          min={1}
          max={10}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "requiredSurvivedHits", value)}
        />
        <ScenarioNumberField
          label="生存率%"
          showLabel
          value={attack.minSurvivalProbabilityPercent}
          min={0}
          max={100}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "minSurvivalProbabilityPercent", value)}
        />
      </div>

      <div className="attack-field-grid">
        <label>
          天候
          <select
            value={attack.weather}
            onChange={(event) => onUpdateAttack(scenarioId, attack.id, "weather", event.target.value as Weather)}
          >
            {weatherOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          フィールド
          <select
            value={attack.terrain}
            onChange={(event) => onUpdateAttack(scenarioId, attack.id, "terrain", event.target.value as Terrain)}
          >
            {terrainOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>

      <div className="attacker-evs" aria-label={`${attackLabel} 攻撃側SP`}>
        {fixedStatKeys.map((key) => (
          <label key={key}>
            {statLabels[key]} SP
            <input
              type="number"
              min="0"
              max={CHAMPIONS_MAX_STAT_POINTS_PER_STAT}
              step="1"
              value={attack.attackerStatPoints[key]}
              onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, key, toNumber(event.target.value))}
            />
          </label>
        ))}
      </div>

      <div className="scenario-options">
        <label><input type="checkbox" checked={attack.critical} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "critical", event.target.checked)} /> 急所</label>
        <label><input type="checkbox" checked={attack.reflect} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "reflect", event.target.checked)} /> リフレクター</label>
        <label><input type="checkbox" checked={attack.lightScreen} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "lightScreen", event.target.checked)} /> ひかりのかべ</label>
        <label><input type="checkbox" checked={attack.auroraVeil} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "auroraVeil", event.target.checked)} /> オーロラベール</label>
        <label><input type="checkbox" checked={attack.helpingHand} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "helpingHand", event.target.checked)} /> てだすけ</label>
      </div>
    </section>
  );
}

type ScenarioTextFieldProps = {
  label: string;
  showLabel: boolean;
  value: string;
  placeholder?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

function ScenarioTextField({ label, showLabel, value, placeholder, onChange }: ScenarioTextFieldProps) {
  return (
    <label className="scenario-cell">
      {showLabel ? <span className="row-label">{label}</span> : null}
      <input value={value} placeholder={showLabel ? placeholder : undefined} aria-label={label} onChange={onChange} />
    </label>
  );
}

type ScenarioNumberFieldProps = {
  label: string;
  showLabel: boolean;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
};

function ScenarioNumberField({ label, showLabel, value, min, max, onChange }: ScenarioNumberFieldProps) {
  return (
    <label className="scenario-cell number-cell">
      {showLabel ? <span className="row-label">{label}</span> : null}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(toNumber(event.target.value, min))}
      />
    </label>
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
          <span>順位</span><span>H/B/D</span><span>使用SP</span><span>残りSP</span><span>ボトルネック</span>
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
            <span>{candidate.usedStatPointBudget}</span>
            <span>{candidate.remainingStatPointBudget}</span>
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
            {statKeys.map((key) => <strong key={key}>{candidate.appliedStatPoints[key]}</strong>)}
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
