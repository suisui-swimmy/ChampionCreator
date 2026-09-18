import { describe, expect, it } from "vitest";
import { createProbeLink, formatProbeReport, inspectProbeUrl } from "./probeModel";
import { PROBE_CASES } from "./fixtures";
import { decodeShareToken, encodeShareToken } from "../urlShareCodec";

const base = "https://championcreator.suisui-swimmy.com/share-probe/";

describe("SNS probe validation", () => {
  it.each(PROBE_CASES)("compares $id with its independent reference", async (fixture) => {
    const link = await createProbeLink(base, fixture);
    expect(await inspectProbeUrl(link.url)).toMatchObject({ status: "success", urlLength: link.url.length, fixture });
  });

  it("uses the current deployment path and clears unrelated query/hash data", async () => {
    const link = await createProbeLink("https://example.com/nested/share-probe/?secret=ignored#old", PROBE_CASES[0]);
    expect(link.url).toMatch(/^https:\/\/example.com\/nested\/share-probe\/\?case=example-v1#share=p1\./);
    expect(link.url).not.toContain("secret");
  });

  it("reports a missing fragment as a failure, including after a social redirect", async () => {
    expect(await inspectProbeUrl(base)).toEqual({ status: "idle" });
    expect(await inspectProbeUrl(`${base}?case=example-v1`)).toMatchObject({ status: "error", message: expect.stringContaining("届いていません") });
    expect(await inspectProbeUrl(`${base}?case=unknown`)).toMatchObject({ status: "error" });
    expect(await inspectProbeUrl(`${base}?case=example-v1&case=ten-v1`)).toMatchObject({ status: "error" });
  });

  it("fails when a valid, independently recompressed payload contains different SP", async () => {
    const link = await createProbeLink(base, PROBE_CASES[0]);
    const url = new URL(link.url);
    const document = await decodeShareToken(url.hash.slice("#share=".length));
    document.target.statPoints.hp = 3;
    url.hash = `share=${await encodeShareToken(document)}`;
    expect(await inspectProbeUrl(url.href)).toMatchObject({ status: "error", message: expect.stringContaining("一致しません") });
  });

  it("does not accept a different reference case or a broken payload", async () => {
    const link = await createProbeLink(base, PROBE_CASES[0]);
    expect(await inspectProbeUrl(link.url.replace("case=example-v1", "case=ten-v1"))).toMatchObject({ status: "error" });
    expect(await inspectProbeUrl(link.url.slice(0, -20))).toMatchObject({ status: "error" });
  });

  it("copies a concise report without the payload or full browsing URL", async () => {
    const link = await createProbeLink(base, PROBE_CASES[0]);
    const report = formatProbeReport(await inspectProbeUrl(link.url), link.url, "Test browser");
    expect(report).toContain("復元成功・元データと完全一致");
    expect(report).toContain("経由したSNS: （記入）");
    expect(report).not.toContain("#share");
    expect(report).not.toContain("https:");
  });
});
