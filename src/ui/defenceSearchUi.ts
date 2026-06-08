import type { EntityKind } from "../data/localizationTypes";
import type {
  ActiveDefenceSearchRequest,
  StartDefenceSearchWorkerOptions,
} from "../worker/defenceSearchWorkerClient";
import { createDefenceSearchRequestId } from "../worker/defenceSearchWorkerClient";
import type {
  Build,
  CandidateResult,
  EntityRef,
  FieldState,
  GameType,
  PokemonStatus,
  Scenario,
  ScenarioHit,
  SideState,
  StatBoostTable,
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
}

export type ScenarioAdjustmentType = "defence" | "offense";

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
}

export interface OffenseScenarioResult {
  id: string;
  scenarioId: string;
  scenarioLabel: string;
  attackId: string;
  attackLabel: string;
  result: OffenseAdjustmentResult;
}

export type SearchStatus = "idle" | "running" | "complete" | "error" | "canceled";

export interface SearchUiState {
  status: SearchStatus;
  activeRequestId: string | null;
  searchedCandidates: number;
  totalCandidates: number;
  progress: number;
  candidates: CandidateResult[];
  errorMessage: string | null;
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
  | { type: "partialResult"; requestId: string; candidates: CandidateResult[] }
  | { type: "complete"; requestId: string; candidates: CandidateResult[] }
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

export type SearchUiDispatch = (action: SearchUiAction) => void;

export const createInitialSearchUiState = (): SearchUiState => ({
  status: "idle",
  activeRequestId: null,
  searchedCandidates: 0,
  totalCandidates: 0,
  progress: 0,
  candidates: [],
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
  pokemonInput: "メガスターミー",
  natureInput: "ひかえめ",
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
  attackerAbilityInput: "まけんき",
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
});

export const createDefaultScenarioForms = (): ScenarioFormState[] => [
  {
    id: "scenario-special",
    label: "シナリオA",
    enabled: true,
    adjustmentType: "defence",
    attacks: [createDefaultScenarioAttackForm()],
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
  const repeat = Math.max(1, clampInt(attackForm.repeat, 1, 10));
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
    attackerSide: { ...emptySide, helpingHand: attackForm.helpingHand },
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
    .flatMap((attack) => {
      const offenseForm = createOffenseAdjustmentFormFromScenarioAttack(attack);
      return calculateOffenseAdjustmentFromUi(targetForm, offenseForm).map((result) => ({
        id: `${scenario.id}-${attack.id}-${result.id}`,
        scenarioId: scenario.id,
        scenarioLabel: scenario.label,
        attackId: attack.id,
        attackLabel: attack.label,
        result,
      }));
    }));

const isActiveRequest = (state: SearchUiState, requestId: string): boolean =>
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
        errorMessage: null,
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
      };
    case "complete":
      return {
        ...state,
        status: "complete",
        activeRequestId: null,
        progress: 1,
        candidates: action.candidates,
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
        errorMessage: action.message,
      };
    case "reset":
      return createInitialSearchUiState();
    default:
      return state;
  }
};

export const startDefenceSearchFromUi = (
  client: DefenceSearchWorkerClientAdapter,
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
  dispatch: SearchUiDispatch,
  options: { requestId?: string; maxResults?: number } = {},
): { request: ActiveDefenceSearchRequest; input: DefenceSearchInput } => {
  const input = buildDefenceSearchInput(targetForm, scenarioForms);
  const requestId = options.requestId ?? createDefenceSearchRequestId();
  dispatch({ type: "start", requestId });

  const request = client.start(input.build, input.scenarios, {
    requestId,
    maxResults: options.maxResults ?? 20,
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
      }),
      onComplete: (message) => dispatch({
        type: "complete",
        requestId: message.requestId,
        candidates: message.candidates,
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

export const applyCandidateToTarget = (
  targetForm: TargetFormState,
  candidate: CandidateResult | undefined,
): TargetFormState => {
  if (!candidate) {
    return targetForm;
  }

  return {
    ...targetForm,
    statPoints: {
      ...targetForm.statPoints,
      hp: candidate.candidate.hp,
      def: candidate.candidate.def,
      spd: candidate.candidate.spd,
    },
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
