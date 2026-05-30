import { describe, expect, it } from "vitest";
import { resolveEntity } from "./resolver";

describe("resolveEntity", () => {
  it("resolves a Japanese exact label to a Showdown canonical name", () => {
    const result = resolveEntity("pokemon", "ピカチュウ");

    expect(result.status).toBe("exact");
    expect(result.canonicalName).toBe("Pikachu");
    expect(result.candidates[0]).toMatchObject({
      calcId: "pikachu",
      displayNameJa: "ピカチュウ",
      matchedBy: "displayNameJa",
    });
  });

  it("resolves Japanese aliases without changing the canonical boundary", () => {
    const result = resolveEntity("move", "十万ボルト");

    expect(result.status).toBe("alias");
    expect(result.canonicalName).toBe("Thunderbolt");
    expect(result.candidates[0]).toMatchObject({
      calcId: "thunderbolt",
      matchedBy: "searchText",
    });
  });

  it("resolves generated option data for Pokemon beyond the seed catalog", () => {
    const result = resolveEntity("pokemon", "ガオガエン");

    expect(result.status).toBe("exact");
    expect(result.canonicalName).toBe("Incineroar");
    expect(result.candidates[0]).toMatchObject({
      calcId: "incineroar",
      displayNameJa: "ガオガエン",
      matchedBy: "displayNameJa",
    });
  });

  it("resolves generated option data for other UI entity fields", () => {
    expect(resolveEntity("move", "インファイト")).toMatchObject({
      status: "exact",
      canonicalName: "Close Combat",
      calcId: "closecombat",
    });
    expect(resolveEntity("item", "とつげきチョッキ")).toMatchObject({
      status: "exact",
      canonicalName: "Assault Vest",
      calcId: "assaultvest",
    });
    expect(resolveEntity("ability", "もうか")).toMatchObject({
      status: "exact",
      canonicalName: "Blaze",
      calcId: "blaze",
    });
    expect(resolveEntity("nature", "おくびょう")).toMatchObject({
      status: "exact",
      canonicalName: "Timid",
      calcId: "timid",
    });
    expect(resolveEntity("type", "あく")).toMatchObject({
      status: "exact",
      canonicalName: "Dark",
      calcId: "dark",
    });
  });

  it("keeps ambiguous aliases as candidates instead of choosing one", () => {
    const result = resolveEntity("pokemon", "ドラゴン");

    expect(result.status).toBe("ambiguous");
    expect(result.canonicalName).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.canonicalName)).toEqual(
      expect.arrayContaining(["Dragonite", "Dragapult"]),
    );
  });

  it("keeps entity kinds separated for the same visible text", () => {
    const result = resolveEntity("type", "ドラゴン");

    expect(result.status).toBe("exact");
    expect(result.canonicalName).toBe("Dragon");
  });

  it("returns not-found for unknown input", () => {
    const result = resolveEntity("item", "しらないどうぐ");

    expect(result).toMatchObject({
      status: "not-found",
      kind: "item",
      candidates: [],
    });
  });
});
