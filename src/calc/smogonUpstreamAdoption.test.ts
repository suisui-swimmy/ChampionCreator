import { calculate, Generations, Move, Pokemon } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import type { Build, ScenarioHit, StatBoostTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import { buildTargetBuildFromUi, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { calculateSmogonHit, flattenDamageRolls, toSmogonPokemon } from "./smogonAdapter";

const gen = Generations.get(9);
const field = { gameType: "singles", weather: "none", terrain: "none" } as const;
const side = { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false };
const build = (abilityInput = "") => buildTargetBuildFromUi({
  ...createDefaultTargetForm(), pokemonInput: "ミュウ", natureInput: "", abilityInput,
});
const makeHit = (attacker: Build, moveInput = "たいあたり"): ScenarioHit => ({
  id: "upstream-adoption", attacker,
  move: toEntityRef(resolveEntity("move", moveInput), "move")!,
  repeat: 1, critical: false, attackerBoosts: {}, defenderBoosts: {},
  attackerSide: side, defenderSide: side,
});

describe("frozen upstream adoption", () => {
  it.each([
    ["ふとうのけん", "Intrepid Sword", "atk", "attacker"],
    ["ふくつのたて", "Dauntless Shield", "def", "defender"],
  ] as const)("preserves the existing %s entry boost for saved inputs", (label, canonical, stat, role) => {
    const boosted = build(label);
    const neutral = build();
    expect(toSmogonPokemon(boosted).abilityOn).toBe(true);
    expect(toSmogonPokemon(boosted, {}, false).abilityOn).toBe(false);

    for (const rank of [-1, 0, 5, 6]) {
      const boosts: StatBoostTable = { [stat]: rank };
      const hit = makeHit(role === "attacker" ? boosted : neutral);
      if (role === "attacker") hit.attackerBoosts = boosts;
      else hit.defenderBoosts = boosts;
      const before = structuredClone(hit);
      const actual = calculateSmogonHit(role === "defender" ? boosted : neutral, hit, field);
      const directBoosted = new Pokemon(gen, "Mew", { level: 50, ability: canonical, abilityOn: true, boosts });
      const directNeutral = new Pokemon(gen, "Mew", { level: 50 });
      const expected = calculate(gen,
        role === "attacker" ? directBoosted : directNeutral,
        role === "defender" ? directBoosted : directNeutral,
        new Move(gen, "Tackle"));
      expect(actual.damageRolls).toEqual(flattenDamageRolls(expected.damage));
      expect(hit).toEqual(before);
      if (rank === 0) {
        expect(actual.damageRange).toMatchObject(role === "attacker" ? { min: 23, max: 28 } : { min: 11, max: 13 });
      }
    }
  });

  it.each(["アナライズ", "でんきにかえる", "もらいび"])("keeps %s inactive without an explicit trigger", (label) => {
    expect(toSmogonPokemon(build(label)).abilityOn).toBe(false);
  });

  it.each(["Zacian", "Zacian-Crowned", "Zamazenta", "Zamazenta-Crowned"])(
    "preserves the default ability for legacy %s inputs without an explicit ability",
    (species) => {
      const legacy = {
        ...build(), ability: undefined,
        pokemon: toEntityRef(resolveEntity("pokemon", species), "pokemon")!,
      };
      expect(toSmogonPokemon(legacy).abilityOn).toBe(true);
      expect(toSmogonPokemon(legacy, {}, false).abilityOn).toBe(false);
      const isDefender = species.startsWith("Zamazenta");
      const actual = calculateSmogonHit(isDefender ? legacy : build(), makeHit(isDefender ? build() : legacy), field);
      const direct = new Pokemon(gen, species, { level: 50, abilityOn: true });
      const neutral = new Pokemon(gen, "Mew", { level: 50 });
      const expected = calculate(gen, isDefender ? neutral : direct, isDefender ? direct : neutral, new Move(gen, "Tackle"));
      expect(actual.damageRolls).toEqual(flattenDamageRolls(expected.damage));
      expect(legacy.ability).toBeUndefined();
    },
  );

  it("uses native Dragonize for Normal moves without boosting other types", () => {
    const dragonize = build("ドラゴンスキン");
    const neutral = build();
    expect(calculateSmogonHit(neutral, makeHit(dragonize), field).damageRange).toMatchObject({ min: 19, max: 23 });
    for (const move of ["シャドーボール", "りゅうのはどう"]) {
      const actual = calculateSmogonHit(neutral, makeHit(dragonize, move), field);
      const baseline = calculateSmogonHit(neutral, makeHit(neutral, move), field);
      expect(actual.damageRolls).toEqual(baseline.damageRolls);
    }
  });
});
