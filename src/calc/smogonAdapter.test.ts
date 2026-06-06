import { calculate, Field, Generations, Move, Pokemon, Side } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type { Build, EntityRef, FieldState, ScenarioHit, SideState, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import { calculateSmogonHit, flattenDamageRolls, toSmogonField, toSmogonPokemon } from "./smogonAdapter";

const gen = Generations.get(9);

const mustResolve = <K extends EntityKind>(kind: K, input: string): EntityRef<K> => {
  const ref = toEntityRef(resolveEntity(kind, input), kind);
  if (!ref) {
    throw new Error(`Expected ${kind}:${input} to resolve`);
  }
  return ref;
};

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const zeroEvs: StatTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
};

const fieldState: FieldState = {
  gameType: "singles",
  weather: "sand",
  terrain: "electric",
};

const defender: Build = {
  id: "target-1",
  pokemon: mustResolve("pokemon", "ピカチュウ"),
  level: 100,
  nature: mustResolve("nature", "ひかえめ"),
  ivs: defaultIvs,
  evs: { ...zeroEvs, hp: 12, def: 4, spa: 28 },
  ability: mustResolve("ability", "せいでんき"),
  item: mustResolve("item", "こだわりスカーフ"),
  teraType: mustResolve("type", "でんき"),
};

const attacker: Build = {
  id: "attacker-1",
  pokemon: mustResolve("pokemon", "ガブリアス"),
  level: 100,
  nature: mustResolve("nature", "ようき"),
  ivs: defaultIvs,
  evs: { ...zeroEvs, atk: 252, spe: 252 },
  item: mustResolve("item", "こだわりハチマキ"),
};

const hit: ScenarioHit = {
  id: "hit-1",
  attacker,
  move: mustResolve("move", "じしん"),
  repeat: 2,
  critical: false,
  attackerBoosts: { atk: 1 },
  defenderBoosts: { def: 1 },
  attackerSide: { ...emptySide, helpingHand: true },
  defenderSide: { ...emptySide, reflect: true },
};

describe("calculateSmogonHit", () => {
  it("matches direct @smogon/calc damage rolls and range", () => {
    const adapterResult = calculateSmogonHit(defender, hit, fieldState);

    const directAttacker = new Pokemon(gen, "Garchomp", {
      level: 100,
      nature: "Jolly",
      ivs: defaultIvs,
      evs: { ...zeroEvs, atk: 252, spe: 252 },
      item: "Choice Band",
      boosts: { atk: 1 },
    });
    const directDefender = new Pokemon(gen, "Pikachu", {
      level: 100,
      nature: "Modest",
      ivs: defaultIvs,
      evs: { ...zeroEvs, hp: 12, def: 4, spa: 28 },
      ability: "Static",
      item: "Choice Scarf",
      teraType: "Electric",
      boosts: { def: 1 },
    });
    const directMove = new Move(gen, "Earthquake", { isCrit: false });
    const directField = new Field({
      gameType: "Singles",
      weather: "Sand",
      terrain: "Electric",
      attackerSide: new Side({ isHelpingHand: true }),
      defenderSide: new Side({ isReflect: true }),
    });
    const directResult = calculate(gen, directAttacker, directDefender, directMove, directField);
    const [min, max] = directResult.range();

    expect(adapterResult.damageRolls).toEqual(flattenDamageRolls(directResult.damage));
    expect(adapterResult.damageRange).toEqual({
      min,
      max,
      percentMin: (min / directDefender.maxHP()) * 100,
      percentMax: (max / directDefender.maxHP()) * 100,
    });
    expect(adapterResult.description).toBe(directResult.desc());
  });

  it("uses resolved canonical names rather than Japanese display labels", () => {
    const adapterResult = calculateSmogonHit(
      {
        ...defender,
        pokemon: {
          ...defender.pokemon,
          displayNameJa: "ピカチュウではない表示名" as typeof defender.pokemon.displayNameJa,
        },
      },
      {
        ...hit,
        move: {
          ...hit.move,
          displayNameJa: "じしんではない表示名" as typeof hit.move.displayNameJa,
        },
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    expect(adapterResult.damageRolls.length).toBeGreaterThan(0);
    expect(adapterResult.description).toContain("Earthquake");
  });

  it("passes status and game type through to @smogon/calc inputs", () => {
    const burnedAttacker = toSmogonPokemon({ ...attacker, status: "brn" });
    const doublesField = toSmogonField({ gameType: "doubles", weather: "none", terrain: "none" }, hit);

    expect(burnedAttacker.status).toBe("brn");
    expect(doublesField.gameType).toBe("Doubles");
  });

  it("maps an active ally's direct damage abilities to @smogon/calc field flags", () => {
    const doublesField = toSmogonField(
      { gameType: "doubles", weather: "sun", terrain: "none" },
      {
        ...hit,
        allyAbilities: [
          mustResolve("ability", "バッテリー"),
          mustResolve("ability", "パワースポット"),
          mustResolve("ability", "はがねのせいしん"),
          mustResolve("ability", "フラワーギフト"),
          mustResolve("ability", "ダークオーラ"),
          mustResolve("ability", "フェアリーオーラ"),
          mustResolve("ability", "オーラブレイク"),
          mustResolve("ability", "わざわいのつるぎ"),
          mustResolve("ability", "わざわいのたま"),
          mustResolve("ability", "わざわいのおふだ"),
          mustResolve("ability", "わざわいのうつわ"),
        ],
      },
    );

    expect(doublesField.attackerSide).toMatchObject({
      isBattery: true,
      isPowerSpot: true,
      isSteelySpirit: true,
      isFlowerGift: true,
    });
    expect(doublesField).toMatchObject({
      isDarkAura: true,
      isFairyAura: true,
      isAuraBreak: true,
      isSwordOfRuin: true,
      isBeadsOfRuin: true,
      isTabletsOfRuin: true,
      isVesselOfRuin: true,
    });
  });

  it("maps defender-side Friend Guard to @smogon/calc", () => {
    const friendGuardField = toSmogonField(
      { gameType: "doubles", weather: "none", terrain: "none" },
      {
        ...hit,
        defenderSide: { ...emptySide, friendGuard: true },
      },
    );

    expect(friendGuardField.defenderSide.isFriendGuard).toBe(true);
  });

  it("reduces damage when the defender has an ally's Friend Guard", () => {
    const doublesField = { gameType: "doubles", weather: "none", terrain: "none" } as const;
    const withoutFriendGuard = calculateSmogonHit(defender, hit, doublesField);
    const withFriendGuard = calculateSmogonHit(
      defender,
      {
        ...hit,
        defenderSide: { ...hit.defenderSide, friendGuard: true },
      },
      doublesField,
    );

    expect(withFriendGuard.damageRange.max).toBeLessThan(withoutFriendGuard.damageRange.max);
    expect(withFriendGuard.description).toContain("Friend Guard");
  });

  it("increases physical damage when an ally has Sword of Ruin", () => {
    const kingambit = {
      ...attacker,
      pokemon: mustResolve("pokemon", "ドドゲザン"),
      nature: mustResolve("nature", "いじっぱり"),
      ability: mustResolve("ability", "まけんき"),
      item: undefined,
      teraType: undefined,
      level: 50,
      evs: { ...zeroEvs, atk: 252 },
    };
    const megaStarmie = {
      ...defender,
      pokemon: mustResolve("pokemon", "メガスターミー"),
      nature: mustResolve("nature", "ひかえめ"),
      ability: undefined,
      item: undefined,
      teraType: undefined,
      level: 50,
      evs: zeroEvs,
    };
    const suckerPunch = {
      ...hit,
      attacker: kingambit,
      move: mustResolve("move", "ふいうち"),
      attackerBoosts: {},
      defenderBoosts: {},
      attackerSide: emptySide,
      defenderSide: emptySide,
    };
    const doublesField = { gameType: "doubles", weather: "none", terrain: "none" } as const;
    const withoutSwordOfRuin = calculateSmogonHit(megaStarmie, suckerPunch, doublesField);
    const withSwordOfRuin = calculateSmogonHit(
      megaStarmie,
      {
        ...suckerPunch,
        allyAbilities: [mustResolve("ability", "わざわいのつるぎ")],
      },
      doublesField,
    );

    expect(withoutSwordOfRuin.damageRange).toMatchObject({ min: 132, max: 156 });
    expect(withSwordOfRuin.damageRange).toMatchObject({ min: 174, max: 206 });
    expect(withSwordOfRuin.description).toContain("Sword of Ruin");
  });

  it("applies all four Ruin abilities in the correct damage direction", () => {
    const doublesField = { gameType: "doubles", weather: "none", terrain: "none" } as const;
    const physicalHit = {
      ...hit,
      attackerBoosts: {},
      defenderBoosts: {},
      attackerSide: emptySide,
      defenderSide: emptySide,
    };
    const specialHit = {
      ...physicalHit,
      move: mustResolve("move", "りゅうせいぐん"),
    };
    const physicalBaseline = calculateSmogonHit(defender, physicalHit, doublesField);
    const specialBaseline = calculateSmogonHit(defender, specialHit, doublesField);
    const swordOfRuin = calculateSmogonHit(defender, {
      ...physicalHit,
      allyAbilities: [mustResolve("ability", "わざわいのつるぎ")],
    }, doublesField);
    const beadsOfRuin = calculateSmogonHit(defender, {
      ...specialHit,
      allyAbilities: [mustResolve("ability", "わざわいのたま")],
    }, doublesField);
    const tabletsOfRuin = calculateSmogonHit(defender, {
      ...physicalHit,
      allyAbilities: [mustResolve("ability", "わざわいのおふだ")],
    }, doublesField);
    const vesselOfRuin = calculateSmogonHit(defender, {
      ...specialHit,
      allyAbilities: [mustResolve("ability", "わざわいのうつわ")],
    }, doublesField);

    expect(swordOfRuin.damageRange.max).toBeGreaterThan(physicalBaseline.damageRange.max);
    expect(beadsOfRuin.damageRange.max).toBeGreaterThan(specialBaseline.damageRange.max);
    expect(tabletsOfRuin.damageRange.max).toBeLessThan(physicalBaseline.damageRange.max);
    expect(vesselOfRuin.damageRange.max).toBeLessThan(specialBaseline.damageRange.max);
    expect(swordOfRuin.description).toContain("Sword of Ruin");
    expect(beadsOfRuin.description).toContain("Beads of Ruin");
    expect(tabletsOfRuin.description).toContain("Tablets of Ruin");
    expect(vesselOfRuin.description).toContain("Vessel of Ruin");
  });

  it("applies Battery supplied by an ally to a special attack", () => {
    const specialHit = {
      ...hit,
      move: mustResolve("move", "りゅうせいぐん"),
      attackerBoosts: {},
      defenderBoosts: {},
    };
    const withoutBattery = calculateSmogonHit(
      defender,
      specialHit,
      { gameType: "doubles", weather: "none", terrain: "none" },
    );
    const withBattery = calculateSmogonHit(
      defender,
      {
        ...specialHit,
        allyAbilities: [mustResolve("ability", "バッテリー")],
      },
      { gameType: "doubles", weather: "none", terrain: "none" },
    );

    expect(withBattery.damageRange.max).toBeGreaterThan(withoutBattery.damageRange.max);
    expect(withBattery.description).toContain("Battery boosted");
  });

  it("activates Plus or Minus only when the attacker has a matching active ally", () => {
    const plusHit = {
      ...hit,
      attacker: {
        ...attacker,
        ability: mustResolve("ability", "プラス"),
      },
      move: mustResolve("move", "りゅうせいぐん"),
      attackerBoosts: {},
      defenderBoosts: {},
    };
    const withoutPartner = calculateSmogonHit(
      defender,
      plusHit,
      { gameType: "doubles", weather: "none", terrain: "none" },
    );
    const withMinusPartner = calculateSmogonHit(
      defender,
      {
        ...plusHit,
        allyAbilities: [mustResolve("ability", "マイナス")],
      },
      { gameType: "doubles", weather: "none", terrain: "none" },
    );

    expect(withMinusPartner.damageRange.max).toBeGreaterThan(withoutPartner.damageRange.max);
    expect(withMinusPartner.description).toContain("Plus");
  });

  it("passes Dynamax state through so @smogon/calc doubles max HP", () => {
    const normalAttacker = toSmogonPokemon(attacker);
    const dynamaxedAttacker = toSmogonPokemon({ ...attacker, isDynamaxed: true });

    expect(dynamaxedAttacker.isDynamaxed).toBe(true);
    expect(dynamaxedAttacker.maxHP()).toBe(normalAttacker.maxHP() * 2);
  });
});
