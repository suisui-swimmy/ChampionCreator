import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const outputDir = join(projectRoot, "src", "data", "generated");
const pokemonDataDir = join(projectRoot, "others", "pokemon-data");
const localOthersDir = join(projectRoot, "..", "others");

const inputPaths = {
  moves: join(outputDir, "calc-moves.gen.json"),
  items: join(outputDir, "calc-items.gen.json"),
  abilities: join(outputDir, "calc-abilities.gen.json"),
  natures: join(outputDir, "calc-natures.gen.json"),
  types: join(outputDir, "calc-types.gen.json"),
  supportMatrix: join(projectRoot, "src", "data", "champions", "champions-support-matrix.json"),
  itemNames: join(pokemonDataDir, "ITEM_ALL.json"),
  pokemonNames: join(pokemonDataDir, "POKEMON_ALL.json"),
  moveNames: join(localOthersDir, "pokeranker_SV", "data", "foreign_move.txt"),
  abilityNames: join(localOthersDir, "pokeranker_SV", "data", "foreign_ability.txt"),
};

const outputPaths = {
  moves: join(outputDir, "move-options.gen.json"),
  items: join(outputDir, "item-options.gen.json"),
  abilities: join(outputDir, "ability-options.gen.json"),
  natures: join(outputDir, "nature-options.gen.json"),
  types: join(outputDir, "type-options.gen.json"),
};

const TYPE_LABELS_JA = {
  "???": "???",
  Bug: "むし",
  Dark: "あく",
  Dragon: "ドラゴン",
  Electric: "でんき",
  Fairy: "フェアリー",
  Fighting: "かくとう",
  Fire: "ほのお",
  Flying: "ひこう",
  Ghost: "ゴースト",
  Grass: "くさ",
  Ground: "じめん",
  Ice: "こおり",
  Normal: "ノーマル",
  Poison: "どく",
  Psychic: "エスパー",
  Rock: "いわ",
  Steel: "はがね",
  Stellar: "ステラ",
  Water: "みず",
};

const TYPE_COLORS = {
  "???": "#8a95a6",
  Bug: "#91a119",
  Dark: "#624d4e",
  Dragon: "#5060e1",
  Electric: "#fac000",
  Fairy: "#ef70ef",
  Fighting: "#ff8000",
  Fire: "#e62829",
  Flying: "#81b9ef",
  Ghost: "#704170",
  Grass: "#3fa129",
  Ground: "#915121",
  Ice: "#3fd8ff",
  Normal: "#9fa19f",
  Poison: "#9141cb",
  Psychic: "#ef4179",
  Rock: "#afa981",
  Steel: "#60a1b8",
  Stellar: "#36b7a6",
  Water: "#2980ef",
};

const NATURE_LABELS_JA = {
  Adamant: "いじっぱり",
  Bashful: "てれや",
  Bold: "ずぶとい",
  Brave: "ゆうかん",
  Calm: "おだやか",
  Careful: "しんちょう",
  Docile: "すなお",
  Gentle: "おとなしい",
  Hardy: "がんばりや",
  Hasty: "せっかち",
  Impish: "わんぱく",
  Jolly: "ようき",
  Lax: "のうてんき",
  Lonely: "さみしがり",
  Mild: "おっとり",
  Modest: "ひかえめ",
  Naive: "むじゃき",
  Naughty: "やんちゃ",
  Quiet: "れいせい",
  Quirky: "きまぐれ",
  Rash: "うっかりや",
  Relaxed: "のんき",
  Sassy: "なまいき",
  Serious: "まじめ",
  Timid: "おくびょう",
};

const STAT_LABELS_JA = {
  hp: "HP",
  atk: "こうげき",
  def: "ぼうぎょ",
  spa: "とくこう",
  spd: "とくぼう",
  spe: "すばやさ",
};

const MANUAL_MOVE_LABELS_JA = {
  nihillight: "無に帰す光",
};

const UNSUPPORTED_MOVE_IDS = new Set(["nomove", "paleowave", "polarflare", "shadowstrike"]);

const SPECIAL_ABILITY_LABELS_JA = {
  noability: "とくせいなし",
};

const UNSUPPORTED_ABILITY_IDS = new Set(["mountaineer", "persistent", "rebound"]);

const ABILITY_VARIANT_BASE_LABELS_JA = {
  asone: "じんばいったい",
  embodyaspect: "おもかげやどし",
};

const EMBODY_ASPECT_FORM_LABELS_JA = {
  Cornerstone: "いしずえのめん",
  Hearthflame: "かまどのめん",
  Teal: "みどりのめん",
  Wellspring: "いどのめん",
};

const MANUAL_ITEM_LABELS_JA = {
  berry: "きのみ",
  berserkgene: "はかいのいでんし",
  bitterberry: "にがいきのみ",
  burntberry: "やけたきのみ",
  goldberry: "おうごんのみ",
  iceberry: "こおったきのみ",
  mail: "メール",
  metalalloy: "ふくごうきんぞく",
  mintberry: "はっかのみ",
  miracleberry: "きせきのみ",
  mysteryberry: "ふしぎなきのみ",
  pinkbow: "ピンクのリボン",
  polkadotbow: "みずたまリボン",
  przcureberry: "まひなおしのみ",
  psncureberry: "どくけしのみ",
  stick: "ながねぎ",
  unremarkableteacup: "ボンサクのちゃわん",
};

const UNSUPPORTED_ITEM_IDS = new Set(["crucibellite", "vilevial"]);

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const readOptionalText = async (path) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }

    throw error;
  }
};

const parseTsv = (text) => {
  if (!text) {
    return [];
  }

  const [headerLine, ...lines] = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  const headers = headerLine.split("\t");

  return lines
    .filter(Boolean)
    .map((line) => {
      const columns = line.split("\t");
      return Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""]));
    });
};

const normalizeSearchText = (value) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");

const normalizeLooseKey = (value) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const makeSearchText = (tokens) =>
  Array.from(new Set(tokens.filter(Boolean).map(normalizeSearchText))).join(" ");

const withOptional = (entry) =>
  Object.fromEntries(
    Object.entries(entry).filter(([, value]) => {
      if (value === undefined || value === null) {
        return false;
      }

      if (Array.isArray(value)) {
        return value.length > 0;
      }

      if (typeof value === "object") {
        return Object.keys(value).length > 0;
      }

      return true;
    }),
  );

const makePayload = ({ kind, dataVersion, source, generatedBy, entries, summary }) => ({
  schemaVersion: 1,
  dataVersion,
  source,
  generatedBy,
  kind,
  entries,
  summary,
});

const writeJson = async (path, payload) => {
  await writeFile(path, `${JSON.stringify(payload)}\n`, "utf8");
  return { output: path.replace(`${projectRoot}\\`, "").replaceAll("\\", "/"), count: payload.entries.length };
};

const sortByLabel = (entries) =>
  entries.sort((a, b) => {
    const labelCompare = a.label.localeCompare(b.label, "ja");
    if (labelCompare !== 0) {
      return labelCompare;
    }

    return a.id.localeCompare(b.id, "en");
  });

const buildLocalizedNameMap = (rows) => {
  const nameMap = new Map();

  for (const row of rows) {
    const englishName = row["英語"];
    const japaneseName = row["日本語"];

    if (!englishName || !japaneseName) {
      continue;
    }

    nameMap.set(normalizeLooseKey(englishName), japaneseName);
  }

  return nameMap;
};

const moveTags = (move) => {
  const tags = [];

  if (move.category === "Status") tags.push("status");
  if ((move.priority ?? 0) !== 0) tags.push("priority");
  if (move.flags?.contact) tags.push("contact");
  if (move.multihit) tags.push("multi-hit");
  if (move.drain) tags.push("drain");
  if (move.recoil || move.mindBlownRecoil || move.struggleRecoil || move.hasCrashDamage) {
    tags.push("recoil");
  }
  if (move.willCrit) tags.push("critical");
  if (move.isZ) tags.push("z-move");
  if (move.isMax) tags.push("max-move");
  if (move.target === "allAdjacent" || move.target === "allAdjacentFoes") tags.push("spread");
  if (move.basePower === 0 && move.category !== "Status") tags.push("fixed-damage");

  return tags;
};

const itemTags = (item) => {
  const tags = [];
  const id = item.id;

  if (item.isBerry) tags.push("berry");
  if (item.megaStone) tags.push("mega-stone", "form-change");
  if (id.includes("choice")) tags.push("choice");
  if (id.includes("plate") || id.endsWith("memory")) tags.push("plate", "type-boost");
  if (
    [
      "assaultvest",
      "choicescarf",
      "choiceband",
      "choicespecs",
      "eviolite",
      "luckyegg",
      "poweranklet",
      "powerband",
      "powerbelt",
      "powerbracer",
      "powerlens",
      "powerweight",
    ].includes(id)
  ) {
    tags.push("stat-modifier");
  }
  if (
    [
      "lifeorb",
      "expertbelt",
      "muscleband",
      "wiseglasses",
      "metronome",
      "loadeddice",
      "punchingglove",
    ].includes(id)
  ) {
    tags.push("damage-modifier");
  }
  if (id === "eviolite") tags.push("eviolite-like");

  return tags;
};

const abilityTags = (ability) => {
  const tags = [];
  const id = ability.id;

  if (
    [
      "adaptability",
      "aerilate",
      "analytic",
      "beadsofruin",
      "blaze",
      "darkaura",
      "dragonsmaw",
      "fairyaura",
      "flashfire",
      "guts",
      "hadronengine",
      "hugepower",
      "hustle",
      "intrepidsword",
      "ironfist",
      "megalauncher",
      "neuroforce",
      "orichalcumpulse",
      "overgrow",
      "pixilate",
      "protosynthesis",
      "purepower",
      "quarkdrive",
      "reckless",
      "sandforce",
      "sharpness",
      "sheerforce",
      "solarpower",
      "strongjaw",
      "swarm",
      "technician",
      "torrent",
      "toughclaws",
      "transistor",
      "waterbubble",
      "wellbakedbody",
    ].includes(id)
  ) {
    tags.push("damage-modifier");
  }
  if (["drought", "drizzle", "sandstream", "snowwarning", "airlock", "cloudnine"].includes(id)) {
    tags.push("weather-modifier");
  }
  if (["electricsurge", "grassysurge", "mistysurge", "psychicsurge"].includes(id)) {
    tags.push("field-modifier");
  }
  if (["levitate", "flashfire", "sapsipper", "voltabsorb", "waterabsorb", "stormdrain", "dryskin", "eartheater"].includes(id)) {
    tags.push("immunity");
  }
  if (["intimidate", "defiant", "competitive", "protosynthesis", "quarkdrive", "supremeoverlord"].includes(id)) {
    tags.push("stat-modifier");
  }
  if (["battlebond", "commander", "forecast", "multitype", "powerconstruct", "schooling", "stancechange", "zenmode"].includes(id)) {
    tags.push("form-change", "manual-review");
  }

  return tags;
};

const mapMegaStone = (megaStone) => {
  if (!megaStone) {
    return undefined;
  }

  const [[baseSpecies, megaSpecies]] = Object.entries(megaStone);
  return { baseSpecies, megaSpecies };
};

const buildPokemonNameMap = (pokemonNames) => {
  const nameMap = new Map();

  for (const pokemon of pokemonNames) {
    const labelJa = pokemon.pokeapi_species_name_ja || pokemon.yakkuncom_name;

    if (!labelJa) {
      continue;
    }

    for (const candidate of [
      pokemon.pkmn_name,
      pokemon.pkmn_base_species,
      pokemon.pokeapi_species_name_en,
    ]) {
      if (!candidate) {
        continue;
      }

      const key = normalizeLooseKey(candidate);
      if (!nameMap.has(key)) {
        nameMap.set(key, labelJa);
      }
    }
  }

  return nameMap;
};

const inferMegaStoneLabel = (item, pokemonNameMap) => {
  const megaStone = mapMegaStone(item.megaStone);

  if (!megaStone) {
    return undefined;
  }

  const baseSpeciesKey = normalizeLooseKey(megaStone.baseSpecies);
  const baseSpeciesWithoutFormKey = normalizeLooseKey(megaStone.baseSpecies.split("-")[0]);
  const baseLabel = pokemonNameMap.get(baseSpeciesKey) ?? pokemonNameMap.get(baseSpeciesWithoutFormKey);

  if (!baseLabel) {
    return undefined;
  }

  const suffix = item.showdownName.match(/\s([XYZ])$/)?.[1] ?? "";

  return {
    label: `${baseLabel}ナイト${suffix}`,
    baseSpecies: megaStone.baseSpecies,
  };
};

const inferMoveLabel = (move, moveNameMap) => {
  const directLabel = moveNameMap.get(normalizeLooseKey(move.showdownName));

  if (directLabel) {
    return {
      label: directLabel,
      sourceStatus: undefined,
      fallback: undefined,
    };
  }

  const manualLabel = MANUAL_MOVE_LABELS_JA[move.id];

  if (manualLabel) {
    return {
      label: manualLabel,
      sourceStatus: undefined,
      fallback: undefined,
    };
  }

  if (UNSUPPORTED_MOVE_IDS.has(move.id)) {
    return {
      label: move.showdownName,
      sourceStatus: "unsupported-temporary",
      fallback: {
        reason: move.id === "nomove" ? "showdown-placeholder" : "cap-move-no-japanese-label",
      },
    };
  }

  if (move.showdownName.startsWith("Hidden Power ")) {
    const baseLabel = moveNameMap.get(normalizeLooseKey("Hidden Power")) ?? "めざめるパワー";
    const typeLabel = TYPE_LABELS_JA[move.type] ?? move.type;

    return {
      label: `${baseLabel}(${typeLabel})`,
      sourceStatus: "adapter-temporary",
      fallback: {
        from: "Hidden Power",
        reason: "hidden-power-type-suffix",
      },
    };
  }

  return {
    label: move.showdownName,
    sourceStatus: "needs-confirmation",
    fallback: undefined,
  };
};

const makeMoveOptions = (movesCatalog, moveNameRows) => {
  const moveNameMap = buildLocalizedNameMap(moveNameRows);
  const entries = sortByLabel(
    movesCatalog.entries.map((move) => {
      const localized = inferMoveLabel(move, moveNameMap);

      return withOptional({
        id: move.id,
        label: localized.label,
        showdownName: move.showdownName,
        searchText: makeSearchText([localized.label, move.showdownName, move.id, move.type, move.category]),
        sourceStatus: localized.sourceStatus,
        fallback: localized.fallback,
        type: move.type,
        category: move.category,
        basePower: move.basePower,
        priority: move.priority,
        target: move.target,
        tags: moveTags(move),
        overrideOffensiveStat: move.overrideOffensiveStat,
        overrideDefensiveStat: move.overrideDefensiveStat,
      });
    }),
  );
  const directLocalizedCount = entries.filter((entry) => !entry.sourceStatus).length;
  const adapterTemporaryCount = entries.filter((entry) => entry.sourceStatus === "adapter-temporary").length;
  const unsupportedTemporaryCount = entries.filter((entry) => entry.sourceStatus === "unsupported-temporary").length;

  return makePayload({
    kind: "move-options",
    dataVersion: movesCatalog.dataVersion,
    source: {
      movesCatalog: "src/data/generated/calc-moves.gen.json",
      localizedNames: "../others/pokeranker_SV/data/foreign_move.txt",
      localizedNameSourceAvailable: moveNameRows.length > 0,
      manualLabels: "scripts/generate-battle-options.mjs",
    },
    generatedBy: "scripts/generate-battle-options.mjs",
    entries,
    summary: {
      totalOptions: entries.length,
      localized: directLocalizedCount,
      adapterTemporary: adapterTemporaryCount,
      unsupportedTemporary: unsupportedTemporaryCount,
      englishFallback: entries.length - directLocalizedCount - adapterTemporaryCount - unsupportedTemporaryCount,
      localizedNameSourceEntries: moveNameRows.length,
    },
  });
};

const inferAbilityLabel = (ability, abilityNameMap, pokemonNameMap) => {
  const directLabel = abilityNameMap.get(normalizeLooseKey(ability.showdownName));

  if (directLabel) {
    return {
      label: directLabel,
      sourceStatus: undefined,
      fallback: undefined,
    };
  }

  if (UNSUPPORTED_ABILITY_IDS.has(ability.id)) {
    return {
      label: ability.showdownName,
      sourceStatus: "unsupported-temporary",
      fallback: {
        reason: "cap-ability-no-japanese-label",
      },
    };
  }

  const specialLabel = SPECIAL_ABILITY_LABELS_JA[ability.id];

  if (specialLabel) {
    return {
      label: specialLabel,
      sourceStatus: "adapter-temporary",
      fallback: {
        reason: "special-calc-ability-label",
      },
    };
  }

  const variantMatch = ability.showdownName.match(/^(As One|Embody Aspect) \((.+)\)$/);

  if (variantMatch) {
    const [, baseAbilityName, variantName] = variantMatch;
    const baseLabel =
      abilityNameMap.get(normalizeLooseKey(baseAbilityName)) ??
      ABILITY_VARIANT_BASE_LABELS_JA[normalizeLooseKey(baseAbilityName)];
    const variantLabel =
      pokemonNameMap.get(normalizeLooseKey(variantName)) ??
      EMBODY_ASPECT_FORM_LABELS_JA[variantName] ??
      variantName;

    if (baseLabel) {
      return {
        label: `${baseLabel} (${variantLabel})`,
        sourceStatus: "adapter-temporary",
        fallback: {
          from: baseAbilityName,
          reason: "ability-variant-label",
        },
      };
    }
  }

  return {
    label: ability.showdownName,
    sourceStatus: "needs-confirmation",
    fallback: undefined,
  };
};

const makeChampionsAbilityOption = (entry) =>
  withOptional({
    id: entry.showdownId,
    label: entry.japaneseName,
    showdownName: entry.englishName,
    searchText: makeSearchText([
      entry.japaneseName,
      entry.englishName,
      entry.showdownId,
      "champions",
      "新特性",
    ]),
    sourceStatus: entry.status,
    fallback: {
      reason: "champions-new-ability-calc-unavailable",
    },
    tags: [
      "manual-review",
      entry.affectsDamage ? "damage-modifier" : undefined,
      entry.showdownId === "megasol" ? "weather-modifier" : undefined,
    ].filter(Boolean),
    supportMatrixId: entry.id,
    calcAvailable: entry.calcAvailable,
    affectsDamage: entry.affectsDamage,
  });

const makeAbilityOptions = (abilitiesCatalog, abilityNameRows, pokemonNames, supportMatrix) => {
  const abilityNameMap = buildLocalizedNameMap(abilityNameRows);
  const pokemonNameMap = buildPokemonNameMap(pokemonNames);
  const calcAbilityIds = new Set(abilitiesCatalog.entries.map((ability) => ability.id));
  const championsNewAbilityEntries = supportMatrix.entries.filter(
    (entry) => entry.scope === "champions-new-ability" && entry.showdownId && !calcAbilityIds.has(entry.showdownId),
  );
  const entries = sortByLabel(
    [
      ...abilitiesCatalog.entries.map((ability) => {
        const localized = inferAbilityLabel(ability, abilityNameMap, pokemonNameMap);

        return withOptional({
          id: ability.id,
          label: localized.label,
          showdownName: ability.showdownName,
          searchText: makeSearchText([localized.label, ability.showdownName, ability.id]),
          sourceStatus: localized.sourceStatus,
          fallback: localized.fallback,
          tags: abilityTags(ability),
        });
      }),
      ...championsNewAbilityEntries.map(makeChampionsAbilityOption),
    ],
  );
  const directLocalizedCount = entries.filter((entry) => !entry.sourceStatus).length;
  const adapterTemporaryCount = entries.filter((entry) => entry.sourceStatus === "adapter-temporary").length;
  const unsupportedTemporaryCount = entries.filter((entry) => entry.sourceStatus === "unsupported-temporary").length;
  const needsConfirmationCount = entries.filter((entry) => entry.sourceStatus === "needs-confirmation").length;

  return makePayload({
    kind: "ability-options",
    dataVersion: abilitiesCatalog.dataVersion,
    source: {
      abilitiesCatalog: "src/data/generated/calc-abilities.gen.json",
      localizedNames: "../others/pokeranker_SV/data/foreign_ability.txt",
      localizedNameSourceAvailable: abilityNameRows.length > 0,
      pokemonNames: "others/pokemon-data/POKEMON_ALL.json",
      manualLabels: "scripts/generate-battle-options.mjs",
      championsSupportMatrix: "src/data/champions/champions-support-matrix.json",
    },
    generatedBy: "scripts/generate-battle-options.mjs",
    entries,
    summary: {
      totalOptions: entries.length,
      localized: directLocalizedCount,
      adapterTemporary: adapterTemporaryCount,
      unsupportedTemporary: unsupportedTemporaryCount,
      needsConfirmation: needsConfirmationCount,
      englishFallback: entries.length - directLocalizedCount - adapterTemporaryCount - unsupportedTemporaryCount - needsConfirmationCount,
      localizedNameSourceEntries: abilityNameRows.length,
      championsNewAbilities: championsNewAbilityEntries.length,
    },
  });
};

const makeItemOptions = (itemsCatalog, itemNames, pokemonNames) => {
  const itemNameByEnglish = new Map(
    itemNames.map((item) => [normalizeLooseKey(item.name_en), item]),
  );
  const pokemonNameByEnglish = buildPokemonNameMap(pokemonNames);

  const entries = sortByLabel(
    itemsCatalog.entries.map((item) => {
      const localized = itemNameByEnglish.get(normalizeLooseKey(item.showdownName));
      const manualLabel = localized ? undefined : MANUAL_ITEM_LABELS_JA[item.id];
      const inferredMegaStoneLabel =
        localized || manualLabel || UNSUPPORTED_ITEM_IDS.has(item.id)
          ? undefined
          : inferMegaStoneLabel(item, pokemonNameByEnglish);
      const label = localized?.name_ja ?? manualLabel ?? inferredMegaStoneLabel?.label ?? item.showdownName;
      const sourceStatus = localized || manualLabel
        ? undefined
        : inferredMegaStoneLabel
          ? "adapter-temporary"
          : UNSUPPORTED_ITEM_IDS.has(item.id)
            ? "unsupported-temporary"
            : "needs-confirmation";
      const fallback = inferredMegaStoneLabel
        ? {
            from: inferredMegaStoneLabel.baseSpecies,
            reason: "mega-stone-label-from-pokemon-name",
          }
        : UNSUPPORTED_ITEM_IDS.has(item.id)
          ? {
              reason: "cap-item-no-japanese-label",
            }
          : undefined;

      return withOptional({
        id: item.id,
        label,
        showdownName: item.showdownName,
        searchText: makeSearchText([label, item.showdownName, item.id, inferredMegaStoneLabel?.baseSpecies]),
        sourceStatus,
        fallback,
        tags: itemTags(item),
        megaStone: mapMegaStone(item.megaStone),
        naturalGift: item.naturalGift
          ? {
              type: item.naturalGift.type,
              basePower: item.naturalGift.basePower,
            }
          : undefined,
      });
    }),
  );

  const directLocalizedCount = entries.filter((entry) => !entry.sourceStatus).length;
  const inferredMegaStoneCount = entries.filter((entry) => entry.sourceStatus === "adapter-temporary").length;
  const unsupportedTemporaryCount = entries.filter((entry) => entry.sourceStatus === "unsupported-temporary").length;

  return makePayload({
    kind: "item-options",
    dataVersion: itemsCatalog.dataVersion,
    source: {
      itemsCatalog: "src/data/generated/calc-items.gen.json",
      itemNames: "others/pokemon-data/ITEM_ALL.json",
      pokemonNames: "others/pokemon-data/POKEMON_ALL.json",
      manualLabels: "scripts/generate-battle-options.mjs",
    },
    generatedBy: "scripts/generate-battle-options.mjs",
    entries,
    summary: {
      totalOptions: entries.length,
      localized: directLocalizedCount,
      inferredMegaStoneLabels: inferredMegaStoneCount,
      unsupportedTemporary: unsupportedTemporaryCount,
      englishFallback: entries.length - directLocalizedCount - inferredMegaStoneCount - unsupportedTemporaryCount,
      itemNameSourceEntries: itemNames.length,
      pokemonNameSourceEntries: pokemonNames.length,
    },
  });
};

const makeNatureOptions = (naturesCatalog) => {
  const entries = sortByLabel(
    naturesCatalog.entries.map((nature) => {
      const label = NATURE_LABELS_JA[nature.showdownName] ?? nature.showdownName;

      return withOptional({
        id: nature.id,
        label,
        showdownName: nature.showdownName,
        searchText: makeSearchText([
          label,
          nature.showdownName,
          nature.id,
          nature.plus ? `${STAT_LABELS_JA[nature.plus]}上昇` : undefined,
          nature.minus ? `${STAT_LABELS_JA[nature.minus]}下降` : undefined,
        ]),
        sourceStatus: NATURE_LABELS_JA[nature.showdownName] ? undefined : "needs-confirmation",
        plus: nature.plus,
        minus: nature.minus,
      });
    }),
  );

  const localizedCount = entries.filter((entry) => entry.sourceStatus !== "needs-confirmation").length;

  return makePayload({
    kind: "nature-options",
    dataVersion: naturesCatalog.dataVersion,
    source: {
      naturesCatalog: "src/data/generated/calc-natures.gen.json",
      localizedNames: "scripts/generate-battle-options.mjs",
    },
    generatedBy: "scripts/generate-battle-options.mjs",
    entries,
    summary: {
      totalOptions: entries.length,
      localized: localizedCount,
      englishFallback: entries.length - localizedCount,
    },
  });
};

const makeTypeOptions = (typesCatalog) => {
  const entries = sortByLabel(
    typesCatalog.entries.map((type) => {
      const typeName = type.showdownName;
      const label = TYPE_LABELS_JA[typeName] ?? typeName;

      return withOptional({
        id: type.id || "unknown",
        label,
        showdownName: typeName,
        searchText: makeSearchText([label, typeName, type.id || "unknown"]),
        sourceStatus: TYPE_LABELS_JA[typeName] ? undefined : "needs-confirmation",
        type: typeName,
        color: TYPE_COLORS[typeName] ?? TYPE_COLORS["???"],
      });
    }),
  );

  const localizedCount = entries.filter((entry) => entry.sourceStatus !== "needs-confirmation").length;

  return makePayload({
    kind: "type-options",
    dataVersion: typesCatalog.dataVersion,
    source: {
      typesCatalog: "src/data/generated/calc-types.gen.json",
      localizedNames: "scripts/generate-battle-options.mjs",
    },
    generatedBy: "scripts/generate-battle-options.mjs",
    entries,
    summary: {
      totalOptions: entries.length,
      localized: localizedCount,
      englishFallback: entries.length - localizedCount,
    },
  });
};

const [
  movesCatalog,
  itemsCatalog,
  abilitiesCatalog,
  naturesCatalog,
  typesCatalog,
  supportMatrix,
  itemNames,
  pokemonNames,
  moveNameText,
  abilityNameText,
] =
  await Promise.all([
    readJson(inputPaths.moves),
    readJson(inputPaths.items),
    readJson(inputPaths.abilities),
    readJson(inputPaths.natures),
    readJson(inputPaths.types),
    readJson(inputPaths.supportMatrix),
    readJson(inputPaths.itemNames),
    readJson(inputPaths.pokemonNames),
    readOptionalText(inputPaths.moveNames),
    readOptionalText(inputPaths.abilityNames),
  ]);
const moveNameRows = parseTsv(moveNameText);
const abilityNameRows = parseTsv(abilityNameText);

await mkdir(outputDir, { recursive: true });

const outputs = await Promise.all([
  writeJson(outputPaths.moves, makeMoveOptions(movesCatalog, moveNameRows)),
  writeJson(outputPaths.items, makeItemOptions(itemsCatalog, itemNames, pokemonNames)),
  writeJson(outputPaths.abilities, makeAbilityOptions(abilitiesCatalog, abilityNameRows, pokemonNames, supportMatrix)),
  writeJson(outputPaths.natures, makeNatureOptions(naturesCatalog)),
  writeJson(outputPaths.types, makeTypeOptions(typesCatalog)),
]);

console.log(
  JSON.stringify(
    {
      outputDir: "src/data/generated",
      outputs,
    },
    null,
    2,
  ),
);
