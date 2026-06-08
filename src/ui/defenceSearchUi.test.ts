import { describe, expect, it } from "vitest";
import type { Build, CandidateResult, Scenario } from "../domain/model";
import type {
  ActiveDefenceSearchRequest,
  StartDefenceSearchWorkerOptions,
} from "../worker/defenceSearchWorkerClient";
import {
  applyCandidateToTarget,
  applyOffenseAdjustmentToTarget,
  applyTopCandidateToTarget,
  buildOffenseAdjustmentInput,
  buildDefenceSearchInput,
  buildIntegratedDefenceSearchInput,
  calculateOffenseAdjustmentFromUi,
  calculateOffenseAdjustmentsForCandidateRanking,
  calculateOffenseAdjustmentsFromScenarios,
  createOffenseAdjustmentFormFromScenarioAttack,
  createDefaultOffenseAdjustmentForm,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  createInitialSearchUiState,
  resolveIntegratedOffenseRequirements,
  applyIntegratedOffenseRequirementsToTargetForm,
  searchUiReducer,
  startDefenceSearchFromUi,
  type DefenceSearchWorkerClientAdapter,
  type OffenseScenarioResult,
} from "./defenceSearchUi";
import type { OffenseAdjustmentResult } from "../search/offenseAdjustment";

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

const makeOffenseResult = (
  attackId: string,
  result: Partial<OffenseAdjustmentResult> = {},
): OffenseScenarioResult => ({
  id: `scenario-offense-${attackId}-${result.id ?? "line"}`,
  scenarioId: "scenario-offense",
  scenarioLabel: "火力A",
  attackId,
  attackLabel: attackId,
  result: {
    id: result.id ?? "line",
    status: result.status ?? "pass",
    passed: result.passed ?? true,
    label: result.label ?? "Aライン",
    owner: result.owner ?? "attacker",
    stat: result.stat ?? "atk",
    role: result.role ?? "damage",
    canApply: result.canApply ?? true,
    requiredStatPoints: result.requiredStatPoints ?? 0,
    actualStat: result.actualStat ?? 100,
    koProbability: result.koProbability ?? 1,
    targetKoProbability: result.targetKoProbability ?? 1,
    damageRange: result.damageRange ?? null,
    reason: result.reason ?? "火力条件を満たします",
    reference: result.reference,
  },
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
    expect(input.build.status).toBeUndefined();
    expect(input.scenarios[0].hits[0].attacker.pokemon.canonicalName).toBe("Incineroar");
    expect(input.scenarios[0].hits[0].attacker.teraType?.canonicalName).toBe("Dark");
    expect(input.scenarios[0].hits[0].attacker.status).toBe("brn");
    expect(input.scenarios[0].hits[0].attackerBoosts.atk).toBe(2);
    expect(input.scenarios[0].hits[0].defenderBoosts.def).toBe(3);
    expect(input.scenarios[0].hits[0].defenderBoosts.spd).toBe(-6);
    expect(input.scenarios[0].hits[0].field?.gameType).toBe("doubles");
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Close Combat");
  });

  it("passes the scenario-specific target status to each hit", () => {
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarios = [{
      ...defaultScenario,
      attacks: defaultScenario.attacks.map((attack) => ({
        ...attack,
        defenderStatus: "psn" as const,
      })),
    }];

    const input = buildDefenceSearchInput(createDefaultTargetForm(), scenarios);

    expect(input.build.status).toBeUndefined();
    expect(input.scenarios[0].hits[0].defenderStatus).toBe("psn");
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

  it("passes Sword of Ruin from a move-less Chien-Pao only to a doubles hit", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const supportCard = {
      ...defaultScenario.attacks[0],
      id: "attack-b",
      label: "攻撃B",
      attackerPokemonInput: "パオジアン",
      attackerNatureInput: "",
      attackerAbilityInput: "わざわいのつるぎ",
      attackerItemInput: "",
      moveInput: "",
    };
    const singlesInput = buildDefenceSearchInput(target, [{
      ...defaultScenario,
      attacks: [defaultScenario.attacks[0], supportCard],
    }]);
    const doublesInput = buildDefenceSearchInput(target, [{
      ...defaultScenario,
      attacks: [
        { ...defaultScenario.attacks[0], gameType: "doubles" as const },
        { ...supportCard, gameType: "doubles" as const },
      ],
    }]);

    expect(singlesInput.scenarios[0].hits[0].allyAbilities).toBeUndefined();
    expect(doublesInput.scenarios[0].hits[0].allyAbilities?.map((ability) => ability.canonicalName)).toEqual([
      "Sword of Ruin",
    ]);
  });

  it("requires at least one enabled scenario", () => {
    const target = createDefaultTargetForm();
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      enabled: false,
    }));

    expect(() => buildDefenceSearchInput(target, scenarios)).toThrow("有効な耐久調整シナリオがありません");
  });

  it("ignores offense scenarios when building H/B/D defence search input", () => {
    const target = createDefaultTargetForm();
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarios = [
      { ...defaultScenario, id: "scenario-offense", adjustmentType: "offense" as const },
      { ...defaultScenario, id: "scenario-defence", label: "耐久だけ", adjustmentType: "defence" as const },
    ];

    const input = buildDefenceSearchInput(target, scenarios);

    expect(input.scenarios).toHaveLength(1);
    expect(input.scenarios[0]).toMatchObject({
      id: "scenario-defence",
      label: "耐久だけ",
    });
  });
});

describe("buildOffenseAdjustmentInput", () => {
  it("converts an offense scenario attack into offense adjustment form state", () => {
    const [scenario] = createDefaultScenarioForms();
    const attack = {
      ...scenario.attacks[0],
      attackerPokemonInput: "ピチュー",
      attackerStatus: "par" as const,
      attackerStatPoints: { ...scenario.attacks[0].attackerStatPoints, hp: 4, def: 2 },
      attackerBoosts: { ...scenario.attacks[0].attackerBoosts, def: 1 },
      moveInput: "インファイト",
      targetKoProbabilityPercent: 75,
      reflect: true,
    };

    const offense = createOffenseAdjustmentFormFromScenarioAttack(attack);

    expect(offense).toMatchObject({
      defenderPokemonInput: "ピチュー",
      defenderStatus: "par",
      defenderStatPoints: { hp: 4, def: 2 },
      defenderBoosts: { def: 1 },
      moveInput: "インファイト",
      targetKoProbabilityPercent: 75,
      reflect: true,
    });
  });

  it("converts target form as attacker and offense form as defender", () => {
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "オオニューラ",
      natureInput: "いじっぱり",
      statPoints: { hp: 0, atk: 12, def: 0, spa: 0, spd: 0, spe: 20 },
      boosts: { atk: 1, def: 0, spa: 0, spd: 0, spe: 0 },
    };
    const offense = {
      ...createDefaultOffenseAdjustmentForm(),
      defenderPokemonInput: "ピチュー",
      defenderStatus: "par" as const,
      defenderStatPoints: { hp: 4, atk: 0, def: 2, spa: 0, spd: 0, spe: 0 },
      moveInput: "インファイト",
      targetKoProbabilityPercent: 75,
      reflect: true,
    };

    const input = buildOffenseAdjustmentInput(target, offense);

    expect(input.attackerBuild.pokemon.canonicalName).toBe("Sneasler");
    expect(input.attackerBuild.statPoints?.atk).toBe(12);
    expect(input.defenderBuild.pokemon.canonicalName).toBe("Pichu");
    expect(input.defenderBuild.status).toBe("par");
    expect(input.defenderBuild.statPoints?.hp).toBe(4);
    expect(input.move.canonicalName).toBe("Close Combat");
    expect(input.targetKoProbability).toBe(0.75);
    expect(input.attackerBoosts.atk).toBe(1);
    expect(input.defenderSide.reflect).toBe(true);
  });

  it("returns unresolved offense results without throwing when the move cannot be resolved", () => {
    const results = calculateOffenseAdjustmentFromUi(createDefaultTargetForm(), {
      ...createDefaultOffenseAdjustmentForm(),
      moveInput: "しらないわざ",
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: "unresolved",
      canApply: false,
    });
    expect(results[0].reason).toContain("canonical name に解決できません");
  });

  it("calculates offense results only from enabled offense scenarios", () => {
    const [defaultScenario] = createDefaultScenarioForms();
    const target = {
      ...createDefaultTargetForm(),
      statPoints: { hp: 0, atk: 12, def: 0, spa: 0, spd: 0, spe: 0 },
    };
    const scenarios = [
      {
        ...defaultScenario,
        id: "scenario-defence",
        adjustmentType: "defence" as const,
      },
      {
        ...defaultScenario,
        id: "scenario-offense",
        label: "火力A",
        adjustmentType: "offense" as const,
        attacks: defaultScenario.attacks.map((attack) => ({
          ...attack,
          label: "単発KO",
          attackerPokemonInput: "ピチュー",
          attackerNatureInput: "",
          attackerAbilityInput: "",
          moveInput: "ふいうち",
        })),
      },
    ];

    const results = calculateOffenseAdjustmentsFromScenarios(target, scenarios);

    expect(results).not.toHaveLength(0);
    expect(results.every((result) => result.scenarioId === "scenario-offense")).toBe(true);
    expect(results[0]).toMatchObject({
      scenarioLabel: "火力A",
      attackLabel: "単発KO",
    });
  });

  it("calculates offense lines from a H/B/D-neutral baseline for candidate ranking", () => {
    const [defaultScenario] = createDefaultScenarioForms();
    const target = {
      ...createDefaultTargetForm(),
      statPoints: { hp: 20, atk: 0, def: 20, spa: 0, spd: 20, spe: 0 },
    };
    const scenarios = [{
      ...defaultScenario,
      adjustmentType: "offense" as const,
      attacks: defaultScenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "ピチュー",
        attackerNatureInput: "",
        attackerAbilityInput: "",
        moveInput: "ボディプレス",
      })),
    }];

    const results = calculateOffenseAdjustmentsForCandidateRanking(target, scenarios);
    const bodyPress = results.find((entry) => entry.result.label === "Bライン")?.result;

    expect(bodyPress?.owner).toBe("attacker");
    expect(bodyPress?.stat).toBe("def");
    expect(bodyPress?.requiredStatPoints).not.toBeNull();
  });
});

describe("resolveIntegratedOffenseRequirements", () => {
  it("chooses the cheapest A/C line per attack and folds B/H lines into H/B/D minimums", () => {
    const target = {
      ...createDefaultTargetForm(),
      statPoints: { hp: 0, atk: 4, def: 0, spa: 0, spd: 0, spe: 8 },
    };

    const requirements = resolveIntegratedOffenseRequirements(target, [
      makeOffenseResult("adaptive", {
        id: "line-a",
        label: "Aライン",
        stat: "atk",
        requiredStatPoints: 20,
      }),
      makeOffenseResult("adaptive", {
        id: "line-c",
        label: "Cライン",
        stat: "spa",
        requiredStatPoints: 8,
      }),
      makeOffenseResult("body-press", {
        id: "line-b",
        label: "Bライン",
        stat: "def",
        canApply: false,
        requiredStatPoints: 12,
      }),
      makeOffenseResult("final-gambit", {
        id: "line-h",
        label: "Hライン",
        stat: "hp",
        canApply: false,
        requiredStatPoints: 6,
      }),
    ]);

    expect(requirements.fixedStatPoints).toMatchObject({ spa: 8 });
    expect(requirements.fixedStatPoints.atk).toBe(0);
    expect(requirements.minimumStatPoints).toMatchObject({ hp: 6, def: 12 });
    expect(requirements.selectedResults.map((entry) => entry.result.label)).toEqual([
      "Cライン",
      "Bライン",
      "Hライン",
    ]);
  });

  it("reports blocking offense lines that cannot be satisfied by the target spread", () => {
    const requirements = resolveIntegratedOffenseRequirements(createDefaultTargetForm(), [
      makeOffenseResult("failed", {
        status: "fail",
        passed: false,
        canApply: false,
        requiredStatPoints: 32,
        koProbability: 0.75,
        reason: "最大 32 SPでもKO条件に届きません",
      }),
    ]);

    expect(requirements.blockingReasons[0]).toContain("最大 32 SPでもKO条件に届きません");
  });

  it("applies integrated A/C requirements without mutating H/B/D form values", () => {
    const target = {
      ...createDefaultTargetForm(),
      statPoints: { hp: 10, atk: 4, def: 11, spa: 0, spd: 12, spe: 8 },
    };
    const applied = applyIntegratedOffenseRequirementsToTargetForm(target, {
      fixedStatPoints: { atk: 2, spa: 18 },
      minimumStatPoints: { hp: 6, def: 4 },
      selectedResults: [],
      blockingReasons: [],
    });

    expect(applied.statPoints).toEqual({ hp: 10, atk: 4, def: 11, spa: 18, spd: 12, spe: 8 });
  });

  it("builds an integrated search input with offense A/C fixed and H/B/D minimums", () => {
    const [defaultScenario] = createDefaultScenarioForms();
    const target = createDefaultTargetForm();
    const scenarios = [
      defaultScenario,
      {
        ...defaultScenario,
        id: "scenario-offense",
        label: "火力A",
        adjustmentType: "offense" as const,
        attacks: defaultScenario.attacks.map((attack) => ({
          ...attack,
          label: "ボディプレスKO",
          attackerPokemonInput: "ピチュー",
          attackerNatureInput: "",
          attackerAbilityInput: "",
          moveInput: "ボディプレス",
        })),
      },
    ];

    const input = buildIntegratedDefenceSearchInput(target, scenarios);

    expect(input.build.statPoints?.hp).toBe(0);
    expect(input.build.statPoints?.def).toBe(0);
    expect(input.minimumStatPoints?.def).toBeGreaterThanOrEqual(0);
    expect(input.scenarios).toHaveLength(1);
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
  it("applies the first candidate full SP spread to the target form", () => {
    const target = createDefaultTargetForm();
    const candidate = {
      ...makeCandidate("candidate-1", 1, 12, 20, 28),
      appliedStatPoints: { hp: 12, atk: 8, def: 20, spa: 4, spd: 28, spe: 2 },
    };
    const applied = applyTopCandidateToTarget(target, [
      candidate,
      makeCandidate("candidate-2", 2, 32, 32, 32),
    ]);

    expect(applied.statPoints).toEqual(candidate.appliedStatPoints);
  });

  it("applies a selected candidate full SP spread to the target form", () => {
    const target = createDefaultTargetForm();
    const candidate = {
      ...makeCandidate("candidate-3", 3, 4, 18, 7),
      appliedStatPoints: { hp: 4, atk: 16, def: 18, spa: 0, spd: 7, spe: 6 },
    };
    const applied = applyCandidateToTarget(
      target,
      candidate,
    );

    expect(applied.statPoints).toEqual(candidate.appliedStatPoints);
  });
});

describe("applyOffenseAdjustmentToTarget", () => {
  it("applies only A/C offense lines to target fixed SP", () => {
    const target = createDefaultTargetForm();
    const applied = applyOffenseAdjustmentToTarget(target, {
      id: "line-a",
      status: "pass",
      passed: true,
      label: "Aライン",
      owner: "attacker",
      stat: "atk",
      role: "damage",
      canApply: true,
      requiredStatPoints: 24,
      actualStat: 180,
      koProbability: 1,
      targetKoProbability: 1,
      damageRange: null,
      reason: "Aライン 24 SPでKO条件を満たします",
    });

    expect(applied.statPoints).toMatchObject({ atk: 24, hp: 0, def: 0, spd: 0, spe: 0 });
  });

  it("does not apply B/H or target-reference offense lines", () => {
    const target = createDefaultTargetForm();
    const applied = applyOffenseAdjustmentToTarget(target, {
      id: "line-b",
      status: "pass",
      passed: true,
      label: "Bライン",
      owner: "attacker",
      stat: "def",
      role: "damage",
      canApply: false,
      requiredStatPoints: 24,
      actualStat: 180,
      koProbability: 1,
      targetKoProbability: 1,
      damageRange: null,
      reason: "Bライン 24 SPでKO条件を満たします",
    });

    expect(applied).toBe(target);
  });
});
