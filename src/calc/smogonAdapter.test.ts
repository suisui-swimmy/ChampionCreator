import { Field, Generations, Move, Pokemon, calculate } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import type { BaseScenario, Build, MoveRef } from "../domain/model";
import { evaluateDamageScenario, fieldStateToCalcField } from "./smogonAdapter";

const garchomp: Build = {
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
  ivs: {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
  },
  statPoints: {
    hp: 0,
    atk: 32,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  },
};

const pikachu: Build = {
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
  ivs: {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
  },
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

const makeScenario = (overrides: Partial<BaseScenario> = {}): BaseScenario => ({
  id: "damage-smoke",
  kind: "defence",
  enabled: true,
  title: "damage smoke",
  attacker: garchomp,
  defender: pikachu,
  move: earthquake,
  field: {
    weather: "none",
    terrain: "none",
  },
  tags: [],
  ...overrides,
});

describe("smogonAdapter", () => {
  it("maps field state to @smogon/calc Field", () => {
    const field = fieldStateToCalcField({
      weather: "rain",
      terrain: "electric",
      reflect: true,
      lightScreen: true,
      spreadMove: true,
    });

    expect(field.gameType).toBe("Doubles");
    expect(field.weather).toBe("Rain");
    expect(field.terrain).toBe("Electric");
    expect(field.defenderSide.isReflect).toBe(true);
    expect(field.defenderSide.isLightScreen).toBe(true);
  });

  it("evaluates a domain scenario through @smogon/calc", () => {
    const scenario = makeScenario();
    const viaAdapter = evaluateDamageScenario(scenario);
    const gen = Generations.get(9);
    const directResult = calculate(
      gen,
      new Pokemon(gen, "Garchomp", {
        level: 50,
        nature: "Adamant",
        evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 },
      }),
      new Pokemon(gen, "Pikachu", {
        level: 50,
        nature: "Hardy",
        evs: { hp: 252, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      }),
      new Move(gen, "Earthquake"),
      new Field(),
    );

    expect(viaAdapter.damageRolls).toEqual(directResult.damage);
    expect(viaAdapter.damageRange).toEqual(directResult.range());
    expect(viaAdapter.damageRange).toEqual([374, 444]);
    expect(viaAdapter.description).toContain("guaranteed OHKO");
  });

  it("passes critical hit and move power override through the adapter", () => {
    const result = evaluateDamageScenario(
      makeScenario({
        field: {
          criticalHit: true,
        },
        manualOverrides: {
          movePower: 60,
        },
      }),
    );

    expect(result.damageRange[0]).toBeGreaterThan(0);
    expect(result.description).toContain("critical hit");
  });
});
