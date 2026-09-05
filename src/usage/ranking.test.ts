import { describe, expect, it } from "vitest";
import { getEntityInputOptions, getPokemonAbilityInputOptions } from "../localization/resolver";
import {
  applyUsageRanking,
  getMatchingEntityInputOptionsWithUsage,
  getTopUsageRankedCandidate,
  getUsagePokemonEntry,
  getUsageRankedPokemonOptions,
  getUsageSuggestionOptionLists,
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

describe("getUsageRankedPokemonOptions", () => {
  const pokemonCandidates = [
    { canonicalName: "Whimsicott", value: "エルフーン" },
    { canonicalName: "Garchomp", value: "ガブリアス" },
    { canonicalName: "Garchomp-Mega", value: "メガガブリアス" },
    { canonicalName: "Sinistcha", value: "ヤバソチャ" },
    { canonicalName: "Basculegion", value: "イダイトウ オスのすがた" },
    { canonicalName: "Basculegion-F", value: "イダイトウ メスのすがた" },
  ];
  const ranked = (pokemonRank: number) => ({ pokemonRank, move: [], ability: [], item: [] });
  const usage: ChampionsUsageData = {
    ...data,
    formats: {
      Singles: { whimsicott: ranked(1), garchomp: ranked(2), unknownmon: ranked(3) },
      Doubles: {
        whimsicott: ranked(4), garchomp: ranked(1), sinistcha: ranked(2), basculegion: ranked(3),
        "Basculegion-F": { move: ["Protect"], ability: [], item: [] },
      },
    },
  };

  it("uses the selected format's overall rank and keeps Japanese labels and form canonicals", () => {
    expect(getUsageRankedPokemonOptions(pokemonCandidates, usage, "Doubles").map((option) => option.value))
      .toEqual(["ガブリアス", "ヤバソチャ", "イダイトウ オスのすがた", "エルフーン"]);
    expect(getUsageRankedPokemonOptions(pokemonCandidates, usage, "Singles"))
      .toEqual([pokemonCandidates[0], pokemonCandidates[1]]);
    expect(pokemonCandidates).toHaveLength(6);
  });

  it("does not infer ranks for Mega, opposite-sex or unlisted forms and does not duplicate labels", () => {
    expect(getUsageRankedPokemonOptions([...pokemonCandidates, { canonicalName: "Garchomp", value: "別表示" }], usage, "Doubles"))
      .toEqual([pokemonCandidates[1], pokemonCandidates[3], pokemonCandidates[4], pokemonCandidates[0]]);
    expect(getUsageRankedPokemonOptions(pokemonCandidates, null, "Singles")).toEqual([]);
    expect(getUsageRankedPokemonOptions(pokemonCandidates, data, "Singles")).toEqual([]);
    expect(getUsageRankedPokemonOptions([], usage, "Doubles")).toEqual([]);
  });

  it("retains all four Tauros entries from the real input catalog in each format's ranking", () => {
    const taurosUsage: ChampionsUsageData = {
      ...data,
      formats: {
        Singles: { tauros: ranked(213), taurospaldeacombat: ranked(235), taurospaldeablaze: ranked(117), taurospaldeaaqua: ranked(175) },
        Doubles: { tauros: ranked(224), taurospaldeacombat: ranked(234), taurospaldeablaze: ranked(181), taurospaldeaaqua: ranked(150) },
      },
    };
    const expected = {
      Singles: ["ケンタロス パルデアのすがた・ブレイズしゅ", "ケンタロス パルデアのすがた・ウォーターしゅ", "ケンタロス", "ケンタロス パルデアのすがた・コンバットしゅ"],
      Doubles: ["ケンタロス パルデアのすがた・ウォーターしゅ", "ケンタロス パルデアのすがた・ブレイズしゅ", "ケンタロス", "ケンタロス パルデアのすがた・コンバットしゅ"],
    };
    for (const format of ["Singles", "Doubles"] as const) {
      const options = getUsageRankedPokemonOptions(getEntityInputOptions("pokemon"), taurosUsage, format);
      expect(options.map(option => option.value)).toEqual(expected[format]);
      expect(new Set(options.map(option => option.canonicalName)).size).toBe(4);
    }
  });

  it("keeps the full ranked list reachable beyond the text-search candidate limit", () => {
    const all = Array.from({ length: 80 }, (_, index) => ({ canonicalName: `Pokemon${index}` }));
    const allData: ChampionsUsageData = {
      ...data,
      formats: { Singles: Object.fromEntries(all.map((option, index) => [option.canonicalName, ranked(80 - index)])), Doubles: {} },
    };
    expect(getUsageRankedPokemonOptions(all, allData, "Singles")).toEqual([...all].reverse());
    expect(getUsageRankedPokemonOptions(all, allData, "Doubles")).toEqual([]);
  });
});

describe("getUsageSuggestionOptionLists", () => {
  const kingambitUsage: ChampionsUsageData = {
    ...data,
    formats: {
      Singles: {
        Kingambit: {
          move: ["Sucker Punch", "Kowtow Cleave", "Swords Dance"],
          ability: ["Supreme Overlord", "Defiant", "Pressure"],
          item: ["Black Glasses", "Leftovers", "Focus Sash"],
        },
      },
      Doubles: {
        Kingambit: { move: ["Protect", "Sucker Punch"], ability: ["Defiant", "Supreme Overlord"], item: ["Focus Sash", "Leftovers"] },
      },
    },
  };

  it.each([
    ["move", "ふいうち", "Sucker Punch"],
    ["ability", "まけんき", "Defiant"],
    ["item", "たべのこし", "Leftovers"],
  ] as const)("opens unfiltered ranked %s choices while preserving typed-name filtering", (category, input, selected) => {
    const baseOptions = category === "ability"
      ? getPokemonAbilityInputOptions("Kingambit")!
      : getEntityInputOptions(category);
    const lists = getUsageSuggestionOptionLists(baseOptions, input, kingambitUsage, "Singles", "Kingambit", category);
    expect(lists.searchOptions.map(option => option.canonicalName)).toEqual([selected]);
    expect(lists.menuOptions.slice(0, 3).map(option => option.canonicalName))
      .toEqual(kingambitUsage.formats.Singles.Kingambit[category]);
    expect(lists.menuOptions.length).toBeGreaterThan(1);
    expect(lists.menuOptions.length).toBeLessThanOrEqual(40);
    expect(lists.menuOptions.every(option => baseOptions.includes(option))).toBe(true);

    const unmatched = getUsageSuggestionOptionLists(baseOptions, "存在しない入力", kingambitUsage, "Singles", "Kingambit", category);
    expect(unmatched.searchOptions).toEqual([]);
    expect(unmatched.menuOptions).toEqual(lists.menuOptions);
    if (category === "ability") {
      expect(lists.menuOptions).toHaveLength(3);
      expect(lists.menuOptions.some(option => option.canonicalName === "Intimidate")).toBe(false);
    }
  });

  it("keeps format-specific ordering and the alphabetical fallback without usage data", () => {
    const options = getEntityInputOptions("move");
    const doubles = getUsageSuggestionOptionLists(options, "ふいうち", kingambitUsage, "Doubles", "Kingambit", "move");
    expect(doubles.menuOptions.slice(0, 2).map(option => option.canonicalName)).toEqual(["Protect", "Sucker Punch"]);
    expect(doubles.searchOptions.map(option => option.canonicalName)).toEqual(["Sucker Punch"]);
    const fallback = getUsageSuggestionOptionLists(options, "ふいうち", null, "Doubles", "Kingambit", "move");
    expect(fallback.menuOptions).toEqual(options.slice(0, 40));
    expect(fallback.searchOptions.map(option => option.canonicalName)).toEqual(["Sucker Punch"]);
  });

  it("filters the entire catalog before limiting search results", () => {
    const options = Array.from({ length: 60 }, (_, i) => ({ value: `技${i}`, canonicalName: `Move${i}` }));
    const lists = getUsageSuggestionOptionLists(options, "技59", null, "Singles", undefined, "move");
    expect(lists.menuOptions).toHaveLength(40);
    expect(lists.searchOptions).toEqual([options[59]]);
  });
});

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
