import { calculate, Generations, Move, Pokemon, toID } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import type { Build, ScenarioHit } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import moveOptions from "../data/generated/move-options.gen.json";
import { buildIntegratedDefenceSearchInput, buildTargetBuildFromUi, createDefaultScenarioForms, createDefaultTargetForm } from "../ui/defenceSearchUi";
import { runDefenceSearchWorkerTask, type DefenceSearchWorkerMessage } from "../worker/defenceSearchWorker";
import { calculateSmogonHit, flattenDamageRolls, toSmogonMove, toSmogonPokemon } from "./smogonAdapter";
import { getMoveHpMechanicsProfile } from "./moveHpMechanics";
import { evaluateHpEventRule } from "./hpEventRules";

const gen = Generations.get(9);
const field = { gameType: "singles", weather: "none", terrain: "none" } as const;
const side = { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false };
const build = (abilityInput = "", itemInput = "") => buildTargetBuildFromUi({
  ...createDefaultTargetForm(), pokemonInput: "ミュウ", natureInput: "", abilityInput, itemInput,
});
const makeHit = (moveInput: string, attacker: Build = build()): ScenarioHit => ({
  id: "champions-move", attacker,
  move: toEntityRef(resolveEntity("move", moveInput), "move")!,
  repeat: 1, critical: false, attackerBoosts: {}, defenderBoosts: {}, attackerSide: side, defenderSide: side,
});
const updatedPowers = [
  ["ねらいうち", "Snipe Shot", 80, 85],
  ["スターアサルト", "Meteor Assault", 150, 170],
  ["きりさく", "Slash", 70, 80],
] as const;

describe("Champions move metadata in the CC Gen9 engine", () => {
  it.each(updatedPowers)("uses %s's updated power in data, display and damage", (label, canonical, oldPower, power) => {
    expect(new Move(gen, canonical).bp).toBe(power);
    expect(new Move(Generations.get(8), canonical).bp).toBe(oldPower);
    expect(new Move(Generations.get(0), canonical).bp).toBe(power);
    expect(moveOptions.entries.find(entry => entry.id === toID(canonical)))
      .toMatchObject({ label, basePower: power });
    const defender = build();
    for (const critical of [false, true]) {
      const hit = { ...makeHit(label), critical };
      const actual = calculateSmogonHit(defender, hit, field);
      const reference = (basePower: number) => calculate(gen, toSmogonPokemon(hit.attacker), toSmogonPokemon(defender),
        new Move(gen, canonical, { isCrit: critical, overrides: { basePower } }));
      expect(actual.damageRolls).toEqual(flattenDamageRolls(reference(power).damage));
      expect(actual.damageRange.max).toBeGreaterThan(reference(oldPower).range()[1]);
      expect(actual.movePower).toMatchObject({ catalogBasePower: power, appliedBasePower: power });
    }
  });

  it("preserves the existing manual-power support boundary", () => {
    const hit = { ...makeHit("ふんか"), movePowerOverride: { source: "manual" as const, value: 42 } };
    const actual = calculateSmogonHit(build(), hit, field);
    const expected = calculate(gen, new Pokemon(gen, "Mew", { level: 50 }), new Pokemon(gen, "Mew", { level: 50 }),
      new Move(gen, "Flamethrower", { overrides: { basePower: 42 } }));
    expect(actual.damageRolls).toEqual(flattenDamageRolls(expected.damage));
    expect(actual.movePower).toMatchObject({ catalogBasePower: 150, appliedBasePower: 42, source: "manual" });
    const standard = makeHit("ねらいうち");
    const unsupportedOverride = calculateSmogonHit(build(), { ...standard, movePowerOverride: hit.movePowerOverride }, field);
    expect(unsupportedOverride.damageRolls).toEqual(calculateSmogonHit(build(), standard, field).damageRolls);
    expect(unsupportedOverride.movePower).toMatchObject({ catalogBasePower: 85, appliedBasePower: 85, source: "standard" });
  });

  it("adds only the punch flag to Double Shock and retains adjacent move metadata", () => {
    const shock = new Move(gen, "Double Shock");
    expect(shock.bp).toBe(120);
    expect(shock.flags).toEqual({ contact: 1, punch: 1 });
    expect(shock.flags).toEqual(new Move(Generations.get(0), "Double Shock").flags);
    expect(new Move(gen, "Thunder Punch")).toMatchObject({ bp: 75, flags: { contact: 1, punch: 1 } });
    expect(new Move(gen, "Wild Charge")).toMatchObject({ bp: 90, flags: { contact: 1 } });
    expect(new Move(gen, "Wild Charge").flags.punch).toBeUndefined();
  });

  it.each([
    ["", "", false],
    ["てつのこぶし", "", false],
    ["", "パンチグローブ", false],
    ["てつのこぶし", "パンチグローブ", true],
    ["かたいツメ", "パンチグローブ", false],
    ["えんかく", "", false],
  ] as const)("uses native punch/contact modifiers with ability %s, item %s, crit %s", (ability, item, critical) => {
    const attacker = build(ability, item);
    const defender = build("はどうのぼうご");
    const hit = { ...makeHit("でんこうそうげき", attacker), critical };
    const actual = calculateSmogonHit(defender, hit, field);
    // Same Electric/Physical/contact/punch attributes, with an explicit 120 BP reference.
    const expected = calculate(gen, toSmogonPokemon(attacker), toSmogonPokemon(defender),
      new Move(gen, "Thunder Punch", { isCrit: critical, overrides: { basePower: 120 } }));
    expect(actual.damageRolls).toEqual(flattenDamageRolls(expected.damage));
  });

  it("lets Punching Glove avoid Aura Guard and contact HP events for Double Shock", () => {
    const defender = build("はどうのぼうご");
    const contact = makeHit("でんこうそうげき");
    const gloved = makeHit("でんこうそうげき", build("", "パンチグローブ"));
    expect(toSmogonMove(gloved).flags.punch).toBe(1);
    expect(getMoveHpMechanicsProfile(contact).makesContact).toBe(true);
    expect(getMoveHpMechanicsProfile(gloved).makesContact).toBe(false);
    expect(calculateSmogonHit(defender, gloved, field).damageRolls)
      .toEqual(calculateSmogonHit(build(), gloved, field).damageRolls);
    for (const effectId of ["rocky-helmet-damage", "rough-skin-damage"]) {
      const event = { id: effectId, effectId, enabled: true, sequenceContext: "currentMove" as const };
      const evaluate = (hit: ScenarioHit) => evaluateHpEventRule({ event, attackerBuild: hit.attacker, defenderBuild: defender,
        moveMakesContact: getMoveHpMechanicsProfile(hit).makesContact });
      expect(evaluate(contact).damage).toBeGreaterThan(0);
      expect(evaluate(gloved).damage).toBe(0);
    }
  });

  it.each(updatedPowers)("uses %s's power in Worker results and final candidate evaluation", async (label, _canonical, _oldPower, power) => {
    const scenario = createDefaultScenarioForms()[0];
    const target = { ...createDefaultTargetForm(), pokemonInput: "ミュウ", natureInput: "",
      statPoints: { hp: 0, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 } };
    const attack = { ...scenario.attacks[0], attackerPokemonInput: "ミュウ", attackerNatureInput: "", moveInput: label };
    const input = buildIntegratedDefenceSearchInput(target, [{ ...scenario, attacks: [attack] }]);
    const messages: DefenceSearchWorkerMessage[] = [];
    await runDefenceSearchWorkerTask(structuredClone({ type: "start" as const, requestId: label,
      build: input.build, scenarios: input.scenarios, options: { maxResults: 1, yieldEvery: 100 } }), message => messages.push(message));
    const complete = messages.find(message => message.type === "complete");
    expect(complete?.type).toBe("complete");
    if (complete?.type !== "complete") throw new Error("Worker did not complete");
    expect(complete.candidates).toHaveLength(1);
    const candidate = complete.candidates[0];
    expect(candidate.passed).toBe(true);
    expect(candidate.scenarioResults[0].hitEvaluations[0].movePower).toMatchObject({ catalogBasePower: power, appliedBasePower: power });
    const actual = calculateSmogonHit({ ...input.build, evs: candidate.appliedEvs }, input.scenarios[0].hits[0], input.scenarios[0].field);
    expect(candidate.scenarioResults[0].hitEvaluations[0].damageRolls).toEqual(actual.damageRolls);
  });
});
