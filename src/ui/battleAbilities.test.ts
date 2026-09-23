import { readFileSync } from "node:fs";
import { calculate, Field, Generations, Move, Side } from "@smogon/calc";
import { describe, expect, it } from "vitest";
import { calculateSmogonHit, flattenDamageRolls, toSmogonPokemon } from "../calc/smogonAdapter";
import { battleAbilityCanonicalNames } from "../domain/allyAbilitySupport";
import { decodeSharedAdjustment, encodeSharedAdjustment, comparableShareJson } from "../share/urlShareCodec";
import { buildOffenseHit } from "../search/offenseAdjustment";
import { buildDefenceSearchInput, buildOffenseAdjustmentInput, createDefaultScenarioAttackForm, createDefaultTargetForm,
  createOffenseAdjustmentFormFromScenarioAttack, initializeOffenseScenario, type ScenarioFormState } from "./defenceSearchUi";
import { getBattleAbilities, validateBattleAbilities } from "./battleAbilities";
import { createShareStateDocument, parseShareStateDocument } from "./shareState";

const zeros = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const target = { ...createDefaultTargetForm(), pokemonInput: "ミュウ", pokemonCanonicalName: undefined,
  natureInput: "まじめ", abilityInput: "シンクロ", itemInput: "", statPoints: { ...zeros } };
const fixture = (kind: "defence" | "offense" = "offense", targetAlly: string[] = [], opponentAlly: string[] = []) => {
  const attack = { ...createDefaultScenarioAttackForm(), attackerPokemonInput: "ミュウ", attackerPokemonCanonicalName: undefined,
    attackerNatureInput: "まじめ", attackerAbilityInput: "シンクロ", attackerItemInput: "", attackerStatPoints: { ...zeros },
    moveInput: "サイコキネシス", gameType: "doubles" as const, battleAbilities: { targetAlly, opponentAlly } };
  const scenario: ScenarioFormState = { id: "battle", label: "場の特性", enabled: true, adjustmentType: kind, attacks: [attack] };
  const build = () => {
    if (kind === "defence") {
      const input = buildDefenceSearchInput(target, [scenario]);
      return { defender: input.build, hit: input.scenarios[0].hits[0], field: input.scenarios[0].hits[0].field! };
    }
    const input = buildOffenseAdjustmentInput(target, createOffenseAdjustmentFormFromScenarioAttack(attack));
    return { defender: input.defenderBuild, hit: buildOffenseHit(input.attackerBuild, input), field: input.field };
  };
  return { attack, scenario, build, damage: () => { const b = build(); return calculateSmogonHit(b.defender, b.hit, b.field); } };
};

describe("explicit battle abilities", () => {
  it.each(["defence", "offense"] as const)("routes the two fixed side labels for %s", (kind) => {
    const { hit } = fixture(kind, ["Battery"], ["Friend Guard"]).build();
    expect(hit.allyAbilities?.map((a) => a.canonicalName)).toEqual([kind === "offense" ? "Battery" : "Friend Guard"]);
    expect(hit.defenderAllyAbilities?.map((a) => a.canonicalName)).toEqual([kind === "offense" ? "Friend Guard" : "Battery"]);
    expect(hit.defenderSide.friendGuard).toBe(false);
  });

  it.each([
    ["Battery", "isBattery", "サイコキネシス", "none"],
    ["Power Spot", "isPowerSpot", "のしかかり", "none"],
    ["Steely Spirit", "isSteelySpirit", "アイアンヘッド", "none"],
    ["Flower Gift", "isFlowerGift", "のしかかり", "sun"],
  ] as const)("matches native %s on the attacking ally and does not buff the other side", (ability, flag, move, weather) => {
    const f = fixture("offense", [ability]);
    f.attack.moveInput = move; f.attack.weather = weather;
    const b = f.build();
    const direct = calculate(Generations.get(9), toSmogonPokemon(b.hit.attacker), toSmogonPokemon(b.defender),
      new Move(Generations.get(9), b.hit.move.canonicalName),
      new Field({ gameType: "Doubles", weather: weather === "sun" ? "Sun" : undefined, attackerSide: new Side({ [flag]: true }) }));
    expect(f.damage().damageRolls).toEqual(flattenDamageRolls(direct.damage));
    const boosted = f.damage().damageRange.max;
    f.attack.battleAbilities = { targetAlly: [], opponentAlly: [ability] };
    expect(f.damage().damageRange.max).toBeLessThan(boosted);
  });

  it("applies Flower Gift to special defense in sun only", () => {
    const f = fixture("offense", [], ["Flower Gift"]);
    const noSun = f.damage().damageRange.max;
    f.attack.weather = "sun";
    expect(f.damage().damageRange.max).toBeLessThan(noSun);
    const b = f.build();
    const direct = calculate(Generations.get(9), toSmogonPokemon(b.hit.attacker), toSmogonPokemon(b.defender),
      new Move(Generations.get(9), "Psychic"), new Field({ gameType: "Doubles", weather: "Sun", defenderSide: new Side({ isFlowerGift: true }) }));
    expect(f.damage().damageRolls).toEqual(flattenDamageRolls(direct.damage));
  });

  it.each([
    ["Sword of Ruin", "isSwordOfRuin", "のしかかり"], ["Beads of Ruin", "isBeadsOfRuin", "サイコキネシス"],
    ["Tablets of Ruin", "isTabletsOfRuin", "のしかかり"], ["Vessel of Ruin", "isVesselOfRuin", "サイコキネシス"],
    ["Fairy Aura", "isFairyAura", "ムーンフォース"], ["Dark Aura", "isDarkAura", "あくのはどう"],
  ] as const)("uses the same native global %s from either side without stacking", (ability, flag, move) => {
    const f = fixture("offense", [ability]); f.attack.moveInput = move;
    const b = f.build();
    const direct = calculate(Generations.get(9), toSmogonPokemon(b.hit.attacker), toSmogonPokemon(b.defender),
      new Move(Generations.get(9), b.hit.move.canonicalName), new Field({ gameType: "Doubles", [flag]: true }));
    const expected = flattenDamageRolls(direct.damage);
    expect(f.damage().damageRolls).toEqual(expected);
    f.attack.battleAbilities = { targetAlly: [], opponentAlly: [ability] };
    expect(f.damage().damageRolls).toEqual(expected);
    f.attack.battleAbilities.targetAlly = [ability];
    expect(f.damage().damageRolls).toEqual(expected);
  });

  it("preserves Ruin same-ability immunity and Aura Break's dependency on an aura", () => {
    const f = fixture("offense", ["Sword of Ruin"]); f.attack.moveInput = "のしかかり";
    f.attack.attackerAbilityInput = "わざわいのつるぎ";
    const immune = f.damage().damageRolls;
    f.attack.battleAbilities.targetAlly = [];
    expect(f.damage().damageRolls).toEqual(immune);
    f.attack.attackerAbilityInput = "シンクロ"; f.attack.moveInput = "ムーンフォース";
    const base = f.damage().damageRange.max;
    f.attack.battleAbilities.opponentAlly = ["Aura Break"];
    expect(f.damage().damageRange.max).toBe(base);
    f.attack.battleAbilities.targetAlly = ["Fairy Aura"];
    expect(f.damage().damageRange.max).toBeLessThan(base);
    f.attack.battleAbilities.opponentAlly = [];
    expect(f.damage().damageRange.max).toBeGreaterThan(base);
  });

  it.each(["Plus", "Minus"])("requires the user's own Plus/Minus for an ally's %s", (ability) => {
    const f = fixture("defence", [], [ability]);
    const noOwn = f.damage().damageRange.max;
    f.attack.attackerAbilityInput = "プラス";
    expect(f.damage().damageRange.max).toBeGreaterThan(noOwn);
    f.attack.battleAbilities.opponentAlly = [];
    expect(f.damage().damageRange.max).toBe(noOwn);
  });

  it("uses Friend Guard on the protected side only, once, excluding fixed damage", () => {
    const f = fixture(); const base = f.damage().damageRange.max;
    f.attack.battleAbilities.targetAlly = ["Friend Guard"];
    expect(f.damage().damageRange.max).toBe(base);
    f.attack.battleAbilities.opponentAlly = ["Friend Guard"];
    const guarded = f.damage().damageRange.max;
    expect(guarded).toBeLessThan(base);
    f.attack.friendGuard = true;
    expect(f.damage().damageRange.max).toBe(guarded);
    f.attack.moveInput = "ちきゅうなげ";
    expect(f.damage().damageRange).toMatchObject({ min: 50, max: 50 });
  });

  it("retains selections while singles suppresses all third-party effects", () => {
    const f = fixture("offense", ["Battery"], ["Flower Gift"]);
    f.attack.weather = "sun";
    Object.assign(f.attack, { gameType: "singles" });
    const before = structuredClone(f.attack.battleAbilities);
    expect(f.build().hit.allyAbilities).toBeUndefined();
    expect(f.build().hit.defenderAllyAbilities).toBeUndefined();
    expect(f.attack.battleAbilities).toEqual(before);
  });
});

describe("battle ability save compatibility", () => {
  it("keeps frozen s3 damage, retires its support card, and round-trips to s4 idempotently", async () => {
    const old = JSON.parse(readFileSync(new URL("../share/testFixtures/ally-support.s3.json", import.meta.url), "utf8"));
    const { document } = await decodeSharedAdjustment(old.token);
    const input = buildDefenceSearchInput(document.target, document.scenarios);
    expect(document.scenarios[0].attacks).toHaveLength(1);
    expect(document.scenarios[0].attacks[0].battleAbilities).toEqual({ targetAlly: ["Friend Guard"], opponentAlly: ["Sword of Ruin"] });
    expect(calculateSmogonHit(input.build, input.scenarios[0].hits[0], input.scenarios[0].hits[0].field!).damageRolls).toEqual(old.damageRolls);
    expect(parseShareStateDocument(JSON.stringify(document))).toEqual(document);
    const token = await encodeSharedAdjustment(document, { app: "0.35.0", calc: "test" });
    expect(token.startsWith("s4.")).toBe(true);
    expect(comparableShareJson((await decodeSharedAdjustment(token)).document)).toBe(comparableShareJson(document));
  });

  it("snapshots both attacking neighbors and support-only cards, including old multiple effects", () => {
    const f = fixture("defence");
    f.scenario.attacks.push({ ...f.attack, id: "battery", attackerAbilityInput: "バッテリー" },
      { ...f.attack, id: "sword", attackerAbilityInput: "わざわいのつるぎ", moveInput: "" });
    const document = { ...createShareStateDocument(target, [f.scenario]), schemaVersion: 15 };
    const migrated = parseShareStateDocument(JSON.stringify(document));
    expect(migrated.scenarios[0].attacks).toHaveLength(2);
    expect(migrated.scenarios[0].attacks[0].battleAbilities?.opponentAlly).toEqual(["Battery", "Sword of Ruin"]);
    expect(migrated.scenarios[0].attacks[1].battleAbilities?.opponentAlly).toEqual(["Sword of Ruin"]);
    expect(migrated.scenarios[0].attacks.map((a) => a.id)).toEqual([f.attack.id, "battery"]);
  });

  it("migrates offense Friend Guard to the opponent side without inferring new allies", () => {
    const f = fixture(); f.attack.friendGuard = true;
    const legacy = { schemaVersion: 15, target, scenarios: [initializeOffenseScenario(f.scenario)] };
    delete legacy.scenarios[0].attacks[0].battleAbilities;
    const migrated = parseShareStateDocument(JSON.stringify(legacy));
    expect(migrated.scenarios[0].attacks[0].battleAbilities).toEqual({ targetAlly: [], opponentAlly: ["Friend Guard"] });
    expect(migrated.scenarios[0].attacks[0].friendGuard).toBe(false);
  });

  it("does not silently discard an unresolved legacy ally and make a blocked condition evaluable", () => {
    const f = fixture("defence");
    f.scenario.attacks.push({ ...f.attack, id: "unknown", moveInput: "", attackerAbilityInput: "未解決の特性" });
    const legacy = { schemaVersion: 15, target, scenarios: [f.scenario] };
    expect(() => parseShareStateDocument(JSON.stringify(legacy))).toThrow("旧条件の味方特性「未解決の特性」が未解決");
  });

  it("allows exactly the supported 14 canonical abilities and rejects malformed current saves", () => {
    expect(battleAbilityCanonicalNames).toHaveLength(14);
    for (const ability of battleAbilityCanonicalNames) expect(validateBattleAbilities({ targetAlly: [ability], opponentAlly: [] }).targetAlly).toEqual([ability]);
    for (const value of [null, {}, { targetAlly: "Battery", opponentAlly: [] }, { targetAlly: ["Pixilate"], opponentAlly: [] },
      { targetAlly: ["Battery", "Battery"], opponentAlly: [] }, { targetAlly: [], opponentAlly: [], extra: true }]) {
      const f = fixture(); const document = createShareStateDocument(target, [initializeOffenseScenario(f.scenario)]);
      Object.assign(document.scenarios[0].attacks[0], { battleAbilities: value });
      expect(() => parseShareStateDocument(JSON.stringify(document))).toThrow("場の特性");
    }
    expect(getBattleAbilities({ friendGuard: true, battleAbilities: { targetAlly: [], opponentAlly: [] } }, "offense")).toEqual({ targetAlly: [], opponentAlly: [] });
  });
});
