import { calculate, Field, Generations, Move, Pokemon, Side, toID, type Result, type State } from "@smogon/calc";
import {
  getFinalSpeed,
  isGrounded as isSmogonGroundedInternal,
} from "@smogon/calc/dist/mechanics/util";
import type {
  Build,
  FieldState,
  MovePowerEvaluation,
  MovePowerOverride,
  ScenarioHit,
  ScenarioHitEvaluation,
  SideState,
  StatBoostTable,
} from "../domain/model";
import {
  getMovePowerOverrideDetailLabel,
  isSinglePowerMoveUnsupported,
  resolveAllowedMovePowerOverride,
} from "./movePowerRules";

const SMOGON_GENERATION = Generations.get(9);

type SmogonDamage = Result["damage"];
type SmogonWeather = NonNullable<State.Field["weather"]>;
type SmogonTerrain = NonNullable<State.Field["terrain"]>;
type SmogonGameType = State.Field["gameType"];

export interface SmogonPokemonOptions {
  currentHp?: number;
}

export interface SmogonHitCalculationOptions {
  attackerCurrentHp?: number;
  defenderCurrentHp?: number;
}

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
  options: SmogonPokemonOptions = {},
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
    curHP: options.currentHp,
  });

export const getSmogonTypeEffectiveness = (
  attackType: string,
  defenderBuild: Build,
): number => {
  const defender = toSmogonPokemon(defenderBuild);
  const typeId = attackType.toLowerCase() as Parameters<typeof SMOGON_GENERATION.types.get>[0];
  const attackingType = SMOGON_GENERATION.types.get(typeId);
  if (!attackingType) {
    return 1;
  }

  const effectiveness = attackingType.effectiveness as Readonly<Record<string, number | undefined>>;
  const defendingTypes = defender.teraType && defender.teraType !== "Stellar"
    ? [defender.teraType]
    : defender.types;
  return defendingTypes.reduce(
    (multiplier, type) => multiplier * (effectiveness[type] ?? 1),
    1,
  );
};

export const isSmogonGrounded = (
  build: Build,
  fieldState: FieldState = {
    gameType: "singles",
    weather: "none",
    terrain: "none",
  },
): boolean => isSmogonGroundedInternal(
  toSmogonPokemon(build),
  new Field({
    gameType: gameTypeByFieldState[fieldState.gameType],
    weather: weatherByFieldState[fieldState.weather],
    terrain: terrainByFieldState[fieldState.terrain],
  }),
);

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
    hits: hit.moveHits,
  });

const CURRENT_HP_FRACTION_MOVES = new Set([
  "Super Fang",
  "Nature's Madness",
  "Ruination",
  "Guardian of Alola",
]);

const CURRENT_HP_HALF_COMPATIBILITY_MOVES = new Set([
  "Super Fang",
  "Ruination",
]);

const FIXED_DAMAGE_MOVES = new Set([
  "Seismic Toss",
  "Night Shade",
  "Dragon Rage",
  "Sonic Boom",
  "Final Gambit",
  "Guardian of Alola",
  "Nature's Madness",
  "Super Fang",
  "Ruination",
]);

const MOVE_POWER_OVERRIDE_PROXY_PREFIX = "ChampionCreator Power Override: ";

const toSmogonCalculationMove = (
  hit: ScenarioHit,
): {
  move: Move;
  originalMove: Move;
  displayNameOverride?: string;
  appliedPowerOverride?: MovePowerOverride;
} => {
  const originalMove = toSmogonMove(hit);
  const appliedPowerOverride = resolveAllowedMovePowerOverride(
    originalMove.name,
    hit.movePowerOverride,
  );
  if (appliedPowerOverride) {
    // Keep the canonical move data, but use a proxy display name so @smogon/calc
    // does not run a second name-based base-power branch after the explicit
    // effective base power has been selected.
    const overrideMove = new Move(SMOGON_GENERATION, originalMove.name, {
      isCrit: hit.critical,
      hits: hit.moveHits,
      overrides: {
        name: `${MOVE_POWER_OVERRIDE_PROXY_PREFIX}${originalMove.name}` as State.Move["name"],
        basePower: appliedPowerOverride.value,
      },
    });
    return {
      move: overrideMove,
      originalMove,
      displayNameOverride: originalMove.name,
      appliedPowerOverride,
    };
  }

  if (!CURRENT_HP_HALF_COMPATIBILITY_MOVES.has(originalMove.name)) {
    return { move: originalMove, originalMove };
  }

  // This vendor revision only wires the shared half-current-HP formula to
  // Nature's Madness. Keep the original type and flags so immunity and move
  // metadata remain authoritative while routing the equivalent formula through
  // @smogon/calc instead of reimplementing direct damage in the app.
  const compatibilityMove = new Move(SMOGON_GENERATION, "Nature's Madness", {
    isCrit: hit.critical,
    overrides: {
      type: originalMove.type,
      category: originalMove.category,
      flags: originalMove.flags,
      target: originalMove.target,
      priority: originalMove.priority,
    },
  });

  return {
    move: compatibilityMove,
    originalMove,
    displayNameOverride: originalMove.name,
  };
};

const getCatalogBasePower = (canonicalName: string, originalMove: Move): number =>
  SMOGON_GENERATION.moves.get(toID(canonicalName))?.basePower ?? originalMove.bp ?? 0;

const getPerHitBasePowers = (
  canonicalName: string,
  hitCount: number,
  appliedBasePower: number | undefined,
): number[] | undefined => {
  const normalizedHitCount = Math.max(1, Math.trunc(hitCount));
  if (normalizedHitCount <= 1) {
    return undefined;
  }

  if (canonicalName === "Triple Axel") {
    return [20, 40, 60].slice(0, normalizedHitCount);
  }
  if (canonicalName === "Triple Kick") {
    return [10, 20, 30].slice(0, normalizedHitCount);
  }
  if (appliedBasePower === undefined) {
    return undefined;
  }
  return Array.from({ length: normalizedHitCount }, () => appliedBasePower);
};

const getMovePowerEvaluation = (
  canonicalName: string,
  originalMove: Move,
  result: Result,
  appliedPowerOverride?: MovePowerOverride,
): MovePowerEvaluation => {
  const catalogBasePower = getCatalogBasePower(canonicalName, originalMove);
  if (originalMove.category === "Status") {
    return { catalogBasePower, source: "status" };
  }
  if (isSinglePowerMoveUnsupported(originalMove.name)) {
    return { catalogBasePower, source: "unsupported" };
  }
  if (FIXED_DAMAGE_MOVES.has(originalMove.name)) {
    return { catalogBasePower, source: "fixed-damage" };
  }

  const appliedBasePower = result.rawDesc.moveBP ?? result.move.bp;
  const perHitBasePowers = getPerHitBasePowers(
    originalMove.name,
    result.move.hits,
    appliedBasePower,
  );
  const source = appliedPowerOverride?.source
    ?? (result.rawDesc.moveBP === undefined ? "standard" : "automatic");

  return {
    catalogBasePower,
    ...(appliedBasePower === undefined ? {} : { appliedBasePower }),
    source,
    ...(perHitBasePowers ? { perHitBasePowers } : {}),
    ...(appliedPowerOverride
      ? {
          detailLabel: getMovePowerOverrideDetailLabel(
            originalMove.name,
            appliedPowerOverride,
          ),
        }
      : {}),
  };
};

export const flattenDamageRolls = (damage: SmogonDamage): number[] => {
  if (!Array.isArray(damage)) {
    return [damage];
  }

  return damage.flat(Number.POSITIVE_INFINITY) as number[];
};

export const splitDamageRollsByHit = (damage: SmogonDamage): number[][] | undefined => {
  if (!Array.isArray(damage) || !damage.some(Array.isArray)) {
    return undefined;
  }

  return damage.map((hitDamage) => (
    Array.isArray(hitDamage)
      ? hitDamage.flat(Number.POSITIVE_INFINITY)
      : [hitDamage]
  )) as number[][];
};

const getSmogonResultDescription = (result: Result): string => {
  try {
    return result.desc();
  } catch {
    // @smogon/calc's KO helper rejects a zero-only damage array for some
    // immunity paths. Its non-throwing display mode still preserves the
    // authoritative calculation and produces the useful move description.
    return result.fullDesc("%", false);
  }
};

export const calculateSmogonHit = (
  defenderBuild: Build,
  hit: ScenarioHit,
  fieldState: FieldState,
  options: SmogonHitCalculationOptions = {},
): ScenarioHitEvaluation => {
  const allyAbilityNames = getAllyAbilityNames(hit);
  const attacker = toSmogonPokemon(
    hit.attacker,
    hit.attackerBoosts,
    hasPlusMinusSynergy(hit, allyAbilityNames),
    { currentHp: options.attackerCurrentHp },
  );
  const originalMoveName = hit.move.canonicalName;
  const defenderCurrentHp =
    options.defenderCurrentHp === 1 &&
    CURRENT_HP_FRACTION_MOVES.has(originalMoveName)
      ? 2
      : options.defenderCurrentHp;
  const defender = toSmogonPokemon(
    hit.defenderStatus === undefined
      ? defenderBuild
      : { ...defenderBuild, status: hit.defenderStatus },
    hit.defenderBoosts,
    false,
    { currentHp: defenderCurrentHp },
  );
  const {
    move,
    originalMove,
    displayNameOverride,
    appliedPowerOverride,
  } = toSmogonCalculationMove(hit);
  const field = toSmogonField(fieldState, hit);
  const result = calculate(SMOGON_GENERATION, attacker, defender, move, field);
  if (displayNameOverride) {
    result.rawDesc.moveName = displayNameOverride;
  }
  const [min, max] = result.range();
  const defenderMaxHp = defender.maxHP();

  return {
    hitId: hit.id,
    damageRolls: flattenDamageRolls(result.damage),
    damageRollsByHit: splitDamageRollsByHit(result.damage),
    damageRange: {
      min,
      max,
      percentMin: (min / defenderMaxHp) * 100,
      percentMax: (max / defenderMaxHp) * 100,
    },
    description: getSmogonResultDescription(result),
    movePower: getMovePowerEvaluation(
      originalMoveName,
      originalMove,
      result,
      appliedPowerOverride,
    ),
  };
};
