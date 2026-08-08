import { describe, expect, it } from "vitest";
import {
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
        speedTargetMode: "manual" as const,
        speedComparison: "outspeed" as const,
        speedRequiredOffset: 4,
        speedTargetValue: 220,
        speedItemMultiplier: "1.5" as const,
        speedAbilityMultiplier: "2" as const,
        speedMoveModifier: "trick-room" as const,
        hpEvents: [{
          id: "event-life-orb",
          effectId: "life-orb-recoil",
          enabled: true,
        }],
      })),
    }));
    const serialized = stringifyShareStateDocument(target, scenarios);
    const parsed = parseShareStateDocument(serialized);

    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(serialized).not.toContain("\"offenseAdjustment\"");
    expect(serialized).not.toContain("ピチュー");
    expect(serialized).not.toContain("\"timing\"");
    expect(serialized).not.toContain("\"subject\"");
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
      speedTargetMode: "manual",
      speedComparison: "outspeed",
      speedRequiredOffset: 4,
      speedTargetValue: 220,
      speedItemMultiplier: "1.5",
      speedAbilityMultiplier: "2",
      speedMoveModifier: "trick-room",
      hpEvents: [{
        id: "event-life-orb",
        effectId: "life-orb-recoil",
        enabled: true,
      }],
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
    expect(parsed).not.toHaveProperty("offenseAdjustment");
  });

  it("imports schema v6 JSON while dropping the unused offense adjustment", () => {
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 6,
      target: createDefaultTargetForm(),
      scenarios: createDefaultScenarioForms(),
      offenseAdjustment: {
        defenderPokemonInput: "ピチュー",
        moveInput: "ふいうち",
      },
    }));

    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed).not.toHaveProperty("offenseAdjustment");
    expect(stringifyShareStateDocument(parsed.target, parsed.scenarios)).not.toContain("ピチュー");
  });

  it.each([1, 2] as const)("migrates schema version %s attacks without HP events", (schemaVersion) => {
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        hpEvents: [{
          id: "legacy-event",
          effectId: "life-orb-recoil",
          enabled: true,
          subject: "target",
          timing: "afterMove",
        }],
      })),
    }));
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion,
      target: createDefaultTargetForm(),
      scenarios,
    }));

    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed.scenarios[0].attacks[0].hpEvents).toEqual([]);
  });

  it.each([3, 4, 5, 6] as const)(
    "migrates schema v%s events while ignoring legacy user-selected timing and subject",
    (schemaVersion) => {
      const [scenario] = createDefaultScenarioForms();
      const parsed = parseShareStateDocument(JSON.stringify({
        schemaVersion,
        target: createDefaultTargetForm(),
        scenarios: [{
          ...scenario,
          attacks: [{
            ...scenario.attacks[0],
            hpEvents: [
              {
                id: "future-event",
                effectId: "future-champions-effect",
                enabled: true,
                subject: "holder",
                timing: "onEntry",
              },
              {
                id: "known-event",
                effectId: "life-orb-recoil",
                enabled: true,
                subject: "opponent",
                timing: "endOfTurn",
              },
              {
                id: "known-invalid-subject",
                effectId: "sandstorm-damage",
                enabled: true,
                subject: "holder",
                timing: "beforeMove",
              },
            ],
          }],
        }],
      }));

      expect(parsed.scenarios[0].attacks[0].hpEvents).toEqual([
        {
          id: "future-event",
          effectId: "future-champions-effect",
          enabled: false,
        },
        {
          id: "known-event",
          effectId: "life-orb-recoil",
          enabled: true,
        },
        {
          id: "known-invalid-subject",
          effectId: "sandstorm-damage",
          enabled: true,
        },
      ]);
    },
  );

  it("round-trips and clamps toxic stages and Spikes layers", () => {
    const [scenario] = createDefaultScenarioForms();
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [{
          ...scenario.attacks[0],
          hpEvents: [
            {
              id: "toxic",
              effectId: "toxic-damage",
              enabled: true,
              toxicStage: 99,
            },
            {
              id: "spikes",
              effectId: "spikes-damage",
              enabled: true,
              spikesLayers: 0,
            },
          ],
        }],
      }],
    }));

    expect(parsed.scenarios[0].attacks[0].hpEvents).toEqual([
      {
        id: "toxic",
        effectId: "toxic-damage",
        enabled: true,
        toxicStage: 15,
      },
      {
        id: "spikes",
        effectId: "spikes-damage",
        enabled: true,
        spikesLayers: 1,
      },
    ]);
  });

  it("round-trips the contact recoil presets without changing schema shape", () => {
    const [scenario] = createDefaultScenarioForms();
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [{
          ...scenario.attacks[0],
          hpEvents: [
            {
              id: "helmet",
              effectId: "rocky-helmet-damage",
              enabled: true,
            },
            {
              id: "skin",
              effectId: "rough-skin-damage",
              enabled: true,
            },
          ],
        }],
      }],
    }));

    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed.scenarios[0].attacks[0].hpEvents).toEqual([
      {
        id: "helmet",
        effectId: "rocky-helmet-damage",
        enabled: true,
      },
      {
        id: "skin",
        effectId: "rough-skin-damage",
        enabled: true,
      },
    ]);
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

  it("restores legacy direct speed values as manual speed mode", () => {
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 1,
      target: createDefaultTargetForm(),
      scenarios: createDefaultScenarioForms().map((scenario) => ({
        ...scenario,
        adjustmentType: "speed",
        attacks: scenario.attacks.map(({ speedTargetMode: _speedTargetMode, ...attack }) => ({
          ...attack,
          attackerPokemonInput: "",
          speedTargetValue: 180,
        })),
      })),
    }));

    expect(parsed.scenarios[0].attacks[0].speedTargetMode).toBe("manual");
  });

  it("restores legacy tailwind speed conditions as the move modifier", () => {
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 1,
      target: createDefaultTargetForm(),
      scenarios: createDefaultScenarioForms().map((scenario) => ({
        ...scenario,
        adjustmentType: "speed",
        attacks: scenario.attacks.map(({ speedMoveModifier: _speedMoveModifier, ...attack }) => ({
          ...attack,
          tailwind: true,
        })),
      })),
    }));

    expect(parsed.scenarios[0].attacks[0].speedMoveModifier).toBe("tailwind");
  });

  it("falls back to default speed settings when imported JSON contains invalid values", () => {
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: createDefaultTargetForm(),
      scenarios: createDefaultScenarioForms().map((scenario) => ({
        ...scenario,
        adjustmentType: "speed",
        attacks: scenario.attacks.map((attack) => ({
          ...attack,
          speedComparison: "slower",
          speedItemMultiplier: "triple",
          speedAbilityMultiplier: "half-ish",
        })),
      })),
    }));

    expect(parsed.scenarios[0].attacks[0].speedComparison).toBe("outspeed");
    expect(parsed.scenarios[0].attacks[0].speedItemMultiplier).toBe("auto");
    expect(parsed.scenarios[0].attacks[0].speedAbilityMultiplier).toBe("auto");
  });
});
