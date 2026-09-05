import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  calculate,
  Field,
  Generations,
  Move,
  Pokemon,
  toID,
} from "@smogon/calc";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

const errors = [];
const assert = (condition, message) => {
  if (!condition) {
    errors.push(message);
  }
};

const calcPackage = await readJson("node_modules/@smogon/calc/package.json");
const projectPackage = await readJson("package.json");
const packageLock = await readJson("package-lock.json");
const provenance = await readJson("vendor/smogon-calc-cc-aura-guard-v1.json");
const pokemonOptions = await readJson("src/data/generated/pokemon-options.gen.json");
const moveOptions = await readJson("src/data/generated/move-options.gen.json");
const itemOptions = await readJson("src/data/generated/item-options.gen.json");
const abilityOptions = await readJson("src/data/generated/ability-options.gen.json");
const natureOptions = await readJson("src/data/generated/nature-options.gen.json");
const typeOptions = await readJson("src/data/generated/type-options.gen.json");
const pokemonAbilities = await readJson("src/data/generated/pokemon-abilities.gen.json");
const megaAbilityManifest = await readJson("src/data/overrides/mega-ability-manifest.json");
const gen = Generations.get(9);

const AURA_GUARD = "Aura Guard";
const expectedFileDependency = `file:${provenance.artifact.path}`;
const expectedDataVersion = `calc-${provenance.packageVersion}+smogon-${provenance.upstreamBaseCommit.slice(0, 7)}-${provenance.patchId}-gen9`;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const sha512Integrity = (buffer) => `sha512-${createHash("sha512").update(buffer).digest("base64")}`;

assert(provenance.schemaVersion === 1, "Calc compatibility provenance must use schemaVersion 1");
assert(
  provenance.kind === "smogon-calc-compatibility-build",
  "Calc compatibility provenance kind mismatch",
);
assert(calcPackage.name === provenance.packageName, "Installed Calc package name does not match provenance");
assert(calcPackage.version === provenance.packageVersion, "Installed Calc version does not match provenance");
assert(
  megaAbilityManifest.source?.calcBase === provenance.upstreamBaseCommit,
  "Mega ability manifest Calc base does not match compatibility provenance",
);
const megaManifestReferenceCommits = new Set(
  (megaAbilityManifest.source?.references ?? []).map((reference) => reference.commit),
);
assert(
  megaManifestReferenceCommits.has(provenance.sourcePullRequestHead),
  "Mega ability manifest is missing the damage-calc PR reference commit",
);
assert(
  megaManifestReferenceCommits.has(provenance.showdownReferenceCommit),
  "Mega ability manifest is missing the Pokemon Showdown reference commit",
);
assert(
  projectPackage.dependencies?.["@smogon/calc"] === expectedFileDependency,
  "package.json Calc dependency does not match the provenance artifact",
);
assert(
  packageLock.packages?.[""]?.dependencies?.["@smogon/calc"] === expectedFileDependency,
  "package-lock root Calc dependency does not match the provenance artifact",
);
const lockedCalc = packageLock.packages?.["node_modules/@smogon/calc"];
assert(lockedCalc?.resolved === expectedFileDependency, "package-lock Calc resolution mismatch");
assert(lockedCalc?.integrity === provenance.artifact.integrity, "package-lock Calc integrity mismatch");

const patchBuffer = await readFile(provenance.patchFile);
const artifactBuffer = await readFile(provenance.artifact.path);
assert(sha256(patchBuffer) === provenance.patchSha256, "Tracked Calc patch hash mismatch");
assert(sha256(artifactBuffer) === provenance.artifact.sha256, "Tracked Calc artifact SHA-256 mismatch");
assert(
  sha512Integrity(artifactBuffer) === provenance.artifact.integrity,
  "Tracked Calc artifact integrity mismatch",
);

for (const payload of [
  pokemonOptions,
  moveOptions,
  itemOptions,
  abilityOptions,
  natureOptions,
  typeOptions,
  pokemonAbilities,
]) {
  assert(payload.dataVersion === expectedDataVersion, `${payload.kind} dataVersion mismatch`);
  assert(
    payload.source?.upstreamCommit === provenance.upstreamBaseCommit,
    `${payload.kind} upstream commit mismatch`,
  );
  assert(
    payload.source?.compatibilityPatchId === provenance.patchId,
    `${payload.kind} compatibility patch id mismatch`,
  );
}

const auraGuardOption = abilityOptions.entries.find((entry) => entry.id === "auraguard");
assert(auraGuardOption?.showdownName === AURA_GUARD, "Aura Guard ability option canonical mismatch");
assert(auraGuardOption?.label === "はどうのぼうご", "Aura Guard Japanese label mismatch");
assert(auraGuardOption?.tags?.includes("damage-modifier"), "Aura Guard must be tagged as a damage modifier");

const expectedMegaSpeciesAbilities = {
  "Absol-Mega-Z": "Sharpness",
  "Garchomp-Mega-Z": "Levitate",
  "Lucario-Mega-Z": AURA_GUARD,
};

const expectedMoves = {
  Tackle: { category: "Physical", type: "Normal", contact: true },
  Earthquake: { category: "Physical", type: "Ground", contact: false },
  "Draining Kiss": { category: "Special", type: "Fairy", contact: true },
  "Shadow Ball": { category: "Special", type: "Ghost", contact: false },
  "Fire Punch": { category: "Physical", type: "Fire", contact: true, punch: true },
  Flamethrower: { category: "Special", type: "Fire", contact: false },
  "Drain Punch": { category: "Physical", type: "Fighting", contact: true, punch: true },
  "Bullet Seed": { category: "Physical", type: "Grass", contact: false },
  "Comet Punch": { category: "Physical", type: "Normal", contact: true, punch: true },
  "Sunsteel Strike": { category: "Physical", type: "Steel", contact: true },
};

const getCatalogAbility = (name) => gen.abilities.get(toID(name));
const getCatalogItem = (name) => gen.items.get(toID(name));
const getCatalogMove = (name) => gen.moves.get(toID(name));
const getCatalogSpecies = (name) => gen.species.get(toID(name));

assert(
  getCatalogAbility(AURA_GUARD)?.name === AURA_GUARD,
  `Gen9 ability catalog is missing ${AURA_GUARD}`,
);

for (const [speciesName, abilityName] of Object.entries(expectedMegaSpeciesAbilities)) {
  const species = getCatalogSpecies(speciesName);
  assert(species, `Gen9 species catalog is missing ${speciesName}`);
  assert(
    Object.values(species?.abilities ?? {}).includes(abilityName),
    `${speciesName} must include ${abilityName} in its @smogon/calc ability catalog`,
  );
}

for (const [moveName, expected] of Object.entries(expectedMoves)) {
  const move = getCatalogMove(moveName);
  assert(move, `Gen9 move catalog is missing ${moveName}`);
  assert(move?.category === expected.category, `${moveName} must be ${expected.category}`);
  assert(move?.type === expected.type, `${moveName} must be ${expected.type}-type`);
  assert(Boolean(move?.flags?.contact) === expected.contact, `${moveName} contact flag mismatch`);
  if (expected.punch !== undefined) {
    assert(Boolean(move?.flags?.punch) === expected.punch, `${moveName} punch flag mismatch`);
  }
}

for (const itemName of ["Ability Shield", "Punching Glove"]) {
  assert(getCatalogItem(itemName)?.name === itemName, `Gen9 item catalog is missing ${itemName}`);
}

const defaultIvs = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const makePokemon = ({
  ability,
  item,
  evs = {},
  ivs = defaultIvs,
  level = 100,
  nature = "Hardy",
  pokemon = "Mew",
} = {}) => new Pokemon(gen, pokemon, {
  level,
  nature,
  ivs,
  evs: {
    hp: 252,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
    ...evs,
  },
  ...(ability ? { ability } : {}),
  ...(item ? { item } : {}),
});

const runCalculation = ({ moveName, attacker = {}, defender = {}, critical = false, hits } = {}) => {
  const moveOptions = {
    isCrit: critical,
    ...(hits === undefined ? {} : { hits }),
  };
  return calculate(
    gen,
    makePokemon(attacker),
    makePokemon(defender),
    new Move(gen, moveName, moveOptions),
    new Field({ gameType: "Singles" }),
  );
};

const flattenDamage = (damage) => (
  Array.isArray(damage) ? damage.flat(Number.POSITIVE_INFINITY) : [damage]
);

const sameDamage = (left, right) => (
  JSON.stringify(flattenDamage(left.damage)) === JSON.stringify(flattenDamage(right.damage))
);

const maxDamage = (result) => Math.max(...flattenDamage(result.damage));
const assertRange = (result, expected, label) => {
  assert(
    JSON.stringify(result.range()) === JSON.stringify(expected),
    `${label} range mismatch: ${result.range().join("-")} != ${expected.join("-")}`,
  );
};

const baselinePhysicalAttacker = { evs: { atk: 252 } };
const baselineSpecialAttacker = { evs: { spa: 252 } };
const auraGuardDefender = { ability: AURA_GUARD };

const baselineTackle = runCalculation({
  moveName: "Tackle",
  attacker: baselinePhysicalAttacker,
});
const auraGuardTackle = runCalculation({
  moveName: "Tackle",
  attacker: baselinePhysicalAttacker,
  defender: auraGuardDefender,
});
// Frozen against damage-calc PR #855 placement plus Pokemon Showdown #12275 semantics.
assertRange(baselineTackle, [37, 44], "Tackle baseline fixture");
assertRange(auraGuardTackle, [18, 22], "Aura Guard Tackle fixture");
assert(
  maxDamage(auraGuardTackle) < maxDamage(baselineTackle),
  `${AURA_GUARD} must halve physical contact damage`,
);
const fluffyTackle = runCalculation({
  moveName: "Tackle",
  attacker: baselinePhysicalAttacker,
  defender: { ability: "Fluffy" },
});
assert(
  sameDamage(auraGuardTackle, fluffyTackle),
  `${AURA_GUARD} must match Fluffy's contact-only modifier for non-Fire moves`,
);

const baselineEarthquake = runCalculation({
  moveName: "Earthquake",
  attacker: baselinePhysicalAttacker,
});
const auraGuardEarthquake = runCalculation({
  moveName: "Earthquake",
  attacker: baselinePhysicalAttacker,
  defender: auraGuardDefender,
});
assertRange(baselineEarthquake, [91, 108], "Earthquake baseline fixture");
assertRange(auraGuardEarthquake, [91, 108], "Aura Guard Earthquake fixture");
assert(
  sameDamage(auraGuardEarthquake, baselineEarthquake),
  `${AURA_GUARD} must not affect physical non-contact damage`,
);

const baselineDrainingKiss = runCalculation({
  moveName: "Draining Kiss",
  attacker: baselineSpecialAttacker,
});
const auraGuardDrainingKiss = runCalculation({
  moveName: "Draining Kiss",
  attacker: baselineSpecialAttacker,
  defender: auraGuardDefender,
});
assertRange(baselineDrainingKiss, [46, 55], "Draining Kiss baseline fixture");
assertRange(auraGuardDrainingKiss, [23, 27], "Aura Guard Draining Kiss fixture");
assert(
  maxDamage(auraGuardDrainingKiss) < maxDamage(baselineDrainingKiss),
  `${AURA_GUARD} must halve special contact damage`,
);

const baselineShadowBall = runCalculation({
  moveName: "Shadow Ball",
  attacker: baselineSpecialAttacker,
});
const auraGuardShadowBall = runCalculation({
  moveName: "Shadow Ball",
  attacker: baselineSpecialAttacker,
  defender: auraGuardDefender,
});
assert(
  sameDamage(auraGuardShadowBall, baselineShadowBall),
  `${AURA_GUARD} must not affect special non-contact damage`,
);

const longReachTackle = runCalculation({
  moveName: "Tackle",
  attacker: { ...baselinePhysicalAttacker, ability: "Long Reach" },
  defender: auraGuardDefender,
});
assert(
  sameDamage(longReachTackle, baselineTackle),
  `Long Reach must bypass contact-based ${AURA_GUARD}`,
);

const punchingGloveBaseline = runCalculation({
  moveName: "Drain Punch",
  attacker: { ...baselinePhysicalAttacker, item: "Punching Glove" },
});
const punchingGloveAuraGuard = runCalculation({
  moveName: "Drain Punch",
  attacker: { ...baselinePhysicalAttacker, item: "Punching Glove" },
  defender: auraGuardDefender,
});
assert(
  sameDamage(punchingGloveAuraGuard, punchingGloveBaseline),
  `Punching Glove must bypass contact-based ${AURA_GUARD}`,
);

const baselineFlamethrower = runCalculation({
  moveName: "Flamethrower",
  attacker: baselineSpecialAttacker,
});
const auraGuardFlamethrower = runCalculation({
  moveName: "Flamethrower",
  attacker: baselineSpecialAttacker,
  defender: auraGuardDefender,
});
const fluffyFlamethrower = runCalculation({
  moveName: "Flamethrower",
  attacker: baselineSpecialAttacker,
  defender: { ability: "Fluffy" },
});
assert(
  sameDamage(auraGuardFlamethrower, baselineFlamethrower),
  `${AURA_GUARD} must not inherit Fluffy's Fire weakness`,
);
assert(
  maxDamage(fluffyFlamethrower) > maxDamage(baselineFlamethrower),
  `Fluffy must retain its Fire-damage increase`,
);

const baselineFirePunch = runCalculation({
  moveName: "Fire Punch",
  attacker: baselinePhysicalAttacker,
});
const auraGuardFirePunch = runCalculation({
  moveName: "Fire Punch",
  attacker: baselinePhysicalAttacker,
  defender: auraGuardDefender,
});
const fluffyFirePunch = runCalculation({
  moveName: "Fire Punch",
  attacker: baselinePhysicalAttacker,
  defender: { ability: "Fluffy" },
});
assertRange(baselineFirePunch, [68, 81], "Fire Punch baseline fixture");
assertRange(auraGuardFirePunch, [34, 40], "Aura Guard Fire Punch fixture");
assertRange(fluffyFirePunch, [68, 81], "Fluffy Fire Punch fixture");
assert(
  maxDamage(auraGuardFirePunch) < maxDamage(baselineFirePunch),
  `${AURA_GUARD} must halve contact Fire damage without inheriting Fluffy's weakness`,
);
assert(
  sameDamage(fluffyFirePunch, baselineFirePunch),
  "Fluffy contact reduction and Fire weakness must cancel for contact Fire damage",
);

for (const abilityName of ["Mold Breaker", "Teravolt", "Turboblaze"]) {
  const suppressed = runCalculation({
    moveName: "Tackle",
    attacker: { ...baselinePhysicalAttacker, ability: abilityName },
    defender: auraGuardDefender,
  });
  assert(
    sameDamage(suppressed, baselineTackle),
    `${abilityName} must suppress ${AURA_GUARD}`,
  );

  const abilityShieldProtected = runCalculation({
    moveName: "Tackle",
    attacker: { ...baselinePhysicalAttacker, ability: abilityName },
    defender: { ...auraGuardDefender, item: "Ability Shield" },
  });
  assert(
    sameDamage(abilityShieldProtected, auraGuardTackle),
    `Ability Shield must protect ${AURA_GUARD} from ${abilityName}`,
  );
}

const baselineSunsteelStrike = runCalculation({
  moveName: "Sunsteel Strike",
  attacker: baselinePhysicalAttacker,
});
const auraGuardSunsteelStrike = runCalculation({
  moveName: "Sunsteel Strike",
  attacker: baselinePhysicalAttacker,
  defender: auraGuardDefender,
});
assert(
  sameDamage(auraGuardSunsteelStrike, baselineSunsteelStrike),
  `Sunsteel Strike must suppress ${AURA_GUARD} when it ignores abilities`,
);

const neutralizingGasAuraGuard = runCalculation({
  moveName: "Tackle",
  attacker: { ...baselinePhysicalAttacker, ability: "Neutralizing Gas" },
  defender: auraGuardDefender,
});
assert(
  sameDamage(neutralizingGasAuraGuard, baselineTackle),
  `Neutralizing Gas must suppress ${AURA_GUARD}`,
);

const neutralizingGasShieldProtected = runCalculation({
  moveName: "Tackle",
  attacker: { ...baselinePhysicalAttacker, ability: "Neutralizing Gas" },
  defender: { ...auraGuardDefender, item: "Ability Shield" },
});
assert(
  sameDamage(neutralizingGasShieldProtected, auraGuardTackle),
  `Ability Shield must protect ${AURA_GUARD} from Neutralizing Gas`,
);

const baselineCriticalTackle = runCalculation({
  moveName: "Tackle",
  attacker: baselinePhysicalAttacker,
  critical: true,
});
const auraGuardCriticalTackle = runCalculation({
  moveName: "Tackle",
  attacker: baselinePhysicalAttacker,
  defender: auraGuardDefender,
  critical: true,
});
assert(
  maxDamage(auraGuardCriticalTackle) < maxDamage(baselineCriticalTackle),
  `${AURA_GUARD} must apply to critical contact damage`,
);

const minimumDamageResult = calculate(
  gen,
  makePokemon({
    level: 1,
    nature: "Modest",
    ivs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  }),
  makePokemon({
    pokemon: "Shuckle",
    ability: AURA_GUARD,
    evs: { def: 252 },
  }),
  new Move(gen, "Tackle"),
  new Field({ gameType: "Singles" }),
);
assert(
  JSON.stringify(minimumDamageResult.range()) === JSON.stringify([1, 1]),
  `${AURA_GUARD} must preserve the one-HP minimum damage boundary`,
);

const baselineCometPunch = runCalculation({
  moveName: "Comet Punch",
  attacker: baselinePhysicalAttacker,
  hits: 5,
});
const auraGuardCometPunch = runCalculation({
  moveName: "Comet Punch",
  attacker: baselinePhysicalAttacker,
  defender: auraGuardDefender,
  hits: 5,
});
const baselineCometPunchByHit = baselineCometPunch.damage;
const auraGuardCometPunchByHit = auraGuardCometPunch.damage;
assert(
  Array.isArray(baselineCometPunchByHit)
    && baselineCometPunchByHit.length === 5
    && baselineCometPunchByHit.every((rolls) => Array.isArray(rolls) && rolls.length > 0),
  "Comet Punch must expose five per-hit damage arrays",
);
assert(
    Array.isArray(auraGuardCometPunchByHit)
      && auraGuardCometPunchByHit.length === 5
      && auraGuardCometPunchByHit.every((rolls) => Array.isArray(rolls) && rolls.length > 0),
  `${AURA_GUARD} Comet Punch result must preserve five per-hit arrays`,
);
if (
  Array.isArray(baselineCometPunchByHit)
  && Array.isArray(auraGuardCometPunchByHit)
  && baselineCometPunchByHit.length === auraGuardCometPunchByHit.length
) {
  for (let index = 0; index < baselineCometPunchByHit.length; index += 1) {
    const baselineHit = baselineCometPunchByHit[index];
    const auraGuardHit = auraGuardCometPunchByHit[index];
    assert(
      Array.isArray(baselineHit)
        && Array.isArray(auraGuardHit)
        && Math.max(...baselineHit) > Math.max(...auraGuardHit),
      `${AURA_GUARD} must apply to Comet Punch hit ${index + 1}`,
    );
  }
}

if (errors.length > 0) {
  console.error(`[smogon-calc-compat] ${calcPackage.version} validation failed:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(`[smogon-calc-compat] ${calcPackage.version} Aura Guard compatibility validation passed.`);
}
