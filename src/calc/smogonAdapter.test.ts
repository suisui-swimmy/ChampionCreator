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

  it("passes Dynamax state through so @smogon/calc doubles max HP", () => {
    const normalAttacker = toSmogonPokemon(attacker);
    const dynamaxedAttacker = toSmogonPokemon({ ...attacker, isDynamaxed: true });

    expect(dynamaxedAttacker.isDynamaxed).toBe(true);
    expect(dynamaxedAttacker.maxHP()).toBe(normalAttacker.maxHP() * 2);
  });
});
