# CC compatibility patch audit

Read this reference only when an audit finds or proposes an exact engine alias, patched `@smogon/calc` build, or CC-maintained Calc fork.

## Allowed compatibility paths

Use the least powerful path that can produce a correct result:

1. **Metadata override**: correct identity, availability, or form association—and only engine-consumable stats, types, moves, or items—using an authoritative source with an applicable game version or verification date. Metadata alone never changes mechanics or establishes calculation support.
2. **Exact engine alias**: preserve the user-facing and saved canonical while projecting to an existing engine canonical whose behavior is completely equivalent for every supported trigger and state.
3. **CC compatibility patch**: add missing direct-damage mechanics inside a reproducible Calc fork or patch queue based on an exact upstream full SHA.
4. **Unsupported**: use when the specification, equivalence proof, engine hook, or validation coverage is insufficient.

Do not call metadata correction a mechanics patch. Do not escalate to a fork when a tracked source-data override is sufficient.

Every metadata override needs provenance, an applicable version or verification date, generator input, and validator coverage. If the audited Calc path does not consume a mechanics-bearing value, keep `calculation-supported` false even when the catalog and UI are correct.

## Hard rejection conditions

Reject or defer a proposal that does any of the following:

- scales or rounds the returned damage array in application code
- copies a nearby Calc formula without proving modifier order, rounding, minimum damage, suppression, and combination behavior
- aliases effects because they look similar or share one multiplier
- edits `node_modules`, an existing tarball, or generated vendor contents by hand
- omits the exact upstream base SHA or cannot reproduce the patched artifact
- silently treats an unknown canonical as no effect, a base-form effect, or an unrelated supported effect
- allows native upstream and local patch logic to run together
- claims battle behavior outside ChampionCreator's supported calculation surface

## Required patch record

A CC compatibility patch or fork must record:

- stable patch id and affected canonical names
- exact upstream base full SHA and patched fork / commit identity
- source specification and what remains inferred or unsupported
- engine files and calculation phase changed
- required adapter, domain, serialization, worker, generated-data, UI, and documentation changes
- active and inactive behavior
- interaction cases that affect modifier order or suppression
- upstream issue or pull request when practical
- sunset condition and how the audit detects native support

The vendor artifact name or adjacent provenance metadata must distinguish the upstream base and CC patch revision. Package semver alone is insufficient.

## Validation depth

Choose tests from the actual mechanic, not a fixed ceremonial list. A direct-damage patch normally needs:

- active and inactive cases
- minimum and maximum rolls or direct parity with a trusted implementation
- critical hit and ability-suppression behavior when relevant
- single-hit, multi-hit, and repeated-attack behavior when relevant
- interaction with other modifiers at the same calculation phase
- adjacent moves, abilities, and forms that must remain unchanged
- adapter, Worker, search final revalidation, and saved-data fallback when new state is carried

An exact alias needs equivalence tests that would fail if the existing engine mechanic changes or if unsupported conditions differ. Catalog presence alone is not a mechanics test.

## Lifecycle decisions

For each local patch, return one lifecycle decision:

- **Keep**: upstream still lacks it; the declared base and all tests remain valid.
- **Retire**: upstream is equivalent; remove the local path before native adoption and prove no double application.
- **Rebase**: upstream changed the patch location or adjacent semantics; rebuild and rerun the full patch matrix.
- **Replace**: upstream behavior differs intentionally or a better native hook now exists; migrate with explicit compatibility handling.
- **Block**: provenance, specification, equivalence, or tests are insufficient.

If upstream appears to support the feature, compare trigger conditions, calculation phase, rounding, suppression, defaults, and outputs. Matching names or headline multipliers are not enough to retire a patch.

## Report shape

Include these fields for every compatibility finding:

```text
Decision: Adopt now / Adopt with coordinated migration / Defer / Not applicable
Scope: Metadata / Native / Exact alias / CC patch / Unsupported
Evidence: pinned SHA, frozen head SHA, local patch revision, runtime path
Lifecycle: None / Keep / Retire / Rebase / Replace / Block
Adoption bundle: required source, vendor, adapter, data, migration, and tests
Sunset: native condition and double-application check
```
