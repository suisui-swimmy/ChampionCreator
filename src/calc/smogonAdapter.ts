import { calculate, Field, Generations, Move, Pokemon, Side, type Result, type State } from "@smogon/calc";
import type {
  Build,
  FieldState,
  ScenarioHit,
  ScenarioHitEvaluation,
  SideState,
  StatBoostTable,
} from "../domain/model";

const SMOGON_GENERATION = Generations.get(9);

type SmogonDamage = Result["damage"];
type SmogonWeather = NonNullable<State.Field["weather"]>;
type SmogonTerrain = NonNullable<State.Field["terrain"]>;
type SmogonGameType = State.Field["gameType"];

const weatherByFieldState = {
  none: undefined,
  sun: "Sun",
  rain: "Rain",
  sand: "Sand",
  snow: "Snow",
} satisfies Record<FieldState["weather"], SmogonWeather | undefined>;

const terrainByFieldState = {
  none: undefined,
  electric: "Electric",
  grassy: "Grassy",
  misty: "Misty",
  psychic: "Psychic",
} satisfies Record<FieldState["terrain"], SmogonTerrain | undefined>;

const gameTypeByFieldState = {
  singles: "Singles",
  doubles: "Doubles",
} satisfies Record<FieldState["gameType"], SmogonGameType>;

export const toSmogonSide = (side: SideState): Side =>
  new Side({
    isReflect: side.reflect,
    isLightScreen: side.lightScreen,
    isAuroraVeil: side.auroraVeil,
    isHelpingHand: side.helpingHand,
  });

export const toSmogonField = (field: FieldState, hit: ScenarioHit): Field =>
  new Field({
    gameType: gameTypeByFieldState[field.gameType],
    weather: weatherByFieldState[field.weather],
    terrain: terrainByFieldState[field.terrain],
    attackerSide: toSmogonSide(hit.attackerSide),
    defenderSide: toSmogonSide(hit.defenderSide),
  });

export const toSmogonPokemon = (build: Build, boosts: StatBoostTable = {}): Pokemon =>
  new Pokemon(SMOGON_GENERATION, build.pokemon.canonicalName, {
    level: build.level,
    nature: build.nature?.canonicalName,
    ivs: build.ivs,
    evs: build.evs,
    ability: build.ability?.canonicalName,
    item: build.item?.canonicalName,
    teraType: build.teraType?.canonicalName as State.Pokemon["teraType"],
    status: build.status,
    boosts,
  });

export const toSmogonMove = (hit: ScenarioHit): Move =>
  new Move(SMOGON_GENERATION, hit.move.canonicalName, {
    isCrit: hit.critical,
    // ScenarioHit.repeat is a sequence concern for M4, not @smogon/calc's multi-hit Move.hits.
  });

export const flattenDamageRolls = (damage: SmogonDamage): number[] => {
  if (!Array.isArray(damage)) {
    return [damage];
  }

  return damage.flat(Number.POSITIVE_INFINITY) as number[];
};

export const calculateSmogonHit = (
  defenderBuild: Build,
  hit: ScenarioHit,
  fieldState: FieldState,
): ScenarioHitEvaluation => {
  const attacker = toSmogonPokemon(hit.attacker, hit.attackerBoosts);
  const defender = toSmogonPokemon(defenderBuild, hit.defenderBoosts);
  const move = toSmogonMove(hit);
  const field = toSmogonField(fieldState, hit);
  const result = calculate(SMOGON_GENERATION, attacker, defender, move, field);
  const [min, max] = result.range();
  const defenderMaxHp = defender.maxHP();

  return {
    hitId: hit.id,
    damageRolls: flattenDamageRolls(result.damage),
    damageRange: {
      min,
      max,
      percentMin: (min / defenderMaxHp) * 100,
      percentMax: (max / defenderMaxHp) * 100,
    },
    description: result.desc(),
  };
};
