import { existsSync, readFileSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import type * as Kit from "../../plugins/apphost/kit/kit.ts";

// The host passes the kit's location in APP_KIT; an app can live in any repo, so no static path reaches it.
const kit: typeof Kit = await import(`${process.env.APP_KIT}/kit.ts`);
const env = kit.appEnv();

interface Collection {
  name: string;
  slug: string;
  root: string;
  configPath: string;
  dataDir: string;
  boardsDir: string;
  stateDir: string;
  metaPath: string;
}

interface Note {
  id: string;
  author: "ai" | "user";
  body: string;
  title?: string;
  color?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface HideEntry {
  reason: string | null;
  at: string;
}

interface BoardState {
  hidden: Record<string, HideEntry>;
  notes: Note[];
}

interface TopicMeta {
  hidden: boolean;
  hiddenReason: string | null;
  at: string;
}

interface GlobalMeta {
  topics: Record<string, TopicMeta>;
}

interface BoardImage {
  url: string;
  title?: string;
  source?: string;
  tags?: string[];
  note?: string;
  tint?: string;
}

interface BoardData {
  topic: string;
  subtitle?: string;
  images: BoardImage[];
}

let collections: Collection[] = [];

function loadCollections(entries: Kit.IndexEntry[]): void {
  const loaded: Collection[] = [];
  for (const entry of entries) {
    let config: { collection?: string; dataDir?: string } = {};
    try {
      if (existsSync(entry.config)) {
        config = JSON.parse(readFileSync(entry.config, "utf8")) as { collection?: string; dataDir?: string };
      }
    } catch {
      console.error(`${entry.config}: not valid JSON; skipped`);
      continue;
    }

    const name = config.collection ?? basename(entry.root);
    const baseSlug = safeSlug(name);
    let slug = baseSlug;
    if (loaded.some(c => c.slug === slug)) {
      slug = safeSlug(`${baseSlug}-${basename(entry.root)}`);
      let i = 2;
      while (loaded.some(c => c.slug === slug)) {
        slug = safeSlug(`${baseSlug}-${basename(entry.root)}-${i++}`);
      }
    }

    const dataDir = resolve(entry.root, config.dataDir ?? "docs/moodboards");
    const boardsDir = join(dataDir, "boards");
    const stateDir = join(dataDir, "state");
    const metaPath = join(stateDir, "_meta.json");

    loaded.push({
      name,
      slug,
      root: entry.root,
      configPath: entry.config,
      dataDir,
      boardsDir,
      stateDir,
      metaPath,
    });
  }
  collections = loaded;
}

kit.watchIndex(env.index, entries => loadCollections(entries));

function safeSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "default";
}

function validateBoard(slug: string, data: unknown): asserts data is BoardData {
  if (!data || typeof data !== "object") throw new Error(`board ${slug}: root must be an object`);
  const rec = data as Record<string, unknown>;
  if (typeof rec.topic !== "string" || !rec.topic.trim()) throw new Error(`board ${slug}: missing topic`);
  if (!Array.isArray(rec.images)) throw new Error(`board ${slug}: images must be an array`);
  for (let i = 0; i < rec.images.length; i++) {
    const it = rec.images[i];
    if (!it || typeof it !== "object") throw new Error(`board ${slug}: images[${i}] must be an object`);
    const img = it as Record<string, unknown>;
    if (typeof img.url !== "string" || !img.url.trim()) throw new Error(`board ${slug}: images[${i}] missing url`);
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

async function readBoard(col: Collection, slug: string): Promise<BoardData | null> {
  const p = join(col.boardsDir, `${safeSlug(slug)}.json`);
  try {
    const text = await readFile(p, "utf8");
    const data: unknown = JSON.parse(text);
    validateBoard(slug, data);
    return data;
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function readState(col: Collection, slug: string): Promise<BoardState> {
  const p = join(col.stateDir, `${safeSlug(slug)}.json`);
  return readJson<BoardState>(p, { hidden: {}, notes: [] });
}

async function writeState(col: Collection, slug: string, state: BoardState): Promise<void> {
  await writeJson(join(col.stateDir, `${safeSlug(slug)}.json`), state);
}

async function readMeta(col: Collection): Promise<GlobalMeta> {
  return readJson<GlobalMeta>(col.metaPath, { topics: {} });
}

async function writeMeta(col: Collection, meta: GlobalMeta): Promise<void> {
  await writeJson(col.metaPath, meta);
}

async function listBoardSlugs(col: Collection): Promise<string[]> {
  try {
    const entries = await readdir(col.boardsDir);
    return entries
      .filter(e => e.endsWith(".json"))
      .map(e => e.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

async function boardSummary(col: Collection, slug: string) {
  const data = await readBoard(col, slug);
  const state = await readState(col, slug);
  const meta = await readMeta(col);
  const topicMeta = meta.topics[slug];
  const hiddenCount = Object.keys(state.hidden).length;
  const firstImage = data?.images?.[0];
  return {
    slug,
    topic: data?.topic || slug,
    subtitle: data?.subtitle,
    hero: firstImage?.url || null,
    tint: firstImage?.tint,
    count: data?.images?.length || 0,
    hiddenCount,
    hidden: !!topicMeta?.hidden,
    hiddenReason: topicMeta?.hiddenReason || null,
  };
}

function renderBoardHtml(col: Collection, data: BoardData): string {
  const safe = JSON.stringify(data).replace(/<\/(script)/gi, "<\\/$1");
  const title = (data.topic || "Moodboard")
    .replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Moodboard — ${title}</title>
  <link rel="stylesheet" href="/_assets/template.css"/>
</head>
<body>
  <script type="application/json" id="moodboard-data">${safe}</script>
  <script src="/_assets/mosaic.js"></script>
  <script src="/_assets/board.js"></script>
</body>
</html>
`;
}

function renderTopicHomepageHtml(col: Collection): string {
  const title = col.name.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Moodboards — ${title}</title>
  <link rel="stylesheet" href="/_assets/template.css"/>
</head>
<body>
  <script src="/_assets/mosaic.js"></script>
  <script src="/_assets/homepage.js"></script>
</body>
</html>
`;
}

function renderCollectionsHtml(cols: Collection[]): string {
  const items = cols
    .map(c => `<li><a href="/${c.slug}/">${escapeHtml(c.name)}</a> <small>${escapeHtml(c.root)}</small></li>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Moodboard Collections</title>
  <link rel="stylesheet" href="/_assets/template.css"/>
  <style>
    body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; max-width: 680px; margin: 48px auto; padding: 0 16px; color: var(--text, #eee); background: var(--bg-0, #121212); }
    h1 { font-size: 22px; font-weight: 600; margin-bottom: 24px; }
    ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
    li { background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); padding: 12px 16px; border-radius: 6px; display: flex; justify-content: space-between; align-items: baseline; }
    a { color: #f0c56a; text-decoration: none; font-size: 15px; font-weight: 500; }
    a:hover { text-decoration: underline; }
    small { color: rgba(255, 255, 255, 0.45); font-size: 13px; font-family: monospace; }
    p.empty { color: rgba(255, 255, 255, 0.5); }
  </style>
</head>
<body>
  <h1>Moodboard Collections</h1>
  ${items ? `<ul>${items}</ul>` : `<p class="empty">no repo has opted in yet</p>`}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!));
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

async function serveFile(fsPath: string): Promise<Response> {
  try {
    const s = await stat(fsPath);
    if (!s.isFile()) return new Response("Not found", { status: 404 });
    const content = await readFile(fsPath);
    return new Response(content, {
      status: 200,
      headers: {
        "content-type": contentType(fsPath),
        "content-length": String(content.byteLength),
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

function safeJoin(root: string, urlPath: string): string | null {
  const clean = normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const target = resolve(root, `.${sep}${clean}`);
  if (!target.startsWith(resolve(root) + sep) && target !== resolve(root)) return null;
  return target;
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// All interfaces: WSL localhost forwarding to a 127.0.0.1 socket can wedge after a restart.
const server = Bun.serve({
  port: env.port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const denied = kit.checkRequest(req.method, name => req.headers.get(name));
    if (denied) return json({ error: denied.error }, denied.status);

    const url = new URL(req.url);
    const p = url.pathname;

    try {
      if (p === "/_app/health" && req.method === "GET") {
        return json(kit.healthPayload(env.name));
      }

      if (p === "/_app/open" && req.method === "GET") {
        const rootParam = url.searchParams.get("root");
        let col = collections.find(c => c.root === rootParam);
        if (!col) {
          loadCollections(kit.readIndex(env.index));
          col = collections.find(c => c.root === rootParam);
        }
        return json({ url: `http://localhost:${env.port}/${col ? `${col.slug}/` : ""}` });
      }

      if (p.startsWith("/_assets/")) {
        const rel = p.slice("/_assets/".length);
        const fsPath = safeJoin(env.dir, rel);
        if (!fsPath) return new Response("Forbidden", { status: 403 });
        return serveFile(fsPath);
      }

      if (p.startsWith("/skills/moodboard/")) {
        const rel = p.slice("/skills/moodboard/".length);
        const fsPath = safeJoin(env.dir, rel);
        if (!fsPath) return new Response("Forbidden", { status: 403 });
        return serveFile(fsPath);
      }

      if (p === "/" && req.method === "GET") {
        return html(renderCollectionsHtml(collections));
      }

      const parts = p.split("/").filter(Boolean);
      if (parts.length === 0) return html(renderCollectionsHtml(collections));

      const colSlug = parts[0];
      const col = collections.find(c => c.slug === colSlug);
      if (!col) return json({ error: "collection not found" }, 404);

      if (parts.length === 1) {
        if (!p.endsWith("/")) {
          return Response.redirect(`${p}/`, 302);
        }
        return html(renderTopicHomepageHtml(col));
      }

      if (parts[1] === "api") {
        const apiPath = `/${parts.slice(2).join("/")}`;

        if (apiPath === "/topics" && req.method === "GET") {
          const slugs = await listBoardSlugs(col);
          const boards = await Promise.all(slugs.map(s => boardSummary(col, s)));
          return json({ boards });
        }

        if (apiPath === "/topic-mark" && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          const board = typeof body?.board === "string" ? body.board : undefined;
          const hidden = !!body?.hidden;
          const reason = typeof body?.reason === "string" ? body.reason : null;
          if (!board) return json({ error: "missing board" }, 400);
          const slug = safeSlug(board);
          const meta = await readMeta(col);
          meta.topics[slug] = { hidden, hiddenReason: reason, at: new Date().toISOString() };
          await writeMeta(col, meta);
          return json({ ok: true });
        }

        if (apiPath === "/state" && req.method === "GET") {
          const slug = url.searchParams.get("board");
          if (!slug) return json({ error: "missing board" }, 400);
          return json(await readState(col, safeSlug(slug)));
        }

        if (apiPath === "/mark" && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          const board = typeof body?.board === "string" ? body.board : undefined;
          const imgUrl = typeof body?.url === "string" ? body.url : undefined;
          const hidden = !!body?.hidden;
          const reason = typeof body?.reason === "string" ? body.reason : null;
          if (!board || !imgUrl) return json({ error: "missing fields" }, 400);
          const slug = safeSlug(board);
          const state = await readState(col, slug);
          if (hidden) state.hidden[imgUrl] = { reason, at: new Date().toISOString() };
          else delete state.hidden[imgUrl];
          await writeState(col, slug, state);
          return json({ ok: true, hiddenCount: Object.keys(state.hidden).length });
        }

        if (apiPath === "/note" && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          const board = typeof body?.board === "string" ? body.board : undefined;
          const noteBody = typeof body?.body === "string" ? body.body : undefined;
          const author = body?.author === "ai" ? "ai" : "user";
          const title = typeof body?.title === "string" ? body.title : undefined;
          const color = typeof body?.color === "string" ? body.color : undefined;
          const pinned = !!body?.pinned;
          if (!board || !noteBody || !noteBody.trim()) {
            return json({ error: "missing board or body" }, 400);
          }
          const slug = safeSlug(board);
          const state = await readState(col, slug);
          const now = new Date().toISOString();
          const note: Note = {
            id: crypto.randomUUID(),
            author,
            body: noteBody,
            title,
            color,
            pinned,
            createdAt: now,
            updatedAt: now,
          };
          state.notes.push(note);
          await writeState(col, slug, state);
          return json({ ok: true, note });
        }

        if (apiPath === "/note" && req.method === "PATCH") {
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          const board = typeof body?.board === "string" ? body.board : undefined;
          const id = typeof body?.id === "string" ? body.id : undefined;
          if (!board || !id) return json({ error: "missing board or id" }, 400);
          const slug = safeSlug(board);
          const state = await readState(col, slug);
          const note = state.notes.find(n => n.id === id);
          if (!note) return json({ error: "note not found" }, 404);
          const rawBody = body?.body;
          if (typeof rawBody === "string") note.body = rawBody;
          const rawTitle = body?.title;
          if (typeof rawTitle === "string") note.title = rawTitle;
          else if (rawTitle === null) delete note.title;
          const rawColor = body?.color;
          if (typeof rawColor === "string") note.color = rawColor;
          else if (rawColor === null) delete note.color;
          const rawPinned = body?.pinned;
          if (typeof rawPinned === "boolean") note.pinned = rawPinned;
          note.updatedAt = new Date().toISOString();
          await writeState(col, slug, state);
          return json({ ok: true, note });
        }

        if (apiPath === "/note" && req.method === "DELETE") {
          const slugQ = url.searchParams.get("board");
          const id = url.searchParams.get("id");
          if (!slugQ || !id) return json({ error: "missing board or id" }, 400);
          const slug = safeSlug(slugQ);
          const state = await readState(col, slug);
          const before = state.notes.length;
          state.notes = state.notes.filter(n => n.id !== id);
          if (state.notes.length === before) return json({ error: "note not found" }, 404);
          await writeState(col, slug, state);
          return json({ ok: true });
        }

        if (apiPath === "/board" && req.method === "GET") {
          const slug = url.searchParams.get("slug");
          if (!slug) return json({ error: "missing slug" }, 400);
          const data = await readBoard(col, safeSlug(slug));
          if (!data) return json({ error: "not found" }, 404);
          return json(data);
        }

        return json({ error: "api route not found" }, 404);
      }

      if (parts.length === 2 && req.method === "GET") {
        const boardSlug = parts[1];
        const literalFile = safeJoin(col.dataDir, boardSlug);
        if (literalFile && existsSync(literalFile) && (await stat(literalFile)).isFile()) {
          return serveFile(literalFile);
        }
        let data: BoardData | null;
        try {
          data = await readBoard(col, boardSlug);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return html(`<pre>${escapeHtml(msg)}</pre>`, 422);
        }
        if (!data) return new Response("Board not found", { status: 404 });
        return html(renderBoardHtml(col, data));
      }

      const relPath = parts.slice(1).join("/");
      const literalFile = safeJoin(col.dataDir, relPath);
      if (literalFile && existsSync(literalFile) && (await stat(literalFile)).isFile()) {
        return serveFile(literalFile);
      }

      return new Response("Not found", { status: 404 });
    } catch (err: unknown) {
      console.error(`[moodboard] ${req.method} ${p}:`, err);
      const msg = err instanceof Error ? err.message : String(err);
      return json({ error: msg }, 500);
    }
  },
});
