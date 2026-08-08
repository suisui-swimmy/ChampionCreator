import { describe, expect, it } from "vitest";
import { resolvePublicAssetUrl } from "./publicAssetUrl";

describe("resolvePublicAssetUrl", () => {
  it("resolves guide assets from a custom-domain root", () => {
    expect(resolvePublicAssetUrl(
      "/assets/official-artwork/149.png",
      "https://championcreator.example/guide/",
      "../",
    )).toBe("https://championcreator.example/assets/official-artwork/149.png");
  });

  it("preserves a GitHub Pages project prefix for guide assets", () => {
    expect(resolvePublicAssetUrl(
      "assets/stat-icons/hp.svg",
      "https://example.github.io/ChampionCreator/guide/",
      "../",
    )).toBe("https://example.github.io/ChampionCreator/assets/stat-icons/hp.svg");
  });

  it("resolves main-app assets from the current deployment root", () => {
    expect(resolvePublicAssetUrl(
      "assets/ui/menu.svg",
      "https://example.github.io/ChampionCreator/",
      "./",
    )).toBe("https://example.github.io/ChampionCreator/assets/ui/menu.svg");
  });
});
