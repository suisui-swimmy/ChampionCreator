const normalizeAssetPath = (path: string): string => path.replace(/^\/+/, "");

export const resolvePublicAssetUrl = (
  path: string,
  documentUrl: string,
  configuredBase: string,
): string => new URL(normalizeAssetPath(path), new URL(configuredBase, documentUrl)).toString();

export const getPublicAssetUrl = (path: string): string => {
  if (typeof document !== "undefined") {
    const configuredBase = document
      .querySelector<HTMLMetaElement>('meta[name="championcreator-app-base"]')
      ?.getAttribute("content");

    if (configuredBase) {
      return resolvePublicAssetUrl(path, document.baseURI, configuredBase);
    }
  }

  const base = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}${normalizeAssetPath(path)}`;
};
