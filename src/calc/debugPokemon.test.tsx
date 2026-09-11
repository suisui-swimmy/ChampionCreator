import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { calculate, Generations, Move, Pokemon, toID } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import { getEntityInputOptions, getPokemonAbilityInputOptions, resolveEntity } from "../localization/resolver";
import { toEntityRef } from "../domain/model";
import { statPointTableToSmogonEvs } from "../domain/championsStats";
import { buildIntegratedDefenceSearchInput, buildOffenseAdjustmentInput, buildSpeedAdjustmentInput, buildTargetBuildFromUi, createDefaultScenarioForms, createDefaultTargetForm, createOffenseAdjustmentFormFromScenarioAttack } from "../ui/defenceSearchUi";
import { PokemonTypeField } from "../ui/PokemonTypeField";
import { findPokemonArtwork } from "../ui/pokemonArtwork";
import { getPokemonBaseTypes, isTypelessPokemon, pokemonTypeOptions } from "../ui/pokemonTypes";
import { createShareStateDocument, parseShareStateDocument } from "../ui/shareState";
import { createBoxEntryFromState, parseBoxBackupDocument, stringifyBoxBackupDocument } from "../ui/boxStorage";
import { createEnemyBoxEntryFromScenarios, parseEnemyBoxBackupDocument, stringifyEnemyBoxBackupDocument } from "../ui/enemyBoxStorage";
import { evaluateCandidate } from "../search/defenceSearch";
import { runDefenceSearchWorkerTask, type DefenceSearchWorkerMessage } from "../worker/defenceSearchWorker";
import { getBeatUpBasePowerForPokemon } from "./beatUp";
import { evaluateHpEventRule } from "./hpEventRules";
import { calculateSmogonFinalSpeed, calculateSmogonHit, getSmogonTypeEffectiveness, toSmogonField, toSmogonPokemon } from "./smogonAdapter";

const gen = Generations.get(9);
const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const debugBaseStats = { hp: 225, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 };
const target = () => ({ ...createDefaultTargetForm(), pokemonInput: "みがわり", natureInput: "" });
const scenarios = () => {
  const form = createDefaultScenarioForms()[0];
  return [{ ...form, attacks: [{ ...form.attacks[0], attackerPokemonInput: "みがわり", attackerNatureInput: "", attackerStatPoints: zero, moveInput: "たいあたり", requiredSurvivedHits: 1, minSurvivalProbabilityPercent: 100 }] }];
};

// Independent expected metadata, rather than importing the implementation's fixture.
const directSubstitute = () => new Pokemon(gen, "Substitute", {
  level: 50,
  overrides: { name: "Substitute" as Pokemon["name"], types: ["???"], baseStats: debugBaseStats, weightkg: 0, abilities: { 0: "" } },
});

describe("damage debugging Substitute", () => {
  it("resolves the exact Japanese Pokemon separately from the existing move", () => {
    for (const input of ["みがわり", "ミガワリ", "Substitute"]) {
      expect(resolveEntity("pokemon", input)).toMatchObject({ canonicalName: "Substitute" });
    }
    expect(resolveEntity("pokemon", "みがわり").status).toBe("exact");
    expect(resolveEntity("move", "みがわり")).toMatchObject({ status: "exact", canonicalName: "Substitute" });
    expect(getEntityInputOptions("pokemon").filter((option) => option.value === "みがわり")).toHaveLength(1);
    expect(getPokemonAbilityInputOptions("Substitute")).toEqual([]);
    expect(resolveEntity("pokemon", "みがわ").status).toBe("not-found");
  });

  it("starts at HP 300 / other stats 100 and follows normal stat rules without mutating Calc data", () => {
    const build = buildTargetBuildFromUi(target());
    const pokemon = toSmogonPokemon(build);
    expect(pokemon.species.baseStats).toEqual(debugBaseStats);
    expect(pokemon.rawStats).toEqual({ hp: 300, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 });
    expect(pokemon.ability).toBeUndefined();
    expect(pokemon.clone().species).toEqual(pokemon.species);
    expect(toSmogonPokemon(build, {}, undefined, { currentHp: 30 }).curHP()).toBe(30);
    expect(toSmogonPokemon({ ...build, level: 1, ivs: zero }).rawStats).toEqual({ hp: 15, atk: 6, def: 6, spa: 6, spd: 6, spe: 6 });
    const statPoints = { ...zero, hp: 32, def: 32 };
    expect(toSmogonPokemon({ ...build, statPoints, evs: statPointTableToSmogonEvs(statPoints) }).rawStats).toEqual({ hp: 332, atk: 100, def: 132, spa: 100, spd: 100, spe: 100 });
    expect(toSmogonPokemon(buildTargetBuildFromUi({ ...target(), natureInput: "いじっぱり" })).rawStats).toEqual({ hp: 300, atk: 110, def: 100, spa: 90, spd: 100, spe: 100 });
    expect(gen.species.get(toID("Substitute"))).toBeUndefined();
    expect(new Pokemon(gen, "Mew", { level: 50 }).rawStats.hp).toBe(175);
    expect(getBeatUpBasePowerForPokemon("Substitute")).toBe(13);
  });

  it.each([...gen.types].filter((type) => type.name !== "???").map((type) => type.name))(
    "receives %s neutrally with identical native Calc rolls and no STAB",
    (type) => {
      const build = buildTargetBuildFromUi(target());
      expect(getSmogonTypeEffectiveness(type, build)).toBe(1);
      const move = new Move(gen, "Tackle", { overrides: { type } });
      const actual = calculate(gen, toSmogonPokemon(build), toSmogonPokemon(build), move);
      const neutral = calculate(gen, directSubstitute(), directSubstitute(), new Move(gen, "Tackle"));
      expect(actual.damage).toEqual(neutral.damage);
      expect(actual.range()[0]).toBeGreaterThan(0);
    },
  );

  it.each(["たいあたり", "シャドーボール", "にどげり", "ちきゅうなげ"])("matches direct Calc for %s as attacker and defender", (moveInput) => {
    const forms = scenarios();
    forms[0].attacks[0].moveInput = moveInput;
    const input = buildIntegratedDefenceSearchInput(target(), forms);
    const hit = input.scenarios[0].hits[0];
    const direct = calculate(gen, directSubstitute(), directSubstitute(), new Move(gen, hit.move.canonicalName), toSmogonField(input.scenarios[0].field, hit));
    expect(calculateSmogonHit(input.build, hit, input.scenarios[0].field).damageRolls).toEqual(typeof direct.damage === "number" ? [direct.damage] : direct.damage.flat());
  });

  it("preserves explicit Tera and ability effects while applying neutral HP event typing", () => {
    const build = buildTargetBuildFromUi(target());
    const fireTera = { ...build, teraType: toEntityRef(resolveEntity("type", "ほのお"), "type")! };
    expect(getSmogonTypeEffectiveness("Water", fireTera)).toBe(2);
    expect(toSmogonPokemon({ ...build, ability: toEntityRef(resolveEntity("ability", "ふゆう"), "ability")! }).ability).toBe("Levitate");
    expect(evaluateHpEventRule({
      event: { id: "sand", effectId: "sandstorm-damage", enabled: true, sequenceContext: "currentMove" },
      attackerBuild: build, defenderBuild: build,
    })).toMatchObject({ supported: true, damage: 18 });
    const attack = scenarios()[0].attacks[0];
    const offense = buildOffenseAdjustmentInput(target(), createOffenseAdjustmentFormFromScenarioAttack(attack));
    expect(toSmogonPokemon(offense.defenderBuild).species.baseStats).toEqual(debugBaseStats);
    expect(toSmogonPokemon(offense.attackerBuild).species.baseStats).toEqual(debugBaseStats);
    const speed = buildSpeedAdjustmentInput(target(), attack);
    expect(toSmogonPokemon(speed.opponentBuild!).stats.spe).toBe(100);
    expect(calculateSmogonFinalSpeed(speed.targetBuild, { gameType: "singles", weather: "none", terrain: "none" }, { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false })).toBe(100);
  });

  it("shows the supplied artwork and type-none text without exposing the internal type", () => {
    expect(isTypelessPokemon("みがわり")).toBe(true);
    expect(isTypelessPokemon("存在しないポケモン")).toBe(false);
    expect(getPokemonBaseTypes("みがわり")).toEqual([]);
    expect(pokemonTypeOptions).toHaveLength(18);
    const html = renderToStaticMarkup(<PokemonTypeField ownerLabel="調整対象" pokemonInput="みがわり" teraEnabled={false} onChange={() => {}} />);
    expect(html).toContain("タイプなし");
    expect(html).not.toContain("???");
    expect(html).not.toContain("未選択");
    expect(findPokemonArtwork({ input: "みがわり" })).toMatchObject({ label: "みがわり", types: [], artworkUrl: "/assets/debug/substitute.png" });
    const png = readFileSync(new URL("../../public/assets/debug/substitute.png", import.meta.url));
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("round-trips both Pokemon roles through share and box backups", () => {
    const parsed = parseShareStateDocument(JSON.stringify(createShareStateDocument(target(), scenarios())));
    expect(parsed.target.pokemonInput).toBe("みがわり");
    expect(parsed.scenarios[0].attacks[0].attackerPokemonInput).toBe("みがわり");
    expect(toSmogonPokemon(buildTargetBuildFromUi(parsed.target)).species.baseStats).toEqual(debugBaseStats);
    const box = parseBoxBackupDocument(stringifyBoxBackupDocument([createBoxEntryFromState(target(), scenarios())]));
    expect(box.status).toBe("success");
    if (box.status === "success") expect(box.entries[0].payload.target.pokemonInput).toBe("みがわり");
    const enemies = parseEnemyBoxBackupDocument(stringifyEnemyBoxBackupDocument([createEnemyBoxEntryFromScenarios(scenarios())]));
    expect(enemies.status).toBe("success");
    if (enemies.status === "success") expect(enemies.entries[0].payload.scenarios[0].attacks[0].attackerPokemonInput).toBe("みがわり");
  });

  it("survives Worker cloning and returns only re-evaluated legal candidates", async () => {
    const forms = scenarios();
    forms[0].attacks[0].attackerPokemonInput = "ミュウ";
    forms[0].attacks[0].moveInput = "サイコキネシス";
    const input = buildIntegratedDefenceSearchInput({ ...target(), statPoints: { ...zero, atk: 32, spa: 32 } }, forms);
    const messages: DefenceSearchWorkerMessage[] = [];
    await runDefenceSearchWorkerTask(structuredClone({
      type: "start" as const, requestId: "debug-substitute", build: input.build, scenarios: input.scenarios,
      options: { maxResults: 3, yieldEvery: 100 },
    }), (message) => messages.push(message));
    expect(messages.some((message) => message.type === "error")).toBe(false);
    const complete = messages.find((message) => message.type === "complete");
    expect(complete?.type).toBe("complete");
    if (complete?.type !== "complete") return;
    expect(complete.candidates).toHaveLength(3);
    for (const candidate of complete.candidates) {
      expect(candidate.usedStatPointBudget).toBeLessThanOrEqual(66);
      expect(evaluateCandidate(input.build, input.scenarios, candidate.candidate).passed).toBe(true);
    }
  });
});
