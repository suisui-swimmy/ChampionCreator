---
name: audit-smogon-calc-upstream
description: Compare a repository's currently pinned @smogon/calc upstream commit with the latest commit on smogon/damage-calc, classify the real runtime impact, and recommend a safe adoption scope without treating the npm package version as a freshness signal. Use when asked whether Smogon calc is outdated, what changed since the pinned vendor commit, whether upstream changes should be adopted, or what must accompany an @smogon/calc refresh.
---

# Audit Smogon Calc Upstream

Audit first; do not update the dependency unless the user also asks for implementation. Freeze both ends of the comparison to full commit SHAs and base the recommendation on the repository's owning calculation path.

## Non-negotiable rules

1. Never use the npm version alone to decide freshness. Upstream may merge calculation, data, or Champions support while `calc/package.json` keeps the same version.
2. Compare the repository's pinned upstream commit against the latest commit on the upstream default branch.
3. Inspect patches and local consumers. Do not classify importance from commit titles alone.
4. Separate upstream calculator-package changes from set data, upstream website UI, workflows, imports, or generations the local app does not execute.
5. Treat `@smogon/calc` as the damage-calculation authority. Do not compensate for an upstream difference by inventing a local damage formula.
6. Report the audit without mutating dependency, generated data, versions, or runtime code unless implementation was explicitly requested.

## Workflow

### 1. Establish the local calculation boundary

Read repository instructions first, then inspect the smallest relevant file set:

- `AGENTS.md`, `README.md`, `package.json`, `package-lock.json`, and the `PROGRESS.md` snapshot / recent entries
- `PROGRESS.archive/` only when a targeted history search is needed to resolve missing or conflicting pin evidence
- the `@smogon/calc` adapter and parity tests
- generator scripts and generated metadata that record an upstream commit
- domain, UI, persistence, worker, or search code that carries fields changed upstream
- the installed package metadata when `node_modules` is available

Record:

- dependency form: registry version, git dependency, or vendor tarball
- installed package version and resolved artifact
- actual generation or ruleset used at runtime
- upstream commit recorded by the vendor filename, generator, generated JSON, README, or bounded progress records
- local API fields passed to `Pokemon`, `Move`, `Field`, and `Side`

Resolve the pinned commit using corroborating evidence. Prefer, in order:

1. generated-data `source.upstreamCommit` or an explicit generator constant
2. vendor artifact name or build metadata
3. dependency declaration and lockfile resolution
4. README or a targeted search of `PROGRESS.md` and, only when needed, `PROGRESS.archive/`

If these disagree, report the mismatch and verify the artifact contents; do not guess a base commit.

### 2. Freeze the latest upstream head

Use the GitHub connector when available, otherwise GitHub's API, web pages, or a read-only git fetch.

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

### 4. Map each functional patch to the local runtime

For every calculator-package change, answer these questions from code:

1. Does it run for the local generation or ruleset?
2. Does the local adapter pass the new or changed state field?
3. Does the change alter defaults when a field is absent?
4. Does it require domain, UI, serialization, share-state, box-storage, worker, or generated-data changes?
5. Would replacing only the tarball silently change existing saved scenarios?
6. Does it affect catalog contents or only mechanics?
7. Is the changed API imported through an internal `dist/**` path that needs compatibility checking?

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

Keep direct attacks behind `@smogon/calc`. Treat Champions-specific constant damage or ordered HP events as separate ruleset/event layers, not reasons to rewrite direct damage.

### 6. Rank the adoption decision

Use these categories:

- **Adopt now**: fixes correctness on an executed local path, resolves a current data gap, or prevents a known wrong result.
- **Adopt with coordinated migration**: valuable, but dependency-only replacement would change defaults or needs adapter/domain/UI/persistence work.
- **Defer**: future mechanic or unsupported input surface with no current user path.
- **Not applicable**: other generation, upstream set data, upstream UI, CI, or tooling unused by the local runtime.

Call out inferences explicitly. Example: "The upstream field now defaults to inactive, and the local adapter omits it; therefore a tarball-only update would disable the effect."

### 7. Produce the report

Lead with the decision, then include:

1. local base SHA, frozen upstream head SHA, audit time, and commit count
2. prioritized functional changes with upstream commit links
3. exact local code paths that make each change relevant or irrelevant
4. dependency-only risks
5. the smallest safe adoption bundle
6. validation required after adoption
7. changes explicitly deferred or not applicable

Use primary GitHub sources and link directly to compare, commit, and source-file pages. State when the upstream package version is unchanged.

## Safe adoption bundle

When the user later requests implementation, perform a coordinated update:

1. Build or obtain the package from the exact audited full SHA and keep the short SHA in the vendor artifact name.
2. Update `package.json`, lockfile resolution/integrity, and any recorded upstream commit constant.
3. Regenerate derived catalogs through project scripts; never hand-edit generated JSON.
4. Implement required adapter/domain/UI/persistence fields and define fallback values for old saved data.
5. Expose the upstream revision in app metadata when package semver is unchanged.
6. Add regression tests for both active and inactive states, automatic behavior, and adjacent unaffected mechanics.
7. Run repository-specific validation in order: typecheck, data validators, targeted tests, full tests, build, then Browser-visible proof for UI changes.
8. Apply the repository's app-version rule and update the current snapshot / recent entry in `PROGRESS.md` when the change is user-visible or otherwise meaningful; rotate older detail through the repository's progress policy.

## Failure handling

- If base is not an ancestor of head, find the merge base and report the divergence instead of presenting a simple upgrade count.
- If the GitHub compare response is too large, enumerate commits and fetch functional patches individually.
- If a web page has a cache miss, use the GitHub connector or git/API evidence; do not downgrade to an npm-version comparison.
- If a local test fails because the Windows sandbox cannot load Vite config, distinguish the environment failure and rerun with the required approval.
- If upstream advances during the audit, keep the frozen SHA and state the cutoff. Do not silently mix a newer head into the report.

## Completion checklist

- The local pin is proven by more than package semver.
- The upstream head is frozen to a full SHA and timestamp.
- Commit and per-file diffs were inspected through the latest head.
- Functional package changes were separated from sets, UI, tooling, and unrelated generations.
- Each recommendation is tied to the actual adapter/runtime path.
- Tarball-only behavior risks and persistence defaults are explicit.
- No implementation occurred during an audit-only request.
- The final report includes direct primary-source links and a concrete next step.
