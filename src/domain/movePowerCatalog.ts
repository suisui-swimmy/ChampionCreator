import moveOptionsJson from "../data/generated/move-options.gen.json";

export interface MovePowerCatalogEntry {
  canonicalName: string;
  basePower: number;
  category: "Physical" | "Special" | "Status";
}

type GeneratedMoveOptionEntry = {
  showdownName: string;
  basePower?: number;
  category?: MovePowerCatalogEntry["category"];
};

const movePowerCatalogByCanonicalName = new Map(
  (moveOptionsJson.entries as GeneratedMoveOptionEntry[])
    .filter((entry): entry is GeneratedMoveOptionEntry & {
      basePower: number;
      category: MovePowerCatalogEntry["category"];
    } => (
      Number.isFinite(entry.basePower)
      && entry.category !== undefined
    ))
    .map((entry) => [
      entry.showdownName,
      {
        canonicalName: entry.showdownName,
        basePower: entry.basePower,
        category: entry.category,
      },
    ]),
);

export const getMovePowerCatalogEntry = (
  canonicalName: string,
): MovePowerCatalogEntry | undefined => movePowerCatalogByCanonicalName.get(canonicalName);
