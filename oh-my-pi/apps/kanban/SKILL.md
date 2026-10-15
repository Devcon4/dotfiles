---
name: kanban
description: |
  Local kanban board for project and task tracking (columns, cards, blocker
  relations, living card markdown, live HTML mockups, and SSE live refresh).
  Use whenever asked to track tasks, plan work, "put that on the board",
  move/complete cards, seed a board from a plan doc, groom a backlog, ask for a
  status report / standup, or open the kanban site.
---

# Kanban

A reusable task-board app: node server on port 5174, Lit web client, and
file-backed JSON boards.

Before touching a project's boards, read that project's `<dataDir>/README.md`
first (usually `docs/kanban/README.md`) for the board list, scopes, and local
conventions.

## Opt-in and setup

Kanban is a user app available across repositories. A repo opts in with:

```bash
kb init [--project <name>] [--data-dir <path>]
```

This creates `.omp/apps/kanban.json` at the repository root:

```json
{
  "project": "my-project",
  "dataDir": "docs/kanban"
}
```

The app host starts the server when needed, serves all opted-in repositories
from one process, and provides a session-start digest to the model.

## Running the server and UI

```bash
kb up       # starts the app server via the host and prints the project URL
```

The server binds `0.0.0.0:5174`. WSL's localhost forwarding to a 127.0.0.1
socket can wedge after a restart, so binding all interfaces ensures
reliable connectivity from Windows browsers.

Web interface URLs:
- `http://localhost:5174/` — Lists all opted-in projects and their board counts.
- `http://localhost:5174/<project>/` — Project board home and search.
- `http://localhost:5174/<project>/<board>/` — Individual board view.

## CLI (`kb`)

Agents interact with the board using `kb` commands:

```bash
kb boards                                     # list project boards
kb new-board "Name" [--slug s] [--accent "#hex"] [--template simple|asset-production] [--review]
kb show <board> [--json] [--archived]         # board columns and cards
kb card <board> <card> [--json]               # show single card (card = 12 | #12 | c12)
kb add <board> "Title" [--column backlog] [--index n] [--body "md" | --body-file f] [--template t]
     [--labels a,b] [--size XS|S|M|L|XL] [--assignee ai|user] [--color "#hex"] [--blocked "reason"]
kb edit <board> <card> [same flags; use `none` to clear fields]
kb move <board> <card> <column> [--index n]
kb done <board> <card...>   /  undone <board> <card...>
kb archive <board> <card...>  /  restore <board> <card> [--column id]
kb label <board> <id> "Display Name" "#color"
kb task <board> <card> <index> <on|off>       # toggle nth task checkbox (0-based)
kb promote <board> <card> <taskIndex>         # split task item into its own card
kb stats <board> [--json]                     # per-label/column summary + blocked list
kb activity <board> [--lines N]               # recent actions (user vs ai)
kb digest                                     # session summary of columns, blocked, review cards
kb find <query>                               # search all boards in project
kb link <board> <card> <blocker...>           # add blocker card references
kb unlink <board> <card> <blocker...|all>     # remove blocker references
kb brief <board> [--body "md" | --body-file f]# view or update board brief strip
kb attach <board> <card> <image> [--alt text] # attach image file into card body
kb mockup <board> <card> <file.html> [--title T] # link sandboxed iframe mockup
```

Every mutating command accepts `--as <user|ai>` (default **ai**). Pass
`--as user` only when relaying an explicit user instruction to preserve honest
attribution in the activity log.

## Session-start digest

At session start, the app host injects the output of `kb digest`. The digest
summarizes per-board counts by column, blocked cards, cards awaiting review in a
Review column, and any actions taken by `user` since the last session.

## Data schema (`boards/<slug>.json`)

```jsonc
{
  "name": "Slice Polish",
  "slug": "slice-polish",
  "accent": "#e8a13a",
  "archived": false,
  "nextCardId": 15,
  "labels":  [{ "id": "ui", "name": "UI", "color": "#e8a13a" }],
  "columns": [
    { "id": "backlog", "name": "Backlog", "color": "#8b949e", "wip": 0, "done": false },
    { "id": "doing", "name": "In Progress", "color": "#e8a13a", "wip": 3, "done": false },
    { "id": "done", "name": "Done", "color": "#57ab5a", "wip": 0, "done": true }
  ],
  "order": { "backlog": ["c1", "c2"], "doing": [], "done": [] },
  "brief": "Standing context strip read at session start",
  "cards": {
    "c1": {
      "id": "c1", "num": 1,
      "title": "Header cleanup",
      "body": "Markdown text. `- [ ]` checkboxes are interactive.",
      "labels": ["ui"],
      "size": "M",
      "assignee": "ai",
      "color": null,
      "blocked": null,
      "blockedBy": [],
      "completed": false,
      "archived": false,
      "createdAt": "2026-10-04T00:00:00.000Z",
      "updatedAt": "2026-10-04T00:00:00.000Z",
      "completedAt": null
    }
  },
  "createdAt": "2026-10-04T00:00:00.000Z",
  "updatedAt": "2026-10-04T00:00:00.000Z"
}
```

Invariants: every non-archived card appears in exactly one `order` list; every
`order` id exists in `cards`; card key matches `c<num>`; referenced labels exist.

## Conventions

1. **Session ritual:** Before modifying a board, check standing context:
   `kb brief <board>`, `kb activity <board> --lines 20`, and `kb stats <board>`.
2. **The description is the living document:** When understanding or status
   evolves, edit the card body in place (`kb card` to inspect, `kb edit`). Never
   clobber user-written text; fold it in.
3. **Hybrid completion:** Moving a card into a column with `done: true`
   completes it; moving it out reopens it. `kb done` and `kb undone` work anywhere.
4. **Card style:** Short imperative titles; markdown bodies with `- [ ]` lists
   for sub-tasks. Reference related cards as `#12` in card text.
5. **Relations:** Dependencies use `blockedBy` (`kb link`), not prose. The
   `blocked` text field is reserved for external blockers (waiting on human decision,
   external vendor, etc.).
6. **Archiving:** The UI and CLI use archive instead of deleting files. To purge
   a card completely, edit the JSON file directly.
7. **Proof on done:** Before moving a card to a done column, add proof to its
   body that the work runs, usually a screenshot of the result. When the
   project's README names a screenshot app, store the capture there and link to
   its page for that capture; the link renders as a preview (see Link previews).
   Otherwise `kb attach` the image. Work with nothing to screenshot, such as a
   refactor or a CLI change, records the command and output that proved it.

## Card templates

Shared body templates live in the app's `templates/` folder:
- `bug.md` — summary, repro steps, expected vs actual, root cause.
- `feature.md` — user intent, UX details, acceptance criteria.
- `engineering.md` — technical architecture, trade-offs, rollout plan.
- `techdebt.md` — carry cost, remediation, migration path.

A repository's `<dataDir>/templates/<name>.md` overrides a shared template of
the same name. Use `kb add <board> "Title" --template <name>` or `--body-file` to
seed a card body.

## Workflow shims (eval orchestration)

For scripted workflows or parallel subagents, use the client shims so writes
serialize through the HTTP API lock:

```python
import client as kb
kb.ensure_up()
card = kb.add("my-board", "Title", body="- [ ] task", column="doing")
kb.link("my-board", card["id"], 12)
```

```javascript
import * as kb from "./client.ts";
await kb.ensureUp();
await kb.move("my-board", 12, "done");
```

## Images and mockups

- **Images:** Stored under `<dataDir>/images/<board>/`. Attached with
  `kb attach <board> <card> <path> [--alt text]`. Served under
  `/<project>/images/<board>/<file>`.
- **HTML mockups:** Stored under `<dataDir>/mockups/<board>/<name>.html`.
  Linked with `kb mockup <board> <card> <file.html>`. Served under
  `/<project>/mockups/<board>/<file>.html` and rendered in sandboxed iframes.
- **Link previews:** A link alone on its line of a paragraph or list item that
  points at a page on `localhost`, `127.0.0.1` or `[::1]` renders as an image
  preview when the page's HTML declares `<meta property="og:image">`. Clicking
  the preview opens the page. The server fetches the page through
  `GET /api/preview?url=<link>` and caches the result for a minute; links inside
  a sentence stay text. An app gets previews by serving `og:image` and
  `og:title` on its pages. Kanban holds no code for any particular app.

## Playbooks

### Seeding a board from a plan doc
1. Create board: `kb new-board "<Name>" [--review]`.
2. Extract self-contained deliverables as cards: `kb add <board> "<Title>"`.
3. Sub-steps belong as `- [ ]` checklist items in card bodies, not separate cards.
4. Set dependencies using `kb link <board> <card> <blocker...>`.
5. Point the source doc at the board for live execution tracking.

### Standup / status report
1. `kb boards` to view active boards.
2. `kb stats <board>` to review column distribution and blocked cards.
3. `kb activity <board> --lines 20` to inspect recent modifications.
