import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import { statPointTableToSmogonEvs } from "../domain/championsStats";
import { toEntityRef, type Build, type EntityRef, type StatTable } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  calculateStatPointMarkerTable,
  type StatPointMarker,
  type StatPointMarkerRow,
} from "./statPointMarkers";

const mustResolve = <K extends EntityKind>(kind: K, input: string): EntityRef<K> => {
  const result = toEntityRef(resolveEntity(kind, input), kind);
  if (!result) {
    throw new Error(`${kind} ${input} did not resolve`);
  }
  return result;
};

const zeroStatPoints: StatTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const createBuild = (level: number, natureInput: string): Build => ({
  id: `pikachu-${level}-${natureInput}`,
  pokemon: mustResolve("pokemon", "ピカチュウ"),
  level,
  nature: mustResolve("nature", natureInput),
  ivs: defaultIvs,
  statPoints: zeroStatPoints,
  evs: statPointTableToSmogonEvs(zeroStatPoints),
});

const getMarkerPositions = (
  row: StatPointMarkerRow,
  marker: StatPointMarker,
): number[] => row.flatMap((value, statPoints) => value === marker ? [statPoints] : []);

describe("calculateStatPointMarkerTable", () => {
  it("matches the in-game Lv.50 red 11n and later blue 9n positions", () => {
    const markers = calculateStatPointMarkerTable(createBuild(50, "いじっぱり"));

    expect(getMarkerPositions(markers.atk, "red")).toEqual([5, 15, 25]);
    expect(getMarkerPositions(markers.spa, "blue")).toEqual([1, 11, 21, 31]);
    expect(markers.hp.every((marker) => marker === null)).toBe(true);
    expect(markers.def.every((marker) => marker === null)).toBe(true);
    expect(markers.spd.every((marker) => marker === null)).toBe(true);
    expect(markers.spe.every((marker) => marker === null)).toBe(true);
  });

  it("compares neutral and nature-adjusted gains at non-Lv.50 levels", () => {
    const level37 = calculateStatPointMarkerTable(createBuild(37, "いじっぱり"));
    const level73 = calculateStatPointMarkerTable(createBuild(73, "いじっぱり"));

    expect(getMarkerPositions(level37.atk, "red")).toEqual([5, 18, 32]);
    expect(getMarkerPositions(level37.spa, "blue")).toEqual([11, 25]);
    expect(getMarkerPositions(level73.atk, "red")).toEqual([2, 9, 16, 23, 30]);
    expect(getMarkerPositions(level73.spa, "blue")).toEqual([1, 8, 15, 22, 29]);
  });

  it("does not mark gains that are unchanged by nature", () => {
    const level1 = calculateStatPointMarkerTable(createBuild(1, "いじっぱり"));
    const neutralNature = calculateStatPointMarkerTable(createBuild(50, "がんばりや"));

    for (const row of Object.values(level1)) {
      expect(row.every((marker) => marker === null)).toBe(true);
    }
    for (const row of Object.values(neutralNature)) {
      expect(row.every((marker) => marker === null)).toBe(true);
    }
  });
});
