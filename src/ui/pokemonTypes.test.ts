import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createPokemonTypeOverride,
  getPokemonBaseTypes,
  getPokemonTypeSelectionValue,
  pokemonTypeOptions,
  resolvePokemonTypeOverride,
  updatePokemonTypeOverride,
} from "./pokemonTypes";
import {
  buildIntegratedDefenceSearchInput,
  buildOffenseAdjustmentInput,
  buildScenarioAttackBuildFromUi,
  buildSpeedAdjustmentInput,
  buildTargetBuildFromUi,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  createOffenseAdjustmentFormFromScenarioAttack,
} from "./defenceSearchUi";
import { createShareStateDocument, parseShareStateDocument, SHARE_SCHEMA_VERSION } from "./shareState";
import { createBoxEntryFromState, parseBoxBackupDocument, stringifyBoxBackupDocument } from "./boxStorage";
import { createEnemyBoxEntryFromScenarios, parseEnemyBoxBackupDocument, stringifyEnemyBoxBackupDocument } from "./enemyBoxStorage";

const manual = { type1Input: "ほのお", type2Input: "エスパー", addedTypeInput: "ゴースト" };

describe("Pokemon type state", () => {
  it("follows exact Pokemon/form identities and never uses fuzzy artwork matches", () => {
    expect(getPokemonBaseTypes("リザードン")).toEqual(["Fire", "Flying"]);
    expect(getPokemonBaseTypes("メガリザードンX")).toEqual(["Fire", "Dragon"]);
    expect(getPokemonBaseTypes("Charizard-Mega-Y")).toEqual(["Fire", "Flying"]);
    expect(getPokemonBaseTypes("リザード")).toEqual(["Fire"]);
    expect(getPokemonBaseTypes("リザー")).toEqual([]);
    expect(getPokemonBaseTypes("")).toEqual([]);
    expect(createPokemonTypeOverride("ピカチュウ")).toEqual({ type1Input: "でんき", type2Input: "", addedTypeInput: "" });
    expect(createPokemonTypeOverride("存在しないポケモン")).toBeUndefined();
  });

  it("publishes all 18 supplied 60px PNGs with canonical paths", () => {
    expect(pokemonTypeOptions).toHaveLength(18);
    for (const option of pokemonTypeOptions) {
      const png = readFileSync(new URL(`../../public/assets/types/${option.canonicalName.toLowerCase()}.png`, import.meta.url));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([60, 60]);
    }
  });

  it("keeps ordinary types and the additional type distinct and rejects invalid states", () => {
    expect(resolvePokemonTypeOverride(manual)).toMatchObject({
      types: [{ canonicalName: "Fire" }, { canonicalName: "Psychic" }], addedType: { canonicalName: "Ghost" },
    });
    expect(resolvePokemonTypeOverride(undefined)).toBeUndefined();
    expect(getPokemonTypeSelectionValue("fire")).toBe("ほのお");
    expect(getPokemonTypeSelectionValue(" ｺﾞｰｽﾄ ")).toBe("ゴースト");
    for (const override of [
      { ...manual, type1Input: "" }, { ...manual, type1Input: "???" },
      { ...manual, type1Input: "ステラ" }, { ...manual, type2Input: "Fire" },
      { ...manual, addedTypeInput: "ほのお" }, { ...manual, addedTypeInput: "存在しないタイプ" },
      { ...manual, type2Input: "ゴースト" },
    ]) expect(() => resolvePokemonTypeOverride(override)).toThrow();
    expect(updatePokemonTypeOverride(manual, "type1Input", "エスパー")).toEqual({ type1Input: "エスパー", type2Input: "", addedTypeInput: "ゴースト" });
    expect(updatePokemonTypeOverride(manual, "type2Input", "ゴースト").addedTypeInput).toBe("");
  });

  it("carries type state into target, defence, offense and speed builds", () => {
    const target = { ...createDefaultTargetForm(), typeOverride: manual };
    const scenario = createDefaultScenarioForms()[0];
    const attack = { ...scenario.attacks[0], attackerTypeOverride: manual };
    const expected = resolvePokemonTypeOverride(manual);
    expect(buildTargetBuildFromUi(target).typeOverride).toEqual(expected);
    expect(buildScenarioAttackBuildFromUi(attack, "enemy").typeOverride).toEqual(expected);
    const input = buildIntegratedDefenceSearchInput(target, [{ ...scenario, attacks: [attack] }]);
    expect(input.build.typeOverride).toEqual(expected);
    expect(input.scenarios[0].hits[0].attacker.typeOverride).toEqual(expected);
    const offense = buildOffenseAdjustmentInput(target, createOffenseAdjustmentFormFromScenarioAttack(attack));
    expect(offense.attackerBuild.typeOverride).toEqual(expected);
    expect(offense.defenderBuild.typeOverride).toEqual(expected);
    const speed = buildSpeedAdjustmentInput(target, attack);
    expect(speed.targetBuild.typeOverride).toEqual(expected);
    expect(speed.opponentBuild?.typeOverride).toEqual(expected);
  });

  it("round-trips manual state and migrates prior schemas to automatic types", () => {
    const target = { ...createDefaultTargetForm(), typeOverride: manual };
    const scenarios = createDefaultScenarioForms().map((scenario) => ({ ...scenario, attacks: scenario.attacks.map((attack) => ({ ...attack, attackerTypeOverride: manual })) }));
    const document = createShareStateDocument(target, scenarios);
    const parsed = parseShareStateDocument(JSON.stringify(document));
    expect(parsed.schemaVersion).toBe(SHARE_SCHEMA_VERSION);
    expect(parsed.target.typeOverride).toEqual(manual);
    expect(parsed.scenarios.every((scenario) => scenario.attacks[0].attackerTypeOverride?.addedTypeInput === "ゴースト")).toBe(true);
    const legacy = parseShareStateDocument(JSON.stringify({ ...document, schemaVersion: 12 }));
    expect(legacy.target.typeOverride).toBeUndefined();
    expect(legacy.scenarios.every((scenario) => scenario.attacks[0].attackerTypeOverride === undefined)).toBe(true);
    expect(() => parseShareStateDocument(JSON.stringify({ ...document, target: { ...target, typeOverride: null } }))).toThrow("typeOverride");
    expect(() => parseShareStateDocument(JSON.stringify({ ...document, target: { ...target, typeOverride: { ...manual, type2Input: "Fire" } } }))).toThrow("重複");
    expect(() => parseShareStateDocument(JSON.stringify({ ...document, target: { ...target, typeOverride: { type1Input: "ほのお" } } }))).toThrow("形式");
    expect(() => parseShareStateDocument(JSON.stringify({ ...document, schemaVersion: SHARE_SCHEMA_VERSION + 1 }))).toThrow("対応していない");
  });

  it("retains manual types in target and enemy box backups", () => {
    const target = { ...createDefaultTargetForm(), typeOverride: manual };
    const scenarios = createDefaultScenarioForms().map((scenario) => ({ ...scenario, attacks: scenario.attacks.map((attack) => ({ ...attack, attackerTypeOverride: manual })) }));
    const targetBackup = parseBoxBackupDocument(stringifyBoxBackupDocument([createBoxEntryFromState(target, scenarios)]));
    expect(targetBackup.status).toBe("success");
    if (targetBackup.status === "success") {
      expect(targetBackup.entries[0].payload.target.typeOverride).toEqual(manual);
      expect(targetBackup.entries[0].payload.scenarios[0].attacks[0].attackerTypeOverride).toEqual(manual);
    }
    const enemyBackup = parseEnemyBoxBackupDocument(stringifyEnemyBoxBackupDocument([createEnemyBoxEntryFromScenarios(scenarios)]));
    expect(enemyBackup.status).toBe("success");
    if (enemyBackup.status === "success") expect(enemyBackup.entries[0].payload.scenarios[0].attacks[0].attackerTypeOverride).toEqual(manual);
  });
});
