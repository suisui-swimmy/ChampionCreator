import { type ChangeEvent, type FocusEvent, type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRightIcon } from "@radix-ui/react-icons";
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
import {
  getEntityInputOptions,
  getMatchingEntityInputOptions,
  getPokemonAbilityInputOptions,
  resolveEntity,
  type EntityInputOption,
} from "./localization/resolver";
import {
  applyCandidateToTarget,
  buildScenarioAttackBuildFromUi,
  buildIntegratedDefenceSearchInput,
  buildTargetBuildFromUi,
  calculateOffenseAdjustmentsForCandidateRanking,
  calculateSpeedAdjustmentsForCandidateRanking,
  createDefaultAttackerStatPoints,
  createDefaultScenarioAttackForm,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  createInitialSearchUiState,
  formatScenarioAttackLabel,
  searchUiReducer,
  startDefenceSearchFromUi,
  type OffenseScenarioResult,
  type ScenarioAdjustmentType,
  type ScenarioAttackFormState,
  type ScenarioFormState,
  type SpeedScenarioResult,
  type TargetFormState,
} from "./ui/defenceSearchUi";
import type { SpeedAdjustmentResult, SpeedManualMultiplier } from "./search/speedAdjustment";
import { getMoveDefenderStatKeys, getMoveStatReferencePlan } from "./ui/moveStatReference";
import { findPokemonArtwork, type PokemonArtworkMatch } from "./ui/pokemonArtwork";
import {
  getPokemonBaseFormValue,
  getPokemonFormVariantOptions,
  isPokemonFormVariant,
  type PokemonFormVariantKind,
  type PokemonFormVariantOption,
} from "./ui/pokemonFormVariants";
import {
  BOX_STORAGE_KEY,
  createBoxEntryFromState,
  createBoxEntrySummary,
  parseBoxStorageDocument,
  stringifyBoxStorageDocument,
  type BoxEntry,
  type BoxEntrySummary,
} from "./ui/boxStorage";
import natureOptionsData from "./data/generated/nature-options.gen.json";
import { Button, SelectField, StatusBadge, UiPopover } from "./ui/primitives";
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
const natureMatrixKeys = ["atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];

const getOffenseDefenderStatKeysFromMoveContext = (
  moveInput: string,
  options: { teraEnabled?: boolean },
  targetReferenceKeys: ReadonlySet<StatKey>,
): StatKey[] => {
  const visibleKeys = new Set<StatKey>(getMoveDefenderStatKeys(moveInput, options));
  targetReferenceKeys.forEach((key) => visibleKeys.add(key));
  return statKeys.filter((key) => visibleKeys.has(key));
};

export const getOffenseDefenderStatKeys = (
  moveInput: string,
  options: { teraEnabled?: boolean } = {},
): StatKey[] => {
  const targetReferenceKeys = new Set(
    getMoveStatReferencePlan(moveInput, options).references
      .filter((reference) => reference.owner === "target")
      .map((reference) => reference.stat),
  );
  return getOffenseDefenderStatKeysFromMoveContext(moveInput, options, targetReferenceKeys);
};

type NatureMatrixStatKey = (typeof natureMatrixKeys)[number];

type NatureOption = {
  id: string;
  label: string;
  showdownName: string;
  plus: NatureMatrixStatKey;
  minus: NatureMatrixStatKey;
};

const natureOptions = natureOptionsData.entries as NatureOption[];
const natureOptionsByLabel = new Map(natureOptions.map((option) => [option.label, option]));
const natureOptionsByCell = new Map(natureOptions.map((option) => [`${option.plus}:${option.minus}`, option]));

const getNatureCellOption = (plus: NatureMatrixStatKey, minus: NatureMatrixStatKey): NatureOption | undefined =>
  natureOptionsByCell.get(`${plus}:${minus}`);

export const getNatureModifierDirection = (
  natureLabel: string,
  stat: StatKey,
): "up" | "down" | null => {
  if (stat === "hp") {
    return null;
  }

  const nature = natureOptionsByLabel.get(natureLabel);
  if (!nature || nature.plus === nature.minus) {
    return null;
  }
  if (nature.plus === stat) {
    return "up";
  }
  if (nature.minus === stat) {
    return "down";
  }
  return null;
};

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

const speedMultiplierOptions: Array<{ value: SpeedManualMultiplier; label: string }> = [
  { value: "auto", label: "なし" },
  { value: "2", label: "2倍" },
  { value: "1.5", label: "1.5倍" },
  { value: "0.5", label: "0.5倍" },
];

const speedMoveModifierOptions = [
  { value: "none", label: "なし" },
  { value: "tailwind", label: "おいかぜ" },
  { value: "trick-room", label: "トリックルーム" },
] as const;

const resolveCanonicalEntityName = (kind: EntityKind, input: string): string | undefined => {
  const result = resolveEntity(kind, input);
  return result.status === "exact" || result.status === "alias" ? result.canonicalName : undefined;
};

export const isUnresolvedEntityInput = (kind: EntityKind, input: string): boolean => {
  if (!input.trim()) {
    return false;
  }
  const result = resolveEntity(kind, input);
  return result.status !== "exact" && result.status !== "alias";
};

const isCanonicalResolutionMessage = (message: string | null): boolean =>
  Boolean(message?.includes("canonical name に解決できません"));

export const normalizeNumericInputText = (value: string): string =>
  value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, ".")
    .replace(/[－]/g, "-")
    .replace(/[＋]/g, "+")
    .trim();

const numericInputProps = {
  type: "text",
  inputMode: "numeric",
  pattern: "[0-9]*",
} as const;

const toNumber = (value: string, fallback = 0): number => {
  const parsed = Number(normalizeNumericInputText(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampNumberInput = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.trunc(value)));

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

const damageDescriptionEntityKinds = ["pokemon", "move", "item", "ability", "type"] as const satisfies readonly EntityKind[];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const damageDescriptionNameReplacements = damageDescriptionEntityKinds
  .flatMap((kind) => getEntityInputOptions(kind))
  .filter((option) => option.canonicalName !== option.displayNameJa)
  .sort((a, b) => b.canonicalName.length - a.canonicalName.length)
  .map((option) => ({
    pattern: new RegExp(`(^|[^A-Za-z0-9-])(${escapeRegExp(option.canonicalName)})(?=$|[^A-Za-z0-9-])`, "g"),
    label: option.displayNameJa,
  }));

const damageDescriptionStatCodes = {
  HP: "H",
  Atk: "A",
  Def: "B",
  SpA: "C",
  SpD: "D",
  Spe: "S",
} satisfies Record<string, string>;

type DamageDescriptionStat = keyof typeof damageDescriptionStatCodes;

const damageDescriptionPattern = /^(\d+)([+-]?)\s+(Atk|Def|SpA|SpD|Spe)\s+(.+?)\s+vs\.\s+(\d+)\s+HP\s+\/\s+(\d+)([+-]?)\s+(Def|SpD|Atk|SpA|Spe)\s+([^:]+):\s+(.+)$/u;

const formatDamageDescriptionStatCode = (stat: string): string =>
  damageDescriptionStatCodes[stat as DamageDescriptionStat] ?? stat;

const formatDamageDescriptionStatPoint = (investment: string): string =>
  String(smogonEvToStatPoints(Number(investment)));

const formatKoPhraseJa = (count: string): string => (
  count === "O" ? "1発" : `${count}発`
);

const localizeDamageDescriptionNames = (description: string): string =>
  damageDescriptionNameReplacements.reduce(
    (current, replacement) => current.replace(replacement.pattern, (_match, prefix: string) => `${prefix}${replacement.label}`),
    description,
  );

const formatLocalizedDamageResult = (resultText: string): string =>
  resultText
    .replace(/\s+-\s+/g, "-")
    .replace(/\s+--\s+guaranteed\s+(O|\d+)HKO/gi, (_match, count: string) => ` / 確定${formatKoPhraseJa(count)}`)
    .replace(/\s+--\s+possible\s+(O|\d+)HKO/gi, (_match, count: string) => ` / ${formatKoPhraseJa(count)}の可能性`)
    .replace(/\s+--\s+(\d+(?:\.\d+)?)%\s+chance\s+to\s+(O|\d+)HKO/gi, (_match, chance: string, count: string) => (
      ` / ${chance}%で${formatKoPhraseJa(count)}`
    ));

const formatFallbackLocalizedDamageDescription = (description: string): string =>
  Object.entries(damageDescriptionStatCodes)
    .reduce(
      (current, [english, japanese]) => current.replace(new RegExp(`\\b${english}\\b`, "g"), japanese),
      localizeDamageDescriptionNames(description),
    )
    .replace(/\s+vs\.\s+/g, " → ")
    .replace(/:\s+/g, " : ")
    .replace(/\s+-\s+/g, "-");

export const formatLocalizedDamageDescription = (description: string): string => {
  const match = damageDescriptionPattern.exec(description);
  if (!match) {
    return formatLocalizedDamageResult(formatFallbackLocalizedDamageDescription(description));
  }

  const [
    ,
    attackInvestment,
    attackNature,
    attackStat,
    attackerAndMove,
    defenderHpInvestment,
    defenderInvestment,
    defenderNature,
    defenderStat,
    defenderPokemon,
    resultText,
  ] = match;

  return [
    `${formatDamageDescriptionStatCode(attackStat)}${formatDamageDescriptionStatPoint(attackInvestment)}${attackNature}`,
    localizeDamageDescriptionNames(attackerAndMove),
    "→",
    `H${formatDamageDescriptionStatPoint(defenderHpInvestment)}`,
    "/",
    `${formatDamageDescriptionStatCode(defenderStat)}${formatDamageDescriptionStatPoint(defenderInvestment)}${defenderNature}`,
    localizeDamageDescriptionNames(defenderPokemon.trim()),
    ":",
    formatLocalizedDamageResult(resultText),
  ].join(" ");
};

const statPointCells = Array.from({ length: CHAMPIONS_MAX_STAT_POINTS_PER_STAT }, (_value, index) => index + 1);

export const formatScenarioResultStatusLabel = (passed: boolean): "PASS" | "FAIL" =>
  passed ? "PASS" : "FAIL";

const formatStatPointSpreadLabel = (statPoints: StatTable): string =>
  statKeys.map((key) => `${statLabels[key]} ${statPoints[key]}`).join(" / ");

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
const getNatureModifierIconSrc = (name: "up" | "down"): string =>
  getAssetSrc(`assets/nature-modifiers/nature-${name}.svg`);

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

function NatureModifierIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <img
      className="nature-modifier-icon"
      src={getNatureModifierIconSrc(direction)}
      alt={direction === "up" ? "上昇" : "下降"}
      loading="lazy"
      decoding="async"
    />
  );
}

function NatureStatModifier({
  natureLabel,
  stat,
}: {
  natureLabel: string;
  stat: StatKey;
}) {
  const direction = getNatureModifierDirection(natureLabel, stat);

  return (
    <span
      className={`nature-stat-modifier${direction ? ` ${direction}` : ""}`}
      aria-label={direction ? `${statLabels[stat]} ${direction === "up" ? "上昇" : "下降"}` : undefined}
      aria-hidden={direction ? undefined : true}
    >
      {direction ? <NatureModifierIcon direction={direction} /> : null}
    </span>
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
  attackerStatPoints: createDefaultAttackerStatPoints(),
  attackerBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  defenderBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moveInput: "",
  repeat: 1,
  requiredSurvivedHits: Math.min(10, index + 1),
  minSurvivalProbabilityPercent: 100,
  targetKoProbabilityPercent: 100,
  gameType: "singles",
  weather: "none",
  terrain: "none",
  critical: false,
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  friendGuard: false,
  speedTargetMode: "opponent",
  speedComparison: "outspeed",
  speedRequiredOffset: 1,
  speedTargetValue: 0,
  speedItemMultiplier: "auto",
  speedAbilityMultiplier: "auto",
  speedMoveModifier: "none",
  tailwind: false,
});

const createBlankTargetForm = (): TargetFormState => ({
  ...createDefaultTargetForm(),
  pokemonInput: "",
  natureInput: "",
  abilityInput: "",
  itemInput: "",
  teraTypeInput: "",
  teraEnabled: false,
  dmaxEnabled: false,
  level: 50,
  statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
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

const BLANK_BOX_SLOT_ID = "blank-box-slot";

const loadBoxEntriesFromBrowser = (): BoxEntry[] => {
  if (typeof window === "undefined") {
    return [];
  }

  return parseBoxStorageDocument(window.localStorage.getItem(BOX_STORAGE_KEY));
};

const saveBoxEntriesToBrowser = (entries: BoxEntry[]): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    window.localStorage.setItem(BOX_STORAGE_KEY, stringifyBoxStorageDocument(entries));
    return null;
  } catch {
    return "ブラウザ保存に失敗しました";
  }
};

export function App() {
  const [targetForm, setTargetForm] = useState<TargetFormState>(() => createDefaultTargetForm());
  const [scenarioForms, setScenarioForms] = useState<ScenarioFormState[]>(() => createDefaultScenarioForms());
  const [searchState, dispatchSearch] = useReducer(searchUiReducer, undefined, createInitialSearchUiState);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [appliedCandidateId, setAppliedCandidateId] = useState<string | null>(null);
  const [actualStats, setActualStats] = useState<StatTable | null>(null);
  const [attackerActualStats, setAttackerActualStats] = useState<Record<string, StatTable>>({});
  const [boxOpen, setBoxOpen] = useState(false);
  const [boxEntries, setBoxEntries] = useState<BoxEntry[]>(loadBoxEntriesFromBrowser);
  const [selectedBoxEntryId, setSelectedBoxEntryId] = useState<string | null>(null);
  const [boxMessage, setBoxMessage] = useState<string | null>(null);
  const workerClientRef = useRef<DefenceSearchWorkerClient | null>(null);
  const activeRequestRef = useRef<ActiveDefenceSearchRequest | null>(null);
  const applyTimerRef = useRef<number | null>(null);

  const previewInput = useMemo(() => {
    try {
      return { input: buildIntegratedDefenceSearchInput(targetForm, scenarioForms), error: null };
    } catch (error) {
      return { input: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [targetForm, scenarioForms]);

  const targetBuildPreview = useMemo(() => {
    try {
      return buildTargetBuildFromUi(targetForm);
    } catch {
      return null;
    }
  }, [targetForm]);

  const targetArtwork = useMemo(() => findPokemonArtwork({
    input: targetForm.pokemonInput,
    canonicalName: targetBuildPreview?.pokemon.canonicalName,
  }), [targetForm.pokemonInput, targetBuildPreview?.pokemon.canonicalName]);

  const currentBoxSummary = useMemo(
    () => createBoxEntrySummary(targetForm, scenarioForms),
    [targetForm, scenarioForms],
  );

  const offenseResults = useMemo(
    () => calculateOffenseAdjustmentsForCandidateRanking(targetForm, scenarioForms),
    [targetForm, scenarioForms],
  );
  const speedResults = useMemo(
    () => calculateSpeedAdjustmentsForCandidateRanking(targetForm, scenarioForms),
    [targetForm, scenarioForms],
  );

  const hasEnabledDefenceScenario = scenarioForms.some((scenario) => (
    scenario.enabled && scenario.adjustmentType === "defence"
  ));

  const resultAlertMessage =
    (hasEnabledDefenceScenario && previewInput.error && !isCanonicalResolutionMessage(previewInput.error))
      ? previewInput.error
      : searchState.errorMessage && !isCanonicalResolutionMessage(searchState.errorMessage)
        ? searchState.errorMessage
        : null;

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

    if (!targetBuildPreview) {
      setActualStats(null);
      setAttackerActualStats({});
      return () => {
        canceled = true;
      };
    }

    void import("./calc/smogonAdapter").then(({ toSmogonPokemon }) => {
      if (!canceled) {
        const pokemon = toSmogonPokemon(targetBuildPreview);
        setActualStats({ ...pokemon.stats, hp: pokemon.maxHP() });
        setAttackerActualStats(Object.fromEntries(
          scenarioForms.flatMap((scenario) => scenario.attacks.flatMap((attack) => {
            try {
              const build = buildScenarioAttackBuildFromUi(
                attack,
                `${scenario.id}-${attack.id}-attacker`,
              );
              const attacker = toSmogonPokemon(build);
              return [[build.id, { ...attacker.stats, hp: attacker.maxHP() }]];
            } catch {
              return [];
            }
          })),
        ));
      }
    }).catch(() => {
      if (!canceled) {
        setActualStats(null);
        setAttackerActualStats({});
      }
    });

    return () => {
      canceled = true;
    };
  }, [scenarioForms, targetBuildPreview]);

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

  const toggleScenarioAdjustmentFromDirection = (id: string) => {
    setScenarioForms((current) => current.map((scenario) => {
      if (scenario.id !== id) {
        return scenario;
      }

      return {
        ...scenario,
        adjustmentType: nextScenarioAdjustmentType(scenario.adjustmentType),
        attacks: scenario.attacks.map((attack) => ({
          ...attack,
          speedMoveModifier: "none",
        })),
      };
    }));
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
              attacks: [
                ...scenario.attacks,
                {
                  ...nextAttack,
                  requiredSurvivedHits,
                  gameType: scenario.attacks[0]?.gameType ?? nextAttack.gameType,
                },
              ],
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

  const persistBoxEntries = (nextEntries: BoxEntry[], message: string): boolean => {
    const error = saveBoxEntriesToBrowser(nextEntries);
    if (error) {
      setBoxMessage(error);
      return false;
    }

    setBoxEntries(nextEntries);
    setBoxMessage(message);
    return true;
  };

  const toggleBoxPanel = () => {
    if (!boxOpen && !selectedBoxEntryId) {
      setSelectedBoxEntryId(BLANK_BOX_SLOT_ID);
    }
    setBoxMessage(null);
    setBoxOpen((current) => !current);
  };

  const handleSaveCurrentBox = () => {
    const entry = createBoxEntryFromState(targetForm, scenarioForms);
    if (persistBoxEntries([entry, ...boxEntries], "今の条件を保存しました")) {
      setSelectedBoxEntryId(entry.id);
    }
  };

  const handleLoadBoxEntry = (entryId: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      activeRequestRef.current?.cancel();
      activeRequestRef.current = null;
      setTargetForm(createBlankTargetForm());
      setScenarioForms([createBlankScenario(0)]);
      setSelectedCandidateId(null);
      dispatchSearch({ type: "reset" });
      setBoxMessage(null);
      setBoxOpen(false);
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }

    activeRequestRef.current?.cancel();
    activeRequestRef.current = null;
    setTargetForm(entry.payload.target);
    setScenarioForms(entry.payload.scenarios);
    setSelectedCandidateId(null);
    dispatchSearch({ type: "reset" });
    setBoxMessage(null);
    setBoxOpen(false);
  };

  const handleOverwriteBoxEntry = (entryId: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      setBoxMessage("空スロットは上書きできません");
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }

    const updatedEntry = createBoxEntryFromState(targetForm, scenarioForms, {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
    });
    const nextEntries = boxEntries.map((candidate) => (
      candidate.id === entryId ? updatedEntry : candidate
    ));
    if (persistBoxEntries(nextEntries, "選択中の保存を上書きしました")) {
      setSelectedBoxEntryId(entryId);
    }
  };

  const handleRenameBoxEntry = (entryId: string, name: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      return;
    }

    const now = new Date().toISOString();
    const nextEntries = boxEntries.map((entry) => (
      entry.id === entryId
        ? { ...entry, name, updatedAt: now }
        : entry
    ));
    const error = saveBoxEntriesToBrowser(nextEntries);
    if (error) {
      setBoxMessage(error);
      return;
    }

    setBoxEntries(nextEntries);
  };

  const handleDuplicateBoxEntry = (entryId: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      setBoxMessage("空スロットは複製できません");
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }

    const now = new Date().toISOString();
    const duplicatedEntry: BoxEntry = {
      ...entry,
      id: `box-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: `${entry.name || entry.summary.pokemonName} コピー`,
      createdAt: now,
      updatedAt: now,
    };
    if (persistBoxEntries([duplicatedEntry, ...boxEntries], "保存を複製しました")) {
      setSelectedBoxEntryId(duplicatedEntry.id);
    }
  };

  const handleDeleteBoxEntry = (entryId: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      setBoxMessage("空スロットは削除できません");
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`${entry.name} を削除しますか？`)) {
      return;
    }

    const nextEntries = boxEntries.filter((candidate) => candidate.id !== entryId);
    if (persistBoxEntries(nextEntries, "保存を削除しました")) {
      setSelectedBoxEntryId(nextEntries[0]?.id ?? null);
    }
  };

  const handleSelectCandidate = (id: string) => {
    setSelectedCandidateId((current) => current === id ? null : id);
  };

  const handleApplyCandidate = (candidate: CandidateResult) => {
    setTargetForm((current) => applyCandidateToTarget(current, candidate));
    setAppliedCandidateId(candidate.id);
    if (applyTimerRef.current !== null) {
      window.clearTimeout(applyTimerRef.current);
    }
    applyTimerRef.current = window.setTimeout(() => setAppliedCandidateId(null), 1200);
  };

  return (
    <div className={`app-shell${searchState.status === "running" ? " is-running" : ""}`}>
      <header className="topbar">
        <div className="brand-title">
          <div className="brand-line">
            <h1>
              <img
                src={getAssetSrc("assets/brand/championcreator-title.svg")}
                alt="ChampionCreator"
              />
            </h1>
            <p>
              app v{appVersionInfo.appVersion}
              {" / "}
              calc {appVersionInfo.smogonCalcVersion}
              {" / "}
              data {appVersionInfo.localizationEntries}
            </p>
          </div>
        </div>
        <a
          className="readme-link"
          href="https://github.com/suisui-swimmy/ChampionCreator/blob/main/README.md"
          target="_blank"
          rel="noreferrer"
          aria-label="README.mdを開く"
          title="README.md"
        >
          <img src={getAssetSrc("assets/ui/info.svg")} alt="" aria-hidden="true" />
        </a>
      </header>

      {boxOpen ? (
        <BoxPanel
          entries={boxEntries}
          selectedEntryId={selectedBoxEntryId}
          currentSummary={currentBoxSummary}
          message={boxMessage}
          onClose={() => setBoxOpen(false)}
          onSaveCurrent={handleSaveCurrentBox}
          onSelectEntry={setSelectedBoxEntryId}
          onLoadEntry={handleLoadBoxEntry}
          onOverwriteEntry={handleOverwriteBoxEntry}
          onRenameEntry={handleRenameBoxEntry}
          onDuplicateEntry={handleDuplicateBoxEntry}
          onDeleteEntry={handleDeleteBoxEntry}
        />
      ) : null}

      <main className="workbench">
        <TargetPanel
          targetForm={targetForm}
          onUpdateField={updateTargetField}
          onUpdateEv={updateTargetEv}
          canonicalPokemon={targetBuildPreview?.pokemon.canonicalName}
          artwork={targetArtwork}
          actualStats={actualStats}
          totalStatPoints={sumStatPoints(targetForm.statPoints)}
          isBoxPanelOpen={boxOpen}
          onOpenBoxPanel={toggleBoxPanel}
        />
        <ScenarioPanel
          scenarios={scenarioForms}
          attackerActualStats={attackerActualStats}
          targetForm={targetForm}
          targetActualStats={actualStats}
          onAddScenario={handleAddScenario}
          onRemoveScenario={handleRemoveScenario}
          onUpdateScenario={updateScenario}
          onToggleScenarioAdjustmentFromDirection={toggleScenarioAdjustmentFromDirection}
          onAddAttack={handleAddAttack}
          onRemoveAttack={handleRemoveAttack}
          onUpdateAttack={updateScenarioAttack}
          onUpdateAttackerEv={updateScenarioAttackerEv}
        />
        <section className="search-control-bar" aria-label="探索操作">
          <div
            className="search-progress"
            role="progressbar"
            aria-label="探索進捗"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(searchState.progress * 100)}
          >
            <span
              className="search-progress-fill"
              style={{ width: `${Math.round(searchState.progress * 100)}%` }}
              aria-hidden="true"
            />
            <span className="search-progress-label" aria-live="polite">
              <strong>{Math.round(searchState.progress * 100)}%</strong>
              <span>{searchState.searchedCandidates} / {searchState.totalCandidates || "-"} 候補</span>
            </span>
          </div>
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
            disabled={searchState.status === "running" || !hasEnabledDefenceScenario}
          >
            {searchState.status === "running"
              ? "計算中..."
              : hasEnabledDefenceScenario ? "計算開始" : "耐久シナリオなし"}
          </Button>
        </section>
        <ResultsPanel
          candidates={searchState.candidates}
          selectedCandidateId={selectedCandidateId}
          appliedCandidateId={appliedCandidateId}
          scenarios={scenarioForms}
          status={searchState.status}
          offenseResults={offenseResults}
          speedResults={speedResults}
          strictestFailureLabel={searchState.strictestFailureLabel}
          targetLabel={targetBuildPreview?.pokemon.displayNameJa ?? targetForm.pokemonInput}
          resultAlertMessage={resultAlertMessage}
          onSelectCandidate={handleSelectCandidate}
          onApplyCandidate={handleApplyCandidate}
        />
      </main>
      <footer className="app-footer" aria-label="権利表記">
        <div className="app-footer-copy">
          <span>© 2026 suisui-swimmy</span>
          <span>
            本ツールは非公式のファンツールであり、画像、名称などに関する著作権は 任天堂 / クリーチャーズ / ゲームフリーク に帰属します
          </span>
        </div>
        <a
          className="app-footer-contact"
          href="https://x.com/peixe0307"
          target="_blank"
          rel="noreferrer"
          aria-label="不具合報告 / お問い合わせ: X @peixe0307"
        >
          <span>不具合報告 / お問い合わせ</span>
          <img src={getAssetSrc("assets/social/x-logo.svg")} alt="X" />
        </a>
      </footer>
    </div>
  );
}

type EntityTextFieldProps = {
  kind: EntityKind;
  label: string;
  value: string;
  className?: string;
  options?: EntityInputOption[];
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue?: (value: string) => void;
};

export function getDropdownEntityOptions(
  kind: EntityKind,
  value: string,
  suggestedOptions?: EntityInputOption[],
): EntityInputOption[] {
  return suggestedOptions ?? getMatchingEntityInputOptions(kind, value);
}

function EntityTextField({
  kind,
  label,
  value,
  className,
  options: suggestedOptions,
  onChange,
  onSelectValue,
}: EntityTextFieldProps) {
  const datalistId = `entity-options-${kind}-${useId()}`;
  const invalid = isUnresolvedEntityInput(kind, value);

  if (kind === "pokemon" && onSelectValue) {
    return (
      <PokemonAutocompleteField
        className={className}
        label={label}
        value={value}
        invalid={invalid}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  if ((kind === "item" || kind === "type") && onSelectValue) {
    return (
      <DropdownTextField
        className={className}
        label={label}
        value={value}
        kind={kind}
        options={getDropdownEntityOptions(kind, value, suggestedOptions)}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  const options = suggestedOptions ?? getMatchingEntityInputOptions(kind, value);
  const labelClassName = ["placeholder-field", invalid && "is-invalid", className].filter(Boolean).join(" ");

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

type PokemonAutocompleteFieldProps = {
  label: string;
  value: string;
  className?: string;
  invalid?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue: (value: string) => void;
};

type PokemonSuggestionKeyAction =
  | { type: "move"; index: number }
  | { type: "select" }
  | { type: "close" }
  | { type: "none" };

export const getPokemonSuggestionKeyAction = (
  key: string,
  activeIndex: number,
  optionCount: number,
): PokemonSuggestionKeyAction => {
  if (optionCount <= 0) {
    return { type: "none" };
  }

  if (key === "ArrowDown") {
    return { type: "move", index: (activeIndex + 1) % optionCount };
  }

  if (key === "ArrowUp") {
    return { type: "move", index: (activeIndex - 1 + optionCount) % optionCount };
  }

  if (key === "Tab" || key === "Enter") {
    return { type: "select" };
  }

  if (key === "Escape") {
    return { type: "close" };
  }

  return { type: "none" };
};

function PokemonAutocompleteField({
  label,
  value,
  className,
  invalid = false,
  onChange,
  onSelectValue,
}: PokemonAutocompleteFieldProps) {
  const listboxId = `pokemon-suggestions-${useId()}`;
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const options = useMemo(
    () => value.trim() ? getMatchingEntityInputOptions("pokemon", value, 8) : [],
    [value],
  );
  const open = focused && options.length > 0;
  const activeOption = options[Math.min(activeIndex, options.length - 1)];
  const fieldClassName = ["pokemon-autocomplete-field", "placeholder-field", invalid && "is-invalid", className].filter(Boolean).join(" ");

  const selectOption = (option: EntityInputOption) => {
    onSelectValue(option.value);
    setActiveIndex(0);
    setFocused(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = getPokemonSuggestionKeyAction(event.key, activeIndex, open ? options.length : 0);
    if (action.type === "none") {
      return;
    }

    if (action.type === "move") {
      event.preventDefault();
      setActiveIndex(action.index);
      return;
    }

    if (action.type === "select" && activeOption) {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      selectOption(activeOption);
      return;
    }

    if (action.type === "close") {
      event.preventDefault();
      setFocused(false);
    }
  };

  return (
    <UiPopover.Root open={open}>
      <UiPopover.Anchor asChild>
        <input
          className={fieldClassName}
          value={value}
          placeholder={label}
          autoComplete="off"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeOption ? `${listboxId}-${Math.min(activeIndex, options.length - 1)}` : undefined}
          onFocus={(event) => {
            selectInputValueOnFocus(event);
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setActiveIndex(0);
            setFocused(true);
            onChange(event);
          }}
          onKeyDown={handleKeyDown}
        />
      </UiPopover.Anchor>
      <UiPopover.Portal>
        <UiPopover.Content
          className="pokemon-suggestion-popover"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="pokemon-suggestion-list" id={listboxId} role="listbox" aria-label={`${label}候補`}>
            {options.map((option, index) => (
              <button
                className={`pokemon-suggestion-option${index === activeIndex ? " active" : ""}`}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                key={option.canonicalName}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span>{option.value}</span>
              </button>
            ))}
          </div>
        </UiPopover.Content>
      </UiPopover.Portal>
    </UiPopover.Root>
  );
}

type DropdownTextFieldProps = {
  kind: EntityKind;
  label: string;
  value: string;
  options: EntityInputOption[];
  className?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue: (value: string) => void;
};

function DropdownTextField({
  kind,
  label,
  value,
  options,
  className,
  onChange,
  onSelectValue,
}: DropdownTextFieldProps) {
  const listboxId = `dropdown-options-${useId()}`;
  const labelId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeOption = options[Math.min(activeIndex, options.length - 1)];
  const listOpen = open && options.length > 0;
  const invalid = isUnresolvedEntityInput(kind, value);
  const fieldClassName = ["dropdown-text-field", "placeholder-field", invalid && "is-invalid", className].filter(Boolean).join(" ");

  const selectOption = (option: EntityInputOption) => {
    onSelectValue(option.value);
    setActiveIndex(0);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = getPokemonSuggestionKeyAction(event.key, activeIndex, listOpen ? options.length : 0);
    if (action.type === "move") {
      event.preventDefault();
      setActiveIndex(action.index);
    } else if (action.type === "select" && activeOption) {
      event.preventDefault();
      selectOption(activeOption);
    } else if (action.type === "close") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div
      className={fieldClassName}
      ref={fieldRef}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <span className="visually-hidden" id={labelId}>{label}</span>
      <div className="dropdown-input-row">
        <input
          ref={inputRef}
          value={value}
          placeholder={label}
          autoComplete="off"
          role="combobox"
          aria-labelledby={labelId}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listboxId : undefined}
          onFocus={(event) => {
            selectInputValueOnFocus(event);
            setOpen(true);
          }}
          onChange={(event) => {
            setActiveIndex(0);
            setOpen(true);
            onChange(event);
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="dropdown-menu-trigger"
          type="button"
          data-state={listOpen ? "open" : "closed"}
          aria-label={`${label}候補を開く`}
          title={`${label}候補`}
          aria-expanded={listOpen}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
        >
          <ChevronRightIcon className="disclosure-chevron" />
        </button>
      </div>
      {listOpen ? (
        <div className="dropdown-options-popover">
          <div className="dropdown-option-list" id={listboxId} role="listbox" aria-label={`${label}候補`}>
            {options.map((option, index) => (
              <button
                className={`dropdown-option${index === activeIndex ? " active" : ""}${option.value === value ? " selected" : ""}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                key={option.canonicalName}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                {option.value}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AbilityTextFieldProps = {
  label: string;
  value: string;
  className?: string;
  pokemonAbilityOptions?: EntityInputOption[];
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectAbility: (value: string) => void;
};

function AbilityTextField({
  label,
  value,
  className,
  pokemonAbilityOptions = [],
  onChange,
  onSelectAbility,
}: AbilityTextFieldProps) {
  const matchingPokemonOptions = pokemonAbilityOptions.filter((option) =>
    !value.trim() || option.value.startsWith(value.trim()),
  );
  const options = matchingPokemonOptions.length > 0
    ? matchingPokemonOptions
    : getMatchingEntityInputOptions("ability", value);

  return (
    <DropdownTextField
      kind="ability"
      className={className}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      onSelectValue={onSelectAbility}
    />
  );
}

type NatureMatrixFieldProps = {
  label: string;
  value: string;
  className?: string;
  onChange: (value: string) => void;
};

function NatureMatrixField({ label, value, className, onChange }: NatureMatrixFieldProps) {
  const labelClassName = ["nature-field", isUnresolvedEntityInput("nature", value) && "is-invalid", className].filter(Boolean).join(" ");

  return (
    <div className={labelClassName}>
      <UiPopover.Root>
        <UiPopover.Trigger asChild>
          <button className="nature-trigger" type="button" aria-label={`${label}: ${value || "未選択"}`}>
            <span className={`nature-trigger-main${value ? "" : " placeholder"}`}>{value || label}</span>
            <span className="nature-trigger-icon" aria-hidden="true">
              <ChevronRightIcon className="disclosure-chevron" />
            </span>
          </button>
        </UiPopover.Trigger>
        <UiPopover.Portal>
          <UiPopover.Content className="nature-popover" sideOffset={6} align="start">
            <div className="nature-matrix" role="grid" aria-label={`${label}を能力補正表から選択`}>
              <div className="nature-matrix-corner" aria-hidden="true">性格</div>
              {natureMatrixKeys.map((minusKey) => (
                <div className="nature-matrix-header" role="columnheader" key={`minus-${minusKey}`} aria-label={`${statLabels[minusKey]}下降`}>
                  <StatIcon stat={minusKey} />
                  <NatureModifierIcon direction="down" />
                </div>
              ))}
              {natureMatrixKeys.map((plusKey) => (
                <div className="nature-matrix-row" role="row" key={`plus-${plusKey}`}>
                  <div className="nature-matrix-side" role="rowheader" aria-label={`${statLabels[plusKey]}上昇`}>
                    <StatIcon stat={plusKey} />
                    <NatureModifierIcon direction="up" />
                  </div>
                  {natureMatrixKeys.map((minusKey) => {
                    const option = getNatureCellOption(plusKey, minusKey);
                    const selected = option?.label === value;

                    return (
                      <div className="nature-matrix-cell" role="gridcell" key={`${plusKey}-${minusKey}`}>
                        {option ? (
                          <UiPopover.Close asChild>
                            <button
                              className={`nature-option${selected ? " selected" : ""}${plusKey === minusKey ? " neutral" : ""}`}
                              type="button"
                              aria-pressed={selected}
                              aria-label={`${option.label}: ${plusKey === minusKey ? "補正なし" : `${statLabels[plusKey]}上昇 ${statLabels[minusKey]}下降`}`}
                              onClick={() => onChange(option.label)}
                            >
                              {option.label}
                            </button>
                          </UiPopover.Close>
                        ) : (
                          <span className="nature-option empty" aria-hidden="true" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </UiPopover.Content>
        </UiPopover.Portal>
      </UiPopover.Root>
    </div>
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
          label="テラスタイプ"
          value={teraTypeInput}
          onChange={(event) => onTeraTypeInputChange(event.target.value)}
          onSelectValue={onTeraTypeInputChange}
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

type NumberStepperProps = {
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function NumberStepper({ className, label, value, min, max, disabled = false, onChange }: NumberStepperProps) {
  const normalizedValue = clampNumberInput(value, min, max);
  const updateValue = (nextValue: number) => onChange(clampNumberInput(nextValue, min, max));

  return (
    <span className={`number-stepper${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        aria-label={`${label}を1下げる`}
        disabled={disabled || normalizedValue <= min}
        onClick={() => updateValue(normalizedValue - 1)}
      >
        -
      </button>
      <input
        {...numericInputProps}
        value={normalizedValue}
        aria-label={label}
        disabled={disabled}
        onFocus={selectInputValueOnFocus}
        onChange={(event) => updateValue(toNumber(event.target.value, normalizedValue))}
      />
      <button
        type="button"
        aria-label={`${label}を1上げる`}
        disabled={disabled || normalizedValue >= max}
        onClick={() => updateValue(normalizedValue + 1)}
      >
        +
      </button>
    </span>
  );
}

type TargetPanelProps = {
  targetForm: TargetFormState;
  canonicalPokemon?: string;
  artwork: PokemonArtworkMatch | null;
  actualStats: StatTable | null;
  totalStatPoints: number;
  isBoxPanelOpen: boolean;
  onUpdateField: <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => void;
  onUpdateEv: (key: StatKey, value: number) => void;
  onOpenBoxPanel: () => void;
};

type BoxPanelProps = {
  entries: BoxEntry[];
  selectedEntryId: string | null;
  currentSummary: BoxEntrySummary;
  message: string | null;
  onClose: () => void;
  onSaveCurrent: () => void;
  onSelectEntry: (entryId: string) => void;
  onLoadEntry: (entryId: string) => void;
  onOverwriteEntry: (entryId: string) => void;
  onRenameEntry: (entryId: string, name: string) => void;
  onDuplicateEntry: (entryId: string) => void;
  onDeleteEntry: (entryId: string) => void;
};

function BoxSlotArtwork({ entry }: { entry: BoxEntry }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const artwork = findPokemonArtwork({ input: entry.summary.pokemonName });
  const canShowImage = artwork && failedSrc !== artwork.artworkUrl;
  const fallbackInitial = (entry.summary.pokemonName.trim() || "?").slice(0, 1);

  return (
    <span className="box-slot-art" aria-hidden="true">
      {canShowImage ? (
        <img
          src={artwork.artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(artwork.artworkUrl)}
        />
      ) : (
        <strong>{fallbackInitial}</strong>
      )}
    </span>
  );
}

function BoxPanel({
  entries,
  selectedEntryId,
  currentSummary,
  message,
  onClose,
  onSaveCurrent,
  onSelectEntry,
  onLoadEntry,
  onOverwriteEntry,
  onRenameEntry,
  onDuplicateEntry,
  onDeleteEntry,
}: BoxPanelProps) {
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const isBlankSlotSelected = selectedEntryId === BLANK_BOX_SLOT_ID;
  const hasSelectedSlot = isBlankSlotSelected || selectedEntry !== null;

  return (
    <div className="box-overlay">
      <div className="box-backdrop" aria-hidden="true" onClick={onClose} />
      <section className="box-window" role="dialog" aria-modal="true" aria-labelledby="box-title">
        <header className="box-window-header">
          <div>
            <h2 id="box-title">ボックス</h2>
            <span>ブラウザに保存</span>
          </div>
          <button className="box-close-button" type="button" onClick={onClose}>
            閉じる
          </button>
        </header>

        <div className="box-current-row" aria-label="編集中のシナリオ">
          <div>
            <span>編集中のシナリオ</span>
            <strong>{currentSummary.pokemonName}</strong>
          </div>
          <small>{currentSummary.conditionSummary}</small>
          <Button variant="primary" size="small" onClick={onSaveCurrent}>
            保存
          </Button>
        </div>

        <div className="box-grid" aria-label="保存済みボックス">
          <button
            className={`box-slot blank${isBlankSlotSelected ? " selected" : ""}`}
            type="button"
            aria-pressed={isBlankSlotSelected}
            onClick={() => onSelectEntry(BLANK_BOX_SLOT_ID)}
          >
            <span className="box-slot-art blank" aria-hidden="true">
              <strong>+</strong>
            </span>
            <strong>空スロット</strong>
            <span>リセット</span>
          </button>
          {entries.map((entry) => {
            const selected = entry.id === selectedEntry?.id;
            return (
              <button
                className={`box-slot${selected ? " selected" : ""}`}
                type="button"
                aria-pressed={selected}
                key={entry.id}
                onClick={() => onSelectEntry(entry.id)}
              >
                <BoxSlotArtwork entry={entry} />
                <strong>{entry.name}</strong>
                <span>{entry.summary.statPointSummary}</span>
              </button>
            );
          })}
        </div>

        {entries.length === 0 ? (
          <div className="box-empty-note" role="status">
            今のシナリオを保存するとここに表示されます
          </div>
        ) : null}

        <footer className="box-action-row">
          {hasSelectedSlot ? (
            <>
              <div className="box-selected-label">
                <span>選択中</span>
                {selectedEntry ? (
                  <input
                    className="box-name-input"
                    value={selectedEntry.name}
                    placeholder={selectedEntry.summary.pokemonName}
                    aria-label="保存名"
                    onChange={(event) => onRenameEntry(selectedEntry.id, event.target.value)}
                  />
                ) : (
                  <strong>空スロット</strong>
                )}
              </div>
              <div className="box-action-buttons">
                <Button variant="primary" size="small" onClick={() => onLoadEntry(selectedEntry?.id ?? BLANK_BOX_SLOT_ID)}>
                  読込
                </Button>
                {selectedEntry ? (
                  <>
                    <Button variant="ghost" size="small" onClick={() => onOverwriteEntry(selectedEntry.id)}>
                      上書き
                    </Button>
                    <Button variant="ghost" size="small" onClick={() => onDuplicateEntry(selectedEntry.id)}>
                      複製
                    </Button>
                    <Button variant="danger" size="small" onClick={() => onDeleteEntry(selectedEntry.id)}>
                      削除
                    </Button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <span className="box-action-placeholder">保存スロットを選んでください</span>
          )}
        </footer>

        {message ? <p className="box-message">{message}</p> : null}
      </section>
    </div>
  );
}

function TargetPanel({
  targetForm,
  canonicalPokemon,
  artwork,
  actualStats,
  totalStatPoints,
  isBoxPanelOpen,
  onUpdateField,
  onUpdateEv,
  onOpenBoxPanel,
}: TargetPanelProps) {
  const isSpLimitReached = totalStatPoints >= CHAMPIONS_TOTAL_STAT_POINTS;
  const abilityOptions = getPokemonAbilityInputOptions(
    canonicalPokemon ?? resolveCanonicalEntityName("pokemon", targetForm.pokemonInput),
  );

  return (
    <section className="target-panel" aria-labelledby="target-title">
      <div className="section-heading">
        <div>
          <h2 id="target-title">調整対象</h2>
        </div>
        <button
          className={`box-access-button${isBoxPanelOpen ? " active" : ""}`}
          type="button"
          aria-label={isBoxPanelOpen ? "ボックス機能を閉じる" : "ボックス機能を開く"}
          aria-expanded={isBoxPanelOpen}
          title="ボックス機能"
          onClick={onOpenBoxPanel}
        >
          <img src={getAssetSrc("assets/ui/pokebox.svg")} alt="" aria-hidden="true" />
        </button>
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
            onSelectValue={(value) => onUpdateField("pokemonInput", value)}
          />
          <NatureMatrixField
            label="性格"
            value={targetForm.natureInput}
            onChange={(value) => onUpdateField("natureInput", value)}
          />
          <EntityTextField
            kind="item"
            label="持ち物"
            value={targetForm.itemInput}
            onChange={(event) => onUpdateField("itemInput", event.target.value)}
            onSelectValue={(value) => onUpdateField("itemInput", value)}
          />
          <AbilityTextField
            label="特性"
            value={targetForm.abilityInput}
            pokemonAbilityOptions={abilityOptions}
            onChange={(event) => onUpdateField("abilityInput", event.target.value)}
            onSelectAbility={(value) => onUpdateField("abilityInput", value)}
          />
          <label className="placeholder-field">
            <input
              {...numericInputProps}
              value={targetForm.level}
              placeholder="Lv."
              onFocus={selectInputValueOnFocus}
              onChange={(event) => onUpdateField("level", clampNumberInput(toNumber(event.target.value, 50), 1, 100))}
            />
          </label>
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
          <span aria-hidden="true" />
          <span>実数値</span>
          <span>現在SP</span>
          <span>SP配分</span>
          <span>ランク</span>
        </div>
        {statKeys.map((key) => (
          <div className={`ev-row ${key}`} key={key}>
            <strong><StatIcon stat={key} /></strong>
            <NatureStatModifier natureLabel={targetForm.natureInput} stat={key} />
            <span className="actual-stat">{actualStats?.[key] ?? "-"}</span>
            <input
              {...numericInputProps}
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
            {key === "hp" ? (
              <span className="target-rank-placeholder" aria-hidden="true" />
            ) : (
              <SelectField
                compact
                placeholderLabel
                placeholderValue=""
                className="target-rank-field"
                label={`${statLabels[key]}ランク`}
                value={String(targetForm.boosts[key] ?? 0)}
                options={rankSelectOptions}
                onChange={(value) => onUpdateField("boosts", {
                  ...targetForm.boosts,
                  [key]: toNumber(value, 0),
                })}
              />
            )}
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
    </div>
  );
}

type ScenarioPanelProps = {
  scenarios: ScenarioFormState[];
  attackerActualStats: Record<string, StatTable>;
  targetForm: TargetFormState;
  targetActualStats: StatTable | null;
  onAddScenario: () => void;
  onRemoveScenario: (id: string) => void;
  onToggleScenarioAdjustmentFromDirection: (id: string) => void;
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
  attackerActualStats,
  targetForm,
  targetActualStats,
  onAddScenario,
  onRemoveScenario,
  onToggleScenarioAdjustmentFromDirection,
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
        </div>
      </div>

      <div className="scenario-stack" aria-label="仮想敵シナリオ行">
        {scenarios.map((scenario) => (
          <ScenarioRow
            key={scenario.id}
            scenario={scenario}
            attackerActualStats={attackerActualStats}
            targetForm={targetForm}
            targetActualStats={targetActualStats}
            onAddAttack={onAddAttack}
            onRemoveAttack={onRemoveAttack}
            onRemoveScenario={onRemoveScenario}
            onToggleScenarioAdjustmentFromDirection={onToggleScenarioAdjustmentFromDirection}
            onUpdateScenario={onUpdateScenario}
            onUpdateAttack={onUpdateAttack}
            onUpdateAttackerEv={onUpdateAttackerEv}
          />
        ))}
        <button className="scenario-add-row ui-button" type="button" onClick={onAddScenario}>
          シナリオを追加
        </button>
      </div>
    </section>
  );
}

type ScenarioRowProps = {
  scenario: ScenarioFormState;
  attackerActualStats: Record<string, StatTable>;
  targetForm: TargetFormState;
  targetActualStats: StatTable | null;
  onAddAttack: (scenarioId: string) => void;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onRemoveScenario: (id: string) => void;
  onToggleScenarioAdjustmentFromDirection: (id: string) => void;
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

const scenarioAdjustmentTypeOptions: Array<{ value: ScenarioAdjustmentType; label: string }> = [
  { value: "defence", label: "耐久調整" },
  { value: "offense", label: "火力調整" },
  { value: "speed", label: "素早さ調整" },
];

type ScenarioAdjustmentTypeCardsProps = {
  scenario: ScenarioFormState;
  onChange: (value: ScenarioAdjustmentType) => void;
};

function ScenarioAdjustmentTypeCards({ scenario, onChange }: ScenarioAdjustmentTypeCardsProps) {
  return (
    <div className="scenario-adjustment-cards" role="radiogroup" aria-label={`${scenario.label} 調整種別`}>
      {scenarioAdjustmentTypeOptions.map((option) => (
        <label
          className={`scenario-adjustment-card${scenario.adjustmentType === option.value ? " selected" : ""}`}
          key={option.value}
        >
          <input
            type="radio"
            name={`${scenario.id}-adjustment-type`}
            value={option.value}
            checked={scenario.adjustmentType === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

const nextScenarioAdjustmentType = (value: ScenarioAdjustmentType): ScenarioAdjustmentType => {
  switch (value) {
    case "defence":
      return "offense";
    case "offense":
      return "speed";
    case "speed":
    default:
      return "defence";
  }
};

const getScenarioAdjustmentTypeLabel = (value: ScenarioAdjustmentType): string =>
  scenarioAdjustmentTypeOptions.find((option) => option.value === value)?.label ?? value;

function ScenarioRow({
  scenario,
  attackerActualStats,
  targetForm,
  targetActualStats,
  onAddAttack,
  onRemoveAttack,
  onRemoveScenario,
  onToggleScenarioAdjustmentFromDirection,
  onUpdateScenario,
  onUpdateAttack,
  onUpdateAttackerEv,
}: ScenarioRowProps) {
  const isTrickRoomSpeedScenario = scenario.adjustmentType === "speed"
    && scenario.attacks.some((attack) => attack.speedMoveModifier === "trick-room");

  return (
    <article
      className={`scenario-row ${scenario.adjustmentType}${isTrickRoomSpeedScenario ? " trick-room" : ""}${scenario.enabled ? "" : " disabled"}`}
      aria-label={scenario.label}
    >
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
        <div className="scenario-row-actions">
          <ScenarioAdjustmentTypeCards
            scenario={scenario}
            onChange={(value) => onUpdateScenario(scenario.id, "adjustmentType", value)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="icon-button scenario-remove-button"
            aria-label={`${scenario.label}を削除`}
            title={`${scenario.label}を削除`}
            onClick={() => onRemoveScenario(scenario.id)}
          >
            <img className="ui-button-icon" src={getAssetSrc("assets/ui/trash.svg")} alt="" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="scenario-attack-lane">
        {scenario.attacks.map((attack, attackIndex) => (
          <AttackCard
            key={attack.id}
            attack={attack}
            attackIndex={attackIndex}
            scenarioId={scenario.id}
            adjustmentType={scenario.adjustmentType}
            actualStats={attackerActualStats[`${scenario.id}-${attack.id}-attacker`]}
            targetForm={targetForm}
            targetActualStats={targetActualStats}
            supportsDoublesAttack={scenario.attacks.some((otherAttack) => (
              otherAttack.id !== attack.id &&
              Boolean(otherAttack.moveInput.trim()) &&
              otherAttack.gameType === "doubles"
            ))}
            canRemove={scenario.attacks.length > 1}
            onRemoveAttack={onRemoveAttack}
            onToggleAdjustmentType={() => onToggleScenarioAdjustmentFromDirection(scenario.id)}
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
  adjustmentType: ScenarioAdjustmentType;
  actualStats?: StatTable;
  targetForm: TargetFormState;
  targetActualStats: StatTable | null;
  supportsDoublesAttack: boolean;
  canRemove: boolean;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onToggleAdjustmentType: () => void;
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
  adjustmentType,
  actualStats,
  targetForm,
  targetActualStats,
  supportsDoublesAttack,
  canRemove,
  onRemoveAttack,
  onToggleAdjustmentType,
  onUpdateAttack,
  onUpdateAttackerEv,
}: AttackCardProps) {
  const onInput = <K extends keyof ScenarioAttackFormState>(key: K) => (
    event: ChangeEvent<HTMLInputElement>,
  ) => onUpdateAttack(scenarioId, attack.id, key, event.target.value as ScenarioAttackFormState[K]);
  const isOffenseAdjustment = adjustmentType === "offense";
  const isSpeedAdjustment = adjustmentType === "speed";
  const isManualSpeedTarget = attack.speedTargetMode === "manual";
  const isTrickRoomSpeed = attack.speedMoveModifier === "trick-room";
  const speedPrimaryConditionLabel = isTrickRoomSpeed ? "確定トリル先制" : "確定抜き";
  const attackLabel = formatScenarioAttackLabel(adjustmentType, attackIndex, attack.label);
  const adjustmentDirection = isOffenseAdjustment ? "right" : isSpeedAdjustment ? "speed" : "left";
  const nextAdjustmentLabel = getScenarioAdjustmentTypeLabel(nextScenarioAdjustmentType(adjustmentType));
  const currentAdjustmentLabel = getScenarioAdjustmentTypeLabel(adjustmentType);
  const isAbilitySupport = Boolean(
    !isOffenseAdjustment && !isSpeedAdjustment && !attack.moveInput.trim() && attack.attackerAbilityInput.trim(),
  );
  const attackerArtwork = findPokemonArtwork({ input: attack.attackerPokemonInput });
  const attackerCanonicalPokemon = resolveCanonicalEntityName("pokemon", attack.attackerPokemonInput);
  const attackerAbilityOptions = getPokemonAbilityInputOptions(
    attackerCanonicalPokemon,
  );
  const statReferencePlan = getMoveStatReferencePlan(attack.moveInput, {
    teraEnabled: isOffenseAdjustment ? targetForm.teraEnabled : attack.attackerTeraEnabled,
  });
  const targetReferenceKeySet = new Set(statReferencePlan.references
    .filter((reference) => reference.owner === "target")
    .map((reference) => reference.stat));
  const targetReferenceKeys = Array.from(targetReferenceKeySet);
  const moveStatReferenceOptions = {
    teraEnabled: isOffenseAdjustment ? targetForm.teraEnabled : attack.attackerTeraEnabled,
  };
  const offenseDefenderStatKeys = getOffenseDefenderStatKeysFromMoveContext(
    attack.moveInput,
    moveStatReferenceOptions,
    targetReferenceKeySet,
  );
  const defenderRankKeys = Array.from(new Set<Exclude<StatKey, "hp">>([
    "def",
    "spd",
    ...targetReferenceKeys.filter((key): key is Exclude<StatKey, "hp"> => key !== "hp"),
  ]));
  const speedOpponentStatSection = (
    <section className="attack-stat-section attack-setting-section-body speed-opponent-stat-section" aria-label={`${attackLabel} 相手S能力`}>
      <div className="ev-table attacker-stat-table speed-stat-table" aria-label={`${attackLabel} 相手S能力`}>
        <div className="ev-header attacker-stat-header">
          <span>能力</span>
          <span>実数値</span>
          <span>SP</span>
          <span>ランク</span>
        </div>
        <div className="ev-row attacker-stat-row spe">
          <strong>
            <StatIcon stat="spe" />
            <span>相手</span>
          </strong>
          <span className="actual-stat-with-modifier">
            <NatureStatModifier natureLabel={attack.attackerNatureInput} stat="spe" />
            <span className="actual-stat">{actualStats?.spe ?? "-"}</span>
          </span>
          <input
            {...numericInputProps}
            value={attack.attackerStatPoints.spe}
            aria-label={`${attackLabel} 相手S SP`}
            placeholder="S SP"
            title="0-32SP。252などEV値を入れた場合は対応するSPへ変換します。"
            onFocus={selectInputValueOnFocus}
            onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, "spe", toStatPointInput(event.target.value))}
          />
          <SelectField
            compact
            placeholderLabel
            placeholderValue=""
            className="target-rank-field"
            label={`${attackLabel} 相手Sランク`}
            value={String(attack.attackerBoosts.spe ?? 0)}
            options={rankSelectOptions}
            onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerBoosts", {
              ...attack.attackerBoosts,
              spe: toNumber(value, 0),
            })}
          />
        </div>
      </div>
    </section>
  );
  return (
    <section className="attack-condition-card" aria-label={attackLabel}>
      <div className="attack-card-header">
        <button
          className={`attack-direction-button ${adjustmentDirection}`}
          type="button"
          aria-label={`${attackLabel} ${currentAdjustmentLabel}。クリックで${nextAdjustmentLabel}に切り替え`}
          title={`${currentAdjustmentLabel} / ${nextAdjustmentLabel}に切り替え`}
          onClick={onToggleAdjustmentType}
        >
          <img
            src={getAssetSrc(isSpeedAdjustment
              ? isTrickRoomSpeed
                ? "assets/ui/arrow-down-circle.svg"
                : "assets/ui/arrow-up-circle.svg"
              : isOffenseAdjustment
                ? "assets/ui/arrow-right-circle.svg"
                : "assets/ui/arrow-left-circle.svg")}
            alt=""
            aria-hidden="true"
          />
        </button>
        <PokemonArtworkFrame
          match={attackerArtwork}
          fallbackLabel={attack.attackerPokemonInput}
          variant="attack"
          dynamaxEffect={attack.attackerDmaxEnabled || isPokemonFormVariant(attack.attackerPokemonInput, "gmax")}
        />
        <input
          className="inline-title-input"
          value={attackLabel}
          aria-label="攻撃名"
          onChange={onInput("label")}
        />
        <Button
          variant="ghost"
          size="icon"
          className="icon-button attack-remove-button"
          aria-label={`${attackLabel}を削除`}
          title={`${attackLabel}を削除`}
          disabled={!canRemove}
          onClick={() => onRemoveAttack(scenarioId, attack.id)}
        >
          <img className="ui-button-icon" src={getAssetSrc("assets/ui/trash.svg")} alt="" aria-hidden="true" />
        </Button>
      </div>

      <div className={`attack-card-fields${isAbilitySupport ? " support-mode" : ""}`}>
        <ScenarioTextField
          kind="pokemon"
          label={isOffenseAdjustment || isSpeedAdjustment ? "仮想敵" : "ポケモン"}
          showLabel
          value={attack.attackerPokemonInput}
          onChange={onInput("attackerPokemonInput")}
          onSelectValue={(value) => onUpdateAttack(scenarioId, attack.id, "attackerPokemonInput", value)}
        />
        {!isSpeedAdjustment ? (
          <ScenarioTextField
            kind="move"
            label="技"
            showLabel
            value={attack.moveInput}
            onChange={onInput("moveInput")}
            onSelectValue={(value) => onUpdateAttack(scenarioId, attack.id, "moveInput", value)}
          />
        ) : null}
        {!isAbilitySupport ? (
          <NatureMatrixField
            className="scenario-cell"
            label="性格"
            value={attack.attackerNatureInput}
            onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerNatureInput", value)}
          />
        ) : null}
        {!isAbilitySupport ? (
          <ScenarioTextField
            kind="item"
            label="持ち物"
            showLabel
            value={attack.attackerItemInput}
            placeholder="任意"
            onChange={onInput("attackerItemInput")}
            onSelectValue={(value) => onUpdateAttack(scenarioId, attack.id, "attackerItemInput", value)}
          />
        ) : null}
        <AbilityTextField
          className="scenario-cell"
          label="特性"
          value={attack.attackerAbilityInput}
          pokemonAbilityOptions={attackerAbilityOptions}
          onChange={onInput("attackerAbilityInput")}
          onSelectAbility={(value) => onUpdateAttack(scenarioId, attack.id, "attackerAbilityInput", value)}
        />
        {!isAbilitySupport ? (
          <>
            <ScenarioNumberField
              label="レベル"
              showLabel
              value={attack.attackerLevel}
              min={1}
              max={100}
              onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerLevel", value)}
            />
            <MechanicControls
              pokemonInput={attack.attackerPokemonInput}
              teraEnabled={attack.attackerTeraEnabled}
              dmaxEnabled={attack.attackerDmaxEnabled}
              teraTypeInput={attack.attackerTeraTypeInput}
              teraLabel={
                isOffenseAdjustment
                  ? attack.attackerTeraEnabled ? "仮想敵テラス解除" : "仮想敵テラス"
                  : attack.attackerTeraEnabled ? "攻撃テラス解除" : "攻撃テラス"
              }
              onPokemonInputChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerPokemonInput", value)}
              onTeraEnabledChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerTeraEnabled", value)}
              onDmaxEnabledChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerDmaxEnabled", value)}
              onTeraTypeInputChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerTeraTypeInput", value)}
            />
          </>
        ) : null}
      </div>

      {isAbilitySupport ? (
        <div className={`attack-support-note${supportsDoublesAttack ? "" : " inactive"}`} role="status">
          <strong>{supportsDoublesAttack ? "特性サポート有効" : "特性サポート待機中"}</strong>
          <span>
            {supportsDoublesAttack
              ? "同じ行のダブル攻撃へ、影響する特性を自動反映します"
              : "同じ行の攻撃ルールをダブルにすると、この特性が反映されます"}
          </span>
        </div>
      ) : isSpeedAdjustment ? (
        <>
          <section className="attack-setting-section attack-setting-section--indented" aria-labelledby={`${scenarioId}-${attack.id}-speed-title`}>
            <h3 id={`${scenarioId}-${attack.id}-speed-title`}>素早さ条件</h3>
            {!isManualSpeedTarget ? speedOpponentStatSection : null}
            <div className={`speed-condition-grid attack-setting-section-body${isManualSpeedTarget ? " manual" : ""}`}>
              <div className="speed-target-mode" role="radiogroup" aria-label={`${attackLabel} 素早さ条件`}>
                <div className="speed-target-mode-option">
                  <label className="speed-target-radio-label">
                    <input
                      type="radio"
                      name={`${scenarioId}-${attack.id}-speed-target-mode`}
                      checked={attack.speedTargetMode === "opponent"}
                      onChange={() => onUpdateAttack(scenarioId, attack.id, "speedTargetMode", "opponent")}
                    />
                    <span>{speedPrimaryConditionLabel}</span>
                    <strong>{actualStats?.spe ?? "-"}</strong>
                    <span>{isTrickRoomSpeed ? "-" : "+"}</span>
                  </label>
                  <NumberStepper
                    className="speed-offset-input"
                    value={attack.speedRequiredOffset}
                    label={`${attackLabel} ${speedPrimaryConditionLabel}差分値`}
                    min={0}
                    max={10000}
                    disabled={isManualSpeedTarget}
                    onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedRequiredOffset", value)}
                  />
                </div>
                <label className="speed-target-mode-option">
                  <input
                    type="radio"
                    name={`${scenarioId}-${attack.id}-speed-target-mode`}
                    checked={attack.speedTargetMode === "manual"}
                    onChange={() => onUpdateAttack(scenarioId, attack.id, "speedTargetMode", "manual")}
                  />
                  <span>任意S値</span>
                </label>
              </div>
              <ScenarioNumberField
                className="speed-manual-target-input"
                label="任意S値"
                showLabel={false}
                value={attack.speedTargetValue}
                min={0}
                max={10000}
                onFocus={() => onUpdateAttack(scenarioId, attack.id, "speedTargetMode", "manual")}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedTargetValue", value)}
              />
            </div>
          </section>

          {!isManualSpeedTarget ? (
            <section
              className="attack-setting-section attack-setting-section--indented"
              aria-labelledby={`${scenarioId}-${attack.id}-speed-environment-title`}
            >
              <h3 id={`${scenarioId}-${attack.id}-speed-environment-title`}>相手S条件</h3>
              <div className="attack-field-grid speed-field-grid attack-setting-section-body">
                <SelectField
                  label="状態"
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
                <SelectField
                  label="道具倍率"
                  value={attack.speedItemMultiplier}
                  options={speedMultiplierOptions}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedItemMultiplier", value)}
                />
                <SelectField
                  label="特性倍率"
                  value={attack.speedAbilityMultiplier}
                  options={speedMultiplierOptions}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedAbilityMultiplier", value)}
                />
                <SelectField
                  label="技補正"
                  value={attack.speedMoveModifier}
                  options={[...speedMoveModifierOptions]}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedMoveModifier", value)}
                />
              </div>
          </section>
          ) : null}
        </>
      ) : isOffenseAdjustment ? (
        <>
          <section className="attack-setting-section attack-setting-section--indented" aria-labelledby={`${scenarioId}-${attack.id}-ko-title`}>
            <h3 id={`${scenarioId}-${attack.id}-ko-title`}>火力条件</h3>
            <div className="attack-number-grid attack-setting-section-body">
              <ScenarioNumberField
                label="KO率"
                showLabel
                value={attack.targetKoProbabilityPercent}
                min={0}
                max={100}
                suffix="%"
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "targetKoProbabilityPercent", value)}
              />
            </div>
          </section>

          <section
            className="attack-setting-section attack-setting-section--indented"
            aria-labelledby={`${scenarioId}-${attack.id}-environment-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-environment-title`}>状況条件</h3>
            <div className="attack-field-grid attack-setting-section-body">
              <SelectField
                label="ルール"
                value={attack.gameType}
                options={gameTypeOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "gameType", value)}
              />
              <SelectField
                label="仮想敵状態"
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

            <section className="attack-stat-section attack-setting-section-body" aria-label={`${attackLabel} 仮想敵能力`}>
              <div className="ev-table attacker-stat-table offense-defender-stat-table" aria-label={`${attackLabel} 仮想敵能力`}>
                <div className="ev-header attacker-stat-header">
                  <span>能力</span>
                  <span>実数値</span>
                  <span>SP</span>
                  <span>ランク</span>
                </div>
                {offenseDefenderStatKeys.map((key) => (
                  <div
                    className={`ev-row attacker-stat-row ${key}`}
                    key={key}
                  >
                    <strong>
                      <StatIcon stat={key} />
                      <span>仮想敵</span>
                    </strong>
                    <span className="actual-stat-with-modifier">
                      <NatureStatModifier natureLabel={attack.attackerNatureInput} stat={key} />
                      <span className="actual-stat">{actualStats?.[key] ?? "-"}</span>
                    </span>
                    <input
                      {...numericInputProps}
                      value={attack.attackerStatPoints[key]}
                      aria-label={`${attackLabel} 仮想敵${statLabels[key]} SP`}
                      placeholder={`${statLabels[key]} SP`}
                      title="0-32SP。252などEV値を入れた場合は対応するSPへ変換します。"
                      onFocus={selectInputValueOnFocus}
                      onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, key, toStatPointInput(event.target.value))}
                    />
                    {key !== "hp" ? (
                      <SelectField
                        compact
                        placeholderLabel
                        placeholderValue=""
                        className="target-rank-field"
                        label={`${attackLabel} 仮想敵${statLabels[key]}ランク`}
                        value={String(attack.attackerBoosts[key] ?? 0)}
                        options={rankSelectOptions}
                        onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerBoosts", {
                          ...attack.attackerBoosts,
                          [key]: toNumber(value, 0),
                        })}
                      />
                    ) : (
                      <span className="attacker-stat-role">仮想敵</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </section>

          <div className="scenario-options">
            <label><input type="checkbox" checked={attack.critical} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "critical", event.target.checked)} /> 急所</label>
            <label><input type="checkbox" checked={attack.reflect} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "reflect", event.target.checked)} /> リフレクター</label>
            <label><input type="checkbox" checked={attack.lightScreen} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "lightScreen", event.target.checked)} /> ひかりのかべ</label>
            <label><input type="checkbox" checked={attack.auroraVeil} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "auroraVeil", event.target.checked)} /> オーロラベール</label>
            <label><input type="checkbox" checked={attack.helpingHand} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "helpingHand", event.target.checked)} /> てだすけ</label>
            <label><input type="checkbox" checked={attack.friendGuard} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "friendGuard", event.target.checked)} /> フレンドガード</label>
          </div>
        </>
      ) : (
        <>
          <section className="attack-setting-section attack-setting-section--indented" aria-labelledby={`${scenarioId}-${attack.id}-survival-title`}>
            <h3 id={`${scenarioId}-${attack.id}-survival-title`}>耐久条件</h3>
            <div className="attack-number-grid attack-setting-section-body">
              <ScenarioNumberField
                label="攻撃回数"
                showLabel
                value={attack.repeat}
                min={1}
                max={10}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "repeat", value)}
              />
              <ScenarioNumberField
                label="耐久回数"
                showLabel
                value={attack.requiredSurvivedHits}
                min={1}
                max={10}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "requiredSurvivedHits", value)}
              />
              <ScenarioNumberField
                label="耐久確立"
                showLabel
                value={attack.minSurvivalProbabilityPercent}
                min={0}
                max={100}
                suffix="%"
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "minSurvivalProbabilityPercent", value)}
              />
            </div>
          </section>

          <section
            className="attack-setting-section attack-setting-section--indented"
            aria-labelledby={`${scenarioId}-${attack.id}-environment-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-environment-title`}>状況条件</h3>
            <div className="attack-field-grid attack-setting-section-body">
              <SelectField
                label="ルール"
                value={attack.gameType}
                options={gameTypeOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "gameType", value)}
              />
              <SelectField
                label="状態異常"
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

            <section className="attack-stat-section attack-setting-section-body" aria-label={`${attackLabel} 能力`}>
              <div className="ev-table attacker-stat-table" aria-label={`${attackLabel} 参照能力`}>
                <div className="ev-header attacker-stat-header">
                  <span>能力</span>
                  <span>実数値</span>
                  <span>SP</span>
                  <span>ランク</span>
                </div>
                {statReferencePlan.references.map((reference) => {
                  const key = reference.stat;
                  const isAttacker = reference.owner === "attacker";
                  const sourceLabel = isAttacker ? "仮想敵" : "調整対象";
                  const statPoints = isAttacker ? attack.attackerStatPoints : targetForm.statPoints;
                  const stats = isAttacker ? actualStats : targetActualStats;
                  const nature = isAttacker ? attack.attackerNatureInput : targetForm.natureInput;

                  return (
                    <div
                      className={`ev-row attacker-stat-row ${key}${isAttacker ? "" : " target-reference"}`}
                      key={`${reference.owner}-${key}-${reference.role}`}
                    >
                      <strong>
                        <StatIcon stat={key} />
                        <span>{sourceLabel}</span>
                      </strong>
                      <span className="actual-stat-with-modifier">
                        <NatureStatModifier natureLabel={nature} stat={key} />
                        <span className="actual-stat">{stats?.[key] ?? "-"}</span>
                      </span>
                      {isAttacker ? (
                        <input
                          {...numericInputProps}
                          value={statPoints[key]}
                          aria-label={`${attackLabel} ${statLabels[key]} SP`}
                          placeholder={`${statLabels[key]} SP`}
                          title="0-32SP。252などEV値を入れた場合は対応するSPへ変換します。"
                          onFocus={selectInputValueOnFocus}
                          onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, key, toStatPointInput(event.target.value))}
                        />
                      ) : (
                        <span className="attacker-reference-sp">{statPoints[key]}</span>
                      )}
                      {isAttacker && key !== "hp" ? (
                        <SelectField
                          compact
                          placeholderLabel
                          placeholderValue=""
                          className="target-rank-field"
                          label={`${attackLabel} ${statLabels[key]}ランク`}
                          value={String(attack.attackerBoosts[key] ?? 0)}
                          options={rankSelectOptions}
                          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerBoosts", {
                            ...attack.attackerBoosts,
                            [key]: toNumber(value, 0),
                          })}
                        />
                      ) : (
                        <span className="attacker-stat-role">
                          {reference.role === "power" ? "威力参照" : sourceLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </section>

          <div className="scenario-options">
            <label><input type="checkbox" checked={attack.critical} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "critical", event.target.checked)} /> 急所</label>
            <label><input type="checkbox" checked={attack.reflect} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "reflect", event.target.checked)} /> リフレクター</label>
            <label><input type="checkbox" checked={attack.lightScreen} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "lightScreen", event.target.checked)} /> ひかりのかべ</label>
            <label><input type="checkbox" checked={attack.auroraVeil} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "auroraVeil", event.target.checked)} /> オーロラベール</label>
            <label><input type="checkbox" checked={attack.helpingHand} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "helpingHand", event.target.checked)} /> てだすけ</label>
            <label><input type="checkbox" checked={attack.friendGuard} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "friendGuard", event.target.checked)} /> フレンドガード</label>
          </div>

          <section
            className="attack-setting-section attack-setting-section--indented attack-setting-section--target-condition"
            aria-labelledby={`${scenarioId}-${attack.id}-target-condition-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-target-condition-title`}>調整対象条件</h3>
            <div className="attack-target-condition-body">
              <div className="scenario-defender-status">
                <span>状態異常</span>
                <SelectField
                  compact
                  label={`${attackLabel} 調整対象の状態異常`}
                  value={attack.defenderStatus}
                  options={statusOptions}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "defenderStatus", value)}
                />
              </div>
              <div className="scenario-defender-ranks" aria-label={`${attackLabel} 調整対象条件`}>
                <span className="scenario-defender-rank-label">ランク</span>
                {defenderRankKeys.map((key) => (
                  <div className="scenario-defender-rank" key={key}>
                    <StatIcon stat={key} />
                    <SelectField
                      compact
                      placeholderLabel
                      placeholderValue=""
                      className="target-rank-field"
                      label={`${attackLabel} 調整対象${statLabels[key]}ランク`}
                      value={String(attack.defenderBoosts[key] ?? 0)}
                      options={rankSelectOptions}
                      onChange={(value) => onUpdateAttack(scenarioId, attack.id, "defenderBoosts", {
                        ...attack.defenderBoosts,
                        [key]: toNumber(value, 0),
                      })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </section>
  );
}

type ScenarioTextFieldProps = {
  kind?: EntityKind;
  label: string;
  showLabel: boolean;
  value: string;
  placeholder?: string;
  options?: EntityInputOption[];
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue?: (value: string) => void;
};

function ScenarioTextField({
  kind,
  label,
  showLabel,
  value,
  placeholder,
  options: suggestedOptions,
  onChange,
  onSelectValue,
}: ScenarioTextFieldProps) {
  const datalistId = `entity-options-${kind ?? "text"}-${useId()}`;

  if (kind === "pokemon" && onSelectValue) {
    return (
      <PokemonAutocompleteField
        className="scenario-cell"
        label={label}
        value={value}
        invalid={isUnresolvedEntityInput("pokemon", value)}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  if ((kind === "item" || kind === "move") && onSelectValue) {
    return (
      <DropdownTextField
        kind={kind}
        className="scenario-cell"
        label={label}
        value={value}
        options={suggestedOptions ?? getMatchingEntityInputOptions(kind, value)}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  const options = kind ? suggestedOptions ?? getMatchingEntityInputOptions(kind, value) : [];

  return (
    <label className={`scenario-cell placeholder-field${kind && isUnresolvedEntityInput(kind, value) ? " is-invalid" : ""}`}>
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
  className?: string;
  label: string;
  showLabel: boolean;
  value: number;
  min: number;
  max: number;
  onFocus?: () => void;
  onChange: (value: number) => void;
  suffix?: string;
};

function ScenarioNumberField({
  className,
  label,
  showLabel,
  value,
  min,
  max,
  onFocus,
  onChange,
  suffix,
}: ScenarioNumberFieldProps) {
  const ariaLabel = suffix ? `${label} ${suffix}` : label;

  return (
    <label className={`scenario-cell number-cell number-labeled-field${suffix ? " has-suffix" : ""}${className ? ` ${className}` : ""}`}>
      {showLabel ? <span className="row-label">{label}</span> : null}
      <span className="number-input-wrap">
        <input
          {...numericInputProps}
          value={value}
          aria-label={ariaLabel}
          onFocus={(event) => {
            selectInputValueOnFocus(event);
            onFocus?.();
          }}
          onChange={(event) => onChange(clampNumberInput(toNumber(event.target.value, min), min, max))}
        />
        {suffix ? <span className="number-input-suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}

type ResultsPanelProps = {
  candidates: CandidateResult[];
  selectedCandidateId: string | null;
  appliedCandidateId: string | null;
  scenarios: ScenarioFormState[];
  status: string;
  offenseResults: OffenseScenarioResult[];
  speedResults: SpeedScenarioResult[];
  strictestFailureLabel: string | null;
  targetLabel: string;
  resultAlertMessage: string | null;
  onSelectCandidate: (id: string) => void;
  onApplyCandidate: (candidate: CandidateResult) => void;
};

const getOffenseResultTone = (result: OffenseScenarioResult["result"]): "green" | "red" | "blue" | "purple" => {
  if (result.status === "unresolved" || result.status === "invalid") {
    return "purple";
  }
  if (result.status === "fixed") {
    return result.passed ? "blue" : "red";
  }
  return result.passed ? "green" : "red";
};

const formatResultAlertStrictestCondition = (message: string): string => {
  const integrationPrefixes = [
    "火力調整条件を候補一覧へ統合できません: ",
    "素早さ調整条件を候補一覧へ統合できません: ",
  ];
  const matchedPrefix = integrationPrefixes.find((prefix) => message.startsWith(prefix));
  return matchedPrefix ? message.slice(matchedPrefix.length) : message;
};

const formatOffenseCandidateDetail = (
  entry: OffenseScenarioResult,
  targetLabel: string,
  scenario: ScenarioFormState | undefined,
): string => {
  const attacker = scenario?.attacks.find((attack) => attack.id === entry.attackId);
  const defenderLabel = attacker?.attackerPokemonInput.trim() || entry.attackLabel;
  const moveLabel = attacker?.moveInput.trim() || "技";
  const statPointLabel = entry.result.stat
    ? `${statLabels[entry.result.stat]}${entry.result.requiredStatPoints ?? "-"}`
    : entry.result.label;
  const sourceLabel = [statPointLabel, targetLabel.trim() || "調整対象", moveLabel].join(" ");
  const damageLabel = entry.result.damageRange
    ? `${formatDamageRange(entry.result.damageRange.min, entry.result.damageRange.max)} `
      + `(${entry.result.damageRange.percentMin.toFixed(1)}-${entry.result.damageRange.percentMax.toFixed(1)}%)`
    : entry.result.reason;

  return `${sourceLabel} → ${defenderLabel} : ${damageLabel} / KO率 ${formatPercent(entry.result.koProbability)}`;
};

const getSpeedResultTone = (result: SpeedAdjustmentResult): "green" | "red" | "blue" | "purple" => {
  if (result.status === "unresolved" || result.status === "invalid") {
    return "purple";
  }
  if (result.status === "tie") {
    return "blue";
  }
  return result.passed ? "green" : "red";
};

const formatSpeedRelationLabel = (result: Pick<SpeedAdjustmentResult, "orderMode" | "relation">): string => {
  switch (result.relation) {
    case "outspeed":
      return result.orderMode === "trick-room" ? "先制できる" : "抜ける";
    case "tie":
      return "同速";
    case "miss":
    default:
      return "届かない";
  }
};

const formatSpeedResultDetail = (
  entry: SpeedScenarioResult,
  targetLabel: string,
  scenario: ScenarioFormState | undefined,
): string => {
  const attack = scenario?.attacks.find((currentAttack) => currentAttack.id === entry.attackId);
  const opponentLabel = attack?.speedTargetMode === "manual" && attack.speedTargetValue > 0
    ? `任意S${attack.speedTargetValue}`
    : attack?.attackerPokemonInput.trim() || entry.attackLabel;
  const requiredStatPointLabel = entry.result.requiredStatPoints === null
    ? "S-"
    : `S${entry.result.requiredStatPoints}`;
  const actualSpeedLabel = entry.result.actualSpeed === null ? "-" : String(entry.result.actualSpeed);
  const noteLabel = entry.result.notes.length > 0 ? ` / ${entry.result.notes.join(" / ")}` : "";

  return `${requiredStatPointLabel} ${targetLabel.trim() || "調整対象"} → ${opponentLabel} : `
    + `自分 ${actualSpeedLabel} / 相手 ${entry.result.targetSpeed} / ${formatSpeedRelationLabel(entry.result)}${noteLabel}`;
};

export function ResultsPanel({
  candidates,
  selectedCandidateId,
  appliedCandidateId,
  scenarios,
  status,
  offenseResults,
  speedResults,
  strictestFailureLabel,
  targetLabel,
  resultAlertMessage,
  onSelectCandidate,
  onApplyCandidate,
}: ResultsPanelProps) {
  const scenarioLabels = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario.label])),
    [scenarios],
  );
  const scenariosById = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios],
  );

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
          <span>順位</span><span>H/A/B/C/D/S</span><span /><span>使用SP</span><span>残りSP</span><span>最厳条件</span><span /><span />
        </div>
        {resultAlertMessage ? (
          <div className="empty-result impossible-result result-alert" role="alert">
            <strong>FAIL</strong>
            <span>すべてのシナリオを満たす候補を作れません。</span>
            <small>最厳条件: {formatResultAlertStrictestCondition(resultAlertMessage)}</small>
          </div>
        ) : null}
        {candidates.length === 0 ? (
          resultAlertMessage ? null : <div className={`empty-result${status === "complete" ? " impossible-result" : ""}`}>
            {status === "complete" ? (
              <>
                <strong>FAIL</strong>
                <span>すべてのシナリオを満たす候補が見つかりません</span>
                {strictestFailureLabel ? <small>最厳条件: {strictestFailureLabel}</small> : null}
              </>
            ) : (
              "計算結果"
            )}
          </div>
        ) : candidates.map((candidate) => {
          const expanded = selectedCandidateId === candidate.id;
          return (
            <Collapsible.Root
              className={`candidate-entry${expanded ? " selected" : ""}`}
              open={expanded}
              onOpenChange={(open) => {
                if (open !== expanded) {
                  onSelectCandidate(candidate.id);
                }
              }}
              role="rowgroup"
              key={candidate.id}
            >
              <div className="candidate-row" role="row">
                <Collapsible.Trigger asChild>
                  <button className="candidate-row-toggle" type="button">
                    <span className={`rank${candidate.rank === 1 ? " crown" : ""}`}>{candidate.rank}</span>
                    <CandidateStatPointSpread statPoints={candidate.appliedStatPoints} />
                    <span className="candidate-row-spacer" aria-hidden="true" />
                    <span>{candidate.usedStatPointBudget}</span>
                    <span>{candidate.remainingStatPointBudget}</span>
                    <span>{candidate.bottleneckLabel}</span>
                    <span className="candidate-disclosure" aria-hidden="true">
                      <ChevronRightIcon className="disclosure-chevron" />
                    </span>
                  </button>
                </Collapsible.Trigger>
                <Button
                  variant="primary"
                  size="small"
                  className="candidate-apply-button"
                  onClick={() => onApplyCandidate(candidate)}
                >
                  {appliedCandidateId === candidate.id ? "適用済み" : "適用"}
                </Button>
              </div>
              <Collapsible.Content asChild>
                <div className="candidate-expanded-detail" id={`${candidate.id}-details`}>
                  {candidate.scenarioResults.map((result) => {
                    const scenarioLabel = scenarioLabels.get(result.scenarioId) ?? result.scenarioId;
                    return (
                      <section className="candidate-scenario-detail" key={result.scenarioId}>
                        <div className="candidate-scenario-status">
                          <StatusBadge tone={result.passed ? "green" : "red"} />
                          <strong>{scenarioLabel}</strong>
                          <span>生存率 {formatPercent(result.survivalProbability)}</span>
                          <em className={result.passed ? "" : "fail-badge"}>
                            {formatScenarioResultStatusLabel(result.passed)}
                          </em>
                        </div>
                        {result.hitEvaluations.length > 0 ? (
                          <ul>
                            {result.hitEvaluations.map((hit) => (
                              <li key={hit.hitId}>
                                <strong>{scenarioLabel}</strong>
                                <span>
                                  {hit.description
                                    ? formatLocalizedDamageDescription(hit.description)
                                    : `被ダメージ ${formatDamageRange(hit.damageRange.min, hit.damageRange.max)} (${hit.damageRange.percentMin.toFixed(1)}-${hit.damageRange.percentMax.toFixed(1)}%)`}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </section>
                    );
                  })}
                  {offenseResults.map((entry) => {
                    const scenarioLabel = scenarioLabels.get(entry.scenarioId) ?? entry.scenarioLabel;
                    return (
                      <section className="candidate-scenario-detail" key={entry.id}>
                        <div className="candidate-scenario-status">
                          <StatusBadge tone={getOffenseResultTone(entry.result)} />
                          <strong>{scenarioLabel}</strong>
                          <span>KO率 {formatPercent(entry.result.koProbability)}</span>
                          <em className={entry.result.passed ? "" : "fail-badge"}>
                            {formatScenarioResultStatusLabel(entry.result.passed)}
                          </em>
                        </div>
                        <ul>
                          <li>
                            <strong>{scenarioLabel}</strong>
                            <span>
                              {formatOffenseCandidateDetail(entry, targetLabel, scenariosById.get(entry.scenarioId))}
                            </span>
                          </li>
                        </ul>
                      </section>
                    );
                  })}
                  {speedResults.map((entry) => {
                    const scenarioLabel = scenarioLabels.get(entry.scenarioId) ?? entry.scenarioLabel;
                    return (
                      <section className="candidate-scenario-detail" key={entry.id}>
                        <div className="candidate-scenario-status">
                          <StatusBadge tone={getSpeedResultTone(entry.result)} />
                          <strong>{scenarioLabel}</strong>
                          <span>相手S {entry.result.targetSpeed || "-"}</span>
                          <em className={entry.result.passed ? "" : "fail-badge"}>
                            {formatScenarioResultStatusLabel(entry.result.passed)}
                          </em>
                        </div>
                        <ul>
                          <li>
                            <strong>{scenarioLabel}</strong>
                            <span>
                              {formatSpeedResultDetail(entry, targetLabel, scenariosById.get(entry.scenarioId))}
                            </span>
                          </li>
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </Collapsible.Content>
            </Collapsible.Root>
          );
        })}
      </div>
    </section>
  );
}

export function CandidateStatPointBars({ statPoints }: { statPoints: StatTable }) {
  return (
    <span
      className="candidate-sp-bars"
      aria-label={`SPバー: ${formatStatPointSpreadLabel(statPoints)}`}
      title={`SPバー: ${formatStatPointSpreadLabel(statPoints)}`}
    >
      {statKeys.map((key) => (
        <span
          className={`candidate-sp-bar ${key}`}
          aria-hidden="true"
          key={key}
        >
          <span style={{ width: `${(statPoints[key] / CHAMPIONS_MAX_STAT_POINTS_PER_STAT) * 100}%` }} />
        </span>
      ))}
    </span>
  );
}

export function CandidateStatPointSpread({ statPoints }: { statPoints: StatTable }) {
  return (
    <span
      className="allocation compact-allocation candidate-stat-spread"
      aria-label={`${formatStatPointSpreadLabel(statPoints)} SP`}
      title={`${formatStatPointSpreadLabel(statPoints)} SP`}
    >
      {statKeys.map((key) => (
        <b className={`candidate-stat-value ${key}`} key={key}>
          <span className="candidate-stat-code">{statLabels[key]}</span>
          <span>{statPoints[key]}</span>
        </b>
      ))}
      <CandidateStatPointBars statPoints={statPoints} />
    </span>
  );
}
