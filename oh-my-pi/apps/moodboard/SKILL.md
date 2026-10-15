---
name: moodboard
description: Build, update, and serve visual reference moodboards for any topic. Use when asked for visual references, asset inspiration, mood or style examples, to add or swap images on a moodboard, or to open the moodboard app.
argument-hint: What to research or open, e.g. "storage chests" or "cabin assets"
---

# Moodboard

A visual reference microsite and omp user app with local server for hide marks, notes, and a topic homepage.

## Layout

The tool is a user app running under the omp app host:

- App folder: `~/.omp/agent/apps/moodboard/` (symlink to `<dotfiles>/oh-my-pi/apps/moodboard/`).
- Server: Bun server on port 5173 (`serve.ts`).
- Client: static vanilla scripts (`mosaic.js`, `board.js`, `homepage.js`, `template.css`).
- CLI: `moodboard` (`cli.ts`).

## Opt-in

A repository opts into moodboard by committing `.omp/apps/moodboard.json`:

```json
{
  "collection": "my-project",
  "dataDir": "docs/moodboards"
}
```

To create this file in the current repository, run `moodboard init` or `/moodboard init`.

## Running the server

- For the dev: slash command `/moodboard` starts the server if needed and opens the browser to the current repository collection page.
- For agents: run `moodboard up`. It ensures the server is running, records the opt-in, and prints the collection URL.
- Server status: `moodboard status`.
- The server binds `0.0.0.0:5173` on all interfaces, avoiding WSL localhost forwarding socket stalls.

Ensure the server is running (`moodboard up`) before editing or creating boards.

## URLs

- `http://localhost:5173/`: lists all opted-in collections.
- `http://localhost:5173/<collection>/`: collection topic homepage.
- `http://localhost:5173/<collection>/<board>`: rendered board page.
- `http://localhost:5173/<collection>/api/...`: collection API endpoints.

## Data storage

Data lives in each repository under its configured `dataDir` (default `docs/moodboards`):

```
<dataDir>/
  boards/
    <slug>.json            curated content (AI-authored, append-only)
  state/
    _meta.json             collection topic visibility state
    <slug>.json            user state (hidden marks, notes)
```

`<slug>` is a 1 to 4 word kebab-case name. The server renders board HTML on the fly from `<dataDir>/boards/<slug>.json`.

## Creating a board

1. Copy `example.json` from the app directory to `<dataDir>/boards/<slug>.json`.
2. Set `topic`, optional `subtitle`, and fill `images`.
3. Ensure the server is up (`moodboard up`).
4. Write the brief as a pinned AI note: `POST /<collection>/api/note` with `pinned: true`.

## Data schema

```json
{
  "topic": "Survival Chests",
  "subtitle": "ref pull 2026-05-24",
  "images": [
    {
      "url": "https://...",
      "title": "Valheim wooden chest",
      "source": "https://valheim.fandom...",
      "tags": ["wooden", "viking"],
      "note": "iron banding is great",
      "tint": "#1a1a1a"
    }
  ]
}
```

Only `url` is required. Image dimensions are measured at load time; do not include width or height. The first image lands closest to center after pinned notes.

## State and hide marks

State files live in `<dataDir>/state/`.

Per-board state (`<slug>.json`):

```json
{
  "hidden": {
    "https://upload.wikimedia.org/.../foo.jpg": {
      "reason": "too ornate",
      "at": "2026-05-24T16:30:00.000Z"
    }
  },
  "notes": []
}
```

Global state (`_meta.json`):

```json
{
  "topics": {
    "old-spike": {
      "hidden": true,
      "hiddenReason": "wrong direction",
      "at": "2026-05-24T16:30:00.000Z"
    }
  }
}
```

### Treat hide reasons as negative prompts

Before hunting a new batch of references for a board:

1. Read `<dataDir>/state/<slug>.json`.
2. For each hidden entry, read `reason`.
3. Phrase those reasons as anti-patterns for the upcoming batch.
4. State your read before hunting: "Hidden refs: 3 with reason too ornate. Avoiding ornate pieces and tightening to functional design."

### Notes convention

Notes live in `<dataDir>/state/<slug>.json` under `notes`:

```json
{
  "id": "<uuid>",
  "author": "ai",
  "body": "markdown supported",
  "title": "optional",
  "pinned": false,
  "color": "yellow",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Two conventions:

1. The brief is the first note on any new board, authored by AI with `pinned: true`. It captures user intent, goals, constraints, and what to avoid.
2. After each non-trivial hunt round, write an axis note: unpinned, author `ai`, 3 to 5 lines summarizing the direction explored and reasons.

## API

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/<collection>/api/topics` | none | `{boards: [...]}` |
| POST | `/<collection>/api/topic-mark` | `{board, hidden, reason?}` | `{ok: true}` |
| GET | `/<collection>/api/state?board=<slug>` | none | `{hidden: {...}, notes: [...]}` |
| POST | `/<collection>/api/mark` | `{board, url, hidden, reason?}` | `{ok: true, hiddenCount}` |
| POST | `/<collection>/api/note` | `{board, author, body, title?, color?, pinned?}` | `{ok: true, note}` |
| PATCH | `/<collection>/api/note` | `{board, id, body?, title?, color?, pinned?}` | `{ok: true, note}` |
| DELETE | `/<collection>/api/note?board=<slug>&id=<uuid>` | none | `{ok: true}` |
| GET | `/<collection>/api/board?slug=<slug>` | none | raw board JSON |
| GET | `/<collection>/<slug>/` | none | rendered board HTML |

## Hunting images

Work top-down from these sources:

1. Game wikis:
   - `minecraft.wiki/images/<Name>.<ext>`
   - `<game>.wiki.gg/images/<Name>.<ext>`: drop `/thumb/` and `<N>px-` prefix for full resolution.
   - `static.wikia.nocookie.net/<wiki-id>/images/X/XX/<Name>.<ext>/revision/latest`: works without referer; 404s if foreign `Referer` header is sent.
   - `stardewvalleywiki.com/mediawiki/images/X/XX/<Name>.<ext>`
   - `pzwiki.net/w/images/X/XX/<Name>.<ext>`
   - `dodo.ac/np/images/X/XX/<Name>.<ext>`
2. Wikimedia Commons:
   - `https://upload.wikimedia.org/wikipedia/commons/X/XX/<filename>`
   - Strip `/thumb/` segment and `<N>px-` prefix for full resolution.
3. Flickr static:
   - `https://live.staticflickr.com/<server>/<id>_<secret>_b.jpg` (`_b` suffix is 1024px version).
4. Museum APIs:
   - MET, Smithsonian Open Access, NGA.

### Verifying URLs

Verify URLs sequentially with curl before saving to board data:

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
curl -sSL -o /dev/null -A "$UA" -w "%{http_code} %{content_type} %{size_download}\n" "$URL"
```

Expect `200 image/*`. Avoid tight parallel loops to prevent rate limits.

## Rules

- Hotlink images directly; do not download local image files.
- Read `<dataDir>/state/<slug>.json` before hunting more references.
- Treat hide reasons as negative prompts.
- Do not add dimensions to image entries; client measures dimensions at load time.
- Do not mutate `<dataDir>/state/*.json` manually when the API is available.
