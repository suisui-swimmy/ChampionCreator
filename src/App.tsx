import { type ChangeEvent, type FocusEvent, type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  clampStatPointValue,
  smogonEvToStatPoints,
  sumStatPoints,
} from "./domain/championsStats";
import type {
  CandidateResult,
  GameType,
  PokemonStatus,
  StatBoostTable,
  StatKey,
  StatTable,
  Terrain,
  Weather,
} from "./domain/model";
import type { EntityKind } from "./data/localizationTypes";
import { appVersionInfo } from "./appVersion";
import { getMatchingEntityInputOptions } from "./localization/resolver";
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
import { findPokemonArtwork, type PokemonArtworkMatch } from "./ui/pokemonArtwork";
import {
  getPokemonBaseFormValue,
  getPokemonFormVariantOptions,
  isPokemonFormVariant,
  type PokemonFormVariantKind,
  type PokemonFormVariantOption,
} from "./ui/pokemonFormVariants";
import { parseShareStateDocument, stringifyShareStateDocument } from "./ui/shareState";
import { Button, SelectField, StatusBadge } from "./ui/primitives";
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

const statIconFiles: Record<StatKey, string> = {
  hp: "H.svg",
  atk: "A.svg",
  def: "B.svg",
  spa: "C.svg",
  spd: "D.svg",
  spe: "S.svg",
};

const statKeys = ["hp", "atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];
const defenceStatKeys = ["hp", "def", "spd"] as const satisfies readonly StatKey[];
const defenceStatKeySet = new Set<StatKey>(defenceStatKeys);
const attackerBoostKeys = ["atk", "def", "spa"] as const satisfies readonly (keyof StatBoostTable)[];
const defenderBoostKeys = ["def", "spd"] as const satisfies readonly (keyof StatBoostTable)[];

const statusOptions: Array<{ value: PokemonStatus; label: string }> = [
  { value: "none", label: "なし" },
  { value: "brn", label: "やけど" },
  { value: "psn", label: "どく" },
  { value: "tox", label: "もうどく" },
  { value: "par", label: "まひ" },
  { value: "slp", label: "ねむり" },
  { value: "frz", label: "こおり" },
];

const gameTypeOptions: Array<{ value: GameType; label: string }> = [
  { value: "singles", label: "シングル" },
  { value: "doubles", label: "ダブル" },
];

const rankOptions = Array.from({ length: 13 }, (_value, index) => index - 6);

const rankSelectOptions = rankOptions.map((rank) => ({
  value: String(rank),
  label: rank > 0 ? `+${rank}` : String(rank),
}));

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

const toStatPointInput = (value: string): number => {
  const parsed = toNumber(value, 0);
  if (parsed > CHAMPIONS_MAX_STAT_POINTS_PER_STAT) {
    return smogonEvToStatPoints(parsed);
  }
  return clampStatPointValue(parsed);
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const formatDamageRange = (min: number, max: number): string =>
  min === max ? String(min) : `${min}-${max}`;

const statPointCells = Array.from({ length: CHAMPIONS_MAX_STAT_POINTS_PER_STAT }, (_value, index) => index + 1);

const selectInputValueOnFocus = (event: FocusEvent<HTMLInputElement>) => {
  try {
    event.currentTarget.select();
  } catch {
    // Some input types do not expose text selection consistently.
  }
};

export const clampTargetStatPointChange = (statPoints: StatTable, key: StatKey, value: number): number => {
  const usedByOtherStats = sumStatPoints(statPoints) - clampStatPointValue(statPoints[key]);
  const maxForStat = Math.max(0, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats);
  return Math.min(clampStatPointValue(value), maxForStat);
};

const getStatIconSrc = (key: StatKey): string => {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}assets/stat-icons/${statIconFiles[key]}`;
};

const getAssetSrc = (path: string): string => {
  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${path}`;
};

const getBattleIconSrc = (name: string): string => getAssetSrc(`assets/battle-icons/${name}.svg`);

function StatIcon({ stat, className = "" }: { stat: StatKey; className?: string }) {
  return (
    <img
      className={`stat-icon ${className}`.trim()}
      src={getStatIconSrc(stat)}
      alt={statLabels[stat]}
      loading="lazy"
      decoding="async"
    />
  );
}

const createBlankAttack = (index: number): ScenarioAttackFormState => ({
  ...createDefaultScenarioAttackForm(`attack-${Date.now()}-${index}`, `攻撃${String.fromCharCode(65 + index)}`),
  attackerPokemonInput: "",
  attackerNatureInput: "",
  attackerAbilityInput: "",
  attackerItemInput: "",
  attackerTeraTypeInput: "",
  attackerTeraEnabled: false,
  attackerDmaxEnabled: false,
  attackerStatus: "none",
  attackerLevel: 50,
  attackerStatPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  attackerBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  defenderBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moveInput: "",
  repeat: 1,
  requiredSurvivedHits: Math.min(10, index + 1),
  minSurvivalProbabilityPercent: 100,
  gameType: "singles",
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
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState("");
  const [shareMessage, setShareMessage] = useState<string | null>(null);
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

  const targetArtwork = useMemo(() => findPokemonArtwork({
    input: targetForm.pokemonInput,
    canonicalName: previewInput.input?.build.pokemon.canonicalName,
  }), [targetForm.pokemonInput, previewInput.input?.build.pokemon.canonicalName]);

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
        const pokemon = toSmogonPokemon(previewInput.input.build);
        setActualStats({ ...pokemon.stats, hp: pokemon.maxHP() });
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
    setTargetForm((current) => {
      const nextValue = clampTargetStatPointChange(current.statPoints, key, value);
      return {
        ...current,
        statPoints: { ...current.statPoints, [key]: nextValue },
      };
    });
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
        ? (() => {
            const nextAttack = createBlankAttack(scenario.attacks.length);
            const requiredSurvivedHits = Math.min(
              10,
              scenario.attacks.reduce((total, attack) => total + Math.max(1, Math.trunc(attack.repeat)), 0) + 1,
            );
            return {
              ...scenario,
              attacks: [...scenario.attacks, { ...nextAttack, requiredSurvivedHits }],
            };
          })()
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

  const openSharePanel = () => {
    setShareText(stringifyShareStateDocument(targetForm, scenarioForms));
    setShareMessage(null);
    setShareOpen((current) => !current);
  };

  const handleCopyShareJson = () => {
    const json = stringifyShareStateDocument(targetForm, scenarioForms);
    setShareText(json);
    setShareOpen(true);
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(json)
        .then(() => setShareMessage("条件JSONをクリップボードへコピーしました"))
        .catch(() => setShareMessage("条件JSONを下の欄に出しました"));
    } else {
      setShareMessage("条件JSONを下の欄に出しました");
    }
  };

  const handleImportShareJson = () => {
    try {
      const document = parseShareStateDocument(shareText);
      activeRequestRef.current?.cancel();
      activeRequestRef.current = null;
      setTargetForm(document.target);
      setScenarioForms(document.scenarios);
      setSelectedCandidateId(null);
      dispatchSearch({ type: "reset" });
      setShareMessage("条件JSONを読み込みました");
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : String(error));
    }
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
        <div className="brand-title">
          <h1>
            <img
              src={getAssetSrc("assets/brand/championcreator-title.svg")}
              alt="ChampionCreator"
            />
          </h1>
          <p>
            Pokemon Champions 自動耐久調整
            {" / "}
            app v{appVersionInfo.appVersion}
            {" / "}
            calc {appVersionInfo.smogonCalcVersion}
            {" / "}
            data {appVersionInfo.localizationEntries}
          </p>
        </div>
        <div className="topbar-actions">
          <div className="run-meter" aria-live="polite">
            <strong>{Math.round(searchState.progress * 100)}%</strong>
            <span>{searchState.searchedCandidates} / {searchState.totalCandidates || "-"} candidates</span>
          </div>
          <Button variant="ghost" onClick={openSharePanel}>
            条件JSON
          </Button>
          <Button variant="ghost" onClick={handleCopyShareJson}>
            コピー
          </Button>
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={searchState.status !== "running"}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            id="runButton"
            onClick={handleRun}
            disabled={searchState.status === "running"}
          >
            {searchState.status === "running" ? "計算中..." : "計算開始"}
          </Button>
        </div>
      </header>

      {searchState.errorMessage ? (
        <div className="status-banner error" role="alert">{searchState.errorMessage}</div>
      ) : null}
      {previewInput.error ? (
        <div className="status-banner warning" role="status">{previewInput.error}</div>
      ) : null}
      {shareOpen ? (
        <section className="share-panel" aria-label="条件JSON">
          <textarea
            value={shareText}
            onChange={(event) => setShareText(event.target.value)}
            spellCheck={false}
          />
          <div>
            <Button variant="primary" size="small" onClick={handleImportShareJson}>
              読込
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShareText(stringifyShareStateDocument(targetForm, scenarioForms))}
            >
              現在条件を反映
            </Button>
            {shareMessage ? <span>{shareMessage}</span> : null}
          </div>
        </section>
      ) : null}

      <main className="workbench">
        <TargetPanel
          targetForm={targetForm}
          onUpdateField={updateTargetField}
          onUpdateEv={updateTargetEv}
          canonicalPokemon={previewInput.input?.build.pokemon.canonicalName}
          artwork={targetArtwork}
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

type EntityTextFieldProps = {
  kind: EntityKind;
  label: string;
  value: string;
  className?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

function EntityTextField({
  kind,
  label,
  value,
  className,
  onChange,
}: EntityTextFieldProps) {
  const datalistId = `entity-options-${kind}-${useId()}`;
  const options = getMatchingEntityInputOptions(kind, value);
  const labelClassName = ["placeholder-field", className].filter(Boolean).join(" ");

  return (
    <label className={labelClassName}>
      <input
        value={value}
        placeholder={label}
        list={datalistId}
        autoComplete="off"
        onFocus={selectInputValueOnFocus}
        onChange={onChange}
      />
      <datalist id={datalistId}>
        {options.map((option) => (
          <option
            value={option.value}
            key={option.value}
          />
        ))}
      </datalist>
    </label>
  );
}

type MechanicControlsProps = {
  pokemonInput: string;
  teraEnabled: boolean;
  dmaxEnabled: boolean;
  teraTypeInput: string;
  teraLabel: string;
  onPokemonInputChange: (value: string) => void;
  onTeraEnabledChange: (value: boolean) => void;
  onDmaxEnabledChange: (value: boolean) => void;
  onTeraTypeInputChange: (value: string) => void;
};

function MechanicControls({
  pokemonInput,
  teraEnabled,
  dmaxEnabled,
  teraTypeInput,
  teraLabel,
  onPokemonInputChange,
  onTeraEnabledChange,
  onDmaxEnabledChange,
  onTeraTypeInputChange,
}: MechanicControlsProps) {
  const [choiceKind, setChoiceKind] = useState<PokemonFormVariantKind | null>(null);
  const megaOptions = getPokemonFormVariantOptions(pokemonInput, "mega");
  const gmaxOptions = getPokemonFormVariantOptions(pokemonInput, "gmax");
  const megaActive = isPokemonFormVariant(pokemonInput, "mega");
  const gmaxActive = isPokemonFormVariant(pokemonInput, "gmax");
  const dmaxActive = dmaxEnabled || gmaxActive;
  const activeChoices = choiceKind === "mega" ? megaOptions : choiceKind === "gmax" ? gmaxOptions : [];

  const applyBaseForm = () => {
    const baseValue = getPokemonBaseFormValue(pokemonInput);
    if (baseValue) {
      onPokemonInputChange(baseValue);
    }
    setChoiceKind(null);
  };

  const applyVariant = (kind: PokemonFormVariantKind, option: PokemonFormVariantOption) => {
    onPokemonInputChange(option.value);
    setChoiceKind(null);
    if (kind === "mega") {
      onTeraEnabledChange(false);
      onDmaxEnabledChange(false);
    } else {
      onDmaxEnabledChange(true);
      onTeraEnabledChange(false);
    }
  };

  const handleVariantClick = (kind: PokemonFormVariantKind, options: PokemonFormVariantOption[]) => {
    const isActive = kind === "mega" ? megaActive : gmaxActive;
    if (isActive) {
      applyBaseForm();
      if (kind === "gmax") {
        onDmaxEnabledChange(false);
      }
      return;
    }
    if (options.length === 0) {
      setChoiceKind(null);
      return;
    }
    if (options.length === 1) {
      applyVariant(kind, options[0]);
      return;
    }
    setChoiceKind((current) => (current === kind ? null : kind));
  };

  const handleTeraClick = () => {
    const nextTeraEnabled = !teraEnabled;
    onTeraEnabledChange(nextTeraEnabled);
    if (nextTeraEnabled) {
      if (dmaxEnabled || gmaxActive) {
        onDmaxEnabledChange(false);
        if (gmaxActive) {
          applyBaseForm();
        }
      }
      setChoiceKind(null);
    }
  };

  const handleDmaxClick = () => {
    if (dmaxEnabled || gmaxActive) {
      onDmaxEnabledChange(false);
      if (gmaxActive) {
        applyBaseForm();
      } else {
        setChoiceKind(null);
      }
      return;
    }

    onDmaxEnabledChange(true);
    onTeraEnabledChange(false);
    if (megaActive) {
      applyBaseForm();
    }
    setChoiceKind(gmaxOptions.length > 0 ? "gmax" : null);
  };

  return (
    <div className="mechanic-block">
      <div className="mechanic-toggle-row" aria-label="特殊フォーム">
        <IconToggleButton
          active={teraEnabled}
          iconName={teraEnabled ? "tera" : "tera-off"}
          label={teraLabel}
          onClick={handleTeraClick}
        />
        <IconToggleButton
          active={megaActive}
          disabled={!megaActive && megaOptions.length === 0}
          iconName={megaActive ? "mega" : "mega-off"}
          label={megaActive ? "メガ解除" : "メガ候補"}
          onClick={() => handleVariantClick("mega", megaOptions)}
        />
        <IconToggleButton
          active={dmaxActive}
          iconName={dmaxActive ? "dmax" : "dmax-off"}
          label={dmaxActive ? "ダイマックス解除" : "ダイマックス"}
          onClick={handleDmaxClick}
        />
      </div>
      {teraEnabled ? (
        <EntityTextField
          className="tera-type-field"
          kind="type"
          label="テラタイプ"
          value={teraTypeInput}
          onChange={(event) => onTeraTypeInputChange(event.target.value)}
        />
      ) : null}
      {activeChoices.length > 0 ? (
        <div className="variant-choice-row" aria-label={`${choiceKind === "mega" ? "メガ" : "キョダイマックス"}候補`}>
          {activeChoices.map((option) => (
            <button
              className="variant-choice"
              type="button"
              key={option.id}
              onClick={() => choiceKind && applyVariant(choiceKind, option)}
            >
              {option.value}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type IconToggleButtonProps = {
  active: boolean;
  disabled?: boolean;
  iconName: string;
  label: string;
  onClick: () => void;
};

function IconToggleButton({ active, disabled = false, iconName, label, onClick }: IconToggleButtonProps) {
  return (
    <button
      className={`mechanic-icon-button${active ? " active" : ""}`}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <img src={getBattleIconSrc(iconName)} alt="" aria-hidden="true" />
    </button>
  );
}

type TargetPanelProps = {
  targetForm: TargetFormState;
  canonicalPokemon?: string;
  artwork: PokemonArtworkMatch | null;
  actualStats: StatTable | null;
  totalStatPoints: number;
  onUpdateField: <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => void;
  onUpdateEv: (key: StatKey, value: number) => void;
};

function TargetPanel({
  targetForm,
  canonicalPokemon,
  artwork,
  actualStats,
  totalStatPoints,
  onUpdateField,
  onUpdateEv,
}: TargetPanelProps) {
  const isSpLimitReached = totalStatPoints >= CHAMPIONS_TOTAL_STAT_POINTS;

  return (
    <section className="target-panel" aria-labelledby="target-title">
      <div className="section-heading">
        <div>
          <h2 id="target-title">調整対象</h2>
          <span>{canonicalPokemon ? `calc: ${canonicalPokemon}` : "resolver 未確定"}</span>
        </div>
      </div>

      <div className="target-identity">
        <PokemonArtworkFrame
          match={artwork}
          fallbackLabel={targetForm.pokemonInput}
          variant="target"
          dynamaxEffect={targetForm.dmaxEnabled || isPokemonFormVariant(targetForm.pokemonInput, "gmax")}
        />
        <div className="target-summary compact">
          <EntityTextField
            kind="pokemon"
            label="ポケモン"
            value={targetForm.pokemonInput}
            onChange={(event) => onUpdateField("pokemonInput", event.target.value)}
          />
          <EntityTextField
            kind="nature"
            label="性格"
            value={targetForm.natureInput}
            onChange={(event) => onUpdateField("natureInput", event.target.value)}
          />
          <label className="placeholder-field">
            <input
              type="number"
              min="1"
              max="100"
              value={targetForm.level}
              placeholder="Lv."
              onFocus={selectInputValueOnFocus}
              onChange={(event) => onUpdateField("level", toNumber(event.target.value, 50))}
            />
          </label>
          <EntityTextField
            kind="item"
            label="持ち物"
            value={targetForm.itemInput}
            onChange={(event) => onUpdateField("itemInput", event.target.value)}
          />
          <EntityTextField
            kind="ability"
            label="特性"
            value={targetForm.abilityInput}
            onChange={(event) => onUpdateField("abilityInput", event.target.value)}
          />
          <SelectField
            label="状態異常"
            value={targetForm.status}
            options={statusOptions}
            onChange={(value) => onUpdateField("status", value)}
          />
          <MechanicControls
            pokemonInput={targetForm.pokemonInput}
            teraEnabled={targetForm.teraEnabled}
            dmaxEnabled={targetForm.dmaxEnabled}
            teraTypeInput={targetForm.teraTypeInput}
            teraLabel={targetForm.teraEnabled ? "テラスタル解除" : "テラスタル"}
            onPokemonInputChange={(value) => onUpdateField("pokemonInput", value)}
            onTeraEnabledChange={(value) => onUpdateField("teraEnabled", value)}
            onDmaxEnabledChange={(value) => onUpdateField("dmaxEnabled", value)}
            onTeraTypeInputChange={(value) => onUpdateField("teraTypeInput", value)}
          />
        </div>
      </div>

      <div className={`ev-table${isSpLimitReached ? " is-sp-max" : ""}`} aria-label="調整対象のSP">
        <div className="ev-header">
          <span>能力</span>
          <span>実数値</span>
          <span>現在SP</span>
          <span>SP配分</span>
          <span>固定</span>
        </div>
        {statKeys.map((key) => (
          <div className={`ev-row ${key}`} key={key}>
            <strong><StatIcon stat={key} /></strong>
            <span className="actual-stat">{actualStats?.[key] ?? "-"}</span>
            <input
              type="number"
              min="0"
              max="252"
              step="1"
              value={targetForm.statPoints[key]}
              aria-label={`${statLabels[key]} SP`}
              title="0-32SP。252などEV値を入れた場合は対応するSPへ変換します。"
              onChange={(event) => onUpdateEv(key, toStatPointInput(event.target.value))}
            />
            <StatPointCellBar
              stat={key}
              value={targetForm.statPoints[key]}
              onChange={(value) => onUpdateEv(key, value)}
            />
            <span className={defenceStatKeySet.has(key) ? "search-chip" : "fixed-chip"}>
              {defenceStatKeySet.has(key) ? "HBD" : "固定"}
            </span>
          </div>
        ))}
      </div>

      <div className={`sp-summary${isSpLimitReached ? " is-sp-max" : ""}`}>
        <span>合計SP</span>
        <strong>{totalStatPoints} / {CHAMPIONS_TOTAL_STAT_POINTS}</strong>
      </div>
    </section>
  );
}

type StatPointCellBarProps = {
  stat: StatKey;
  value: number;
  onChange: (value: number) => void;
};

function StatPointCellBar({ stat, value, onChange }: StatPointCellBarProps) {
  const pointerIdRef = useRef<number | null>(null);
  const normalizedValue = clampStatPointValue(value);

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const nextValue = clampStatPointValue(Math.ceil(ratio * CHAMPIONS_MAX_STAT_POINTS_PER_STAT));
    onChange(nextValue);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }
    updateFromPointer(event);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === event.pointerId) {
      pointerIdRef.current = null;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(clampStatPointValue(normalizedValue + 1));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clampStatPointValue(normalizedValue - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(CHAMPIONS_MAX_STAT_POINTS_PER_STAT);
    }
  };

  return (
    <div
      className={`sp-cell-bar ${stat}`}
      role="slider"
      tabIndex={0}
      aria-label={`${statLabels[stat]} SP配分`}
      aria-valuemin={0}
      aria-valuemax={CHAMPIONS_MAX_STAT_POINTS_PER_STAT}
      aria-valuenow={normalizedValue}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      {statPointCells.map((cellValue) => (
        <span
          className={cellValue <= normalizedValue ? "active" : ""}
          key={cellValue}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

type PokemonArtworkFrameProps = {
  match: PokemonArtworkMatch | null;
  fallbackLabel: string;
  variant: "target" | "attack";
  dynamaxEffect?: boolean;
};

function PokemonArtworkFrame({
  match,
  fallbackLabel,
  variant,
  dynamaxEffect = false,
}: PokemonArtworkFrameProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const canShowImage = match && failedSrc !== match.artworkUrl;
  const fallbackInitial = (fallbackLabel.trim() || "?").slice(0, 1);

  return (
    <div
      className={`pokemon-artwork ${variant}${dynamaxEffect ? " is-dynamax" : ""}`}
      aria-label={match?.label ?? fallbackLabel}
    >
      {canShowImage ? (
        <img
          src={match.artworkUrl}
          alt={match.label}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(match.artworkUrl)}
        />
      ) : (
        <strong>{fallbackInitial}</strong>
      )}
      {match ? (
        <div className="pokemon-artwork-meta">
          <span>{match.label}</span>
          <small>{match.showdownName}</small>
        </div>
      ) : null}
    </div>
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
        <Button variant="ghost" onClick={onAddScenario}>+ シナリオを追加</Button>
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
        <button className="scenario-add-row ui-button" type="button" onClick={onAddScenario}>
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
        <div className="scenario-row-title">
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
        </div>
        <Button
          variant="danger"
          aria-label={`${scenario.label}を削除`}
          onClick={() => onRemoveScenario(scenario.id)}
        >
          行を削除
        </Button>
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
          className="attack-add-card ui-button"
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
  const attackerArtwork = findPokemonArtwork({ input: attack.attackerPokemonInput });

  return (
    <section className="attack-condition-card" aria-label={attackLabel}>
      <div className="attack-card-header">
        <PokemonArtworkFrame
          match={attackerArtwork}
          fallbackLabel={attack.attackerPokemonInput}
          variant="attack"
          dynamaxEffect={attack.attackerDmaxEnabled || isPokemonFormVariant(attack.attackerPokemonInput, "gmax")}
        />
        <input
          className="inline-title-input"
          value={attack.label}
          aria-label="攻撃名"
          onChange={onInput("label")}
        />
        <Button
          variant="ghost"
          size="icon"
          className="icon-button"
          aria-label={`${attackLabel}を削除`}
          disabled={!canRemove}
          onClick={() => onRemoveAttack(scenarioId, attack.id)}
        >
          ×
        </Button>
      </div>

      <div className="attack-card-fields">
        <ScenarioTextField kind="pokemon" label="攻撃側" showLabel value={attack.attackerPokemonInput} onChange={onInput("attackerPokemonInput")} />
        <ScenarioTextField kind="move" label="技" showLabel value={attack.moveInput} onChange={onInput("moveInput")} />
        <ScenarioTextField kind="nature" label="性格" showLabel value={attack.attackerNatureInput} onChange={onInput("attackerNatureInput")} />
        <ScenarioTextField kind="ability" label="特性" showLabel value={attack.attackerAbilityInput} placeholder="任意" onChange={onInput("attackerAbilityInput")} />
        <ScenarioTextField kind="item" label="持ち物" showLabel value={attack.attackerItemInput} placeholder="任意" onChange={onInput("attackerItemInput")} />
      </div>

      <MechanicControls
        pokemonInput={attack.attackerPokemonInput}
        teraEnabled={attack.attackerTeraEnabled}
        dmaxEnabled={attack.attackerDmaxEnabled}
        teraTypeInput={attack.attackerTeraTypeInput}
        teraLabel={attack.attackerTeraEnabled ? "攻撃テラ解除" : "攻撃テラ"}
        onPokemonInputChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerPokemonInput", value)}
        onTeraEnabledChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerTeraEnabled", value)}
        onDmaxEnabledChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerDmaxEnabled", value)}
        onTeraTypeInputChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerTeraTypeInput", value)}
      />

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
        <SelectField
          label="ルール"
          value={attack.gameType}
          options={gameTypeOptions}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "gameType", value)}
        />
        <SelectField
          label="攻撃状態"
          value={attack.attackerStatus}
          options={statusOptions}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerStatus", value)}
        />
        <SelectField
          label="天候"
          value={attack.weather}
          options={weatherOptions}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "weather", value)}
        />
        <SelectField
          label="フィールド"
          value={attack.terrain}
          options={terrainOptions}
          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "terrain", value)}
        />
      </div>

      <div className="rank-grid" aria-label={`${attackLabel} ランク補正`}>
        {attackerBoostKeys.map((key) => (
          <SelectField
            compact
            label={`攻${statLabels[key]}`}
            value={String(attack.attackerBoosts[key] ?? 0)}
            options={rankSelectOptions}
            key={`attacker-${key}`}
            onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerBoosts", {
                ...attack.attackerBoosts,
                [key]: toNumber(value, 0),
              })}
          />
        ))}
        {defenderBoostKeys.map((key) => (
          <SelectField
            compact
            label={`防${statLabels[key]}`}
            value={String(attack.defenderBoosts[key] ?? 0)}
            options={rankSelectOptions}
            key={`defender-${key}`}
            onChange={(value) => onUpdateAttack(scenarioId, attack.id, "defenderBoosts", {
                ...attack.defenderBoosts,
                [key]: toNumber(value, 0),
              })}
          />
        ))}
      </div>

      <div className="attacker-evs" aria-label={`${attackLabel} 攻撃側SP`}>
        {statKeys.map((key) => (
          <label className="placeholder-field" key={key}>
            <input
              type="number"
              min="0"
              max="252"
              step="1"
              value={attack.attackerStatPoints[key]}
              placeholder={`${statLabels[key]} SP`}
              title="0-32SP。252などEV値を入れた場合は対応するSPへ変換します。"
              onFocus={selectInputValueOnFocus}
              onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, key, toStatPointInput(event.target.value))}
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
  kind?: EntityKind;
  label: string;
  showLabel: boolean;
  value: string;
  placeholder?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
};

function ScenarioTextField({ kind, label, showLabel, value, placeholder, onChange }: ScenarioTextFieldProps) {
  const datalistId = `entity-options-${kind ?? "text"}-${useId()}`;
  const options = kind ? getMatchingEntityInputOptions(kind, value) : [];

  return (
    <label className="scenario-cell placeholder-field">
      <input
        value={value}
        placeholder={showLabel ? label : placeholder}
        list={kind ? datalistId : undefined}
        autoComplete={kind ? "off" : undefined}
        aria-label={label}
        onFocus={selectInputValueOnFocus}
        onChange={onChange}
      />
      {kind ? (
        <datalist id={datalistId}>
          {options.map((option) => (
            <option
              value={option.value}
              key={option.value}
            />
          ))}
        </datalist>
      ) : null}
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
    <label className="scenario-cell number-cell number-labeled-field">
      {showLabel ? <span className="row-label">{label}</span> : null}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onFocus={selectInputValueOnFocus}
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
          <div className="empty-result">
            {status === "complete"
              ? "条件を満たす候補がありません。必要耐久・生存率・固定SPをゆるめてください。"
              : "計算開始で Worker 経由の候補がここに出ます"}
          </div>
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
        <Button variant="primary" size="small" onClick={onApply} disabled={!canApply}>{applyLabel}</Button>
      </div>

      {candidate ? (
        <>
          <div className="detail-allocation">
            {statKeys.map((key) => <span key={key}><StatIcon stat={key} /></span>)}
            {statKeys.map((key) => <strong key={key}>{candidate.appliedStatPoints[key]}</strong>)}
          </div>

          <div className="check-list">
            {candidate.scenarioResults.map((result) => (
              <div key={result.scenarioId}>
                <StatusBadge tone={result.passed ? "green" : "red"} />
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
                      {hit.description ? <span>{hit.description}</span> : null}
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
