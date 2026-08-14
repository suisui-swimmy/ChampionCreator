import { describe, expect, it } from "vitest";
import {
  applyUsageRanking,
  getMatchingEntityInputOptionsWithUsage,
  getUsagePokemonEntry,
  getUsageRanking,
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

describe("applyUsageRanking", () => {
  it("puts ranked candidates first in API order and keeps unranked order", () => {
    expect(applyUsageRanking(candidates, ["Fake Out", "Thunderbolt", "Unknown Move"])).toEqual([
      candidates[3],
      candidates[1],
      candidates[0],
      candidates[2],
    ]);
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
});
