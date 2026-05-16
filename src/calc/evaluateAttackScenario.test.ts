import { describe, expect, it } from "vitest";
import type { BaseScenario, Build, Constraint, MoveRef } from "../domain/model";
import { evaluateAttackScenario } from "./evaluateAttackScenario";

const perfectIvs = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const attacker: Build = {
  id: "garchomp",
  label: "ガブリアス",
  species: {
    id: "garchomp",
    displayName: "ガブリアス",
    showdownName: "Garchomp",
    sourceStatus: "supported",
  },
  level: 50,
  nature: "Adamant",
  ivs: perfectIvs,
  statPoints: {
    hp: 0,
    atk: 32,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  },
};

const defender: Build = {
  id: "pikachu",
  label: "ピカチュウ",
  species: {
    id: "pikachu",
    displayName: "ピカチュウ",
    showdownName: "Pikachu",
    sourceStatus: "supported",
  },
  level: 50,
  nature: "Hardy",
  ivs: perfectIvs,
  statPoints: {
    hp: 32,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  },
};

const earthquake: MoveRef = {
  id: "earthquake",
  displayName: "じしん",
  showdownName: "Earthquake",
  category: "Physical",
  typeName: "Ground",
  sourceStatus: "supported",
};

const scenario: BaseScenario = {
  id: "ko-scenario",
  kind: "offence",
  enabled: true,
  title: "じしんで倒す",
  attacker,
  defender,
  move: earthquake,
  field: {
    weather: "none",
    terrain: "none",
  },
  tags: [],
};

describe("evaluateAttackScenario", () => {
  it("evaluates KO probability from calc damage rolls", () => {
    const constraint: Constraint = {
      type: "ko",
      scenarioId: scenario.id,
      hits: 1,
      minKoRate: 1,
    };

    const evaluation = evaluateAttackScenario(scenario, constraint);

    expect(evaluation.check).toBe("ko");
    expect(evaluation.passed).toBe(true);
    expect(evaluation.probability).toBe(1);
    expect(evaluation.damageRange).toEqual([374, 444]);
    expect(evaluation.defenderHp).toBe(142);
  });

  it("uses manual final HP inside the adapter boundary", () => {
    const evaluation = evaluateAttackScenario(
      {
        ...scenario,
        defender: {
          ...defender,
          manualOverrides: {
            finalStats: {
              hp: 999,
            },
          },
        },
      },
      {
        type: "ko",
        scenarioId: scenario.id,
        hits: 1,
        minKoRate: 1,
      },
    );

    expect(evaluation.defenderHp).toBe(999);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.probability).toBe(0);
  });

  it("evaluates survival probability for defensive scenarios", () => {
    const evaluation = evaluateAttackScenario(
      {
        ...scenario,
        id: "survival-scenario",
        kind: "defence",
        defender: {
          ...defender,
          manualOverrides: {
            finalStats: {
              hp: 445,
            },
          },
        },
      },
      {
        type: "survive",
        scenarioId: "survival-scenario",
        hits: 1,
        minSurvivalRate: 1,
      },
    );

    expect(evaluation.check).toBe("survive");
    expect(evaluation.passed).toBe(true);
    expect(evaluation.probability).toBe(1);
  });
});
