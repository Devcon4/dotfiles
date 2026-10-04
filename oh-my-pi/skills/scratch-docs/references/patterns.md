# Scratch-doc templates

Skeletons are **starting points, not forms to fill**. Start from the matching one, then
reshape it to this run's problem: delete sections with nothing to say, add ones the
problem demands, vary list/option counts. What never bends: the three-line header, and
the evidence/disposition rules where a template states them.

## `<slug>.proposal.md`

Voice: a **concise pitch to the dev**, in plain English. Assume they haven't read the
code. Every decision carries its reasoning + evidence so the dev can validate it. Terms
follow the domain's ubiquitous language (match the code, schemas, `AGENTS.md` and README, no synonyms); a new
concept is named once, defined in one line, used consistently. Bullets over paragraphs;
every sentence earns its place.

```markdown
Status: draft
Updated: <YYYY-MM-DD>
Owner: <dev or agent>

# Proposal — <title>

## Problem
<What hurts / what's wanted, in the dev's terms. 2–5 sentences.>

## Constraints
- <stated constraint>
- <inferred constraint> (inferred)

## Current state
<Only what the dev needs to judge the design: what exists, what's missing, the few facts
the recommendation turns on. Grounded (`path/file.ts:123`) and a screenful at most. A
fact justifying one specific decision moves next to that decision; a fact no section
uses stays in the notes doc.>

## Proposed design
<The recommended path, in enough detail to attack: data flow, touched components,
contracts. Code-shaped: sketch the key signatures/types in a short snippet the dev can
mark up — skeleton, not implementation. Flow-shaped and genuinely non-obvious: a small
mermaid diagram of just that flow; simple sequences stay prose.>
- Tradeoffs: <cost / risk>

### Alternatives considered  (as many as genuinely exist — zero is honest, four is fine)
- <name> — <one line: what it is; why it loses>. Promote to a full subsection when two
  paths are genuinely close and the dev should pick.

## Risks & migration
- <risk> → <mitigation>
- Rollout: <order>; Rollback: <how>

## Execution sketch  (high-level phases only; delete if obvious)
<Detailed decomposition happens AFTER approval, in a .tasks.md / .runbook.md.>

## Open questions  (delete if none)
- <question only the dev can answer>

## Review log
<For agents, not the dev: what was already reviewed, so a later session doesn't
re-litigate settled findings.>
- round 1 (<date>, mode: parallel|sequential): <top findings → what changed>
```

## `<slug>.tasks.md`

The single execution tracker — no parallel status doc for the same effort.

```markdown
Status: draft → executing when work starts
Updated: <YYYY-MM-DD>
Owner: <who>

# Tasks — <title>   (from <slug>.proposal.md)

## Phase 1 — <name>
- [ ] <task, 5–10 words> — accept: <observable criterion> ∥ (parallelizable)
- [x] <task> — accept: <criterion> — done: <evidence: run/output/file:line>
- [ ] Gate: <observable check that closes the phase>

## Phase 2 — <name>  (blocked by Phase 1: <why>)
- [ ] …
```

## `<slug>.matrix.md`

A matrix is TWO-dimensional: rows × columns are the problem's axes. If you're writing
item-per-row with a status column, that's a task list — use `tasks` instead.

```markdown
Status: executing
Updated: <YYYY-MM-DD>
Owner: <orchestrator>

# Matrix — <title>
Axes: rows = <e.g. entity/workflow>; columns = <e.g. operation/coverage layer>.

|        | create | update | delete | drift-repair |
| ------ | ------ | ------ | ------ | ------------ |
| realm  | ✔ envtest `TestRealmCreate` | doing | todo | — n/a: <why> |
| client | todo   | todo   | todo   | todo         |

Cells: todo / doing / blocked(<why>) / ✔ <evidence> / — n/a: <why>.
A ✔ REQUIRES evidence in the cell; an empty cell is an UNEXAMINED hole — resolve every
cell to worked or n/a before `done`. Single writer: orchestrator merges subagent cells.
```

## `<slug>.runbook.md`

Written for an executor with NO repo context — inline everything. Anchor edits to
symbols/strings with line numbers as hints only — lines drift between authoring and
execution; the content anchor is authoritative.

```markdown
Status: draft
Updated: <YYYY-MM-DD>
Owner: <author>

# Runbook — <title>

Executing without repo context: everything you need is inlined. Work from <repo root>.
Check each box and fill each Verify as you go. A failed Verify means STOP and report —
do not improvise.

## Preconditions
- <thing that must be true; exact command to check it>

## Steps  (execute in order; check the box + fill Verify as you go)
- [ ] 1. <imperative step>
      Run: `<exact command / exact edit with file path>`
      Verify: `<command>` → expect <observable output>
- [ ] 2. …

## Rollback
<Exact steps to undo, per phase if partial.>

## Log  (executor appends)
- <date/agent>: completed through step N; deviations: <none | what+why>
```

## `<slug>.findings.md`

```markdown
Status: in-review
Updated: <YYYY-MM-DD>
Owner: <orchestrator>

# Findings — <title>   (target: <slug>.proposal.md rev N)
Reviewers: <lens list> · Mode: <parallel | sequential>

| # | Sev | Lens | Finding | Evidence | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | high/med/low | security | <claim> | <file:line / quote> | fixed in rev N+1 / rejected: <why> |

Lens = which reviewer perspective produced the row; it routes re-review after a
revision (re-run only the affected lens) and dedupe.
Every row gets a Disposition before the proposal can move to `approved`.
A reviewer reporting "nothing found" lists what it checked.
Later review rounds append a `# Round N (target: rev …)` section with their own
reviewer list; numbering continues across rounds so dispositions can be
cross-referenced. Each round after the first includes a fix-verification pass over the
prior round's `fixed` rows.
```

## `<slug>.notes.md`

```markdown
Status: draft
Updated: <YYYY-MM-DD>
Owner: <agent>

# Notes — <research question(s)>

## Q: <question>
A: <answer>. Sources: <file:line, URL, command output>.
```

## `<slug>.brainstorm.md`

The output of an expert room (SKILL.md → "The brainstorm room"). Size the session first
(small/medium/large per the skill's table) and record it. Synthesis is single-author;
group proposals are appended verbatim — they are the evidence, never rewritten. Large
sessions branch out: standalone group findings graduate into their own
`proposal`/`tasks`/custom docs rather than dying in an appendix.

```markdown
Status: draft (for dev decision)
Updated: <YYYY-MM-DD>
Owner: dev + <orchestrator>
Session: <small|medium|large> — <one-line why>

# Brainstorm — <design question>

How this was made: <N> expert agents (<lens list>) self-organized into <M> groups over
hub/IRC; each group's full proposal is appended verbatim. This header is the synthesis.

## The headline  (lead with convergence/divergence — what did independent groups agree on?)

| | <Group A> | <Group B> | <Group C> |
| --- | --- | --- | --- |
| Shape | ... | ... | ... |
| <the dev's key constraint, e.g. reflection count> | ... | ... | ... |
| Files touched / net LOC | ... | ... | ... |
| <hole it closes / risk it adds> | ... | ... | ... |
| Key dissent recorded | ... | ... | ... |

## My read (yours to overrule)
<2-4 numbered positions: what to adopt, what to decide separately, what to archive.>

## Dev calls
1. <decision only the dev can make>

---

# APPENDIX — group proposal: <Group A>
<verbatim group document>
```

