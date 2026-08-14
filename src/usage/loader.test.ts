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

describe("formatUsageDataDateJst", () => {
  it("renders the source date in JST, including the UTC boundary", () => {
    expect(formatUsageDataDateJst("2026-08-13T15:00:00.000Z")).toBe("2026-08-14");
    expect(formatUsageDataDateJst("2026-08-14T00:00:00.000Z")).toBe("2026-08-14");
    expect(formatUsageDataDateJst("not-a-date")).toBe("未取得");
    expect(formatUsageDataDateJst(undefined)).toBe("未取得");
  });
});

