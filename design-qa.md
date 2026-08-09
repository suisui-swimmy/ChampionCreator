# Design QA — guide two-pane layout

## Guide scenario adjustment menu grouping — 2026-08-09

- Navigation: `耐久調整`, `火力調整`, and `素早さ調整` are absent from the guide menu; the menu now has 10 items and moves directly from `仮想敵シナリオ` to `定数ダメージ・回復`.
- Structure: the three existing adjustment cards remain individually addressable as `#defence`, `#offense`, and `#speed`, but all are DOM descendants of `section#scenarios` inside a group labeled `仮想敵シナリオの調整種別`.
- Desktop 904x698: scrolling each of the three cards keeps the sole `aria-current="location"` menu item on `仮想敵シナリオ`; the cards remain a three-column row with no document-level horizontal overflow.
- Mobile 390x844: the cards become one `360px` column, all three scroll positions keep `仮想敵シナリオ` active, and the page has no horizontal overflow.
- Runtime: the main app displays `app v0.7.15`; guide, mobile preview, and main-app clean loads produced 0 Browser console errors or warnings.

final result: passed

## Guide scenario rows and columns explanation — 2026-08-09

- Source visual truth: supplied `image 3.png` and `Group 6 1.png`, stored unchanged as `scenario-adjustment-column-addition.png` and `scenario-row-addition.png`; source, public, and production-build SHA-256 hashes match.
- Content order: the scenario introduction is followed by the adjustment-column explanation, its image, the independent-scenario-row explanation, its image, the final enabled-row evaluation explanation, and then the existing ally-ability annotation.
- Desktop 904x698: the horizontal column example renders at `720px`, the vertical row example at `520px`, both retain their natural dimensions (`1045 x 390` and `820 x 1189`), and document-level horizontal overflow is absent.
- Mobile 390x844: both images fit the `360px` guide track; the vertical image renders at `360 x 521.3px`, all four paragraphs remain readable, and document-level horizontal overflow is absent.
- Runtime: the main app displays `app v0.7.14`; guide, mobile preview, and main-app clean loads produced 0 Browser console errors or warnings.

final result: passed

## Guide double-battle ally ability annotation — 2026-08-09

- Source visual truth: supplied `Group 5.png`, stored unchanged as `public/assets/guide/double-battle-ally-abilities.png`; source, public, and production-build SHA-256 hashes match and the PNG dimensions are `871 x 548`.
- Structure: the existing green `guide-tip-icon` precedes `ダブルバトルの味方特性`, followed by the requested paragraph, a Radix UI Collapsible trigger labeled `対象の特性`, the 14 abilities in the requested order, and the supplied image.
- Desktop: the image renders at a maximum width of `720px`; the disclosure changes from `aria-expanded="false"` to `true`, exposes all 14 items, and the page has no horizontal overflow.
- Mobile 390x844: the annotation fits the `360px` guide track, the image renders at about `327.6px`, the two-column expanded list remains readable, and document-level horizontal overflow is absent.
- Runtime: the main app displays `app v0.7.13`; guide, mobile preview, and main-app clean loads produced 0 Browser console errors or warnings.

final result: passed

## Guide SP rules two-row layout — 2026-08-09

- Source visual truth: approved Figma frame `WRc81iCQ48jMkvSz5EXYQ1` / node `2:9`, refined by the in-app Browser feedback to reduce the overall scale by one step.
- Structure: one shared surface contains `SPの制約` and `計算での扱い` as two rows with one horizontal divider; each row keeps two directly comparable label/value pairs.
- In-app Browser 894x698: the surface renders at `852 x 145.6px`, both rows are `72px` high, headings are `15px`, and yellow values are `24px`. The final scale is smaller than the initial `177.6px`-high implementation without changing the information hierarchy.
- Mobile 390x844: the surface renders at `360 x 161.5px`; row headings stack above two equal item columns, yellow values are `18px`, and document-level horizontal overflow is absent.
- Copy and semantics: the exact pairs are `各能力 / 0–32`, `合計上限 / 66`, `同時探索 / H/B/D`, and `固定条件 / A/C/S`; the container exposes `aria-label="SPの基本ルール"`.
- Runtime: the main app displays `app v0.7.12`; clean guide and main-app page loads produced 0 Browser console errors or warnings.

final result: passed

- Source visual truth: attached `codex-clipboard-8dd8c7cb-3948-49f6-a780-69f7cdbe09ec.png` and `codex-clipboard-bb280c5a-10ac-4c61-844e-313f787a87aa.png`
- Implementation screenshots: Codex visualization artifacts `guide-two-pane-1200x900.png` and `guide-footer-1200x900.png`
- Viewport: desktop CSS viewport `1200 x 900`, device scale factor `1`; mobile CSS viewport `390 x 844`
- Pixel dimensions: calculator source `1205 x 1662`; desktop implementation `1190 x 893`; footer source `859 x 118`; footer implementation capture `1190 x 893`
- Normalization: the first source is evidence of the cramped three-pane state rather than a 1:1 final mock, so the comparison uses the same calculator content and desktop width to judge released horizontal space. The footer comparison uses its centered content region at native density.
- State: tutorial preset loaded; desktop calculation completed at `654 / 654`; mobile responsive overview loaded

## Full-view comparison evidence

- The source showed the calculator compressed by a left menu, main content, and right contextual rail. The implementation removes the right rail and renders `200px 934px` tracks at 1200px, leaving the document at `1190px` with no horizontal page overflow.
- The guide header now keeps only the brand, `使い方ガイド`, and `アプリを開く`; the duplicate desktop site navigation and external-link arrow are absent.
- The calculator keeps the existing target/scenario proportions and semantic state colors. At 1200px the target panel is about 326px and the scenario panel about 579px, with no overlap between the guide and calculator regions.
- At 390px the guide becomes one `360px` content track, the existing mobile calculator overview is active, and document width equals body width.

## Focused region comparison evidence

- Footer: the guide now reuses the main app's `app-footer`, `app-footer-copy`, `app-footer-links`, and `app-footer-contact` structure. Copyright attribution, bug-report link, X contact link, spacing, top border, centered alignment, and the real 14px X asset match the supplied app-footer reference.
- No additional focused crop was needed for the calculator because the requested change is the removal of a major page rail; the full desktop capture makes the resulting panel widths and absence of overlap readable.

## Required fidelity surfaces

- Fonts and typography: passed. Existing LINE Seed JP and application control typography are unchanged; footer inherits the main app type scale and weights.
- Spacing and layout rhythm: passed. The right rail and its gap are removed, the main column receives the reclaimed width, and desktop/mobile margins remain aligned with existing guide breakpoints.
- Colors and visual tokens: passed. Existing guide, calculator, state, and footer tokens are reused without approximate replacements.
- Image quality and asset fidelity: passed. Existing brand art and Pokémon artwork are unchanged; the footer uses the shipped X logo asset.
- Copy and content: passed. The three requested right-rail sections are absent, while the app copyright, bug-report, and contact copy are present in the footer.

## Findings

- No actionable P0, P1, or P2 mismatch remains for the requested two-pane conversion and footer reuse.

## Primary interactions and runtime checks

- Tutorial calculation completed at `654 / 654` and exposed an applicable candidate.
- Guide table-of-contents links keep the browser on `/guide/` and update only the section fragment.
- The table of contents orders `素早さ調整` before `定数ダメージ・回復`, and the former help card beneath the table of contents is absent.
- The opening heading matches the other guide section headings, the lead uses the full main-column width, and troubleshooting is a four-item static list.
- At mobile widths the table of contents is closed by default, toggles from the supplied menu icon to the supplied X icon, closes after link selection or Escape, and does not cover calculator-sheet navigation while closed.
- Desktop 1200px and mobile 390px responsive states rendered without horizontal page overflow.
- Browser console errors and warnings: 0.

## Comparison history

- Pass 1: the revised implementation removed the reported compression source, matched the supplied footer structure, and produced no actionable P0/P1/P2 issue. No visual fix iteration was required after this comparison.

## Follow-up polish

- None required for this change.

final result: passed

## Guide mobile annotation and reference image — 2026-08-09

- Source visual truth: supplied `lightbulb.svg` and `overview_mobile.png`, copied unchanged to `public/assets/guide/`; source, public, and production-build hashes match.
- The `スマホでは？` annotation uses the supplied green lightbulb SVG, followed by the two requested paragraphs and then the mobile overview image in that order.
- In-app Browser 894x698: the image loads at its natural `690 x 1024` dimensions and renders at the requested reduced maximum width of `320px` with preserved aspect ratio.
- Responsive sizing uses `min(100%, 320px)` and `height: auto`; the verified guide viewport has no document-level horizontal overflow.
- Browser console errors and warnings: 0.

final result: passed

## Guide tutorial spacing and step copy — 2026-08-09

- Desktop 1186x698 and mobile 390x844: the introduction lead now keeps a measured `16px` gap before the interactive tutorial, with no document-level horizontal overflow.
- STEP 1 displays `サンプル入力を確認したら、実際に「計算開始」を押してみよう。入力内容は自由に変更できます。`.
- The real tutorial flow changed to STEP 2 while calculating, STEP 3 when calculation completed, and STEP 4 after applying the candidate; all four messages matched the requested copy exactly.
- Browser console errors and warnings: 0.

final result: passed

## Guide overview image and numbered annotations — 2026-08-09

- Source visual truth: supplied `overview.png`, copied unchanged to `public/assets/guide/overview.png`; SHA-256 matches and the real PNG dimensions are `1763 x 1645`.
- Desktop 1186x698: the overview image fills the guide content width without horizontal overflow, and the four former cards are replaced by a vertical annotation list below the image.
- Mobile 390x844: the image renders at `360px` wide with preserved aspect ratio; the numbered annotations remain a single readable column with no document-level horizontal overflow.
- Number colors preserve the former annotation mapping: `①` yellow `rgb(247, 212, 71)`, `②` green `rgb(0, 255, 114)`, `③` cyan `rgb(0, 216, 240)`, and `④` orange `rgb(251, 168, 47)`.
- Browser console errors and warnings: 0.

final result: passed

## Guide scroll-following table of contents — 2026-08-09

- Desktop 1186x698: the active table-of-contents item follows the section crossing the upper reading line; `仮想敵シナリオ` changed to `耐久調整` after scrolling, with exactly one `aria-current="location"` link and no horizontal overflow.
- The desktop mode cards share one row, so normal scrolling selects `耐久調整`; clicking `火力調整` or `素早さ調整` keeps that selected item while the shared row remains current.
- Mobile 390x844: the vertically stacked mode cards changed the active item from `耐久調整` to `火力調整` as each section crossed the reading line. Opening the guide menu kept the active item visible without page-level horizontal overflow.
- Browser console errors and warnings: 0.

final result: passed

## Guide content polish and deployment asset paths — 2026-08-08

- Desktop 1186x698: removed the quick-start strip and tutorial description/action clutter; the sample title and 40px reset icon align within the tutorial header without horizontal overflow.
- Mobile 390x844: the shortened introduction, tutorial header, calculation overview, and closed-by-default guide menu fit the viewport with no document-level horizontal overflow.
- The menu button switches from the supplied menu icon to the supplied X icon, and selecting a guide link closes the menu.
- The SP rule cards prioritize the descriptive 13px labels, with the compact numeric/range values retained as secondary information.
- Troubleshooting uses 13px text and separate block lines for each heading and explanation.
- All tutorial images loaded with non-zero natural dimensions in Browser; broken image count was 0 for artwork, stat icons, battle-state icons, and UI icons.
- The production build keeps `../assets/...` for static guide assets, while runtime tutorial assets resolve from the explicit app root. Pure URL tests cover both a custom-domain root and a GitHub Pages project prefix.

final result: passed
