import { describe, expect, it } from "vitest";
import { createDefaultScenarioForms, createDefaultTargetForm } from "./defenceSearchUi";
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
      status: "brn" as const,
      boosts: { atk: 0, def: 2, spa: 0, spd: -1, spe: 0 },
    };
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      label: "対オオニューラ",
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "オオニューラ",
        moveInput: "インファイト",
        attackerTeraTypeInput: "かくとう",
        attackerTeraEnabled: true,
        attackerDmaxEnabled: true,
        attackerBoosts: { ...attack.attackerBoosts, atk: 2 },
        gameType: "doubles" as const,
      })),
    }));

    const parsed = parseShareStateDocument(stringifyShareStateDocument(target, scenarios));

    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed.target).toMatchObject({
      pokemonInput: "オオニューラ",
      teraTypeInput: "かくとう",
      teraEnabled: true,
      dmaxEnabled: true,
      status: "brn",
      boosts: { def: 2, spd: -1 },
    });
    expect(parsed.scenarios[0].label).toBe("対オオニューラ");
    expect(parsed.scenarios[0].attacks[0]).toMatchObject({
      attackerPokemonInput: "オオニューラ",
      moveInput: "インファイト",
      attackerTeraEnabled: true,
      attackerDmaxEnabled: true,
      gameType: "doubles",
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
      schemaVersion: SHARE_SCHEMA_VERSION,
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
  });
});
