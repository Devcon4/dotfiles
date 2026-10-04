---
name: scratch-docs
description: "Create and work short-lived planning documents under docs/scratch/: feature/architecture proposals, task breakdowns, coverage matrices, upgrade guides / subagent runbooks, and review-board findings. Use when a dev lays out a change to design, when planning multi-step work that needs a shared artifact, when coordinating subagents through a checklist, or when a proposal should survive iteration rounds with the dev. Includes the draft → research → adversarial review → revise → iterate workflow."
argument-hint: "What to draft, e.g. 'proposal for the save-file migration' or 'upgrade runbook for the framework bump'"
---

# Scratch documents — patterns + workflow

Scratch docs are **short-lived working artifacts** in `docs/scratch/`
(checked in as review history; the dev deletes them once promoted). They exist so
design work, multi-agent coordination, and iteration with the dev happen in a
durable-enough file instead of scrollback — and then they die.
`docs/scratch/AGENTS.md` restates the inviolable rules at the point of use for
agents that land there without this skill. Where a repo's `docs/scratch/AGENTS.md` adds
a doc type or overrides a convention, the repo file wins for that repo.

## Lifecycle rules

- **Location/naming:** `docs/scratch/<slug>.<type>.md` — types: `proposal`,
  `tasks`, `matrix`, `runbook`, `findings`, `notes`, `brainstorm`. One topic per file.
- **Header every doc:** first lines state `Status:` (`draft | in-review | revised-N |
  approved | executing | done`), `Updated:` date, and `Owner:` (dev or agent name).
- **Never cited.** Committed code/docs must not reference a scratch path; whether a doc is
  committed or deleted is the dev's call, never an agent's `git add`.
- **Promote what survives:** a decision that changes behaviour becomes an ADR under
  `docs/adr/`; usage, design intent and measured behaviour go to the repo's durable docs
  (wiki, GDDs, guides; the repo's `AGENTS.md` names them); durable conventions go to the
  relevant `AGENTS.md`; the scratch file is then deleted. A scratch doc that outlives its work is a defect.
- Reading a stale scratch doc: trust `Status:`/`Updated:` over content; confirm against the
  repo before acting on claims older than the current branch state.

## Pattern playbook (pick per intent; templates in [patterns.md](./references/patterns.md))

| Pattern | Use when | Key properties |
| --- | --- | --- |
| **Proposal** | dev describes a feature/architecture change to design | Problem → current state (file:line evidence) → proposed design with tradeoffs → alternatives as they genuinely exist (zero to many) → risks → execution sketch. Opinionated: one recommended path. Written as a plain-English pitch to the dev — see *Proposal voice* below. Detailed task breakdown comes AFTER approval, as its own `tasks`/`runbook` doc. |
| **Task list** | agreed work needs decomposition + tracking through execution | Phased checkboxes, each task 5–10 words with an acceptance criterion; ∥ marks parallelizable; each phase ends with a `Gate:` task naming an observable check. Checked boxes get evidence appended. The SINGLE execution tracker — never shadow it with a second status doc. Dev-only steps (review, commit, push, merge) are never tasks; the dev does them by hand. |
| **Matrix** | the work or coverage is a cross-product of two dimensions | Rows × columns are the problem's axes (entity × operation, workflow × coverage layer, feature × environment); cells hold status/evidence. Exists to expose HOLES at a glance. A one-dimensional item×status table is a task list wearing a costume — use `tasks`. |
| **Upgrade guide / runbook** | a checklist another (possibly low-context) agent executes | Imperative steps with exact commands, per-step verification, preconditions, rollback. Assume the executor has NOT read the repo; inline everything they need. |
| **Findings** | aggregating review/audit output | One row per finding: severity, claim, evidence (file:line), disposition (`accepted / rejected+why / fixed+where`). Dispositions are mandatory — an undispositioned finding blocks `approved`. |
| **Notes** | research fan-out results worth keeping during a task | Per-question answers with sources; merge into the proposal, then delete. |
| **Brainstorm** | the design space is genuinely open and the dev wants competing holistic designs, not one pitched recommendation | Expert room (below): persona agents self-organize into groups over hub/IRC; each group delivers a full design; the doc = single-author synthesis header (convergence/divergence matrix + dev calls) with every group proposal appended VERBATIM. Independent convergence across groups is the strongest signal the doc can surface. Unlike a `proposal`, the deliverable is the decision surface, not an opinion — though a recommendation the dev can overrule is welcome. |

Templates are **starting points**: keep the header and the evidence/disposition rules,
then reshape sections to this run's problem — delete what has nothing to say, add what
the problem demands.

## The proposal workflow (the main event)

A dev lays out a change → you produce a reviewed first draft → the dev iterates on it.

1. **Capture the ask.** Write the `Problem` + `Constraints` sections from the dev's words
   before touching code. Unstated constraints you infer get marked `(inferred)`.
2. **Research.** Ground every "current state" claim in the repo (file:line). When the
   surface is broad, fan out research (see "Working with subagents" below) — one
   investigator per subsystem/question, results into a `notes` doc. Never draft against
   guessed behavior. Research is INPUT, not content: the proposal keeps only facts the
   pitch turns on. A fact that justifies one decision sits next to that decision; a fact
   nothing uses stays in the notes; `Current state` stays a screenful — the shared
   picture the dev needs to judge the design, not the audit trail of what you read.
3. **Draft the proposal** using the template, in the *Proposal voice* below. Commit to a
   recommendation — a proposal without an opinion is a survey.
4. **Adversarial review board.** Spawn 3–5 design reviewers with DISTINCT lenses, each
   instructed to **attack** the draft, not summarize it: correctness/data-integrity,
   security/authz, migration+operability (rollout, rollback, compat), simplicity/YAGNI
   ("what can be deleted from this design"), and consumer impact (API/UI/tests). Plus
   always one **pitch editor**, who attacks the DOCUMENT, not the design: does it read
   as a convincing plain-English pitch per *Proposal voice*, and does its STRUCTURE fit
   this problem — sections that don't earn their place, missing ones that would, forced
   alternatives where one path is honest? It flags claims the dev can't validate (no
   evidence), terms that drift from the ubiquitous language, undefined new concepts,
   fluff, research dumped into `Current state` that no decision uses, and paragraphs
   that need the chat history to parse.
   Each reviewer returns findings with severity + evidence. Aggregate into a `findings`
   doc, dedupe, then **disposition every finding** — fixed in the draft, or rejected
   with a reason. No silent drops.
5. **Revise** the proposal (bump `Status: revised-1`), keep a short `## Review log` at the
   bottom: round, top findings, what changed.
6. **Present to the dev.** The message summarizes: recommendation in 2–3 sentences, the
   key tradeoff, what the review board changed, open questions needing a human call.
7. **Iterate.** Each dev round: apply feedback, re-run the *relevant* reviewer lens only
   (not the whole board) plus a fix-verification pass — a `fixed in rev-N` disposition is
   a CLAIM; re-check it against the revised doc before trusting it. Bump `revised-N`,
   append to the review log. When the dev accepts: `Status: approved`, spawn the `tasks`
   doc for execution (a `matrix` only when coverage is genuinely two-dimensional), and
   promote durable decisions into `docs/` as the work lands, deleting the
   scratch files.

### Proposal voice — write for the dev, not for another agent

A proposal is a **pitch**: its job is to convince the dev this is the right path, in
plain English. Assume the dev has NOT read the code you just read and does not share
your context:

- **Explain, don't allude.** Every decision states the reasoning and the facts it rests
  on, with the evidence (file:line, command output, measurement) inline — the dev must
  be able to *validate* each claim, not take it on faith. A claim the dev can't check
  is a weakness in the pitch.
- **Speak the domain's language** (DDD ubiquitous language). Domain terms mean exactly
  what they mean in the code, the schemas, and the repo's `AGENTS.md` and README;
  never coin a synonym for an existing concept or reuse an existing term for
  something new. When the proposal genuinely introduces a new concept, name it once,
  define it in one line at first use, then use that name everywhere — that's how it
  enters the shared language for dev, QA, and agents alike.
- **Show the shape.** When the design is code-shaped (new architecture, pattern, API),
  include short snippets of the key signatures, types, or contracts — the skeleton the
  dev can mark up to correct the strategy, never the implementation. A 10-line sketch
  beats three paragraphs describing it. Not every proposal needs one (a test-writing
  plan may not); when it applies, the snippet IS the pitch's centerpiece.
- **Concise wins.** Every sentence earns its place. No filler, no throat-clearing, no
  restating the heading, no agent/harness jargon. Short declarative sentences; split
  em-dash-chained clauses (a known LLM tic). Bullets and tables over paragraphs. A
  section that fits in one sentence is one sentence. Sufficient beats thorough: say it
  plainly once, then stop.

## The brainstorm room (competing-designs workflow)

When the dev asks for alternatives rather than a pitch: convene an expert room and let
groups compete. Proven mechanics:

1. **Size the session FIRST — a judgment call the calling agent owns**, made before any
   spawn and recorded in the doc header (`Session: small|medium|large — <one-line why>`).
   | Size | Fits | Room | Output |
   | --- | --- | --- | --- |
   | **Small** | one file/subsystem, a simple or well-bounded question | 4–6 personas, ONE group (skip formation; it is just a mixed panel) | one brainstorm doc |
   | **Medium** | a broad problem inside one domain | ~8–12 personas, 2–3 groups | one brainstorm doc |
   | **Large** | cross-domain, the hardest problem class | 14+ personas, 3–5 groups | brainstorm doc PLUS branch-out: group findings that stand alone graduate into their own `proposal`/`tasks`/custom docs instead of dying in an appendix |
   Oversizing burns agents and drowns signal; undersizing misses the design family a
   missing lens would have found. When honestly torn, size DOWN and let the room's
   "what's missing" tell you to re-run bigger.
2. **Personas.** Spawn per the size above, each with a DISTINCT expertise + a one-line
   design instinct they must represent even when inconvenient (type theory, framework
   internals, YAGNI, security chokepoints, test harness, migration cost, pattern history, ...).
   One contrarian lens per likely design family keeps groups honest.
   **Do NOT staff the room with senior programmers only** — an all-expert pool converges
   on expert blind spots. Reserve ~a third of the seats for wildcards the experts must
   bounce off:
   - *Juniors* — a first-year dev who must be able to follow the design; their honest
     confusion is data, and a group that cannot explain itself to its junior fails.
   - *Non-programmers* — pick per problem: the on-call operator woken by it at 3am, the
     support agent explaining its errors, the auditor tracing who-did-what, the tech
     writer documenting it, the end user living with the workflow.
   - *Wildcards* — a beginner's-mind generalist who asks "why does this exist at all",
     or an outside-field thinker (economist on incentives, safety engineer on failure
     drills) when the problem has that shape.
   Groups must mix: at least one non-expert per group; a roster of five experts is sent
   back to reform.
3. **Shared brief** in a `local://` file every prompt references: the problem, the exact
   code-to-beat (paste it), HARD constraints including the dev's taste rulings verbatim,
   the room protocol, and the group-proposal output contract. Agents share no chat
   history — the brief is the only common ground.
4. **Broadcast budget.** IRC broadcasts interrupt everyone: one intro each (id + persona
   + 2-sentence instinct); group leads get one roster + one `DONE <name>` broadcast; all
   else DMs. Without the budget the room drowns itself.
5. **Self-formed groups** of 3–5 (group count per the size table; small sessions skip
   formation entirely — the whole room is the group): agents DM peers whose instincts
   complement or conflict interestingly; a self-nominated lead broadcasts the roster;
   stragglers join the smallest group; if formation stalls, the alphabetically-first
   unclaimed agent self-nominates. Groups may trade ideas lead-to-lead.
6. **Group deliverable** to `local://<slug>-group-<name>.md` under a fixed contract:
   Thesis / Design (real code sketch) / deleted-added / Reflection-or-constraint audit /
   proof against the harness realities / Migration cost / Risks / **Dissent (required
   when any member disagrees — dissent sharpens proposals)**. Any member may deputize
   the DONE broadcast if the lead dies mid-run; check the file exists rather than
   trusting job status (crashed-at-yield agents usually delivered first).
7. **Synthesis is single-author.** The orchestrator alone writes the scratch doc:
   convergence/divergence matrix, a read the dev can overrule, explicit dev calls, and
   the group docs appended verbatim as appendices (never rewritten — they are the
   evidence). Multi-author assembly is how patchwork voice happens; fan out for ideas,
   never for the final text.

No parallel subagents in your harness? Degrade per the portability section: run each
persona-group as a sequential fresh-context pass and say so in the doc
(`Mode: sequential`).

## Working with subagents (harness portability — read this)

A repo may be worked on from multiple agent harnesses. Concepts above assume parallel
subagents; degrade gracefully:

- **Fan-out** = running several independent investigator/reviewer subagents concurrently,
  each with a self-contained prompt (they do NOT share your conversation). In OMP this is
  the task tool / workflow orchestration; in Claude Code the Task tool; in VS Code,
  handoffs. **If your harness has none of these:** do the passes sequentially, one lens at
  a time, ideally each in a fresh session/context so earlier reasoning doesn't contaminate
  the attack — and say so in the review log (`Mode: sequential`).
- **Prompts are self-contained.** A subagent gets: the scratch doc path, the specific
  question/lens, the repo areas to read, and the required output shape (findings table
  rows). Never assume it saw the chat.
- **Coordination artifact = the doc.** Subagents write findings back as table rows (or
  return them for you to merge); the scratch doc — not chat history — is the shared state.
  For a `runbook`, the executing agent checks boxes + fills the verification column as it
  goes, so a successor can resume mid-run.
- **Adversarial means adversarial.** Reviewer prompts must instruct refutation ("find what
  breaks; if you find nothing wrong, say so explicitly after listing what you checked") —
  a reviewer that paraphrases the draft has failed.

## Rules

- Scratch docs never contain secrets/credentials — reference secrets by name/key and
  accounts by username, never by value.
- One writer per doc at a time (subagents return rows; the orchestrator merges) — unless
  the doc explicitly assigns per-agent sections/rows.
- Don't gold-plate: a 10-line task needs no proposal. Reach for this skill when the work
  has real design surface, multiple execution steps, or multiple participants.
