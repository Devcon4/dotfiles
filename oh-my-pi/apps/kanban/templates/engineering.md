<!-- Target/Change/Acceptance — the same shape work is delegated in this repo. -->

## Target
<exact files, symbols, systems in scope — and explicit non-goals>

**Why:** <one sentence — what this unblocks or fixes; link the blocked card as #N>

## Change
1. <step — add/remove/rename what, where; name APIs and patterns to follow>
2. <step>
3. <step>

**Constraints:** <ADR contracts to honor (cite `docs/adr/…`), gotchas from
AGENTS.md that apply, performance requirements (Burst job vs main thread, etc.)>

## Acceptance
- [ ] <observable result — behavior, not "code compiles">
- [ ] Compiles clean via unity-refresh (for .cs/.shader/.asmdef changes)
- [ ] Runtime-verified via <playmode run / worldstats / specific log line>
- [ ] Callsites/docs updated (`lsp references` before changing exported symbols)
