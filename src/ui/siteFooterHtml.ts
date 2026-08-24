export const SITE_FOOTER_VERSION_TOKEN = "__CHAMPIONCREATOR_FOOTER_VERSION__";
export const SITE_FOOTER_USAGE_DATE_TOKEN = "__CHAMPIONCREATOR_FOOTER_USAGE_DATE__";

const escapeHtmlText = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

export const injectSiteFooterMetadata = (
  html: string,
  metadata: {
    versionLabel: string;
    usageDate: string;
  },
): string => html
  .replaceAll(SITE_FOOTER_VERSION_TOKEN, escapeHtmlText(metadata.versionLabel))
  .replaceAll(SITE_FOOTER_USAGE_DATE_TOKEN, escapeHtmlText(metadata.usageDate));
