import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import { statPointTableToSmogonEvs } from "../domain/championsStats";
import { hpStatMarkerRules } from "../domain/hpStatMarkerRules";
import { toEntityRef, type Build, type EntityRef, type StatTable } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  buildHpStatMarkerDisplay,
  calculateHpStatMarkerRow,
} from "./hpStatMarkers";

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

const createBuild = (
  pokemonInput: string,
  level: number,
  options: { isDynamaxed?: boolean } = {},
): Build => ({
  id: `${pokemonInput}-${level}`,
  pokemon: mustResolve("pokemon", pokemonInput),
  level,
  nature: mustResolve("nature", "がんばりや"),
  ivs: defaultIvs,
  statPoints: zeroStatPoints,
  evs: statPointTableToSmogonEvs(zeroStatPoints),
  isDynamaxed: options.isDynamaxed,
});

describe("HP stat marker rules", () => {
  it("offers only the eight base multiples", () => {
    expect(hpStatMarkerRules.map((rule) => rule.id)).toEqual([
      "2n",
      "3n",
      "4n",
      "6n",
      "8n",
      "10n",
      "16n",
      "50n",
    ]);
  });

  it("keeps every matching rule for a multiply-classified HP value", () => {
    const matched = hpStatMarkerRules.filter((rule) => rule.matches(240)).map((rule) => rule.id);

    expect(matched).toEqual(expect.arrayContaining([
      "2n",
      "3n",
      "4n",
      "6n",
      "8n",
      "10n",
      "16n",
    ]));
  });
});

describe("calculateHpStatMarkerRow", () => {
  it("calculates normal HP for every SP from 0 through 32", () => {
    const row = calculateHpStatMarkerRow(createBuild("ガブリアス", 50));

    expect(row).toHaveLength(33);
    expect(row[0]).toMatchObject({ sp: 0, hp: 183, isFirstReach: true });
    expect(row[8]).toMatchObject({ sp: 8, hp: 191 });
    expect(row[18]).toMatchObject({ sp: 18, hp: 201 });
    expect(row[22]).toMatchObject({ sp: 22, hp: 205 });
    expect(row[0]?.ruleIds).toContain("3n");
    expect(row[17]?.ruleIds).toEqual(expect.arrayContaining(["8n", "10n", "50n"]));
    expect(row[18]?.ruleIds).toContain("3n");
  });

  it("marks only the first SP when low-level SP values repeat the same HP", () => {
    const row = calculateHpStatMarkerRow(createBuild("ピカチュウ", 30));

    expect(row[0]?.hp).toBe(70);
    expect(row[1]?.hp).toBe(70);
    expect(row[0]?.isFirstReach).toBe(true);
    expect(row[1]?.isFirstReach).toBe(false);
  });

  it("does not invent a marker for an HP value skipped at a higher level", () => {
    const row = calculateHpStatMarkerRow(createBuild("ピカチュウ", 73));

    expect(row.some((cell) => cell.hp === 159)).toBe(false);
  });

  it("excludes HP1 from generic marker rules", () => {
    const row = calculateHpStatMarkerRow(createBuild("ヌケニン", 50));

    expect(row.every((cell) => cell.hp === 1)).toBe(true);
    expect(row.every((cell) => cell.ruleIds.length === 0)).toBe(true);
  });

  it("uses normal HP even while Dynamax is enabled", () => {
    const normal = calculateHpStatMarkerRow(createBuild("ガブリアス", 50));
    const dynamaxed = calculateHpStatMarkerRow(createBuild("ガブリアス", 50, { isDynamaxed: true }));

    expect(dynamaxed.map((cell) => cell.hp)).toEqual(normal.map((cell) => cell.hp));
    expect(dynamaxed.map((cell) => cell.ruleIds)).toEqual(normal.map((cell) => cell.ruleIds));
  });
});

describe("buildHpStatMarkerDisplay", () => {
  const row = calculateHpStatMarkerRow(createBuild("ガブリアス", 50));

  it("shows point rules only at the first SP reaching the matching HP", () => {
    const display = buildHpStatMarkerDisplay(row, "16n");

    expect(display[9]).toEqual({ matched: true, boundary: true });
    expect(display.filter((cell) => cell.boundary).length).toBeGreaterThan(0);
  });

});
