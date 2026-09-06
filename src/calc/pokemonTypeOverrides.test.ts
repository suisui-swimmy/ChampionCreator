import { describe, expect, it } from "vitest";
import { calculate, Generations, Move, Pokemon } from "@smogon/calc";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import { buildIntegratedDefenceSearchInput, buildTargetBuildFromUi, createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { evaluateHpEventRule } from "./hpEventRules";
import { calculateSmogonHit, getSmogonTypeEffectiveness, isSmogonGrounded, toSmogonPokemon } from "./smogonAdapter";
import { runDefenceSearchWorkerTask, type DefenceSearchWorkerMessage } from "../worker/defenceSearchWorker";

const build = (type1Input: string, type2Input = "", addedTypeInput = "") => buildTargetBuildFromUi({
  ...createDefaultTargetForm(), pokemonInput: "ミュウ", natureInput: "", typeOverride: { type1Input, type2Input, addedTypeInput },
});

describe("Pokemon type override calculation", () => {
  it("feeds all current types to Calc and preserves species, stats and HP event typing", () => {
    const triple = build("むし", "はがね", "くさ");
    const pokemon = toSmogonPokemon(triple);
    expect(pokemon.getTypes()).toEqual(["Bug", "Steel", "Grass"]);
    expect(pokemon.species.types).toEqual(["Psychic"]);
    expect(pokemon.rawStats).toEqual(new Pokemon(9, "Mew", { level: 50 }).rawStats);
    expect(getSmogonTypeEffectiveness("Fire", triple)).toBe(8);
    expect(getSmogonTypeEffectiveness("Normal", build("ほのお", "エスパー", "ゴースト"))).toBe(0);
    expect(isSmogonGrounded(build("みず", "ひこう", "くさ"))).toBe(false);
    expect(evaluateHpEventRule({
      event: { id: "salt", effectId: "salt-cure-damage", enabled: true, sequenceContext: "currentMove" },
      attackerBuild: build("エスパー"), defenderBuild: build("みず", "ひこう", "ゴースト"),
    })).toMatchObject({ supported: true, damage: 21 });
    expect(evaluateHpEventRule({
      event: { id: "sand", effectId: "sandstorm-damage", enabled: true, sequenceContext: "currentMove" },
      attackerBuild: build("エスパー"), defenderBuild: triple,
    })).toMatchObject({ supported: true, damage: 0 });
  });

  it("matches the explicit patched Calc path for direct rolls", () => {
    const target = { ...createDefaultTargetForm(), pokemonInput: "ミュウ", natureInput: "", typeOverride: { type1Input: "むし", type2Input: "はがね", addedTypeInput: "くさ" } };
    const scenario = createDefaultScenarioForms()[0];
    const attack = { ...scenario.attacks[0], attackerPokemonInput: "ミュウ", attackerNatureInput: "", attackerStatPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, moveInput: "かえんほうしゃ" };
    const input = buildIntegratedDefenceSearchInput(target, [{ ...scenario, attacks: [attack] }]);
    const hit = input.scenarios[0].hits[0];
    const result = calculateSmogonHit(input.build, hit, input.scenarios[0].field);
    const expected = calculate(Generations.get(9), toSmogonPokemon(hit.attacker), new Pokemon(9, "Mew", {
      level: 50, typeOverrides: ["Bug", "Steel"], addedType: "Grass",
    }), new Move(9, "Flamethrower"));
    expect(result.damageRolls).toEqual(expected.damage);
    expect(expected.range()).toEqual([272, 328]);
  });

  it("removes the added type for normal and Stellar Tera while retaining saved state", () => {
    for (const teraName of ["ほのお", "ステラ"]) {
      const source = build("むし", "はがね", "くさ");
      const tera = { ...source, teraType: toEntityRef(resolveEntity("type", teraName), "type")! };
      expect(toSmogonPokemon(tera).addedType).toBeUndefined();
      expect(getSmogonTypeEffectiveness("Fire", tera)).toBe(teraName === "ほのお" ? 0.5 : 4);
      expect(source.typeOverride?.addedType?.canonicalName).toBe("Grass");
    }
  });

  it("preserves type state across Worker structured cloning and final candidate evaluation", async () => {
    const target = { ...createDefaultTargetForm(), pokemonInput: "ミュウ", natureInput: "", statPoints: { hp: 0, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 }, typeOverride: { type1Input: "むし", type2Input: "はがね", addedTypeInput: "くさ" } };
    const scenario = createDefaultScenarioForms()[0];
    const attack = { ...scenario.attacks[0], attackerPokemonInput: "ミュウ", attackerNatureInput: "", moveInput: "かえんほうしゃ", minSurvivalProbabilityPercent: 100, requiredSurvivedHits: 1 };
    const input = buildIntegratedDefenceSearchInput(target, [{ ...scenario, attacks: [attack] }]);
    const run = async (withOverride: boolean) => {
      const messages: DefenceSearchWorkerMessage[] = [];
      await runDefenceSearchWorkerTask(structuredClone({
        type: "start" as const, requestId: withOverride ? "triple" : "native",
        build: { ...input.build, typeOverride: withOverride ? input.build.typeOverride : undefined },
        scenarios: input.scenarios, options: { maxResults: 1, yieldEvery: 100 },
      }), (message) => messages.push(message));
      const complete = messages.find((message) => message.type === "complete");
      expect(complete).toBeDefined();
      return complete?.type === "complete" ? complete.candidates : [];
    };
    expect(await run(true)).toHaveLength(0);
    expect(await run(false)).toHaveLength(1);
  });
});
