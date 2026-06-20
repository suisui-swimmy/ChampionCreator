import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Generations, toID } from "@smogon/calc";

const require = createRequire(import.meta.url);
const calcPackage = require("@smogon/calc/package.json");

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const outputDir = join(projectRoot, "src", "data", "generated");
const generationNumber = 9;
const generation = Generations.get(generationNumber);
const upstreamCommit = "49d4d8696bf138b101cc47be8432489c3ac192aa";
const upstreamCommitShort = upstreamCommit.slice(0, 7);
const dataVersion = `calc-${calcPackage.version}+smogon-${upstreamCommitShort}-gen${generationNumber}`;

const optionPaths = {
  pokemon: join(outputDir, "pokemon-options.gen.json"),
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
  dragonize: "ドラゴンスキン",
  megasol: "メガソーラー",
  piercingdrill: "かんつうドリル",
  spicyspray: "とびだすハバネロ",
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

const SHOWDOWN_ORIGINAL_SPECIES_IDS = new Set([
  "ababo",
  "arghonaut",
  "argalis",
  "astrolotl",
  "aurumoth",
  "brattler",
  "breezi",
  "caimanoe",
  "caribolt",
  "cawdet",
  "cawmodore",
  "chromera",
  "chuggalong",
  "chuggon",
  "colossoil",
  "coribalis",
  "cresceidon",
  "crucibelle",
  "crucibellemega",
  "cupra",
  "cyclohm",
  "dorsoil",
  "draggalong",
  "duohm",
  "electrelk",
  "embirch",
  "equilibra",
  "fawnifer",
  "fidgit",
  "flarelm",
  "floatoy",
  "hemogoblin",
  "jumbao",
  "justyke",
  "kerfluffle",
  "kitsunoh",
  "krilowatt",
  "malaconda",
  "miasmaw",
  "miasmite",
  "mollux",
  "monohm",
  "mumbao",
  "naviathan",
  "necturine",
  "necturna",
  "nohface",
  "obliteryx",
  "pajantom",
  "plasmanta",
  "pluffle",
  "privatyke",
  "protowatt",
  "pyroak",
  "ramnarok",
  "ramnarokradiant",
  "rebble",
  "revenankh",
  "saharaja",
  "saharascal",
  "scattervein",
  "scratchet",
  "shox",
  "smogecko",
  "smoguana",
  "smokomodo",
  "snaelstrom",
  "snugglow",
  "solotl",
  "stratagem",
  "swirlpool",
  "syclant",
  "syclar",
  "tactite",
  "tomohawk",
  "venomicon",
  "venomiconepilogue",
  "voodoll",
  "voodoom",
  "volkraken",
  "volkritter",
]);

const readOptionalJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { entries: [] };
    }
    throw error;
  }
};

const normalizeSearchText = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "");

const normalizeLooseKey = (value) =>
  String(value ?? "")
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

const sortByLabel = (entries) =>
  entries.sort((a, b) => a.label.localeCompare(b.label, "ja") || a.id.localeCompare(b.id, "en"));

const makePayload = ({ kind, entries, summary, source }) => ({
  schemaVersion: 1,
  dataVersion,
  source: {
    packageName: calcPackage.name,
    packageVersion: calcPackage.version,
    upstreamCommit,
    generation: generationNumber,
    previousGeneratedLabels: "src/data/generated",
    ...source,
  },
  generatedBy: "scripts/generate-battle-options.mjs",
  kind,
  entries,
  summary,
});

const writeJson = async (path, payload) => {
  await writeFile(path, `${JSON.stringify(payload)}\n`, "utf8");
  return { output: path.replace(`${projectRoot}\\`, "").replaceAll("\\", "/"), count: payload.entries.length };
};

const byId = (payload) => new Map((payload.entries ?? []).map((entry) => [entry.id, entry]));
const byShowdownName = (payload) => new Map((payload.entries ?? []).map((entry) => [entry.showdownName, entry]));

const previous = {
  pokemon: await readOptionalJson(optionPaths.pokemon),
  moves: await readOptionalJson(optionPaths.moves),
  items: await readOptionalJson(optionPaths.items),
  abilities: await readOptionalJson(optionPaths.abilities),
  natures: await readOptionalJson(optionPaths.natures),
  types: await readOptionalJson(optionPaths.types),
};

const previousById = Object.fromEntries(Object.entries(previous).map(([key, payload]) => [key, byId(payload)]));
const previousByName = Object.fromEntries(Object.entries(previous).map(([key, payload]) => [key, byShowdownName(payload)]));

const previousPokemonLabelByBaseName = new Map();
for (const entry of previous.pokemon.entries ?? []) {
  const baseName = String(entry.showdownName ?? "").split("-")[0];
  if (baseName && !previousPokemonLabelByBaseName.has(baseName)) {
    previousPokemonLabelByBaseName.set(baseName, String(entry.label ?? baseName).split(/\s+/)[0]);
  }
}

const previousPokemonArtworkByBaseName = new Map();
for (const entry of previous.pokemon.entries ?? []) {
  const baseName = String(entry.showdownName ?? "").split("-")[0];
  if (baseName && entry.artwork && !previousPokemonArtworkByBaseName.has(baseName)) {
    previousPokemonArtworkByBaseName.set(baseName, entry.artwork);
  }
}

const getPreviousOption = (kind, id, showdownName) =>
  previousById[kind].get(id) ?? previousByName[kind].get(showdownName);

const inferPokemonLabel = (species, previousOption) => {
  if (previousOption?.label) {
    return {
      label: previousOption.label,
      sourceStatus: previousOption.sourceStatus,
      fallback: previousOption.fallback,
    };
  }

  if (species.name.includes("-Mega")) {
    const baseName = species.baseSpecies ?? species.name.split("-")[0];
    const baseLabel = previousPokemonLabelByBaseName.get(baseName);
    if (baseLabel) {
      return {
        label: `${baseLabel} ${species.name.replace(`${baseName}-`, "")}`,
        sourceStatus: "adapter-temporary",
        fallback: { from: baseName, reason: "form-label-from-base-pokemon" },
      };
    }
  }

  return {
    label: species.name,
    sourceStatus: "needs-confirmation",
  };
};

const inferPokemonArtwork = (species, previousOption) => {
  if (previousOption?.artwork) {
    return previousOption.artwork;
  }
  const baseName = species.baseSpecies ?? species.name.split("-")[0];
  return previousPokemonArtworkByBaseName.get(baseName);
};

const makePokemonOptions = () => {
  const speciesEntries = Array.from(generation.species).filter((species) => (
    !SHOWDOWN_ORIGINAL_SPECIES_IDS.has(toID(species.name))
  ));
  const entries = sortByLabel(
    speciesEntries.map((species) => {
      const id = toID(species.name);
      const previousOption = getPreviousOption("pokemon", id, species.name);
      const localized = inferPokemonLabel(species, previousOption);
      const artwork = inferPokemonArtwork(species, previousOption);

      return withOptional({
        id,
        label: localized.label,
        showdownName: species.name,
        types: species.types,
        searchText: makeSearchText([localized.label, species.name, id]),
        artwork,
        sourceStatus: localized.sourceStatus,
        fallback: localized.fallback,
      });
    }),
  );

  return makePayload({
    kind: "pokemon-options",
    entries,
    source: {
      previousOptions: "src/data/generated/pokemon-options.gen.json",
    },
    summary: {
      totalOptions: entries.length,
      excludedShowdownOriginal: Array.from(generation.species).length - speciesEntries.length,
      withArtwork: entries.filter((entry) => entry.artwork).length,
      previousLocalized: entries.filter((entry) => previousById.pokemon.has(entry.id)).length,
      needsConfirmation: entries.filter((entry) => entry.sourceStatus === "needs-confirmation").length,
      adapterTemporary: entries.filter((entry) => entry.sourceStatus === "adapter-temporary").length,
    },
  });
};

const moveTags = (move) => {
  const tags = [];
  if (move.category === "Status") tags.push("status");
  if ((move.priority ?? 0) !== 0) tags.push("priority");
  if (move.flags?.contact) tags.push("contact");
  if (move.multihit) tags.push("multi-hit");
  if (move.drain) tags.push("drain");
  if (move.recoil || move.mindBlownRecoil || move.struggleRecoil || move.hasCrashDamage) tags.push("recoil");
  if (move.willCrit) tags.push("critical");
  if (move.isZ) tags.push("z-move");
  if (move.isMax) tags.push("max-move");
  if (move.target === "allAdjacent" || move.target === "allAdjacentFoes") tags.push("spread");
  if (move.basePower === 0 && move.category !== "Status") tags.push("fixed-damage");
  return tags;
};

const inferMoveLabel = (move, previousOption) => {
  if (previousOption?.label && previousOption.sourceStatus !== "needs-confirmation") {
    return { label: previousOption.label };
  }
  const manualLabel = MANUAL_MOVE_LABELS_JA[move.id];
  if (manualLabel) {
    return { label: manualLabel };
  }
  if (UNSUPPORTED_MOVE_IDS.has(move.id)) {
    return {
      label: move.name,
      sourceStatus: "unsupported-temporary",
      fallback: { reason: move.id === "nomove" ? "showdown-placeholder" : "cap-move-no-japanese-label" },
    };
  }
  if (move.name.startsWith("Hidden Power ")) {
    const baseLabel = previousById.moves.get("hiddenpower")?.label ?? "めざめるパワー";
    const typeLabel = TYPE_LABELS_JA[move.type] ?? move.type;
    return {
      label: `${baseLabel}(${typeLabel})`,
      sourceStatus: "adapter-temporary",
      fallback: { from: "Hidden Power", reason: "hidden-power-type-suffix" },
    };
  }
  return { label: previousOption?.label ?? move.name, sourceStatus: "needs-confirmation" };
};

const makeMoveOptions = () => {
  const entries = sortByLabel(
    Array.from(generation.moves).map((move) => {
      const id = toID(move.name);
      const previousOption = getPreviousOption("moves", id, move.name);
      const localized = inferMoveLabel(move, previousOption);
      return withOptional({
        id,
        label: localized.label,
        showdownName: move.name,
        searchText: makeSearchText([localized.label, move.name, id, move.type, move.category]),
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

  return makePayload({
    kind: "move-options",
    entries,
    source: {
      previousOptions: "src/data/generated/move-options.gen.json",
      manualLabels: "scripts/generate-battle-options.mjs",
    },
    summary: {
      totalOptions: entries.length,
      localized: entries.filter((entry) => !entry.sourceStatus).length,
      adapterTemporary: entries.filter((entry) => entry.sourceStatus === "adapter-temporary").length,
      unsupportedTemporary: entries.filter((entry) => entry.sourceStatus === "unsupported-temporary").length,
      needsConfirmation: entries.filter((entry) => entry.sourceStatus === "needs-confirmation").length,
      previousLocalized: entries.filter((entry) => previousById.moves.has(entry.id)).length,
    },
  });
};

const mapMegaStone = (megaStone) => {
  if (!megaStone) {
    return undefined;
  }
  const [[baseSpecies, megaSpecies]] = Object.entries(megaStone);
  return { baseSpecies, megaSpecies };
};

const itemTags = (item) => {
  const tags = [];
  const id = item.id || toID(item.name);
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
  ) tags.push("stat-modifier");
  if (["lifeorb", "expertbelt", "muscleband", "wiseglasses", "metronome", "loadeddice", "punchingglove"].includes(id)) {
    tags.push("damage-modifier");
  }
  if (id === "eviolite") tags.push("eviolite-like");
  return tags;
};

const inferMegaStoneLabel = (item) => {
  const megaStone = mapMegaStone(item.megaStone);
  if (!megaStone) {
    return undefined;
  }

  const baseLabel = previousPokemonLabelByBaseName.get(megaStone.baseSpecies) ?? previousPokemonLabelByBaseName.get(megaStone.baseSpecies.split("-")[0]);
  if (!baseLabel) {
    return undefined;
  }
  const suffix = item.name.match(/\s([XYZ])$/)?.[1] ?? "";
  return {
    label: `${baseLabel}ナイト${suffix}`,
    baseSpecies: megaStone.baseSpecies,
  };
};

const inferItemLabel = (item, previousOption) => {
  if (previousOption?.label && previousOption.sourceStatus !== "needs-confirmation") {
    return { label: previousOption.label };
  }
  const id = toID(item.name);
  const manualLabel = MANUAL_ITEM_LABELS_JA[id];
  if (manualLabel) {
    return { label: manualLabel };
  }
  const inferredMegaStoneLabel = UNSUPPORTED_ITEM_IDS.has(id) ? undefined : inferMegaStoneLabel(item);
  if (inferredMegaStoneLabel) {
    return {
      label: inferredMegaStoneLabel.label,
      sourceStatus: "adapter-temporary",
      fallback: {
        from: inferredMegaStoneLabel.baseSpecies,
        reason: "mega-stone-label-from-pokemon-name",
      },
    };
  }
  if (UNSUPPORTED_ITEM_IDS.has(id)) {
    return {
      label: item.name,
      sourceStatus: "unsupported-temporary",
      fallback: { reason: "cap-item-no-japanese-label" },
    };
  }
  return { label: previousOption?.label ?? item.name, sourceStatus: "needs-confirmation" };
};

const makeItemOptions = () => {
  const entries = sortByLabel(
    Array.from(generation.items).map((item) => {
      const id = toID(item.name);
      const previousOption = getPreviousOption("items", id, item.name);
      const localized = inferItemLabel(item, previousOption);
      const megaStone = mapMegaStone(item.megaStone);
      return withOptional({
        id,
        label: localized.label,
        showdownName: item.name,
        searchText: makeSearchText([localized.label, item.name, id, megaStone?.baseSpecies]),
        sourceStatus: localized.sourceStatus,
        fallback: localized.fallback,
        tags: itemTags(item),
        megaStone,
        naturalGift: item.naturalGift
          ? {
              type: item.naturalGift.type,
              basePower: item.naturalGift.basePower,
            }
          : undefined,
      });
    }),
  );

  return makePayload({
    kind: "item-options",
    entries,
    source: {
      previousOptions: "src/data/generated/item-options.gen.json",
      manualLabels: "scripts/generate-battle-options.mjs",
    },
    summary: {
      totalOptions: entries.length,
      localized: entries.filter((entry) => !entry.sourceStatus).length,
      adapterTemporary: entries.filter((entry) => entry.sourceStatus === "adapter-temporary").length,
      unsupportedTemporary: entries.filter((entry) => entry.sourceStatus === "unsupported-temporary").length,
      needsConfirmation: entries.filter((entry) => entry.sourceStatus === "needs-confirmation").length,
      previousLocalized: entries.filter((entry) => previousById.items.has(entry.id)).length,
    },
  });
};

const abilityTags = (ability) => {
  const tags = [];
  const id = ability.id || toID(ability.name);
  if (
    [
      "adaptability",
      "aerilate",
      "analytic",
      "beadsofruin",
      "blaze",
      "darkaura",
      "dragonize",
      "dragonsmaw",
      "fairyaura",
      "firemane",
      "flashfire",
      "guts",
      "hadronengine",
      "hugepower",
      "hustle",
      "intrepidsword",
      "ironfist",
      "megalauncher",
      "megasol",
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
  ) tags.push("damage-modifier");
  if (["drought", "drizzle", "megasol", "sandstream", "snowwarning", "airlock", "cloudnine"].includes(id)) tags.push("weather-modifier");
  if (["electricsurge", "grassysurge", "mistysurge", "psychicsurge"].includes(id)) tags.push("field-modifier");
  if (["levitate", "eelevate", "flashfire", "sapsipper", "voltabsorb", "waterabsorb", "stormdrain", "dryskin", "eartheater"].includes(id)) {
    tags.push("immunity");
  }
  if (["intimidate", "defiant", "competitive", "protosynthesis", "quarkdrive", "supremeoverlord"].includes(id)) tags.push("stat-modifier");
  if (["battlebond", "commander", "forecast", "multitype", "powerconstruct", "schooling", "stancechange", "zenmode"].includes(id)) {
    tags.push("form-change", "manual-review");
  }
  return tags;
};

const inferAbilityLabel = (ability, previousOption) => {
  if (previousOption?.label && previousOption.sourceStatus !== "needs-confirmation") {
    return { label: previousOption.label };
  }
  const id = toID(ability.name);
  if (UNSUPPORTED_ABILITY_IDS.has(id)) {
    return {
      label: ability.name,
      sourceStatus: "unsupported-temporary",
      fallback: { reason: "cap-ability-no-japanese-label" },
    };
  }
  const specialLabel = SPECIAL_ABILITY_LABELS_JA[id];
  if (specialLabel) {
    return { label: specialLabel };
  }
  const variantMatch = ability.name.match(/^(As One|Embody Aspect) \((.+)\)$/);
  if (variantMatch) {
    const [, baseAbilityName, variantName] = variantMatch;
    const baseLabel =
      previousById.abilities.get(toID(baseAbilityName))?.label ??
      ABILITY_VARIANT_BASE_LABELS_JA[normalizeLooseKey(baseAbilityName)];
    const variantLabel = previousPokemonLabelByBaseName.get(variantName) ?? EMBODY_ASPECT_FORM_LABELS_JA[variantName] ?? variantName;
    if (baseLabel) {
      return {
        label: `${baseLabel} (${variantLabel})`,
        sourceStatus: "adapter-temporary",
        fallback: { from: baseAbilityName, reason: "ability-variant-label" },
      };
    }
  }
  return { label: previousOption?.label ?? ability.name, sourceStatus: "needs-confirmation" };
};

const makeAbilityOptions = () => {
  const entries = sortByLabel(
    Array.from(generation.abilities).map((ability) => {
      const id = toID(ability.name);
      const previousOption = getPreviousOption("abilities", id, ability.name);
      const localized = inferAbilityLabel(ability, previousOption);
      return withOptional({
        id,
        label: localized.label,
        showdownName: ability.name,
        searchText: makeSearchText([localized.label, ability.name, id, "champions"]),
        sourceStatus: localized.sourceStatus,
        fallback: localized.fallback,
        tags: abilityTags(ability),
      });
    }),
  );

  return makePayload({
    kind: "ability-options",
    entries,
    source: {
      previousOptions: "src/data/generated/ability-options.gen.json",
      manualLabels: "scripts/generate-battle-options.mjs",
    },
    summary: {
      totalOptions: entries.length,
      localized: entries.filter((entry) => !entry.sourceStatus).length,
      adapterTemporary: entries.filter((entry) => entry.sourceStatus === "adapter-temporary").length,
      unsupportedTemporary: entries.filter((entry) => entry.sourceStatus === "unsupported-temporary").length,
      needsConfirmation: entries.filter((entry) => entry.sourceStatus === "needs-confirmation").length,
      previousLocalized: entries.filter((entry) => previousById.abilities.has(entry.id)).length,
      championsNewAbilitiesNowInCalc: ["dragonize", "eelevate", "firemane", "megasol", "piercingdrill", "spicyspray"].filter((id) =>
        entries.some((entry) => entry.id === id),
      ).length,
    },
  });
};

const makeNatureOptions = () => {
  const entries = sortByLabel(
    Array.from(generation.natures).map((nature) => {
      const id = toID(nature.name);
      const label = NATURE_LABELS_JA[nature.name] ?? nature.name;
      return withOptional({
        id,
        label,
        showdownName: nature.name,
        searchText: makeSearchText([
          label,
          nature.name,
          id,
          nature.plus ? `${STAT_LABELS_JA[nature.plus]}上昇` : undefined,
          nature.minus ? `${STAT_LABELS_JA[nature.minus]}下降` : undefined,
        ]),
        sourceStatus: NATURE_LABELS_JA[nature.name] ? undefined : "needs-confirmation",
        plus: nature.plus,
        minus: nature.minus,
      });
    }),
  );

  return makePayload({
    kind: "nature-options",
    entries,
    source: { manualLabels: "scripts/generate-battle-options.mjs" },
    summary: {
      totalOptions: entries.length,
      localized: entries.filter((entry) => !entry.sourceStatus).length,
      needsConfirmation: entries.filter((entry) => entry.sourceStatus === "needs-confirmation").length,
    },
  });
};

const makeTypeOptions = () => {
  const entries = sortByLabel(
    Array.from(generation.types).map((type) => {
      const id = type.id || toID(type.name) || "unknown";
      const label = TYPE_LABELS_JA[type.name] ?? type.name;
      return withOptional({
        id,
        label,
        showdownName: type.name,
        searchText: makeSearchText([label, type.name, id]),
        sourceStatus: TYPE_LABELS_JA[type.name] ? undefined : "needs-confirmation",
        type: type.name,
        color: TYPE_COLORS[type.name] ?? TYPE_COLORS["???"],
      });
    }),
  );

  return makePayload({
    kind: "type-options",
    entries,
    source: { manualLabels: "scripts/generate-battle-options.mjs" },
    summary: {
      totalOptions: entries.length,
      localized: entries.filter((entry) => !entry.sourceStatus).length,
      needsConfirmation: entries.filter((entry) => entry.sourceStatus === "needs-confirmation").length,
    },
  });
};

await mkdir(outputDir, { recursive: true });

const outputs = await Promise.all([
  writeJson(optionPaths.pokemon, makePokemonOptions()),
  writeJson(optionPaths.moves, makeMoveOptions()),
  writeJson(optionPaths.items, makeItemOptions()),
  writeJson(optionPaths.abilities, makeAbilityOptions()),
  writeJson(optionPaths.natures, makeNatureOptions()),
  writeJson(optionPaths.types, makeTypeOptions()),
]);

console.log(
  JSON.stringify(
    {
      dataVersion,
      outputDir: "src/data/generated",
      outputs,
    },
    null,
    2,
  ),
);
