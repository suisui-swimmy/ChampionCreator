import { describe, expect, it } from "vitest";
import {
  injectSiteFooterMetadata,
  SITE_FOOTER_USAGE_DATE_TOKEN,
  SITE_FOOTER_VERSION_TOKEN,
} from "./siteFooterHtml";

describe("injectSiteFooterMetadata", () => {
  it("injects escaped version and usage-date text into every footer token", () => {
    const html = `${SITE_FOOTER_VERSION_TOKEN}|${SITE_FOOTER_USAGE_DATE_TOKEN}|${SITE_FOOTER_VERSION_TOKEN}`;

    expect(injectSiteFooterMetadata(html, {
      versionLabel: 'app v1.0.0 / calc <test> / data "10"',
      usageDate: "2026-08-25 & later",
    })).toBe(
      "app v1.0.0 / calc &lt;test&gt; / data &quot;10&quot;|2026-08-25 &amp; later|app v1.0.0 / calc &lt;test&gt; / data &quot;10&quot;",
    );
  });

  it("leaves HTML without footer tokens unchanged", () => {
    const html = "<main>ChampionCreator</main>";
    expect(injectSiteFooterMetadata(html, {
      versionLabel: "app v1.0.0",
      usageDate: "未取得",
    })).toBe(html);
  });
});
