import moveOptionsJson from "../data/generated/move-options.gen.json";
import type { StatKey } from "./model";
import { resolveEntity } from "../localization/resolver";

type MoveOptionEntry = {
  id: string;
  category?: "Physical" | "Special" | "Status";
};

export type MoveStatReference = {
  owner: "attacker" | "target";
  stat: StatKey;
  role: "damage" | "power";
};

export type MoveStatReferencePlan = {
  references: MoveStatReference[];
  resolved: boolean;
};

const moveOptionsById = new Map(
  (moveOptionsJson.entries as MoveOptionEntry[]).map((entry) => [entry.id, entry]),
);

const uniqueReferences = (references: MoveStatReference[]): MoveStatReference[] => {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.owner}:${reference.stat}:${reference.role}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const adaptiveOffenseMoveNames = new Set([
  "Shell Side Arm",
  "Photon Geyser",
  "Light That Burns the Sky",
]);

const specialMovesUsingDefense = new Set([
  "Psyshock",
  "Psystrike",
  "Secret Sword",
]);

const usesAdaptiveOffenseStats = (canonicalName: string, options: { teraEnabled?: boolean }): boolean =>
  adaptiveOffenseMoveNames.has(canonicalName) || (canonicalName === "Tera Blast" && Boolean(options.teraEnabled));

export const getMoveDefenderStatKeys = (
  moveInput: string,
  options: { teraEnabled?: boolean } = {},
): StatKey[] => {
  const resolved = resolveEntity("move", moveInput);
  if (resolved.status !== "exact" && resolved.status !== "alias") {
    return ["hp", "def", "spd"];
  }

  const canonicalName = resolved.canonicalName ?? "";
  const move = resolved.calcId ? moveOptionsById.get(resolved.calcId) : undefined;

  if (canonicalName === "Final Gambit") {
    return ["hp"];
  }
  if (usesAdaptiveOffenseStats(canonicalName, options)) {
    return ["hp", "def", "spd"];
  }
  if (move?.category === "Physical" || canonicalName === "Body Press" || canonicalName === "Foul Play") {
    return ["hp", "def"];
  }
  if (move?.category === "Special") {
    return specialMovesUsingDefense.has(canonicalName) ? ["hp", "def"] : ["hp", "spd"];
  }

  return ["hp", "def", "spd"];
};

export const getMoveStatReferencePlan = (
  moveInput: string,
  options: { teraEnabled?: boolean } = {},
): MoveStatReferencePlan => {
  const resolved = resolveEntity("move", moveInput);
  if (resolved.status !== "exact" && resolved.status !== "alias") {
    return {
      resolved: false,
      references: [
        { owner: "attacker", stat: "atk", role: "damage" },
        { owner: "attacker", stat: "spa", role: "damage" },
      ],
    };
  }

  const canonicalName = resolved.canonicalName ?? "";
  const move = resolved.calcId ? moveOptionsById.get(resolved.calcId) : undefined;

  if (canonicalName === "Final Gambit") {
    return {
      resolved: true,
      references: [{ owner: "attacker", stat: "hp", role: "damage" }],
    };
  }

  if (canonicalName === "Foul Play") {
    return {
      resolved: true,
      references: [{ owner: "target", stat: "atk", role: "damage" }],
    };
  }

  const primaryStat: StatKey | null = canonicalName === "Body Press"
    ? "def"
    : move?.category === "Physical"
      ? "atk"
      : move?.category === "Special"
        ? "spa"
        : null;

  const references: MoveStatReference[] = [];
  const usesAdaptiveOffense = usesAdaptiveOffenseStats(canonicalName, options);

  if (usesAdaptiveOffense) {
    references.push(
      { owner: "attacker", stat: "atk", role: "damage" },
      { owner: "attacker", stat: "spa", role: "damage" },
    );
  } else if (primaryStat) {
    references.push({ owner: "attacker", stat: primaryStat, role: "damage" });
  }

  if (canonicalName === "Gyro Ball" || canonicalName === "Electro Ball") {
    references.push(
      { owner: "attacker", stat: "spe", role: "power" },
      { owner: "target", stat: "spe", role: "power" },
    );
  }

  return {
    resolved: true,
    references: uniqueReferences(references),
  };
};
