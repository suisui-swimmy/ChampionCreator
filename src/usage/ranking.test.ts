import { describe, expect, it } from "vitest";
import {
  applyUsageRanking,
  getMatchingEntityInputOptionsWithUsage,
  getTopUsageRankedCandidate,
  getUsagePokemonEntry,
  getUsageRanking,
  getUsageNatureRanking,
  getNatureUsageState,
} from "./ranking";
import type { ChampionsUsageData } from "./types";

const data: ChampionsUsageData = {
  schemaVersion: 1,
  dataVersion: "test",
  sourceGeneratedAt: "2026-08-14T00:00:00Z",
  formats: {
    Singles: {
      Pikachu: {
        move: ["Thunderbolt", "Protect"],
        ability: ["Lightning Rod"],
        item: ["Focus Sash"],
        nature: [
          { canonicalName: "Jolly", rank: 1, percentage: 0 },
          { canonicalName: "Timid", rank: 2, percentage: null },
        ],
      },
      "Aegislash-Shield": {
        move: ["King's Shield"],
        ability: ["Stance Change"],
        item: [],
      },
    },
    Doubles: {
      pikachu: {
        move: ["Fake Out"],
        ability: [],
        item: [],
      },
    },
  },
};

const candidates = [
  { canonicalName: "Protect", value: "まもる" },
  { canonicalName: "Thunderbolt", value: "10まんボルト" },
  { canonicalName: "Helping Hand", value: "てだすけ" },
  { canonicalName: "Fake Out", value: "ねこだまし" },
];

describe("getUsageRanking", () => {
  it("looks up a format and canonical Pokemon without inheriting another form", () => {
    expect(getUsageRanking(data, "Singles", "Pikachu", "move")).toEqual([
      "Thunderbolt",
      "Protect",
    ]);
    expect(getUsageRanking(data, "Doubles", "Pikachu", "move")).toEqual(["Fake Out"]);
    expect(getUsagePokemonEntry(data, "Singles", "aegislash-shield")).toMatchObject({
      ability: ["Stance Change"],
    });
    expect(getUsagePokemonEntry(data, "Singles", "Aegislash-Blade")).toBeUndefined();
    expect(getUsageRanking(data, "Singles", undefined, "move")).toBeUndefined();
  });
});

describe("getNatureUsageState", () => {
  it("distinguishes listed, unlisted, unavailable, and a real 0.0% value", () => {
    expect(getNatureUsageState(data, "Singles", "Pikachu", "Jolly")).toEqual({
      kind: "listed",
      rank: 1,
      percentage: 0,
    });
    expect(getNatureUsageState(data, "Singles", "Pikachu", "Timid")).toEqual({
      kind: "listed",
      rank: 2,
      percentage: null,
    });
    expect(getNatureUsageState(data, "Singles", "Pikachu", "Bold")).toEqual({
      kind: "unlisted",
    });
    expect(getNatureUsageState(data, "Doubles", "Pikachu", "Jolly")).toEqual({
      kind: "unavailable",
    });
    expect(getNatureUsageState(data, "Singles", "Missingmon", "Jolly")).toEqual({
      kind: "unavailable",
    });
    expect(getNatureUsageState(data, "Singles", "Pikachu", undefined)).toEqual({
      kind: "unavailable",
    });
    expect(getNatureUsageState({
      ...data,
      formats: {
        ...data.formats,
        Singles: {
          ...data.formats.Singles,
          Emptymon: { move: [], ability: [], item: [], nature: [] },
        },
      },
    }, "Singles", "Emptymon", "Jolly")).toEqual({
      kind: "unavailable",
    });
  });

  it("uses the existing exact/toID owner lookup without inheriting another form", () => {
    expect(getUsageNatureRanking(data, "Singles", "pikachu")).toEqual([
      { canonicalName: "Jolly", rank: 1, percentage: 0 },
      { canonicalName: "Timid", rank: 2, percentage: null },
    ]);
    expect(getNatureUsageState(data, "Singles", "Aegislash-Blade", "Jolly")).toEqual({
      kind: "unavailable",
    });
  });
});

describe("applyUsageRanking", () => {
  it("puts ranked candidates first in API order and keeps unranked order", () => {
    expect(applyUsageRanking(candidates, ["Fake Out", "Thunderbolt", "Unknown Move"])).toEqual([
      candidates[3],
      candidates[1],
      candidates[0],
      candidates[2],
    ]);
  });

  it("returns only the highest-ranked candidate that exists in the valid option set", () => {
    expect(getTopUsageRankedCandidate(
      candidates,
      ["Unknown Move", "Thunderbolt", "Protect"],
    )).toEqual(candidates[1]);
    expect(getTopUsageRankedCandidate(candidates, ["Unknown Move"])).toBeUndefined();
    expect(getTopUsageRankedCandidate(
      [{ canonicalName: "Thunderbolt", value: "" }, candidates[0]],
      ["Thunderbolt", "Protect"],
    )).toEqual(candidates[0]);
    expect(getTopUsageRankedCandidate(candidates, undefined)).toBeUndefined();
    expect(getTopUsageRankedCandidate([], ["Thunderbolt"])).toBeUndefined();
  });

  it("does not mutate candidates and preserves the original order without a ranking", () => {
    const original = [...candidates];
    expect(applyUsageRanking(candidates, undefined)).toEqual(candidates);
    expect(candidates).toEqual(original);
    expect(applyUsageRanking(candidates, [])).not.toBe(candidates);
  });

  it("prefix-matches before ranking and applies the 40-item limit last", () => {
    const many = Array.from({ length: 45 }, (_, index) => ({
      canonicalName: `Move${index}`,
      value: `技${String(index).padStart(2, "0")}`,
    }));
    expect(getMatchingEntityInputOptionsWithUsage(
      many,
      "技",
      ["Move44", "Move43"],
      2,
    ).map((candidate) => candidate.canonicalName)).toEqual(["Move44", "Move43"]);
    expect(getMatchingEntityInputOptionsWithUsage(candidates, "ま", ["Protect"], 1))
      .toEqual([candidates[0]]);
  });

  it("keeps status moves in autocomplete ranking order", () => {
    const moveCandidates = [
      { canonicalName: "Encore", value: "アンコール" },
      { canonicalName: "Moonblast", value: "ムーンフォース" },
      { canonicalName: "Protect", value: "まもる" },
    ];

    expect(getMatchingEntityInputOptionsWithUsage(
      moveCandidates,
      "",
      ["Protect", "Moonblast", "Encore"],
    ).map((candidate) => candidate.canonicalName)).toEqual([
      "Protect",
      "Moonblast",
      "Encore",
    ]);
  });
});
