import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Board, Card, CardPatch } from "./store.ts";
import type { ActivityEntry, BoardSummary, SearchResult } from "./src/api.ts";
import type { Actor } from "./activity.ts";

const BASE = process.env.KANBAN_URL ?? "http://localhost:5174";

export class KbError extends Error {}

export interface CallOpts {
  actor?: Actor;
  project?: string;
}

let configuredProject: string | undefined;

export function setProject(project: string): void {
  configuredProject = project;
}

export function findProject(cwd = process.cwd()): string {
  if (configuredProject) return configuredProject;
  if (process.env.KANBAN_PROJECT) return process.env.KANBAN_PROJECT;
  let dir = cwd;
  while (true) {
    const configPath = join(dir, ".omp", "apps", "kanban.json");
    if (existsSync(configPath)) {
      try {
        const conf = JSON.parse(readFileSync(configPath, "utf8")) as { project?: string };
        if (conf.project) return conf.project;
        return basename(dir);
      } catch {
        return basename(dir);
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "varia";
}

async function req<T>(method: string, path: string, body?: unknown, actor: Actor = "ai", project?: string): Promise<T> {
  const proj = project ?? findProject();
  const url = `${BASE}/${proj}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-kb-actor": actor },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `${res.status} ${res.statusText}`;
    throw new KbError(message);
  }
  return data as T;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function up(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/_app/health`);
    if (!res.ok) return false;
    const data = (await res.json()) as { app?: string };
    return data.app === "kanban";
  } catch {
    return false;
  }
}

export async function ensureUp(timeoutMs = 30_000): Promise<void> {
  if (await up()) return;
  const res = spawnSync("kb", ["up"], { stdio: "pipe", encoding: "utf8" });
  if (res.status !== 0) {
    const fallback = spawnSync("node", [join(import.meta.dirname, "kb.ts"), "up"], { stdio: "pipe", encoding: "utf8" });
    if (fallback.status !== 0) {
      throw new KbError(`failed to start kanban server: ${res.stderr || fallback.stderr}`);
    }
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await up()) return;
    await delay(300);
  }
  throw new KbError("kanban server did not come up");
}

export function boards(opts?: CallOpts): Promise<{ boards: BoardSummary[]; unreadable: { slug: string; error: string }[] }> {
  return req("GET", "/api/boards", undefined, opts?.actor, opts?.project);
}

export function board(slug: string, opts?: CallOpts): Promise<Board> {
  return req("GET", `/api/board/${slug}`, undefined, opts?.actor, opts?.project);
}

export async function card(slug: string, cardId: string | number, opts?: CallOpts): Promise<Card> {
  const b = await board(slug, opts);
  return b.cards[resolveId(b, cardId)];
}

export async function activity(slug: string, limit = 30, opts?: CallOpts): Promise<ActivityEntry[]> {
  const r = await req<{ activity: ActivityEntry[] }>("GET", `/api/board/${slug}/activity?limit=${limit}`, undefined, opts?.actor, opts?.project);
  return r.activity;
}

export async function search(q: string, opts?: CallOpts): Promise<SearchResult[]> {
  const r = await req<{ results: SearchResult[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`, undefined, opts?.actor, opts?.project);
  return r.results;
}

function resolveId(b: Board, cardId: string | number): string {
  const cid = String(cardId).replace(/^#/, "");
  if (b.cards[cid]) return cid;
  const byNum = Object.values(b.cards).find((c) => String(c.num) === cid);
  if (byNum) return byNum.id;
  throw new KbError(`card ${cardId} not found in ${b.slug}`);
}

export async function createBoard(
  name: string,
  opts: { slug?: string; accent?: string; template?: string } & CallOpts = {},
): Promise<Board> {
  const { actor, project, ...rest } = opts;
  const r = await req<{ board: Board }>("POST", "/api/boards", { name, ...rest }, actor, project);
  return r.board;
}

export async function add(
  slug: string,
  title: string,
  opts: CardPatch & { column?: string; index?: number } & CallOpts = {},
): Promise<Card> {
  const { actor, project, ...patch } = opts;
  const r = await req<{ card: Card }>("POST", `/api/board/${slug}/cards`, { title, ...patch }, actor, project);
  return r.card;
}

export async function edit(
  slug: string,
  cardId: string | number,
  patch: CardPatch & CallOpts,
): Promise<Card> {
  const { actor, project, ...fields } = patch;
  const b = await board(slug, { project });
  const cid = resolveId(b, cardId);
  const r = await req<{ card: Card }>("PATCH", `/api/board/${slug}/card/${cid}`, fields, actor, project);
  return r.card;
}

export async function move(
  slug: string,
  cardId: string | number,
  column: string,
  opts: { index?: number } & CallOpts = {},
): Promise<Card> {
  const { actor, project, index } = opts;
  const b = await board(slug, { project });
  const cid = resolveId(b, cardId);
  const r = await req<{ card: Card }>(
    "POST",
    `/api/board/${slug}/card/${cid}/move`,
    { column, index },
    actor,
    project,
  );
  return r.card;
}

export function complete(slug: string, cardId: string | number, done = true, opts: CallOpts = {}): Promise<Card> {
  return edit(slug, cardId, { completed: done, ...opts });
}

export async function archiveCard(
  slug: string,
  cardId: string | number,
  archived = true,
  opts: { restoreColumn?: string } & CallOpts = {},
): Promise<Card> {
  const { actor, project, restoreColumn } = opts;
  const b = await board(slug, { project });
  const cid = resolveId(b, cardId);
  const r = await req<{ card: Card }>(
    "POST",
    `/api/board/${slug}/card/${cid}/archive`,
    { archived, restoreColumn },
    actor,
    project,
  );
  return r.card;
}

export async function link(
  slug: string,
  cardId: string | number,
  blockers: Array<string | number>,
  opts: CallOpts = {},
): Promise<Card> {
  const b = await board(slug, opts);
  const target = b.cards[resolveId(b, cardId)];
  const blockerIds = blockers.map((ref) => resolveId(b, ref));
  const merged = [...new Set([...target.blockedBy, ...blockerIds])];
  return edit(slug, target.id, { blockedBy: merged, ...opts });
}

export async function toggleTask(
  slug: string,
  cardId: string | number,
  index: number,
  checked: boolean,
  opts: CallOpts = {},
): Promise<Card> {
  const b = await board(slug, opts);
  const cid = resolveId(b, cardId);
  const r = await req<{ card: Card }>(
    "POST",
    `/api/board/${slug}/card/${cid}/task`,
    { index, checked },
    opts.actor,
    opts.project,
  );
  return r.card;
}

export async function promote(
  slug: string,
  cardId: string | number,
  index: number,
  opts: CallOpts = {},
): Promise<Card> {
  const b = await board(slug, opts);
  const cid = resolveId(b, cardId);
  const r = await req<{ card: Card }>(
    "POST",
    `/api/board/${slug}/card/${cid}/promote-task`,
    { index },
    opts.actor,
    opts.project,
  );
  return r.card;
}

export async function setBrief(slug: string, text: string, opts: CallOpts = {}): Promise<void> {
  await req("PATCH", `/api/board/${slug}`, { brief: text }, opts.actor, opts.project);
}

export async function mockup(
  slug: string,
  cardId: string | number,
  name: string,
  opts: { title?: string } & CallOpts = {},
): Promise<string> {
  const proj = opts.project ?? findProject();
  const title = opts.title ?? name;
  const url = `/${proj}/mockups/${slug}/${name}.html`;
  const md = `[${title}](${url})`;
  const c = await card(slug, cardId, opts);
  const body = c.body.trim() ? `${c.body.replace(/\s+$/, "")}\n\n${md}\n` : `${md}\n`;
  await edit(slug, cardId, { body, ...opts });
  return url;
}
