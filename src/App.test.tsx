import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CandidateResult } from "./domain/model";
import {
  App,
  CandidateStatPointBars,
  CandidateStatPointSpread,
  createAccountBoundaryForms,
  DraftRecoveryDialog,
  ResultsPanel,
  SuggestionFormatToggle,
  applyScenarioAdjustmentTypeDefaults,
  applySpeedOrderModeDefaults,
  clampTargetStatPointChange,
  compareResultCandidates,
  createScenario,
  attemptCloudDraftQueue,
  getAttackSuggestionRankingOwners,
  getDraftSaveStatusLabel,
  getDraftAutosaveDecision,
  getAccountSyncStatusIconPath,
  isCurrentAccountOperation,
  shouldInvalidateAccountOperationOnUidChange,
  getOffenseDefenderStatKeys,
  getPokemonSuggestionKeyAction,
  resolveDraftStorageScope,
  formatLocalizedDamageDescription,
  formatNatureModifierLabel,
  formatNatureUsageAriaLabel,
  formatScenarioResultStatusLabel,
  getDropdownEntityOptions,
  getMobileAttackNavigationTargets,
  getMobileScenarioDirectionIconPath,
  getNatureModifierDirection,
  getNatureUsageOverlayOpacity,
  getScenarioPanelVisibleScenarios,
  isAbilitySupportCard,
  isBoxStorageSourceReady,
  isUnresolvedEntityInput,
  formatMovePowerEvaluation,
  normalizeNumericInputText,
  syncScenarioGameTypesToSuggestionFormat,
} from "./App";
import { formatUsageDataDateJst, type ChampionsUsageData } from "./usage";
import {
  applyMoveInputDefaults,
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./ui/defenceSearchUi";
import { appVersionInfo } from "./appVersion";
import {
  DRAFT_STORAGE_KEY,
  createDraftStorageDocument,
} from "./ui/draftStorage";
import { GuideAllyAbilityTip, allyAbilityLabels } from "./guide/GuideAllyAbilityTip";
import { GuideTutorial, getTutorialMessage } from "./guide/GuideTutorial";

const renderExampleApp = (): string => renderToStaticMarkup(
  <App
    initialTargetForm={createDefaultTargetForm()}
    initialScenarioForms={createDefaultScenarioForms()}
  />,
);

const usageDataFixture = (dataVersion = "test-version"): ChampionsUsageData => ({
  schemaVersion: 1,
  dataVersion,
  sourceGeneratedAt: "2026-08-13T15:30:00Z",
  formats: { Singles: {}, Doubles: {} },
});

describe("App", () => {
  it("rejects stale account operation results after a newer operation or UID switch", () => {
    expect(isCurrentAccountOperation(4, 4, "alice", "alice")).toBe(true);
    expect(isCurrentAccountOperation(4, 5, "alice", "alice")).toBe(false);
    expect(isCurrentAccountOperation(4, 4, "alice", "bob")).toBe(false);
    expect(isCurrentAccountOperation(4, 4, null, null)).toBe(true);
  });

  it("allows only an explicitly expected Auth UID transition to keep an operation current", () => {
    expect(shouldInvalidateAccountOperationOnUidChange(null, null)).toBe(false);
    expect(shouldInvalidateAccountOperationOnUidChange("alice", "alice")).toBe(false);
    expect(shouldInvalidateAccountOperationOnUidChange(undefined, "alice")).toBe(true);
    expect(shouldInvalidateAccountOperationOnUidChange(null, "bob")).toBe(true);
  });

  it("creates a blank workspace when the account namespace changes", () => {
    const reset = createAccountBoundaryForms("Doubles");

    expect(reset.target.pokemonInput).toBe("");
    expect(reset.target.statPoints).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(reset.scenarios).toHaveLength(1);
    expect(reset.scenarios[0].attacks[0].gameType).toBe("doubles");
  });

  it("never falls an unavailable account draft namespace back to the guest key", () => {
    expect(resolveDraftStorageScope(null)).toEqual({
      sourceKey: "device",
      storageKey: "championcreator.draft.v1",
    });
    expect(resolveDraftStorageScope({
      sourceKey: "account:alice:draft:unavailable",
      localDraftStorageKey: null,
    })).toEqual({
      sourceKey: "account:alice:draft:unavailable",
      storageKey: null,
    });
  });

  it("does not autosave the previous namespace during an account or guest source transition", () => {
    const fingerprint = "current-visible-work";
    expect(getDraftAutosaveDecision({
      variant: "default",
      hasRecovery: false,
      sourceMatches: false,
      fingerprint,
      boxBaselineFingerprint: null,
      lastDraftFingerprint: "previous-source",
    })).toBe("skip");
    expect(getDraftAutosaveDecision({
      variant: "default",
      hasRecovery: false,
      sourceMatches: true,
      fingerprint,
      boxBaselineFingerprint: null,
      lastDraftFingerprint: fingerprint,
    })).toBe("unchanged");
  });

  it("keeps a failed cloud queue retryable after the device draft succeeds", () => {
    const draft = createDraftStorageDocument(
      createDefaultTargetForm(),
      createDefaultScenarioForms(),
    );
    const queueCurrentDraft = vi.fn()
      .mockReturnValueOnce("同期用ローカル保存の容量がありません")
      .mockReturnValueOnce(null);
    expect(attemptCloudDraftQueue(draft, { queueCurrentDraft })).toEqual({
      status: "error",
      message: "同期用ローカル保存の容量がありません",
    });
    expect(attemptCloudDraftQueue(draft, { queueCurrentDraft })).toEqual({ status: "success" });
    expect(queueCurrentDraft).toHaveBeenCalledTimes(2);
  });

  it("distinguishes draft saves from committed target-box saves", () => {
    expect(getDraftSaveStatusLabel({ status: "saving" })).toBe("下書きを保存中…");
    expect(getDraftSaveStatusLabel({ status: "saved" })).toBe("このブラウザに下書き保存済み");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "queued")).toBe("ブラウザ保存済み");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "syncing")).toBe("クラウドへ保存中…");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "synced")).toBe("クラウド保存済み");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "offline")).toBe("オフライン（ブラウザ保存済み）");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "error")).toBe("同期エラー（ブラウザ保存済み）");
    expect(getDraftSaveStatusLabel({
      status: "error",
      operation: "cloud-save",
      message: "failed",
    })).toBe("同期エラー（ブラウザ保存済み）");
    expect(getDraftSaveStatusLabel({ status: "box-saved" })).toBe("ボックスに保存済み");
    expect(getDraftSaveStatusLabel({
      status: "error",
      operation: "commit",
      message: "failed",
    })).toBe("ボックス保存後の下書き削除エラー");
  });

  it("blocks box operations until the rendered list matches the active storage namespace", () => {
    expect(isBoxStorageSourceReady("device", "device", true)).toBe(true);
    expect(isBoxStorageSourceReady("device", "account:a", true)).toBe(false);
    expect(isBoxStorageSourceReady("account:a", "device", true)).toBe(false);
    expect(isBoxStorageSourceReady("account:a", "account:a", false)).toBe(false);
    expect(isBoxStorageSourceReady("account:a", "account:a", true)).toBe(true);
  });

  it("uses the intended Pokemon as each suggestion ranking owner", () => {
    expect(getAttackSuggestionRankingOwners("defence", "Target", "Attacker")).toEqual({
      move: "Attacker",
      ability: "Attacker",
      item: "Attacker",
    });
    expect(getAttackSuggestionRankingOwners("offense", "Target", "Virtual Enemy")).toEqual({
      move: "Target",
      ability: "Virtual Enemy",
      item: "Virtual Enemy",
    });
    expect(getAttackSuggestionRankingOwners("speed", "Target", "Virtual Enemy")).toEqual({
      move: "Virtual Enemy",
      ability: "Virtual Enemy",
      item: "Virtual Enemy",
    });
  });

  it("only treats field-wide or ally-targeting abilities as move-less support cards", () => {
    for (const skinAbility of [
      "フェアリースキン",
      "スカイスキン",
      "フリーズスキン",
      "エレキスキン",
      "ノーマルスキン",
      "ドラゴンスキン",
    ]) {
      expect(isAbilitySupportCard("defence", "", skinAbility)).toBe(false);
    }

    expect(isAbilitySupportCard("defence", "", "フェアリーオーラ")).toBe(true);
    expect(isAbilitySupportCard("defence", "", "ダークオーラ")).toBe(true);
    expect(isAbilitySupportCard("defence", "", "オーラブレイク")).toBe(true);
    expect(isAbilitySupportCard("defence", "ムーンフォース", "フェアリーオーラ")).toBe(false);
    expect(isAbilitySupportCard("offense", "", "フェアリーオーラ")).toBe(false);
  });

  it("keeps mobile text controls large enough to avoid iOS focus zoom", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(css).toContain("iOS zooms focused text controls below 16px");
    expect(css).toContain('.mobile-scenarios-open input:not([type="checkbox"]):not([type="radio"])');
    expect(css).toContain('.box-overlay input:not([type="checkbox"]):not([type="radio"])');
    expect(css).toMatch(/\.mobile-scenarios-open \.scenario-panel:not\(\.mobile-scenario-detail-panel\)\s*\{[^}]*padding-top:\s*0;/s);
    expect(css).toMatch(/\.hp-event-rule-meta span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(css).toMatch(/\.hp-event-formula,[\s\S]*?\.hp-events-empty\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(css).toMatch(/\.hp-event-row\s*\{[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/font-size: 16px;/);
    expect(html).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  });

  it("keeps box dialogs above mobile sheets and candidate budget values proportional", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/--mobile-sheet-z:\s*70;/);
    expect(css).toMatch(/--box-overlay-z:\s*100;/);
    expect(css).toMatch(/\.box-overlay\s*\{[^}]*z-index:\s*var\(--box-overlay-z\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-row-toggle\s*\{[^}]*grid-template-columns:\s*36px minmax\(0, 1fr\) 18px;/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-bar\s*\{[^}]*grid-template-columns:\s*minmax\(max-content, var\(--candidate-used-track, 1fr\)\)\s*minmax\(max-content, var\(--candidate-remaining-track, 1fr\)\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.mobile-candidate-actions \.ui-button\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.mobile-candidate-layout \.candidate-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 60px;/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.mobile-candidate-layout \.candidate-apply-button\s*\{[^}]*width:\s*60px;[^}]*min-width:\s*60px;/s);
  });

  it("lets the mobile board follow its content while keeping the footer at the viewport bottom", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.app-shell:not\(\.app-shell--tutorial\)\s*\{[^}]*min-height:\s*100dvh;[^}]*grid-template-rows:\s*auto 1fr auto auto;[^}]*align-content:\s*stretch;/s);
    expect(css).toMatch(/\.mobile-overview\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
    expect(css).toMatch(/\.mobile-symmetric-board\s*\{[^}]*min-height:\s*0;/s);
    expect(css).not.toMatch(/\.mobile-symmetric-board\s*\{[^}]*min-height:\s*610px;/s);
    expect(css).toMatch(/\.mobile-candidate-dock\s*\{[^}]*position:\s*static;[^}]*margin-top:\s*auto;/s);
  });

  it("adds a third mobile-header row only while a draft status is visible", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = renderExampleApp();

    expect(css).toContain('"description description"\n      "brand actions";');
    expect(css).toMatch(/\.topbar\.has-draft-status\s*\{[^}]*grid-template-areas:\s*"description description"\s*"brand actions"\s*"status status";/s);
    expect(css).toMatch(/\.brand-title,\s*\.brand-line\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/\.topbar \.brand-description\s*\{[^}]*grid-area:\s*description;[^}]*text-align:\s*center;[^}]*text-wrap:\s*balance;/s);
    expect(css).toMatch(/\.topbar \.brand-version\s*\{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.topbar \.draft-save-status\s*\{[^}]*font-weight:\s*400;/s);
    expect(css).toMatch(/\.topbar-draft-row\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar \.draft-save-status\s*\{[^}]*text-align:\s*right;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar-draft-row\s*\{[^}]*display:\s*flex;[^}]*grid-area:\s*status;[^}]*justify-content:\s*flex-end;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar-meta\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar-action-row\s*\{[^}]*grid-area:\s*actions;[^}]*justify-self:\s*end;/s);
    expect(css).toMatch(/\.suggestion-format-toggle\s*\{[^}]*height:\s*36px;/s);
    expect(css).toMatch(/\.suggestion-format-option-content\s*\{[^}]*min-height:\s*34px;/s);
    expect(css).toMatch(/\.readme-link\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(css).toMatch(/\.app-footer-version\s*\{[^}]*display:\s*block;/s);
    expect(html).toContain("ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール");
    expect(html).toContain('class="topbar"');
    expect(html).not.toContain("has-draft-status");
    expect(html).not.toContain('class="topbar-draft-row"');
    expect(html).toContain('class="app-footer-version"');
  });

  it("shows the matching account status icon in the app header but keeps it out of the tutorial", () => {
    const html = renderToStaticMarkup(<App />);
    const tutorial = renderToStaticMarkup(<App variant="tutorial" />);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    const expectedIconPaths = {
      "local-only": "assets/ui/sync-local-only.svg",
      unsynced: "assets/ui/sync-unsynced.svg",
      syncing: "assets/ui/sync-syncing.svg",
      synced: "assets/ui/sync-synced.svg",
      offline: "assets/ui/sync-offline.svg",
      conflict: "assets/ui/sync-conflict.svg",
      error: "assets/ui/sync-error.svg",
    } as const;

    expect(html).toContain('class="account-sync-trigger local-only"');
    expect(html).toContain('aria-label="アカウントと同期: このブラウザのみ"');
    expect(html).toContain("このブラウザのみ");
    expect(html).toContain("assets/ui/sync-local-only.svg");
    expect(tutorial).not.toContain("account-sync-trigger");
    expect(tutorial).not.toContain("Googleでログイン");
    for (const [status, path] of Object.entries(expectedIconPaths)) {
      expect(getAccountSyncStatusIconPath(status as keyof typeof expectedIconPaths)).toBe(path);
      expect(readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8")).toContain('viewBox="0 0 24 24"');
    }
    expect(css).toMatch(/\.account-sync-trigger-icon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*mask-size:\s*contain;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.account-sync-trigger\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.account-sync-trigger-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    expect(css).toMatch(/\.account-sync-window\s*\{[^}]*width:\s*min\(660px, calc\(100vw - 36px\)\);[^}]*overflow:\s*auto;/s);
  });

  it("publishes indexable metadata and canonical XML and text sitemaps", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
    const textSitemap = readFileSync(new URL("../public/sitemap.txt", import.meta.url), "utf8");

    expect(css).toMatch(/\.brand-title\s*\{[^}]*flex:\s*1 1 auto;/s);
    expect(css).toMatch(/\.topbar-meta\s*\{[^}]*justify-items:\s*end;/s);
    expect(css).toMatch(/\.topbar \.brand-version\s*\{[^}]*font-size:\s*9px;[^}]*text-align:\s*right;/s);
    expect(html).toContain("<title>ChampionCreator | ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール</title>");
    expect(html).toContain('name="description"');
    expect(html).toContain("能力ポイント（SP・努力値相当）の候補配分を自動計算");
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(html).toContain('rel="canonical" href="https://championcreator.suisui-swimmy.com/"');
    expect(html).toContain('property="og:url" content="https://championcreator.suisui-swimmy.com/"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:image"');
    const searchThumbnailUrl = "https://championcreator.suisui-swimmy.com/assets/seo/championcreator-search-thumbnail.png";
    expect(html.match(new RegExp(`content="${searchThumbnailUrl.replaceAll(".", "\\.")}"`, "g"))).toHaveLength(2);
    expect(html).toContain('property="og:image:width" content="1024"');
    expect(html).toContain('property="og:image:height" content="1024"');
    const structuredData = Array.from(html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g))
      .map((match) => JSON.parse(match[1] ?? "{}"));
    expect(structuredData).toContainEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "ChampionCreator",
      url: "https://championcreator.suisui-swimmy.com/",
    });
    expect(structuredData).toContainEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "ChampionCreator | ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール",
      url: "https://championcreator.suisui-swimmy.com/",
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: searchThumbnailUrl,
        width: 1024,
        height: 1024,
      },
    });
    const searchThumbnail = readFileSync(new URL("../public/assets/seo/championcreator-search-thumbnail.png", import.meta.url));
    expect(searchThumbnail.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(searchThumbnail.readUInt32BE(16)).toBe(1024);
    expect(searchThumbnail.readUInt32BE(20)).toBe(1024);
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(sitemap).toContain("<loc>https://championcreator.suisui-swimmy.com/</loc>");
    expect(sitemap).toContain("<loc>https://championcreator.suisui-swimmy.com/guide/</loc>");
    expect(sitemap).not.toContain("localhost");
    expect(textSitemap.trim().split(/\r?\n/)).toEqual([
      "https://championcreator.suisui-swimmy.com/",
      "https://championcreator.suisui-swimmy.com/guide/",
      "https://championcreator.suisui-swimmy.com/privacy/",
    ]);
  });

  it("publishes matching GitHub footer links on the app and guide", () => {
    const appFooter = renderExampleApp().match(/<footer class="app-footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const guideFooter = guideHtml.match(/<footer class="app-footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
    const githubIcon = readFileSync(
      new URL("../public/assets/social/github-invertocat-white.svg", import.meta.url),
      "utf8",
    );

    for (const footer of [appFooter, guideFooter]) {
      expect(footer).toContain('aria-label="フッターリンク"');
      expect(footer).toContain('href="https://github.com/suisui-swimmy/ChampionCreator"');
      expect(footer).toContain('aria-label="ChampionCreator GitHub リポジトリ"');
      expect(footer).toContain("assets/social/github-invertocat-white.svg");
      expect(footer.indexOf("不具合報告")).toBeLessThan(footer.indexOf("お問い合わせ"));
      expect(footer.indexOf("お問い合わせ")).toBeLessThan(footer.indexOf("https://github.com/suisui-swimmy/ChampionCreator"));
    }

    expect(appFooter.match(/ \| /g)).toHaveLength(3);
    expect(guideFooter.match(/ \| /g)).toHaveLength(3);
    expect(guideFooter).toContain('aria-label="関連リンク"');
    expect(guideFooter).toContain('href="https://championsbattledata.com/"');

    expect(githubIcon).toContain('<svg width="98" height="96"');
    expect(githubIcon).toContain('fill="white"');
  });

  it("publishes a static, indexable guide with a responsive real-calculation tutorial", () => {
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const guideCss = readFileSync(new URL("./guide/guide.css", import.meta.url), "utf8");
    const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
    const allyAbilityTipHtml = renderToStaticMarkup(<GuideAllyAbilityTip />);
    const tutorialHtml = renderToStaticMarkup(<GuideTutorial />);

    expect(guideHtml).toContain("<title>ChampionCreator 使い方ガイド | 耐久・火力・素早さ調整</title>");
    expect(guideHtml).toContain('rel="canonical" href="https://championcreator.suisui-swimmy.com/guide/"');
    expect(guideHtml).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(guideHtml).toContain('name="championcreator-app-base" content="../"');
    expect(guideHtml).not.toContain("<base ");
    expect(guideHtml).toContain('href="#screen"');
    expect(guideHtml).toContain('href="#constant-damage"');
    expect(guideHtml).toContain('class="guide-menu-toggle"');
    expect(guideHtml).toContain('aria-controls="guide-toc-panel"');
    expect(guideHtml).toContain('src="/assets/ui/menu.svg"');
    expect(guideHtml).toContain('id="guide-toc-panel"');
    expect(guideHtml).toContain('href="#getting-started" aria-current="location"');
    expect(guideHtml).toContain('<span>使い方ガイド</span>');
    expect(guideHtml).not.toContain('class="guide-global-nav"');
    expect(guideHtml).toContain('<a class="guide-header-action" href="/">アプリを開く</a>');
    expect(guideHtml).not.toContain('href="#defence"');
    expect(guideHtml).not.toContain('href="#offense"');
    expect(guideHtml).not.toContain('href="#speed"');
    expect(guideHtml.indexOf('href="#scenarios"')).toBeLessThan(guideHtml.indexOf('href="#constant-damage"'));
    expect(guideHtml).not.toContain('class="guide-toc-help"');
    expect(guideHtml).toContain('id="guide-tutorial-root"');
    expect(guideHtml).toContain('id="guide-ally-ability-tip-root"');
    expect(guideHtml).not.toContain('class="guide-quick-steps"');
    expect(guideHtml).not.toContain("下の作業台は画像ではなく、実際のアプリと同じ計算UIです。");
    expect(guideHtml).toContain('id="constant-damage"');
    expect(guideHtml).toContain('src="/assets/guide/overview.png"');
    expect(guideHtml.indexOf('class="guide-overview-image"')).toBeLessThan(guideHtml.indexOf('class="guide-feature-list"'));
    expect(guideHtml).toContain('class="feature-mark target">①</span>');
    expect(guideHtml).toContain('class="feature-mark scenario">②</span>');
    expect(guideHtml).toContain('class="feature-mark result">③</span>');
    expect(guideHtml).toContain('class="feature-mark box">④</span>');
    expect(guideHtml).not.toContain('class="guide-feature-grid"');
    expect(guideHtml).toContain('src="/assets/guide/lightbulb.svg"');
    expect(guideHtml).toContain("スマホでは？");
    expect(guideHtml).toContain("スマホ表示では、調整対象と仮想敵シナリオをタッチすると拡大シートで入力できます。候補一覧はトップ画面のまま並び替え、詳細確認、適用、ページ移動ができます。");
    expect(guideHtml).toContain("並び替えでは、<code>総合耐久指数=HBD/(B+D)</code>、<code>物理耐久指数=H*B</code>、<code>特殊耐久指数=H*D</code> を選べます。H/B/D は候補適用後の実数値（H=<code>maxHP()</code>、B=<code>stats.def</code>、D=<code>stats.spd</code>）を使い、SP値の積ではありません。");
    expect(guideHtml).toContain("これらはシナリオ固有のダメージ、タイプ相性、特性、持ち物、HPイベントを含まない並び替え用の補助指標です。検索の合否判定やシナリオ評価は、従来どおり各条件の計算結果を使います。");
    expect(guideHtml).toContain("画面中央のノードは、小さい丸エッジ側が「攻撃を与える側」「素早さを抜く側」、細長いピル型エッジ側が「攻撃を受ける側」「素早さを抜かれる側」を表しています。");
    expect(guideHtml).toContain('src="/assets/guide/overview_mobile.png"');
    expect(guideHtml.indexOf("素早さを抜かれる側")).toBeLessThan(guideHtml.indexOf('class="guide-mobile-overview-image"'));
    expect(guideHtml).not.toContain("調整対象、シナリオ、候補をタップすると");
    expect(guideHtml).toContain("デスクトップは20件、スマホは5件ずつ表示します。スマホではトップ画面の候補一覧から並び替えとページ移動を行い、候補を開くと詳細がその場に展開されます。");
    const scenarioColumnText = "同じシナリオ内の「＋」を押すと、調整列を追加できます。シナリオ名・有効状態・調整種別を共有したまま、相手や技などの条件を追加したい場合に使用します。耐久調整や火力調整では、追加した攻撃を左から順に一連の攻撃として評価します。";
    const scenarioRowText = "「シナリオを追加」を押すと、独立したシナリオ行を追加できます。別の調整種別を設定したい場合や、条件ごとに有効・無効を切り替えたい場合は、新しいシナリオ行を追加してください。";
    const scenarioEvaluationText = "計算時は、最終的に有効になっているすべてのシナリオ行を条件として評価します。一時的に条件から外したい場合は、トグルスイッチで無効化することができます。";
    expect(guideHtml).toContain(scenarioColumnText);
    expect(guideHtml).toContain(scenarioRowText);
    expect(guideHtml).toContain(scenarioEvaluationText);
    expect(guideHtml).not.toContain("有効なシナリオだけが計算対象になります。一時的に条件から外したい場合は、削除ではなく無効化しておくと戻しやすいです。");
    expect(guideHtml.indexOf(scenarioColumnText)).toBeLessThan(guideHtml.indexOf('src="/assets/guide/scenario-adjustment-column-addition.png"'));
    expect(guideHtml.indexOf('src="/assets/guide/scenario-adjustment-column-addition.png"')).toBeLessThan(guideHtml.indexOf(scenarioRowText));
    expect(guideHtml.indexOf(scenarioRowText)).toBeLessThan(guideHtml.indexOf('src="/assets/guide/scenario-row-addition.png"'));
    expect(guideHtml.indexOf('src="/assets/guide/scenario-row-addition.png"')).toBeLessThan(guideHtml.indexOf(scenarioEvaluationText));
    expect(guideHtml.indexOf(scenarioEvaluationText)).toBeLessThan(guideHtml.indexOf('id="guide-ally-ability-tip-root"'));
    expect(guideHtml).toContain('class="guide-mode-grid" role="group" aria-label="仮想敵シナリオの調整種別"');
    expect(guideHtml).toMatch(/<section class="guide-section" id="scenarios">[\s\S]*?<div class="guide-mode-grid" role="group" aria-label="仮想敵シナリオの調整種別">[\s\S]*?<section class="guide-mode-section defence" id="defence">[\s\S]*?<section class="guide-mode-section offense" id="offense">[\s\S]*?<section class="guide-mode-section speed" id="speed">[\s\S]*?<\/div>\s*<\/section>\s*<section class="guide-section" id="constant-damage">/s);
    expect(guideHtml).toContain("調整対象が相手の攻撃をどれだけ耐えるかを設定します。攻撃側条件、必要耐久回数、必要生存率を入力し、複数条件をすべて満たす配分だけを候補にします。");
    expect(guideHtml).toContain("指定した技で相手を倒すために必要なAまたはCのラインを計算します。必要KO確率を満たすSPが固定条件として耐久候補へ統合されます。");
    expect(guideHtml).toContain("相手ポケモンや任意の実数値を基準に、確定抜き・+〇などのSラインを計算します。条件は、全体へ適用する「共通S条件」、相手側へ適用する「相手S条件」、調整対象側へ適用する「調整対象S条件」に分かれています。");
    expect(guideHtml).toContain("トリックルームと、おいかぜ（両側）は同時に指定できます。");
    expect(guideHtml).toContain("倍率欄が金色になり、欄内へ「手動」を表示します。");
    expect(guideHtml).toContain("元入力を暗色＋金枠で示します。");
    expect(guideHtml).not.toContain("「自動 → 手動」の置換内容");
    expect(guideHtml).not.toContain("確定抜き・同速などのSライン");
    expect(guideHtml).toContain("追加した効果は発動する前提で計算し、入力条件と一致しない場合は警告が表示されます。現在HP依存技は、各攻撃・各ヒット時点のHPから自動再計算します。");
    expect(guideHtml).not.toContain("警告を表示しますが、自動削除はしません");
    expect(guideHtml).toContain("保存名の変更、上書き、複製、削除、空スロットの読み込みに対応しています。");
    expect(guideHtml).not.toContain("空スロットの読み込みにも対応しています");
    expect(guideHtml).toContain("PC版Chrome・Edgeはアドレスバーのインストールアイコンから利用できます。");
    expect(guideHtml).not.toContain("アドレスバー付近のインストール導線");
    expect(guideHtml).toContain("必要生存率・KO確率、A/C/Sの固定SPが厳しすぎないかを確認してください。");
    expect(guideHtml).not.toContain("A/C/Sの固定SPが重すぎないか");
    expect(guideHtml).toContain('class="guide-notes-list"');
    expect(guideHtml).toContain("未ログイン時の保存は、このブラウザ内だけに残ります。");
    expect(guideHtml).toContain('src="/src/guide/main.tsx"');
    const guideOverviewImage = readFileSync(new URL("../public/assets/guide/overview.png", import.meta.url));
    expect(guideOverviewImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideOverviewImage.readUInt32BE(16)).toBe(1763);
    expect(guideOverviewImage.readUInt32BE(20)).toBe(1645);
    const guideMobileOverviewImage = readFileSync(new URL("../public/assets/guide/overview_mobile.png", import.meta.url));
    expect(guideMobileOverviewImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideMobileOverviewImage.readUInt32BE(16)).toBe(690);
    expect(guideMobileOverviewImage.readUInt32BE(20)).toBe(1024);
    const guideScenarioColumnImage = readFileSync(new URL("../public/assets/guide/scenario-adjustment-column-addition.png", import.meta.url));
    expect(guideScenarioColumnImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideScenarioColumnImage.readUInt32BE(16)).toBe(1045);
    expect(guideScenarioColumnImage.readUInt32BE(20)).toBe(390);
    const guideScenarioRowImage = readFileSync(new URL("../public/assets/guide/scenario-row-addition.png", import.meta.url));
    expect(guideScenarioRowImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideScenarioRowImage.readUInt32BE(16)).toBe(820);
    expect(guideScenarioRowImage.readUInt32BE(20)).toBe(1139);
    const guideTipIcon = readFileSync(new URL("../public/assets/guide/lightbulb.svg", import.meta.url), "utf8");
    expect(guideTipIcon).toContain("<svg");
    expect(guideTipIcon).toContain('stroke="#00FF72"');
    const guideAllyAbilityImage = readFileSync(new URL("../public/assets/guide/double-battle-ally-abilities.png", import.meta.url));
    expect(guideAllyAbilityImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideAllyAbilityImage.readUInt32BE(16)).toBe(871);
    expect(guideAllyAbilityImage.readUInt32BE(20)).toBe(548);
    expect(allyAbilityTipHtml).toContain('class="guide-tip-icon"');
    expect(allyAbilityTipHtml).toContain("ダブルバトルの味方特性");
    expect(allyAbilityTipHtml).toContain("「わざわいのつるぎ」「フェアリーオーラ」「フレンドガード」などは、ダブルバトルを選択し、同じシナリオ内にその特性を持つポケモンを追加すると反映できます。");
    expect(allyAbilityTipHtml).toContain('class="guide-ability-disclosure-trigger"');
    expect(allyAbilityTipHtml).toContain('data-state="closed"');
    expect(allyAbilityTipHtml).toContain("対象の特性");
    expect(allyAbilityLabels).toEqual([
      "わざわいのつるぎ",
      "わざわいのたま",
      "わざわいのおふだ",
      "わざわいのうつわ",
      "フラワーギフト",
      "バッテリー",
      "パワースポット",
      "はがねのせいしん",
      "フェアリーオーラ",
      "ダークオーラ",
      "オーラブレイク",
      "プラス",
      "マイナス",
      "フレンドガード",
    ]);
    expect(allyAbilityTipHtml).toContain('src="/assets/guide/double-battle-ally-abilities.png"');
    expect(allyAbilityTipHtml.indexOf("対象の特性")).toBeLessThan(allyAbilityTipHtml.indexOf('class="guide-ally-ability-image"'));
    const guideStructuredDataMatch = guideHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    expect(guideStructuredDataMatch).not.toBeNull();
    const guideStructuredData = JSON.parse(guideStructuredDataMatch?.[1] ?? "{}");
    expect(guideStructuredData["@graph"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ "@type": "TechArticle" }),
      expect.objectContaining({ "@type": "BreadcrumbList" }),
    ]));
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-page \.app-shell--tutorial \.workbench\s*\{[^}]*display:\s*block;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-menu-toggle\s*\{[^}]*display:\s*inline-grid;/s);
    expect(guideCss).toMatch(/\.guide-menu-open \.guide-toc\s*\{[^}]*visibility:\s*visible;/s);
    expect(guideCss).toMatch(/\.guide-page \.app-shell--tutorial \.results-panel\s*\{[^}]*top:\s*60px;[^}]*height:\s*calc\(100dvh - 60px\);/s);
    expect(guideCss).toMatch(/\.guide-intro h1\s*\{[^}]*font-size:\s*clamp\(23px, 2\.4vw, 32px\);/s);
    expect(guideCss).toMatch(/\.guide-lead\s*\{[^}]*max-width:\s*none;[^}]*margin:\s*14px 0 16px;/s);
    expect(guideCss).toMatch(/\.guide-overview-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-feature-list\s*\{[^}]*list-style:\s*none;/s);
    expect(guideCss).toMatch(/\.guide-feature-list p\s*\{[^}]*font-size:\s*13px;/s);
    expect(guideCss).toContain(".feature-mark.target { color: var(--guide-yellow); }");
    expect(guideCss).toMatch(/\.guide-tip-heading\s*\{[^}]*display:\s*flex;/s);
    expect(guideCss).toMatch(/\.guide-mobile-overview-image\s*\{[^}]*width:\s*min\(100%, 320px\);[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-ability-disclosure-trigger\s*\{[^}]*display:\s*flex;[^}]*cursor:\s*pointer;/s);
    expect(guideCss).toMatch(/\.guide-ability-disclosure-trigger\[data-state="open"\] \.guide-disclosure-chevron\s*\{[^}]*transform:\s*rotate\(90deg\);/s);
    expect(guideCss).toMatch(/\.guide-ally-ability-image\s*\{[^}]*width:\s*min\(100%, 720px\);[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-scenario-image\s*\{[^}]*width:\s*min\(100%, 720px\);[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-scenario-row-image\s*\{[^}]*width:\s*min\(100%, 520px\);/s);
    expect(guideCss).toMatch(/\.guide-mode-grid\s*\{[^}]*margin-top:\s*28px;/s);
    expect(guideCss).toMatch(/\.guide-mode-section p\s*\{[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);[^}]*gap:\s*8px;[^}]*padding:\s*10px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps li\s*\{[^}]*min-height:\s*56px;[^}]*border:\s*1px solid var\(--guide-border\);[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps span\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps li\.active\s*\{[^}]*border-color:\s*rgba\(247, 212, 71, 0\.72\);[^}]*background:\s*rgba\(247, 212, 71, 0\.09\);/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps li\.complete\s*\{[^}]*border-color:\s*rgba\(0, 255, 114, 0\.38\);[^}]*background:\s*rgba\(0, 255, 114, 0\.04\);/s);
    expect(guideCss).toMatch(/\.guide-tutorial-message span\s*\{[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-message p\s*\{[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-tutorial-steps\s*\{[^}]*overflow-x:\s*visible;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-tutorial-steps li:not\(:last-child\)::after\s*\{[^}]*display:\s*none;/s);
    expect(guideCss).not.toMatch(/\.guide-tutorial-steps\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(guideHtml).toContain('class="guide-stat-rules" aria-label="SPの基本ルール"');
    expect(guideHtml).toContain("<h3>SPの制約</h3>");
    expect(guideHtml).toContain("<h3>計算での扱い</h3>");
    expect(guideHtml).toContain("<div><dt>各能力</dt><dd>0–32</dd></div>");
    expect(guideHtml).toContain("<div><dt>合計上限</dt><dd>66</dd></div>");
    expect(guideHtml).toContain("<div><dt>同時探索</dt><dd>H/B/D</dd></div>");
    expect(guideHtml).toContain("<div><dt>固定条件</dt><dd>A/C/S</dd></div>");
    expect(guideHtml).not.toContain("各能力に使えるSP");
    expect(guideHtml).not.toContain("1候補として同時探索");
    expect(guideCss).toMatch(/\.guide-stat-rules\s*\{[^}]*overflow:\s*hidden;[^}]*border:\s*1px solid var\(--guide-border\);[^}]*background:\s*var\(--guide-surface\);/s);
    expect(guideCss).toMatch(/\.guide-stat-rule-row\s*\{[^}]*grid-template-columns:\s*190px minmax\(0, 1fr\);[^}]*min-height:\s*72px;/s);
    expect(guideCss).toMatch(/\.guide-stat-rule-items\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(guideCss).toMatch(/\.guide-stat-rule-items dd\s*\{[^}]*font-size:\s*24px;[^}]*font-weight:\s*800;/s);
    expect(guideCss).toMatch(/\.guide-troubleshooting-list,\s*\.guide-notes-list\s*\{[^}]*padding-left:\s*20px;[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/\.guide-layout\s*\{[^}]*grid-template-columns:\s*220px minmax\(0, 1fr\);/s);
    expect(guideHtml).toContain('class="guide-troubleshooting-list"');
    expect(guideHtml).not.toContain("<details");
    expect(guideHtml).not.toContain('class="guide-context"');
    expect(guideHtml).not.toContain('id="guide-version"');
    expect(guideHtml).toContain('class="app-footer"');
    expect(guideHtml).toContain("不具合報告");
    expect(guideHtml).toContain('aria-label="お問い合わせ: X @peixe0307"');
    expect(guideHtml).toContain('href="https://github.com/suisui-swimmy/ChampionCreator"');
    expect(guideHtml).toContain('aria-label="ChampionCreator GitHub リポジトリ"');
    expect(guideHtml).toContain('src="/assets/social/github-invertocat-white.svg"');
    expect(tutorialHtml).toContain("サンプル入力で計算してみよう");
    expect(getTutorialMessage("idle", false)).toBe("サンプル入力を確認したら、実際に「計算開始」を押してみよう。入力内容は自由に変更できます。");
    expect(getTutorialMessage("running", false)).toBe("アプリと同じ計算方法で全条件を評価しています。");
    expect(getTutorialMessage("complete", false)).toBe("計算完了！候補を開くと、各条件のPASS結果とダメージ内訳を確認できます。");
    expect(getTutorialMessage("complete", true)).toBe("候補のSP配分を調整対象へ適用できました。入力値が変わったことを確認してみよう。");
    expect(tutorialHtml).toContain("サンプル入力を確認したら、実際に「計算開始」を押してみよう。入力内容は自由に変更できます。");
    expect(tutorialHtml).not.toContain("作業台の「計算開始」");
    expect(tutorialHtml).not.toContain("添付バックアップの3条件を、本体と同じ計算経路で同時評価します。");
    expect(tutorialHtml).not.toContain('class="guide-open-app-button"');
    expect(tutorialHtml).toContain('aria-label="サンプルに戻す"');
    expect(tutorialHtml).toContain('assets/ui/refresh-ccw.svg');
    expect(tutorialHtml).toContain('class="app-shell app-shell--tutorial"');
    expect(tutorialHtml).toContain('value="メガマフォクシー"');
    expect(tutorialHtml).toContain('value="ドドゲザン"');
    expect(tutorialHtml).toContain('value="ふいうち"');
    expect(tutorialHtml).toContain('value="メガゲンガー"');
    expect(tutorialHtml).toContain('value="サイコキネシス"');
    expect(tutorialHtml).not.toContain('class="topbar"');
    expect(tutorialHtml).not.toContain('aria-label="バトル形式とサジェスト基準"');
    expect(tutorialHtml).not.toContain('class="app-footer"');
    expect(robots).toContain("Sitemap: https://championcreator.suisui-swimmy.com/sitemap.xml");
  });

  it("keeps type and item dropdown candidates separated", () => {
    const typeOptions = getDropdownEntityOptions("type", "");
    const itemOptions = getDropdownEntityOptions("item", "");

    expect(typeOptions.some((option) => option.value === "ほのお")).toBe(true);
    expect(typeOptions.some((option) => option.value === "Crucibellite")).toBe(false);
    expect(itemOptions.some((option) => option.value === "Crucibellite")).toBe(true);
  });

  it("supports keyboard navigation and Tab selection for Pokemon suggestions", () => {
    expect(getPokemonSuggestionKeyAction("ArrowDown", 0, 2)).toEqual({ type: "move", index: 1 });
    expect(getPokemonSuggestionKeyAction("ArrowDown", 1, 2)).toEqual({ type: "move", index: 0 });
    expect(getPokemonSuggestionKeyAction("ArrowUp", 0, 2)).toEqual({ type: "move", index: 1 });
    expect(getPokemonSuggestionKeyAction("Tab", 0, 2)).toEqual({ type: "select" });
    expect(getPokemonSuggestionKeyAction("Enter", 0, 2)).toEqual({ type: "select" });
    expect(getPokemonSuggestionKeyAction("Escape", 0, 2)).toEqual({ type: "close" });
  });

  it("does not mark selectable Pokemon form suggestions as unresolved", () => {
    expect(isUnresolvedEntityInput("pokemon", "イッカネズミ ４ひきかぞく")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "オーガポン いしずえのめん")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "オーガポン いしずえのかめん")).toBe(false);
    for (const input of [
      "チャデス マガイモノのすがた",
      "チャデス タカイモノのすがた",
      "ヤバソチャ ボンサクのすがた",
      "ヤバソチャ ケッサクのすがた",
      "ヤバチャ がんさくフォルム",
      "ヤバチャ しんさくフォルム",
      "ポットデス がんさくフォルム",
      "ポットデス しんさくフォルム",
    ]) {
      expect(isUnresolvedEntityInput("pokemon", input)).toBe(false);
    }
  });

  it("renders the M0 workbench sections", () => {
    const html = renderExampleApp();
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(html).toContain("ChampionCreator");
    expect(html).toContain('class="brand-line"');
    expect(html).toContain("ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール");
    expect(html).toContain('class="topbar-meta"');
    expect(html).not.toContain("title=");
    expect(html).toContain(`app v${appVersionInfo.appVersion} / calc ${appVersionInfo.smogonCalcVersion} / data ${appVersionInfo.localizationEntries}`);
    expect(html.indexOf("ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール")).toBeLessThan(
      html.indexOf(`app v${appVersionInfo.appVersion}`),
    );
    expect(html).not.toContain("Pokemon Champions 自動耐久調整");
    expect(html).toContain("調整対象");
    expect(html).toContain('class="target-sheet-body"');
    expect(html).toContain('class="box-access-button"');
    expect(html.match(/aria-label="調整対象ボックスを開く"/g)).toHaveLength(2);
    expect(html.match(/aria-label="仮想敵ボックスを開く"/g)).toHaveLength(2);
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/assets\/ui\/box\.svg/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("assets/ui/pokebox.svg");
    expect(html.match(/assets\/ui\/trash-2\.svg/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain("assets/ui/trash.svg");
    expect(html).toContain(">レベル</span>");
    expect(html).toMatch(/class="placeholder-field target-level-field"[\s\S]*?aria-label="調整対象 レベルの固定を解除"/);
    expect(html).toMatch(/aria-label="調整対象 レベルの固定を解除"[^>]*>[\s\S]*?assets\/ui\/lock\.svg/);
    expect(html).toContain(">残りSPで耐久最大化</button>");
    expect(html).toContain(">性格変更を許可する</span>");
    expect(html).toContain('class="sp-summary-actions"');
    expect(html).toContain('class="sp-summary-total"');
    expect(html).not.toContain(">条件JSON</button>");
    expect(html).not.toContain(">コピー</button>");
    expect(html).toContain("仮想敵シナリオ");
    expect(html).toContain('aria-label="スマホ用調整ボード"');
    expect(html).toContain('aria-label="ノード接続調整ボード"');
    expect(html).toContain('aria-label="シナリオ調整種別"');
    expect(html).toContain('class="mobile-target-heading"');
    expect(html).toContain('class="box-access-button mobile-box-access-button"');
    expect(html).not.toContain('class="mobile-board-heading-actions"');
    expect(html.match(/>追加<\/button>/g)).toHaveLength(2);
    expect(html).not.toContain("攻撃は横スクロール");
    expect(html).toContain('class="mobile-scenario-flow-list"');
    expect(html).toContain('class="mobile-scenario-flow-row defence"');
    expect(html).toContain('class="mobile-flow-edge-layer"');
    expect(html).toContain('aria-label="シナリオ調整種別エッジ"');
    expect(html).not.toContain('class="mobile-flow-label"');
    expect(html).not.toContain('class="mobile-flow-edge-arrow"');
    expect(html).not.toContain('class="mobile-flow-edge-start-node"');
    expect(html).not.toContain('class="mobile-flow-edge-end-node-outer"');
    expect(html).toContain('class="mobile-target-stat-meter hp"');
    expect(html).toContain('class="mobile-scenario-direction-icon"');
    expect(html).toContain('class="mobile-scenario-adjustment-row"');
    expect(html).toContain('class="mobile-scenario-state on"');
    expect(html).toContain('class="icon-button scenario-remove-button mobile-scenario-remove-button"');
    expect(html).toContain('aria-label="シナリオ1を削除"');
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('class="mobile-scenario-count"');
    expect(html).toContain('class="mobile-candidate-dock"');
    expect(html).toContain('class="mobile-attack-rail"');
    expect(html).toContain('aria-label="シナリオ1 調整種別"');
    expect(html).toContain('aria-label="シナリオ2 調整種別"');
    expect(html).toContain('aria-label="シナリオ3 調整種別"');
    expect(html).toContain('class="scenario-row defence"');
    expect(html).toContain('class="scenario-row offense"');
    expect(html).toContain('class="scenario-row speed"');
    expect(html).toContain(">耐久調整</span>");
    expect(html).toContain(">火力調整</span>");
    expect(html).toContain(">素早さ調整</span>");
    expect(html).toContain('value="耐久調整A"');
    expect(html).toContain('value="火力調整A"');
    expect(html).toContain('value="素早さ調整A"');
    expect(html).toContain(">確定抜き</span>");
    expect(html).toContain(">任意S値</span>");
    expect(html).toContain(">素早さ条件</h3>");
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値"');
    expect(html).toContain('class="number-stepper speed-offset-input"');
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値を1下げる"');
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値を1上げる"');
    expect(html).toContain(">共通S条件</h3>");
    expect(html).toContain(">相手S条件</h3>");
    expect(html).toContain(">調整対象S条件</h3>");
    expect(html).not.toContain("調整対象Sランク");
    expect(html).toContain(">状態異常</span>");
    expect(html).toContain(">行動順</span>");
    expect(html).toContain(">おいかぜ</span>");
    expect(html).not.toContain("両側の手動倍率は、選択中の持ち物・特性による自動補正を置き換えます。");
    expect(html).not.toContain("speed-manual-badge");
    expect(html).not.toContain("speed-override-summary");
    expect(html).not.toContain("speed-source-overridden");
    expect(html.match(/>自動<\/span>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('aria-label="素早さ調整A 共通S条件 行動順"');
    expect(html).toContain('aria-label="素早さ調整A 相手S条件 状態異常"');
    expect(html).toContain('aria-label="素早さ調整A 調整対象S条件 状態異常"');
    expect(html).toContain('aria-label="素早さ調整A 任意S値"');
    expect(css).toMatch(/\.speed-multiplier-control\.is-manual \.select-trigger\s*\{[^}]*border-color:\s*var\(--gold-line\);/s);
    expect(css).toMatch(/\.select-trigger-has-badge\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto 14px;/s);
    expect(css).toMatch(/\.speed-source-overridden:not\(\.is-invalid\) \.dropdown-input-row input\s*\{[^}]*border-color:\s*var\(--gold-line\);/s);
    expect(css).toMatch(/\.speed-source-overridden:not\(\.is-invalid\) \.dropdown-input-row input\s*\{[^}]*color:\s*#7f8987;/s);
    expect(css).not.toContain(".speed-source-overridden:not(.is-invalid) .dropdown-input-row::before");
    expect(css).toMatch(/\.mobile-scenario-flow-row\.trick-room \.mobile-scenario-summary\.speed\s*\{[^}]*border-color:\s*rgba\(181, 108, 255, 0\.64\);/s);
    expect(html).not.toContain(">技補正</span>");
    expect(html).not.toContain("speed-tailwind-toggle");
    expect(html).toContain('class="scenario-cell number-cell number-labeled-field speed-manual-target-input"');
    expect(html).toContain('inputMode="numeric"');
    expect(html.match(/>任意S値<\/span>/g)).toHaveLength(1);
    expect(html).not.toContain("同速以上");
    expect(html).not.toContain(">目標S<");
    expect(html).not.toContain(">S条件</h3>");
    expect(html).toContain('value="90"');
    expect(html).toContain('value="80"');
    expect(html).toContain('value="メガゲンガー"');
    expect(html).toContain("assets/ui/arrow-left-circle.svg");
    expect(html).toContain("assets/ui/arrow-right-circle.svg");
    expect(html).not.toMatch(/<img[^>]+assets\/ui\/arrow-(?:left|right|up|down)-circle\.svg/);
    expect(html).toContain('class="attack-direction-icon"');
    expect(html).toContain('aria-label="耐久調整A 耐久調整。クリックで火力調整に切り替え"');
    expect(html).toContain('aria-label="火力調整A 火力調整。クリックで素早さ調整に切り替え"');
    expect(html).toContain('aria-label="素早さ調整A 素早さ調整。クリックで耐久調整に切り替え"');
    expect(html).toContain("assets/ui/arrow-up-circle.svg");
    expect(html).not.toContain("assets/ui/arrow-down-circle.svg");
    expect(html.match(/>定数ダメージ・回復<\/span>/g)).toHaveLength(2);
    expect(html.match(/>追加する効果<\/span>/g)).toHaveLength(2);
    expect(html.match(/>追加<\/button>/g)).toHaveLength(2);
    expect(html).not.toContain('aria-label="Sライン結果"');
    expect(html).toContain("シナリオを追加");
    expect(html).toContain('aria-label="探索操作"');
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("評価 0 / -");
    expect(html).toContain(">キャンセル<");
    expect(html).toContain(">計算開始<");
    expect(html).toContain("候補一覧");
    expect(html).toContain("計算結果");
    expect(html).not.toContain("計算開始で Worker 経由の候補がここに出ます");
    expect(html).toContain('aria-label="権利表記"');
    expect(html).toContain("© 2026 suisui-swimmy");
    expect(html).toContain("本ツールは非公式のファンツールであり、画像、名称などに関する著作権は 任天堂 / クリーチャーズ / ゲームフリーク に帰属します");
    expect(html).toContain('class="app-footer-links"');
    expect(html).toContain('class="app-footer-version"');
    expect(html).toContain('role="radiogroup" aria-label="バトル形式とサジェスト基準"');
    expect(html).toContain('aria-label="シングル"');
    expect(html).toContain('aria-label="ダブル"');
    expect(html).toContain("assets/ui/single.svg");
    expect(html).toContain("assets/ui/double.svg");
    expect(html).toContain('href="https://championsbattledata.com/"');
    expect(html).toContain("Pokemon Champions Battle Data");
    expect(html).toContain("データ更新日: 未取得");
    expect(html).not.toContain("ゲームフリーク に帰属します。");
    expect(html).toContain('href="https://docs.google.com/forms/d/e/1FAIpQLSdTUyrAmTwrcarMfMt56RrcwH_g4r4WhowW0i60HDK5BflylQ/viewform?usp=header"');
    expect(html).toContain('href="https://x.com/peixe0307"');
    expect(html).toContain('href="https://github.com/suisui-swimmy/ChampionCreator"');
    expect(html).toContain("不具合報告");
    expect(html).toContain(" | ");
    expect(html).toContain("お問い合わせ");
    expect(html).not.toContain("不具合報告 / お問い合わせ");
    expect(html).toContain("assets/social/x-logo.svg");
    expect(html).toContain('aria-label="ChampionCreator GitHub リポジトリ"');
    expect(html).toContain("assets/social/github-invertocat-white.svg");
    expect(html).not.toContain("火力ライン結果");
    expect(html).not.toContain("pokemon-artwork-meta");
    expect(html).not.toContain("将来の詳細パネル用空き領域");
    expect(html.indexOf('aria-label="探索操作"')).toBeLessThan(html.indexOf('id="results-title"'));
  });

  it("shows manual badges inside S fields and decorates the overridden source inputs", () => {
    const target = {
      ...createDefaultTargetForm(),
      itemInput: "こだわりスカーフ",
      abilityInput: "すいすい",
    };
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerItemInput: "こだわりスカーフ",
            attackerAbilityInput: "すいすい",
            weather: "rain" as const,
            speedItemMultiplier: "0.5" as const,
            speedAbilityMultiplier: "1.5" as const,
            speedTargetItemMultiplier: "2" as const,
            speedTargetAbilityMultiplier: "0.5" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(
      <App initialTargetForm={target} initialScenarioForms={scenarios} />,
    );

    expect(html.match(/class="speed-multiplier-control is-manual"/g)).toHaveLength(4);
    expect(html.match(/class="select-trigger-value-badge"/g)).toHaveLength(4);
    expect(html.match(/class="speed-manual-badge"/g)).toHaveLength(4);
    expect(html.match(/speed-source-overridden/g)).toHaveLength(4);
    expect(html).toContain("1件の素早さ条件で持ち物のS補正を手動倍率に上書き中");
    expect(html).toContain("1件の素早さ条件で特性のS補正を手動倍率に上書き中");
    expect(html).toContain("この素早さ条件では持ち物のS補正を手動倍率に上書き中");
    expect(html).toContain("この素早さ条件では特性のS補正を手動倍率に上書き中");
    expect(html).not.toContain("speed-override-summary");
    expect(html).not.toContain("<del>");
    expect(html).not.toContain("両側の手動倍率は");
  });

  it("keeps the manual badge without inventing an automatic source", () => {
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            speedTargetItemMultiplier: "1.5" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(<App initialScenarioForms={scenarios} />);

    expect(html.match(/class="speed-multiplier-control is-manual"/g)).toHaveLength(1);
    expect(html.match(/class="select-trigger-value-badge"/g)).toHaveLength(1);
    expect(html.match(/class="speed-manual-badge"/g)).toHaveLength(1);
    expect(html).not.toContain("speed-override-summary");
    expect(html).not.toContain("speed-source-overridden");
  });

  it("keeps target override sources visible while the opponent is unresolved", () => {
    const target = {
      ...createDefaultTargetForm(),
      itemInput: "こだわりスカーフ",
    };
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerPokemonInput: "",
            speedTargetItemMultiplier: "0.5" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(
      <App initialTargetForm={target} initialScenarioForms={scenarios} />,
    );

    expect(html).toContain("speed-source-overridden");
    expect(html).toContain("1件の素早さ条件で持ち物のS補正を手動倍率に上書き中");
    expect(html).not.toContain("speed-override-summary");
  });

  it("keeps common and target speed conditions visible for a manual S target", () => {
    const scenarios = createDefaultScenarioForms();
    const speedScenario = scenarios[2];
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={scenarios.map((scenario) => scenario.id === speedScenario.id
          ? {
              ...scenario,
              attacks: scenario.attacks.map((attack) => ({
                ...attack,
                speedTargetMode: "manual" as const,
                speedTargetValue: 150,
              })),
            }
          : scenario)}
      />,
    );

    expect(html).toContain(">共通S条件</h3>");
    expect(html).toContain(">調整対象S条件</h3>");
    expect(html).not.toContain(">相手S条件</h3>");
    expect(html).not.toContain("相手S能力");
    expect(html).toContain(">任意S値</span>");
  });

  it("keeps the battle format selector native, accessible, and single-first", () => {
    const html = renderToStaticMarkup(<SuggestionFormatToggle />);

    expect(html).toMatch(/role="radiogroup" aria-label="バトル形式とサジェスト基準"/);
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*value="Singles"/);
    expect(html).toMatch(/type="radio"[^>]*value="Doubles"/);
    expect(html).toContain('aria-label="シングル"');
    expect(html).toContain('aria-label="ダブル"');
    expect(html).not.toContain("title=");
  });

  it("syncs every scenario attack to the header format while preserving individual overrides", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const scenarios = [
      {
        ...baseScenario,
        attacks: [
          baseScenario.attacks[0],
          { ...baseScenario.attacks[0], id: "attack-b", label: "攻撃B" },
        ],
      },
      {
        ...baseScenario,
        id: "scenario-b",
        label: "シナリオ2",
        attacks: [{ ...baseScenario.attacks[0], id: "attack-c", label: "攻撃C" }],
      },
    ];

    const synced = syncScenarioGameTypesToSuggestionFormat(scenarios, "Doubles");
    expect(synced.flatMap((scenario) => scenario.attacks.map((attack) => attack.gameType))).toEqual([
      "doubles",
      "doubles",
      "doubles",
    ]);

    const withIndividualOverride = synced.map((scenario, scenarioIndex) => (
      scenarioIndex === 0
        ? {
            ...scenario,
            attacks: scenario.attacks.map((attack, attackIndex) => (
              attackIndex === 1 ? { ...attack, gameType: "singles" as const } : attack
            )),
          }
        : scenario
    ));
    expect(withIndividualOverride[0].attacks.map((attack) => attack.gameType)).toEqual([
      "doubles",
      "singles",
    ]);
  });

  it("applies the existing Beat Up participant limit during header synchronization", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const beatUpAttack = {
      ...baseScenario.attacks[0],
      moveInput: "ふくろだたき",
      gameType: "doubles" as const,
      repeat: 4,
      requiredSurvivedHits: 4,
      beatUpParticipants: [
        { id: "attacker", source: "attacker" as const, pokemonInput: "", powerMode: "auto" as const, powerValue: 0 },
        { id: "party-1", source: "party" as const, pokemonInput: "コータス", powerMode: "auto" as const, powerValue: 0 },
        { id: "party-2", source: "party" as const, pokemonInput: "コノヨザル", powerMode: "auto" as const, powerValue: 0 },
        { id: "party-3", source: "party" as const, pokemonInput: "ピカチュウ", powerMode: "manual" as const, powerValue: 22 },
      ],
    };

    const [synced] = syncScenarioGameTypesToSuggestionFormat([
      { ...baseScenario, attacks: [beatUpAttack] },
    ], "Singles");

    expect(synced.attacks[0]).toMatchObject({
      gameType: "singles",
      repeat: 3,
      requiredSurvivedHits: 3,
    });
    expect(synced.attacks[0].beatUpParticipants).toHaveLength(3);
  });

  it("formats source update timestamps as JST dates and falls back when unavailable", () => {
    expect(formatUsageDataDateJst("2026-08-13T15:30:00Z")).toBe("2026-08-14");
    expect(formatUsageDataDateJst(undefined)).toBe("未取得");
    expect(formatUsageDataDateJst("not-a-date")).toBe("未取得");
  });

  it("uses loaded usage metadata in the footer and keeps an empty fallback unavailable", () => {
    const loadedHtml = renderToStaticMarkup(
      <App suggestionFormat="Doubles" usageData={usageDataFixture()} />,
    );
    const emptyHtml = renderToStaticMarkup(<App usageData={usageDataFixture("empty")} />);

    expect(loadedHtml).toContain("データ更新日: 2026-08-14");
    expect(loadedHtml).toMatch(/type="radio"[^>]*checked=""[^>]*value="Doubles"/);
    expect(emptyHtml).toContain("データ更新日: 未取得");
  });

  it("keeps nature usage ARIA explicit for listed, unlisted, unavailable, and real zero values", () => {
    const jolly = { label: "ようき", plus: "spe" as const, minus: "spa" as const };
    const hardy = { label: "がんばりや", plus: "atk" as const, minus: "atk" as const };

    expect(formatNatureModifierLabel(jolly)).toBe("S↑ C↓");
    expect(formatNatureModifierLabel(hardy)).toBe("補正なし");
    expect(formatNatureUsageAriaLabel(
      jolly,
      "Doubles",
      { kind: "listed", rank: 1, percentage: 66.2 },
    )).toBe("ようき｜S↑ C↓｜ダブル使用率 66.2%（1位）");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "listed", rank: 10, percentage: 0 },
    )).toBe("がんばりや｜補正なし｜ダブル使用率 0.0%（10位）");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "listed", rank: 10, percentage: null },
    )).toBe("がんばりや｜補正なし｜ダブル使用率 10位");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "unlisted" },
    )).toBe("がんばりや｜補正なし｜ダブル使用率 上位外／データなし");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "unavailable" },
    )).toBe("がんばりや｜補正なし｜使用率データなし");
    expect(getNatureUsageOverlayOpacity({ kind: "listed", rank: 1, percentage: 0 })).toBe(0);
    expect(getNatureUsageOverlayOpacity({ kind: "listed", rank: 1, percentage: null })).toBeNull();
    expect(getNatureUsageOverlayOpacity({ kind: "unlisted" })).toBeNull();
  });

  it("renders nature heatmaps for both owners while keeping tutorial matrices data-free", () => {
    const [defaultScenario] = createDefaultScenarioForms();
    const natureUsageData: ChampionsUsageData = {
      ...usageDataFixture("nature-test"),
      formats: {
        Singles: {
          Pikachu: {
            move: [],
            ability: [],
            item: [],
            nature: [
              { canonicalName: "Timid", rank: 2, percentage: 66.2 },
              { canonicalName: "Hardy", rank: 10, percentage: 0 },
            ],
          },
        },
        Doubles: {
          Pikachu: {
            move: [],
            ability: [],
            item: [],
            nature: [
              { canonicalName: "Jolly", rank: 1, percentage: 66.2 },
              { canonicalName: "Hardy", rank: 10, percentage: 0 },
            ],
          },
        },
      },
    };
    const initialTargetForm = {
      ...createDefaultTargetForm(),
      pokemonInput: "ピカチュウ",
      natureInput: "おくびょう",
    };
    const initialScenarioForms = [{
      ...defaultScenario,
      attacks: [{
        ...defaultScenario.attacks[0],
        attackerPokemonInput: "ピカチュウ",
        attackerNatureInput: "ようき",
      }],
    }];
    const html = renderToStaticMarkup(
      <App
        suggestionFormat="Doubles"
        usageData={natureUsageData}
        initialTargetForm={initialTargetForm}
        initialScenarioForms={initialScenarioForms}
      />,
    );

    // Radix portals intentionally omit the open matrix during SSR.  The
    // per-cell usage contract is covered by the pure formatting assertions
    // above; this render still guards that both owner fields remain present.
    expect(html.match(/class="nature-trigger"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="性格: おくびょう"');

    const tutorialHtml = renderToStaticMarkup(
      <App
        variant="tutorial"
        suggestionFormat="Doubles"
        usageData={natureUsageData}
        initialTargetForm={initialTargetForm}
        initialScenarioForms={initialScenarioForms}
      />,
    );

    expect(tutorialHtml).not.toContain("nature-usage-detail");
    expect(tutorialHtml).not.toContain("data-usage-kind");
    expect(tutorialHtml).not.toContain("nature-usage-opacity");
    expect(tutorialHtml.match(/class="nature-trigger"/g)).toHaveLength(2);
  });

  it("keeps usage heatmap color separate from selection and keyboard focus styles", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.nature-option::before\s*\{[^}]*background:\s*rgba\(32, 194, 108, 0\.72\);[^}]*opacity:\s*var\(--nature-usage-opacity, 0\);/s);
    expect(css).toMatch(/\.nature-option:hover\s*\{[^}]*border-color:[^}]*box-shadow:[^}]*color:[^}]*\}/s);
    expect(css).toMatch(/\.nature-option:focus-visible\s*\{[^}]*border-color:[^}]*box-shadow:/s);
    expect(css).toMatch(/\.nature-option\.selected\s*\{[^}]*border-color:[^}]*color:[^}]*box-shadow:/s);
    expect(css).not.toMatch(/\.nature-option:hover\s*\{[^}]*background:/s);
    expect(css).not.toMatch(/\.nature-option\.selected\s*\{[^}]*background:/s);
    expect(css).not.toContain(".nature-usage-detail");
  });

  it("keeps a compact power field beside every non-speed move input", () => {
    const html = renderExampleApp();
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(html.match(/class="attack-card-field-row attack-card-identity-row"/g)).toHaveLength(3);
    expect(html.match(/class="attack-card-field-row attack-move-power-cell"/g)).toHaveLength(2);
    expect(html.match(/class="attack-card-field-row attack-card-details-row"/g)).toHaveLength(3);
    expect(html.match(/class="attack-card-field-row attack-card-item-row"/g)).toHaveLength(3);
    expect(html.match(/class="move-power-inline-control is-readonly"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="威力 70"');
    expect(html).toContain('aria-label="威力 90"');
    expect(html).not.toContain('aria-label="素早さ調整A 威力');
    expect(css).toMatch(/\.attack-card-identity-row,\s*\.attack-move-power-cell\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(css).toMatch(/\.move-power-field\s*\{[^}]*grid-template-columns:\s*minmax\(52px, max-content\) minmax\(0, 1fr\);/s);
    expect(css).toMatch(/\.mobile-scenarios-open \.move-power-field\s*\{[^}]*grid-template-columns:\s*minmax\(54px, auto\) minmax\(0, 1fr\);/s);
    expect(html).toMatch(/attack-card-identity-row[^>]*>[\s\S]*?aria-label="ポケモン"[\s\S]*?<span class="row-label">レベル<\/span>/);
    expect(html.match(/aria-label="[^"]+ レベルの固定を解除"/g)).toHaveLength(4);
    expect(html).toMatch(/class="move-power-lock-toggle is-closed" type="button" tabindex="-1" aria-label="耐久調整A レベルの固定を解除"/);
    expect(html).toMatch(/attack-move-power-cell[^>]*>[\s\S]*?placeholder="技"[\s\S]*?move-power-field/);
    expect(html).toMatch(/move-power-field[^>]*aria-label="耐久調整A 威力"[^>]*>[\s\S]*?<span class="move-power-label">威力<\/span>[\s\S]*?move-power-inline-control is-readonly/);
    expect(html).toMatch(/attack-card-details-row[^>]*>[\s\S]*?aria-label="性格:[^"]+"[\s\S]*?aria-label="特性候補を開く"/);
    expect(html).toMatch(/attack-card-item-row[^>]*>[\s\S]*?placeholder="持ち物"/);

    const [scenario] = createDefaultScenarioForms();
    const calculationPendingHtml = renderToStaticMarkup(
      <App
        initialTargetForm={{ ...createDefaultTargetForm(), pokemonInput: "" }}
        initialScenarioForms={[{
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerPokemonInput: "",
            moveInput: "ふいうち",
          })),
        }]}
      />,
    );
    expect(calculationPendingHtml).toContain('aria-label="威力 70（基礎値・計算前）"');
  });

  it("matches the target form density to attack cards on desktop only", () => {
    const html = renderExampleApp();
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const desktopStart = css.indexOf("@media (min-width: 1181px)");
    const desktopEnd = css.indexOf("@media (max-width: 1180px)", desktopStart);
    const desktopCss = css.slice(desktopStart, desktopEnd);

    expect(html).toMatch(/class="target-summary compact"[\s\S]*?aria-label="ポケモン"[\s\S]*?aria-label="性格:[^"]+"[\s\S]*?placeholder="持ち物"[\s\S]*?aria-label="特性候補を開く"[\s\S]*?>レベル<\/span>/);
    expect(css).toMatch(/\.workbench\s*\{[^}]*grid-template-columns:\s*468px minmax\(0, 1fr\);/s);
    expect(desktopStart).toBeGreaterThanOrEqual(0);
    expect(desktopEnd).toBeGreaterThan(desktopStart);
    expect(desktopCss).toMatch(/\.target-identity,\s*\.target-summary\.compact\s*\{[^}]*gap:\s*6px;/s);
    expect(desktopCss).toMatch(/\.target-summary\.compact > \.pokemon-autocomplete-field,[\s\S]*?height:\s*28px;[\s\S]*?padding:\s*0 7px;[\s\S]*?font-size:\s*12px;/s);
    expect(desktopCss).toMatch(/\.target-level-field,\s*\.placeholder-field\.target-level-field\s*\{[^}]*grid-template-columns:\s*52px minmax\(0, 1fr\);[^}]*gap:\s*6px;/s);
    expect(desktopCss).toMatch(/\.target-level-field \.level-inline-control\s*\{[^}]*height:\s*28px;/s);
    expect(desktopCss).toMatch(/\.target-level-field \.move-power-lock-toggle\s*\{[^}]*width:\s*22px;/s);
    expect(css.slice(desktopEnd)).toMatch(/\.workbench\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });

  it("uses the power-lock design for an unlocked level without adding it to the Tab order", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerLevel: 73,
            attackerLevelMode: "manual" as const,
          })),
        }]}
      />,
    );

    expect(html).toContain("level-inline-control is-manual");
    expect(html).toMatch(/<input(?=[^>]*value="73")(?=[^>]*tabindex="-1")(?=[^>]*aria-label="レベル")[^>]*>/);
    expect(html).toContain('aria-label="耐久調整A レベルを50に戻して固定"');
    expect(html).toContain('src="/assets/ui/lock-open.svg"');
    expect(html).not.toContain('aria-label="耐久調整A レベルを50に戻して固定" disabled=""');
  });

  it("uses the same unlocked level field in the target panel", () => {
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={{
          ...createDefaultTargetForm(),
          level: 73,
          levelMode: "manual",
        }}
        initialScenarioForms={createDefaultScenarioForms()}
      />,
    );

    expect(html).toMatch(/class="placeholder-field target-level-field"[\s\S]*?level-inline-control is-manual/);
    expect(html).toMatch(/<input(?=[^>]*value="73")(?=[^>]*tabindex="-1")(?=[^>]*aria-label="レベル")[^>]*>/);
    expect(html).toContain('aria-label="調整対象 レベルを50に戻して固定"');
    expect(html).not.toContain('aria-label="調整対象 レベルを50に戻して固定" disabled=""');
  });

  it("shows assisted and HP-dependent powers through the same compact field", () => {
    const [scenario] = createDefaultScenarioForms();
    const lastRespectsScenario = {
      ...scenario,
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        moveInput: "おはかまいり",
        movePowerMode: "assisted" as const,
        movePowerValue: 150,
      })),
    };
    const lastRespectsHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[lastRespectsScenario]}
      />,
    );

    expect(lastRespectsHtml).toContain('class="move-power-field steppable"');
    expect(lastRespectsHtml).toContain('aria-label="耐久調整A 威力 150（条件: ひんしの味方 2体）。条件を開く"');
    expect(lastRespectsHtml).toMatch(/class="move-power-trigger" type="button" tabindex="-1" aria-label="耐久調整A 威力 150/);
    expect(lastRespectsHtml).toContain('aria-label="耐久調整A 威力条件を上げる: ひんしの味方 3体"');
    expect(lastRespectsHtml).toContain('aria-label="耐久調整A 威力条件を下げる: ひんしの味方 1体"');
    expect(lastRespectsHtml).toContain("▲");
    expect(lastRespectsHtml).toContain("▼");

    const eruptionScenario = {
      ...scenario,
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        moveInput: "ふんか",
        movePowerMode: "auto" as const,
        movePowerValue: 0,
      })),
    };
    const eruptionHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[eruptionScenario]}
      />,
    );

    expect(eruptionHtml).toContain('aria-label="耐久調整A 威力の自動入力を解除"');
    expect(eruptionHtml).toMatch(/class="move-power-lock-toggle is-closed" type="button" tabindex="-1" aria-label="耐久調整A 威力の自動入力を解除"/);
    expect(eruptionHtml).toContain(
      '<strong>150</strong><button class="move-power-lock-toggle is-closed"',
    );
    expect(eruptionHtml).toContain('src="/assets/ui/lock.svg"');
    expect(eruptionHtml).not.toContain("技の威力設定");
    expect(eruptionHtml).not.toContain('<small>HP</small>');
    expect(eruptionHtml).not.toContain("威力条件ステッパー");

    const incompleteEruptionHtml = renderToStaticMarkup(
      <App
        initialTargetForm={{ ...createDefaultTargetForm(), pokemonInput: "" }}
        initialScenarioForms={[{
          ...eruptionScenario,
          attacks: eruptionScenario.attacks.map((attack) => ({
            ...attack,
            attackerPokemonInput: "",
          })),
        }]}
      />,
    );
    expect(incompleteEruptionHtml).toContain('<strong>150</strong><button class="move-power-lock-toggle is-closed"');

    const manualEruptionHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...eruptionScenario,
          attacks: eruptionScenario.attacks.map((attack) => ({
            ...attack,
            movePowerMode: "manual" as const,
            movePowerValue: 87,
          })),
        }]}
      />,
    );
    expect(manualEruptionHtml).toContain('aria-label="耐久調整A 任意威力"');
    expect(manualEruptionHtml).toMatch(/<input[^>]*tabindex="-1"[^>]*aria-label="耐久調整A 任意威力"/);
    expect(manualEruptionHtml).toContain('aria-label="耐久調整A 威力を自動入力に戻す"');
    expect(manualEruptionHtml).toContain('src="/assets/ui/lock-open.svg"');
  });

  it("formats the actually applied power without mixing it with damage", () => {
    expect(formatMovePowerEvaluation({
      catalogBasePower: 65,
      appliedBasePower: 130,
      source: "automatic",
    })).toBe("基礎威力 65 → 適用威力 130（自動計算）");
    expect(formatMovePowerEvaluation({
      catalogBasePower: 50,
      appliedBasePower: 300,
      source: "assisted",
      detailLabel: "ひんしの味方 5体",
    })).toBe("威力 300（条件: ひんしの味方 5体）");
    expect(formatMovePowerEvaluation({
      catalogBasePower: 20,
      appliedBasePower: 120,
      source: "automatic",
      perHitBasePowers: [20, 40, 60],
    })).toBe("威力 20→40→60（各ヒット）");
    expect(formatMovePowerEvaluation({
      catalogBasePower: 150,
      appliedBasePower: 150,
      source: "automatic",
    }, { hpDependent: true })).toBe("HP依存威力（満タン時 150・各攻撃直前に自動計算）");
    expect(formatMovePowerEvaluation({ catalogBasePower: 0, source: "fixed-damage" }))
      .toBe("固定ダメージ（数値威力なし）");
    expect(formatMovePowerEvaluation(
      { catalogBasePower: 0, source: "fixed-damage" },
      { hpDependent: true },
    )).toBe("固定ダメージ（数値威力なし・各攻撃直前のHPで自動計算）");
    expect(formatMovePowerEvaluation({ catalogBasePower: 0, source: "status" }))
      .toBe("変化技（数値威力なし）");
    expect(formatMovePowerEvaluation({ catalogBasePower: 0, source: "unsupported" }))
      .toBe("個別威力（現在の計算には未対応）");
  });

  it("shows Beat Up power and opens its participant settings", () => {
    const [scenario] = createDefaultScenarioForms();
    const beatUpAttack = applyMoveInputDefaults(scenario.attacks[0], "ふくろだたき", true);
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...scenario,
          attacks: [beatUpAttack],
        }]}
      />,
    );

    expect(html).toContain("ふくろだたき参加ポケモンを設定。威力 18");
    expect(html).toMatch(/class="move-power-trigger" type="button" tabindex="-1" aria-label="耐久調整A ふくろだたき参加ポケモンを設定/);
    expect(html).toContain("<strong>18</strong>");
    expect(html).toContain('disabled="" aria-label="攻撃回数" value="1"');
  });

  it("keeps HP events collapsed in attack cards and summarizes them on mobile", () => {
    const [defenceScenario, ...rest] = createDefaultScenarioForms();
    const scenarios = [
      {
        ...defenceScenario,
        attacks: defenceScenario.attacks.map((attack, index) => index === 0 ? {
          ...attack,
          hpEvents: [{
            id: "sand-after-hit",
            effectId: "sandstorm-damage",
            enabled: true,
          }, {
            id: "life-orb-after-move",
            effectId: "life-orb-recoil",
            enabled: true,
          }],
        } : attack),
      },
      ...rest,
    ];

    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={scenarios}
      />,
    );

    expect(html).toContain("<summary>");
    expect(html).toContain(">定数ダメージ・回復</span>");
    expect(html).toContain(">2件</span>");
    expect(html).toContain("すなあらしダメージ");
    expect(html).toContain("いのちのたま反動");
    expect(html).toContain("icon-button scenario-remove-button hp-event-remove-button");
    expect(html).toContain("最大HPの1/16（切り捨て・最低1）");
    expect(html).toContain("ターン終了時・ターンごと");
    expect(html).toContain("技使用後・技ごと");
    expect(html).toContain("<strong>対象</strong><span>仮想敵（技使用者）</span>");
    expect(html).toContain("<strong>対象</strong><span>調整対象（被弾側）</span>");
    expect(html).not.toContain("直前の技使用後 → 今回の攻撃前に1回");
    expect(html).not.toMatch(/select-field-label[^>]*>対象<\/span>/);
    expect(html).not.toMatch(/select-field-label[^>]*>タイミング<\/span>/);
    expect(html).toContain("効果2");
  });

  it("shows offense HP event targets from each effect without a subject selector", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const offenseScenario = {
      ...baseScenario,
      adjustmentType: "offense" as const,
      attacks: baseScenario.attacks.map((attack) => ({
        ...attack,
        hpEvents: [{
          id: "offense-life-orb",
          effectId: "life-orb-recoil",
          enabled: true,
        }, {
          id: "offense-sand",
          effectId: "sandstorm-damage",
          enabled: true,
        }],
      })),
    };

    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[offenseScenario]}
      />,
    );

    expect(html).toContain("<strong>対象</strong><span>調整対象（技使用者）</span>");
    expect(html).toContain("<strong>対象</strong><span>仮想敵（被弾側）</span>");
    expect(html).not.toMatch(/select-field-label[^>]*>対象<\/span>/);
  });

  it("shows contact damage presets with fixed subjects and timing", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const target = {
      ...createDefaultTargetForm(),
      abilityInput: "さめはだ",
      itemInput: "ゴツゴツメット",
    };
    const scenario = {
      ...baseScenario,
      attacks: baseScenario.attacks.map((attack) => ({
        ...attack,
        moveInput: "すいりゅうれんだ",
        hpEvents: [{
          id: "rocky-helmet",
          effectId: "rocky-helmet-damage",
          enabled: true,
        }, {
          id: "rough-skin",
          effectId: "rough-skin-damage",
          enabled: true,
        }],
      })),
    };

    const html = renderToStaticMarkup(
      <App initialTargetForm={target} initialScenarioForms={[scenario]} />,
    );
    const mismatchHtml = renderToStaticMarkup(
      <App
        initialTargetForm={{
          ...createDefaultTargetForm(),
          abilityInput: "",
          itemInput: "",
        }}
        initialScenarioForms={[scenario]}
      />,
    );
    const offenseHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...scenario,
          adjustmentType: "offense",
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerAbilityInput: "さめはだ",
            attackerItemInput: "ゴツゴツメット",
          })),
        }]}
      />,
    );

    expect(html).toContain("ゴツゴツメット");
    expect(html).toContain("さめはだ／てつのトゲ");
    expect(html).toContain("接触ヒットごとに技使用者の最大HPの1/6（切り捨て・最低1）");
    expect(html).toContain("接触ヒットごとに技使用者の最大HPの1/8（切り捨て・最低1）");
    expect(html.match(/<strong>対象<\/strong><span>仮想敵（技使用者）<\/span>/g)).toHaveLength(2);
    expect(offenseHtml.match(/<strong>対象<\/strong><span>調整対象（技使用者）<\/span>/g)).toHaveLength(2);
    expect(html.match(/<strong>発動<\/strong><span>ヒット後・ヒットごと<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain("被弾側の持ち物が「ゴツゴツメット」ではありません");
    expect(html).not.toContain("被弾側の特性が「さめはだ／てつのトゲ」ではありません");
    expect(mismatchHtml).toContain("被弾側の持ち物が「ゴツゴツメット」ではありません。発動前提で計算します");
    expect(mismatchHtml).toContain("被弾側の特性が「さめはだ／てつのトゲ」ではありません。発動前提で計算します");
    expect(html).toContain("ガイドの定数ダメージ・回復");
    expect(html).toContain('href="/guide/#constant-damage"');
    expect(html).not.toContain("ゴツゴツメット・さめはだ／てつのトゲの接触判定は、選択技・えんかく・ぼうごパット・パンチグローブから自動判定します。");
  });

  it("keeps current-HP move recalculation separate from configured HP effects", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const baseAttack = baseScenario.attacks[0];
    const scenario = {
      ...baseScenario,
      attacks: [
        {
          ...baseAttack,
          id: "automatic-cost",
          attackerPokemonInput: "ミュウ",
          moveInput: "みがわり",
        },
        {
          ...baseAttack,
          id: "automatic-current-hp",
          attackerPokemonInput: "イーユイ",
          moveInput: "カタストロフィ",
        },
        {
          ...baseAttack,
          id: "automatic-recoil",
          attackerPokemonInput: "ピカチュウ",
          moveInput: "ワイルドボルト",
        },
        {
          ...baseAttack,
          id: "automatic-faint",
          attackerPokemonInput: "ムクホーク",
          moveInput: "いのちがけ",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[scenario]}
      />,
    );

    expect(html).not.toContain(">自動1件</span>");
    expect(html).not.toContain(">自動2件</span>");
    expect(html).not.toContain(">技から自動適用</p>");
    expect(html).not.toContain("みがわりのHP消費");
    expect(html).not.toContain("最大HPの1/4（切り捨て・最低1）");
    expect(html).not.toContain("カタストロフィの現在HP計算");
    expect(html).not.toContain("相手の現在HPの1/2（切り捨て・最低1）");
    expect(html).not.toContain("ワイルドボルトの反動");
    expect(html).not.toContain("実際に与えたダメージの1/4（四捨五入・最低1）");
    expect(html).not.toContain("いのちがけの現在HP計算");
    expect(html).not.toContain("使用者の現在HP");
    expect(html).not.toContain("いのちがけの使用者ひんし");
    expect(html).not.toContain("ダメージを与えた使用者がひんし");
    expect(html).not.toContain('class="hp-event-auto-badge"');
    expect(html).not.toContain("<strong>適用</strong><span>選択技から自動</span>");
    expect(html).not.toContain('aria-label="みがわりのHP消費を削除"');
    expect(html).not.toContain('aria-label="ワイルドボルトの反動を削除"');
    expect(html.match(/>定数ダメージ・回復<\/span><span class="active-adjustment-empty">なし<\/span>/g)).toHaveLength(4);
    expect(html.match(/HP依存技は、変化後のHPから自動計算されます。/g)).toHaveLength(2);
    expect(html).not.toContain("HP変化自動1");
    expect(html).not.toContain("HP変化自動2");
    expect(html).toContain("対象・発動順・頻度などの詳しい仕様は");
    expect(html).toContain("ガイドの定数ダメージ・回復");
    expect(html).not.toContain("現在HP依存の直接ダメージ・威力は選択技から自動計算します。");
    expect(html).not.toContain("技使用者側の技固有反動・HP消費・使用者ひんしは、通常の耐久・火力ラインへ自動では含めません。");
  });

  it("starts with the same blank condition shown by the empty box slot", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('aria-label="性格: 未選択"');
    expect(html).toContain('aria-label="シナリオ1 調整種別"');
    expect(html).not.toContain('aria-label="シナリオ2 調整種別"');
    expect(html).not.toContain('value="メガマフォクシー"');
    expect(html).not.toContain('value="ドドゲザン"');
    expect(html).not.toContain('value="メガゲンガー"');
    expect(html).not.toContain('value="サイコキネシス"');
  });

  it("shows an accessible restore-or-discard dialog only in the default app", () => {
    const draft = createDraftStorageDocument(
      { ...createDefaultTargetForm(), pokemonInput: "オオニューラ" },
      createDefaultScenarioForms(),
      new Date("2026-08-17T03:04:05.000Z"),
    );
    const values = new Map([[DRAFT_STORAGE_KEY, JSON.stringify(draft)]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    vi.stubGlobal("localStorage", storage);

    try {
      const html = renderToStaticMarkup(<App />);
      const tutorialHtml = renderToStaticMarkup(
        <App
          variant="tutorial"
          initialTargetForm={draft.payload.target}
          initialScenarioForms={draft.payload.scenarios}
        />,
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="draft-recovery-title"');
      expect(html).toContain('aria-describedby="draft-recovery-description"');
      expect(html).toContain("保存した下書きがあります");
      expect(html).toContain("前回の入力条件をこのブラウザから復元できます。");
      expect(html).toContain("下書きを復元");
      expect(html).toContain("下書きを破棄");
      expect(html).toContain("オオニューラ");
      expect(tutorialHtml).not.toContain("draft-recovery-overlay");
      expect(tutorialHtml).not.toContain("下書きを復元");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps corrupt drafts explicit and the recovery dialog narrow-width safe", () => {
    const html = renderToStaticMarkup(
      <DraftRecoveryDialog
        recovery={{
          status: "error",
          reason: "corrupt",
          message: "前回の下書きを読み込めませんでした: broken JSON",
        }}
        onRestore={() => undefined}
        onDiscard={() => undefined}
        onDismissUnavailable={() => undefined}
      />,
    );
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(html).toContain("下書きを読み込めませんでした");
    expect(html).toContain("下書きを破棄");
    expect(html).not.toContain("下書きを復元");
    expect(css).toMatch(/\.draft-recovery-window\s*\{[^}]*width:\s*min\(480px, calc\(100vw - 36px\)\);[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.draft-recovery-actions\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });

  it("documents the current save and sync flow without exposing development milestones", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const guide = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const privacy = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");
    const firebaseSetup = readFileSync(new URL("../docs/FIREBASE_SETUP.md", import.meta.url), "utf8");

    for (const document of [readme, guide]) {
      expect(document).toContain("作業中の下書き");
      expect(document).toContain("下書きを復元");
      expect(document).toContain("下書きを破棄");
      expect(document).toContain("計算結果");
      expect(document).toContain("候補一覧");
      expect(document).toContain("ブラウザ別クラウド下書き");
      expect(document).toContain("約0.75秒");
      expect(document).toContain("ボックスに保存済み");
      expect(document).toContain("初回統合");
      expect(document).toContain("Googleでログイン");
      expect(document).toContain("Firestore");
      expect(document).toContain("JSONバックアップ");
      expect(document).toContain("競合あり");
      expect(document).toContain("クラウド全体を置き換え");
      expect(document).toContain("削除済み");
      expect(document).toContain("アカウントデータ");
      expect(document).toContain("プライバシー");
    }

    for (const label of ["統合", "クラウドを使用", "このブラウザを使用", "あとで決める"]) {
      expect(readme).toContain(`\`${label}\``);
      expect(guide).toContain(`<code>${label}</code>`);
    }
    for (const label of ["このブラウザのみ", "未同期", "同期中…", "同期済み", "オフライン", "競合あり", "同期エラー"]) {
      expect(readme).toContain(`\`${label}\``);
      expect(guide).toContain(`<code>${label}</code>`);
    }

    expect(readme).toContain("未送信操作を順番に保持するキュー（`outbox`）");
    expect(readme).toContain("削除済みと記録します（`tombstone`）");
    expect(readme).toContain("保存内容のJSON文字列（`payload`）");
    expect(readme).toContain("`syncRecords`");
    expect(readme).toContain("`drafts`");
    expect(readme).toContain("Firebase Authenticationのアカウントを削除します");

    expect(privacy).toContain("ブラウザ内保存");
    expect(privacy).toContain("<code>syncRecords</code>");
    expect(privacy).toContain("<code>drafts</code>");
    expect(privacy).toContain("Google Analytics 4");
    expect(privacy).toContain("Google Fonts");
    expect(privacy).toContain("App Check");
    expect(privacy).toContain("<code>アカウントデータを書き出す</code>");
    expect(privacy).toContain("<code>アカウントを削除</code>");

    expect(firebaseSetup).toContain("## 既存ブラウザ内保存の初回統合");
    expect(firebaseSetup).toContain("## ボックス同期");
    expect(firebaseSetup).toContain("## ブラウザ別クラウド下書き");
    expect(firebaseSetup).toContain("## アカウント・同期ライフサイクル");
    expect(firebaseSetup).toContain("## 本番公開とApp Check");
    expect(firebaseSetup).toContain("Cloud FirestoreとAuthenticationのApp Check enforcement");

    for (const document of [readme, guide, privacy, firebaseSetup]) {
      expect(document).not.toMatch(/SYNC-M|\bM\d+(?:\.\d+)?\b/);
      expect(document).not.toContain("controller");
      expect(document).not.toContain("runtime gate");
      expect(document).not.toContain("`completed`");
    }

    for (const document of [readme, guide, privacy]) {
      expect(document).toContain("表示名");
      expect(document).toContain("メールアドレス");
      expect(document).toContain("プロフィール画像");
      expect(document).toContain("Google Drive");
      expect(document).toContain("Gmail");
      expect(document).not.toContain("追加scope");
    }
  });

  it("keeps the privacy title on one line and follows the guide scroll spy contract", () => {
    const privacyHtml = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");
    const privacyMain = readFileSync(new URL("./privacy/main.ts", import.meta.url), "utf8");
    const guideCss = readFileSync(new URL("./guide/guide.css", import.meta.url), "utf8");

    expect(privacyHtml).toContain('<body class="guide-page privacy-page">');
    expect(privacyHtml).toContain("<h1>プライバシーとデータの取り扱い</h1>");
    expect(privacyHtml).not.toContain("プライバシーと<br");
    expect(privacyMain).toContain('import { getActiveGuideSectionIndex } from "../guide/scrollSpy"');
    expect(privacyMain).toContain('window.addEventListener("scroll", scheduleActiveTocUpdate, { passive: true })');
    expect(privacyMain).toContain('link.setAttribute("aria-current", "location")');
    expect(guideCss).toMatch(/\.privacy-page \.guide-intro h1\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.privacy-page \.guide-intro h1\s*\{[^}]*font-size:\s*clamp\(18px, 6vw, 23px\);/s);
  });

  it("maps mobile scenario direction icons by adjustment type", () => {
    expect(getMobileScenarioDirectionIconPath("defence", false)).toBe("assets/ui/arrow-left-circle.svg");
    expect(getMobileScenarioDirectionIconPath("offense", false)).toBe("assets/ui/arrow-right-circle.svg");
    expect(getMobileScenarioDirectionIconPath("speed", false)).toBe("assets/ui/arrow-up-circle.svg");
    expect(getMobileScenarioDirectionIconPath("speed", true)).toBe("assets/ui/arrow-down-circle.svg");
  });

  it("limits mobile scenario detail sheets to the selected scenario", () => {
    const scenarios = createDefaultScenarioForms();
    const twoAttackScenario = {
      ...scenarios[1],
      attacks: [
        scenarios[1].attacks[0],
        { ...scenarios[1].attacks[0], id: "attack-b", label: "攻撃B" },
      ],
    };

    expect(getScenarioPanelVisibleScenarios(scenarios, scenarios[1].id).map((scenario) => scenario.label))
      .toEqual(["シナリオ2"]);
    expect(getScenarioPanelVisibleScenarios(scenarios, null).map((scenario) => scenario.label))
      .toEqual(["シナリオ1", "シナリオ2", "シナリオ3"]);
    expect(getScenarioPanelVisibleScenarios(scenarios, "missing-scenario").map((scenario) => scenario.label))
      .toEqual(["シナリオ1", "シナリオ2", "シナリオ3"]);
    expect(getMobileAttackNavigationTargets(twoAttackScenario, "attack-b")).toEqual({
      currentIndex: 1,
      currentId: "attack-b",
      currentLabel: "火力調整B",
      total: 2,
      previousId: scenarios[1].attacks[0].id,
      nextId: null,
      nextLabel: "火力調整C",
    });
    expect(getMobileAttackNavigationTargets(scenarios[0], scenarios[0].attacks[0].id)?.previousId).toBeNull();
    expect(getMobileAttackNavigationTargets({ ...scenarios[0], attacks: [] })).toBeNull();
  });

  it("creates added scenarios as enabled by default and accepts the current header format", () => {
    const scenario = createScenario(3);
    const doublesScenario = createScenario(4, "doubles");

    expect(scenario).toMatchObject({
      label: "シナリオ4",
      enabled: true,
      adjustmentType: "defence",
    });
    expect(doublesScenario).toMatchObject({
      label: "シナリオ5",
      enabled: true,
      attacks: [{ gameType: "doubles" }],
    });
  });

  it("defaults opponent S SP to 32 when a scenario becomes a speed adjustment", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = applyScenarioAdjustmentTypeDefaults({
      ...scenario,
      adjustmentType: "defence",
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        attackerStatPoints: { ...attack.attackerStatPoints, spe: 0 },
        speedOrderMode: "trick-room" as const,
        speedTargetTailwind: true,
        speedOpponentTailwind: true,
      })),
    }, "speed");

    expect(speedScenario.adjustmentType).toBe("speed");
    expect(speedScenario.attacks[0].attackerStatPoints.spe).toBe(32);
    expect(speedScenario.attacks[0].speedOrderMode).toBe("normal");
    expect(speedScenario.attacks[0].speedTargetTailwind).toBe(false);
    expect(speedScenario.attacks[0].speedOpponentTailwind).toBe(false);
  });

  it("defaults opponent S SP to 0 for Trick Room speed adjustment", () => {
    const speedAttack = {
      ...createDefaultScenarioForms()[2].attacks[0],
      attackerStatPoints: {
        ...createDefaultScenarioForms()[2].attacks[0].attackerStatPoints,
        spe: 32,
      },
    };

    const trickRoomAttack = applySpeedOrderModeDefaults(speedAttack, "trick-room");
    expect(trickRoomAttack.speedOrderMode).toBe("trick-room");
    expect(trickRoomAttack.attackerStatPoints.spe).toBe(0);

    const normalAttack = applySpeedOrderModeDefaults(trickRoomAttack, "normal");
    expect(normalAttack.speedOrderMode).toBe("normal");
    expect(normalAttack.attackerStatPoints.spe).toBe(32);
  });

  it("marks Trick Room speed scenarios in the mobile overview", () => {
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            speedOrderMode: "trick-room" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(<App initialScenarioForms={scenarios} />);

    expect(html).toContain('class="mobile-scenario-flow-row speed trick-room"');
    expect(html).toContain('aria-label="シナリオ3: 素早さ調整（トリックルーム）。タップで次の調整種別に切り替え"');
  });

  it("does not overwrite manually edited opponent S SP for Trick Room", () => {
    const speedAttack = {
      ...createDefaultScenarioForms()[2].attacks[0],
      attackerStatPoints: {
        ...createDefaultScenarioForms()[2].attacks[0].attackerStatPoints,
        spe: 12,
      },
    };

    const trickRoomAttack = applySpeedOrderModeDefaults(speedAttack, "trick-room");
    expect(trickRoomAttack.attackerStatPoints.spe).toBe(12);
  });

  it("normalizes full-width numeric input text before parsing", () => {
    expect(normalizeNumericInputText("１２３４５")).toBe("12345");
    expect(normalizeNumericInputText(" ＋１２．５ ")).toBe("+12.5");
    expect(normalizeNumericInputText("－６")).toBe("-6");
  });

  it("renders exact 32-cell SP allocation sliders", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemax="32"');
    expect(html).toContain('aria-label="H SP配分"');
    expect(html).toContain('class="sp-cell-bar hp"');
    expect(html).toContain(">ランク<");
    expect(html).toContain('aria-label="Bランク: 0"');
    expect(html).toContain('aria-label="Dランク: 0"');
    expect(html).not.toContain("assets/ui/lock-open.svg");
    expect(html).not.toContain("assets/ui/lock-closed.svg");
    expect(html).not.toContain('class="allocation-lock');
    expect(html).not.toContain("固定状態");
    expect(html).not.toContain('aria-label="状態異常: なし"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
  });

  it("renders only A and C parameter rows for each virtual attacker", () => {
    const html = renderExampleApp();

    expect(html).toContain(">耐久条件<");
    expect(html).toContain(">状況条件<");
    expect(html).toContain('aria-label="耐久調整A 能力"');
    expect(html.indexOf(">状況条件<")).toBeLessThan(html.indexOf('class="attack-stat-section'));
    expect(html).not.toContain('id="scenario-defence-attack-a-stat-title">能力</h3>');
    expect(html).toContain(">調整対象条件<");
    expect(html).toContain(">耐久回数<");
    expect(html).toContain(">耐久確率<");
    expect(html).not.toContain("<span>詳細補正</span>");
    expect(html).not.toContain(">補正なし<");
    expect(html).toContain(">攻撃回数<");
    expect(html).toContain('aria-label="耐久調整A 参照能力"');
    expect(html).toContain('aria-label="耐久調整A A SP"');
    expect(html).toContain('aria-label="耐久調整A Aランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A C SP"');
    expect(html).not.toContain('aria-label="耐久調整A Cランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A H SP"');
    expect(html).not.toContain('aria-label="耐久調整A B SP"');
    expect(html).not.toContain('aria-label="耐久調整A D SP"');
    expect(html).not.toContain('aria-label="耐久調整A S SP"');
    expect(html).not.toContain('aria-label="耐久調整A Bランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A Dランク: 0"');
    expect(html).toContain('aria-label="耐久調整A 調整対象条件"');
    expect(html).toContain('aria-label="耐久調整A 調整対象Bランク: 0"');
    expect(html).toContain('aria-label="耐久調整A 調整対象Dランク: 0"');
    expect(html).not.toContain("（この攻撃のみ）");
  });

  it("shows only relevant defender stats for offense adjustment moves", () => {
    expect(getOffenseDefenderStatKeys("サイコキネシス")).toEqual(["hp", "spd"]);
    expect(getOffenseDefenderStatKeys("ふいうち")).toEqual(["hp", "def"]);
    expect(getOffenseDefenderStatKeys("イカサマ")).toEqual(["hp", "atk", "def"]);
    expect(getOffenseDefenderStatKeys("ジャイロボール")).toEqual(["hp", "def", "spe"]);
    expect(getOffenseDefenderStatKeys("")).toEqual(["hp", "def", "spd"]);

    const html = renderExampleApp();

    expect(html).toContain('aria-label="火力調整A 仮想敵能力"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵D SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵Dランク: 0"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵A SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵B SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵C SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵S SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵Bランク');
  });

  it("renders nature stat modifiers beside target and attacker SP fields", () => {
    expect(getNatureModifierDirection("ひかえめ", "spa")).toBe("up");
    expect(getNatureModifierDirection("ひかえめ", "atk")).toBe("down");
    expect(getNatureModifierDirection("いじっぱり", "atk")).toBe("up");
    expect(getNatureModifierDirection("いじっぱり", "spa")).toBe("down");
    expect(getNatureModifierDirection("おくびょう", "spe")).toBe("up");
    expect(getNatureModifierDirection("おくびょう", "atk")).toBe("down");
    expect(getNatureModifierDirection("ひかえめ", "hp")).toBeNull();
    expect(getNatureModifierDirection("がんばりや", "atk")).toBeNull();

    const html = renderExampleApp();

    expect(html).toContain('class="nature-stat-modifier up" aria-label="S 上昇"');
    expect(html).toContain('class="nature-stat-modifier down" aria-label="A 下降"');
    expect(html).toContain('class="nature-stat-modifier up" aria-label="A 上昇"');
    expect(html).not.toContain('class="nature-stat-modifier down" aria-label="C 下降"');
  });

  it("marks only non-empty unresolved entity inputs as invalid", () => {
    expect(isUnresolvedEntityInput("pokemon", "テラスタイプ")).toBe(true);
    expect(isUnresolvedEntityInput("pokemon", "メガスターミー")).toBe(false);
    expect(isUnresolvedEntityInput("item", "")).toBe(false);
  });

  it("caps target SP edits at the total 66 budget", () => {
    expect(clampTargetStatPointChange({
      hp: 10,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "hp", 32)).toBe(26);

    expect(clampTargetStatPointChange({
      hp: 26,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "atk", 5)).toBe(5);
  });

  it("renders candidate H/A/B/C/D/S SP values", () => {
    const html = renderToStaticMarkup(<CandidateStatPointSpread statPoints={{
      hp: 0,
      atk: 12,
      def: 16,
      spa: 20,
      spd: 32,
      spe: 4,
    }} />);

    expect(html).toContain('aria-label="H 0 / A 12 / B 16 / C 20 / D 32 / S 4 SP"');
    expect(html).toContain('class="candidate-stat-value hp"');
    expect(html).toContain(">H</span><span>0</span>");
    expect(html).toContain(">A</span><span>12</span>");
    expect(html).toContain(">C</span><span>20</span>");
    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 0 / A 12 / B 16 / C 20 / D 32 / S 4"');
  });

  it("renders compact SP bars for candidate rows", () => {
    const html = renderToStaticMarkup(<CandidateStatPointBars statPoints={{
      hp: 9,
      atk: 0,
      def: 30,
      spa: 7,
      spd: 0,
      spe: 0,
    }} />);

    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 9 / A 0 / B 30 / C 7 / D 0 / S 0"');
    expect(html).toContain('class="candidate-sp-bar hp"');
    expect(html).toContain('style="width:28.125%"');
    expect(html).toContain('class="candidate-sp-bar def"');
    expect(html).toContain('style="width:93.75%"');
    expect(html).toContain('class="candidate-sp-bar spa"');
  });

  it("renders only the first 20 result candidates on the initial page", () => {
    const [scenario] = createDefaultScenarioForms();
    const candidates: CandidateResult[] = Array.from({ length: 25 }, (_, index) => {
      const rank = index + 1;
      return {
        id: `candidate-${rank}`,
        rank,
        candidate: { hp: rank, def: 0, spd: 0 },
        bulkScore: { overallBulk: rank, physicalBulk: rank, specialBulk: rank },
        appliedStatPoints: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        appliedEvs: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        usedStatPointBudget: rank,
        remainingStatPointBudget: 66 - rank,
        usedEvBudget: rank,
        remainingEvBudget: 66 - rank,
        passed: true,
        scenarioResults: [],
        bottleneckLabel: `表示候補${rank}`,
      };
    });

    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={candidates}
        passingCandidateCount={25}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("候補 25 件 / 1-20 件目");
    expect(html).toContain("1 / 2");
    expect(html).toContain("表示候補20");
    expect(html).not.toContain("表示候補21");
  });

  it("keeps the mobile candidate workflow inline with five candidates per page", () => {
    const [scenario] = createDefaultScenarioForms();
    const candidates: CandidateResult[] = Array.from({ length: 12 }, (_, index) => {
      const rank = index + 1;
      const usedStatPointBudget = rank === 1 ? 33 : rank === 2 ? 64 : rank === 3 ? 0 : rank;
      return {
        id: `candidate-${rank}`,
        rank,
        candidate: { hp: rank, def: 0, spd: 0 },
        bulkScore: { overallBulk: rank, physicalBulk: rank, specialBulk: rank },
        appliedStatPoints: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        appliedEvs: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        usedStatPointBudget,
        remainingStatPointBudget: 66 - usedStatPointBudget,
        usedEvBudget: rank,
        remainingEvBudget: 66 - rank,
        passed: true,
        scenarioResults: [],
        bottleneckLabel: `モバイル候補${rank}`,
      };
    });

    const html = renderToStaticMarkup(
      <ResultsPanel
        displayMode="mobile-inline"
        pageSize={5}
        candidates={candidates}
        passingCandidateCount={12}
        selectedCandidateId="candidate-1"
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain('class="mobile-candidate-results mobile-candidate-layout"');
    expect(html).toContain('id="mobile-candidate-title"');
    expect(html).toContain("候補 12 件 / 1-5 件目");
    expect(html).toContain("1-5 / 12");
    expect(html).toContain("1 / 3");
    expect(html).toContain("並び替え");
    expect(html).toContain("順序");
    expect(html).toContain("モバイル候補5");
    expect(html).not.toContain("モバイル候補6");
    expect(html).toContain("--candidate-used-track:33fr;--candidate-remaining-track:33fr");
    expect(html).toContain("--candidate-used-track:64fr;--candidate-remaining-track:2fr");
    expect(html).toContain("--candidate-used-track:0fr;--candidate-remaining-track:66fr");
    expect(html).toContain('<span class="visually-hidden">使用SP</span>33');
    expect(html).toContain('<span class="visually-hidden">残りSP</span>33');
    expect(html).toContain("最厳条件: モバイル候補1");
    expect(html.match(/位の候補を調整対象へ適用/g)).toHaveLength(5);
    expect(html).toContain('id="mobile-candidate-1-details"');
    expect(html).not.toContain('class="mobile-sheet-close"');
    expect(html.indexOf('class="candidate-table"')).toBeLessThan(
      html.indexOf('class="candidate-page-actions mobile-candidate-page-actions"'),
    );
  });

  it("sorts result candidates by the selected full-list key before pagination", () => {
    const makeCandidate = (
      id: string,
      rank: number,
      statPoints: CandidateResult["appliedStatPoints"],
      margin: number,
      bulkScore: CandidateResult["bulkScore"] = {
        overallBulk: rank * 100,
        physicalBulk: rank * 200,
        specialBulk: rank * 300,
      },
    ): CandidateResult => ({
      id,
      rank,
      candidate: { hp: statPoints.hp, def: statPoints.def, spd: statPoints.spd },
      bulkScore,
      appliedStatPoints: statPoints,
      appliedEvs: statPoints,
      usedStatPointBudget: statPoints.hp + statPoints.atk + statPoints.def + statPoints.spa + statPoints.spd + statPoints.spe,
      remainingStatPointBudget: 66 - statPoints.hp - statPoints.atk - statPoints.def - statPoints.spa - statPoints.spd - statPoints.spe,
      usedEvBudget: 0,
      remainingEvBudget: 0,
      passed: true,
      bottleneckLabel: `${id} ${margin}`,
      scenarioResults: [{
        scenarioId: "scenario-a",
        passed: true,
        survivalProbability: 0.5 + margin,
        requiredSurvivedHits: 1,
        minSurvivalProbability: 0.5,
        hitEvaluations: [],
        bottleneckLabel: `${id} ${margin}`,
      }],
    });
    const lowHp = makeCandidate(
      "low-hp",
      1,
      { hp: 1, atk: 0, def: 1, spa: 0, spd: 0, spe: 0 },
      0.01,
      { overallBulk: 100, physicalBulk: 200, specialBulk: 300 },
    );
    const highHp = makeCandidate(
      "high-hp",
      2,
      { hp: 20, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      0.2,
      { overallBulk: 200, physicalBulk: 400, specialBulk: 600 },
    );
    const tiedBulkRankOne = makeCandidate(
      "tied-bulk-rank-one",
      1,
      { hp: 2, atk: 0, def: 2, spa: 0, spd: 0, spe: 0 },
      0.03,
      { overallBulk: 150, physicalBulk: 250, specialBulk: 350 },
    );
    const tiedBulkRankThree = makeCandidate(
      "tied-bulk-rank-three",
      3,
      { hp: 3, atk: 0, def: 3, spa: 0, spd: 0, spe: 0 },
      0.04,
      { overallBulk: 150, physicalBulk: 250, specialBulk: 350 },
    );

    expect(compareResultCandidates(highHp, lowHp, "hp", "desc")).toBeLessThan(0);
    expect(compareResultCandidates(lowHp, highHp, "used", "asc")).toBeLessThan(0);
    expect(compareResultCandidates(highHp, lowHp, "margin", "desc")).toBeLessThan(0);
    expect(compareResultCandidates(lowHp, highHp, "recommended", "asc")).toBeLessThan(0);
    for (const sortKey of ["overallBulk", "physicalBulk", "specialBulk"] as const) {
      expect(compareResultCandidates(highHp, lowHp, sortKey, "desc")).toBeLessThan(0);
      expect(compareResultCandidates(highHp, lowHp, sortKey, "asc")).toBeGreaterThan(0);
      expect(compareResultCandidates(tiedBulkRankThree, tiedBulkRankOne, sortKey, "desc")).toBeGreaterThan(0);
      expect(compareResultCandidates(tiedBulkRankThree, tiedBulkRankOne, sortKey, "asc")).toBeGreaterThan(0);
    }
  });

  it("labels failed scenario results as FAIL", () => {
    expect(formatScenarioResultStatusLabel(true)).toBe("PASS");
    expect(formatScenarioResultStatusLabel(false)).toBe("FAIL");
  });

  it("localizes Smogon damage descriptions for the selected candidate detail", () => {
    expect(formatLocalizedDamageDescription(
      "252+ Atk Kingambit Sucker Punch vs. 92 HP / 52 Def Starmie-Mega: 122-146 (82.9 - 99.3%) -- guaranteed 2HKO",
    )).toBe("A32+ ドドゲザン ふいうち → H12 / B7 メガスターミー : 122-146 (82.9-99.3%) / 確定2発");
    expect(formatLocalizedDamageDescription(
      "252+ Atk Kingambit Sucker Punch vs. 68 HP / 236 Def Delphox-Mega: 134-158 (84.2 - 99.3%) -- guaranteed 2HKO",
    )).toBe("A32+ ドドゲザン ふいうち → H9 / B30 メガマフォクシー : 134-158 (84.2-99.3%) / 確定2発");
    expect(formatLocalizedDamageDescription(
      "252 SpA Raichu Grass Knot (120 BP) vs. 0 HP / 0 SpD Snorlax: 186-220 (79.1 - 93.6%) -- guaranteed 2HKO",
    )).toBe("C32 ライチュウ くさむすび (威力120) → H0 / D0 カビゴン : 186-220 (79.1-93.6%) / 確定2発");
    expect(formatLocalizedDamageDescription(
      "0 Atk Mew Knock Off (97.5 BP) vs. 0 HP / 0 Def Mew: 140-166 (41 - 48.6%) -- guaranteed 3HKO",
    )).toContain("(威力97.5)");
  });

  it("integrates the selected candidate detail into the candidate list", () => {
    const candidate: CandidateResult = {
      id: "candidate-2",
      rank: 2,
      candidate: { hp: 6, def: 13, spd: 0 },
      bulkScore: { overallBulk: 1234, physicalBulk: 2345, specialBulk: 3456 },
      appliedStatPoints: { hp: 6, atk: 0, def: 13, spa: 0, spd: 0, spe: 0 },
      appliedEvs: { hp: 44, atk: 0, def: 100, spa: 0, spd: 0, spe: 0 },
      usedStatPointBudget: 19,
      remainingStatPointBudget: 47,
      usedEvBudget: 144,
      remainingEvBudget: 366,
      passed: true,
      bottleneckLabel: "シナリオA +0.0%",
      scenarioResults: [{
        scenarioId: "scenario-a",
        passed: true,
        survivalProbability: 1,
        requiredSurvivedHits: 1,
        minSurvivalProbability: 1,
        bottleneckLabel: "シナリオA +0.0%",
        hitEvaluations: [{
          hitId: "hit-a",
          damageRolls: [122, 146],
          damageRange: { min: 122, max: 146, percentMin: 82.9, percentMax: 99.3 },
          description: "252+ Atk Kingambit Sucker Punch vs. 92 HP / 52 Def Starmie-Mega: 122-146 (82.9 - 99.3%) -- guaranteed 2HKO",
          movePower: {
            catalogBasePower: 70,
            appliedBasePower: 70,
            source: "standard" as const,
          },
        }],
      }],
    };
    const [scenario] = createDefaultScenarioForms();
    const offenseScenario = {
      ...scenario,
      id: "scenario-offense-test",
      label: "シナリオ2",
      adjustmentType: "offense" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-offense-test",
        label: "火力調整A",
        attackerPokemonInput: "メガゲンガー",
        moveInput: "サイコキネシス",
      }],
    };
    const offenseResults = [{
      id: "scenario-offense-test:attack-offense-test:spa",
      scenarioId: "scenario-offense-test",
      scenarioLabel: "シナリオ2",
      attackId: "attack-offense-test",
      attackLabel: "火力調整A",
      result: {
        id: "offense-result-test",
        status: "pass" as const,
        passed: true,
        label: "Cライン",
        owner: "attacker" as const,
        stat: "spa" as const,
        role: "damage" as const,
        canApply: false,
        requiredStatPoints: 7,
        actualStat: 186,
        koProbability: 1,
        targetKoProbability: 1,
        damageRange: { min: 168, max: 198, percentMin: 100.6, percentMax: 118.6 },
        movePower: {
          catalogBasePower: 90,
          appliedBasePower: 90,
          source: "standard" as const,
        },
        hpEventEvaluations: [
          {
            cardId: "offense-adjustment-card",
            eventId: "sand-ko",
            effectId: "sandstorm-damage",
            label: "すなあらしダメージ",
            subject: "defender" as const,
            subjectBuildId: "offense-defender",
            timing: "endOfTurn" as const,
            frequency: "perTurn" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 10,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
          {
            cardId: "offense-adjustment-card",
            eventId: "substitute-cost",
            effectId: "move-hp-cost:substitute",
            label: "みがわりのHP消費",
            subject: "attacker" as const,
            subjectBuildId: "offense-attacker",
            timing: "beforeMove" as const,
            frequency: "perMove" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 25,
            changeKind: "hpCost" as const,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
          {
            cardId: "offense-adjustment-card",
            eventId: "wild-charge-recoil",
            effectId: "move-damage-recoil",
            label: "ワイルドボルトの反動",
            subject: "attacker" as const,
            subjectBuildId: "offense-attacker",
            timing: "afterMove" as const,
            frequency: "perMove" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 12,
            damageRange: { min: 12, max: 15 },
            changeKind: "recoil" as const,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
          {
            cardId: "offense-adjustment-card",
            eventId: "final-gambit-faint",
            effectId: "move-forced-faint:final-gambit",
            label: "いのちがけの使用者ひんし",
            subject: "attacker" as const,
            subjectBuildId: "offense-attacker",
            timing: "afterHit" as const,
            frequency: "once" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 173,
            changeKind: "forcedFaint" as const,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
        ],
        reason: "PASS",
      },
    }];
    const resultsPanelBaseProps = {
      offenseResults,
      speedResults: [],
      strictestFailureLabel: null,
      targetLabel: "メガマフォクシー",
      resultAlertMessage: null,
    };
    const closedHtml = renderToStaticMarkup(
      <ResultsPanel
        {...resultsPanelBaseProps}
        candidates={[candidate]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[{ ...scenario, id: "scenario-a", label: "シナリオA" }, offenseScenario]}
        status="complete"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...resultsPanelBaseProps}
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[{ ...scenario, id: "scenario-a", label: "シナリオA" }, offenseScenario]}
        status="complete"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain(">最厳条件<");
    expect(html).toContain(">H/A/B/C/D/S<");
    expect(html).toContain('class="candidate-budget-value used"');
    expect(html).toContain('class="candidate-budget-value remaining"');
    expect(html).toContain('class="candidate-bottleneck"');
    expect(html).toContain("シナリオA +0.0%");
    expect(html).toContain("最厳条件: シナリオA +0.0%");
    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 6 / A 0 / B 13 / C 0 / D 0 / S 0"');
    expect(html).toContain(">H</span><span>6</span>");
    expect(html).toContain(">A</span><span>0</span>");
    expect(html).toContain(">B</span><span>13</span>");
    expect(html).toContain(">適用<");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-state="open"');
    expect(html).toContain('class="candidate-disclosure"');
    expect(html).not.toContain("▼");
    expect(html).not.toContain("▲");
    expect(html).toContain("シナリオA / 耐久調整A</strong><span>威力 70 / A32+ ドドゲザン ふいうち → H12 / B7 メガスターミー : 122-146 (82.9-99.3%) / 確定2発");
    expect(html).toContain("シナリオ2</strong><span>KO率 100.0%");
    expect(html).toContain("シナリオ2</strong><span>威力 90 / C7 メガマフォクシー サイコキネシス → メガゲンガー : 168-198 (100.6-118.6%) / KO率 100.0%");
    expect(html).toContain("シナリオ2 / 定数ダメージ・回復</strong><span>すなあらしダメージ / 仮想敵 / ターン終了時・ターンごと: 10ダメージ");
    expect(html).toContain("みがわりのHP消費 / 調整対象 / 技使用前・技ごと: 25消費");
    expect(html).toContain("ワイルドボルトの反動 / 調整対象 / 技使用後・技ごと: 12-15反動");
    expect(html).toContain("いのちがけの使用者ひんし / 調整対象 / ヒット後・1回: ひんし");
    expect(html).not.toContain("火力ライン結果");
    expect(closedHtml).toContain('aria-expanded="false"');
    expect(closedHtml).toContain('data-state="closed"');
    expect(closedHtml).not.toContain("▼");
    expect(closedHtml).not.toContain("▲");
    expect(closedHtml).not.toContain("A32+ ドドゲザン ふいうち");
    expect(closedHtml).not.toContain("C7 メガマフォクシー サイコキネシス");
  });

  it("shows standalone firepower line results when no defence scenario is enabled", () => {
    const [scenario] = createDefaultScenarioForms();
    const offenseScenario = {
      ...scenario,
      id: "scenario-offense-only",
      label: "火力のみ",
      enabled: true,
      adjustmentType: "offense" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-grass-knot",
        label: "くさむすび",
        attackerPokemonInput: "カビゴン",
        moveInput: "くさむすび",
      }],
    };
    const offenseResults = [{
      id: "scenario-offense-only-attack-grass-knot-spa",
      scenarioId: "scenario-offense-only",
      scenarioLabel: "火力のみ",
      attackId: "attack-grass-knot",
      attackLabel: "くさむすび",
      result: {
        id: "spa-line",
        status: "pass" as const,
        passed: true,
        label: "Cライン",
        owner: "attacker" as const,
        stat: "spa" as const,
        role: "damage" as const,
        canApply: true,
        requiredStatPoints: 12,
        actualStat: 156,
        koProbability: 1,
        targetKoProbability: 1,
        damageRange: { min: 180, max: 216, percentMin: 102.8, percentMax: 123.4 },
        hpEventEvaluations: [],
        reason: "Cライン 12 SPでKO条件を満たします",
      },
    }];

    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[offenseScenario]}
        status="idle"
        offenseResults={offenseResults}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガライチュウ"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("火力・素早さライン結果");
    expect(html).toContain(">Cライン</strong>");
    expect(html).toContain("火力のみ / くさむすび");
    expect(html).toContain("KO 100.0%");
    expect(html).toContain('aria-label="Cラインを調整対象へ適用"');
    expect(html).toContain(">適用</button>");
    expect(html).not.toContain(">計算結果</div>");
  });

  it("labels each expanded damage line with its attack card inside multi-attack scenarios", () => {
    const candidate: CandidateResult = {
      id: "candidate-multi",
      rank: 1,
      candidate: { hp: 8, def: 12, spd: 4 },
      bulkScore: { overallBulk: 4567, physicalBulk: 5678, specialBulk: 6789 },
      appliedStatPoints: { hp: 8, atk: 0, def: 12, spa: 0, spd: 4, spe: 0 },
      appliedEvs: { hp: 60, atk: 0, def: 92, spa: 0, spd: 28, spe: 0 },
      usedStatPointBudget: 24,
      remainingStatPointBudget: 42,
      usedEvBudget: 180,
      remainingEvBudget: 328,
      passed: true,
      bottleneckLabel: "連続被弾 +1.0%",
      scenarioResults: [{
        scenarioId: "scenario-multi",
        passed: true,
        survivalProbability: 1,
        requiredSurvivedHits: 2,
        minSurvivalProbability: 1,
        bottleneckLabel: "連続被弾 +1.0%",
        hitEvaluations: [
          {
            hitId: "scenario-multi-hit-1",
            damageRolls: [40],
            damageRange: { min: 40, max: 40, percentMin: 25, percentMax: 25 },
          },
          {
            hitId: "scenario-multi-hit-2",
            damageRolls: [50],
            damageRange: { min: 50, max: 50, percentMin: 31.3, percentMax: 31.3 },
          },
        ],
        hpEventEvaluations: [{
          cardId: "scenario-multi-hit-1",
          eventId: "sand-after-first-hit",
          effectId: "sandstorm-damage",
          label: "すなあらしダメージ",
          subject: "defender",
          subjectBuildId: "target",
          timing: "endOfTurn",
          frequency: "perTurn",
          sequenceContext: "currentMove",
          occurrence: 1,
          damage: 11,
          applied: true,
          activationProbability: 1,
          supported: true,
        }],
      }],
    };
    const [baseScenario] = createDefaultScenarioForms();
    const scenario = {
      ...baseScenario,
      id: "scenario-multi",
      label: "連続被弾",
      attacks: [
        { ...baseScenario.attacks[0], id: "attack-a", label: "攻撃A", moveInput: "" },
        { ...baseScenario.attacks[0], id: "attack-b", label: "攻撃B", moveInput: "ふいうち" },
        { ...baseScenario.attacks[0], id: "attack-c", label: "攻撃C", moveInput: "サイコキネシス" },
      ],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("連続被弾 / 耐久調整B</strong><span>被ダメージ 40 (25.0-25.0%)");
    expect(html).toContain("連続被弾 / 耐久調整B / 定数ダメージ・回復</strong><span>すなあらしダメージ / 調整対象 / ターン終了時・ターンごと: 11ダメージ");
    expect(html).toContain("連続被弾 / 耐久調整C</strong><span>被ダメージ 50 (31.3-31.3%)");
  });

  it("places integrated firepower failures in the candidate list", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel="シナリオ1 -6.3%"
        targetLabel="メガマフォクシー"
        resultAlertMessage="火力調整条件を候補一覧へ統合できません: シナリオ2 / 火力調整A: 最大SPでも指定KO率に届きません"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("候補一覧");
    expect(html).toContain(">FAIL</strong>");
    expect(html).toContain("すべてのシナリオを満たす候補を作れません");
    expect(html).toContain("最厳条件: シナリオ2 / 火力調整A: 最大SPでも指定KO率に届きません");
    expect(html).not.toContain("最厳条件: シナリオ1 -6.3%");
    expect(html).not.toContain("火力ライン結果");
  });

  it("shows the strictest condition when a completed search has no candidates", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel="シナリオ1 -6.3%"
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain(">FAIL</strong>");
    expect(html).toContain("すべてのシナリオを満たす候補が見つかりません");
    expect(html).not.toContain("必要耐久・生存率・固定SPをゆるめてください");
    expect(html).toContain("最厳条件: シナリオ1 -6.3%");
  });

  it("keeps speed line details inside expanded candidates without the separate result panel", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = {
      ...scenario,
      id: "scenario-speed-test",
      label: "素早さ調整",
      adjustmentType: "speed" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-speed-test",
        label: "最速ピカチュウ",
        attackerPokemonInput: "ピカチュウ",
        speedTargetMode: "manual" as const,
        speedTargetValue: 150,
      }],
    };
    const candidate: CandidateResult = {
      id: "candidate-speed",
      rank: 1,
      candidate: { hp: 3, def: 32, spd: 0 },
      bulkScore: { overallBulk: 7890, physicalBulk: 8901, specialBulk: 9012 },
      appliedStatPoints: { hp: 3, atk: 0, def: 32, spa: 2, spd: 0, spe: 12 },
      appliedEvs: { hp: 20, atk: 0, def: 252, spa: 12, spd: 0, spe: 92 },
      usedStatPointBudget: 49,
      remainingStatPointBudget: 17,
      usedEvBudget: 376,
      remainingEvBudget: 132,
      passed: true,
      bottleneckLabel: "シナリオ1 +3.7%",
      scenarioResults: [],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[speedScenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[{
          id: "scenario-speed-test-attack-speed-test-speed-line",
          scenarioId: "scenario-speed-test",
          scenarioLabel: "素早さ調整",
          attackId: "attack-speed-test",
          attackLabel: "最速ピカチュウ",
          result: {
            id: "speed-line",
            status: "pass",
            passed: true,
            canApply: true,
            label: "Sライン",
            comparison: "outspeed",
            orderMode: "normal",
            relation: "outspeed",
            requiredStatPoints: 12,
            actualSpeed: 151,
            targetSpeed: 150,
            requiredSpeed: 151,
            targetStatPoints: 0,
            notes: ["こだわりスカーフ 1.5倍"],
            reason: "確定抜きは S12 SPで達成します",
          },
        }]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).not.toContain("Sライン結果");
    expect(html).not.toContain("候補一覧の固定Sへ自動統合されます");
    expect(html).not.toContain("S適用");
    expect(html).toContain("素早さ調整</strong>");
    expect(html).toContain("相手S 150");
    expect(html).toContain(">PASS</em>");
    expect(html).toContain("S12 メガマフォクシー → 任意S150 : 自分 151 / 相手 150 / 抜ける / こだわりスカーフ 1.5倍");
    expect(html).toContain('aria-label="SPバー: H 3 / A 0 / B 32 / C 2 / D 0 / S 12"');
    expect(html).toContain("シナリオ1 +3.7%");
    expect(html).toContain("最厳条件: シナリオ1 +3.7%");
    expect(html).toContain("自分 151");
    expect(html).toContain("相手 150");
    expect(html).toContain("抜ける");
    expect(html).toContain("こだわりスカーフ 1.5倍");
  });

  it("omits speed note text when no speed modifiers are applied", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = {
      ...scenario,
      id: "scenario-speed-no-note",
      label: "素早さ調整",
      adjustmentType: "speed" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-speed-no-note",
        label: "最速ゲンガー",
        attackerPokemonInput: "メガゲンガー",
        speedTargetMode: "manual" as const,
        speedTargetValue: 200,
      }],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[speedScenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[{
          id: "scenario-speed-no-note-attack-speed-no-note-speed-line",
          scenarioId: "scenario-speed-no-note",
          scenarioLabel: "素早さ調整",
          attackId: "attack-speed-no-note",
          attackLabel: "最速ゲンガー",
          result: {
            id: "speed-line",
            status: "pass",
            passed: true,
            canApply: true,
            label: "Sライン",
            comparison: "outspeed",
            orderMode: "normal",
            relation: "outspeed",
            requiredStatPoints: 29,
            actualSpeed: 201,
            targetSpeed: 200,
            requiredSpeed: 201,
            targetStatPoints: 0,
            notes: [],
            reason: "確定抜きは S29 SPで達成します",
          },
        }]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).not.toContain("Sライン結果");
    expect(html).not.toContain("自動補正なし");
    expect(html).not.toContain("抜ける /");
    expect(html).toContain('aria-label="Sラインを調整対象へ適用"');
  });

  it("wires resolver-backed datalist candidates to free-text entity fields", () => {
    const html = renderExampleApp();

    expect(html).toContain('value="ドドゲザン"');
    expect(html).toContain('value="メガマフォクシー"');
    expect(html).toContain('value="メガゲンガー"');
    expect(html).toContain('value="サイコキネシス"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP" placeholder="H SP"');
    expect(html).toContain('value="32"');
    expect(html).not.toContain('value="Dragonite"');
    expect(html).not.toContain('label="Dragonite"');
    expect(html).not.toContain("calc: Delphox-Mega");
    expect(html).not.toContain("名前を解決できません");
    expect(html).not.toContain(">Delphox-Mega<");
    expect(html).not.toContain(">Illuminate<");
    expect(html).not.toContain('list="entity-options-pokemon');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).not.toContain('list="entity-options-move');
    expect(html).toContain('class="nature-trigger"');
    expect(html).toContain('aria-label="性格: おくびょう"');
    expect(html).toContain('class="disclosure-chevron"');
    expect(html).not.toContain("▾");
    expect(html).not.toContain("C↑ / A↓");
    expect(html).not.toContain("A↑ / C↓");
    expect(html).not.toContain('list="entity-options-ability');
    expect(html).toContain('class="dropdown-menu-trigger"');
    expect(html).toContain('aria-label="特性候補を開く"');
    expect(html).toContain('aria-label="持ち物候補を開く"');
    expect(html).toContain('aria-label="技候補を開く"');
    expect(html).toContain('class="scenario-defender-status"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
    expect(html).toContain(">なし</span>");
    expect(html).not.toContain('aria-label="状態異常: なし"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
    expect(html).not.toContain('value="まけんき"');
    expect(html).not.toContain('value="もうか"');
    expect(html).not.toContain('list="entity-options-item');
    expect(html).not.toContain('list="entity-options-type');
    expect(html).toContain('aria-label="テラスタル"');
    expect(html).toContain('aria-label="攻撃テラス"');
    expect(html).toContain("tera-off.svg");
    expect(html).toContain("mega-off.svg");
    expect(html).toContain("dmax-off.svg");
  });
});
