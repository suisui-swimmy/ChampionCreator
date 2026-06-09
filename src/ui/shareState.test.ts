import { describe, expect, it } from "vitest";
import {
  createDefaultOffenseAdjustmentForm,
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./defenceSearchUi";
import {
  SHARE_SCHEMA_VERSION,
  parseShareStateDocument,
  stringifyShareStateDocument,
} from "./shareState";

describe("shareState", () => {
  it("round-trips target and scenario form state as versioned JSON", () => {
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "オオニューラ",
      teraTypeInput: "かくとう",
      teraEnabled: true,
      dmaxEnabled: true,
      boosts: { atk: 0, def: 2, spa: 0, spd: -1, spe: 0 },
    };
    const scenarios = createDefaultScenarioForms().map((scenario, index) => ({
      ...scenario,
      label: "対オオニューラ",
      adjustmentType: index === 1 ? "speed" as const : scenario.adjustmentType,
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "オオニューラ",
        moveInput: "インファイト",
        attackerTeraTypeInput: "かくとう",
        attackerTeraEnabled: true,
        attackerDmaxEnabled: true,
        defenderStatus: "brn" as const,
        attackerBoosts: { ...attack.attackerBoosts, atk: 2 },
        gameType: "doubles" as const,
        speedComparison: "tie" as const,
        speedTargetValue: 220,
        speedItemMultiplier: "1.5" as const,
        speedAbilityMultiplier: "2" as const,
        tailwind: true,
      })),
    }));
    const offenseAdjustment = {
      ...createDefaultOffenseAdjustmentForm(),
      defenderPokemonInput: "ピチュー",
      moveInput: "インファイト",
      targetKoProbabilityPercent: 75,
      defenderStatPoints: { ...createDefaultOffenseAdjustmentForm().defenderStatPoints, hp: 4, def: 2 },
    };

    const parsed = parseShareStateDocument(stringifyShareStateDocument(target, scenarios, offenseAdjustment));

    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed.target).toMatchObject({
      pokemonInput: "オオニューラ",
      teraTypeInput: "かくとう",
      teraEnabled: true,
      dmaxEnabled: true,
      boosts: { def: 2, spd: -1 },
    });
    expect(parsed.scenarios[0].label).toBe("対オオニューラ");
    expect(parsed.scenarios[1].adjustmentType).toBe("speed");
    expect(parsed.scenarios[0].attacks[0]).toMatchObject({
      attackerPokemonInput: "オオニューラ",
      moveInput: "インファイト",
      attackerTeraEnabled: true,
      attackerDmaxEnabled: true,
      defenderStatus: "brn",
      gameType: "doubles",
      speedComparison: "tie",
      speedTargetValue: 220,
      speedItemMultiplier: "1.5",
      speedAbilityMultiplier: "2",
      tailwind: true,
    });
    expect(parsed.offenseAdjustment).toMatchObject({
      defenderPokemonInput: "ピチュー",
      moveInput: "インファイト",
      targetKoProbabilityPercent: 75,
      defenderStatPoints: { hp: 4, def: 2 },
    });
  });

  it("rejects unsupported schema versions", () => {
    expect(() => parseShareStateDocument(JSON.stringify({
      schemaVersion: 999,
      target: {},
      scenarios: [],
    }))).toThrow("対応していない条件JSON");
  });

  it("fills missing target boosts from defaults when importing older JSON", () => {
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 1,
      target: {
        pokemonInput: "メガスターミー",
      },
      scenarios: createDefaultScenarioForms(),
    }));

    expect(parsed.target.boosts).toEqual({
      atk: 0,
      def: 0,
      spa: 0,
      spd: 0,
      spe: 0,
    });
    expect(parsed.offenseAdjustment).toEqual(createDefaultOffenseAdjustmentForm());
  });

  it("moves the legacy target status into scenario attacks when importing older JSON", () => {
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 1,
      target: {
        ...createDefaultTargetForm(),
        status: "par",
      },
      scenarios: createDefaultScenarioForms().map((scenario) => ({
        ...scenario,
        attacks: scenario.attacks.map(({ defenderStatus: _defenderStatus, ...attack }) => attack),
      })),
    }));

    expect("status" in parsed.target).toBe(false);
    expect(parsed.scenarios[0].attacks[0].defenderStatus).toBe("par");
  });
});
