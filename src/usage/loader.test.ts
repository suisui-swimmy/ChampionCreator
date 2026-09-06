import { describe, expect, it } from "vitest";
import { formatUsageDataDateJst, loadChampionsUsageData } from "./loader";

const payload = {
  schemaVersion: 1,
  dataVersion: "test",
  sourceGeneratedAt: "2026-08-13T15:00:00.000Z",
  formats: { Singles: {}, Doubles: {} },
};

const responseFor = (body: unknown, ok = true, status = 200): Response => ({
  ok,
  status,
  json: async () => body,
} as Response);

describe("loadChampionsUsageData", () => {
  it("fetches the base-aware static asset and validates it", async () => {
    let requestedUrl = "";
    const result = await loadChampionsUsageData(async (input) => {
      requestedUrl = String(input);
      return responseFor(payload);
    });

    expect(requestedUrl).toContain("data/champions-usage-current.json");
    expect(result.data).toEqual(payload);
    expect(result.url).toContain("data/champions-usage-current.json");
    expect(result.error).toBeUndefined();
  });

  it("returns null data for HTTP, network, and schema failures", async () => {
    await expect(loadChampionsUsageData(async () => responseFor({}, false, 503)))
      .resolves.toMatchObject({ data: null, error: expect.any(Error) });
    await expect(loadChampionsUsageData(async () => {
      throw new Error("offline");
    })).resolves.toMatchObject({ data: null, error: expect.any(Error) });
    await expect(loadChampionsUsageData(async () => responseFor({ ...payload, schemaVersion: 2 })))
      .resolves.toMatchObject({ data: null, error: expect.any(Error) });
  });
});

describe("legacy usage Pokemon identities", () => {
  it("normalizes a last-good legacy JSON and refuses ambiguous provider identities", async () => {
    const entry = { move: ["Moonblast"], ability: ["Flower Veil"], item: ["Floettite"], pokemonRank: 27 };
    const legacy = { ...payload, formats: { Singles: {}, Doubles: { floette: entry } } };
    const result = await loadChampionsUsageData(async () => responseFor(legacy));
    expect(result.data?.formats.Doubles).toEqual({ floetteeternal: entry });
    const collision = { ...payload, formats: { Singles: {}, Doubles: { floette: entry, "Floette-Eternal": entry } } };
    const failed = await loadChampionsUsageData(async () => responseFor(collision));
    expect(failed.data).toBeNull();
    expect(failed.error).toBeInstanceOf(Error);
    expect(String(failed.error)).toContain("mapping collision");
    expect(result.data?.formats.Doubles).toEqual({ floetteeternal: entry });
  });
});

describe("formatUsageDataDateJst", () => {
  it("renders the source date in JST, including the UTC boundary", () => {
    expect(formatUsageDataDateJst("2026-08-13T15:00:00.000Z")).toBe("2026-08-14");
    expect(formatUsageDataDateJst("2026-08-14T00:00:00.000Z")).toBe("2026-08-14");
    expect(formatUsageDataDateJst("not-a-date")).toBe("未取得");
    expect(formatUsageDataDateJst(undefined)).toBe("未取得");
  });
});
