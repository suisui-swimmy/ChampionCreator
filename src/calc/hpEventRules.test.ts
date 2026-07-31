import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type { Build, EntityRef, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import type { HpEvent } from "../domain/hpEvents";
import { resolveEntity } from "../localization/resolver";
import {
  compileHpEventForMove,
  evaluateHpEventRule,
  hpEventRuleDefinitions,
} from "./hpEventRules";
import { toSmogonPokemon } from "./smogonAdapter";

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

const makeBuild = (
  id: string,
  pokemonInput = "ミュウ",
  options: {
    level?: number;
    hpIv?: number;
    hpEv?: number;
    abilityInput?: string;
    itemInput?: string;
    teraTypeInput?: string;
  } = {},
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemonInput),
  level: options.level ?? 50,
  ivs: { ...defaultIvs, hp: options.hpIv ?? defaultIvs.hp },
  evs: { ...zeroEvs, hp: options.hpEv ?? zeroEvs.hp },
  ability: options.abilityInput
    ? mustResolve("ability", options.abilityInput)
    : undefined,
  item: options.itemInput
    ? mustResolve("item", options.itemInput)
    : undefined,
  teraType: options.teraTypeInput
    ? mustResolve("type", options.teraTypeInput)
    : undefined,
});

const makeEvent = (
  effectId: string,
  options: Pick<HpEvent, "toxicStage" | "spikesLayers"> = {},
): HpEvent => ({
  id: effectId,
  effectId,
  enabled: true,
  sequenceContext: "currentMove",
  ...options,
});

const attacker = makeBuild("attacker");

describe("evaluateHpEventRule", () => {
  it("owns the fixed timing and frequency for each supported effect", () => {
    expect(hpEventRuleDefinitions["life-orb-recoil"]).toMatchObject({
      timing: "afterMove",
      frequency: "perMove",
      subject: "attacker",
    });
    expect(hpEventRuleDefinitions["sandstorm-damage"]).toMatchObject({
      timing: "endOfTurn",
      frequency: "perTurn",
      subject: "defender",
    });
    expect(hpEventRuleDefinitions["stealth-rock-damage"]).toMatchObject({
      timing: "onEntry",
      frequency: "once",
      subject: "defender",
    });
    expect(hpEventRuleDefinitions["spikes-damage"]).toMatchObject({
      timing: "onEntry",
      frequency: "once",
      subject: "defender",
    });
    expect(hpEventRuleDefinitions["sitrus-berry-heal"]).toMatchObject({
      timing: "afterHit",
      frequency: "once",
      subject: "defender",
      priority: 30,
      maxActivations: 1,
    });
    expect(hpEventRuleDefinitions["poison-damage"]).toMatchObject({
      timing: "endOfTurn",
      priority: 20,
    });
    expect(hpEventRuleDefinitions["salt-cure-damage"]).toMatchObject({
      timing: "endOfTurn",
      priority: 30,
    });
    expect(hpEventRuleDefinitions["leftovers-heal"]).toMatchObject({
      timing: "endOfTurn",
      priority: 40,
    });
    expect(hpEventRuleDefinitions["rocky-helmet-damage"]).toMatchObject({
      timing: "afterHit",
      frequency: "perHit",
      subject: "attacker",
      priority: 10,
    });
    expect(hpEventRuleDefinitions["rough-skin-damage"]).toMatchObject({
      timing: "afterHit",
      frequency: "perHit",
      subject: "attacker",
      priority: 20,
    });
  });

  it("automatically targets the move user for Life Orb and the move target for sand", () => {
    expect(compileHpEventForMove({
      id: "life-orb",
      effectId: "life-orb-recoil",
      enabled: true,
    })).toEqual({
      id: "life-orb",
      effectId: "life-orb-recoil",
      enabled: true,
      sequenceContext: "currentMove",
    });
    expect(compileHpEventForMove({
      id: "sand",
      effectId: "sandstorm-damage",
      enabled: true,
    })).toEqual({
      id: "sand",
      effectId: "sandstorm-damage",
      enabled: true,
      sequenceContext: "currentMove",
    });
  });

  it("uses the exact H=191 Life Orb and sandstorm floor values", () => {
    const hp191Attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender", "ミュウ", { hpEv: 128 });

    expect(evaluateHpEventRule({
      event: makeEvent("life-orb-recoil"),
      attackerBuild: hp191Attacker,
      defenderBuild: defender,
    })).toMatchObject({
      supported: true,
      damage: 19,
    });
    expect(evaluateHpEventRule({
      event: makeEvent("sandstorm-damage"),
      attackerBuild: attacker,
      defenderBuild: defender,
    })).toMatchObject({
      supported: true,
      damage: 11,
    });
  });

  it("uses the documented H=191 status, Salt Cure, and recovery floors", () => {
    const defender = makeBuild("defender", "ミュウ", { hpEv: 128 });
    const waterDefender = makeBuild("water-defender", "ミュウ", {
      hpEv: 128,
      teraTypeInput: "みず",
    });

    expect(toSmogonPokemon(defender).maxHP()).toBe(191);
    expect(evaluateHpEventRule({
      event: makeEvent("poison-damage"),
      attackerBuild: attacker,
      defenderBuild: defender,
    }).damage).toBe(23);
    expect(evaluateHpEventRule({
      event: makeEvent("toxic-damage", { toxicStage: 1 }),
      attackerBuild: attacker,
      defenderBuild: defender,
      occurrence: 1,
    }).damage).toBe(11);
    expect(evaluateHpEventRule({
      event: makeEvent("toxic-damage", { toxicStage: 1 }),
      attackerBuild: attacker,
      defenderBuild: defender,
      occurrence: 2,
    }).damage).toBe(22);
    expect(evaluateHpEventRule({
      event: makeEvent("burn-damage"),
      attackerBuild: attacker,
      defenderBuild: defender,
    }).damage).toBe(11);
    expect(evaluateHpEventRule({
      event: makeEvent("salt-cure-damage"),
      attackerBuild: attacker,
      defenderBuild: defender,
    }).damage).toBe(11);
    expect(evaluateHpEventRule({
      event: makeEvent("salt-cure-damage"),
      attackerBuild: attacker,
      defenderBuild: waterDefender,
    }).damage).toBe(23);
    expect(evaluateHpEventRule({
      event: makeEvent("sitrus-berry-heal"),
      attackerBuild: attacker,
      defenderBuild: defender,
    }).healing).toBe(47);
    expect(evaluateHpEventRule({
      event: makeEvent("leftovers-heal"),
      attackerBuild: attacker,
      defenderBuild: defender,
    }).healing).toBe(11);
  });

  it("applies Spikes layers and Stealth Rock type effectiveness before flooring", () => {
    const neutralDefender = makeBuild("neutral", "ミュウ", { hpEv: 128 });
    const fireTeraDefender = makeBuild("fire-tera", "ミュウ", {
      hpEv: 128,
      teraTypeInput: "ほのお",
    });
    const fourTimesWeakDefender = makeBuild("four-times", "バタフリー");
    const fourTimesWeakMaxHp = toSmogonPokemon(fourTimesWeakDefender).maxHP();

    expect(evaluateHpEventRule({
      event: makeEvent("spikes-damage", { spikesLayers: 1 }),
      attackerBuild: attacker,
      defenderBuild: neutralDefender,
    }).damage).toBe(23);
    expect(evaluateHpEventRule({
      event: makeEvent("spikes-damage", { spikesLayers: 2 }),
      attackerBuild: attacker,
      defenderBuild: neutralDefender,
    }).damage).toBe(31);
    expect(evaluateHpEventRule({
      event: makeEvent("spikes-damage", { spikesLayers: 3 }),
      attackerBuild: attacker,
      defenderBuild: neutralDefender,
    }).damage).toBe(47);
    expect(evaluateHpEventRule({
      event: makeEvent("stealth-rock-damage"),
      attackerBuild: attacker,
      defenderBuild: neutralDefender,
    }).damage).toBe(23);
    expect(evaluateHpEventRule({
      event: makeEvent("stealth-rock-damage"),
      attackerBuild: attacker,
      defenderBuild: fireTeraDefender,
    }).damage).toBe(47);
    expect(evaluateHpEventRule({
      event: makeEvent("stealth-rock-damage"),
      attackerBuild: attacker,
      defenderBuild: fourTimesWeakDefender,
    }).damage).toBe(Math.floor(fourTimesWeakMaxHp / 2));
  });

  it("uses ability and item exceptions for residual damage and entry hazards", () => {
    const heatproofDefender = makeBuild("heatproof", "ミュウ", {
      hpEv: 128,
      abilityInput: "たいねつ",
    });
    const poisonHealDefender = makeBuild("poison-heal", "ミュウ", {
      hpEv: 128,
      abilityInput: "ポイズンヒール",
    });
    const bootsDefender = makeBuild("boots", "ミュウ", {
      hpEv: 128,
      itemInput: "あつぞこブーツ",
    });
    const levitateDefender = makeBuild("levitate", "ミュウ", {
      hpEv: 128,
      abilityInput: "ふゆう",
    });

    expect(evaluateHpEventRule({
      event: makeEvent("burn-damage"),
      attackerBuild: attacker,
      defenderBuild: heatproofDefender,
    }).damage).toBe(5);
    expect(evaluateHpEventRule({
      event: makeEvent("toxic-damage"),
      attackerBuild: attacker,
      defenderBuild: poisonHealDefender,
    })).toMatchObject({
      damage: 0,
      healing: 23,
    });
    expect(evaluateHpEventRule({
      event: makeEvent("stealth-rock-damage"),
      attackerBuild: attacker,
      defenderBuild: bootsDefender,
    }).damage).toBe(0);
    expect(evaluateHpEventRule({
      event: makeEvent("spikes-damage"),
      attackerBuild: attacker,
      defenderBuild: bootsDefender,
    }).damage).toBe(0);
    expect(evaluateHpEventRule({
      event: makeEvent("spikes-damage"),
      attackerBuild: attacker,
      defenderBuild: levitateDefender,
    }).damage).toBe(0);
  });

  it("applies the minimum one damage after a supported effect is active", () => {
    const oneHpAttacker = makeBuild("attacker", "ヌケニン");
    const oneHpDefender = makeBuild("defender", "ヌケニン");

    expect(evaluateHpEventRule({
      event: makeEvent("life-orb-recoil"),
      attackerBuild: oneHpAttacker,
      defenderBuild: oneHpDefender,
    }).damage).toBe(1);
    expect(evaluateHpEventRule({
      event: makeEvent("sandstorm-damage"),
      attackerBuild: attacker,
      defenderBuild: oneHpDefender,
    }).damage).toBe(1);
  });

  it("lets Magic Guard nullify both supported damage effects", () => {
    const magicGuardAttacker = makeBuild("attacker", "ミュウ", {
      abilityInput: "マジックガード",
    });
    const magicGuardDefender = makeBuild("defender", "ミュウ", {
      abilityInput: "マジックガード",
    });

    expect(evaluateHpEventRule({
      event: makeEvent("life-orb-recoil"),
      attackerBuild: magicGuardAttacker,
      defenderBuild: magicGuardDefender,
    })).toMatchObject({
      supported: true,
      damage: 0,
      reason: "マジックガードで無効",
    });
    expect(evaluateHpEventRule({
      event: makeEvent("sandstorm-damage"),
      attackerBuild: attacker,
      defenderBuild: magicGuardDefender,
    })).toMatchObject({
      supported: true,
      damage: 0,
      reason: "タイプ・特性・持ち物で無効",
    });
  });

  it("applies contact recoil to the attacker with the exact floor values", () => {
    const hp191Attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender");

    expect(evaluateHpEventRule({
      event: makeEvent("rocky-helmet-damage"),
      attackerBuild: hp191Attacker,
      defenderBuild: defender,
      moveMakesContact: true,
    })).toMatchObject({
      supported: true,
      damage: 31,
    });
    expect(evaluateHpEventRule({
      event: makeEvent("rough-skin-damage"),
      attackerBuild: hp191Attacker,
      defenderBuild: defender,
      moveMakesContact: true,
    })).toMatchObject({
      supported: true,
      damage: 23,
    });
  });

  it("suppresses contact recoil for non-contact resolution and Magic Guard", () => {
    const defender = makeBuild("defender");
    const magicGuardAttacker = makeBuild("attacker", "ミュウ", {
      abilityInput: "マジックガード",
    });

    expect(evaluateHpEventRule({
      event: makeEvent("rocky-helmet-damage"),
      attackerBuild: attacker,
      defenderBuild: defender,
      moveMakesContact: false,
    })).toMatchObject({
      damage: 0,
      reason: "非接触技、えんかく、ぼうごパット等により接触していません",
    });
    expect(evaluateHpEventRule({
      event: makeEvent("rough-skin-damage"),
      attackerBuild: magicGuardAttacker,
      defenderBuild: defender,
      moveMakesContact: true,
    })).toMatchObject({
      damage: 0,
      reason: "マジックガードで無効",
    });
  });

  it.each([
    ["いわタイプ", makeBuild("rock", "バンギラス")],
    ["じめんタイプ", makeBuild("ground", "カバルドン")],
    ["はがねタイプ", makeBuild("steel", "メタグロス")],
    ["ぼうじん", makeBuild("overcoat", "ミュウ", { abilityInput: "ぼうじん" })],
    ["すなのちから", makeBuild("sand-force", "ミュウ", { abilityInput: "すなのちから" })],
    ["すなかき", makeBuild("sand-rush", "ミュウ", { abilityInput: "すなかき" })],
    ["すながくれ", makeBuild("sand-veil", "ミュウ", { abilityInput: "すながくれ" })],
    ["ぼうじんゴーグル", makeBuild("goggles", "ミュウ", { itemInput: "ぼうじんゴーグル" })],
  ])("nullifies sandstorm damage for %s", (_label, defender) => {
    expect(evaluateHpEventRule({
      event: makeEvent("sandstorm-damage"),
      attackerBuild: attacker,
      defenderBuild: defender,
    })).toMatchObject({
      supported: true,
      damage: 0,
      reason: "タイプ・特性・持ち物で無効",
    });
  });

  it("returns a safe unsupported result for an unknown effect ID", () => {
    expect(evaluateHpEventRule({
      event: makeEvent("future-champions-effect"),
      attackerBuild: attacker,
      defenderBuild: makeBuild("defender"),
    })).toEqual({
      supported: false,
      label: "未対応: future-champions-effect",
      damage: 0,
      reason: "このHP変化は現在のルールセットでは未対応です",
    });
  });
});
