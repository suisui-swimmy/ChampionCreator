import exclusionPayload from "../data/overrides/user-option-exclusions.json";
import type { EntityKind } from "../data/localizationTypes";
import { normalizeSearchText } from "./normalize";

export type UserOptionExclusionCategory = "smogon-cap" | "calc-internal";

export interface UserOptionExclusion {
  kind: EntityKind;
  id: string;
  showdownName: string;
  category: UserOptionExclusionCategory;
}

export const userOptionExclusions = exclusionPayload.entries as UserOptionExclusion[];

const exclusionsByNormalizedName = new Map(
  userOptionExclusions.map((entry) => [
    `${entry.kind}:${normalizeSearchText(entry.showdownName)}`,
    entry,
  ]),
);

export const getUserOptionExclusion = (
  kind: EntityKind,
  input: string,
): UserOptionExclusion | undefined => (
  exclusionsByNormalizedName.get(`${kind}:${normalizeSearchText(input)}`)
);
