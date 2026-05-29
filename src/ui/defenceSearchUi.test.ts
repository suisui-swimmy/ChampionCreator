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

    expect(input.build.pokemon.canonicalName).toBe("Dragonite");
    expect(input.build.pokemon.displayNameJa).toBe("カイリュー");
    expect(input.build.nature?.canonicalName).toBe("Modest");
    expect(input.build.teraType?.canonicalName).toBe("Dragon");
    expect(input.build.statPoints).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(input.build.evs).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(input.scenarios[0].hits[0].attacker.pokemon.canonicalName).toBe("Pikachu");
    expect(input.scenarios[0].hits[0].attacker.statPoints?.spa).toBe(32);
    expect(input.scenarios[0].hits[0].attacker.evs.spa).toBe(252);
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Thunderbolt");
    expect(input.scenarios).toHaveLength(1);
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
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Thunderbolt");
    expect(input.scenarios[0].hits[1].attacker.pokemon.canonicalName).toBe("Garchomp");
    expect(input.scenarios[0].hits[1].move.canonicalName).toBe("Outrage");
    expect(input.scenarios[0].hits[1].field).toEqual({ weather: "rain", terrain: "electric" });
    expect(input.scenarios[0].hits[1].constraint).toMatchObject({
      requiredSurvivedHits: 2,
      minSurvivalProbability: 0.8,
    });
    expect(input.scenarios[0].constraint.requiredSurvivedHits).toBe(2);
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
          moveInput: "",
        },
      ],
    };

    const input = buildDefenceSearchInput(target, [scenarioWithDraft]);

    expect(input.scenarios[0].hits).toHaveLength(1);
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Thunderbolt");
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
    expect(client.build?.pokemon.canonicalName).toBe("Dragonite");
    expect(client.scenarios[0].hits[0].move.canonicalName).toBe("Thunderbolt");
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
