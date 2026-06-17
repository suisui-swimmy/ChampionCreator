import { describe, expect, it } from "vitest";
import { getMoveDefenderStatKeys, getMoveStatReferencePlan } from "./moveStatReference";

describe("getMoveStatReferencePlan", () => {
  it("uses one offensive stat for ordinary physical and special moves", () => {
    expect(getMoveStatReferencePlan("ふいうち").references).toEqual([
      { owner: "attacker", stat: "atk", role: "damage" },
    ]);
    expect(getMoveStatReferencePlan("10まんボルト").references).toEqual([
      { owner: "attacker", stat: "spa", role: "damage" },
    ]);
  });

  it("handles alternate offensive stat and Pokemon references", () => {
    expect(getMoveStatReferencePlan("ボディプレス").references).toEqual([
      { owner: "attacker", stat: "def", role: "damage" },
    ]);
    expect(getMoveStatReferencePlan("イカサマ").references).toEqual([
      { owner: "target", stat: "atk", role: "damage" },
    ]);
    expect(getMoveStatReferencePlan("いのちがけ").references).toEqual([
      { owner: "attacker", stat: "hp", role: "damage" },
    ]);
  });

  it("includes speed references for speed-based power moves", () => {
    expect(getMoveStatReferencePlan("ジャイロボール").references).toEqual([
      { owner: "attacker", stat: "atk", role: "damage" },
      { owner: "attacker", stat: "spe", role: "power" },
      { owner: "target", stat: "spe", role: "power" },
    ]);
  });

  it("shows both offensive stats for adaptive-category moves", () => {
    expect(getMoveStatReferencePlan("テラバースト", { teraEnabled: true }).references).toEqual([
      { owner: "attacker", stat: "atk", role: "damage" },
      { owner: "attacker", stat: "spa", role: "damage" },
    ]);
    expect(getMoveStatReferencePlan("テラバースト").references).toEqual([
      { owner: "attacker", stat: "spa", role: "damage" },
    ]);
  });

  it("falls back to A and C while the move is unresolved", () => {
    expect(getMoveStatReferencePlan("").references).toEqual([
      { owner: "attacker", stat: "atk", role: "damage" },
      { owner: "attacker", stat: "spa", role: "damage" },
    ]);
  });

  it("returns the defender stats that affect KO thresholds", () => {
    expect(getMoveDefenderStatKeys("ふいうち")).toEqual(["hp", "def"]);
    expect(getMoveDefenderStatKeys("サイコキネシス")).toEqual(["hp", "spd"]);
    expect(getMoveDefenderStatKeys("くさむすび")).toEqual(["hp", "spd"]);
    expect(getMoveDefenderStatKeys("サイコショック")).toEqual(["hp", "def"]);
    expect(getMoveDefenderStatKeys("いのちがけ")).toEqual(["hp"]);
    expect(getMoveDefenderStatKeys("テラバースト", { teraEnabled: true })).toEqual(["hp", "def", "spd"]);
    expect(getMoveDefenderStatKeys("")).toEqual(["hp", "def", "spd"]);
  });
});
