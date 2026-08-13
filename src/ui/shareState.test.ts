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
      level: 73,
      levelMode: "manual" as const,
      boosts: { atk: 0, def: 2, spa: 0, spd: -1, spe: 0 },
    };
    const scenarios = createDefaultScenarioForms().map((scenario, index) => ({
      ...scenario,
      label: "対オオニューラ",
      adjustmentType: index === 1 ? "speed" as const : scenario.adjustmentType,
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "オオニューラ",
        moveInput: "おはかまいり",
        attackerLevel: 73,
        attackerLevelMode: "manual" as const,
        movePowerMode: "manual" as const,
        movePowerValue: 137,
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
      level: 73,
      levelMode: "manual",
      boosts: { def: 2, spd: -1 },
    });
    expect(parsed.scenarios[0].label).toBe("対オオニューラ");
    expect(parsed.scenarios[1].adjustmentType).toBe("speed");
    expect(parsed.scenarios[0].attacks[0]).toMatchObject({
      attackerPokemonInput: "オオニューラ",
      moveInput: "おはかまいり",
      attackerLevel: 73,
      attackerLevelMode: "manual",
      movePowerMode: "manual",
      movePowerValue: 137,
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

  it("migrates schema v7 attacks without move-power fields to auto", () => {
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      attacks: scenario.attacks.map(({
        movePowerMode: _movePowerMode,
        movePowerValue: _movePowerValue,
        ...attack
      }) => attack),
    }));
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 7,
      target: createDefaultTargetForm(),
      scenarios,
    }));

    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed.scenarios[0].attacks[0]).toMatchObject({
      movePowerMode: "auto",
      movePowerValue: 0,
    });
  });

  it.each([
    [{ movePowerValue: 0 }, "movePowerMode"],
    [{ movePowerMode: "future", movePowerValue: 80 }, "movePowerMode"],
    [{ movePowerMode: "auto", movePowerValue: 1 }, "movePowerValue"],
    [{ movePowerMode: "assisted", movePowerValue: 0 }, "movePowerValue"],
    [{ movePowerMode: "manual", movePowerValue: 10_001 }, "movePowerValue"],
    [{ movePowerMode: "manual", movePowerValue: "80" }, "movePowerValue"],
  ] as const)("rejects invalid move-power state %#", (movePower, expectedField) => {
    const [scenario] = createDefaultScenarioForms();
    const { movePowerMode: _movePowerMode, movePowerValue: _movePowerValue, ...attack } = scenario.attacks[0];

    expect(() => parseShareStateDocument(JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [{ ...attack, ...movePower }],
      }],
    }))).toThrow(expectedField);
  });

  it.each([
    ["じしん", "manual", 137],
    ["おはかまいり", "assisted", 125],
    ["未解決の技", "manual", 100],
  ] as const)("rejects a move-power override that cannot be applied: %s", (
    moveInput,
    movePowerMode,
    movePowerValue,
  ) => {
    const [scenario] = createDefaultScenarioForms();
    expect(() => parseShareStateDocument(JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [{
          ...scenario.attacks[0],
          moveInput,
          movePowerMode,
          movePowerValue,
        }],
      }],
    }))).toThrow("技と一致しない威力指定");
  });

  it("round-trips a manual power for an HP-dependent move", () => {
    const [scenario] = createDefaultScenarioForms();
    const document = stringifyShareStateDocument(createDefaultTargetForm(), [{
      ...scenario,
      attacks: [{
        ...scenario.attacks[0],
        moveInput: "ふんか",
        movePowerMode: "manual",
        movePowerValue: 87,
      }],
    }]);

    expect(parseShareStateDocument(document).scenarios[0].attacks[0]).toMatchObject({
      moveInput: "ふんか",
      movePowerMode: "manual",
      movePowerValue: 87,
    });
  });

  it("migrates schema v8 Beat Up to the attacker-only participant sequence", () => {
    const [scenario] = createDefaultScenarioForms();
    const { beatUpParticipants: _beatUpParticipants, ...legacyAttack } = scenario.attacks[0];
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 8,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [{ ...legacyAttack, moveInput: "ふくろだたき" }],
      }],
    }));

    expect(parsed.scenarios[0].attacks[0].beatUpParticipants).toEqual([{
      id: `${legacyAttack.id}-beat-up-attacker`,
      source: "attacker",
      pokemonInput: "",
      powerMode: "auto",
      powerValue: 0,
    }]);
  });

  it("migrates schema v9 attacker levels into locked and manual modes", () => {
    const [scenario] = createDefaultScenarioForms();
    const { attackerLevelMode: _mode, ...legacyAttack } = scenario.attacks[0];
    const parsed = parseShareStateDocument(JSON.stringify({
      schemaVersion: 9,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [
          { ...legacyAttack, id: "level-50", attackerLevel: 50 },
          { ...legacyAttack, id: "level-73", attackerLevel: 73 },
        ],
      }],
    }));

    expect(parsed.scenarios[0].attacks[0]).toMatchObject({
      attackerLevel: 50,
      attackerLevelMode: "auto",
    });
    expect(parsed.scenarios[0].attacks[1]).toMatchObject({
      attackerLevel: 73,
      attackerLevelMode: "manual",
    });
  });

  it("migrates schema v9 target levels into locked and manual modes", () => {
    const { levelMode: _levelMode, ...legacyTarget } = createDefaultTargetForm();

    const locked = parseShareStateDocument(JSON.stringify({
      schemaVersion: 9,
      target: { ...legacyTarget, level: 50 },
      scenarios: createDefaultScenarioForms(),
    }));
    const manual = parseShareStateDocument(JSON.stringify({
      schemaVersion: 9,
      target: { ...legacyTarget, level: 73 },
      scenarios: createDefaultScenarioForms(),
    }));

    expect(locked.target).toMatchObject({ level: 50, levelMode: "auto" });
    expect(manual.target).toMatchObject({ level: 73, levelMode: "manual" });
  });

  it("rejects current JSON whose locked target level is not 50", () => {
    expect(() => parseShareStateDocument(JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: { ...createDefaultTargetForm(), level: 73, levelMode: "auto" },
      scenarios: createDefaultScenarioForms(),
    }))).toThrow("不正な levelMode");
  });

  it("rejects current JSON whose locked attacker level is not 50", () => {
    const [scenario] = createDefaultScenarioForms();
    expect(() => parseShareStateDocument(JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [{
          ...scenario.attacks[0],
          attackerLevel: 73,
          attackerLevelMode: "auto",
        }],
      }],
    }))).toThrow("不正な attackerLevelMode");
  });

  it("round-trips Beat Up order and per-participant manual power", () => {
    const [scenario] = createDefaultScenarioForms();
    const document = stringifyShareStateDocument(createDefaultTargetForm(), [{
      ...scenario,
      attacks: [{
        ...scenario.attacks[0],
        moveInput: "ふくろだたき",
        gameType: "singles",
        repeat: 3,
        requiredSurvivedHits: 3,
        beatUpParticipants: [
          { id: "party-1", source: "party", pokemonInput: "コータス", powerMode: "auto", powerValue: 0 },
          { id: "attacker", source: "attacker", pokemonInput: "", powerMode: "manual", powerValue: 21 },
          { id: "party-2", source: "party", pokemonInput: "コノヨザル", powerMode: "auto", powerValue: 0 },
        ],
      }],
    }]);

    expect(parseShareStateDocument(document).scenarios[0].attacks[0].beatUpParticipants)
      .toEqual([
        { id: "party-1", source: "party", pokemonInput: "コータス", powerMode: "auto", powerValue: 0 },
        { id: "attacker", source: "attacker", pokemonInput: "", powerMode: "manual", powerValue: 21 },
        { id: "party-2", source: "party", pokemonInput: "コノヨザル", powerMode: "auto", powerValue: 0 },
      ]);
  });

  it("rejects Beat Up participants beyond singles and doubles limits", () => {
    const [scenario] = createDefaultScenarioForms();
    const participant = (id: string, source: "attacker" | "party", pokemonInput: string) => ({
      id,
      source,
      pokemonInput,
      powerMode: "auto" as const,
      powerValue: 0,
    });
    const makeDocument = (gameType: "singles" | "doubles", count: number) => JSON.stringify({
      schemaVersion: SHARE_SCHEMA_VERSION,
      target: createDefaultTargetForm(),
      scenarios: [{
        ...scenario,
        attacks: [{
          ...scenario.attacks[0],
          moveInput: "ふくろだたき",
          gameType,
          beatUpParticipants: [
            participant("attacker", "attacker", ""),
            ...Array.from({ length: count - 1 }, (_, index) => (
              participant(`party-${index}`, "party", "コータス")
            )),
          ],
        }],
      }],
    });

    expect(() => parseShareStateDocument(makeDocument("singles", 4))).toThrow("参加枠が上限");
    expect(() => parseShareStateDocument(makeDocument("doubles", 5))).toThrow("参加枠が上限");
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
