const katakanaToHiragana = (value: string): string =>
  value.replace(/[\u30a1-\u30f6]/g, (char) => (
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  ));

export const normalizeSearchText = (value: string): string =>
  katakanaToHiragana(value.normalize("NFKC"))
    .trim()
    .toLowerCase()
    .replace(/[\s　・･_\-‐‑–—]/g, "");
