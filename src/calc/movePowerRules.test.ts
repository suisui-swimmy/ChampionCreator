import { describe, expect, it } from "vitest";
import {
  getMovePowerAssistRule,
  getMovePowerOverrideDetailLabel,
  isSinglePowerMoveUnsupported,
  isMovePowerOverrideAllowed,
  resolveAllowedMovePowerOverride,
} from "./movePowerRules";

describe("movePowerRules", () => {
  it("exposes the initial eight assisted move rules", () => {
    const expected = {
      Avalanche: [60, 120],
      "Fickle Beam": [80, 160],
      "Last Respects": [50, 100, 150, 200, 250, 300],
      "Rage Fist": [50, 100, 150, 200, 250, 300, 350],
      Round: [60, 120],
      "Spit Up": [100, 200, 300],
      "Stomping Tantrum": [75, 150],
      "Temper Flare": [75, 150],
    } as const;

    for (const [canonicalName, powers] of Object.entries(expected)) {
      const rule = getMovePowerAssistRule(canonicalName);
      expect(rule?.canonicalName).toBe(canonicalName);
      expect(rule?.defaultPower).toBe(powers[0]);
      expect(rule?.options.map((option) => option.power)).toEqual(powers);
      expect(rule?.options.every((option) => option.label.length > 0)).toBe(true);
      expect(isMovePowerOverrideAllowed(canonicalName)).toBe(true);
    }

    expect(isMovePowerOverrideAllowed("Earthquake")).toBe(false);
    expect(isMovePowerOverrideAllowed("Eruption")).toBe(true);
    expect(isSinglePowerMoveUnsupported("Beat Up")).toBe(true);
    expect(isSinglePowerMoveUnsupported("Earthquake")).toBe(false);
  });

  it("keeps the Japanese condition labels needed by the assisted UI", () => {
    expect(getMovePowerAssistRule("Last Respects")?.options[5]).toEqual({
      power: 300,
      label: "ひんしの味方 5体",
    });
    expect(getMovePowerAssistRule("Rage Fist")?.options[6]).toEqual({
      power: 350,
      label: "攻撃を受けた回数 6回以上（最大）",
    });
    expect(getMovePowerAssistRule("Stomping Tantrum")?.options[1]).toEqual({
      power: 150,
      label: "直前に使った技が失敗した",
    });
  });

  it("accepts legal assisted powers and manual powers for registered condition and HP-dependent moves", () => {
    expect(resolveAllowedMovePowerOverride("Avalanche", {
      value: 120,
      source: "assisted",
    })).toEqual({ value: 120, source: "assisted" });
    expect(resolveAllowedMovePowerOverride("Avalanche", {
      value: 90,
      source: "assisted",
    })).toBeUndefined();
    expect(resolveAllowedMovePowerOverride("Avalanche", {
      value: 90,
      source: "manual",
    })).toEqual({ value: 90, source: "manual" });
    expect(resolveAllowedMovePowerOverride("Avalanche", {
      value: Number.NaN,
      source: "manual",
    })).toBeUndefined();
    expect(resolveAllowedMovePowerOverride("Avalanche", {
      value: 90.5,
      source: "manual",
    })).toBeUndefined();
    expect(resolveAllowedMovePowerOverride("Avalanche", {
      value: 10001,
      source: "manual",
    })).toBeUndefined();
    expect(resolveAllowedMovePowerOverride("Earthquake", {
      value: 120,
      source: "manual",
    })).toBeUndefined();
    expect(resolveAllowedMovePowerOverride("Eruption", {
      value: 87,
      source: "manual",
    })).toEqual({ value: 87, source: "manual" });
    expect(resolveAllowedMovePowerOverride("Eruption", {
      value: 150,
      source: "assisted",
    })).toBeUndefined();
  });

  it("resolves assisted and manual detail labels", () => {
    expect(getMovePowerOverrideDetailLabel("Round", {
      value: 120,
      source: "assisted",
    })).toBe("味方の「りんしょう」に続けて使用");
    expect(getMovePowerOverrideDetailLabel("Round", {
      value: 91,
      source: "manual",
    })).toBe("任意威力");
  });
});
