import { Field, Generations, Move, Pokemon, calculate } from "@smogon/calc";
import type { BaseScenario, Build, FieldState, StatTable } from "../domain/model";
import { buildToCalcPokemonOptions } from "./championsAdapter";

const generation = Generations.get(9);

const WEATHER_TO_CALC = {
  none: undefined,
  sun: "Sun",
  rain: "Rain",
  sand: "Sand",
  snow: "Snow",
} as const;

const TERRAIN_TO_CALC = {
  none: undefined,
  electric: "Electric",
  grassy: "Grassy",
  misty: "Misty",
  psychic: "Psychic",
} as const;

export interface DamageScenarioResult {
  damageRolls: number[];
  damageRange: [number, number];
  attackerStats: StatTable;
  defenderStats: StatTable;
  defenderHp: number;
  description: string;
}

const flattenDamage = (damage: unknown): number[] => {
  if (typeof damage === "number") {
    return [damage];
  }

  if (Array.isArray(damage)) {
    return damage.flat(Infinity).filter((value): value is number => typeof value === "number");
  }

  return [];
};

export const fieldStateToCalcField = (fieldState: FieldState): Field =>
  new Field({
    gameType: fieldState.spreadMove ? "Doubles" : "Singles",
    weather: WEATHER_TO_CALC[fieldState.weather ?? "none"],
    terrain: TERRAIN_TO_CALC[fieldState.terrain ?? "none"],
    defenderSide: {
      isReflect: !!fieldState.reflect,
      isLightScreen: !!fieldState.lightScreen,
    },
  });

const applyManualFinalStats = (pokemon: Pokemon, build: Build): Pokemon => {
  const finalStats = build.manualOverrides?.finalStats;

  if (!finalStats) {
    return pokemon;
  }

  for (const [stat, value] of Object.entries(finalStats)) {
    if (value === undefined) {
      continue;
    }

    pokemon.rawStats[stat as keyof StatTable] = value;
    pokemon.stats[stat as keyof StatTable] = value;
  }

  if (finalStats.hp !== undefined) {
    pokemon.originalCurHP = finalStats.hp;
  }

  return pokemon;
};

const createCalcPokemon = (build: Build, stages = {}) =>
  applyManualFinalStats(
    new Pokemon(
      generation,
      build.species.showdownName,
      buildToCalcPokemonOptions(build, stages),
    ),
    build,
  );

export const evaluateDamageScenario = (scenario: BaseScenario): DamageScenarioResult => {
  if (!scenario.move) {
    throw new Error(`Scenario ${scenario.id} is missing a move`);
  }

  const attacker = createCalcPokemon(scenario.attacker, scenario.attackerStages);
  const defender = createCalcPokemon(scenario.defender, scenario.defenderStages);
  const movePowerOverride = scenario.manualOverrides?.movePower ?? scenario.move.powerOverride;
  const move = new Move(generation, scenario.move.showdownName, {
    isCrit: !!scenario.field.criticalHit,
    overrides: movePowerOverride === undefined ? undefined : { basePower: movePowerOverride },
  });
  const field = fieldStateToCalcField(scenario.field);
  const result = calculate(generation, attacker, defender, move, field);
  const damageRolls = flattenDamage(result.damage);

  if (damageRolls.length === 0) {
    throw new Error(`Scenario ${scenario.id} returned no numeric damage rolls`);
  }

  return {
    damageRolls,
    damageRange: [Math.min(...damageRolls), Math.max(...damageRolls)],
    attackerStats: { ...attacker.rawStats },
    defenderStats: { ...defender.rawStats },
    defenderHp: defender.curHP(),
    description: result.desc(),
  };
};
