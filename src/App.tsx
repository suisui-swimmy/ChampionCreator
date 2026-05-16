import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { evaluateAttackScenario } from "./calc/evaluateAttackScenario";
import { wireframeProject } from "./data/wireframeFixture";
import type {
  AbilityOptionEntry,
  AbilityOptionsPayload,
  ItemOptionEntry,
  ItemOptionsPayload,
  MoveOptionEntry,
  MoveOptionsPayload,
  PokemonOptionEntry,
  PokemonOptionsPayload,
  UiOptionBase,
} from "./data/optionTypes";
import {
  STAT_KEYS,
  type AdjustmentProject,
  type BaseScenario,
  type Build,
  type Candidate,
  type ChampionsStatPoints,
  type Constraint,
  type DamageScenarioEvaluation,
  type FieldState,
  type RankStages,
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

interface PokemonLookup {
  byId: Map<string, PokemonOptionEntry>;
  byShowdownName: Map<string, PokemonOptionEntry>;
}

interface OptionLookup<TOption extends UiOptionBase> {
  byId: Map<string, TOption>;
  byShowdownName: Map<string, TOption>;
}

interface ScenarioInputSelection {
  moveId?: string;
  attackerAbilityId?: string;
  attackerItemId?: string;
  defenderAbilityId?: string;
  defenderItemId?: string;
  weather?: FieldState["weather"];
  terrain?: FieldState["terrain"];
  reflect?: boolean;
  lightScreen?: boolean;
  criticalHit?: boolean;
  spreadMove?: boolean;
  attackerStages?: RankStages;
  defenderStages?: RankStages;
}

interface ShareState {
  schemaVersion: 1;
  selectedPokemonId: string;
  selectedAbilityId: string;
  selectedScenarioId: string;
  scenarioSelections: Record<string, ScenarioInputSelection>;
}

interface ScenarioEvaluationIssue {
  scenarioId: string;
  title: string;
  status: "unsupported" | "error";
  message: string;
}

const defaultTargetPokemonId = "charizardmegax";
const defaultTargetAbilityId = "";
const rankStageKeys = ["atk", "def", "spa", "spd", "spe"] as const;

const weatherOptions: Array<{ value: NonNullable<FieldState["weather"]>; label: string }> = [
  { value: "none", label: "なし" },
  { value: "sun", label: "晴れ" },
  { value: "rain", label: "雨" },
  { value: "sand", label: "砂嵐" },
  { value: "snow", label: "雪" },
];

const terrainOptions: Array<{ value: NonNullable<FieldState["terrain"]>; label: string }> = [
  { value: "none", label: "なし" },
  { value: "electric", label: "エレキ" },
  { value: "grassy", label: "グラス" },
  { value: "misty", label: "ミスト" },
  { value: "psychic", label: "サイコ" },
];

const formatPercent = (value: number): string => `${Math.round(value * 1000) / 10}%`;

const formatDamageRange = (range?: [number, number]): string =>
  range ? `${range[0]} - ${range[1]}` : "-";

const encodeShareState = (state: ShareState): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let binary = "";

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
};

const decodeShareState = (value: string): ShareState => {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<ShareState>;

  if (
    parsed.schemaVersion !== 1 ||
    typeof parsed.selectedPokemonId !== "string" ||
    typeof parsed.selectedAbilityId !== "string" ||
    typeof parsed.selectedScenarioId !== "string" ||
    typeof parsed.scenarioSelections !== "object" ||
    parsed.scenarioSelections === null
  ) {
    throw new Error("共有URLの形式が未対応です");
  }

  return {
    schemaVersion: 1,
    selectedPokemonId: parsed.selectedPokemonId,
    selectedAbilityId: parsed.selectedAbilityId,
    selectedScenarioId: parsed.selectedScenarioId,
    scenarioSelections: parsed.scenarioSelections,
  };
};

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

const pokemonOptionLabel = (option: PokemonOptionEntry): string =>
  option.showdownName === option.label ? option.label : `${option.label} / ${option.showdownName}`;

const optionDisplayLabel = (option: UiOptionBase): string =>
  option.showdownName === option.label ? option.label : `${option.label} / ${option.showdownName}`;

const optionSearchScore = (option: UiOptionBase, query: string): number => {
  const normalizedQuery = normalizePokemonSearch(query);

  if (!normalizedQuery) {
    return 0;
  }

  const primaryTokens = [
    option.label,
    option.showdownName,
    option.id,
    optionDisplayLabel(option),
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

const pokemonOptionSearchScore = (option: PokemonOptionEntry, query: string): number =>
  optionSearchScore(option, query);

const findOptionByShowdownName = <TOption extends UiOptionBase>(
  options: TOption[],
  value?: string,
): TOption | undefined => {
  const normalizedValue = normalizePokemonKey(value ?? "");

  if (!normalizedValue) {
    return undefined;
  }

  return options.find((option) => normalizePokemonKey(option.showdownName) === normalizedValue);
};

const createOptionLookup = <TOption extends UiOptionBase>(options: TOption[]) => ({
  byId: new Map(options.map((option) => [option.id, option])),
  byShowdownName: new Map(options.map((option) => [normalizePokemonKey(option.showdownName), option])),
});

const createMoveRef = (option: MoveOptionEntry) => ({
  id: option.id,
  displayName: option.label,
  showdownName: option.showdownName,
  category: option.category,
  typeName: option.type,
  sourceStatus: option.sourceStatus ?? "supported",
});

const createSpeciesRef = (option: PokemonOptionEntry): SpeciesRef => ({
  id: option.id,
  displayName: option.label,
  showdownName: option.showdownName,
  iconAsset: option.artwork,
  sourceStatus: option.sourceStatus ?? "supported",
});

const mergeRankStages = (base?: RankStages, overrides?: RankStages): RankStages | undefined => {
  const merged = {
    ...base,
    ...overrides,
  };

  return Object.values(merged).some((value) => value !== undefined) ? merged : undefined;
};

const applyScenarioInputSelection = (
  scenario: BaseScenario,
  selection: ScenarioInputSelection,
  lookups: {
    moves: OptionLookup<MoveOptionEntry>;
    abilities: OptionLookup<AbilityOptionEntry>;
    items: OptionLookup<ItemOptionEntry>;
  },
): BaseScenario => {
  const move = selection.moveId ? lookups.moves.byId.get(selection.moveId) : undefined;
  const attackerAbility = selection.attackerAbilityId
    ? lookups.abilities.byId.get(selection.attackerAbilityId)
    : undefined;
  const attackerItem = selection.attackerItemId ? lookups.items.byId.get(selection.attackerItemId) : undefined;
  const defenderAbility = selection.defenderAbilityId
    ? lookups.abilities.byId.get(selection.defenderAbilityId)
    : undefined;
  const defenderItem = selection.defenderItemId ? lookups.items.byId.get(selection.defenderItemId) : undefined;

  return {
    ...scenario,
    move: move ? createMoveRef(move) : scenario.move,
    field: {
      ...scenario.field,
      weather: selection.weather ?? scenario.field.weather,
      terrain: selection.terrain ?? scenario.field.terrain,
      reflect: selection.reflect ?? scenario.field.reflect,
      lightScreen: selection.lightScreen ?? scenario.field.lightScreen,
      criticalHit: selection.criticalHit ?? scenario.field.criticalHit,
      spreadMove: selection.spreadMove ?? scenario.field.spreadMove,
    },
    attackerStages: mergeRankStages(scenario.attackerStages, selection.attackerStages),
    defenderStages: mergeRankStages(scenario.defenderStages, selection.defenderStages),
    attacker: {
      ...scenario.attacker,
      ability: attackerAbility?.showdownName ?? scenario.attacker.ability,
      item: attackerItem?.showdownName ?? scenario.attacker.item,
    },
    defender: {
      ...scenario.defender,
      ability: defenderAbility?.showdownName ?? scenario.defender.ability,
      item: defenderItem?.showdownName ?? scenario.defender.item,
    },
  };
};

const isAdjustmentProject = (value: unknown): value is AdjustmentProject => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<AdjustmentProject>;

  return (
    typeof candidate.schemaVersion === "number" &&
    typeof candidate.id === "string" &&
    typeof candidate.title === "string" &&
    Boolean(candidate.target) &&
    Array.isArray(candidate.scenarios) &&
    Array.isArray(candidate.scenarioRows) &&
    Array.isArray(candidate.constraints) &&
    Boolean(candidate.searchBudget)
  );
};

const createShareState = ({
  selectedPokemonId,
  selectedAbilityId,
  selectedScenarioId,
  scenarioSelections,
}: Omit<ShareState, "schemaVersion">): ShareState => ({
  schemaVersion: 1,
  selectedPokemonId,
  selectedAbilityId,
  selectedScenarioId,
  scenarioSelections,
});

const compactSelection = (selection: ScenarioInputSelection): ScenarioInputSelection => {
  const compacted: ScenarioInputSelection = {};

  Object.entries(selection).forEach(([key, value]) => {
    if (value !== undefined) {
      compacted[key as keyof ScenarioInputSelection] = value as never;
    }
  });

  return compacted;
};

const createScenarioSelectionFromScenario = (
  scenario: BaseScenario,
  lookups: {
    moves: OptionLookup<MoveOptionEntry>;
    abilities: OptionLookup<AbilityOptionEntry>;
    items: OptionLookup<ItemOptionEntry>;
  },
): ScenarioInputSelection =>
  compactSelection({
    moveId: scenario.move
      ? lookups.moves.byShowdownName.get(normalizePokemonKey(scenario.move.showdownName))?.id ??
        scenario.move.id
      : undefined,
    attackerAbilityId: scenario.attacker.ability
      ? lookups.abilities.byShowdownName.get(normalizePokemonKey(scenario.attacker.ability))?.id
      : undefined,
    attackerItemId: scenario.attacker.item
      ? lookups.items.byShowdownName.get(normalizePokemonKey(scenario.attacker.item))?.id
      : undefined,
    defenderAbilityId: scenario.defender.ability
      ? lookups.abilities.byShowdownName.get(normalizePokemonKey(scenario.defender.ability))?.id
      : undefined,
    defenderItemId: scenario.defender.item
      ? lookups.items.byShowdownName.get(normalizePokemonKey(scenario.defender.item))?.id
      : undefined,
    weather: scenario.field.weather ?? "none",
    terrain: scenario.field.terrain ?? "none",
    reflect: Boolean(scenario.field.reflect),
    lightScreen: Boolean(scenario.field.lightScreen),
    criticalHit: Boolean(scenario.field.criticalHit),
    spreadMove: Boolean(scenario.field.spreadMove),
    attackerStages: scenario.attackerStages,
    defenderStages: scenario.defenderStages,
  });

const createScenarioSelectionsFromProject = (
  project: AdjustmentProject,
  lookups: {
    moves: OptionLookup<MoveOptionEntry>;
    abilities: OptionLookup<AbilityOptionEntry>;
    items: OptionLookup<ItemOptionEntry>;
  },
): Record<string, ScenarioInputSelection> =>
  Object.fromEntries(
    project.scenarios.map((scenario) => [
      scenario.id,
      createScenarioSelectionFromScenario(scenario, lookups),
    ]),
  );

const scenarioThreshold = (evaluation: DamageScenarioEvaluation): number =>
  evaluation.thresholdProbability ?? (evaluation.check === "raw-damage" ? 0 : 1);

const createLiveResult = (
  project: AdjustmentProject,
  evaluations: DamageScenarioEvaluation[],
): Result | undefined => {
  if (evaluations.length === 0) {
    return undefined;
  }

  const totalSp = sumStatPoints(project.target.statPoints);
  const bottleneck =
    evaluations
      .map((evaluation) => ({
        evaluation,
        margin: evaluation.probability - scenarioThreshold(evaluation),
      }))
      .sort((a, b) => a.margin - b.margin)[0]?.evaluation ?? evaluations[0];

  return {
    candidate: {
      id: "current-ui-build",
      statPoints: project.target.statPoints,
      totalSp,
      remainingSp: Math.max(project.searchBudget.maxTotal - totalSp, 0),
      searchPhase: "final-verified",
    },
    passed: evaluations.every((evaluation) => evaluation.passed),
    score: evaluations.filter((evaluation) => evaluation.passed).length,
    bottleneckScenarioId: bottleneck.scenarioId,
    evaluations,
    markdownSummary: [
      `# ${project.title}`,
      "",
      `- Target: ${project.target.species.displayName} / ${project.target.species.showdownName}`,
      `- SP: H${project.target.statPoints.hp} A${project.target.statPoints.atk} B${project.target.statPoints.def} C${project.target.statPoints.spa} D${project.target.statPoints.spd} S${project.target.statPoints.spe}`,
      `- Result: ${evaluations.filter((evaluation) => evaluation.passed).length} / ${evaluations.length} PASS`,
      "",
      ...evaluations.map((evaluation) => {
        const scenario = project.scenarios.find((entry) => entry.id === evaluation.scenarioId);

        return `- ${scenario?.title ?? evaluation.scenarioId}: ${evaluation.passed ? "PASS" : "FAIL"} ${formatPercent(evaluation.probability)} (${formatDamageRange(evaluation.damageRange)})`;
      }),
    ].join("\n"),
  };
};

const createProjectMarkdown = (
  project: AdjustmentProject,
  result: Result | undefined,
  issues: ScenarioEvaluationIssue[],
): string => [
  `# ${project.title}`,
  "",
  `- App: ${APP_VERSION}`,
  `- Calc: ${CALC_ENGINE_VERSION}`,
  `- Data: ${DATA_VERSION}`,
  `- Target: ${project.target.species.displayName} / ${project.target.species.showdownName}`,
  `- Ability: ${project.target.ability ?? "未指定"}`,
  `- Item: ${project.target.item ?? "未指定"}`,
  `- SP: H${project.target.statPoints.hp} A${project.target.statPoints.atk} B${project.target.statPoints.def} C${project.target.statPoints.spa} D${project.target.statPoints.spd} S${project.target.statPoints.spe}`,
  "",
  "## Evaluation",
  ...(result
    ? result.evaluations.map((evaluation) => {
        const scenario = project.scenarios.find((entry) => entry.id === evaluation.scenarioId);

        return `- ${scenario?.title ?? evaluation.scenarioId}: ${evaluation.passed ? "PASS" : "FAIL"} ${formatPercent(evaluation.probability)} / damage ${formatDamageRange(evaluation.damageRange)}`;
      })
    : ["- 評価可能な攻撃シナリオがありません"]),
  ...(issues.length > 0
    ? [
        "",
        "## Not Evaluated",
        ...issues.map((issue) => `- ${issue.title}: ${issue.message}`),
      ]
    : []),
].join("\n");

const getPokemonOptionForSpecies = (
  species: SpeciesRef,
  lookup: PokemonLookup,
  targetPokemon?: PokemonOptionEntry,
): PokemonOptionEntry | undefined =>
  species.id === wireframeProject.target.species.id
    ? targetPokemon
    : lookup.byId.get(species.id) ?? lookup.byShowdownName.get(normalizePokemonKey(species.showdownName));

function usePokemonOptions() {
  const [pokemonOptions, setPokemonOptions] = useState<PokemonOptionEntry[]>([]);

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

function useAbilityOptions() {
  const [abilityOptions, setAbilityOptions] = useState<AbilityOptionEntry[]>([]);

  useEffect(() => {
    let mounted = true;

    void import("./data/generated/ability-options.gen.json").then((module) => {
      if (mounted) {
        setAbilityOptions((module.default as AbilityOptionsPayload).entries);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return abilityOptions;
}

function useMoveOptions() {
  const [moveOptions, setMoveOptions] = useState<MoveOptionEntry[]>([]);

  useEffect(() => {
    let mounted = true;

    void import("./data/generated/move-options.gen.json").then((module) => {
      if (mounted) {
        setMoveOptions((module.default as MoveOptionsPayload).entries);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return moveOptions;
}

function useItemOptions() {
  const [itemOptions, setItemOptions] = useState<ItemOptionEntry[]>([]);

  useEffect(() => {
    let mounted = true;

    void import("./data/generated/item-options.gen.json").then((module) => {
      if (mounted) {
        setItemOptions((module.default as ItemOptionsPayload).entries);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  return itemOptions;
}

const findConstraint = (
  scenarioId: string,
  constraints: Constraint[] = wireframeProject.constraints,
): Constraint | undefined =>
  constraints.find((constraint) => constraint.scenarioId === scenarioId);

const findScenario = (
  scenarioId: string,
  scenarios: BaseScenario[] = wireframeProject.scenarios,
): BaseScenario | undefined =>
  scenarios.find((scenario) => scenario.id === scenarioId);

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

function AbilityField({
  label,
  options,
  selectedId,
  fallbackLabel,
  onChange,
}: {
  label: string;
  options: AbilityOptionEntry[];
  selectedId: string;
  fallbackLabel: string;
  onChange: (abilityId: string) => void;
}) {
  const selectableOptions = options.filter((option) => option.sourceStatus !== "unsupported-temporary");
  const needsConfirmationOptions = selectableOptions.filter((option) => option.sourceStatus === "needs-confirmation");
  const standardOptions = selectableOptions.filter((option) => option.sourceStatus !== "needs-confirmation");
  const selectedOption = selectableOptions.find((option) => option.id === selectedId);
  const selectedLabel = selectedOption
    ? `${selectedOption.label} / ${selectedOption.showdownName}`
    : fallbackLabel;

  return (
    <div className="field ability-field">
      <label htmlFor="target-ability-select">{label}</label>
      <select
        id="target-ability-select"
        value={selectedId}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{fallbackLabel}</option>
        {needsConfirmationOptions.length > 0 && (
          <optgroup label="Champions新特性・計算要確認">
            {needsConfirmationOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} / {option.showdownName}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="通常候補">
          {standardOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} / {option.showdownName}
            </option>
          ))}
        </optgroup>
      </select>
      {selectedOption?.sourceStatus === "needs-confirmation" && (
        <div className="warning-box ability-warning" role="note">
          <strong>{selectedLabel}</strong>
          <p>
            Champions新特性・計算要確認。現在の探索結果には、この特性の補正を自動反映しません。
          </p>
        </div>
      )}
    </div>
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
  options: PokemonOptionEntry[];
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

  const selectOption = (option: PokemonOptionEntry) => {
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

function SearchOptionField<TOption extends UiOptionBase>({
  label,
  options,
  selectedId,
  fallbackLabel,
  placeholder = "日本語名 / English / ID",
  optionMeta,
  warning,
  onChange,
}: {
  label: string;
  options: TOption[];
  selectedId: string;
  fallbackLabel: string;
  placeholder?: string;
  optionMeta?: (option: TOption) => string;
  warning?: (option: TOption | undefined) => string | undefined;
  onChange: (optionId: string) => void;
}) {
  const inputId = `${label.replace(/\s+/g, "-")}-option-input`;
  const listboxId = `${label.replace(/\s+/g, "-")}-option-listbox`;
  const isComposingRef = useRef(false);
  const selectedOption = options.find((option) => option.id === selectedId);
  const selectedLabel = selectedOption ? optionDisplayLabel(selectedOption) : fallbackLabel;
  const warningText = warning?.(selectedOption);
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
          score: optionSearchScore(option, query),
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

  const selectOption = (option: TOption) => {
    onChange(option.id);
    setQuery(optionDisplayLabel(option));
    setIsOpen(false);
    setActiveIndex(0);
  };

  return (
    <div
      className="field battle-search-field"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;

        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsOpen(false);
          setQuery(selectedLabel);
        }
      }}
    >
      <label htmlFor={inputId}>{label}</label>
      <div className="search-combobox">
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
          placeholder={hasOptions ? placeholder : fallbackLabel}
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
          aria-label={`${label}候補を開く`}
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
          <div className="search-options" id={listboxId} role="listbox">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option, index) => (
                <button
                  type="button"
                  className={`search-option ${index === activeIndex ? "is-active" : ""}`}
                  id={`${listboxId}-${option.id}`}
                  role="option"
                  aria-selected={option.id === selectedId}
                  key={option.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span className="search-option-main">
                    <strong>{option.label}</strong>
                    <small>{option.showdownName}</small>
                  </span>
                  {optionMeta && <span className="search-option-meta">{optionMeta(option)}</span>}
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
      {warningText && (
        <div className="warning-box ability-warning" role="note">
          <p>{warningText}</p>
        </div>
      )}
    </div>
  );
}

function ScenarioSelectField<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <label className="field scenario-select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value as TValue)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ScenarioToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="scenario-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function RankStageEditor({
  label,
  stages,
  onChange,
}: {
  label: string;
  stages: RankStages;
  onChange: (stages: RankStages) => void;
}) {
  const updateStage = (stage: keyof RankStages, value: number) => {
    onChange({
      ...stages,
      [stage]: Math.max(-6, Math.min(6, value)),
    });
  };

  return (
    <section className="rank-stage-editor" aria-label={label}>
      <strong>{label}</strong>
      <div className="rank-stage-grid">
        {rankStageKeys.map((stage) => (
          <label key={stage}>
            <span>{statLabels[stage]}</span>
            <input
              type="number"
              min={-6}
              max={6}
              value={stages[stage] ?? 0}
              onChange={(event) => updateStage(stage, Number(event.currentTarget.value))}
            />
          </label>
        ))}
      </div>
    </section>
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
  abilityOptions,
  selectedPokemonId,
  selectedAbilityId,
  onSelectedPokemonIdChange,
  onSelectedAbilityIdChange,
}: {
  pokemonOptions: PokemonOptionEntry[];
  abilityOptions: AbilityOptionEntry[];
  selectedPokemonId: string;
  selectedAbilityId: string;
  onSelectedPokemonIdChange: (pokemonId: string) => void;
  onSelectedAbilityIdChange: (abilityId: string) => void;
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
          <AbilityField
            label="特性"
            options={abilityOptions}
            selectedId={selectedAbilityId}
            fallbackLabel={target.ability ?? "未指定"}
            onChange={onSelectedAbilityIdChange}
          />
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
  targetPokemon?: PokemonOptionEntry;
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
  scenarios,
  collapsed,
  onToggleCollapse,
  selectedScenarioId,
  onSelectScenario,
  pokemonLookup,
  targetPokemon,
}: {
  row: ScenarioRow;
  scenarios: BaseScenario[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  selectedScenarioId: string;
  onSelectScenario: (scenarioId: string) => void;
  pokemonLookup: PokemonLookup;
  targetPokemon?: PokemonOptionEntry;
}) {
  const rowScenarios = row.scenarioIds
    .map((scenarioId) => findScenario(scenarioId, scenarios))
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
  scenarios,
  scenarioRows,
}: {
  selectedScenarioId: string;
  onSelectScenario: (scenarioId: string) => void;
  pokemonLookup: PokemonLookup;
  targetPokemon?: PokemonOptionEntry;
  scenarios: BaseScenario[];
  scenarioRows: ScenarioRow[];
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
        {scenarioRows.map((row) => (
          <ScenarioRowView
            key={row.id}
            row={row}
            scenarios={scenarios}
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
  scenarios,
  onSelect,
}: {
  result: Result;
  rank: number;
  selected: boolean;
  scenarios: BaseScenario[];
  onSelect: () => void;
}) {
  const passed = result.evaluations.filter((evaluation) => evaluation.passed).length;
  const bottleneck = findScenario(result.bottleneckScenarioId, scenarios);
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
        <small>余裕 {margin ? formatPercent(Math.max(margin.probability - scenarioThreshold(margin as DamageScenarioEvaluation), 0)) : "-"}</small>
      </span>
      <span className="lane-arrow">›</span>
    </button>
  );
}

function ResultInspector({
  result,
  scenarios,
  scenarioRows,
  issues,
}: {
  result: Result;
  scenarios: BaseScenario[];
  scenarioRows: ScenarioRow[];
  issues: ScenarioEvaluationIssue[];
}) {
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
        {scenarioRows.map((row) => {
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
                const scenario = findScenario(evaluation.scenarioId, scenarios);

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
        {issues.length > 0 && (
          <section className="condition-group">
            <header>
              <span className="kind-dot kind-speed" />
              <strong>未評価</strong>
              <small>M1 では攻撃シナリオのみ実評価</small>
            </header>
            {issues.map((issue) => (
              <div className="condition-result" key={issue.scenarioId}>
                <span>{issue.title}</span>
                <span>{issue.status === "unsupported" ? "未対応" : "error"}</span>
                <strong>-</strong>
                <em className="fail">WAIT</em>
              </div>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}

function ResultsBoard({
  project,
  results,
  issues,
}: {
  project: AdjustmentProject;
  results: Result[];
  issues: ScenarioEvaluationIssue[];
}) {
  const [selectedResultId, setSelectedResultId] = useState(results[0]?.candidate.id ?? "");
  const selectedResult =
    results.find((result) => result.candidate.id === selectedResultId) ??
    results[0];

  useEffect(() => {
    if (results.length > 0 && !results.some((result) => result.candidate.id === selectedResultId)) {
      setSelectedResultId(results[0].candidate.id);
    }
  }, [results, selectedResultId]);

  return (
    <section className="results-board" aria-labelledby="results-title">
      <div className="results-toolbar">
        <div>
          <p className="eyebrow">結果</p>
          <h2 id="results-title">候補比較ボード</h2>
        </div>
        <div className="run-controls">
          <button type="button" className="primary-button">実評価更新済み</button>
          <button type="button">M2で探索</button>
          <Field label="探索モード" value={project.searchBudget.mode} compact />
        </div>
      </div>

      <div className="results-layout">
        <aside className="filter-panel">
          <h3>表示フィルタ</h3>
          <label><input type="checkbox" checked readOnly /> 耐久</label>
          <label><input type="checkbox" checked readOnly /> 火力</label>
          <label><input type="checkbox" checked readOnly /> 素早さ</label>
          <hr />
          <label><input type="checkbox" checked readOnly /> 現在SP</label>
          <label><input type="checkbox" readOnly /> 探索候補</label>
          <Field label="ソート" value="現在入力" />
        </aside>

        <div className="candidate-list" role="list">
          <div className="candidate-head">
            <span>順位</span>
            <span>SP配分（H-A-B-C-D-S）</span>
            <span>使用SP / 残りSP</span>
            <span>PASS条件</span>
            <span>ボトルネック</span>
          </div>
          {results.map((result, index) => (
            <ResultLane
              key={result.candidate.id}
              result={result}
              rank={index + 1}
              scenarios={project.scenarios}
              selected={selectedResult.candidate.id === result.candidate.id}
              onSelect={() => setSelectedResultId(result.candidate.id)}
            />
          ))}
          {results.length === 0 && (
            <div className="result-count">評価可能な攻撃シナリオがありません</div>
          )}
          <div className="result-count">
            実評価 {results[0]?.evaluations.length ?? 0} 件 / 未評価 {issues.length} 件
          </div>
        </div>

        {selectedResult ? (
          <ResultInspector
            result={selectedResult}
            scenarios={project.scenarios}
            scenarioRows={project.scenarioRows}
            issues={issues}
          />
        ) : (
          <aside className="result-inspector">
            <p className="evaluation-message">M1ではダメージ技を持つシナリオが実評価対象です。</p>
          </aside>
        )}
      </div>
    </section>
  );
}

function LiveScenarioEvaluationPanel({
  scenario,
  selection,
  moveOptions,
  abilityOptions,
  itemOptions,
  optionLookups,
  onSelectionChange,
}: {
  scenario: BaseScenario;
  selection: ScenarioInputSelection;
  moveOptions: MoveOptionEntry[];
  abilityOptions: AbilityOptionEntry[];
  itemOptions: ItemOptionEntry[];
  optionLookups: {
    moves: OptionLookup<MoveOptionEntry>;
    abilities: OptionLookup<AbilityOptionEntry>;
    items: OptionLookup<ItemOptionEntry>;
  };
  onSelectionChange: (selection: ScenarioInputSelection) => void;
}) {
  const selectableMoveOptions = useMemo(
    () =>
      moveOptions.filter(
        (option) => option.sourceStatus !== "unsupported-temporary" && option.category !== "Status",
      ),
    [moveOptions],
  );
  const selectableAbilityOptions = useMemo(
    () => abilityOptions.filter((option) => option.sourceStatus !== "unsupported-temporary"),
    [abilityOptions],
  );
  const selectableItemOptions = useMemo(
    () => itemOptions.filter((option) => option.sourceStatus !== "unsupported-temporary"),
    [itemOptions],
  );
  const defaultSelection = useMemo<ScenarioInputSelection>(
    () => ({
      moveId:
        findOptionByShowdownName(selectableMoveOptions, scenario.move?.showdownName)?.id ??
        scenario.move?.id,
      attackerAbilityId: findOptionByShowdownName(selectableAbilityOptions, scenario.attacker.ability)?.id,
      attackerItemId: findOptionByShowdownName(selectableItemOptions, scenario.attacker.item)?.id,
      defenderAbilityId: findOptionByShowdownName(selectableAbilityOptions, scenario.defender.ability)?.id,
      defenderItemId: findOptionByShowdownName(selectableItemOptions, scenario.defender.item)?.id,
      weather: scenario.field.weather ?? "none",
      terrain: scenario.field.terrain ?? "none",
      reflect: Boolean(scenario.field.reflect),
      lightScreen: Boolean(scenario.field.lightScreen),
      criticalHit: Boolean(scenario.field.criticalHit),
      spreadMove: Boolean(scenario.field.spreadMove),
      attackerStages: scenario.attackerStages,
      defenderStages: scenario.defenderStages,
    }),
    [scenario, selectableAbilityOptions, selectableItemOptions, selectableMoveOptions],
  );
  const effectiveSelection = useMemo<ScenarioInputSelection>(
    () => ({
      ...defaultSelection,
      ...selection,
      attackerStages: {
        ...defaultSelection.attackerStages,
        ...selection.attackerStages,
      },
      defenderStages: {
        ...defaultSelection.defenderStages,
        ...selection.defenderStages,
      },
    }),
    [defaultSelection, selection],
  );
  const scenarioForEvaluation = useMemo(
    () => applyScenarioInputSelection(scenario, effectiveSelection, optionLookups),
    [effectiveSelection, optionLookups, scenario],
  );

  const evaluationState = useMemo<
    | { status: "ok"; evaluation: DamageScenarioEvaluation }
    | { status: "unsupported"; message: string }
    | { status: "error"; message: string }
  >(() => {
    if (!scenarioForEvaluation.move) {
      return {
        status: "unsupported",
        message: "ダメージ技なし",
      };
    }

    try {
      return {
        status: "ok",
        evaluation: evaluateAttackScenario(
          scenarioForEvaluation,
          findConstraint(scenarioForEvaluation.id),
        ),
      };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "評価に失敗",
      };
    }
  }, [scenarioForEvaluation]);

  const moveLabel = scenarioForEvaluation.move?.displayName ?? "速度比較";
  const checkLabel =
    evaluationState.status === "ok"
      ? evaluationState.evaluation.check === "survive"
        ? "生存"
        : evaluationState.evaluation.check === "ko"
          ? "KO"
          : "ダメージ"
      : "-";

  return (
    <section className="live-evaluation-panel" aria-labelledby="live-evaluation-title">
      <div className="live-evaluation-header">
        <div>
          <p className="eyebrow">Milestone 1</p>
          <h2 id="live-evaluation-title">選択シナリオ実評価</h2>
        </div>
        <span
          className={`evaluation-status ${
            evaluationState.status === "ok" && evaluationState.evaluation.passed ? "is-pass" : "is-warn"
          }`}
        >
          {evaluationState.status === "ok"
            ? evaluationState.evaluation.passed
              ? "PASS"
              : "FAIL"
            : "WAIT"}
        </span>
      </div>

      <div className="live-evaluation-main">
        <div className="scenario-input-grid">
          <SearchOptionField
            label="技"
            options={selectableMoveOptions}
            selectedId={effectiveSelection.moveId ?? ""}
            fallbackLabel={scenario.move?.displayName ?? "技を選択"}
            optionMeta={(option) => `${option.type} / ${option.category} / ${option.basePower ?? "-"}`}
            onChange={(moveId) => onSelectionChange({ moveId })}
          />
          <SearchOptionField
            label="攻撃側 特性"
            options={selectableAbilityOptions}
            selectedId={effectiveSelection.attackerAbilityId ?? ""}
            fallbackLabel={scenario.attacker.ability ?? "未指定"}
            optionMeta={(option) => option.tags?.join(" / ") ?? "Ability"}
            warning={(option) =>
              option?.sourceStatus === "needs-confirmation" || option?.calcAvailable === false
                ? "計算精度要確認。現時点では @smogon/calc が表現できる範囲だけで評価します。"
                : undefined
            }
            onChange={(attackerAbilityId) => onSelectionChange({ attackerAbilityId })}
          />
          <SearchOptionField
            label="攻撃側 持ち物"
            options={selectableItemOptions}
            selectedId={effectiveSelection.attackerItemId ?? ""}
            fallbackLabel={scenario.attacker.item ?? "未指定"}
            optionMeta={(option) => option.tags?.join(" / ") ?? "Item"}
            onChange={(attackerItemId) => onSelectionChange({ attackerItemId })}
          />
          <SearchOptionField
            label="防御側 特性"
            options={selectableAbilityOptions}
            selectedId={effectiveSelection.defenderAbilityId ?? ""}
            fallbackLabel={scenario.defender.ability ?? "未指定"}
            optionMeta={(option) => option.tags?.join(" / ") ?? "Ability"}
            warning={(option) =>
              option?.sourceStatus === "needs-confirmation" || option?.calcAvailable === false
                ? "計算精度要確認。現時点では @smogon/calc が表現できる範囲だけで評価します。"
                : undefined
            }
            onChange={(defenderAbilityId) => onSelectionChange({ defenderAbilityId })}
          />
          <SearchOptionField
            label="防御側 持ち物"
            options={selectableItemOptions}
            selectedId={effectiveSelection.defenderItemId ?? ""}
            fallbackLabel={scenario.defender.item ?? "未指定"}
            optionMeta={(option) => option.tags?.join(" / ") ?? "Item"}
            onChange={(defenderItemId) => onSelectionChange({ defenderItemId })}
          />
        </div>

        <div className="scenario-condition-grid">
          <ScenarioSelectField
            label="天候"
            value={effectiveSelection.weather ?? "none"}
            options={weatherOptions}
            onChange={(weather) => onSelectionChange({ weather })}
          />
          <ScenarioSelectField
            label="フィールド"
            value={effectiveSelection.terrain ?? "none"}
            options={terrainOptions}
            onChange={(terrain) => onSelectionChange({ terrain })}
          />
          <div className="scenario-toggle-grid">
            <ScenarioToggle
              label="リフレクター"
              checked={Boolean(effectiveSelection.reflect)}
              onChange={(reflect) => onSelectionChange({ reflect })}
            />
            <ScenarioToggle
              label="ひかりのかべ"
              checked={Boolean(effectiveSelection.lightScreen)}
              onChange={(lightScreen) => onSelectionChange({ lightScreen })}
            />
            <ScenarioToggle
              label="急所"
              checked={Boolean(effectiveSelection.criticalHit)}
              onChange={(criticalHit) => onSelectionChange({ criticalHit })}
            />
            <ScenarioToggle
              label="ダブル範囲"
              checked={Boolean(effectiveSelection.spreadMove)}
              onChange={(spreadMove) => onSelectionChange({ spreadMove })}
            />
          </div>
          <RankStageEditor
            label="攻撃側ランク"
            stages={effectiveSelection.attackerStages ?? {}}
            onChange={(attackerStages) => onSelectionChange({ attackerStages })}
          />
          <RankStageEditor
            label="防御側ランク"
            stages={effectiveSelection.defenderStages ?? {}}
            onChange={(defenderStages) => onSelectionChange({ defenderStages })}
          />
        </div>

        <div className="evaluation-matchup">
          <strong>{scenarioForEvaluation.attacker.species.displayName}</strong>
          <span>{moveLabel}</span>
          <strong>{scenarioForEvaluation.defender.species.displayName}</strong>
        </div>

        {evaluationState.status === "ok" ? (
          <>
            <div className="evaluation-metrics">
              <div>
                <span>判定</span>
                <strong>{checkLabel}</strong>
              </div>
              <div>
                <span>成功率</span>
                <strong>{formatPercent(evaluationState.evaluation.probability)}</strong>
              </div>
              <div>
                <span>要求</span>
                <strong>
                  {evaluationState.evaluation.thresholdProbability === undefined
                    ? "-"
                    : formatPercent(evaluationState.evaluation.thresholdProbability)}
                </strong>
              </div>
              <div>
                <span>ダメージ</span>
                <strong>{formatDamageRange(evaluationState.evaluation.damageRange)}</strong>
              </div>
              <div>
                <span>対象HP</span>
                <strong>{evaluationState.evaluation.defenderHp}</strong>
              </div>
              <div>
                <span>Hit</span>
                <strong>{evaluationState.evaluation.hits}</strong>
              </div>
            </div>

            <div className="damage-roll-strip" aria-label="ダメージ乱数">
              {evaluationState.evaluation.damageRolls.map((roll, index) => (
                <span key={`${roll}-${index}`}>{roll}</span>
              ))}
            </div>

            <p className="engine-description">{evaluationState.evaluation.engineDescription}</p>
          </>
        ) : (
          <div className="evaluation-message">{evaluationState.message}</div>
        )}
      </div>
    </section>
  );
}

function App() {
  const [selectedScenarioId, setSelectedScenarioId] = useState(wireframeProject.scenarios[0].id);
  const [selectedPokemonId, setSelectedPokemonId] = useState(defaultTargetPokemonId);
  const [selectedAbilityId, setSelectedAbilityId] = useState(defaultTargetAbilityId);
  const [scenarioSelections, setScenarioSelections] = useState<Record<string, ScenarioInputSelection>>({});
  const [statusMessage, setStatusMessage] = useState("現在状態を編集中");
  const importInputRef = useRef<HTMLInputElement>(null);
  const pokemonOptions = usePokemonOptions();
  const abilityOptions = useAbilityOptions();
  const moveOptions = useMoveOptions();
  const itemOptions = useItemOptions();
  const pokemonLookup = useMemo<PokemonLookup>(
    () => ({
      byId: new Map(pokemonOptions.map((option) => [option.id, option])),
      byShowdownName: new Map(
        pokemonOptions.map((option) => [normalizePokemonKey(option.showdownName), option]),
      ),
    }),
    [pokemonOptions],
  );
  const optionLookups = useMemo(
    () => ({
      moves: createOptionLookup(moveOptions),
      abilities: createOptionLookup(abilityOptions),
      items: createOptionLookup(itemOptions),
    }),
    [abilityOptions, itemOptions, moveOptions],
  );
  const selectedTargetPokemon = pokemonLookup.byId.get(selectedPokemonId);
  const selectedAbility = abilityOptions.find((option) => option.id === selectedAbilityId);
  const currentShareState = useMemo(
    () =>
      createShareState({
        selectedPokemonId,
        selectedAbilityId,
        selectedScenarioId,
        scenarioSelections,
      }),
    [scenarioSelections, selectedAbilityId, selectedPokemonId, selectedScenarioId],
  );

  useEffect(() => {
    const stateParam = new URL(window.location.href).searchParams.get("state");

    if (!stateParam) {
      return;
    }

    try {
      const restoredState = decodeShareState(stateParam);

      setSelectedPokemonId(restoredState.selectedPokemonId);
      setSelectedAbilityId(restoredState.selectedAbilityId);
      setSelectedScenarioId(restoredState.selectedScenarioId);
      setScenarioSelections(restoredState.scenarioSelections);
      setStatusMessage("共有URLから復元しました");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "共有URLの復元に失敗しました");
    }
  }, []);

  const currentTarget = useMemo<Build>(
    () => ({
      ...wireframeProject.target,
      species: selectedTargetPokemon
        ? createSpeciesRef(selectedTargetPokemon)
        : wireframeProject.target.species,
      ability: selectedAbility?.showdownName ?? wireframeProject.target.ability,
    }),
    [selectedAbility, selectedTargetPokemon],
  );
  const currentScenarios = useMemo(
    () =>
      wireframeProject.scenarios.map((scenario) => {
        const applyCurrentTarget = (build: Build): Build =>
          build.id === wireframeProject.target.id ? currentTarget : build;

        return applyScenarioInputSelection(
          {
            ...scenario,
            attacker: applyCurrentTarget(scenario.attacker),
            defender: applyCurrentTarget(scenario.defender),
          },
          scenarioSelections[scenario.id] ?? {},
          optionLookups,
        );
      }),
    [currentTarget, optionLookups, scenarioSelections],
  );
  const currentProject = useMemo<AdjustmentProject>(
    () => ({
      ...wireframeProject,
      target: currentTarget,
      scenarios: currentScenarios,
    }),
    [currentScenarios, currentTarget],
  );
  const selectedScenario = useMemo(
    () =>
      currentScenarios.find((scenario) => scenario.id === selectedScenarioId) ??
      currentScenarios[0] ??
      wireframeProject.scenarios[0],
    [currentScenarios, selectedScenarioId],
  );
  const selectedScenarioSelection = scenarioSelections[selectedScenario.id] ?? {};
  const currentEvaluationState = useMemo(() => {
    const evaluations: DamageScenarioEvaluation[] = [];
    const issues: ScenarioEvaluationIssue[] = [];

    currentProject.scenarios
      .filter((scenario) => scenario.enabled)
      .forEach((scenario) => {
        if (!scenario.move) {
          issues.push({
            scenarioId: scenario.id,
            title: scenario.title,
            status: "unsupported",
            message: "速度などダメージ技なしの条件は Milestone 1 では未評価です",
          });
          return;
        }

        try {
          evaluations.push(evaluateAttackScenario(scenario, findConstraint(scenario.id, currentProject.constraints)));
        } catch (error) {
          issues.push({
            scenarioId: scenario.id,
            title: scenario.title,
            status: "error",
            message: error instanceof Error ? error.message : "評価に失敗しました",
          });
        }
      });

    const result = createLiveResult(currentProject, evaluations);

    return {
      evaluations,
      issues,
      results: result ? [result] : [],
    };
  }, [currentProject]);
  const exportProject = useMemo<AdjustmentProject>(
    () => ({
      ...currentProject,
      results: currentEvaluationState.results,
    }),
    [currentEvaluationState.results, currentProject],
  );

  const copyProjectJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(exportProject, null, 2));
    setStatusMessage("現在状態の JSON をコピーしました");
  };

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(
      createProjectMarkdown(currentProject, currentEvaluationState.results[0], currentEvaluationState.issues),
    );
    setStatusMessage("実評価結果 Markdown をコピーしました");
  };

  const copyShareUrl = async () => {
    const url = new URL(window.location.href);

    url.searchParams.set("state", encodeShareState(currentShareState));
    window.history.replaceState(null, "", url);
    await navigator.clipboard.writeText(url.toString());
    setStatusMessage("共有URLをコピーしました");
  };

  const importProjectJson = async (file: File) => {
    const text = await file.text();
    const parsed = JSON.parse(text) as unknown;

    if (!isAdjustmentProject(parsed)) {
      throw new Error("ChampionCreator の project JSON として読めません");
    }

    const importedProject = parsed;
    const importedPokemon =
      pokemonLookup.byShowdownName.get(normalizePokemonKey(importedProject.target.species.showdownName)) ??
      pokemonLookup.byId.get(importedProject.target.species.id);
    const importedAbility = importedProject.target.ability
      ? optionLookups.abilities.byShowdownName.get(normalizePokemonKey(importedProject.target.ability))
      : undefined;
    const nextScenarioId = importedProject.scenarios.some((scenario) => scenario.id === selectedScenarioId)
      ? selectedScenarioId
      : importedProject.scenarios[0]?.id ?? wireframeProject.scenarios[0].id;

    setSelectedPokemonId(importedPokemon?.id ?? selectedPokemonId);
    setSelectedAbilityId(importedAbility?.id ?? "");
    setSelectedScenarioId(nextScenarioId);
    setScenarioSelections(createScenarioSelectionsFromProject(importedProject, optionLookups));
    setStatusMessage("JSON から現在状態へ復元しました");
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
          <span className="topbar-status">{statusMessage}</span>
          <button type="button" onClick={copyProjectJson}>JSON</button>
          <button type="button" onClick={() => importInputRef.current?.click()}>Import</button>
          <button type="button" onClick={copyShareUrl}>URL</button>
          <button type="button" onClick={copyMarkdown}>MD</button>
          <input
            ref={importInputRef}
            className="hidden-file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];

              if (!file) {
                return;
              }

              void importProjectJson(file).catch((error) => {
                setStatusMessage(error instanceof Error ? error.message : "JSON import に失敗しました");
              });
              event.currentTarget.value = "";
            }}
          />
        </div>
      </header>

      <div className="authoring-grid">
        <TargetPanel
          pokemonOptions={pokemonOptions}
          abilityOptions={abilityOptions}
          selectedPokemonId={selectedPokemonId}
          selectedAbilityId={selectedAbilityId}
          onSelectedPokemonIdChange={setSelectedPokemonId}
          onSelectedAbilityIdChange={setSelectedAbilityId}
        />
        <ScenarioBoard
          selectedScenarioId={selectedScenario.id}
          onSelectScenario={setSelectedScenarioId}
          pokemonLookup={pokemonLookup}
          targetPokemon={selectedTargetPokemon}
          scenarios={currentProject.scenarios}
          scenarioRows={currentProject.scenarioRows}
        />
      </div>

      <LiveScenarioEvaluationPanel
        scenario={selectedScenario}
        selection={selectedScenarioSelection}
        moveOptions={moveOptions}
        abilityOptions={abilityOptions}
        itemOptions={itemOptions}
        optionLookups={optionLookups}
        onSelectionChange={(nextSelection) =>
          setScenarioSelections((current) => ({
            ...current,
            [selectedScenario.id]: {
              ...current[selectedScenario.id],
              ...nextSelection,
            },
          }))
        }
      />

      <ResultsBoard
        project={currentProject}
        results={currentEvaluationState.results}
        issues={currentEvaluationState.issues}
      />
    </main>
  );
}

export default App;
