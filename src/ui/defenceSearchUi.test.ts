import { describe, expect, it } from "vitest";
import type { Build, CandidateResult, Scenario } from "../domain/model";
import type {
  ActiveDefenceSearchRequest,
  StartDefenceSearchWorkerOptions,
} from "../worker/defenceSearchWorkerClient";
import {
  applyTopCandidateToTarget,
  buildDefenceSearchInput,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  createInitialSearchUiState,
  searchUiReducer,
  startDefenceSearchFromUi,
  type DefenceSearchWorkerClientAdapter,
} from "./defenceSearchUi";

class FakeWorkerClient implements DefenceSearchWorkerClientAdapter {
  build: Build | null = null;
  scenarios: Scenario[] = [];
  options: StartDefenceSearchWorkerOptions | undefined;
  canceledRequestIds: string[] = [];

  start(
    build: Build,
    scenarios: Scenario[],
    options?: StartDefenceSearchWorkerOptions,
  ): ActiveDefenceSearchRequest {
    this.build = build;
    this.scenarios = scenarios;
    this.options = options;

    return {
      requestId: options?.requestId ?? "fake-request",
      cancel: () => {
        this.canceledRequestIds.push(options?.requestId ?? "fake-request");
      },
    };
  }
}

const makeCandidate = (id: string, rank: number, hp: number, def: number, spd: number): CandidateResult => ({
  id,
  rank,
  candidate: { hp, def, spd },
  appliedStatPoints: { hp, atk: 0, def, spa: 0, spd, spe: 0 },
  appliedEvs: { hp, atk: 0, def, spa: 0, spd, spe: 0 },
  usedStatPointBudget: hp + def + spd,
  remainingStatPointBudget: 66 - hp - def - spd,
  usedEvBudget: hp + def + spd,
  remainingEvBudget: 66 - hp - def - spd,
  passed: true,
  scenarioResults: [],
  bottleneckLabel: "シナリオA +100.0%",
});

describe("buildDefenceSearchInput", () => {
  it("converts UI input to domain Build and Scenario with canonical names", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms();

    const input = buildDefenceSearchInput(target, scenarios);

    expect(input.build.pokemon.canonicalName).toBe("Starmie-Mega");
    expect(input.build.pokemon.displayNameJa).toBe("メガスターミー");
    expect(input.build.nature?.canonicalName).toBe("Modest");
    expect(input.build.teraType).toBeUndefined();
    expect(input.build.statPoints).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(input.build.evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(input.scenarios[0].hits[0].attacker.pokemon.canonicalName).toBe("Kingambit");
    expect(input.scenarios[0].hits[0].attacker.nature?.canonicalName).toBe("Adamant");
    expect(input.scenarios[0].hits[0].attacker.ability?.canonicalName).toBe("Defiant");
    expect(input.scenarios[0].hits[0].attacker.statPoints?.atk).toBe(32);
    expect(input.scenarios[0].hits[0].attacker.statPoints?.spa).toBe(32);
    expect(input.scenarios[0].hits[0].attacker.evs.atk).toBe(252);
    expect(input.scenarios[0].hits[0].attacker.evs.spa).toBe(252);
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Sucker Punch");
    expect(input.scenarios).toHaveLength(1);
  });

  it("passes a Tera type only when the field is explicitly enabled", () => {
    const target = {
      ...createDefaultTargetForm(),
      teraTypeInput: "ドラゴン",
      teraEnabled: true,
    };

    const input = buildDefenceSearchInput(target, createDefaultScenarioForms());

    expect(input.build.teraType?.canonicalName).toBe("Dragon");
  });

  it("does not treat a memoized Tera type as active until enabled", () => {
    const target = {
      ...createDefaultTargetForm(),
      teraTypeInput: "ドラゴン",
      teraEnabled: false,
    };

    const input = buildDefenceSearchInput(target, createDefaultScenarioForms());

    expect(input.build.teraType).toBeUndefined();
  });

  it("passes Dynamax state for target and attacker builds", () => {
    const target = {
      ...createDefaultTargetForm(),
      dmaxEnabled: true,
    };
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarios = [
      {
        ...defaultScenario,
        attacks: defaultScenario.attacks.map((attack) => ({
          ...attack,
          attackerDmaxEnabled: true,
        })),
      },
    ];

    const input = buildDefenceSearchInput(target, scenarios);

    expect(input.build.isDynamaxed).toBe(true);
    expect(input.scenarios[0].hits[0].attacker.isDynamaxed).toBe(true);
  });

  it("treats explicit Gmax forms as Dynamaxed builds", () => {
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "フシギバナ キョダイマックスのすがた",
    };

    const input = buildDefenceSearchInput(target, createDefaultScenarioForms());

    expect(input.build.pokemon.canonicalName).toBe("Venusaur-Gmax");
    expect(input.build.isDynamaxed).toBe(true);
  });

  it("converts generated option data from all free-text UI fields", () => {
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "ガオガエン",
      natureInput: "おくびょう",
      abilityInput: "もうか",
      itemInput: "とつげきチョッキ",
      teraTypeInput: "あく",
      teraEnabled: true,
      boosts: { atk: 0, def: 2, spa: 0, spd: -6, spe: 0 },
    };
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarios = [
      {
        ...defaultScenario,
        attacks: defaultScenario.attacks.map((attack) => ({
          ...attack,
          attackerPokemonInput: "ガオガエン",
          attackerNatureInput: "おくびょう",
          attackerAbilityInput: "もうか",
          attackerItemInput: "とつげきチョッキ",
          attackerTeraTypeInput: "あく",
          attackerTeraEnabled: true,
          attackerStatus: "brn" as const,
          moveInput: "インファイト",
          attackerBoosts: { atk: 2, def: 0, spa: 0, spd: 0, spe: 0 },
          defenderBoosts: { def: 1, spd: 0 },
          gameType: "doubles" as const,
        })),
      },
    ];

    const input = buildDefenceSearchInput(target, scenarios);

    expect(input.build.pokemon.canonicalName).toBe("Incineroar");
    expect(input.build.nature?.canonicalName).toBe("Timid");
    expect(input.build.ability?.canonicalName).toBe("Blaze");
    expect(input.build.item?.canonicalName).toBe("Assault Vest");
    expect(input.build.teraType?.canonicalName).toBe("Dark");
    expect(input.scenarios[0].hits[0].attacker.pokemon.canonicalName).toBe("Incineroar");
    expect(input.scenarios[0].hits[0].attacker.teraType?.canonicalName).toBe("Dark");
    expect(input.scenarios[0].hits[0].attacker.status).toBe("brn");
    expect(input.scenarios[0].hits[0].attackerBoosts.atk).toBe(2);
    expect(input.scenarios[0].hits[0].defenderBoosts.def).toBe(3);
    expect(input.scenarios[0].hits[0].defenderBoosts.spd).toBe(-6);
    expect(input.scenarios[0].hits[0].field?.gameType).toBe("doubles");
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Close Combat");
  });

  it("ignores disabled blank scenarios before canonical name resolution", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const disabledBlankScenario = {
      ...defaultScenario,
      id: "disabled-blank",
      enabled: false,
      attacks: defaultScenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "",
        moveInput: "",
      })),
    };

    const input = buildDefenceSearchInput(target, [defaultScenario, disabledBlankScenario]);

    expect(input.scenarios).toHaveLength(1);
    expect(input.scenarios[0].id).toBe(defaultScenario.id);
  });

  it("keeps multiple attacks in one scenario as cumulative hits", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const multiAttackScenario = {
      ...defaultScenario,
      attacks: [
        defaultScenario.attacks[0],
        {
          ...defaultScenario.attacks[0],
          id: "attack-b",
          label: "攻撃B",
          attackerPokemonInput: "ガブリアス",
          attackerNatureInput: "ようき",
          attackerStatPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
          moveInput: "げきりん",
          requiredSurvivedHits: 2,
          minSurvivalProbabilityPercent: 80,
          weather: "rain" as const,
          terrain: "electric" as const,
        },
      ],
    };

    const input = buildDefenceSearchInput(target, [multiAttackScenario]);

    expect(input.scenarios).toHaveLength(1);
    expect(input.scenarios[0].hits).toHaveLength(2);
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Sucker Punch");
    expect(input.scenarios[0].hits[1].attacker.pokemon.canonicalName).toBe("Garchomp");
    expect(input.scenarios[0].hits[1].move.canonicalName).toBe("Outrage");
    expect(input.scenarios[0].hits[1].field).toEqual({ gameType: "singles", weather: "rain", terrain: "electric" });
    expect(input.scenarios[0].hits[1].constraint).toMatchObject({
      requiredSurvivedHits: 2,
      minSurvivalProbability: 0.8,
    });
    expect(input.scenarios[0].constraint.requiredSurvivedHits).toBe(2);
  });

  it("does not let a later attack card default ignore previous cumulative hits", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const multiAttackScenario = {
      ...defaultScenario,
      attacks: [
        defaultScenario.attacks[0],
        {
          ...defaultScenario.attacks[0],
          id: "attack-b",
          label: "攻撃B",
          attackerPokemonInput: "ガブリアス",
          attackerNatureInput: "ようき",
          moveInput: "げきりん",
          requiredSurvivedHits: 1,
        },
      ],
    };

    const input = buildDefenceSearchInput(target, [multiAttackScenario]);

    expect(input.scenarios[0].hits[1].constraint?.requiredSurvivedHits).toBe(2);
  });

  it("treats completely blank attack cards as drafts", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarioWithDraft = {
      ...defaultScenario,
      attacks: [
        defaultScenario.attacks[0],
        {
          ...defaultScenario.attacks[0],
          id: "attack-draft",
          label: "攻撃B",
          attackerPokemonInput: "",
          attackerAbilityInput: "",
          moveInput: "",
        },
      ],
    };

    const input = buildDefenceSearchInput(target, [scenarioWithDraft]);

    expect(input.scenarios[0].hits).toHaveLength(1);
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Sucker Punch");
  });

  it("uses a move-less attack card as an active ally ability in doubles", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarioWithBatterySupport = {
      ...defaultScenario,
      attacks: [
        {
          ...defaultScenario.attacks[0],
          gameType: "doubles" as const,
        },
        {
          ...defaultScenario.attacks[0],
          id: "attack-b",
          label: "攻撃B",
          attackerPokemonInput: "デンヂムシ",
          attackerNatureInput: "",
          attackerAbilityInput: "バッテリー",
          attackerItemInput: "",
          moveInput: "",
          gameType: "doubles" as const,
        },
      ],
    };

    const input = buildDefenceSearchInput(target, [scenarioWithBatterySupport]);

    expect(input.scenarios[0].hits).toHaveLength(1);
    expect(input.scenarios[0].hits[0].allyAbilities?.map((ability) => ability.canonicalName)).toEqual([
      "Battery",
    ]);
  });

  it("passes Friend Guard as a defender-side effect only in doubles", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const [defaultAttack] = defaultScenario.attacks;

    const doublesInput = buildDefenceSearchInput(target, [{
      ...defaultScenario,
      attacks: [{
        ...defaultAttack,
        gameType: "doubles" as const,
        friendGuard: true,
      }],
    }]);
    const singlesInput = buildDefenceSearchInput(target, [{
      ...defaultScenario,
      attacks: [{
        ...defaultAttack,
        gameType: "singles" as const,
        friendGuard: true,
      }],
    }]);

    expect(doublesInput.scenarios[0].hits[0].defenderSide.friendGuard).toBe(true);
    expect(singlesInput.scenarios[0].hits[0].defenderSide.friendGuard).toBe(false);
  });

  it("lets two attacking cards supply their abilities to each other in doubles", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarioWithTwoAttackers = {
      ...defaultScenario,
      attacks: [
        {
          ...defaultScenario.attacks[0],
          attackerAbilityInput: "プラス",
          gameType: "doubles" as const,
        },
        {
          ...defaultScenario.attacks[0],
          id: "attack-b",
          label: "攻撃B",
          attackerPokemonInput: "デンヂムシ",
          attackerAbilityInput: "バッテリー",
          moveInput: "10まんボルト",
          gameType: "doubles" as const,
        },
      ],
    };

    const input = buildDefenceSearchInput(target, [scenarioWithTwoAttackers]);

    expect(input.scenarios[0].hits).toHaveLength(2);
    expect(input.scenarios[0].hits[0].allyAbilities?.[0].canonicalName).toBe("Battery");
    expect(input.scenarios[0].hits[1].allyAbilities?.[0].canonicalName).toBe("Plus");
  });

  it("does not apply another attack card's ability to a singles hit", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const singlesScenarioWithSupport = {
      ...defaultScenario,
      attacks: [
        defaultScenario.attacks[0],
        {
          ...defaultScenario.attacks[0],
          id: "attack-b",
          label: "攻撃B",
          attackerPokemonInput: "デンヂムシ",
          attackerAbilityInput: "バッテリー",
          moveInput: "",
        },
      ],
    };

    const input = buildDefenceSearchInput(target, [singlesScenarioWithSupport]);

    expect(input.scenarios[0].hits[0].allyAbilities).toBeUndefined();
  });

  it("requires at least one enabled scenario", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      enabled: false,
    }));

    expect(() => buildDefenceSearchInput(target, scenarios)).toThrow("有効な仮想敵シナリオがありません");
  });
});

describe("searchUiReducer", () => {
  it("reflects progress, partialResult, and complete messages for the active request", () => {
    const candidate = makeCandidate("candidate-1", 1, 4, 0, 0);
    let state = createInitialSearchUiState();

    state = searchUiReducer(state, { type: "start", requestId: "request-a" });
    state = searchUiReducer(state, {
      type: "progress",
      requestId: "request-a",
      searchedCandidates: 5,
      totalCandidates: 20,
      progress: 0.25,
    });
    state = searchUiReducer(state, {
      type: "partialResult",
      requestId: "request-a",
      candidates: [candidate],
    });
    state = searchUiReducer(state, {
      type: "complete",
      requestId: "request-a",
      candidates: [candidate],
    });

    expect(state.status).toBe("complete");
    expect(state.progress).toBe(1);
    expect(state.searchedCandidates).toBe(5);
    expect(state.candidates).toEqual([candidate]);
  });

  it("does not adopt cancel results or stale requestId messages", () => {
    const staleCandidate = makeCandidate("candidate-old", 1, 252, 252, 252);
    const currentCandidate = makeCandidate("candidate-new", 1, 4, 0, 0);
    let state = createInitialSearchUiState();

    state = searchUiReducer(state, { type: "start", requestId: "old-request" });
    state = searchUiReducer(state, { type: "cancel", requestId: "old-request" });
    state = searchUiReducer(state, {
      type: "complete",
      requestId: "old-request",
      candidates: [staleCandidate],
    });

    expect(state.status).toBe("canceled");
    expect(state.candidates).toEqual([]);

    state = searchUiReducer(state, { type: "start", requestId: "new-request" });
    state = searchUiReducer(state, {
      type: "partialResult",
      requestId: "old-request",
      candidates: [staleCandidate],
    });
    state = searchUiReducer(state, {
      type: "partialResult",
      requestId: "new-request",
      candidates: [currentCandidate],
    });

    expect(state.candidates).toEqual([currentCandidate]);
  });
});

describe("startDefenceSearchFromUi", () => {
  it("calls the Worker client and wires callbacks into UI state", () => {
    const client = new FakeWorkerClient();
    let state = createInitialSearchUiState();
    const dispatch = (action: Parameters<typeof searchUiReducer>[1]) => {
      state = searchUiReducer(state, action);
    };
    const candidate = makeCandidate("candidate-1", 1, 8, 0, 0);

    const { request } = startDefenceSearchFromUi(
      client,
      createDefaultTargetForm(),
      createDefaultScenarioForms(),
      dispatch,
      { requestId: "request-ui", maxResults: 3 },
    );

    expect(request.requestId).toBe("request-ui");
    expect(state.status).toBe("running");
    expect(client.build?.pokemon.canonicalName).toBe("Starmie-Mega");
    expect(client.scenarios[0].hits[0].move.canonicalName).toBe("Sucker Punch");
    expect(client.options?.maxResults).toBe(3);

    client.options?.callbacks?.onProgress?.({
      type: "progress",
      requestId: "request-ui",
      searchedCandidates: 10,
      totalCandidates: 40,
      progress: 0.25,
    });
    client.options?.callbacks?.onPartialResult?.({
      type: "partialResult",
      requestId: "request-ui",
      candidates: [candidate],
    });
    client.options?.callbacks?.onComplete?.({
      type: "complete",
      requestId: "request-ui",
      candidates: [candidate],
    });

    expect(state.status).toBe("complete");
    expect(state.searchedCandidates).toBe(10);
    expect(state.candidates).toEqual([candidate]);
  });
});

describe("applyTopCandidateToTarget", () => {
  it("applies the first candidate H/B/D SP to the target form", () => {
    const target = createDefaultTargetForm();
    const applied = applyTopCandidateToTarget(target, [
      makeCandidate("candidate-1", 1, 12, 20, 28),
      makeCandidate("candidate-2", 2, 32, 32, 32),
    ]);

    expect(applied.statPoints).toMatchObject({ hp: 12, def: 20, spd: 28 });
    expect(applied.statPoints.atk).toBe(target.statPoints.atk);
    expect(applied.statPoints.spa).toBe(target.statPoints.spa);
    expect(applied.statPoints.spe).toBe(target.statPoints.spe);
  });
});
