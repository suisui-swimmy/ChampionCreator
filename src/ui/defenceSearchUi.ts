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
  clampStatPointTable,
  statPointTableToSmogonEvs,
  type StatPointTable,
} from "../domain/championsStats";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";

export interface TargetFormState {
  pokemonInput: string;
  natureInput: string;
  abilityInput: string;
  itemInput: string;
  teraTypeInput: string;
  teraEnabled: boolean;
  dmaxEnabled: boolean;
  status: PokemonStatus;
  level: number;
  statPoints: StatPointTable;
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
  attackerLevel: number;
  attackerStatPoints: StatPointTable;
  attackerBoosts: StatBoostTable;
  defenderBoosts: StatBoostTable;
  moveInput: string;
  repeat: number;
  requiredSurvivedHits: number;
  minSurvivalProbabilityPercent: number;
  gameType: GameType;
  weather: Weather;
  terrain: Terrain;
  critical: boolean;
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  helpingHand: boolean;
}

export interface ScenarioFormState {
  id: string;
  label: string;
  enabled: boolean;
  attacks: ScenarioAttackFormState[];
}

export interface DefenceSearchInput {
  build: Build;
  scenarios: Scenario[];
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
  pokemonInput: "カイリュー",
  natureInput: "ひかえめ",
  abilityInput: "",
  itemInput: "",
  teraTypeInput: "",
  teraEnabled: false,
  dmaxEnabled: false,
  status: "none",
  level: 50,
  statPoints: { ...zeroStatPoints, atk: 0, spa: 0, spe: 0 },
});

export const createDefaultScenarioAttackForm = (id = "attack-a", label = "攻撃A"): ScenarioAttackFormState => ({
  id,
  label,
  attackerPokemonInput: "ピカチュウ",
  attackerNatureInput: "ひかえめ",
  attackerAbilityInput: "",
  attackerItemInput: "",
  attackerTeraTypeInput: "",
  attackerTeraEnabled: false,
  attackerDmaxEnabled: false,
  attackerStatus: "none",
  attackerLevel: 50,
  attackerStatPoints: createDefaultAttackerStatPoints(),
  attackerBoosts: { ...zeroBoosts },
  defenderBoosts: { ...zeroBoosts },
  moveInput: "10まんボルト",
  repeat: 1,
  requiredSurvivedHits: 1,
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

export const createDefaultScenarioForms = (): ScenarioFormState[] => [
  {
    id: "scenario-special",
    label: "シナリオA",
    enabled: true,
    attacks: [createDefaultScenarioAttackForm()],
  },
];

const toBuild = (form: TargetFormState, id: string): Build => {
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
    status: form.status === "none" ? undefined : form.status,
    ivs: defaultIvs,
    statPoints,
    evs: statPointTableToSmogonEvs(statPoints),
  };
};

const toScenarioHit = (
  scenarioForm: ScenarioFormState,
  attackForm: ScenarioAttackFormState,
  index: number,
  hitsBefore: number,
): ScenarioHit => {
  const repeat = Math.max(1, clampInt(attackForm.repeat, 1, 10));
  const requiredSurvivedHits = Math.max(
    Math.max(1, clampInt(attackForm.requiredSurvivedHits, 1, 10)),
    Math.min(10, hitsBefore + 1),
  );
  const attacker = toBuild(
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
    },
    `${scenarioForm.id}-${attackForm.id}-attacker`,
  );

  return {
    id: `${scenarioForm.id}-hit-${index + 1}`,
    attacker,
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
    defenderBoosts: normalizeBoosts(attackForm.defenderBoosts),
    attackerSide: { ...emptySide, helpingHand: attackForm.helpingHand },
    defenderSide: {
      ...emptySide,
      reflect: attackForm.reflect,
      lightScreen: attackForm.lightScreen,
      auroraVeil: attackForm.auroraVeil,
    },
  };
};

const toFieldState = (form: { gameType?: GameType; weather: Weather; terrain: Terrain }): FieldState => ({
  gameType: form.gameType ?? "singles",
  weather: form.weather,
  terrain: form.terrain,
});

const isBlankAttackForm = (form: ScenarioAttackFormState): boolean =>
  !form.attackerPokemonInput.trim() && !form.moveInput.trim();

const toScenarioHits = (
  scenarioForm: ScenarioFormState,
  activeAttacks: ScenarioAttackFormState[],
): ScenarioHit[] => {
  let hitsBefore = 0;
  return activeAttacks.map((attack, index) => {
    const hit = toScenarioHit(scenarioForm, attack, index, hitsBefore);
    hitsBefore += hit.repeat;
    return hit;
  });
};

export const buildDefenceSearchInput = (
  targetForm: TargetFormState,
  scenarioForms: ScenarioFormState[],
): DefenceSearchInput => {
  const activeScenarioForms = scenarioForms.filter((form) => form.enabled);

  if (activeScenarioForms.length === 0) {
    throw new Error("有効な仮想敵シナリオがありません");
  }

  return {
    build: toBuild(targetForm, "target"),
    scenarios: activeScenarioForms.map((form): Scenario => {
      const activeAttacks = form.attacks.filter((attack) => !isBlankAttackForm(attack));
      if (activeAttacks.length === 0) {
        throw new Error(`${form.label} に有効な攻撃条件がありません`);
      }
      const hits = toScenarioHits(form, activeAttacks);

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

export const applyTopCandidateToTarget = (
  targetForm: TargetFormState,
  candidates: CandidateResult[],
): TargetFormState => {
  const [topCandidate] = candidates;
  if (!topCandidate) {
    return targetForm;
  }

  return {
    ...targetForm,
    statPoints: {
      ...targetForm.statPoints,
      hp: topCandidate.candidate.hp,
      def: topCandidate.candidate.def,
      spd: topCandidate.candidate.spd,
    },
  };
};
