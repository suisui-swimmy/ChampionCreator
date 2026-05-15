import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { wireframeProject } from "./data/wireframeFixture";
import {
  STAT_KEYS,
  type BaseScenario,
  type Candidate,
  type ChampionsStatPoints,
  type Constraint,
  type Result,
  type ScenarioKind,
  type ScenarioRow,
  type SpeciesRef,
} from "./domain/model";
import { sumStatPoints, validateStatPoints } from "./domain/statPoints";
import { APP_VERSION, CALC_ENGINE_VERSION, DATA_VERSION } from "./version";

const statLabels: Record<keyof ChampionsStatPoints, string> = {
  hp: "H",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

const statNames: Record<keyof ChampionsStatPoints, string> = {
  hp: "HP",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

const statIcons: Record<keyof ChampionsStatPoints, string> = {
  hp: "♥",
  atk: "✦",
  def: "⬟",
  spa: "◉",
  spd: "⬡",
  spe: "≋",
};

const scenarioKindLabels: Record<ScenarioKind, string> = {
  defence: "耐久",
  offence: "火力",
  speed: "素早さ",
};

interface PokemonOption {
  id: string;
  label: string;
  showdownName: string;
  types: string[];
  searchText: string;
  artwork?: string;
  fallback?: {
    from?: string;
    reason?: string;
    nameSourceStatus?: string;
    assetSourceStatus?: string;
  };
}

interface PokemonOptionsPayload {
  entries: PokemonOption[];
}

interface PokemonLookup {
  byId: Map<string, PokemonOption>;
  byShowdownName: Map<string, PokemonOption>;
}

const defaultTargetPokemonId = "charizardmegax";

const formatPercent = (value: number): string => `${Math.round(value * 1000) / 10}%`;

const normalizePokemonKey = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const normalizePokemonSearch = (value: string): string =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");

const pokemonOptionLabel = (option: PokemonOption): string =>
  option.showdownName === option.label ? option.label : `${option.label} / ${option.showdownName}`;

const pokemonOptionSearchScore = (option: PokemonOption, query: string): number => {
  const normalizedQuery = normalizePokemonSearch(query);

  if (!normalizedQuery) {
    return 0;
  }

  const primaryTokens = [
    option.label,
    option.showdownName,
    option.id,
    pokemonOptionLabel(option),
  ].map(normalizePokemonSearch);
  const searchTokens = option.searchText.split(" ").map(normalizePokemonSearch);

  if (primaryTokens.some((value) => value.startsWith(normalizedQuery))) {
    return 0;
  }

  if (searchTokens.some((value) => value.startsWith(normalizedQuery))) {
    return 1;
  }

  if (primaryTokens.some((value) => value.includes(normalizedQuery))) {
    return 2;
  }

  if (searchTokens.some((value) => value.includes(normalizedQuery))) {
    return 3;
  }

  return Number.POSITIVE_INFINITY;
};

const getPokemonOptionForSpecies = (
  species: SpeciesRef,
  lookup: PokemonLookup,
  targetPokemon?: PokemonOption,
): PokemonOption | undefined =>
  species.id === wireframeProject.target.species.id
    ? targetPokemon
    : lookup.byId.get(species.id) ?? lookup.byShowdownName.get(normalizePokemonKey(species.showdownName));

function usePokemonOptions() {
  const [pokemonOptions, setPokemonOptions] = useState<PokemonOption[]>([]);

  useEffect(() => {
    let mounted = true;

    void import("./data/generated/pokemon-options.gen.json").then((module) => {
      if (mounted) {
        setPokemonOptions((module.default as PokemonOptionsPayload).entries);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return pokemonOptions;
}

const findConstraint = (scenarioId: string): Constraint | undefined =>
  wireframeProject.constraints.find((constraint) => constraint.scenarioId === scenarioId);

const findScenario = (scenarioId: string): BaseScenario | undefined =>
  wireframeProject.scenarios.find((scenario) => scenario.id === scenarioId);

const scenarioSummary = (scenario: BaseScenario): string => {
  const constraint = findConstraint(scenario.id);

  if (constraint?.type === "survive") {
    return `${constraint.hits}回耐える ${formatPercent(constraint.minSurvivalRate)}以上`;
  }

  if (constraint?.type === "ko") {
    return `${constraint.hits}発KO ${formatPercent(constraint.minKoRate)}以上`;
  }

  if (constraint?.type === "outspeed") {
    return `相手を${constraint.minMargin}以上上回る`;
  }

  return "条件未設定";
};

function Field({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string | number;
  compact?: boolean;
}) {
  return (
    <label className={`field ${compact ? "field-compact" : ""}`}>
      <span>{label}</span>
      <select value={String(value)} onChange={() => undefined}>
        <option>{value}</option>
      </select>
    </label>
  );
}

function PokemonField({
  label,
  options,
  selectedId,
  fallbackLabel,
  onChange,
}: {
  label: string;
  options: PokemonOption[];
  selectedId: string;
  fallbackLabel: string;
  onChange: (pokemonId: string) => void;
}) {
  const inputId = "target-pokemon-input";
  const listboxId = "target-pokemon-listbox";
  const isComposingRef = useRef(false);
  const selectedOption = options.find((option) => option.id === selectedId);
  const selectedLabel = selectedOption ? pokemonOptionLabel(selectedOption) : fallbackLabel;
  const [query, setQuery] = useState(selectedLabel);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(selectedLabel);
    setActiveIndex(0);
  }, [selectedLabel]);

  const filteredOptions = useMemo(
    () =>
      options
        .map((option) => ({
          option,
          score: pokemonOptionSearchScore(option, query),
        }))
        .filter(({ score }) => Number.isFinite(score))
        .sort((a, b) => {
          if (a.score !== b.score) {
            return a.score - b.score;
          }

          return a.option.label.localeCompare(b.option.label, "ja");
        })
        .map(({ option }) => option)
        .slice(0, 24),
    [options, query],
  );
  const activeOption = filteredOptions[activeIndex];
  const hasOptions = options.length > 0;

  const selectOption = (option: PokemonOption) => {
    onChange(option.id);
    setQuery(pokemonOptionLabel(option));
    setIsOpen(false);
    setActiveIndex(0);
  };

  return (
    <div
      className="field pokemon-field"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;

        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsOpen(false);
          setQuery(selectedLabel);
        }
      }}
    >
      <label htmlFor={inputId}>{label}</label>
      <div className="pokemon-combobox">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={isOpen}
          aria-activedescendant={activeOption ? `${listboxId}-${activeOption.id}` : undefined}
          value={query}
          disabled={!hasOptions}
          placeholder={hasOptions ? "日本語名 / English / ID" : fallbackLabel}
          onFocus={() => {
            if (hasOptions) {
              setIsOpen(true);
            }
          }}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (isComposingRef.current || event.nativeEvent.isComposing) {
              return;
            }

            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((current) =>
                Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)),
              );
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(current - 1, 0));
            }

            if (event.key === "Enter" && isOpen && activeOption) {
              event.preventDefault();
              selectOption(activeOption);
            }

            if (event.key === "Escape") {
              event.preventDefault();
              setIsOpen(false);
              setQuery(selectedLabel);
            }
          }}
        />
        <button
          type="button"
          aria-label="ポケモン候補を開く"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (hasOptions) {
              setIsOpen((current) => !current);
            }
          }}
          disabled={!hasOptions}
        >
          ⌄
        </button>
        {isOpen && hasOptions && (
          <div className="pokemon-options" id={listboxId} role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => (
                <button
                  type="button"
                  className={`pokemon-option ${index === activeIndex ? "is-active" : ""}`}
                  id={`${listboxId}-${option.id}`}
                  role="option"
                  aria-selected={option.id === selectedId}
                  key={option.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span className="pokemon-option-art">
                    {option.artwork ? <img src={option.artwork} alt="" /> : option.label.slice(0, 1)}
                  </span>
                  <span className="pokemon-option-main">
                    <strong>{option.label}</strong>
                    <small>{option.showdownName}</small>
                  </span>
                  <span className="pokemon-option-types">{option.types.join(" / ")}</span>
                </button>
              ))
            ) : (
              <div className="pokemon-option-empty">候補なし</div>
            )}
          </div>
        )}
      </div>
      <small className="pokemon-field-count">
        {hasOptions ? `${filteredOptions.length} / ${options.length}` : "読み込み中"}
      </small>
    </div>
  );
}

function NumberField({ label, value }: { label: string; value: number }) {
  return (
    <label className="field field-number">
      <span>{label}</span>
      <input type="number" value={value} readOnly />
    </label>
  );
}

function Toggle({ checked }: { checked: boolean }) {
  return (
    <span className={`toggle ${checked ? "is-on" : ""}`} aria-hidden="true">
      <span />
    </span>
  );
}

function TickBar({ stat, value }: { stat: keyof ChampionsStatPoints; value: number }) {
  return (
    <div className="tick-bar" aria-label={`${statLabels[stat]} ${value} SP`}>
      {Array.from({ length: 32 }, (_, index) => (
        <span className={index < value ? `is-filled tick-${stat}` : ""} key={index} />
      ))}
    </div>
  );
}

function StatEditorRow({
  stat,
  value,
  actual,
  fixed,
  lowerBound,
}: {
  stat: keyof ChampionsStatPoints;
  value: number;
  actual: number;
  fixed: boolean;
  lowerBound: number;
}) {
  return (
    <div className={`stat-editor-row stat-row-${stat}`}>
      <span className="stat-icon">{statIcons[stat]}</span>
      <strong>{statNames[stat]}</strong>
      <span className="actual-value">{actual}</span>
      <input className="sp-stepper" type="number" min={0} max={32} value={value} readOnly />
      <TickBar stat={stat} value={value} />
      <input type="checkbox" checked={fixed} readOnly aria-label={`${statLabels[stat]} 固定`} />
      <input className="lower-bound" type="number" value={lowerBound} readOnly />
    </div>
  );
}

function TargetPanel({
  pokemonOptions,
  selectedPokemonId,
  onSelectedPokemonIdChange,
}: {
  pokemonOptions: PokemonOption[];
  selectedPokemonId: string;
  onSelectedPokemonIdChange: (pokemonId: string) => void;
}) {
  const target = wireframeProject.target;
  const totalSp = sumStatPoints(target.statPoints);
  const statErrors = validateStatPoints(target.statPoints);
  const selectedPokemon =
    pokemonOptions.find((option) => option.id === selectedPokemonId) ?? pokemonOptions[0];
  const targetDisplayName = selectedPokemon?.label ?? target.species.displayName;
  const targetArtwork = selectedPokemon?.artwork ?? target.species.iconAsset;
  const targetTypes = selectedPokemon?.types.join(" / ") ?? "ほのお / ドラゴン";

  return (
    <section className="target-console" aria-labelledby="target-title">
      <div className="target-title-row">
        <div>
          <p className="eyebrow">調整対象</p>
          <h1 id="target-title">自分のポケモン</h1>
        </div>
        <span className="version-pill">schema v{wireframeProject.schemaVersion}</span>
      </div>

      <div className="target-main-grid">
        <div className="target-form">
          <PokemonField
            label="ポケモン"
            options={pokemonOptions}
            selectedId={selectedPokemon?.id ?? selectedPokemonId}
            fallbackLabel={target.species.displayName}
            onChange={onSelectedPokemonIdChange}
          />
          <Field label="性格" value={target.nature} />
          <NumberField label="Lv." value={target.level} />
          <Field label="特性" value={target.ability ?? "未指定"} />
          <Field label="持ち物" value={target.item ?? "未指定"} />
        </div>
        <div className="target-art">
          <img
            src={targetArtwork}
            alt={targetDisplayName}
            onLoad={(event) => {
              event.currentTarget.style.display = "";
            }}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        </div>
      </div>

      <div className="chip-grid">
        <Field label="タイプ" value={targetTypes} compact />
        <Field label="テラスタイプ" value={target.teraType ?? "未指定"} compact />
        <div className="boost-buttons" aria-label="性格補正">
          <span>性格補正</span>
          <button type="button">C↑</button>
          <button type="button">S↓</button>
        </div>
      </div>

      <div className="stat-table-header">
        <span>能力</span>
        <span>実数値</span>
        <span>現在SP</span>
        <span>SP配分（0〜32）</span>
        <span>固定</span>
        <span>下限</span>
      </div>

      <div className="stat-editor">
        {STAT_KEYS.map((stat) => (
          <StatEditorRow
            key={stat}
            stat={stat}
            value={target.statPoints[stat]}
            actual={target.manualOverrides?.finalStats?.[stat] ?? 0}
            fixed={wireframeProject.searchBudget.fixed[stat] !== undefined}
            lowerBound={wireframeProject.searchBudget.lowerBounds[stat] ?? 0}
          />
        ))}
      </div>

      <div className="target-footer">
        <strong>合計SP</strong>
        <span>{totalSp} / {wireframeProject.searchBudget.maxTotal}</span>
        <button type="button">リセット</button>
      </div>

      {statErrors.length > 0 && (
        <div className="warning-box">
          {statErrors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function AttackCard({
  scenario,
  collapsed,
  onSelect,
  selected,
  pokemonLookup,
  targetPokemon,
}: {
  scenario: BaseScenario;
  collapsed: boolean;
  onSelect: () => void;
  selected: boolean;
  pokemonLookup: PokemonLookup;
  targetPokemon?: PokemonOption;
}) {
  const attackerPokemon = getPokemonOptionForSpecies(
    scenario.attacker.species,
    pokemonLookup,
    targetPokemon,
  );
  const attackerName = attackerPokemon?.label ?? scenario.attacker.species.displayName;
  const attackerArtwork = attackerPokemon?.artwork ?? scenario.attacker.species.iconAsset;

  return (
    <article
      className={`attack-card attack-${scenario.kind} ${selected ? "is-selected" : ""} ${
        scenario.enabled ? "" : "is-disabled"
      } ${collapsed ? "is-collapsed" : ""}`}
      onClick={onSelect}
    >
      <div className="attack-card-header">
        <Toggle checked={scenario.enabled} />
        <strong>{attackerName}</strong>
        <span className="chevron">{collapsed ? "›" : "⌄"}</span>
      </div>

      <div className="attack-card-body">
        <div className="mini-sprite">
          {attackerArtwork ? (
            <img
              src={attackerArtwork}
              alt=""
              onLoad={(event) => {
                event.currentTarget.style.display = "";
              }}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span>{attackerName.slice(0, 1)}</span>
          )}
        </div>
        <div className="attack-fields">
          <Field label="技" value={scenario.move?.displayName ?? "速度比較"} compact />
          <Field label="性格" value={scenario.attacker.nature} compact />
          <Field label="持ち物" value={scenario.attacker.item ?? "未指定"} compact />
          <Field label="天候" value={scenario.field.weather ?? "none"} compact />
        </div>
      </div>

      <div className="condition-row">
        <span>{scenarioSummary(scenario)}</span>
        <span>{scenario.tags.join(" / ")}</span>
      </div>

      <div className="checkbox-grid">
        <label><input type="checkbox" checked={Boolean(scenario.field.reflect)} readOnly /> リフレクター</label>
        <label><input type="checkbox" checked={Boolean(scenario.field.lightScreen)} readOnly /> ひかりのかべ</label>
        <label><input type="checkbox" checked={Boolean(scenario.field.criticalHit)} readOnly /> 急所</label>
        <label><input type="checkbox" checked={Boolean(scenario.field.spreadMove)} readOnly /> 範囲</label>
      </div>

      <div className="attack-footer">
        <span>{scenario.move?.typeName ?? "Speed"}</span>
        <strong>{scenarioKindLabels[scenario.kind]}</strong>
      </div>
    </article>
  );
}

function ScenarioRowView({
  row,
  collapsed,
  onToggleCollapse,
  selectedScenarioId,
  onSelectScenario,
  pokemonLookup,
  targetPokemon,
}: {
  row: ScenarioRow;
  collapsed: boolean;
  onToggleCollapse: () => void;
  selectedScenarioId: string;
  onSelectScenario: (scenarioId: string) => void;
  pokemonLookup: PokemonLookup;
  targetPokemon?: PokemonOption;
}) {
  const rowScenarios = row.scenarioIds
    .map(findScenario)
    .filter((scenario): scenario is BaseScenario => Boolean(scenario));

  return (
    <section className={`scenario-band scenario-${row.kind} ${row.enabled ? "" : "is-off"}`}>
      <button className="scenario-band-header" type="button" onClick={onToggleCollapse}>
        <Toggle checked={row.enabled} />
        <strong>{row.label}</strong>
        <span className="kind-badge">{scenarioKindLabels[row.kind]}</span>
        <span>{row.title}</span>
        <small>{row.goalSummary}</small>
        <span className="chevron">{collapsed ? "›" : "⌄"}</span>
      </button>

      {!collapsed && (
        <div className="scenario-attack-strip">
          {rowScenarios.map((scenario) => (
            <AttackCard
              key={scenario.id}
              scenario={scenario}
              collapsed={false}
              selected={selectedScenarioId === scenario.id}
              onSelect={() => onSelectScenario(scenario.id)}
              pokemonLookup={pokemonLookup}
              targetPokemon={targetPokemon}
            />
          ))}

          <button className="add-attack-card" type="button">
            <span>＋</span>
            <strong>攻撃を追加</strong>
          </button>
        </div>
      )}
    </section>
  );
}

function ScenarioBoard({
  selectedScenarioId,
  onSelectScenario,
  pokemonLookup,
  targetPokemon,
}: {
  selectedScenarioId: string;
  onSelectScenario: (scenarioId: string) => void;
  pokemonLookup: PokemonLookup;
  targetPokemon?: PokemonOption;
}) {
  const [collapsedRows, setCollapsedRows] = useState<Record<string, boolean>>({
    "scenario-row-d": true,
  });

  return (
    <section className="scenario-board" aria-labelledby="scenario-title">
      <div className="board-toolbar">
        <div>
          <p className="eyebrow">仮想敵シナリオ</p>
          <h2 id="scenario-title">行で条件を持つ</h2>
        </div>
        <div className="board-actions">
          <button type="button">並び替え</button>
          <button type="button">すべて展開</button>
          <button type="button" className="primary-soft">＋ シナリオを追加</button>
        </div>
      </div>

      <div className="scenario-stack">
        {wireframeProject.scenarioRows.map((row) => (
          <ScenarioRowView
            key={row.id}
            row={row}
            collapsed={Boolean(collapsedRows[row.id])}
            selectedScenarioId={selectedScenarioId}
            onSelectScenario={onSelectScenario}
            pokemonLookup={pokemonLookup}
            targetPokemon={targetPokemon}
            onToggleCollapse={() =>
              setCollapsedRows((current) => ({
                ...current,
                [row.id]: !current[row.id],
              }))
            }
          />
        ))}
      </div>

      <button className="add-scenario-row" type="button">
        ＋ シナリオを追加
      </button>
    </section>
  );
}

function CandidateRibbon({ candidate }: { candidate: Candidate }) {
  return (
    <div className="candidate-ribbon" aria-label="候補 SP リボン">
      {STAT_KEYS.map((stat) => (
        <div className="ribbon-stat" key={stat}>
          <span>{candidate.statPoints[stat]}</span>
          <TickBar stat={stat} value={candidate.statPoints[stat]} />
        </div>
      ))}
    </div>
  );
}

function ResultLane({
  result,
  rank,
  selected,
  onSelect,
}: {
  result: Result;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const passed = result.evaluations.filter((evaluation) => evaluation.passed).length;
  const bottleneck = findScenario(result.bottleneckScenarioId);
  const margin = result.evaluations.find(
    (evaluation) => evaluation.scenarioId === result.bottleneckScenarioId,
  );

  return (
    <button className={`result-lane ${selected ? "is-selected" : ""}`} type="button" onClick={onSelect}>
      <span className="rank-medal">{rank === 1 ? "♛" : rank}</span>
      <CandidateRibbon candidate={result.candidate} />
      <span className="sp-total">{result.candidate.totalSp} / {result.candidate.remainingSp}</span>
      <strong className={passed === result.evaluations.length ? "pass-count" : "partial-count"}>
        {passed} / {result.evaluations.length}
      </strong>
      <span className="bottleneck-chip">
        {bottleneck?.title ?? result.bottleneckScenarioId}
        <small>余裕 {margin ? formatPercent(Math.max(margin.probability - 0.86, 0)) : "-"}</small>
      </span>
      <span className="lane-arrow">›</span>
    </button>
  );
}

function ResultInspector({ result }: { result: Result }) {
  return (
    <aside className="result-inspector" aria-labelledby="inspector-title">
      <div className="inspector-header">
        <div>
          <p className="eyebrow">選択中の候補</p>
          <h2 id="inspector-title">{result.candidate.id}</h2>
        </div>
        <div className="inspector-actions">
          <button type="button">メモ</button>
          <button type="button" className="primary-soft">適用</button>
        </div>
      </div>

      <CandidateRibbon candidate={result.candidate} />

      <div className="inspector-sp">
        <div><span>使用SP</span><strong>{result.candidate.totalSp} / 66</strong></div>
        <div><span>残りSP</span><strong>{result.candidate.remainingSp}</strong></div>
      </div>

      <div className="tabs" role="tablist" aria-label="候補詳細">
        <button className="is-active" type="button">条件の確認</button>
        <button type="button">詳細ステータス</button>
        <button type="button">ダメージ内訳</button>
      </div>

      <div className="condition-tree">
        {wireframeProject.scenarioRows.map((row) => {
          const rowEvaluations = result.evaluations.filter((evaluation) =>
            row.scenarioIds.includes(evaluation.scenarioId),
          );

          if (rowEvaluations.length === 0) {
            return null;
          }

          return (
            <section className="condition-group" key={row.id}>
              <header>
                <span className={`kind-dot kind-${row.kind}`} />
                <strong>{row.label}</strong>
                <small>{row.title}</small>
              </header>
              {rowEvaluations.map((evaluation) => {
                const scenario = findScenario(evaluation.scenarioId);

                return (
                  <div className="condition-result" key={evaluation.scenarioId}>
                    <span>{scenario?.attacker.species.displayName ?? evaluation.scenarioId}</span>
                    <span>{scenario?.move?.displayName ?? "速度比較"}</span>
                    <strong>{formatPercent(evaluation.probability)}</strong>
                    <em className={evaluation.passed ? "pass" : "fail"}>
                      {evaluation.passed ? "PASS" : "FAIL"}
                    </em>
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function ResultsBoard() {
  const [selectedResultId, setSelectedResultId] = useState(wireframeProject.results[0].candidate.id);
  const selectedResult =
    wireframeProject.results.find((result) => result.candidate.id === selectedResultId) ??
    wireframeProject.results[0];

  return (
    <section className="results-board" aria-labelledby="results-title">
      <div className="results-toolbar">
        <div>
          <p className="eyebrow">結果</p>
          <h2 id="results-title">候補比較ボード</h2>
        </div>
        <div className="run-controls">
          <button type="button" className="primary-button">▶ 計算開始</button>
          <button type="button">■ 停止</button>
          <Field label="探索モード" value={wireframeProject.searchBudget.mode} compact />
        </div>
      </div>

      <div className="results-layout">
        <aside className="filter-panel">
          <h3>表示フィルタ</h3>
          <label><input type="checkbox" checked readOnly /> 耐久</label>
          <label><input type="checkbox" checked readOnly /> 火力</label>
          <label><input type="checkbox" checked readOnly /> 素早さ</label>
          <hr />
          <label><input type="checkbox" checked readOnly /> PASSのみ</label>
          <label><input type="checkbox" readOnly /> FAILを含む</label>
          <Field label="ソート" value="推奨（ボトルネック）" />
        </aside>

        <div className="candidate-list" role="list">
          <div className="candidate-head">
            <span>順位</span>
            <span>SP配分（H-A-B-C-D-S）</span>
            <span>使用SP / 残りSP</span>
            <span>PASS条件</span>
            <span>ボトルネック</span>
          </div>
          {wireframeProject.results.map((result, index) => (
            <ResultLane
              key={result.candidate.id}
              result={result}
              rank={index + 1}
              selected={selectedResult.candidate.id === result.candidate.id}
              onSelect={() => setSelectedResultId(result.candidate.id)}
            />
          ))}
          <div className="result-count">全 38 件中 1-5 件を表示</div>
        </div>

        <ResultInspector result={selectedResult} />
      </div>
    </section>
  );
}

function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(wireframeProject.scenarios[0].id);
  const [selectedPokemonId, setSelectedPokemonId] = useState(defaultTargetPokemonId);
  const pokemonOptions = usePokemonOptions();
  const pokemonLookup = useMemo<PokemonLookup>(
    () => ({
      byId: new Map(pokemonOptions.map((option) => [option.id, option])),
      byShowdownName: new Map(
        pokemonOptions.map((option) => [normalizePokemonKey(option.showdownName), option]),
      ),
    }),
    [pokemonOptions],
  );
  const selectedTargetPokemon = pokemonLookup.byId.get(selectedPokemonId);

  const selectedScenario = useMemo(
    () => findScenario(selectedScenarioId) ?? wireframeProject.scenarios[0],
    [selectedScenarioId],
  );

  const copyProjectJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(wireframeProject, null, 2));
  };

  return (
    <main className="app-shell">
      <header className="app-topbar">
        <div>
          <p className="eyebrow">ChampionCreator</p>
          <strong>{wireframeProject.title}</strong>
        </div>
        <div className="topbar-meta">
          <span>App {APP_VERSION}</span>
          <span>Calc {CALC_ENGINE_VERSION}</span>
          <span>Data {DATA_VERSION}</span>
          <button type="button" onClick={copyProjectJson}>JSON</button>
          <button type="button">MD</button>
        </div>
      </header>

      <div className="authoring-grid">
        <TargetPanel
          pokemonOptions={pokemonOptions}
          selectedPokemonId={selectedPokemonId}
          onSelectedPokemonIdChange={setSelectedPokemonId}
        />
        <ScenarioBoard
          selectedScenarioId={selectedScenario.id}
          onSelectScenario={setSelectedScenarioId}
          pokemonLookup={pokemonLookup}
          targetPokemon={selectedTargetPokemon}
        />
      </div>

      <ResultsBoard />
    </main>
  );
}

export default App;
