# Design QA — guide two-pane layout

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
