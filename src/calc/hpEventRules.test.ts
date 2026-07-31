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
});

const makeEvent = (effectId: string): HpEvent => ({
  id: effectId,
  effectId,
  enabled: true,
  sequenceContext: "currentMove",
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
