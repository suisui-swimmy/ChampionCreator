import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { ViteDevServer } from "vite";
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

const guideExamplePlugin = () => {
  let server: ViteDevServer | undefined;
  return {
    name: "championcreator-guide-example",
    configureServer(devServer: ViteDevServer) { server = devServer; },
    async transformIndexHtml(html: string) {
      if (!server || !html.includes("<!--GUIDE_CALCULATION_EXAMPLE-->")) return html;
      const { renderGuideExample } = await server.ssrLoadModule("/src/seo/guideExample.tsx");
      return html.replace("<!--GUIDE_CALCULATION_EXAMPLE-->", () => renderGuideExample());
    },
  };
};

export default defineConfig({
  base: "./",
  plugins: [react(), siteFooterMetadataPlugin(), guideExamplePlugin()],
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
