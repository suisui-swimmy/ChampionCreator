import { calculate, Field, Generations, Move, Pokemon, Side, type Result, type State } from "@smogon/calc";
import { getFinalSpeed } from "@smogon/calc/dist/mechanics/util";
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

export const toSmogonSide = (
  side: SideState,
  allyAbilityNames: Set<string> = new Set(),
): Side =>
  new Side({
    isReflect: side.reflect,
    isLightScreen: side.lightScreen,
    isAuroraVeil: side.auroraVeil,
    isHelpingHand: side.helpingHand,
    isTailwind: side.tailwind,
    isFriendGuard: side.friendGuard,
    isFlowerGift: allyAbilityNames.has("Flower Gift"),
    isBattery: allyAbilityNames.has("Battery"),
    isPowerSpot: allyAbilityNames.has("Power Spot"),
    isSteelySpirit: allyAbilityNames.has("Steely Spirit"),
  });

const getAllyAbilityNames = (hit: ScenarioHit): Set<string> =>
  new Set(hit.allyAbilities?.map((ability) => ability.canonicalName) ?? []);

const hasPlusMinusSynergy = (hit: ScenarioHit, allyAbilityNames: Set<string>): boolean =>
  Boolean(
    hit.attacker.ability &&
    ["Plus", "Minus"].includes(hit.attacker.ability.canonicalName) &&
    (allyAbilityNames.has("Plus") || allyAbilityNames.has("Minus")),
  );

export const toSmogonField = (field: FieldState, hit: ScenarioHit): Field => {
  const allyAbilityNames = getAllyAbilityNames(hit);

  return new Field({
    gameType: gameTypeByFieldState[field.gameType],
    weather: weatherByFieldState[field.weather],
    terrain: terrainByFieldState[field.terrain],
    isAuraBreak: allyAbilityNames.has("Aura Break"),
    isFairyAura: allyAbilityNames.has("Fairy Aura"),
    isDarkAura: allyAbilityNames.has("Dark Aura"),
    isBeadsOfRuin: allyAbilityNames.has("Beads of Ruin"),
    isSwordOfRuin: allyAbilityNames.has("Sword of Ruin"),
    isTabletsOfRuin: allyAbilityNames.has("Tablets of Ruin"),
    isVesselOfRuin: allyAbilityNames.has("Vessel of Ruin"),
    attackerSide: toSmogonSide(hit.attackerSide, allyAbilityNames),
    // Friend Guard protects the attacker-side ally, not the current defender target.
    defenderSide: toSmogonSide(hit.defenderSide),
  });
};

export const toSmogonPokemon = (
  build: Build,
  boosts: StatBoostTable = {},
  abilityOn = false,
): Pokemon =>
  new Pokemon(SMOGON_GENERATION, build.pokemon.canonicalName, {
    level: build.level,
    nature: build.nature?.canonicalName,
    ivs: build.ivs,
    evs: build.evs,
    ability: build.ability?.canonicalName,
    item: build.item?.canonicalName,
    teraType: build.teraType?.canonicalName as State.Pokemon["teraType"],
    isDynamaxed: build.isDynamaxed,
    status: build.status,
    boosts,
    abilityOn,
  });

export interface SmogonFinalSpeedOptions {
  boosts?: StatBoostTable;
  abilityOn?: boolean;
  manualItemMultiplier?: number;
  manualAbilityMultiplier?: number;
}

const applyManualSpeedMultiplier = (
  speed: number,
  multiplier: number | undefined,
): number => {
  if (multiplier === undefined) {
    return speed;
  }
  return Math.max(0, Math.min(10000, Math.floor(speed * multiplier)));
};

export const calculateSmogonFinalSpeed = (
  build: Build,
  fieldState: FieldState,
  sideState: SideState,
  options: SmogonFinalSpeedOptions = {},
): number => {
  const buildForAutoCalculation: Build = {
    ...build,
    item: options.manualItemMultiplier === undefined ? build.item : undefined,
    ability: options.manualAbilityMultiplier === undefined ? build.ability : undefined,
  };
  const side = toSmogonSide(sideState);
  const field = new Field({
    gameType: gameTypeByFieldState[fieldState.gameType],
    weather: weatherByFieldState[fieldState.weather],
    terrain: terrainByFieldState[fieldState.terrain],
    attackerSide: side,
    defenderSide: toSmogonSide({
      reflect: false,
      lightScreen: false,
      auroraVeil: false,
      helpingHand: false,
    }),
  });
  const pokemon = toSmogonPokemon(
    buildForAutoCalculation,
    options.boosts,
    options.abilityOn,
  );
  const autoSpeed = getFinalSpeed(SMOGON_GENERATION, pokemon, field, side);
  return applyManualSpeedMultiplier(
    applyManualSpeedMultiplier(autoSpeed, options.manualItemMultiplier),
    options.manualAbilityMultiplier,
  );
};

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
  const allyAbilityNames = getAllyAbilityNames(hit);
  const attacker = toSmogonPokemon(
    hit.attacker,
    hit.attackerBoosts,
    hasPlusMinusSynergy(hit, allyAbilityNames),
  );
  const defender = toSmogonPokemon(
    hit.defenderStatus === undefined
      ? defenderBuild
      : { ...defenderBuild, status: hit.defenderStatus },
    hit.defenderBoosts,
  );
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
