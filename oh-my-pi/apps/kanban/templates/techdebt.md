<!-- Tech debt ≠ general engineering: the case is cost-of-carry, not a deliverable.
     If you can't name the interest being paid, it's not debt — archive it. -->

**Debt:** <what's wrong with the current implementation, one sentence>
**Where:** `<files/systems>` · **Introduced:** <when/why — the shortcut's original justification>

## Interest being paid
- <concrete recurring cost: "every new verb needs a copy-pasted system", "each
  playtest hits a 5s stall", "this trap bit us in #N and #M">
- <cost>

## Risk of leaving it
<what gets worse and when — scales with content? blocks a roadmap item (#N)?
or genuinely fine to leave until <trigger event>? Be honest: some debt is cheap.>

## Remediation
1. <step — target end-state, migration path for existing content/data>
2. <step>

**Blast radius:** <what could break; which systems/prefabs/scenes need re-verification>

## Acceptance
- [ ] <the interest payment above measurably gone>
- [ ] Existing content migrated — no dual old/new paths left behind
- [ ] <regression check on the blast radius, named explicitly>
