import { describe, expect, it } from "vitest";
import type { Build } from "../domain/model";
import {
  buildToCalcPokemonOptions,
  normalizeOptionalCalcType,
  normalizeOptionalShowdownName,
  rankStagesToCalcBoosts,
  statPointToCalcEv,
  statPointsToCalcEvs,
} from "./championsAdapter";

const baseBuild: Build = {
  id: "garchomp",
  label: "ガブリアス",
  species: {
    id: "garchomp",
    displayName: "ガブリアス",
    showdownName: "Garchomp",
    sourceStatus: "supported",
  },
  level: 50,
  nature: "Jolly",
  ivs: {
    hp: 31,
    atk: 31,
    def: 31,
    spa: 31,
    spd: 31,
    spe: 31,
  },
  statPoints: {
    hp: 12,
    atk: 20,
    def: 8,
    spa: 0,
    spd: 8,
    spe: 18,
  },
  ability: "Sand Veil",
  item: "Clear Amulet",
  teraType: "Water",
};

describe("championsAdapter", () => {
  it("converts Champions SP into EV-compatible values inside the adapter", () => {
    expect(statPointToCalcEv(0)).toBe(0);
    expect(statPointToCalcEv(20)).toBe(160);
    expect(statPointToCalcEv(32)).toBe(252);
    expect(statPointsToCalcEvs(baseBuild.statPoints)).toEqual({
      hp: 96,
      atk: 160,
      def: 64,
      spa: 0,
      spd: 64,
      spe: 144,
    });
  });

  it("rejects invalid Champions SP before calc conversion", () => {
    expect(() => statPointToCalcEv(-1)).toThrow("SP must be a non-negative integer");
    expect(() =>
      statPointsToCalcEvs({ hp: 33, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }),
    ).toThrow("Invalid Champions SP");
  });

  it("normalizes optional Showdown fields", () => {
    expect(normalizeOptionalShowdownName("未指定")).toBeUndefined();
    expect(normalizeOptionalShowdownName("任意")).toBeUndefined();
    expect(normalizeOptionalShowdownName("Choice Band")).toBe("Choice Band");
    expect(normalizeOptionalCalcType("Water")).toBe("Water");
  });

  it("maps rank stages to calc boosts without hp", () => {
    expect(rankStagesToCalcBoosts({ atk: 1, def: -1 })).toEqual({
      atk: 1,
      def: -1,
    });
  });

  it("builds minimal calc Pokemon options from a domain Build", () => {
    expect(buildToCalcPokemonOptions(baseBuild, { atk: 1 })).toEqual({
      level: 50,
      nature: "Jolly",
      ivs: baseBuild.ivs,
      evs: {
        hp: 96,
        atk: 160,
        def: 64,
        spa: 0,
        spd: 64,
        spe: 144,
      },
      boosts: {
        atk: 1,
      },
      ability: "Sand Veil",
      item: "Clear Amulet",
      teraType: "Water",
    });
  });
});
