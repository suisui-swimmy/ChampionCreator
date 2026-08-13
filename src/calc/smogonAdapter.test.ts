import { calculate, Field, Generations, Move, Pokemon, Side } from "@smogon/calc";
import { getFinalSpeed } from "@smogon/calc/dist/mechanics/util";
import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type { Build, EntityRef, FieldState, ScenarioHit, SideState, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  calculateSmogonFinalSpeed,
  calculateSmogonHit,
  flattenDamageRolls,
  toSmogonField,
  toSmogonPokemon,
} from "./smogonAdapter";

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
    expect(adapterResult.movePower).toEqual({
      catalogBasePower: 100,
      appliedBasePower: 100,
      source: "standard",
    });
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

  it("uses the hit-specific status for the defender", () => {
    const poisonedHit = { ...hit, defenderStatus: "psn" as const };
    const adapterResult = calculateSmogonHit(defender, poisonedHit, fieldState);
    const directAttacker = toSmogonPokemon(attacker, hit.attackerBoosts);
    const directDefender = toSmogonPokemon({ ...defender, status: "psn" }, hit.defenderBoosts);
    const directResult = calculate(
      gen,
      directAttacker,
      directDefender,
      new Move(gen, "Earthquake"),
      toSmogonField(fieldState, poisonedHit),
    );

    expect(adapterResult.damageRolls).toEqual(flattenDamageRolls(directResult.damage));
    expect(directDefender.status).toBe("psn");
  });

  it("passes explicit multi-hit counts through to @smogon/calc", () => {
    const multiHit = {
      ...hit,
      move: mustResolve("move", "タネマシンガン"),
      moveHits: 5,
      repeat: 5,
      attackerBoosts: {},
      defenderBoosts: {},
      attackerSide: emptySide,
      defenderSide: emptySide,
    };
    const adapterResult = calculateSmogonHit(defender, multiHit, { gameType: "singles", weather: "none", terrain: "none" });
    const directAttacker = toSmogonPokemon(attacker);
    const directDefender = toSmogonPokemon(defender);
    const directMove = new Move(gen, "Bullet Seed", { hits: 5 });
    const directResult = calculate(
      gen,
      directAttacker,
      directDefender,
      directMove,
      new Field({ gameType: "Singles" }),
    );
    const [min, max] = directResult.range();

    expect(adapterResult.damageRolls).toEqual(flattenDamageRolls(directResult.damage));
    expect(adapterResult.damageRollsByHit).toEqual(directResult.damage);
    expect(adapterResult.damageRange).toMatchObject({ min, max });
    expect(adapterResult.description).toBe(directResult.desc());
    expect(adapterResult.description).toContain("(5 hits)");
    expect(adapterResult.movePower).toEqual({
      catalogBasePower: 25,
      appliedBasePower: 25,
      source: "standard",
      perHitBasePowers: [25, 25, 25, 25, 25],
    });
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

  it("applies each type-converting skin ability only from the move user's own ability", () => {
    const neutralDefender = {
      ...defender,
      pokemon: mustResolve("pokemon", "ミュウ"),
      ability: undefined,
      item: undefined,
      teraType: undefined,
      level: 50,
      evs: zeroEvs,
    };
    const skinAttacker = {
      ...attacker,
      pokemon: mustResolve("pokemon", "ニンフィア"),
      nature: mustResolve("nature", "ひかえめ"),
      ability: undefined,
      item: undefined,
      level: 50,
      evs: { ...zeroEvs, spa: 252 },
    };
    const normalMoveHit = {
      ...hit,
      attacker: skinAttacker,
      move: mustResolve("move", "ハイパーボイス"),
      repeat: 1,
      attackerBoosts: {},
      defenderBoosts: {},
      attackerSide: emptySide,
      defenderSide: emptySide,
    };
    const baseline = calculateSmogonHit(
      neutralDefender,
      normalMoveHit,
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    for (const [abilityInput, canonicalName] of [
      ["フェアリースキン", "Pixilate"],
      ["スカイスキン", "Aerilate"],
      ["フリーズスキン", "Refrigerate"],
      ["エレキスキン", "Galvanize"],
      ["ノーマルスキン", "Normalize"],
      ["ドラゴンスキン", "Dragonize"],
    ] as const) {
      const result = calculateSmogonHit(
        neutralDefender,
        {
          ...normalMoveHit,
          attacker: {
            ...skinAttacker,
            ability: mustResolve("ability", abilityInput),
          },
        },
        { gameType: "singles", weather: "none", terrain: "none" },
      );

      expect(result.damageRange.max).toBeGreaterThan(baseline.damageRange.max);
      expect(result.description).toContain(canonicalName);
    }
  });

  it("applies Fairy Aura and Dark Aura from either the user or an active field ally", () => {
    const auraAttacker = {
      ...attacker,
      pokemon: mustResolve("pokemon", "ミュウ"),
      nature: mustResolve("nature", "ひかえめ"),
      ability: undefined,
      item: undefined,
      level: 50,
      evs: { ...zeroEvs, spa: 252 },
    };
    const auraDefender = {
      ...defender,
      pokemon: mustResolve("pokemon", "ミュウ"),
      ability: undefined,
      item: undefined,
      teraType: undefined,
      level: 50,
      evs: zeroEvs,
    };
    const doublesField = { gameType: "doubles", weather: "none", terrain: "none" } as const;

    for (const [abilityInput, moveInput] of [
      ["フェアリーオーラ", "ムーンフォース"],
      ["ダークオーラ", "あくのはどう"],
    ] as const) {
      const auraAbility = mustResolve("ability", abilityInput);
      const auraHit = {
        ...hit,
        attacker: auraAttacker,
        move: mustResolve("move", moveInput),
        repeat: 1,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      };
      const baseline = calculateSmogonHit(auraDefender, auraHit, doublesField);
      const userAura = calculateSmogonHit(auraDefender, {
        ...auraHit,
        attacker: { ...auraAttacker, ability: auraAbility },
      }, doublesField);
      const allyAura = calculateSmogonHit(auraDefender, {
        ...auraHit,
        allyAbilities: [auraAbility],
      }, doublesField);

      expect(userAura.damageRange.max).toBeGreaterThan(baseline.damageRange.max);
      expect(allyAura.damageRange).toEqual(userAura.damageRange);
      expect(userAura.description).toContain(auraAbility.canonicalName);
    }
  });

  it("lets an active ally's Aura Break reverse a field aura", () => {
    const auraHit = {
      ...hit,
      attacker: {
        ...attacker,
        pokemon: mustResolve("pokemon", "ミュウ"),
        nature: mustResolve("nature", "ひかえめ"),
        ability: undefined,
        item: undefined,
        level: 50,
        evs: { ...zeroEvs, spa: 252 },
      },
      move: mustResolve("move", "ムーンフォース"),
      repeat: 1,
      attackerBoosts: {},
      defenderBoosts: {},
      attackerSide: emptySide,
      defenderSide: emptySide,
      allyAbilities: [mustResolve("ability", "フェアリーオーラ")],
    };
    const auraDefender = {
      ...defender,
      pokemon: mustResolve("pokemon", "ミュウ"),
      ability: undefined,
      item: undefined,
      teraType: undefined,
      level: 50,
      evs: zeroEvs,
    };
    const doublesField = { gameType: "doubles", weather: "none", terrain: "none" } as const;
    const withAura = calculateSmogonHit(auraDefender, auraHit, doublesField);
    const withAuraBreak = calculateSmogonHit(auraDefender, {
      ...auraHit,
      allyAbilities: [
        ...auraHit.allyAbilities,
        mustResolve("ability", "オーラブレイク"),
      ],
    }, doublesField);

    expect(withAuraBreak.damageRange.max).toBeLessThan(withAura.damageRange.max);
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

  it("matches @smogon/calc final speed for item, ability, rank, status, and Tailwind modifiers", () => {
    const speedBuild = {
      ...attacker,
      pokemon: mustResolve("pokemon", "ピカチュウ"),
      nature: mustResolve("nature", "おくびょう"),
      ability: mustResolve("ability", "すいすい"),
      item: mustResolve("item", "こだわりスカーフ"),
      status: "par" as const,
      evs: { ...zeroEvs, spe: 252 },
    };
    const sideState = { ...emptySide, tailwind: true };
    const field = { gameType: "singles", weather: "rain", terrain: "none" } as const;
    const adapterSpeed = calculateSmogonFinalSpeed(
      speedBuild,
      field,
      sideState,
      { boosts: { spe: 1 } },
    );
    const directSide = new Side({ isTailwind: true });
    const directPokemon = new Pokemon(gen, "Pikachu", {
      level: 100,
      nature: "Timid",
      ivs: defaultIvs,
      evs: { ...zeroEvs, spe: 252 },
      ability: "Swift Swim",
      item: "Choice Scarf",
      status: "par",
      boosts: { spe: 1 },
    });
    const directField = new Field({
      gameType: "Singles",
      weather: "Rain",
      terrain: undefined,
      attackerSide: directSide,
    });

    expect(adapterSpeed).toBe(getFinalSpeed(gen, directPokemon, directField, directSide));
  });

  it("lets manual speed multipliers replace the selected item or ability category", () => {
    const speedBuild = {
      ...attacker,
      pokemon: mustResolve("pokemon", "ピカチュウ"),
      nature: mustResolve("nature", "おくびょう"),
      ability: mustResolve("ability", "ようりょくそ"),
      item: mustResolve("item", "こだわりスカーフ"),
      evs: { ...zeroEvs, spe: 252 },
    };
    const field = { gameType: "singles", weather: "sun", terrain: "none" } as const;
    const autoSpeed = calculateSmogonFinalSpeed(speedBuild, field, emptySide);
    const manualItemSpeed = calculateSmogonFinalSpeed(
      speedBuild,
      field,
      emptySide,
      { manualItemMultiplier: 0.5 },
    );
    const manualAbilitySpeed = calculateSmogonFinalSpeed(
      speedBuild,
      field,
      emptySide,
      { manualAbilityMultiplier: 0.5 },
    );

    expect(manualItemSpeed).toBeLessThan(autoSpeed);
    expect(manualAbilitySpeed).toBeLessThan(autoSpeed);
  });

  it("reports the base power selected by the same automatic @smogon/calc result", () => {
    const result = calculateSmogonHit(
      defender,
      {
        ...hit,
        move: mustResolve("move", "けたぐり"),
        repeat: 1,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    expect(result.movePower).toEqual({
      catalogBasePower: 0,
      appliedBasePower: 20,
      source: "automatic",
    });
  });

  it("preserves fractional effective base power reported by @smogon/calc", () => {
    const result = calculateSmogonHit(
      { ...defender, item: mustResolve("item", "たべのこし") },
      {
        ...hit,
        move: mustResolve("move", "はたきおとす"),
        repeat: 1,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    expect(result.movePower).toEqual({
      catalogBasePower: 65,
      appliedBasePower: 97.5,
      source: "automatic",
    });
    expect(result.description).toContain("(97.5 BP)");
  });

  it("applies an audited manual power once and restores the canonical move name", () => {
    const neutralDefender = {
      ...defender,
      pokemon: mustResolve("pokemon", "ミュウ"),
      ability: undefined,
      item: undefined,
      teraType: undefined,
      evs: zeroEvs,
    };
    const lastRespectsHit: ScenarioHit = {
      ...hit,
      move: mustResolve("move", "おはかまいり"),
      repeat: 1,
      attackerBoosts: {},
      defenderBoosts: {},
      attackerSide: emptySide,
      defenderSide: emptySide,
    };
    const automatic = calculateSmogonHit(
      neutralDefender,
      lastRespectsHit,
      { gameType: "singles", weather: "none", terrain: "none" },
    );
    const manual = calculateSmogonHit(
      neutralDefender,
      {
        ...lastRespectsHit,
        movePowerOverride: { value: 300, source: "manual" },
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    expect(manual.damageRange.max).toBeGreaterThan(automatic.damageRange.max);
    expect(manual.movePower).toEqual({
      catalogBasePower: 50,
      appliedBasePower: 300,
      source: "manual",
      detailLabel: "任意威力",
    });
    expect(manual.description).toContain("Last Respects");
    expect(manual.description).not.toContain("ChampionCreator Power Override");
  });

  it("applies a manual power to an HP-dependent move without reapplying its automatic formula", () => {
    const eruptionHit: ScenarioHit = {
      ...hit,
      attacker: {
        ...hit.attacker,
        pokemon: mustResolve("pokemon", "コータス"),
      },
      move: mustResolve("move", "ふんか"),
      repeat: 1,
      attackerBoosts: {},
      defenderBoosts: {},
      attackerSide: emptySide,
      defenderSide: emptySide,
    };
    const automatic = calculateSmogonHit(
      defender,
      eruptionHit,
      { gameType: "singles", weather: "none", terrain: "none" },
    );
    const manual = calculateSmogonHit(
      defender,
      {
        ...eruptionHit,
        movePowerOverride: { value: 87, source: "manual" },
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    expect(automatic.movePower?.appliedBasePower).toBe(150);
    expect(manual.movePower).toEqual({
      catalogBasePower: 150,
      appliedBasePower: 87,
      source: "manual",
      detailLabel: "任意威力",
    });
    expect(manual.damageRange.max).toBeLessThan(automatic.damageRange.max);
    expect(manual.description).toContain("Eruption");
    expect(manual.description).not.toContain("ChampionCreator Power Override");
  });

  it("uses the assisted option label and ignores overrides outside the audited registry", () => {
    const assisted = calculateSmogonHit(
      defender,
      {
        ...hit,
        move: mustResolve("move", "ゆきなだれ"),
        movePowerOverride: { value: 120, source: "assisted" },
        repeat: 1,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );
    const automaticEarthquake = calculateSmogonHit(
      defender,
      hit,
      fieldState,
    );
    const ignoredEarthquakeOverride = calculateSmogonHit(
      defender,
      {
        ...hit,
        movePowerOverride: { value: 300, source: "manual" },
      },
      fieldState,
    );

    expect(assisted.movePower).toEqual({
      catalogBasePower: 60,
      appliedBasePower: 120,
      source: "assisted",
      detailLabel: "同じターンに相手からダメージを受けた",
    });
    expect(assisted.description).toContain("Avalanche");
    expect(ignoredEarthquakeOverride.damageRolls).toEqual(automaticEarthquake.damageRolls);
    expect(ignoredEarthquakeOverride.movePower?.source).toBe("standard");
  });

  it("reports increasing and ordinary multi-hit base powers without flattening their meaning", () => {
    const tripleAxel = calculateSmogonHit(
      defender,
      {
        ...hit,
        move: mustResolve("move", "トリプルアクセル"),
        moveHits: 3,
        repeat: 3,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );
    const tripleKick = calculateSmogonHit(
      defender,
      {
        ...hit,
        move: mustResolve("move", "トリプルキック"),
        moveHits: 3,
        repeat: 3,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    expect(tripleAxel.movePower).toEqual({
      catalogBasePower: 20,
      appliedBasePower: 120,
      source: "automatic",
      perHitBasePowers: [20, 40, 60],
    });
    expect(tripleKick.movePower).toEqual({
      catalogBasePower: 10,
      appliedBasePower: 60,
      source: "automatic",
      perHitBasePowers: [10, 20, 30],
    });
  });

  it("distinguishes status and fixed-damage moves from base-power attacks", () => {
    const fixedDamage = calculateSmogonHit(
      defender,
      {
        ...hit,
        move: mustResolve("move", "ちきゅうなげ"),
        repeat: 1,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );
    const status = calculateSmogonHit(
      defender,
      {
        ...hit,
        move: mustResolve("move", "まもる"),
        repeat: 1,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );
    const unsupported = calculateSmogonHit(
      defender,
      {
        ...hit,
        move: mustResolve("move", "ふくろだたき"),
        repeat: 1,
        attackerBoosts: {},
        defenderBoosts: {},
        attackerSide: emptySide,
        defenderSide: emptySide,
      },
      { gameType: "singles", weather: "none", terrain: "none" },
    );

    expect(fixedDamage.movePower).toEqual({
      catalogBasePower: 0,
      source: "fixed-damage",
    });
    expect(status.movePower).toEqual({
      catalogBasePower: 0,
      source: "status",
    });
    expect(unsupported.movePower).toEqual({
      catalogBasePower: 0,
      source: "unsupported",
    });
  });
});
