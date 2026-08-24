import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { formatAppVersionLabel } from "./src/appVersion";
import { formatUsageDataDateJst } from "./src/usage/date";
import { parseChampionsUsageDataJson } from "./src/usage/schema";
import {
  injectSiteFooterMetadata,
  SITE_FOOTER_USAGE_DATE_TOKEN,
  SITE_FOOTER_VERSION_TOKEN,
} from "./src/ui/siteFooterHtml";

const readStaticUsageDate = (): string => {
  try {
    const payload = parseChampionsUsageDataJson(
      readFileSync(new URL("./public/data/champions-usage-current.json", import.meta.url), "utf8"),
    );
    return formatUsageDataDateJst(payload.dataVersion === "empty" ? undefined : payload.sourceGeneratedAt);
  } catch {
    return formatUsageDataDateJst(undefined);
  }
};

const siteFooterMetadataPlugin = () => ({
  name: "championcreator-site-footer-metadata",
  transformIndexHtml(html: string) {
    if (!html.includes(SITE_FOOTER_VERSION_TOKEN) && !html.includes(SITE_FOOTER_USAGE_DATE_TOKEN)) {
      return html;
    }
    return injectSiteFooterMetadata(html, {
      versionLabel: formatAppVersionLabel(),
      usageDate: readStaticUsageDate(),
    });
  },
});

export default defineConfig({
  base: "./",
  plugins: [react(), siteFooterMetadataPlugin()],
  build: {
    rollupOptions: {
      input: {
        app: "index.html",
        guide: "guide/index.html",
        privacy: "privacy/index.html",
      },
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
