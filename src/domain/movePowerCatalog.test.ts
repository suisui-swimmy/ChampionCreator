import { describe, expect, it } from "vitest";
import { getMovePowerCatalogEntry } from "./movePowerCatalog";

describe("movePowerCatalog", () => {
  it("returns generated base power metadata by canonical name", () => {
    expect(getMovePowerCatalogEntry("Sucker Punch")).toEqual({
      canonicalName: "Sucker Punch",
      basePower: 70,
      category: "Physical",
    });
    expect(getMovePowerCatalogEntry("Protect")).toEqual({
      canonicalName: "Protect",
      basePower: 0,
      category: "Status",
    });
  });

  it("does not guess unknown canonical names", () => {
    expect(getMovePowerCatalogEntry("Missing Move")).toBeUndefined();
  });
});
