import { createRequire } from "node:module";
import {
  Field,
  Generations,
  Move,
  Pokemon,
  calculate,
  toID,
} from "@smogon/calc";

const require = createRequire(import.meta.url);
const calcPackage = require("@smogon/calc/package.json");

const gen = Generations.get(9);

const sample = (iterable, limit = 5) =>
  Array.from(iterable)
    .slice(0, limit)
    .map((entry) => entry.name);

const counts = {
  species: Array.from(gen.species).length,
  moves: Array.from(gen.moves).length,
  abilities: Array.from(gen.abilities).length,
  items: Array.from(gen.items).length,
  natures: Array.from(gen.natures).length,
  types: Array.from(gen.types).length,
};

const attacker = new Pokemon(gen, "Garchomp", {
  level: 50,
  nature: "Adamant",
  evs: { atk: 252 },
  boosts: { atk: 1 },
  item: "Choice Band",
});

const defender = new Pokemon(gen, "Pikachu", {
  level: 50,
  evs: { hp: 252 },
});

const move = new Move(gen, "Earthquake");
const field = new Field({
  gameType: "Doubles",
  weather: "Rain",
  terrain: "Electric",
  defenderSide: {
    isReflect: true,
    isLightScreen: false,
  },
});

const result = calculate(gen, attacker, defender, move, field);

const report = {
  package: {
    name: calcPackage.name,
    version: calcPackage.version,
    license: calcPackage.license,
    repository: calcPackage.repository,
  },
  exportedApiChecked: [
    "Generations",
    "Pokemon",
    "Move",
    "Field",
    "calculate",
    "toID",
  ],
  generation: {
    num: gen.num,
    counts,
    sample: {
      species: sample(gen.species),
      moves: sample(gen.moves),
      abilities: sample(gen.abilities),
      items: sample(gen.items),
      natures: sample(gen.natures),
      types: sample(gen.types),
    },
  },
  lookupExamples: {
    pokemon: {
      input: "Garchomp",
      id: toID("Garchomp"),
      found: gen.species.get(toID("Garchomp")),
    },
    move: {
      input: "Earthquake",
      id: toID("Earthquake"),
      found: gen.moves.get(toID("Earthquake")),
    },
    item: {
      input: "Choice Band",
      id: toID("Choice Band"),
      found: gen.items.get(toID("Choice Band")),
    },
    nature: {
      input: "Adamant",
      id: toID("Adamant"),
      found: gen.natures.get(toID("Adamant")),
    },
  },
  fieldShapeSmoke: {
    gameType: field.gameType,
    weather: field.weather,
    terrain: field.terrain,
    defenderSide: {
      isReflect: field.defenderSide.isReflect,
      isLightScreen: field.defenderSide.isLightScreen,
    },
  },
  calculationSmoke: {
    attacker: {
      name: attacker.name,
      level: attacker.level,
      nature: attacker.nature,
      item: attacker.item,
      evs: attacker.evs,
      boosts: attacker.boosts,
      stats: attacker.stats,
    },
    defender: {
      name: defender.name,
      level: defender.level,
      evs: defender.evs,
      stats: defender.stats,
    },
    move: {
      name: move.name,
      type: move.type,
      category: move.category,
      bp: move.bp,
      target: move.target,
    },
    damage: result.damage,
    damageRange: result.range(),
    description: result.desc(),
  },
  nextAdapterNotes: [
    "Use Showdown names/IDs as the calc-facing canonical keys.",
    "Keep Champions SP -> EV-compatible conversion outside UI and search code.",
    "Pass weather, terrain, screens, boosts, item, ability, teraType, and move overrides through a thin adapter.",
    "Do not copy type charts, damage rolls, or move power logic into app data.",
  ],
};

console.log(JSON.stringify(report, null, 2));
