import moveOptionsJson from "../data/generated/move-options.gen.json";
import type { LocalizedOptionPayload } from "../data/localizationTypes";
import { resolveEntity } from "../localization/resolver";

export interface MoveHitCountRange {
  minHits: number;
  maxHits: number;
}

const moveOptions = moveOptionsJson as LocalizedOptionPayload;

const moveHitCountsById = new Map(
  moveOptions.entries
    .filter((entry) => (
      Number.isInteger(entry.minHits)
      && Number.isInteger(entry.maxHits)
      && (entry.maxHits ?? 0) > 1
      && (entry.minHits ?? 0) > 0
      && (entry.minHits ?? 0) <= (entry.maxHits ?? 0)
    ))
    .map((entry) => [
      entry.id,
      {
        minHits: entry.minHits as number,
        maxHits: entry.maxHits as number,
      },
    ]),
);

export const getMoveHitCountRangeFromInput = (moveInput: string): MoveHitCountRange | null => {
  if (!moveInput.trim()) {
    return null;
  }

  const result = resolveEntity("move", moveInput);
  if ((result.status !== "exact" && result.status !== "alias") || !result.calcId) {
    return null;
  }

  return moveHitCountsById.get(result.calcId) ?? null;
};

export const getMoveMaxHitsFromInput = (moveInput: string): number | null =>
  getMoveHitCountRangeFromInput(moveInput)?.maxHits ?? null;
