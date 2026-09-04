---
name: audit-smogon-calc-upstream
description: Compare a pinned @smogon/calc commit and any local metadata overrides, exact aliases, or reproducible compatibility patches with frozen smogon/damage-calc upstream, then recommend native adoption, patch retention, rebase, retirement, or deferral. Use for calc freshness, upstream impact, pre-upstream compatibility, or patch sunset audits; do not use it as authorization to implement an audit-only request.
---

# Audit Smogon Calc Upstream

Audit first; do not update the dependency or compatibility layer unless the user also asks for implementation. Freeze every compared revision to a full commit SHA and base the recommendation on the repository's owning calculation path. Upstream is the native implementation source, not a release gate for confirmed metadata or an audited compatibility patch.

## Non-negotiable rules

1. Never use the npm version alone to decide freshness. Upstream may merge calculation, data, or Champions support while `calc/package.json` keeps the same version.
2. Compare the repository's pinned upstream commit against the latest commit on the upstream default branch. If a CC fork or patch queue exists, freeze its base and patched revisions too.
3. Inspect patches and local consumers. Do not classify importance from commit titles or catalog presence alone.
4. Separate upstream calculator-package changes from set data, upstream website UI, workflows, imports, or generations the local app does not execute.
5. Treat `@smogon/calc` as the base direct-damage engine, not the sole catalog for entity existence, release status, or form associations. Confirmed metadata may precede upstream when it stays inside the repository's source / override / generator / validation boundary.
6. Accept only these direct-damage paths: upstream native mechanics, an exact alias to proven-equivalent existing mechanics, or a reproducible CC compatibility patch applied at the Calc mechanics boundary. A compatibility patch does not make nearby unsupported battle behavior supported.
7. Never approve an approximate alias, ad hoc post-processing of returned damage rolls, hand edits to `node_modules` or an existing tarball, silent no-effect fallback, or simultaneous native and compatibility implementations.
8. Report the audit without mutating dependency, metadata, generated data, patches, versions, or runtime code unless implementation was explicitly requested.

## Workflow

### 1. Establish the local calculation boundary

Read repository instructions first, then inspect the smallest relevant file set:

- `AGENTS.md`, `README.md`, `package.json`, `package-lock.json`, and the `PROGRESS.md` snapshot / recent entries
- `PROGRESS.archive/` only when a targeted history search is needed to resolve missing or conflicting pin evidence
- the `@smogon/calc` adapter and parity tests
- generator scripts and generated metadata that record an upstream commit
- tracked source-data / metadata overrides and validators that may intentionally differ from Calc catalogs
- any engine alias table, compatibility manifest, patch queue, fork provenance, or tests attached to a patched vendor build
- domain, UI, persistence, worker, or search code that carries fields changed upstream
- the installed package metadata when `node_modules` is available

Record:

- dependency form: registry version, git dependency, or vendor tarball
- installed package version and resolved artifact
- actual generation or ruleset used at runtime
- upstream commit recorded by the vendor filename, generator, generated JSON, README, or bounded progress records
- local API fields passed to `Pokemon`, `Move`, `Field`, and `Side`
- confirmed metadata that intentionally differs from the pinned Calc catalog
- each local calculation support state: `native`, `exact-alias`, `cc-patched`, or `unsupported`
- for `exact-alias`: the displayed / saved canonical, engine canonical, equivalence evidence, and regression tests
- for `cc-patched`: upstream base SHA, patch or fork commit, build provenance, evidence, tests, upstream issue / PR when available, and sunset condition

Resolve the pinned commit using corroborating evidence. Prefer, in order:

1. generated-data `source.upstreamCommit` or an explicit generator constant
2. vendor artifact name or build metadata
3. dependency declaration and lockfile resolution
4. README or a targeted search of `PROGRESS.md` and, only when needed, `PROGRESS.archive/`

If these disagree, report the mismatch and verify the artifact contents; do not guess a base commit.

Do not infer mechanics support merely because an ability, move, item, or species name exists in a catalog. Verify that the executed mechanics path implements the required trigger, ordering, rounding, suppression, and inactive state.

### 2. Freeze the latest upstream head

Use the GitHub connector when available, otherwise GitHub's API, web pages, or `git ls-remote`. Do not call `git fetch` read-only: it mutates `.git/FETCH_HEAD` or remote refs. If commit objects are required, fetch or clone only into a disposable temporary directory, never the audited repository.

1. Resolve `smogon/damage-calc` and its default branch.
2. Record the latest full SHA, commit time, and canonical URL.
3. Use that SHA for every later fetch so the audit does not drift if the branch advances.
4. Fetch `calc/package.json` at both base and head. A matching version does not mean there are no package changes.

### 3. Compare commits and files

Compare `<base-full-sha>...<head-full-sha>` and collect:

- ahead/behind status and commit count
- commit messages and dates
- changed file paths and stats
- patches for every potentially functional commit

Classify changed paths before judging impact:

- calculator package: `calc/src/**`, `calc/package.json`, calculator tests
- upstream set data: `src/js/data/sets/**`
- upstream website/UI: `src/**/*.html`, `src/js/**`, `src/css/**`
- import tooling: `import/**`
- CI/deployment: `.github/**`

Do not claim set updates affect a local app that neither imports nor packages those sets. Conversely, do not ignore a one-line `calc/src/mechanics/**` change merely because the npm version did not move.

When a local alias or compatibility patch exists, also compare it with the frozen upstream head:

- whether upstream now implements the same behavior natively
- whether trigger, ordering, rounding, suppression, and defaults are equivalent
- whether the patch still applies cleanly to its declared base
- whether native and local implementations could double-apply
- whether the patch can be retired, must be rebased, or remains necessary

### 4. Map each functional patch to the local runtime

For every calculator-package change, answer these questions from code:

1. Does it run for the local generation or ruleset?
2. Does the local adapter pass the new or changed state field?
3. Does the change alter defaults when a field is absent?
4. Does it require domain, UI, serialization, share-state, box-storage, worker, or generated-data changes?
5. Would replacing only the tarball silently change existing saved scenarios?
6. Does it affect catalog contents or only mechanics?
7. Is the changed API imported through an internal `dist/**` path that needs compatibility checking?
8. Does it make a local metadata override, exact alias, or CC patch redundant or conflicting?
9. If upstream still lacks the behavior, can it be represented by proven-equivalent existing mechanics, or does it require a real mechanics patch?
10. Would an unsupported canonical be silently treated as no effect by the current adapter?

Use small read-only runtime probes against the currently installed package when a default or rounding behavior is unclear. Include exact inputs and output ranges. A probe supplements patch inspection; it does not replace comparison with the frozen upstream code.

### 5. Apply the ChampionCreator boundary when present

Recheck the current files rather than assuming old behavior. Pay particular attention to:

- the generation selected in `src/calc/smogonAdapter.ts`
- `toSmogonPokemon`, `toSmogonMove`, `toSmogonField`, and `calculateSmogonHit`
- activation fields such as `abilityOn`, transformation fields such as `isDynamaxed` / `useMax`, ranks, current HP, and side flags
- `scripts/generate-battle-options.mjs` and generated JSON `source.upstreamCommit`
- app metadata that may show only package semver even when the vendored commit changes
- `shareState`, box storage, migration/fallback behavior, and worker requests if a new state field is needed
- parity and representative damage tests around the affected mechanic

Classify new or divergent elements along separate axes:

- `metadata-supported`: identity, display, availability, or form association is confirmed
- `engine-supported`: the chosen native, exact-alias, or CC-patched engine implements the required mechanics
- `calculation-supported`: the current adapter supplies every required field and the result is safe for this input

Confirmed metadata and existing-mechanic form associations do not need to wait for an upstream species-table update. Preserve the display / saved canonical and project it to an engine canonical only when equivalence is exact and tested. If new mechanics are required, keep the input explicitly unsupported until native support or an audited compatibility patch exists.

Keep direct attacks behind the audited Calc boundary. Treat Champions-specific constant damage or ordered HP events as separate ruleset/event layers, not reasons to rewrite direct damage. When a compatibility patch exists or is proposed, read [references/compatibility-patches.md](references/compatibility-patches.md) before recommending it.

### 6. Rank the adoption decision

Use these categories:

- **Adopt now**: take native upstream behavior, confirmed metadata, or a proven exact alias with no unresolved runtime contract.
- **Adopt with coordinated migration**: native adoption or a new CC compatibility patch needs adapter, domain, UI, persistence, generation, or vendor work.
- **Keep CC patch**: upstream still lacks the behavior and the patch remains valid for its declared base and tests.
- **Retire CC patch**: frozen upstream now provides equivalent native behavior; remove the local implementation and prove no double application.
- **Rebase or replace CC patch**: upstream moved the patch boundary or changed adjacent semantics, so the current patch cannot be carried unchanged.
- **Defer / unsupported**: neither native mechanics, exact equivalence, nor a sufficiently specified and testable compatibility patch is available.
- **Not applicable**: other generation, upstream set data, upstream UI, CI, or tooling unused by the local runtime.

Call out inferences explicitly. Example: "The upstream field now defaults to inactive, and the local adapter omits it; therefore a tarball-only update would disable the effect."

### 7. Produce the report

Lead with the decision, then include:

1. local base SHA, frozen upstream head SHA, audit time, and commit count
2. support scope for each finding: metadata, native mechanics, exact alias, CC patch, unsupported, or unrelated upstream
3. prioritized functional changes with upstream commit links
4. exact local code paths that make each change relevant or irrelevant
5. current patch lifecycle decision: none, keep, retire, rebase, or replace
6. dependency-only and double-application risks
7. the smallest safe adoption bundle and validation required
8. explicit sunset condition and changes deferred or not applicable

Use primary GitHub sources and link directly to compare, commit, and source-file pages. State when the upstream package version is unchanged.

## Safe adoption bundle

When the user later requests implementation, choose the smallest matching bundle.

For confirmed metadata or an exact alias:

1. Record an authoritative source plus its applicable game version or verification date, then update tracked source data or overrides, generator, and validator; never hand-edit generated JSON.
2. Preserve the display / saved canonical. Keep any engine alias narrow, explicit, and covered by equivalence and adjacent-case tests.
3. Treat stats, types, power, effects, and other mechanics-bearing data as calculation-supported only when the audited Calc path actually consumes the confirmed values.
4. Do not replace the vendor artifact unless native Calc code is actually required.

For upstream native adoption:

1. Build or obtain the package from the exact audited full SHA and keep the short SHA in the vendor artifact name.
2. Update `package.json`, lockfile resolution/integrity, and every recorded upstream commit constant.
3. Remove or narrow superseded aliases and CC patches before enabling native behavior; test against double application.
4. Regenerate derived catalogs and implement required adapter/domain/UI/persistence fields with explicit fallback values for old saved data.
5. Expose the upstream revision in app metadata when package semver is unchanged.

For a CC compatibility patch:

1. Follow [references/compatibility-patches.md](references/compatibility-patches.md).
2. Build from an exact upstream full SHA plus a reproducible patch or fork commit. Do not edit `node_modules`, the existing tarball, or application-side damage rolls in place.
3. Update the vendor artifact name, `package.json`, lockfile resolution / integrity, and every recorded upstream / patch revision so a clean install reproduces the audited build.
4. Record provenance and a sunset condition, keep the patch upstreamable, and add native-vs-patched parity fixtures where a native reference exists.

For every bundle:

1. Add active, inactive, boundary, combination, and adjacent-unaffected regression tests in proportion to the mechanic.
2. Run repository-specific validation in order: typecheck, data validators, targeted tests, full tests, build, then Browser-visible proof for UI changes.
3. Apply the repository's app-version rule and update the current snapshot / recent entry in `PROGRESS.md` when the change is user-visible or otherwise meaningful.

## Failure handling

- If base is not an ancestor of head, find the merge base and report the divergence instead of presenting a simple upgrade count.
- If the GitHub compare response is too large, enumerate commits and fetch functional patches individually.
- If a web page has a cache miss, use the GitHub connector or git/API evidence; do not downgrade to an npm-version comparison.
- If a declared patch base differs from the installed / vendored base, classify it as rebase-required and do not assume it still applies.
- If upstream may now implement a local patch, compare behavior before adoption and stop rather than risking double application.
- If exact alias equivalence is uncertain, classify it as unsupported; similarity is not evidence.
- If a local test fails because the Windows sandbox cannot load Vite config, distinguish the environment failure and rerun with the required approval.
- If upstream advances during the audit, keep the frozen SHA and state the cutoff. Do not silently mix a newer head into the report.

## Completion checklist

- The local pin is proven by more than package semver.
- The upstream head is frozen to a full SHA and timestamp.
- Commit and per-file diffs were inspected through the latest head.
- Functional package changes were separated from sets, UI, tooling, and unrelated generations.
- Confirmed metadata was separated from engine and calculation support.
- Each recommendation is tied to the actual adapter/runtime path.
- Every exact alias or CC patch has evidence, tests, provenance, an applicable base, and a sunset decision.
- Native adoption was checked for redundant or double-applied local behavior.
- Tarball-only behavior risks and persistence defaults are explicit.
- No implementation occurred during an audit-only request.
- The final report includes direct primary-source links and a concrete next step.
