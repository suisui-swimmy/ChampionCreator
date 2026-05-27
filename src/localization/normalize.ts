export const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s　・･_\-‐‑–—]/g, "");
