import { describe, expect, it } from "vitest";
import {
  getEntityInputOptions,
  getMatchingEntityInputOptions,
  getMatchingPokemonAbilityInputOptions,
  getPokemonAbilityInputOptions,
  resolveEntity,
  resolveEntityWithCanonicalHint,
} from "./resolver";

describe("resolveEntity", () => {
  it("resolves a Japanese exact label to a Showdown canonical name", () => {
    const result = resolveEntity("pokemon", "ピカチュウ");

    expect(result.status).toBe("exact");
    expect(result.canonicalName).toBe("Pikachu");
    expect(result.candidates[0]).toMatchObject({
      calcId: "pikachu",
      displayNameJa: "ピカチュウ",
      matchedBy: "displayNameJa",
    });
  });

  it("resolves Japanese aliases without changing the canonical boundary", () => {
    const result = resolveEntity("move", "十万ボルト");

    expect(result.status).toBe("alias");
    expect(result.canonicalName).toBe("Thunderbolt");
    expect(result.candidates[0]).toMatchObject({
      calcId: "thunderbolt",
      matchedBy: "searchText",
    });
  });

  it("resolves generated option data for Pokemon beyond the seed catalog", () => {
    const result = resolveEntity("pokemon", "ガオガエン");

    expect(result.status).toBe("exact");
    expect(result.canonicalName).toBe("Incineroar");
    expect(result.candidates[0]).toMatchObject({
      calcId: "incineroar",
      displayNameJa: "ガオガエン",
      matchedBy: "displayNameJa",
    });
  });

  it("uses one Japanese label format for all Forces of Nature forms", () => {
    const cases = [
      ["ランドロス けしんフォルム", "Landorus"],
      ["ランドロス れいじゅうフォルム", "Landorus-Therian"],
      ["トルネロス けしんフォルム", "Tornadus"],
      ["トルネロス れいじゅうフォルム", "Tornadus-Therian"],
      ["ボルトロス けしんフォルム", "Thundurus"],
      ["ボルトロス れいじゅうフォルム", "Thundurus-Therian"],
      ["ラブトロス けしんフォルム", "Enamorus"],
      ["ラブトロス れいじゅうフォルム", "Enamorus-Therian"],
    ] as const;
    const inputOptions = getEntityInputOptions("pokemon");

    for (const [displayNameJa, canonicalName] of cases) {
      expect(resolveEntity("pokemon", displayNameJa)).toMatchObject({
        status: "exact",
        canonicalName,
        displayNameJa,
      });
      expect(inputOptions).toContainEqual(expect.objectContaining({
        value: displayNameJa,
        canonicalName,
      }));
    }

    expect(resolveEntity("pokemon", "ランドロス(霊獣)").status).toBe("not-found");
    expect(resolveEntity("pokemon", "ランドロス霊獣").status).toBe("not-found");
    expect(resolveEntity("pokemon", "ランドロスれいじゅう").status).toBe("not-found");
  });

  it("uses concise display labels for mega Pokemon while keeping long generated labels searchable", () => {
    expect(resolveEntity("pokemon", "メガスターミー")).toMatchObject({
      status: "exact",
      canonicalName: "Starmie-Mega",
      displayNameJa: "メガスターミー",
    });
    expect(resolveEntity("pokemon", "スターミー メガスターミー")).toMatchObject({
      status: "alias",
      canonicalName: "Starmie-Mega",
      displayNameJa: "メガスターミー",
    });
    expect(getEntityInputOptions("pokemon")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "メガスターミー",
          canonicalName: "Starmie-Mega",
        }),
      ]),
    );
  });

  it("uses explicit formal Mega Stone labels while keeping former generated labels searchable", () => {
    expect(resolveEntity("item", "マフォクシナイト")).toMatchObject({
      status: "exact",
      canonicalName: "Delphoxite",
      displayNameJa: "マフォクシナイト",
      sourceStatus: "manual",
    });
    expect(resolveEntity("item", "マフォクシーナイト")).toMatchObject({
      status: "alias",
      canonicalName: "Delphoxite",
      displayNameJa: "マフォクシナイト",
    });
    expect(resolveEntity("item", "ガブリアスナイトZ")).toMatchObject({
      status: "exact",
      canonicalName: "Garchompite Z",
      displayNameJa: "ガブリアスナイトＺ",
    });
    expect(getEntityInputOptions("item")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "ガブリアスナイトＺ",
          canonicalName: "Garchompite Z",
        }),
      ]),
    );
  });

  it("uses a canonical hint to resolve intentionally shared Mega display labels", () => {
    expect(resolveEntityWithCanonicalHint(
      "pokemon",
      "メガマギアナ",
      "Magearna-Original-Mega",
    )).toMatchObject({
      status: "exact",
      canonicalName: "Magearna-Original-Mega",
      displayNameJa: "メガマギアナ",
    });
    expect(resolveEntityWithCanonicalHint(
      "pokemon",
      "メガシャリタツ",
      "Tatsugiri-Droopy-Mega",
    )).toMatchObject({
      status: "exact",
      canonicalName: "Tatsugiri-Droopy-Mega",
      displayNameJa: "メガシャリタツ",
    });
    expect(resolveEntityWithCanonicalHint(
      "pokemon",
      "メガマギアナ",
      "Pikachu",
    ).status).toBe("not-found");
  });

  it("resolves generated Pokemon form labels that would otherwise collide with internal variants", () => {
    expect(resolveEntity("pokemon", "イッカネズミ ３びきかぞく")).toMatchObject({
      status: "exact",
      canonicalName: "Maushold",
      displayNameJa: "イッカネズミ ３びきかぞく",
    });
    expect(resolveEntity("pokemon", "イッカネズミ")).toMatchObject({
      status: "alias",
      canonicalName: "Maushold",
      displayNameJa: "イッカネズミ ３びきかぞく",
    });
    expect(resolveEntity("pokemon", "イッカネズミ ４ひきかぞく")).toMatchObject({
      status: "exact",
      canonicalName: "Maushold-Four",
      displayNameJa: "イッカネズミ ４ひきかぞく",
    });
    expect(resolveEntity("pokemon", "イッカネズミ4ひきかぞく")).toMatchObject({
      status: "exact",
      canonicalName: "Maushold-Four",
    });

    expect(resolveEntity("pokemon", "オーガポン いしずえのめん")).toMatchObject({
      status: "exact",
      canonicalName: "Ogerpon-Cornerstone",
      displayNameJa: "オーガポン いしずえのめん",
    });
    expect(resolveEntity("pokemon", "オーガポンいしずえのめん")).toMatchObject({
      status: "exact",
      canonicalName: "Ogerpon-Cornerstone",
    });
    expect(resolveEntity("pokemon", "オーガポン いしずえのかめん")).toMatchObject({
      status: "alias",
      canonicalName: "Ogerpon-Cornerstone",
    });
    expect(resolveEntity("pokemon", "オーガポン いしずえのめん テラスタル")).toMatchObject({
      status: "exact",
      canonicalName: "Ogerpon-Cornerstone-Tera",
      displayNameJa: "オーガポン いしずえのめん テラスタル",
    });

    expect(resolveEntity("pokemon", "ビビヨン はなぞののもよう")).toMatchObject({
      status: "exact",
      canonicalName: "Vivillon",
      displayNameJa: "ビビヨン はなぞののもよう",
    });
    expect(resolveEntity("pokemon", "ビビヨン ファンシーなもよう")).toMatchObject({
      status: "exact",
      canonicalName: "Vivillon-Fancy",
      displayNameJa: "ビビヨン ファンシーなもよう",
    });
    expect(resolveEntity("pokemon", "ビビヨン ボールのもよう")).toMatchObject({
      status: "exact",
      canonicalName: "Vivillon-Pokeball",
      displayNameJa: "ビビヨン ボールのもよう",
    });
  });

  it.each([
    ["プルリル メスのすがた", "Frillish"],
    ["ブルンゲル メスのすがた", "Jellicent"],
    ["カエンジシ メスのすがた", "Pyroar"],
  ] as const)("exposes the display-only female form %s with shared canonical %s", (displayNameJa, canonicalName) => {
    expect(resolveEntity("pokemon", displayNameJa)).toMatchObject({
      status: "alias",
      canonicalName,
      displayNameJa,
      sourceStatus: "manual",
    });
    expect(getEntityInputOptions("pokemon")).toContainEqual(expect.objectContaining({
      value: displayNameJa,
      canonicalName,
      displayNameJa,
    }));
    expect(resolveEntity("pokemon", canonicalName)).toMatchObject({
      status: "exact",
      canonicalName,
    });
  });

  it("normalizes the user-provided full-width separator for female Pyroar", () => {
    expect(resolveEntity("pokemon", "カエンジシ　メスのすがた")).toMatchObject({
      status: "alias",
      canonicalName: "Pyroar",
      displayNameJa: "カエンジシ メスのすがた",
    });
  });

  it("keeps every explicit PokeAPI male/female form pair selectable", () => {
    const cases = [
      ["プルリル オスのすがた", "Frillish"],
      ["プルリル メスのすがた", "Frillish"],
      ["ブルンゲル オスのすがた", "Jellicent"],
      ["ブルンゲル メスのすがた", "Jellicent"],
      ["カエンジシ オスのすがた", "Pyroar"],
      ["カエンジシ メスのすがた", "Pyroar"],
      ["ニャオニクス オスのすがた", "Meowstic"],
      ["ニャオニクス メスのすがた", "Meowstic-F"],
      ["イエッサン オスのすがた", "Indeedee"],
      ["イエッサン メスのすがた", "Indeedee-F"],
      ["イダイトウ オスのすがた", "Basculegion"],
      ["イダイトウ メスのすがた", "Basculegion-F"],
      ["パフュートン オスのすがた", "Oinkologne"],
      ["パフュートン メスのすがた", "Oinkologne-F"],
    ] as const;
    const inputOptions = getEntityInputOptions("pokemon");

    for (const [displayNameJa, canonicalName] of cases) {
      expect(inputOptions).toContainEqual(expect.objectContaining({
        value: displayNameJa,
        canonicalName,
      }));
      expect(resolveEntity("pokemon", displayNameJa)).toMatchObject({
        canonicalName,
        displayNameJa,
      });
    }
  });

  it("keeps tea Pokemon form suggestions unique and resolvable", () => {
    const formCases = [
      ["チャデス マガイモノのすがた", "Poltchageist"],
      ["チャデス タカイモノのすがた", "Poltchageist-Artisan"],
      ["ヤバソチャ ボンサクのすがた", "Sinistcha"],
      ["ヤバソチャ ケッサクのすがた", "Sinistcha-Masterpiece"],
      ["ヤバチャ がんさくフォルム", "Sinistea"],
      ["ヤバチャ しんさくフォルム", "Sinistea-Antique"],
      ["ポットデス がんさくフォルム", "Polteageist"],
      ["ポットデス しんさくフォルム", "Polteageist-Antique"],
    ] as const;

    for (const [input, canonicalName] of formCases) {
      expect(resolveEntity("pokemon", input)).toMatchObject({
        status: "exact",
        canonicalName,
        displayNameJa: input,
      });
    }

    const suggestionCases = [
      ["チャデス", ["Poltchageist", "Poltchageist-Artisan"]],
      ["ヤバソチャ", ["Sinistcha", "Sinistcha-Masterpiece"]],
      ["ヤバチャ", ["Sinistea", "Sinistea-Antique"]],
      ["ポットデス", ["Polteageist", "Polteageist-Antique"]],
    ] as const;

    for (const [input, canonicalNames] of suggestionCases) {
      expect(getMatchingEntityInputOptions("pokemon", input).map((option) => option.canonicalName)).toEqual(
        expect.arrayContaining([...canonicalNames]),
      );
    }
  });

  it("resolves generated option data for other UI entity fields", () => {
    expect(resolveEntity("move", "インファイト")).toMatchObject({
      status: "exact",
      canonicalName: "Close Combat",
      calcId: "closecombat",
    });
    expect(resolveEntity("item", "とつげきチョッキ")).toMatchObject({
      status: "exact",
      canonicalName: "Assault Vest",
      calcId: "assaultvest",
    });
    expect(resolveEntity("ability", "もうか")).toMatchObject({
      status: "exact",
      canonicalName: "Blaze",
      calcId: "blaze",
    });
    expect(resolveEntity("nature", "おくびょう")).toMatchObject({
      status: "exact",
      canonicalName: "Timid",
      calcId: "timid",
    });
    expect(resolveEntity("type", "あく")).toMatchObject({
      status: "exact",
      canonicalName: "Dark",
      calcId: "dark",
    });
  });

  it("keeps ambiguous aliases as candidates instead of choosing one", () => {
    const result = resolveEntity("pokemon", "ドラゴン");

    expect(result.status).toBe("ambiguous");
    expect(result.canonicalName).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.canonicalName)).toEqual(
      expect.arrayContaining(["Dragonite", "Dragapult"]),
    );
  });

  it("keeps entity kinds separated for the same visible text", () => {
    const result = resolveEntity("type", "ドラゴン");

    expect(result.status).toBe("exact");
    expect(result.canonicalName).toBe("Dragon");
  });

  it("returns not-found for unknown input", () => {
    const result = resolveEntity("item", "しらないどうぐ");

    expect(result).toMatchObject({
      status: "not-found",
      kind: "item",
      candidates: [],
    });
  });

  it("exposes UI input options as Japanese labels only", () => {
    const pokemonOptions = getEntityInputOptions("pokemon");

    expect(pokemonOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "ピカチュウ",
          canonicalName: "Pikachu",
        }),
      ]),
    );
    expect(pokemonOptions.some((option) => option.value === "Pikachu")).toBe(false);
    expect(pokemonOptions.filter((option) => option.value === "ピカチュウ")).toHaveLength(1);
    expect(getEntityInputOptions("nature")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: "おくびょう",
          canonicalName: "Timid",
        }),
      ]),
    );
  });

  it("weakens UI input suggestions to prefix matches", () => {
    const options = getMatchingEntityInputOptions("pokemon", "リザー");
    const values = options.map((option) => option.value);

    expect(values).toEqual(expect.arrayContaining(["リザード", "リザードン"]));
    expect(values).not.toContain("フリーザー");
    expect(values.every((value) => value.startsWith("リザー"))).toBe(true);
  });

  it("matches katakana labels from pre-conversion hiragana input", () => {
    expect(resolveEntity("pokemon", "ぴかちゅう")).toMatchObject({
      status: "exact",
      canonicalName: "Pikachu",
      displayNameJa: "ピカチュウ",
    });

    expect(getMatchingEntityInputOptions("pokemon", "めがまふ").map((option) => option.value)).toContain(
      "メガマフォクシー",
    );
    expect(getMatchingEntityInputOptions("move", "さいこき").map((option) => option.value)).toContain(
      "サイコキネシス",
    );
    expect(getMatchingPokemonAbilityInputOptions("Kingambit", "ぷれ")?.map((option) => option.value)).toContain(
      "プレッシャー",
    );
  });

  it("exposes all generated ability suggestions for a resolved Pokemon", () => {
    const kingambitOptions = getPokemonAbilityInputOptions("Kingambit");
    expect(kingambitOptions).toEqual([
      expect.objectContaining({ value: "まけんき", canonicalName: "Defiant" }),
      expect.objectContaining({ value: "そうだいしょう", canonicalName: "Supreme Overlord" }),
      expect.objectContaining({ value: "プレッシャー", canonicalName: "Pressure" }),
    ]);

    const garchompOptions = getPokemonAbilityInputOptions("Garchomp");
    expect(garchompOptions).toEqual([
      expect.objectContaining({ value: "すながくれ", canonicalName: "Sand Veil" }),
      expect.objectContaining({ value: "さめはだ", canonicalName: "Rough Skin" }),
    ]);

    const starmieMegaOptions = getPokemonAbilityInputOptions("Starmie-Mega");
    expect(starmieMegaOptions).toEqual([
      expect.objectContaining({
        value: "ちからもち",
        canonicalName: "Huge Power",
      }),
    ]);
    expect(starmieMegaOptions?.some((option) => option.value === "もうか")).toBe(false);
    expect(getPokemonAbilityInputOptions(undefined)).toBeUndefined();
  });

  it("uses PokeAPI species-default forms for Showdown base-form ability suggestions", () => {
    const cases: Array<{
      pokemon: string;
      expectedAbilities: Array<{ value: string; canonicalName: string }>;
    }> = [
      { pokemon: "Basculegion", expectedAbilities: [
        { value: "すいすい", canonicalName: "Swift Swim" },
        { value: "てきおうりょく", canonicalName: "Adaptability" },
        { value: "かたやぶり", canonicalName: "Mold Breaker" },
      ] },
      { pokemon: "Meowstic", expectedAbilities: [
        { value: "するどいめ", canonicalName: "Keen Eye" },
        { value: "すりぬけ", canonicalName: "Infiltrator" },
        { value: "いたずらごころ", canonicalName: "Prankster" },
      ] },
      { pokemon: "Tatsugiri", expectedAbilities: [
        { value: "しれいとう", canonicalName: "Commander" },
        { value: "よびみず", canonicalName: "Storm Drain" },
      ] },
      { pokemon: "Toxtricity", expectedAbilities: [
        { value: "パンクロック", canonicalName: "Punk Rock" },
        { value: "プラス", canonicalName: "Plus" },
        { value: "テクニシャン", canonicalName: "Technician" },
      ] },
      { pokemon: "Maushold", expectedAbilities: [
        { value: "フレンドガード", canonicalName: "Friend Guard" },
        { value: "ほおぶくろ", canonicalName: "Cheek Pouch" },
        { value: "テクニシャン", canonicalName: "Technician" },
      ] },
      { pokemon: "Lycanroc", expectedAbilities: [
        { value: "するどいめ", canonicalName: "Keen Eye" },
        { value: "すなかき", canonicalName: "Sand Rush" },
        { value: "ふくつのこころ", canonicalName: "Steadfast" },
      ] },
    ];

    for (const { pokemon, expectedAbilities } of cases) {
      expect(getPokemonAbilityInputOptions(pokemon)?.map(({ value, canonicalName }) => ({
        value,
        canonicalName,
      }))).toEqual(expectedAbilities);
    }
  });

  it("uses the complete legal ability list for both Maushold forms", () => {
    const expectedAbilities = [
      { value: "フレンドガード", canonicalName: "Friend Guard" },
      { value: "ほおぶくろ", canonicalName: "Cheek Pouch" },
      { value: "テクニシャン", canonicalName: "Technician" },
    ];

    for (const pokemon of ["Maushold", "Maushold-Four"]) {
      expect(getPokemonAbilityInputOptions(pokemon)?.map(({ value, canonicalName }) => ({
        value,
        canonicalName,
      }))).toEqual(expectedAbilities);
    }
  });

  it("uses the complete legal ability list for Galarian Darmanitan's standard form", () => {
    expect(getPokemonAbilityInputOptions("Darmanitan-Galar")?.map(({ value, canonicalName }) => ({
      value,
      canonicalName,
    }))).toEqual([
      { value: "ごりむちゅう", canonicalName: "Gorilla Tactics" },
      { value: "ダルマモード", canonicalName: "Zen Mode" },
    ]);
  });

  it("keeps Pokemon ability dropdown options unfiltered while free-text completion can still narrow", () => {
    expect(getPokemonAbilityInputOptions("Kingambit")?.map((option) => option.value)).toEqual([
      "まけんき",
      "そうだいしょう",
      "プレッシャー",
    ]);

    expect(getMatchingPokemonAbilityInputOptions("Kingambit", "まけんき")).toEqual([
      expect.objectContaining({ value: "まけんき", canonicalName: "Defiant" }),
    ]);
  });
});
