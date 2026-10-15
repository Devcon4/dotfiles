import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join, normalize, resolve } from "node:path";
import type * as Kit from "../../plugins/apphost/kit/kit.ts";
import {
  safeSlug,
  SIZES,
  StoreError,
  appendCardBody,
  archiveCard,
  createBoard,
  createCard,
  editBlockers,
  getCard,
  isBlocked,
  listBoards,
  moveCard,
  patchBoard,
  patchCard,
  promoteTask,
  readBoard,
  taskStats,
  toggleCardTask,
  upsertLabel,
} from "./store.ts";
import type { Board, BoardPatch, CardPatch, Column, Label, Size } from "./store.ts";
import { readActivity } from "./activity.ts";
import type { Actor } from "./activity.ts";
import { isPreviewable, linkPreview } from "./preview.ts";

const kitDir = process.env.APP_KIT ?? resolve(import.meta.dirname, "../../plugins/apphost/kit");
// The host passes the kit's location in APP_KIT; an app can live in any repo, so no static path reaches it.
const kit: typeof Kit = await import(`${kitDir}/kit.ts`);
const env = kit.appEnv();

const DIST = resolve(import.meta.dirname, "dist");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

interface Project {
  id: string;
  name: string;
  root: string;
  dataDir: string;
  configPath: string;
}

let projects: Project[] = [];

function updateProjects(entries: Kit.IndexEntry[]): void {
  const loaded: Array<{ name: string; root: string; dataDir: string; configPath: string }> = [];
  for (const entry of entries) {
    let conf: { project?: string; dataDir?: string } = {};
    try {
      if (existsSync(entry.config)) conf = JSON.parse(readFileSync(entry.config, "utf8"));
    } catch {
      console.error(`${entry.config}: not valid JSON; skipped`);
      continue;
    }
    const name = conf.project || basename(entry.root);
    const relDataDir = conf.dataDir || "docs/kanban";
    loaded.push({
      name,
      root: entry.root,
      dataDir: resolve(entry.root, relDataDir),
      configPath: entry.config,
    });
  }

  const nameCounts: Record<string, number> = {};
  for (const item of loaded) {
    nameCounts[item.name] = (nameCounts[item.name] ?? 0) + 1;
  }

  const assigned: Project[] = [];
  const usedIds: Record<string, true> = {};

  for (const item of loaded) {
    let id = item.name;
    if (nameCounts[item.name] > 1) {
      id = `${item.name}-${basename(item.root)}`;
    }
    let uniqueId = id;
    let n = 2;
    while (usedIds[uniqueId]) {
      uniqueId = `${id}-${n++}`;
    }
    usedIds[uniqueId] = true;
    assigned.push({ ...item, id: uniqueId });
  }

  projects = assigned;
}

kit.watchIndex(env.index, updateProjects);

const sseClients = new Map<string, Set<ServerResponse>>();

function broadcast(projectId: string, slug: string): void {
  const clients = sseClients.get(projectId);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify({ slug, at: Date.now() })}\n\n`;
  for (const res of clients) res.write(payload);
}

const mtimes = new Map<string, number>();

async function pollOnce(): Promise<void> {
  for (const proj of projects) {
    const boardsDir = join(proj.dataDir, "boards");
    let files: string[] = [];
    try {
      files = (await readdir(boardsDir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (const f of files) {
      const key = `${proj.id}:${f}`;
      seen.add(key);
      try {
        const s = await stat(join(boardsDir, f));
        const prev = mtimes.get(key);
        mtimes.set(key, s.mtimeMs);
        if (prev !== undefined && prev !== s.mtimeMs) {
          broadcast(proj.id, f.replace(/\.json$/, ""));
        }
      } catch {
        /* transient mid-rename */
      }
    }
    for (const key of mtimes.keys()) {
      if (key.startsWith(`${proj.id}:`) && !seen.has(key)) {
        mtimes.delete(key);
        const f = key.slice(proj.id.length + 1);
        broadcast(proj.id, f.replace(/\.json$/, ""));
      }
    }
  }
}

setInterval(pollOnce, 1500).unref();

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function actorOf(req: IncomingMessage): Actor {
  const h = req.headers["x-kb-actor"];
  return h === "user" || h === "ai" ? h : "user";
}

function boardSummary(b: Board) {
  let cardCount = 0;
  let doneCount = 0;
  let tasksTotal = 0;
  let tasksDone = 0;
  for (const c of Object.values(b.cards)) {
    if (c.archived) continue;
    cardCount++;
    if (c.completed) doneCount++;
    const st = taskStats(c.body);
    tasksTotal += st.total;
    tasksDone += st.done;
  }
  return {
    slug: b.slug,
    name: b.name,
    accent: b.accent,
    archived: b.archived,
    updatedAt: b.updatedAt,
    cardCount,
    doneCount,
    tasksTotal,
    tasksDone,
    columns: b.columns.map((col) => ({
      id: col.id,
      name: col.name,
      color: col.color,
      count: (b.order[col.id] ?? []).length,
    })),
  };
}

async function serveStatic(res: ServerResponse, fsPath: string): Promise<boolean> {
  const safe = normalize(fsPath);
  if (!safe.startsWith(DIST) || !existsSync(safe)) return false;
  const ext = safe.slice(safe.lastIndexOf("."));
  const body = await readFile(safe);
  res.writeHead(200, {
    "content-type": MIME[ext] ?? "application/octet-stream",
    "cache-control": safe.includes("/assets/") ? "public, max-age=31536000, immutable" : "no-store",
  });
  res.end(body);
  return true;
}

async function serveShell(res: ServerResponse): Promise<void> {
  const shell = join(DIST, "index.html");
  if (!existsSync(shell)) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("client bundle missing — run build first");
    return;
  }
  await serveStatic(res, shell);
}

async function countBoards(dataDir: string): Promise<number> {
  try {
    const dir = join(dataDir, "boards");
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

const APP_TEMPLATES = resolve(import.meta.dirname, "templates");

function fileHint(name: string, max: number, fallback: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max) || fallback
  );
}

interface ImageUpload {
  name?: string;
  type?: string;
  data?: string;
}

async function saveImage(proj: Project, slug: string, upload: ImageUpload): Promise<string> {
  const ext = IMAGE_TYPES[String(upload.type ?? "").toLowerCase()];
  if (!ext) throw new StoreError(`unsupported image type ${String(upload.type)}`, 415);
  const bytes = Buffer.from(String(upload.data ?? ""), "base64");
  if (bytes.length === 0) throw new StoreError("empty image", 400);
  if (bytes.length > MAX_IMAGE_BYTES) throw new StoreError("image too large (10MB cap)", 413);
  const file = `${fileHint(String(upload.name ?? ""), 40, "shot")}-${Date.now().toString(36)}${ext}`;
  const dir = join(proj.dataDir, "images", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), bytes);
  return `/${proj.id}/images/${slug}/${file}`;
}

async function saveMockup(proj: Project, slug: string, name: string, html: string): Promise<string> {
  if (!html.trim()) throw new StoreError("empty mockup", 400);
  const file = `${fileHint(name, 48, "mockup")}.html`;
  const dir = join(proj.dataDir, "mockups", slug);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), html);
  return `/${proj.id}/mockups/${slug}/${file}`;
}

async function readTemplate(proj: Project, name: string): Promise<string> {
  const base = name.replace(/\.md$/, "");
  if (!/^[a-z0-9-]+$/.test(base)) throw new StoreError(`invalid template name ${name}`, 400);
  for (const dir of [join(proj.dataDir, "templates"), APP_TEMPLATES]) {
    const path = join(dir, `${base}.md`);
    if (existsSync(path)) return await readFile(path, "utf8");
  }
  throw new StoreError(`template "${base}" not found in ${join(proj.dataDir, "templates")} or ${APP_TEMPLATES}`, 404);
}

async function digest(proj: Project, since: string) {
  const listing = await listBoards(proj.dataDir);
  const boards = listing.boards
    .filter((b) => !b.archived)
    .map((b) => {
      const reviewCols = b.columns.filter((c) => c.id.toLowerCase().includes("review") || c.name.toLowerCase().includes("review"));
      const review = reviewCols
        .flatMap((col) => b.order[col.id] ?? [])
        .map((id) => b.cards[id])
        .filter((c) => c && !c.completed && !c.archived)
        .map((c) => ({ num: c.num, title: c.title }));
      const blocked = Object.values(b.cards).filter((c) => !c.completed && !c.archived && isBlocked(b, c));
      return {
        name: b.name,
        slug: b.slug,
        columns: b.columns.map((col) => ({ name: col.name, count: (b.order[col.id] ?? []).length })),
        review,
        waiting: blocked.filter((c) => !c.blocked).length,
        external: blocked.filter((c) => c.blocked).map((c) => ({ num: c.num, blocked: c.blocked as string })),
      };
    });
  const userActions: Array<{ slug: string; at: string; summary: string }> = [];
  for (const b of listing.boards) {
    for (const a of await readActivity(proj.dataDir, b.slug, 30)) {
      if (a.actor === "user" && (!since || a.at > since)) userActions.push({ slug: b.slug, at: a.at, summary: a.summary });
    }
  }
  userActions.sort((a, b) => a.at.localeCompare(b.at));
  return { boards, userActions: userActions.slice(-5), unreadable: listing.unreadable };
}

async function handleProjectApi(
  proj: Project,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  apiSubpath: string,
): Promise<void> {
  const method = req.method ?? "GET";
  const parts = apiSubpath.split("/").filter(Boolean); // ["boards", ...]

  if (parts[0] === "events" && method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    let set = sseClients.get(proj.id);
    if (!set) {
      set = new Set();
      sseClients.set(proj.id, set);
    }
    set.add(res);
    req.on("close", () => {
      const currentSet = sseClients.get(proj.id);
      if (currentSet) {
        currentSet.delete(res);
        if (currentSet.size === 0) sseClients.delete(proj.id);
      }
    });
    return;
  }

  if (parts[0] === "health" && method === "GET") {
    return json(res, { ok: true, project: proj.id });
  }

  if (parts[0] === "search" && method === "GET") {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (!q) return json(res, { results: [] });
    const listing = await listBoards(proj.dataDir);
    const results: Array<{
      board: string;
      slug: string;
      accent: string;
      id: string;
      num: number;
      title: string;
      column: string;
      completed: boolean;
      blocked: boolean;
      snippet: string;
    }> = [];
    for (const b of listing.boards) {
      const colMap = new Map(b.columns.map((c) => [c.id, c.name]));
      const colOfCard = new Map<string, string>();
      for (const [colId, ids] of Object.entries(b.order)) {
        for (const id of ids) colOfCard.set(id, colMap.get(colId) ?? colId);
      }
      for (const c of Object.values(b.cards)) {
        if (c.archived) continue;
        const inTitle = c.title.toLowerCase().includes(q);
        const inBody = c.body.toLowerCase().includes(q);
        const inNum = `#${c.num}` === q || `${c.num}` === q;
        if (!inTitle && !inBody && !inNum) continue;
        let snippet = "";
        if (inBody) {
          const idx = c.body.toLowerCase().indexOf(q);
          const start = Math.max(0, idx - 40);
          const end = Math.min(c.body.length, idx + q.length + 40);
          snippet = c.body.slice(start, end).replace(/\s+/g, " ").trim();
        }
        results.push({
          board: b.name,
          slug: b.slug,
          accent: b.accent,
          id: c.id,
          num: c.num,
          title: c.title,
          column: colOfCard.get(c.id) ?? "",
          completed: c.completed,
          blocked: isBlocked(b, c),
          snippet,
        });
      }
    }
    return json(res, { results });
  }

  if (parts[0] === "boards" && method === "GET") {
    const listing = await listBoards(proj.dataDir);
    const summaries = listing.boards.map(boardSummary);
    return json(res, { boards: summaries, unreadable: listing.unreadable });
  }

  if (parts[0] === "boards" && method === "POST") {
    const body = (await readJson(req)) as Record<string, unknown>;
    const actor = actorOf(req);
    const board = await createBoard(
      proj.dataDir,
      {
        name: String(body.name ?? ""),
        slug: body.slug ? String(body.slug) : undefined,
        accent: body.accent ? String(body.accent) : undefined,
        template: body.template ? String(body.template) : undefined,
        review: body.review === true,
      },
      actor,
    );
    broadcast(proj.id, board.slug);
    return json(res, { board }, 201);
  }

  if (parts[0] === "board" && parts.length === 2 && method === "GET") {
    const slug = safeSlug(parts[1]);
    const board = await readBoard(proj.dataDir, slug);
    return json(res, board);
  }

  if (parts[0] === "board" && parts.length === 2 && method === "PATCH") {
    const slug = safeSlug(parts[1]);
    const body = (await readJson(req)) as BoardPatch;
    const actor = actorOf(req);
    const board = await patchBoard(proj.dataDir, slug, body, actor);
    broadcast(proj.id, slug);
    return json(res, { board });
  }

  if (parts[0] === "board" && parts[2] === "cards" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const body = (await readJson(req)) as CardPatch & { title: string; column?: string; index?: number };
    const actor = actorOf(req);
    const { card } = await createCard(proj.dataDir, slug, body, actor);
    broadcast(proj.id, slug);
    return json(res, { card }, 201);
  }

  if (parts[0] === "board" && parts[2] === "card" && parts.length === 4 && method === "PATCH") {
    const slug = safeSlug(parts[1]);
    const cardId = parts[3];
    const body = (await readJson(req)) as CardPatch;
    const actor = actorOf(req);
    const { card } = await patchCard(proj.dataDir, slug, cardId, body, actor);
    broadcast(proj.id, slug);
    return json(res, { card });
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "move" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const cardId = parts[3];
    const body = (await readJson(req)) as { column: string; index?: number };
    const actor = actorOf(req);
    const { card } = await moveCard(proj.dataDir, slug, cardId, body.column, body.index, actor);
    broadcast(proj.id, slug);
    return json(res, { card });
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "archive" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const cardId = parts[3];
    const body = (await readJson(req)) as { archived: boolean; restoreColumn?: string };
    const actor = actorOf(req);
    const { card } = await archiveCard(proj.dataDir, slug, cardId, body.archived, body.restoreColumn, actor);
    broadcast(proj.id, slug);
    return json(res, { card });
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "task" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const cardId = parts[3];
    const body = (await readJson(req)) as { index: number; checked: boolean };
    const actor = actorOf(req);
    const { card } = await toggleCardTask(proj.dataDir, slug, cardId, body.index, body.checked, actor);
    broadcast(proj.id, slug);
    return json(res, { card });
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "promote-task" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const cardId = parts[3];
    const body = (await readJson(req)) as { index: number };
    const actor = actorOf(req);
    const { card } = await promoteTask(proj.dataDir, slug, cardId, body.index, actor);
    broadcast(proj.id, slug);
    return json(res, { card }, 201);
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "blockers" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const body = (await readJson(req)) as { add?: string[]; remove?: string[] | "all" };
    const { card } = await editBlockers(proj.dataDir, slug, parts[3], body, actorOf(req));
    broadcast(proj.id, slug);
    return json(res, { card });
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "append" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const body = (await readJson(req)) as { text?: string };
    const text = String(body.text ?? "").trim();
    if (!text) throw new StoreError("text required");
    const { card } = await appendCardBody(proj.dataDir, slug, parts[3], text, actorOf(req));
    broadcast(proj.id, slug);
    return json(res, { card });
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "attach" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const body = (await readJson(req)) as ImageUpload & { alt?: string };
    getCard(await readBoard(proj.dataDir, slug), parts[3]);
    const url = await saveImage(proj, slug, body);
    const { card } = await appendCardBody(proj.dataDir, slug, parts[3], `![${body.alt ?? ""}](${url})`, actorOf(req));
    broadcast(proj.id, slug);
    return json(res, { card, url }, 201);
  }

  if (parts[0] === "board" && parts[2] === "card" && parts[4] === "mockup" && method === "POST") {
    const slug = safeSlug(parts[1]);
    const body = (await readJson(req)) as { name?: string; html?: string; title?: string };
    getCard(await readBoard(proj.dataDir, slug), parts[3]);
    const url = await saveMockup(proj, slug, String(body.name ?? ""), String(body.html ?? ""));
    const title = body.title ?? url.slice(url.lastIndexOf("/") + 1, -".html".length);
    const { card } = await appendCardBody(proj.dataDir, slug, parts[3], `[${title}](${url})`, actorOf(req));
    broadcast(proj.id, slug);
    return json(res, { card, url }, 201);
  }

  if (parts[0] === "board" && parts[2] === "label" && parts.length === 4 && method === "PUT") {
    const slug = safeSlug(parts[1]);
    const body = (await readJson(req)) as { name?: string; color?: string };
    const board = await upsertLabel(
      proj.dataDir,
      slug,
      { id: decodeURIComponent(parts[3]), name: String(body.name ?? ""), color: String(body.color ?? "") },
      actorOf(req),
    );
    broadcast(proj.id, slug);
    return json(res, { board });
  }

  if (parts[0] === "template" && parts.length === 2 && method === "GET") {
    return json(res, { body: await readTemplate(proj, decodeURIComponent(parts[1])) });
  }

  if (parts[0] === "digest" && method === "GET") {
    return json(res, await digest(proj, url.searchParams.get("since") ?? ""));
  }

  if (parts[0] === "board" && parts[2] === "activity" && method === "GET") {
    const slug = safeSlug(parts[1]);
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 30)));
    const activity = await readActivity(proj.dataDir, slug, limit);
    return json(res, { activity });
  }

  if (parts[0] === "images" && method === "POST") {
    const body = (await readJson(req)) as ImageUpload & { board?: string };
    const url = await saveImage(proj, safeSlug(String(body.board ?? "")), body);
    return json(res, { ok: true, url }, 201);
  }

  json(res, { error: "not found" }, 404);
}

const server = createServer(async (req, res) => {
  const denied = kit.checkRequest(req.method ?? "GET", (name) => req.headers[name.toLowerCase()] as string | undefined);
  if (denied) return json(res, { error: denied.error }, denied.status);

  const url = new URL(req.url ?? "/", `http://localhost:${env.port}`);
  const method = req.method ?? "GET";

  try {
    if (url.pathname === "/_app/health" && method === "GET") {
      return json(res, kit.healthPayload(env.name));
    }

    if (url.pathname === "/_app/open" && method === "GET") {
      const rootParam = url.searchParams.get("root");
      const normalizedRoot = rootParam ? resolve(rootParam) : "";
      const match = projects.find((p) => resolve(p.root) === normalizedRoot);
      return json(res, { url: `http://localhost:${env.port}/${match ? `${match.id}/` : ""}` });
    }

    if (url.pathname === "/api/projects" && method === "GET") {
      const list = await Promise.all(
        projects.map(async (p) => ({
          id: p.id,
          name: p.name,
          root: p.root,
          boardCount: await countBoards(p.dataDir),
        })),
      );
      return json(res, { projects: list });
    }

    if (url.pathname === "/api/preview" && method === "GET") {
      const target = url.searchParams.get("url") ?? "";
      if (!isPreviewable(target)) return json(res, { error: "previews are limited to http(s) links on localhost" }, 400);
      return json(res, { preview: await linkPreview(target) });
    }

    if (url.pathname.startsWith("/assets/")) {
      const fsPath = join(DIST, url.pathname);
      if (await serveStatic(res, fsPath)) return;
      return json(res, { error: "asset not found" }, 404);
    }

    if (url.pathname === "/") {
      return await serveShell(res);
    }

    // Match /<project-id>/...
    const segs = url.pathname.split("/").filter(Boolean);
    const proj = projects.find((p) => p.id === segs[0]);

    if (proj) {
      const subpath = "/" + segs.slice(1).join("/");

      if (subpath.startsWith("/api/")) {
        return await handleProjectApi(proj, req, res, url, subpath.slice("/api/".length));
      }

      if (subpath.startsWith("/images/")) {
        const imagesDir = join(proj.dataDir, "images");
        const rel = subpath.slice("/images/".length);
        const fsPath = normalize(join(imagesDir, rel));
        if (!fsPath.startsWith(imagesDir) || !existsSync(fsPath)) return json(res, { error: "not found" }, 404);
        const ext = fsPath.slice(fsPath.lastIndexOf("."));
        const body = await readFile(fsPath);
        res.writeHead(200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
        });
        res.end(body);
        return;
      }

      if (subpath.startsWith("/mockups/")) {
        const mockupsDir = join(proj.dataDir, "mockups");
        const rel = subpath.slice("/mockups/".length);
        const fsPath = normalize(join(mockupsDir, rel));
        if (!fsPath.startsWith(mockupsDir) || !existsSync(fsPath)) return json(res, { error: "not found" }, 404);
        const ext = fsPath.slice(fsPath.lastIndexOf("."));
        const body = await readFile(fsPath);
        res.writeHead(200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(body);
        return;
      }

      return await serveShell(res);
    }

    // Legacy fallback for mockups/images without project prefix
    if (url.pathname.startsWith("/mockups/") || url.pathname.startsWith("/images/")) {
      const isMockup = url.pathname.startsWith("/mockups/");
      const prefix = isMockup ? "/mockups/" : "/images/";
      const rel = url.pathname.slice(prefix.length);
      for (const p of projects) {
        const baseDir = join(p.dataDir, isMockup ? "mockups" : "images");
        const fsPath = normalize(join(baseDir, rel));
        if (fsPath.startsWith(baseDir) && existsSync(fsPath)) {
          const ext = fsPath.slice(fsPath.lastIndexOf("."));
          const body = await readFile(fsPath);
          res.writeHead(200, {
            "content-type": MIME[ext] ?? "application/octet-stream",
            "cache-control": isMockup ? "no-store" : "public, max-age=31536000, immutable",
          });
          res.end(body);
          return;
        }
      }
    }

    // Single page app catch-all
    if (segs.length <= 2) {
      return await serveShell(res);
    }

    json(res, { error: "not found" }, 404);
  } catch (e) {
    const status = e instanceof StoreError ? e.status : 500;
    const message = (e as Error).message ?? "internal error";
    if (status >= 500) console.error("kanban server error:", e);
    json(res, { error: message }, status);
  }
});

// All interfaces: WSL's localhost forwarding to a 127.0.0.1 socket can wedge after a restart.
server.listen(env.port, "0.0.0.0", () => {
  console.log(`${env.name} on http://localhost:${env.port}/`);
});
