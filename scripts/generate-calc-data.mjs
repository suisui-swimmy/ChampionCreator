import { mkdir, writeFile } from "node:fs/promises";
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
const dataVersion = `calc-${calcPackage.version}-gen${generationNumber}`;

const source = {
  package: calcPackage.name,
  version: calcPackage.version,
  generation: generationNumber,
};

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

const PROJECT_SUPPORTED_EXCEPTION_SPECIES = new Map([
  [
    "garchompmegaz",
    "Project exception: keep Garchomp-Mega-Z available even though special forms are reviewed separately.",
  ],
]);

const sortById = (entries) =>
  entries.sort((a, b) => a.id.localeCompare(b.id, "en"));

const sortedObject = (value) => {
  if (!value) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined && entryValue !== "")
    .sort(([a], [b]) => a.localeCompare(b, "en"));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

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

const makePayload = (kind, entries) => ({
  schemaVersion: 1,
  dataVersion,
  source,
  generatedBy: "scripts/generate-calc-data.mjs",
  kind,
  entries: sortById(entries),
});

const writeJson = async (filename, payload) => {
  const filepath = join(outputDir, filename);
  await writeFile(filepath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return { filename, count: payload.entries.length };
};

const getSpeciesAppSupport = (id) => {
  if (PROJECT_SUPPORTED_EXCEPTION_SPECIES.has(id)) {
    return {
      appSupportStatus: "supported",
      tags: ["project-supported-exception"],
      notes: PROJECT_SUPPORTED_EXCEPTION_SPECIES.get(id),
    };
  }

  if (SHOWDOWN_ORIGINAL_SPECIES_IDS.has(id)) {
    return {
      appSupportStatus: "unsupported-temporary",
      tags: ["showdown-original"],
      notes:
        "Showdown/CAP/original species. Keep out of default UI suggestions unless the user explicitly enables unsupported entries.",
    };
  }

  return {
    appSupportStatus: "supported",
  };
};

const mapSpecies = (species) => {
  const id = species.id || toID(species.name);

  return withOptional({
    ...getSpeciesAppSupport(id),
    id: species.id || toID(species.name),
    showdownName: species.name,
    types: species.types,
    baseStats: species.baseStats,
    weightkg: species.weightkg,
    abilities: sortedObject(species.abilities),
    baseSpecies: species.baseSpecies,
    otherFormes: species.otherFormes,
    nfe: species.nfe,
    gender: species.gender,
    sourceStatus: "supported",
  });
};

const mapMove = (move) =>
  withOptional({
    id: move.id || toID(move.name),
    showdownName: move.name,
    type: move.type,
    category: move.category || "Status",
    basePower: move.basePower,
    target: move.target,
    priority: move.priority || 0,
    flags: sortedObject(move.flags),
    multihit: move.multihit,
    multiaccuracy: move.multiaccuracy,
    recoil: move.recoil,
    drain: move.drain,
    willCrit: move.willCrit,
    hasCrashDamage: move.hasCrashDamage,
    mindBlownRecoil: move.mindBlownRecoil,
    struggleRecoil: move.struggleRecoil,
    ignoreDefensive: move.ignoreDefensive,
    overrideOffensiveStat: move.overrideOffensiveStat,
    overrideDefensiveStat: move.overrideDefensiveStat,
    overrideOffensivePokemon: move.overrideOffensivePokemon,
    overrideDefensivePokemon: move.overrideDefensivePokemon,
    breaksProtect: move.breaksProtect,
    isZ: move.isZ,
    zMoveBasePower: move.zMove?.basePower,
    isMax: move.isMax,
    maxMoveBasePower: move.maxMove?.basePower,
    sourceStatus: "supported",
  });

const mapItem = (item) =>
  withOptional({
    id: item.id || toID(item.name),
    showdownName: item.name,
    isBerry: item.isBerry,
    megaStone: item.megaStone,
    naturalGift: item.naturalGift,
    sourceStatus: "supported",
  });

const mapAbility = (ability) =>
  withOptional({
    id: ability.id || toID(ability.name),
    showdownName: ability.name,
    sourceStatus: "supported",
  });

const mapNature = (nature) =>
  withOptional({
    id: nature.id || toID(nature.name),
    showdownName: nature.name,
    plus: nature.plus,
    minus: nature.minus,
    sourceStatus: "supported",
  });

const mapType = (type) =>
  withOptional({
    id: type.id || toID(type.name),
    showdownName: type.name,
    sourceStatus: "supported",
  });

await mkdir(outputDir, { recursive: true });

const outputs = await Promise.all([
  writeJson(
    "calc-species.gen.json",
    makePayload("species", Array.from(generation.species, mapSpecies)),
  ),
  writeJson(
    "calc-moves.gen.json",
    makePayload("moves", Array.from(generation.moves, mapMove)),
  ),
  writeJson(
    "calc-items.gen.json",
    makePayload("items", Array.from(generation.items, mapItem)),
  ),
  writeJson(
    "calc-abilities.gen.json",
    makePayload("abilities", Array.from(generation.abilities, mapAbility)),
  ),
  writeJson(
    "calc-natures.gen.json",
    makePayload("natures", Array.from(generation.natures, mapNature)),
  ),
  writeJson(
    "calc-types.gen.json",
    makePayload("types", Array.from(generation.types, mapType)),
  ),
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
