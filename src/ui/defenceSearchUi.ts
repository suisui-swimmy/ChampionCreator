import type { EntityKind } from "../data/localizationTypes";
import type {
  ActiveDefenceSearchRequest,
  StartDefenceSearchWorkerOptions,
  StartMaximizeRemainingBulkWorkerOptions,
} from "../worker/defenceSearchWorkerClient";
import { createBulkMaximizeRequestId, createDefenceSearchRequestId } from "../worker/defenceSearchWorkerClient";
import type {
  Build,
  CandidateResult,
  DefenceSearchStatKey,
  EntityRef,
  FieldState,
  GameType,
  PokemonStatus,
  Scenario,
  ScenarioHit,
  SideState,
  StatBoostTable,
  StatKey,
  StatTable,
  Weather,
  Terrain,
} from "../domain/model";
import {
  CHAMPIONS_TOTAL_STAT_POINTS,
  clampStatPointTable,
  clampStatPointValue,
  statPointTableToSmogonEvs,
  sumStatPoints,
  type StatPointTable,
} from "../domain/championsStats";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  calculateOffenseAdjustment,
  type OffenseAdjustmentInput,
  type OffenseAdjustmentResult,
} from "../search/offenseAdjustment";
import {
  getMoveHitCountRangeFromInput,
  getMoveMaxHitsFromInput,
} from "../domain/moveHitCounts";
import { getMoveDefenderStatKeys } from "../domain/moveStatReference";
import {
  calculateSpeedAdjustment,
  type SpeedAdjustmentInput,
  type SpeedAdjustmentResult,
  type SpeedComparisonMode,
  type SpeedManualMultiplier,
} from "../search/speedAdjustment";
import {
  getBuildDerivedStats,
  type BulkNatureCandidate,
  type MaximizeRemainingBulkInput,
  type MaximizeRemainingBulkResult,
} from "../search/maximizeRemainingBulk";
import natureOptionsData from "../data/generated/nature-options.gen.json";

export type SpeedTargetMode = "opponent" | "manual";
export type SpeedMoveModifier = "none" | "tailwind" | "trick-room";

export interface TargetFormState {
  pokemonInput: string;
  natureInput: string;
  abilityInput: string;
  itemInput: string;
  teraTypeInput: string;
  teraEnabled: boolean;
  dmaxEnabled: boolean;
  level: number;
  statPoints: StatPointTable;
  boosts: StatBoostTable;
}

export interface ScenarioAttackFormState {
  id: string;
  label: string;
  attackerPokemonInput: string;
  attackerNatureInput: string;
  attackerAbilityInput: string;
  attackerItemInput: string;
  attackerTeraTypeInput: string;
  attackerTeraEnabled: boolean;
  attackerDmaxEnabled: boolean;
  attackerStatus: PokemonStatus;
  defenderStatus: PokemonStatus;
  attackerLevel: number;
  attackerStatPoints: StatPointTable;
  attackerBoosts: StatBoostTable;
  defenderBoosts: StatBoostTable;
  moveInput: string;
  repeat: number;
  requiredSurvivedHits: number;
  minSurvivalProbabilityPercent: number;
  targetKoProbabilityPercent: number;
  gameType: GameType;
  weather: Weather;
  terrain: Terrain;
  critical: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
  friendGuard: boolean;
  speedTargetMode: SpeedTargetMode;
  speedComparison: SpeedComparisonMode;
  speedRequiredOffset: number;
  speedTargetValue: number;
  speedItemMultiplier: SpeedManualMultiplier;
  speedAbilityMultiplier: SpeedManualMultiplier;
  speedMoveModifier: SpeedMoveModifier;
  tailwind: boolean;
}

export type ScenarioAdjustmentType = "defence" | "offense" | "speed";

export interface ScenarioFormState {
  id: string;
  label: string;
  enabled: boolean;
  adjustmentType: ScenarioAdjustmentType;
  attacks: ScenarioAttackFormState[];
}

export interface OffenseAdjustmentFormState {
  defenderPokemonInput: string;
  defenderNatureInput: string;
  defenderAbilityInput: string;
  defenderItemInput: string;
  defenderTeraTypeInput: string;
  defenderTeraEnabled: boolean;
  defenderDmaxEnabled: boolean;
  defenderStatus: PokemonStatus;
  defenderLevel: number;
  defenderStatPoints: StatPointTable;
  defenderBoosts: StatBoostTable;
  moveInput: string;
  targetKoProbabilityPercent: number;
  gameType: GameType;
  weather: Weather;
  terrain: Terrain;
  critical: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
  friendGuard: boolean;
}

export interface DefenceSearchInput {
  build: Build;
  scenarios: Scenario[];
  minimumStatPoints?: Partial<StatPointTable>;
  searchStatKeys?: DefenceSearchStatKey[];
}

export interface OffenseScenarioResult {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  attackId: string;
  attackLabel: string;
  result: OffenseAdjustmentResult;
}

export interface SpeedScenarioResult {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  attackId: string;
  attackLabel: string;
  result: SpeedAdjustmentResult;
}

export interface IntegratedOffenseRequirements {
  fixedStatPoints: Partial<Pick<StatPointTable, "atk" | "spa">>;
  minimumStatPoints: Partial<Pick<StatPointTable, "hp" | "def" | "spd">>;
  selectedResults: OffenseScenarioResult[];
  blockingReasons: string[];
}

export interface IntegratedSpeedRequirements {
  fixedStatPoints: Partial<Pick<StatPointTable, "spe">>;
  selectedResults: SpeedScenarioResult[];
  blockingReasons: string[];
}

export type SearchStatus = "idle" | "running" | "complete" | "error" | "canceled";

export interface SearchUiState {
  status: SearchStatus;
  activeRequestId: string | null;
  searchedCandidates: number;
  totalCandidates: number;
  progress: number;
  candidates: CandidateResult[];
  passingCandidateCount: number;
  errorMessage: string | null;
  strictestFailureLabel: string | null;
}

export type SearchUiAction =
  | { type: "start"; requestId: string }
  | {
      type: "progress";
      requestId: string;
      searchedCandidates: number;
      totalCandidates: number;
      progress: number;
    }
  | { type: "partialResult"; requestId: string; candidates: CandidateResult[]; passingCandidateCount?: number }
  | {
      type: "complete";
      requestId: string;
      candidates: CandidateResult[];
      passingCandidateCount?: number;
      strictestFailureLabel?: string | null;
    }
  | { type: "error"; requestId?: string; message: string }
  | { type: "cancel"; requestId?: string }
  | { type: "validationError"; message: string }
  | { type: "reset" };

export interface DefenceSearchWorkerClientAdapter {
  start: (
    build: Build,
    scenarios: Scenario[],
    options?: StartDefenceSearchWorkerOptions,
  ) => ActiveDefenceSearchRequest;
}

export interface BulkMaximizeWorkerClientAdapter {
  maximizeRemainingBulk: (
    input: MaximizeRemainingBulkInput,
    options?: StartMaximizeRemainingBulkWorkerOptions,
  ) => ActiveDefenceSearchRequest;
}

export type SearchUiDispatch = (action: SearchUiAction) => void;

export type BulkMaximizeStatus = "idle" | "running" | "complete" | "error" | "canceled";

export interface BulkMaximizeUiState {
  status: BulkMaximizeStatus;
  activeRequestId: string | null;
  searchedCandidates: number;
  totalCandidates: number;
  progress: number;
  result: MaximizeRemainingBulkResult | null;
  errorMessage: string | null;
}

export type BulkMaximizeUiAction =
  | { type: "start"; requestId: string }
  | {
      type: "progress";
      requestId: string;
      searchedCandidates: number;
      totalCandidates: number;
      progress: number;
    }
  | {
      type: "complete";
      requestId: string;
      result: MaximizeRemainingBulkResult | null;
      searchedCandidates: number;
      totalCandidates: number;
    }
  | { type: "error"; requestId?: string; message: string }
  | { type: "cancel"; requestId?: string }
  | { type: "validationError"; message: string }
  | { type: "reset" };

export type BulkMaximizeUiDispatch = (action: BulkMaximizeUiAction) => void;

export const createInitialSearchUiState = (): SearchUiState => ({
  status: "idle",
  activeRequestId: null,
  searchedCandidates: 0,
  totalCandidates: 0,
  progress: 0,
  candidates: [],
  passingCandidateCount: 0,
  errorMessage: null,
  strictestFailureLabel: null,
});

export const createInitialBulkMaximizeUiState = (): BulkMaximizeUiState => ({
  status: "idle",
  activeRequestId: null,
  searchedCandidates: 0,
  totalCandidates: 0,
  progress: 0,
  result: null,
  errorMessage: null,
});

const zeroStatPoints: StatPointTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

export const createDefaultAttackerStatPoints = (): StatPointTable => ({
  ...zeroStatPoints,
  atk: 32,
  spa: 32,
});

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  tailwind: false,
  friendGuard: false,
};

const zeroBoosts: Required<StatBoostTable> = {
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const clampInt = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const clampProbabilityPercent = (value: number): number => clampInt(value, 0, 100) / 100;

const clampBoost = (value: number | undefined): number => clampInt(value ?? 0, -6, 6);

const normalizeBoosts = (boosts: StatBoostTable = {}): StatBoostTable => ({
  atk: clampBoost(boosts.atk),
  def: clampBoost(boosts.def),
  spa: clampBoost(boosts.spa),
  spd: clampBoost(boosts.spd),
  spe: clampBoost(boosts.spe),
});

const mustResolve = <K extends EntityKind>(
  kind: K,
  input: string,
  label: string,
): EntityRef<K> => {
  const result = resolveEntity(kind, input);
  const ref = toEntityRef(result, kind);
  if (!ref) {
    const suffix = result.candidates.length > 0
      ? `候補: ${result.candidates.map((candidate) => candidate.displayNameJa).join(", ")}`
      : "候補なし";
    throw new Error(`${label}「${input}」を canonical name に解決できません (${result.status}, ${suffix})`);
  }
  return ref;
};

const resolveOptional = <K extends EntityKind>(
  kind: K,
  input: string,
  label: string,
): EntityRef<K> | undefined => {
  if (!input.trim()) {
    return undefined;
  }
  return mustResolve(kind, input, label);
};

export const createDefaultTargetForm = (): TargetFormState => ({
  pokemonInput: "メガマフォクシー",
  natureInput: "おくびょう",
  abilityInput: "",
  itemInput: "",
  teraTypeInput: "",
  teraEnabled: false,
  dmaxEnabled: false,
  level: 50,
  statPoints: { ...zeroStatPoints, atk: 0, spa: 0, spe: 0 },
  boosts: { ...zeroBoosts },
});

export const createDefaultScenarioAttackForm = (id = "attack-a", label = "攻撃A"): ScenarioAttackFormState => ({
  id,
  label,
  attackerPokemonInput: "ドドゲザン",
  attackerNatureInput: "いじっぱり",
  attackerAbilityInput: "",
  attackerItemInput: "",
  attackerTeraTypeInput: "",
  attackerTeraEnabled: false,
  attackerDmaxEnabled: false,
  attackerStatus: "none",
  defenderStatus: "none",
  attackerLevel: 50,
  attackerStatPoints: createDefaultAttackerStatPoints(),
  attackerBoosts: { ...zeroBoosts },
  defenderBoosts: { ...zeroBoosts },
  moveInput: "ふいうち",
  repeat: 1,
  requiredSurvivedHits: 1,
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

export const applyMoveHitCountDefaults = (
  attackForm: ScenarioAttackFormState,
  moveInput: string,
): ScenarioAttackFormState => {
  const nextMaxHits = getMoveMaxHitsFromInput(moveInput);
  const nextAttackForm = { ...attackForm, moveInput };

  if (nextMaxHits && nextMaxHits > 1) {
    return {
      ...nextAttackForm,
      repeat: nextMaxHits,
      requiredSurvivedHits: nextMaxHits,
    };
  }

  const previousMaxHits = getMoveMaxHitsFromInput(attackForm.moveInput);
  const shouldClearPreviousAutoFill = (
    previousMaxHits
    && previousMaxHits > 1
    && attackForm.repeat === previousMaxHits
    && attackForm.requiredSurvivedHits === previousMaxHits
  );

  return shouldClearPreviousAutoFill
    ? { ...nextAttackForm, repeat: 1, requiredSurvivedHits: 1 }
    : nextAttackForm;
};

export const formatScenarioAttackLabel = (
  adjustmentType: ScenarioAdjustmentType,
  attackIndex: number,
  label: string,
): string => {
  const defaultPrefix = adjustmentType === "offense"
    ? "火力調整"
    : adjustmentType === "speed" ? "素早さ調整" : "耐久調整";
  const defaultLabel = `${defaultPrefix}${String.fromCharCode(65 + attackIndex)}`;
  const trimmedLabel = label.trim();

  if (!trimmedLabel || /^(?:攻撃|耐久調整|火力調整|S調整|素早さ調整)[A-Z]$/.test(trimmedLabel)) {
    return defaultLabel;
  }

  return label;
};

export const createDefaultScenarioForms = (): ScenarioFormState[] => [
  {
    id: "scenario-defence",
    label: "シナリオ1",
    enabled: true,
    adjustmentType: "defence",
    attacks: [{
      ...createDefaultScenarioAttackForm(),
      minSurvivalProbabilityPercent: 90,
    }],
  },
  {
    id: "scenario-offense",
    label: "シナリオ2",
    enabled: true,
    adjustmentType: "offense",
    attacks: [{
      ...createDefaultScenarioAttackForm(),
      attackerPokemonInput: "メガゲンガー",
      attackerNatureInput: "おくびょう",
      attackerAbilityInput: "",
      attackerStatPoints: { ...zeroStatPoints, hp: 32 },
      moveInput: "サイコキネシス",
      targetKoProbabilityPercent: 80,
    }],
  },
  {
    id: "scenario-speed",
    label: "シナリオ3",
    enabled: true,
    adjustmentType: "speed",
    attacks: [{
      ...createDefaultScenarioAttackForm(),
      attackerPokemonInput: "メガゲンガー",
      attackerNatureInput: "おくびょう",
      attackerAbilityInput: "",
      attackerItemInput: "",
      attackerStatPoints: { ...zeroStatPoints, spe: 32 },
      moveInput: "",
      speedTargetMode: "opponent",
      speedComparison: "outspeed",
      speedRequiredOffset: 1,
      speedMoveModifier: "none",
    }],
  },
];

export const createDefaultOffenseAdjustmentForm = (): OffenseAdjustmentFormState => ({
  defenderPokemonInput: "ピチュー",
  defenderNatureInput: "",
  defenderAbilityInput: "",
  defenderItemInput: "",
  defenderTeraTypeInput: "",
  defenderTeraEnabled: false,
  defenderDmaxEnabled: false,
  defenderStatus: "none",
  defenderLevel: 50,
  defenderStatPoints: { ...zeroStatPoints },
  defenderBoosts: { ...zeroBoosts },
  moveInput: "ふいうち",
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
});

const toBuild = (form: TargetFormState & { status?: PokemonStatus }, id: string): Build => {
  const statPoints = clampStatPointTable(form.statPoints);
  const teraType = form.teraEnabled
    ? mustResolve("type", form.teraTypeInput, "テラスタイプ")
    : undefined;
  const pokemon = mustResolve("pokemon", form.pokemonInput, "ポケモン");
  const isGmaxForm = pokemon.canonicalName.endsWith("-Gmax");

  return {
    id,
    pokemon,
    level: clampInt(form.level, 1, 100),
    nature: resolveOptional("nature", form.natureInput, "性格"),
    ability: resolveOptional("ability", form.abilityInput, "特性"),
    item: resolveOptional("item", form.itemInput, "持ち物"),
    teraType,
    isDynamaxed: form.dmaxEnabled || isGmaxForm || undefined,
    status: form.status && form.status !== "none" ? form.status : undefined,
    ivs: defaultIvs,
    statPoints,
    evs: statPointTableToSmogonEvs(statPoints),
  };
};

export const buildTargetBuildFromUi = (
  targetForm: TargetFormState,
  id = "target",
): Build => toBuild(targetForm, id);

export const buildScenarioAttackBuildFromUi = (
  attackForm: ScenarioAttackFormState,
  id: string,
): Build => toBuild(
  {
    pokemonInput: attackForm.attackerPokemonInput,
    natureInput: attackForm.attackerNatureInput,
    abilityInput: attackForm.attackerAbilityInput,
    itemInput: attackForm.attackerItemInput,
    teraTypeInput: attackForm.attackerTeraTypeInput,
    teraEnabled: attackForm.attackerTeraEnabled,
    dmaxEnabled: attackForm.attackerDmaxEnabled,
    status: attackForm.attackerStatus,
    level: attackForm.attackerLevel,
    statPoints: attackForm.attackerStatPoints,
    boosts: { ...zeroBoosts },
  },
  id,
);

const toScenarioHit = (
  scenarioForm: ScenarioFormState,
  attackForm: ScenarioAttackFormState,
  index: number,
  hitsBefore: number,
  targetBoosts: StatBoostTable,
): ScenarioHit => {
  const moveHitRange = getMoveHitCountRangeFromInput(attackForm.moveInput);
  const repeat = moveHitRange
    ? clampInt(attackForm.repeat, moveHitRange.minHits, moveHitRange.maxHits)
    : Math.max(1, clampInt(attackForm.repeat, 1, 10));
  const requiredSurvivedHits = Math.max(
    Math.max(1, clampInt(attackForm.requiredSurvivedHits, 1, 10)),
    Math.min(10, hitsBefore + 1),
  );
  const attacker = buildScenarioAttackBuildFromUi(
    attackForm,
    `${scenarioForm.id}-${attackForm.id}-attacker`,
  );

  return {
    id: `${scenarioForm.id}-hit-${index + 1}`,
    attacker,
    defenderStatus: attackForm.defenderStatus === "none" ? undefined : attackForm.defenderStatus,
    allyAbilities: attackForm.gameType === "doubles"
      ? scenarioForm.attacks
        .filter((allyForm) => allyForm.id !== attackForm.id)
        .map((allyForm) => resolveOptional(
          "ability",
          allyForm.attackerAbilityInput,
          `${allyForm.label || "味方"}の特性`,
        ))
        .filter((ability): ability is NonNullable<typeof ability> => Boolean(ability))
      : undefined,
    move: mustResolve("move", attackForm.moveInput, "技"),
    moveHits: moveHitRange ? repeat : undefined,
    field: toFieldState(attackForm),
    constraint: {
      enabled: true,
      requiredSurvivedHits,
      minSurvivalProbability: clampProbabilityPercent(attackForm.minSurvivalProbabilityPercent),
    },
    repeat,
    critical: attackForm.critical,
    attackerBoosts: normalizeBoosts(attackForm.attackerBoosts),
    defenderBoosts: normalizeBoosts({
      atk: (targetBoosts.atk ?? 0) + (attackForm.defenderBoosts.atk ?? 0),
      def: (targetBoosts.def ?? 0) + (attackForm.defenderBoosts.def ?? 0),
      spa: (targetBoosts.spa ?? 0) + (attackForm.defenderBoosts.spa ?? 0),
      spd: (targetBoosts.spd ?? 0) + (attackForm.defenderBoosts.spd ?? 0),
      spe: (targetBoosts.spe ?? 0) + (attackForm.defenderBoosts.spe ?? 0),
    }),
    attackerSide: { ...emptySide, helpingHand: attackForm.helpingHand, tailwind: attackForm.tailwind },
    defenderSide: {
      ...emptySide,
      reflect: attackForm.reflect,
      lightScreen: attackForm.lightScreen,
      auroraVeil: attackForm.auroraVeil,
      friendGuard: attackForm.gameType === "doubles" && attackForm.friendGuard,
    },
  };
};

const toFieldState = (form: { gameType?: GameType; weather: Weather; terrain: Terrain }): FieldState => ({
  gameType: form.gameType ?? "singles",
  weather: form.weather,
  terrain: form.terrain,
});

const hasDamageMove = (form: ScenarioAttackFormState): boolean =>
  Boolean(form.moveInput.trim());

const defenceSearchStatKeyOrder = ["hp", "def", "spd"] as const satisfies readonly DefenceSearchStatKey[];

const mergeDefenceSearchStatKeys = (
  ...keyGroups: Array<readonly DefenceSearchStatKey[] | undefined>
): DefenceSearchStatKey[] => {
  const requested = new Set<DefenceSearchStatKey>();
  for (const keyGroup of keyGroups) {
    for (const key of keyGroup ?? []) {
      requested.add(key);
    }
  }

  return defenceSearchStatKeyOrder.filter((key) => requested.has(key));
};

const getDefenceSearchStatKeysFromScenarioForms = (
  scenarioForms: ScenarioFormState[],
): DefenceSearchStatKey[] => mergeDefenceSearchStatKeys(
  scenarioForms.flatMap((scenario) => (
    scenario.attacks
      .filter(hasDamageMove)
      .flatMap((attack) => getMoveDefenderStatKeys(attack.moveInput, {
        teraEnabled: attack.attackerTeraEnabled,
      }))
      .filter((key): key is DefenceSearchStatKey => (
        key === "hp" || key === "def" || key === "spd"
      ))
  )),
);

const getDefenceSearchStatKeysFromMinimums = (
  minimumStatPoints: Partial<Pick<StatPointTable, "hp" | "def" | "spd">>,
): DefenceSearchStatKey[] =>
  defenceSearchStatKeyOrder.filter((key) => (minimumStatPoints[key] ?? 0) > 0);

const toScenarioHits = (
  scenarioForm: ScenarioFormState,
  activeAttacks: ScenarioAttackFormState[],
  targetBoosts: StatBoostTable,
): ScenarioHit[] => {
  let hitsBefore = 0;
  return activeAttacks.map((attack, index) => {
    const hit = toScenarioHit(scenarioForm, attack, index, hitsBefore, targetBoosts);
    hitsBefore += hit.repeat;
    return hit;
  });
};

export const buildDefenceSearchInput = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): DefenceSearchInput => {
  const activeScenarioForms = scenarioForms.filter((form) => (
    form.enabled && form.adjustmentType === "defence"
  ));

  if (activeScenarioForms.length === 0) {
    throw new Error("有効な耐久調整シナリオがありません");
  }

  return {
    build: toBuild(targetForm, "target"),
    searchStatKeys: getDefenceSearchStatKeysFromScenarioForms(activeScenarioForms),
    scenarios: activeScenarioForms.map((form): Scenario => {
      const activeAttacks = form.attacks.filter(hasDamageMove);
      if (activeAttacks.length === 0) {
        throw new Error(`${form.label} に有効な攻撃条件がありません`);
      }
      const hits = toScenarioHits(form, activeAttacks, normalizeBoosts(targetForm.boosts));

      return {
        id: form.id,
        label: form.label,
        enabled: form.enabled,
        hits,
        field: { gameType: "singles", weather: "none", terrain: "none" },
        constraint: {
          enabled: form.enabled,
          requiredSurvivedHits: Math.max(
            1,
            ...hits.map((hit) => hit.constraint?.requiredSurvivedHits ?? 1),
          ),
          minSurvivalProbability: Math.min(
            ...activeAttacks.map((attack) => clampProbabilityPercent(attack.minSurvivalProbabilityPercent)),
          ),
        },
      };
    }),
  };
};

export const buildOffenseAdjustmentInput = (
  targetForm: TargetFormState,
  offenseForm: OffenseAdjustmentFormState,
): OffenseAdjustmentInput => ({
  attackerBuild: buildTargetBuildFromUi(targetForm, "offense-attacker"),
  defenderBuild: toBuild({
    pokemonInput: offenseForm.defenderPokemonInput,
    natureInput: offenseForm.defenderNatureInput,
    abilityInput: offenseForm.defenderAbilityInput,
    itemInput: offenseForm.defenderItemInput,
    teraTypeInput: offenseForm.defenderTeraTypeInput,
    teraEnabled: offenseForm.defenderTeraEnabled,
    dmaxEnabled: offenseForm.defenderDmaxEnabled,
    status: offenseForm.defenderStatus,
    level: offenseForm.defenderLevel,
    statPoints: offenseForm.defenderStatPoints,
    boosts: { ...zeroBoosts },
  }, "offense-defender"),
  move: mustResolve("move", offenseForm.moveInput, "火力調整の技"),
  moveInput: offenseForm.moveInput,
  targetKoProbability: clampProbabilityPercent(offenseForm.targetKoProbabilityPercent),
  field: toFieldState(offenseForm),
  critical: offenseForm.critical,
  attackerBoosts: normalizeBoosts(targetForm.boosts),
  defenderBoosts: normalizeBoosts(offenseForm.defenderBoosts),
  attackerSide: { ...emptySide, helpingHand: offenseForm.helpingHand },
  defenderSide: {
    ...emptySide,
    reflect: offenseForm.reflect,
    lightScreen: offenseForm.lightScreen,
    auroraVeil: offenseForm.auroraVeil,
    friendGuard: offenseForm.gameType === "doubles" && offenseForm.friendGuard,
  },
  boostedNatures: {
    atk: mustResolve("nature", "いじっぱり", "A上昇補正"),
    spa: mustResolve("nature", "ひかえめ", "C上昇補正"),
  },
});

export const createOffenseAdjustmentFormFromScenarioAttack = (
  attackForm: ScenarioAttackFormState,
): OffenseAdjustmentFormState => ({
  defenderPokemonInput: attackForm.attackerPokemonInput,
  defenderNatureInput: attackForm.attackerNatureInput,
  defenderAbilityInput: attackForm.attackerAbilityInput,
  defenderItemInput: attackForm.attackerItemInput,
  defenderTeraTypeInput: attackForm.attackerTeraTypeInput,
  defenderTeraEnabled: attackForm.attackerTeraEnabled,
  defenderDmaxEnabled: attackForm.attackerDmaxEnabled,
  defenderStatus: attackForm.attackerStatus,
  defenderLevel: attackForm.attackerLevel,
  defenderStatPoints: attackForm.attackerStatPoints,
  defenderBoosts: attackForm.attackerBoosts,
  moveInput: attackForm.moveInput,
  targetKoProbabilityPercent: attackForm.targetKoProbabilityPercent,
  gameType: attackForm.gameType,
  weather: attackForm.weather,
  terrain: attackForm.terrain,
  critical: attackForm.critical,
  reflect: attackForm.reflect,
  lightScreen: attackForm.lightScreen,
  auroraVeil: attackForm.auroraVeil,
  helpingHand: attackForm.helpingHand,
  friendGuard: attackForm.friendGuard,
});

const makeOffenseAdjustmentMessageResult = (
  status: OffenseAdjustmentResult["status"],
  reason: string,
): OffenseAdjustmentResult => ({
  id: `offense-${status}`,
  status,
  passed: false,
  label: status === "unresolved" ? "未解決" : "入力エラー",
  owner: "none",
  stat: null,
  role: "fixed",
  canApply: false,
  requiredStatPoints: null,
  actualStat: null,
  koProbability: 0,
  targetKoProbability: 0,
  damageRange: null,
  reason,
});

export const calculateOffenseAdjustmentFromUi = (
  targetForm: TargetFormState,
  offenseForm: OffenseAdjustmentFormState,
): OffenseAdjustmentResult[] => {
  const moveResult = resolveEntity("move", offenseForm.moveInput);
  if (!toEntityRef(moveResult, "move")) {
    const candidates = moveResult.candidates.length > 0
      ? `候補: ${moveResult.candidates.map((candidate) => candidate.displayNameJa).join(", ")}`
      : "候補なし";
    return [makeOffenseAdjustmentMessageResult(
      "unresolved",
      `技「${offenseForm.moveInput}」を canonical name に解決できません (${moveResult.status}, ${candidates})`,
    )];
  }

  try {
    return calculateOffenseAdjustment(buildOffenseAdjustmentInput(targetForm, offenseForm));
  } catch (error) {
    return [makeOffenseAdjustmentMessageResult(
      "invalid",
      error instanceof Error ? error.message : String(error),
    )];
  }
};

export const calculateOffenseAdjustmentsFromScenarios = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): OffenseScenarioResult[] => scenarioForms
  .filter((scenario) => scenario.enabled && scenario.adjustmentType === "offense")
  .flatMap((scenario) => scenario.attacks
    .filter(hasDamageMove)
    .flatMap((attack, attackIndex) => {
      const offenseForm = createOffenseAdjustmentFormFromScenarioAttack(attack);
      return calculateOffenseAdjustmentFromUi(targetForm, offenseForm).map((result) => ({
        id: `${scenario.id}-${attack.id}-${result.id}`,
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        attackId: attack.id,
        attackLabel: formatScenarioAttackLabel(scenario.adjustmentType, attackIndex, attack.label),
        result,
      }));
    }));

const hasSpeedTarget = (form: ScenarioAttackFormState): boolean =>
  form.speedTargetMode === "manual"
    ? form.speedTargetValue > 0
    : Boolean(form.attackerPokemonInput.trim());

export const buildSpeedAdjustmentInput = (
  targetForm: TargetFormState,
  attackForm: ScenarioAttackFormState,
): SpeedAdjustmentInput => {
  const hasManualTargetSpeed = attackForm.speedTargetMode === "manual" && attackForm.speedTargetValue > 0;
  const opponentBuild = hasManualTargetSpeed
    ? undefined
    : buildScenarioAttackBuildFromUi(attackForm, "speed-opponent");

  return {
    targetBuild: buildTargetBuildFromUi(targetForm, "speed-target"),
    opponentBuild,
    opponentLabel: attackForm.attackerPokemonInput.trim() || "任意S値",
    field: toFieldState(attackForm),
    targetBoosts: normalizeBoosts(targetForm.boosts),
    opponentBoosts: normalizeBoosts(attackForm.attackerBoosts),
    targetSide: { ...emptySide },
    opponentSide: { ...emptySide, tailwind: attackForm.speedMoveModifier === "tailwind" },
    comparison: attackForm.speedComparison,
    orderMode: attackForm.speedMoveModifier === "trick-room" ? "trick-room" : "normal",
    requiredSpeedOffset: hasManualTargetSpeed ? 0 : clampInt(attackForm.speedRequiredOffset, 0, 10000),
    manualTargetSpeed: hasManualTargetSpeed ? clampInt(attackForm.speedTargetValue, 0, 10000) : undefined,
    opponentItemMultiplier: attackForm.speedItemMultiplier,
    opponentAbilityMultiplier: attackForm.speedAbilityMultiplier,
    boostedNature: mustResolve("nature", "おくびょう", "S上昇補正"),
  };
};

const makeSpeedAdjustmentMessageResult = (
  status: SpeedAdjustmentResult["status"],
  reason: string,
): SpeedAdjustmentResult => ({
  id: `speed-${status}`,
  status,
  passed: false,
  canApply: false,
  label: "Sライン",
  comparison: "outspeed",
  orderMode: "normal",
  relation: "miss",
  requiredStatPoints: null,
  actualSpeed: null,
  targetSpeed: 0,
  requiredSpeed: 0,
  targetStatPoints: 0,
  notes: [],
  reason,
});

export const calculateSpeedAdjustmentFromUi = (
  targetForm: TargetFormState,
  attackForm: ScenarioAttackFormState,
): SpeedAdjustmentResult => {
  try {
    return calculateSpeedAdjustment(buildSpeedAdjustmentInput(targetForm, attackForm));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return makeSpeedAdjustmentMessageResult(
      message.includes("canonical name に解決できません") ? "unresolved" : "invalid",
      message,
    );
  }
};

export const calculateSpeedAdjustmentsFromScenarios = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): SpeedScenarioResult[] => scenarioForms
  .filter((scenario) => scenario.enabled && scenario.adjustmentType === "speed")
  .flatMap((scenario) => scenario.attacks
    .filter(hasSpeedTarget)
    .map((attack, attackIndex) => {
      const result = calculateSpeedAdjustmentFromUi(targetForm, attack);
      return {
        id: `${scenario.id}-${attack.id}-${result.id}`,
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        attackId: attack.id,
        attackLabel: formatScenarioAttackLabel(scenario.adjustmentType, attackIndex, attack.label),
        result,
      };
    }));

type FixedOffenseStat = "atk" | "spa";
type MinimumOffenseStat = "hp" | "def" | "spd";

type OffenseRequirementChoice = {
  result: OffenseScenarioResult;
  fixedStatPoints: Partial<Record<FixedOffenseStat, number>>;
  minimumStatPoints: Partial<Record<MinimumOffenseStat, number>>;
};

type OffenseRequirementState = Omit<IntegratedOffenseRequirements, "blockingReasons">;

const isFixedOffenseStat = (stat: StatKey | null): stat is FixedOffenseStat =>
  stat === "atk" || stat === "spa";

const isMinimumOffenseStat = (stat: StatKey | null): stat is MinimumOffenseStat =>
  stat === "hp" || stat === "def" || stat === "spd";

const getOffenseResultSourceLabel = (entry: OffenseScenarioResult): string =>
  `${entry.scenarioLabel} / ${entry.attackLabel} / ${entry.result.label}`;

const createOffenseRequirementChoice = (
  entry: OffenseScenarioResult,
): OffenseRequirementChoice | null => {
  const { result } = entry;
  if (
    !result.passed
    || result.owner !== "attacker"
    || result.stat === null
    || result.requiredStatPoints === null
  ) {
    return null;
  }

  if (isFixedOffenseStat(result.stat)) {
    return {
      result: entry,
      fixedStatPoints: { [result.stat]: result.requiredStatPoints },
      minimumStatPoints: {},
    };
  }

  if (isMinimumOffenseStat(result.stat)) {
    return {
      result: entry,
      fixedStatPoints: {},
      minimumStatPoints: { [result.stat]: result.requiredStatPoints },
    };
  }

  return null;
};

const mergeOffenseRequirementChoice = (
  state: OffenseRequirementState,
  choice: OffenseRequirementChoice,
): OffenseRequirementState => ({
  fixedStatPoints: {
    atk: Math.max(state.fixedStatPoints.atk ?? 0, choice.fixedStatPoints.atk ?? 0),
    spa: Math.max(state.fixedStatPoints.spa ?? 0, choice.fixedStatPoints.spa ?? 0),
  },
  minimumStatPoints: {
    hp: Math.max(state.minimumStatPoints.hp ?? 0, choice.minimumStatPoints.hp ?? 0),
    def: Math.max(state.minimumStatPoints.def ?? 0, choice.minimumStatPoints.def ?? 0),
    spd: Math.max(state.minimumStatPoints.spd ?? 0, choice.minimumStatPoints.spd ?? 0),
  },
  selectedResults: [...state.selectedResults, choice.result],
});

const getOffenseRequirementCost = (
  state: OffenseRequirementState,
  baseStatPoints: StatPointTable,
): number => (
  Math.max(baseStatPoints.atk, state.fixedStatPoints.atk ?? 0)
  + Math.max(baseStatPoints.spa, state.fixedStatPoints.spa ?? 0)
  + baseStatPoints.spe
  + (state.minimumStatPoints.hp ?? 0)
  + (state.minimumStatPoints.def ?? 0)
  + (state.minimumStatPoints.spd ?? 0)
);

const compareOffenseRequirementStates = (
  left: OffenseRequirementState,
  right: OffenseRequirementState,
  baseStatPoints: StatPointTable,
): number => {
  const leftCost = getOffenseRequirementCost(left, baseStatPoints);
  const rightCost = getOffenseRequirementCost(right, baseStatPoints);
  if (leftCost !== rightCost) {
    return leftCost - rightCost;
  }

  const leftFixed = (left.fixedStatPoints.atk ?? 0) + (left.fixedStatPoints.spa ?? 0);
  const rightFixed = (right.fixedStatPoints.atk ?? 0) + (right.fixedStatPoints.spa ?? 0);
  if (leftFixed !== rightFixed) {
    return leftFixed - rightFixed;
  }

  return left.selectedResults.length - right.selectedResults.length;
};

const pruneOffenseRequirementStates = (
  states: OffenseRequirementState[],
  baseStatPoints: StatPointTable,
): OffenseRequirementState[] => {
  const bestByKey = new Map<string, OffenseRequirementState>();
  for (const state of states) {
    const key = [
      state.fixedStatPoints.atk ?? 0,
      state.fixedStatPoints.spa ?? 0,
      state.minimumStatPoints.hp ?? 0,
      state.minimumStatPoints.def ?? 0,
      state.minimumStatPoints.spd ?? 0,
    ].join(":");
    const current = bestByKey.get(key);
    if (!current || compareOffenseRequirementStates(state, current, baseStatPoints) < 0) {
      bestByKey.set(key, state);
    }
  }

  return Array.from(bestByKey.values())
    .sort((left, right) => compareOffenseRequirementStates(left, right, baseStatPoints))
    .slice(0, 32);
};

export const createOffenseSearchBaselineTargetForm = (
  targetForm: TargetFormState,
): TargetFormState => ({
  ...targetForm,
  statPoints: {
    ...targetForm.statPoints,
    hp: 0,
    def: 0,
    spd: 0,
  },
});

export const calculateOffenseAdjustmentsForCandidateRanking = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): OffenseScenarioResult[] => calculateOffenseAdjustmentsFromScenarios(
  createOffenseSearchBaselineTargetForm(targetForm),
  scenarioForms,
);

export const calculateSpeedAdjustmentsForCandidateRanking = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): SpeedScenarioResult[] => calculateSpeedAdjustmentsFromScenarios(
  createOffenseSearchBaselineTargetForm(targetForm),
  scenarioForms,
);

export const resolveIntegratedOffenseRequirements = (
  targetForm: TargetFormState,
  offenseResults: OffenseScenarioResult[],
): IntegratedOffenseRequirements => {
  const baseStatPoints = clampStatPointTable(targetForm.statPoints);
  const groupedResults = new Map<string, OffenseScenarioResult[]>();
  const blockingReasons: string[] = [];
  let states: OffenseRequirementState[] = [{
    fixedStatPoints: {},
    minimumStatPoints: {},
    selectedResults: [],
  }];

  for (const entry of offenseResults) {
    const key = `${entry.scenarioId}:${entry.attackId}`;
    groupedResults.set(key, [...(groupedResults.get(key) ?? []), entry]);
  }

  for (const group of groupedResults.values()) {
    const choices = group
      .map(createOffenseRequirementChoice)
      .filter((choice): choice is OffenseRequirementChoice => Boolean(choice));

    if (choices.length > 0) {
      states = pruneOffenseRequirementStates(
        states.flatMap((state) => choices.map((choice) => mergeOffenseRequirementChoice(state, choice))),
        baseStatPoints,
      );
      continue;
    }

    if (!group.some((entry) => entry.result.passed)) {
      const failed = group.find((entry) => !entry.result.passed) ?? group[0];
      blockingReasons.push(`${getOffenseResultSourceLabel(failed)}: ${failed.result.reason}`);
    }
  }

  const best = pruneOffenseRequirementStates(states, baseStatPoints)[0] ?? {
    fixedStatPoints: {},
    minimumStatPoints: {},
    selectedResults: [],
  };

  return {
    ...best,
    blockingReasons,
  };
};

export const applyIntegratedOffenseRequirementsToTargetForm = (
  targetForm: TargetFormState,
  requirements: IntegratedOffenseRequirements,
): TargetFormState => {
  const statPoints = clampStatPointTable(targetForm.statPoints);
  return {
    ...targetForm,
    statPoints: {
      ...statPoints,
      atk: Math.max(statPoints.atk, requirements.fixedStatPoints.atk ?? 0),
      spa: Math.max(statPoints.spa, requirements.fixedStatPoints.spa ?? 0),
    },
  };
};

const createSpeedRequirementChoice = (
  entry: SpeedScenarioResult,
): { result: SpeedScenarioResult; fixedStatPoints: Partial<Pick<StatPointTable, "spe">> } | null => {
  const { result } = entry;
  if (!result.passed || !result.canApply || result.requiredStatPoints === null) {
    return null;
  }
  return {
    result: entry,
    fixedStatPoints: { spe: result.requiredStatPoints },
  };
};

const getSpeedResultSourceLabel = (entry: SpeedScenarioResult): string =>
  `${entry.scenarioLabel} / ${entry.attackLabel} / ${entry.result.label}`;

export const resolveIntegratedSpeedRequirements = (
  targetForm: TargetFormState,
  speedResults: SpeedScenarioResult[],
): IntegratedSpeedRequirements => {
  const baseStatPoints = clampStatPointTable(targetForm.statPoints);
  const groupedResults = new Map<string, SpeedScenarioResult[]>();
  const blockingReasons: string[] = [];
  const selectedResults: SpeedScenarioResult[] = [];
  let requiredSpe = baseStatPoints.spe;

  for (const entry of speedResults) {
    const key = `${entry.scenarioId}:${entry.attackId}`;
    groupedResults.set(key, [...(groupedResults.get(key) ?? []), entry]);
  }

  for (const group of groupedResults.values()) {
    const choices = group
      .map(createSpeedRequirementChoice)
      .filter((choice): choice is NonNullable<typeof choice> => Boolean(choice));

    if (choices.length > 0) {
      const best = choices.reduce((currentBest, choice) => (
        (choice.fixedStatPoints.spe ?? 0) < (currentBest.fixedStatPoints.spe ?? 0)
          ? choice
          : currentBest
      ));
      requiredSpe = Math.max(requiredSpe, best.fixedStatPoints.spe ?? 0);
      selectedResults.push(best.result);
      continue;
    }

    if (!group.some((entry) => entry.result.passed)) {
      const failed = group.find((entry) => !entry.result.passed) ?? group[0];
      blockingReasons.push(`${getSpeedResultSourceLabel(failed)}: ${failed.result.reason}`);
    }
  }

  return {
    fixedStatPoints: { spe: requiredSpe },
    selectedResults,
    blockingReasons,
  };
};

export const applyIntegratedSpeedRequirementsToTargetForm = (
  targetForm: TargetFormState,
  requirements: IntegratedSpeedRequirements,
): TargetFormState => {
  const statPoints = clampStatPointTable(targetForm.statPoints);
  return {
    ...targetForm,
    statPoints: {
      ...statPoints,
      spe: Math.max(statPoints.spe, requirements.fixedStatPoints.spe ?? 0),
    },
  };
};

export const buildIntegratedDefenceSearchInput = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): DefenceSearchInput => {
  const baselineTargetForm = createOffenseSearchBaselineTargetForm(targetForm);
  const offenseResults = calculateOffenseAdjustmentsFromScenarios(baselineTargetForm, scenarioForms);
  const requirements = resolveIntegratedOffenseRequirements(baselineTargetForm, offenseResults);
  const speedResults = calculateSpeedAdjustmentsFromScenarios(baselineTargetForm, scenarioForms);
  const speedRequirements = resolveIntegratedSpeedRequirements(baselineTargetForm, speedResults);

  if (requirements.blockingReasons.length > 0) {
    throw new Error(`火力調整条件を候補一覧へ統合できません: ${requirements.blockingReasons.join(" / ")}`);
  }
  if (speedRequirements.blockingReasons.length > 0) {
    throw new Error(`素早さ調整条件を候補一覧へ統合できません: ${speedRequirements.blockingReasons.join(" / ")}`);
  }

  const integratedTargetForm = applyIntegratedSpeedRequirementsToTargetForm(
    applyIntegratedOffenseRequirementsToTargetForm(baselineTargetForm, requirements),
    speedRequirements,
  );
  const fixedBudget =
    integratedTargetForm.statPoints.atk
    + integratedTargetForm.statPoints.spa
    + integratedTargetForm.statPoints.spe;
  const minimumDefenceBudget =
    (requirements.minimumStatPoints.hp ?? 0)
    + (requirements.minimumStatPoints.def ?? 0)
    + (requirements.minimumStatPoints.spd ?? 0);

  if (fixedBudget + minimumDefenceBudget > CHAMPIONS_TOTAL_STAT_POINTS) {
    throw new Error(
      `火力/素早さ調整込みの必要SPが合計${CHAMPIONS_TOTAL_STAT_POINTS}を超えています`
      + ` (固定 ${fixedBudget} + 火力最低 ${minimumDefenceBudget})`,
    );
  }

  const defenceInput = buildDefenceSearchInput(integratedTargetForm, scenarioForms);
  return {
    ...defenceInput,
    minimumStatPoints: requirements.minimumStatPoints,
    searchStatKeys: mergeDefenceSearchStatKeys(
      defenceInput.searchStatKeys,
      getDefenceSearchStatKeysFromMinimums(requirements.minimumStatPoints),
    ),
  };
};

type GeneratedNatureOption = {
  label: string;
};

const generatedNatureOptions = natureOptionsData.entries as GeneratedNatureOption[];

const createBulkNatureCandidates = (): BulkNatureCandidate[] =>
  generatedNatureOptions.map((option) => ({
    nature: mustResolve("nature", option.label, "性格候補"),
  }));

const getProtectedActualStatsForBulkMaximize = (
  build: Build,
  offenseRequirements: IntegratedOffenseRequirements,
  speedRequirements: IntegratedSpeedRequirements,
): Partial<Pick<StatPointTable, "atk" | "spa" | "spe">> => {
  const stats = getBuildDerivedStats(build);
  const protectedStats: Partial<Pick<StatPointTable, "atk" | "spa" | "spe">> = {};

  if (offenseRequirements.selectedResults.some((entry) => entry.result.stat === "atk")) {
    protectedStats.atk = stats.atk;
  }
  if (offenseRequirements.selectedResults.some((entry) => entry.result.stat === "spa")) {
    protectedStats.spa = stats.spa;
  }
  if (speedRequirements.selectedResults.length > 0) {
    protectedStats.spe = stats.spe;
  }

  return protectedStats;
};

export const buildMaximizeRemainingBulkInputFromUi = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
  options: { allowNatureChange: boolean },
): MaximizeRemainingBulkInput => {
  const baselineTargetForm = createOffenseSearchBaselineTargetForm(targetForm);
  const offenseResults = calculateOffenseAdjustmentsFromScenarios(baselineTargetForm, scenarioForms);
  const offenseRequirements = resolveIntegratedOffenseRequirements(baselineTargetForm, offenseResults);
  const speedResults = calculateSpeedAdjustmentsFromScenarios(baselineTargetForm, scenarioForms);
  const speedRequirements = resolveIntegratedSpeedRequirements(baselineTargetForm, speedResults);

  if (offenseRequirements.blockingReasons.length > 0) {
    throw new Error(`火力調整条件を耐久最大化へ統合できません: ${offenseRequirements.blockingReasons.join(" / ")}`);
  }
  if (speedRequirements.blockingReasons.length > 0) {
    throw new Error(`素早さ調整条件を耐久最大化へ統合できません: ${speedRequirements.blockingReasons.join(" / ")}`);
  }

  const integratedTargetForm = applyIntegratedSpeedRequirementsToTargetForm(
    applyIntegratedOffenseRequirementsToTargetForm(targetForm, offenseRequirements),
    speedRequirements,
  );
  const fixedBudget =
    integratedTargetForm.statPoints.atk
    + integratedTargetForm.statPoints.spa
    + integratedTargetForm.statPoints.spe;
  const minimumDefenceBudget =
    (offenseRequirements.minimumStatPoints.hp ?? 0)
    + (offenseRequirements.minimumStatPoints.def ?? 0)
    + (offenseRequirements.minimumStatPoints.spd ?? 0);

  if (fixedBudget + minimumDefenceBudget > CHAMPIONS_TOTAL_STAT_POINTS) {
    throw new Error(
      `火力/素早さ調整込みの必要SPが合計${CHAMPIONS_TOTAL_STAT_POINTS}を超えています`
      + ` (固定 ${fixedBudget} + 火力最低 ${minimumDefenceBudget})`,
    );
  }

  const build = buildTargetBuildFromUi(integratedTargetForm, "target-bulk-maximize");
  return {
    build,
    allowNatureChange: options.allowNatureChange,
    natureCandidates: options.allowNatureChange ? createBulkNatureCandidates() : undefined,
    minimumStatPoints: offenseRequirements.minimumStatPoints,
    protectedActualStats: getProtectedActualStatsForBulkMaximize(
      build,
      offenseRequirements,
      speedRequirements,
    ),
    keepCurrentPhysicalSpecialBulk: true,
  };
};

const isActiveRequest = (state: SearchUiState, requestId: string): boolean =>
  state.activeRequestId === requestId;

const isActiveBulkRequest = (state: BulkMaximizeUiState, requestId: string): boolean =>
  state.activeRequestId === requestId;

export const searchUiReducer = (
  state: SearchUiState,
  action: SearchUiAction,
): SearchUiState => {
  if ("requestId" in action && action.requestId && !isActiveRequest(state, action.requestId)) {
    if (action.type !== "start") {
      return state;
    }
  }

  switch (action.type) {
    case "start":
      return {
        status: "running",
        activeRequestId: action.requestId,
        searchedCandidates: 0,
        totalCandidates: 0,
        progress: 0,
        candidates: [],
        passingCandidateCount: 0,
        errorMessage: null,
        strictestFailureLabel: null,
      };
    case "progress":
      return {
        ...state,
        searchedCandidates: action.searchedCandidates,
        totalCandidates: action.totalCandidates,
        progress: action.progress,
      };
    case "partialResult":
      return {
        ...state,
        candidates: action.candidates,
        passingCandidateCount: action.passingCandidateCount ?? action.candidates.length,
      };
    case "complete":
      return {
        ...state,
        status: "complete",
        activeRequestId: null,
        progress: 1,
        candidates: action.candidates,
        passingCandidateCount: action.passingCandidateCount ?? action.candidates.length,
        strictestFailureLabel: action.strictestFailureLabel ?? null,
      };
    case "error":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        errorMessage: action.message,
        strictestFailureLabel: null,
      };
    case "cancel":
      return {
        ...state,
        status: "canceled",
        activeRequestId: null,
      };
    case "validationError":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        errorMessage: action.message,
        strictestFailureLabel: null,
      };
    case "reset":
      return createInitialSearchUiState();
    default:
      return state;
  }
};

export const bulkMaximizeUiReducer = (
  state: BulkMaximizeUiState,
  action: BulkMaximizeUiAction,
): BulkMaximizeUiState => {
  if ("requestId" in action && action.requestId && !isActiveBulkRequest(state, action.requestId)) {
    if (action.type !== "start") {
      return state;
    }
  }

  switch (action.type) {
    case "start":
      return {
        status: "running",
        activeRequestId: action.requestId,
        searchedCandidates: 0,
        totalCandidates: 0,
        progress: 0,
        result: null,
        errorMessage: null,
      };
    case "progress":
      return {
        ...state,
        searchedCandidates: action.searchedCandidates,
        totalCandidates: action.totalCandidates,
        progress: action.progress,
      };
    case "complete":
      return {
        ...state,
        status: "complete",
        activeRequestId: null,
        searchedCandidates: action.searchedCandidates,
        totalCandidates: action.totalCandidates,
        progress: 1,
        result: action.result,
        errorMessage: null,
      };
    case "error":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        errorMessage: action.message,
      };
    case "cancel":
      return {
        ...state,
        status: "canceled",
        activeRequestId: null,
      };
    case "validationError":
      return {
        ...state,
        status: "error",
        activeRequestId: null,
        result: null,
        errorMessage: action.message,
      };
    case "reset":
      return createInitialBulkMaximizeUiState();
    default:
      return state;
  }
};

export const startDefenceSearchFromUi = (
  client: DefenceSearchWorkerClientAdapter,
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
  dispatch: SearchUiDispatch,
  options: { requestId?: string; maxResults?: number | null; partialResultLimit?: number } = {},
): { request: ActiveDefenceSearchRequest; input: DefenceSearchInput } => {
  const input = buildIntegratedDefenceSearchInput(targetForm, scenarioForms);
  const requestId = options.requestId ?? createDefenceSearchRequestId();
  dispatch({ type: "start", requestId });

  const request = client.start(input.build, input.scenarios, {
    requestId,
    maxResults: options.maxResults ?? null,
    partialResultLimit: options.partialResultLimit ?? 20,
    minimumStatPoints: input.minimumStatPoints,
    searchStatKeys: input.searchStatKeys,
    progressInterval: 250,
    partialResultInterval: 1,
    yieldEvery: 250,
    callbacks: {
      onProgress: (message) => dispatch({
        type: "progress",
        requestId: message.requestId,
        searchedCandidates: message.searchedCandidates,
        totalCandidates: message.totalCandidates,
        progress: message.progress,
      }),
      onPartialResult: (message) => dispatch({
        type: "partialResult",
        requestId: message.requestId,
        candidates: message.candidates,
        passingCandidateCount: message.passingCandidateCount,
      }),
      onComplete: (message) => dispatch({
        type: "complete",
        requestId: message.requestId,
        candidates: message.candidates,
        passingCandidateCount: message.passingCandidateCount,
        strictestFailureLabel: message.strictestFailureLabel ?? null,
      }),
      onError: (message) => dispatch({
        type: "error",
        requestId: message.requestId,
        message: message.message,
      }),
    },
  });

  return { request, input };
};

export const startMaximizeRemainingBulkFromUi = (
  client: BulkMaximizeWorkerClientAdapter,
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
  dispatch: BulkMaximizeUiDispatch,
  options: { requestId?: string; allowNatureChange: boolean; maxResults?: number } = {
    allowNatureChange: false,
  },
): { request: ActiveDefenceSearchRequest; input: MaximizeRemainingBulkInput } => {
  const input = buildMaximizeRemainingBulkInputFromUi(targetForm, scenarioForms, {
    allowNatureChange: options.allowNatureChange,
  });
  const requestId = options.requestId ?? createBulkMaximizeRequestId();
  dispatch({ type: "start", requestId });

  const request = client.maximizeRemainingBulk(input, {
    requestId,
    maxResults: options.maxResults ?? 1,
    callbacks: {
      onBulkProgress: (message) => dispatch({
        type: "progress",
        requestId: message.requestId,
        searchedCandidates: message.searchedCandidates,
        totalCandidates: message.totalCandidates,
        progress: message.progress,
      }),
      onBulkComplete: (message) => dispatch({
        type: "complete",
        requestId: message.requestId,
        result: message.result,
        searchedCandidates: message.searchedCandidates,
        totalCandidates: message.totalCandidates,
      }),
      onBulkError: (message) => dispatch({
        type: "error",
        requestId: message.requestId,
        message: message.message,
      }),
    },
  });

  return { request, input };
};

export const applyCandidateToTarget = (
  targetForm: TargetFormState,
  candidate: CandidateResult | undefined,
): TargetFormState => {
  if (!candidate) {
    return targetForm;
  }

  return {
    ...targetForm,
    statPoints: { ...candidate.appliedStatPoints },
  };
};

export const applyTopCandidateToTarget = (
  targetForm: TargetFormState,
  candidates: CandidateResult[],
): TargetFormState => applyCandidateToTarget(targetForm, candidates[0]);

export const applyOffenseAdjustmentToTarget = (
  targetForm: TargetFormState,
  result: OffenseAdjustmentResult | undefined,
): TargetFormState => {
  if (
    !result?.canApply
    || result.requiredStatPoints === null
    || (result.stat !== "atk" && result.stat !== "spa")
  ) {
    return targetForm;
  }

  const nextValue = clampStatPointValue(result.requiredStatPoints);
  const usedByOtherStats = sumStatPoints(targetForm.statPoints) - targetForm.statPoints[result.stat];
  const cappedValue = Math.min(nextValue, Math.max(0, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats));

  return {
    ...targetForm,
    statPoints: {
      ...targetForm.statPoints,
      [result.stat]: cappedValue,
    },
  };
};

export const applySpeedAdjustmentToTarget = (
  targetForm: TargetFormState,
  result: SpeedAdjustmentResult | undefined,
): TargetFormState => {
  if (!result?.canApply || result.requiredStatPoints === null) {
    return targetForm;
  }

  const nextValue = clampStatPointValue(result.requiredStatPoints);
  const usedByOtherStats = sumStatPoints(targetForm.statPoints) - targetForm.statPoints.spe;
  const cappedValue = Math.min(nextValue, Math.max(0, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats));

  return {
    ...targetForm,
    statPoints: {
      ...targetForm.statPoints,
      spe: cappedValue,
    },
  };
};

export const applyMaximizeRemainingBulkToTarget = (
  targetForm: TargetFormState,
  result: MaximizeRemainingBulkResult | null | undefined,
): TargetFormState => {
  if (!result) {
    return targetForm;
  }

  return {
    ...targetForm,
    natureInput: result.candidate.natureCanonicalName ? result.candidate.nature : targetForm.natureInput,
    statPoints: { ...result.candidate.statPoints },
  };
};
