import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(projectRoot, "vendor", "smogon-calc-compat.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const supportedArgs = new Set(["--verify"]);
const unknownArgs = process.argv.slice(2).filter((argument) => !supportedArgs.has(argument));
if (unknownArgs.length > 0) {
  throw new Error(`Unknown arguments: ${unknownArgs.join(", ")}`);
}
const verifyOnly = process.argv.includes("--verify");

const patches = manifest.patches ?? [{ id: manifest.patchId, path: manifest.patchFile, sha256: manifest.patchSha256 }];
const artifactPath = join(projectRoot, manifest.artifact.path);

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
};

const npmInvocation = (args) => {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
    };
  }
  return { command: "npm", args };
};

const runNpm = (args, cwd) => {
  const invocation = npmInvocation(args);
  run(invocation.command, invocation.args, cwd);
};

const readNpmVersion = () => {
  const invocation = npmInvocation(["--version"]);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: projectRoot,
    encoding: "utf8",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`Unable to read npm version: ${result.stderr}`);
  }
  return result.stdout.trim();
};

const hashBuffer = (buffer, algorithm, encoding) => (
  createHash(algorithm).update(buffer).digest(encoding)
);

if (process.versions.node !== manifest.buildEnvironment.node) {
  throw new Error(
    `Node ${manifest.buildEnvironment.node} is required; found ${process.versions.node}`,
  );
}
const npmVersion = readNpmVersion();
if (npmVersion !== manifest.buildEnvironment.npm) {
  throw new Error(`npm ${manifest.buildEnvironment.npm} is required; found ${npmVersion}`);
}

const temporaryRoot = await mkdtemp(join(tmpdir(), "championcreator-smogon-calc-"));
try {
  for (const patch of patches) {
    const patchBuffer = await readFile(join(projectRoot, patch.path));
    if (hashBuffer(patchBuffer, "sha256", "hex") !== patch.sha256) {
      throw new Error(`Compatibility patch hash mismatch: ${patch.path}`);
    }
  }

  const checkoutPath = join(temporaryRoot, "damage-calc");
  const packOutputPath = join(temporaryRoot, "pack");
  await mkdir(packOutputPath, { recursive: true });

  run("git", ["clone", "--filter=blob:none", "--no-checkout", manifest.upstreamRepository, checkoutPath], temporaryRoot);
  run("git", ["checkout", "--detach", manifest.upstreamBaseCommit], checkoutPath);
  for (const lockfile of manifest.upstreamLockfiles) {
    const lockfileText = await readFile(join(checkoutPath, lockfile.path), "utf8");
    const normalizedLockfile = Buffer.from(lockfileText.replace(/\r\n/g, "\n"), "utf8");
    if (hashBuffer(normalizedLockfile, "sha256", "hex") !== lockfile.sha256) {
      throw new Error(`Upstream lockfile hash mismatch: ${lockfile.path}`);
    }
  }
  if (patches.some((patch) => patch.id === "cc-aura-guard-v1")) {
    const nativeAuraGuardCheck = spawnSync(
      "git",
      ["grep", "-n", "Aura Guard", "--", "calc/src"],
      { cwd: checkoutPath, encoding: "utf8", shell: false },
    );
    if (nativeAuraGuardCheck.error) throw nativeAuraGuardCheck.error;
    if (nativeAuraGuardCheck.status === 0) {
      throw new Error("Upstream base already contains Aura Guard; audit and retire the compatibility patch");
    }
    if (nativeAuraGuardCheck.status !== 1) {
      throw new Error(`Unable to inspect upstream Aura Guard support: ${nativeAuraGuardCheck.stderr}`);
    }
  }
  if (patches.some((patch) => patch.id === "cc-aura-suppression-v1")) {
    const nativeGen9 = await readFile(join(checkoutPath, "calc/src/mechanics/gen789.ts"), "utf8");
    const ignoredAbilities = nativeGen9.match(/const defenderAbilityIgnored = defender.hasAbility\(([\s\S]*?)\);/);
    if (!nativeGen9.includes("defender.hasAbility('Aura Guard')") || !ignoredAbilities) {
      throw new Error("Expected audited native Aura Guard reduction and Gen9 suppression boundary");
    }
    if (ignoredAbilities[1].includes("'Aura Guard'")) {
      throw new Error("Upstream Gen9 now suppresses Aura Guard; audit and retire the suppression patch");
    }
  }
  const nativePokemonSource = await readFile(join(checkoutPath, "calc/src/pokemon.ts"), "utf8");
  if (patches.some((patch) => patch.id.startsWith("cc-type-overrides-"))
    && /\b(?:typeOverrides|addedType)\b/.test(nativePokemonSource)) {
    throw new Error("Upstream base has explicit type state; audit and retire the type compatibility patch");
  }
  if (patches.some((patch) => patch.id === "cc-champions-moves-v1")) {
    const nativeMoves = await readFile(join(checkoutPath, "calc/src/data/moves.ts"), "utf8");
    const championsStart = nativeMoves.indexOf("const CHAMPIONS_LIST");
    if (championsStart < 0) throw new Error("Unable to locate the audited Champions move-data boundary");
    const nativeGen9Moves = nativeMoves.slice(0, championsStart);
    const projectedUpdates = [
      /(?:^|\n)\s*'Snipe Shot':\s*\{[^}]*\bbp:\s*85\b/,
      /(?:^|\n)\s*'Meteor Assault':\s*\{[^}]*\bbp:\s*170\b/,
      /(?:^|\n)\s*'?Slash'?:\s*\{[^}]*\bbp:\s*80\b/,
      /(?:^|\n)\s*'Double Shock':\s*\{[^}]*\bisPunch:\s*true\b/,
    ];
    if (projectedUpdates.some((pattern) => pattern.test(nativeGen9Moves))) {
      throw new Error("Upstream may now provide a projected Champions move update; audit and narrow or retire the move patch");
    }
  }
  for (const patch of patches) {
    const patchPath = join(projectRoot, patch.path);
    run("git", ["apply", "--check", patchPath], checkoutPath);
    run("git", ["apply", patchPath], checkoutPath);
  }
  run("git", ["diff", "--check"], checkoutPath);
  runNpm(["ci", "--ignore-scripts"], checkoutPath);
  runNpm(["ci", "--ignore-scripts"], join(checkoutPath, "calc"));
  runNpm(["run", "build"], join(checkoutPath, "calc"));
  runNpm(["exec", "--", "jest", "--runInBand", "--cacheDirectory", join(temporaryRoot, "jest-cache")], join(checkoutPath, "calc"));
  runNpm(["run", "lint"], join(checkoutPath, "calc"));
  runNpm(["pack", "--ignore-scripts", "--pack-destination", packOutputPath], join(checkoutPath, "calc"));

  const packedFiles = (await readdir(packOutputPath)).filter((name) => name.endsWith(".tgz"));
  if (packedFiles.length !== 1) {
    throw new Error(`Expected one packed tarball, found: ${packedFiles.join(", ") || "none"}`);
  }

  const packedPath = join(packOutputPath, packedFiles[0]);
  const packedBuffer = await readFile(packedPath);
  const sha256 = hashBuffer(packedBuffer, "sha256", "hex");
  const integrity = `sha512-${hashBuffer(packedBuffer, "sha512", "base64")}`;

  if (verifyOnly) {
    const existingBuffer = await readFile(artifactPath);
    const existingSha256 = hashBuffer(existingBuffer, "sha256", "hex");
    const existingIntegrity = `sha512-${hashBuffer(existingBuffer, "sha512", "base64")}`;
    if (sha256 !== manifest.artifact.sha256 || integrity !== manifest.artifact.integrity) {
      throw new Error("Rebuilt tarball does not match the provenance manifest hashes");
    }
    if (existingSha256 !== manifest.artifact.sha256 || existingIntegrity !== manifest.artifact.integrity) {
      throw new Error("Tracked tarball does not match the provenance manifest hashes");
    }
    console.log(`Verified reproducible artifact ${manifest.artifact.path}`);
  } else {
    await mkdir(dirname(artifactPath), { recursive: true });
    await copyFile(packedPath, artifactPath);
    const nextManifest = {
      ...manifest,
      artifact: {
        ...manifest.artifact,
        sha256,
        integrity,
      },
    };
    await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    console.log(`Wrote ${manifest.artifact.path}`);
    console.log(`sha256 ${sha256}`);
    console.log(`integrity ${integrity}`);
  }
} finally {
  if (dirname(resolve(temporaryRoot)) !== resolve(tmpdir())
    || !basename(temporaryRoot).startsWith("championcreator-smogon-calc-")) {
    throw new Error("Refusing to remove an unexpected temporary build directory");
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
