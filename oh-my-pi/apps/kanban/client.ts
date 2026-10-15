import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { Board, Card, CardPatch } from "./store.ts";
import type { ActivityEntry, BoardSummary, SearchResult } from "./src/api.ts";
import type { Actor } from "./activity.ts";

const BASE = process.env.KANBAN_URL ?? "http://localhost:5174";
const CONFIG = process.env.APP_CONFIG_PATH ?? join(".omp", "apps", "kanban.json");

export class KbError extends Error {}

export interface CallOpts {
  actor?: Actor;
  project?: string;
}

export interface Digest {
  boards: Array<{
    name: string;
    slug: string;
    columns: Array<{ name: string; count: number }>;
    review: Array<{ num: number; title: string }>;
    waiting: number;
    external: Array<{ num: number; blocked: string }>;
  }>;
  userActions: Array<{ slug: string; at: string; summary: string }>;
  unreadable: Array<{ slug: string; error: string }>;
}

let configuredProject: string | undefined;

export function setProject(project: string): void {
  configuredProject = project;
}

/** The repo root holding the kanban opt-in file at or above cwd, or undefined. */
export function findRoot(cwd = process.cwd()): string | undefined {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * The server's project id for an opted-in repo root. Waits up to timeoutMs for a newly recorded
 * opt-in to reach the server; throws when the server never lists the root.
 */
export async function projectIdFor(root: string, timeoutMs = 3000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${BASE}/_app/open?root=${encodeURIComponent(root)}`);
    const data: unknown = await res.json();
    const url = data && typeof data === "object" && "url" in data && typeof data.url === "string" ? data.url : "";
    const id = url && new URL(url).pathname.split("/").filter(Boolean)[0];
    if (id) return id;
    if (Date.now() > deadline) throw new KbError(`the kanban server does not list ${root}; run "kb up" from that repo`);
    await delay(250);
  }
}

async function project(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (configuredProject) return configuredProject;
  const root = findRoot();
  if (!root) throw new KbError(`kanban is not enabled here: no ${CONFIG} at or above ${process.cwd()}`);
  configuredProject = await projectIdFor(root);
  return configuredProject;
}

async function req<T>(method: string, path: string, body?: unknown, opts: CallOpts = {}): Promise<T> {
  const url = `${BASE}/${await project(opts.project)}/api/${path}`;
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", "x-kb-actor": opts.actor ?? "ai" },
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

const ref = (cardId: string | number): string => encodeURIComponent(String(cardId).replace(/^#/, ""));

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
  if (res.status !== 0) throw new KbError(`failed to start kanban server: ${res.stderr}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await up()) return;
    await delay(300);
  }
  throw new KbError("kanban server did not come up");
}

export function boards(opts?: CallOpts): Promise<{ boards: BoardSummary[]; unreadable: { slug: string; error: string }[] }> {
  return req("GET", "boards", undefined, opts);
}

export function board(slug: string, opts?: CallOpts): Promise<Board> {
  return req("GET", `board/${slug}`, undefined, opts);
}

export async function card(slug: string, cardId: string | number, opts?: CallOpts): Promise<Card> {
  const b = await board(slug, opts);
  const id = String(cardId).replace(/^#/, "");
  const found = b.cards[id] ?? Object.values(b.cards).find((c) => String(c.num) === id);
  if (!found) throw new KbError(`card ${cardId} not found in ${b.slug}`);
  return found;
}

export async function activity(slug: string, limit = 30, opts?: CallOpts): Promise<ActivityEntry[]> {
  return (await req<{ activity: ActivityEntry[] }>("GET", `board/${slug}/activity?limit=${limit}`, undefined, opts)).activity;
}

export async function search(q: string, opts?: CallOpts): Promise<SearchResult[]> {
  return (await req<{ results: SearchResult[] }>("GET", `search?q=${encodeURIComponent(q)}`, undefined, opts)).results;
}

export function digest(since: string, opts?: CallOpts): Promise<Digest> {
  return req("GET", `digest?since=${encodeURIComponent(since)}`, undefined, opts);
}

export async function template(name: string, opts?: CallOpts): Promise<string> {
  return (await req<{ body: string }>("GET", `template/${encodeURIComponent(name)}`, undefined, opts)).body;
}

export async function createBoard(
  name: string,
  opts: { slug?: string; accent?: string; template?: string; review?: boolean } & CallOpts = {},
): Promise<Board> {
  const { actor, project: p, ...rest } = opts;
  return (await req<{ board: Board }>("POST", "boards", { name, ...rest }, { actor, project: p })).board;
}

export async function add(
  slug: string,
  title: string,
  opts: CardPatch & { column?: string; index?: number } & CallOpts = {},
): Promise<Card> {
  const { actor, project: p, ...patch } = opts;
  return (await req<{ card: Card }>("POST", `board/${slug}/cards`, { title, ...patch }, { actor, project: p })).card;
}

export async function edit(slug: string, cardId: string | number, patch: CardPatch & CallOpts): Promise<Card> {
  const { actor, project: p, ...fields } = patch;
  return (await req<{ card: Card }>("PATCH", `board/${slug}/card/${ref(cardId)}`, fields, { actor, project: p })).card;
}

export async function move(
  slug: string,
  cardId: string | number,
  column: string,
  opts: { index?: number } & CallOpts = {},
): Promise<Card> {
  const { index, ...call } = opts;
  return (await req<{ card: Card }>("POST", `board/${slug}/card/${ref(cardId)}/move`, { column, index }, call)).card;
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
  const { restoreColumn, ...call } = opts;
  return (await req<{ card: Card }>("POST", `board/${slug}/card/${ref(cardId)}/archive`, { archived, restoreColumn }, call)).card;
}

export async function link(slug: string, cardId: string | number, blockers: Array<string | number>, opts: CallOpts = {}): Promise<Card> {
  const add = blockers.map((b) => String(b).replace(/^#/, ""));
  return (await req<{ card: Card }>("POST", `board/${slug}/card/${ref(cardId)}/blockers`, { add }, opts)).card;
}

export async function unlink(
  slug: string,
  cardId: string | number,
  blockers: Array<string | number> | "all",
  opts: CallOpts = {},
): Promise<Card> {
  const remove = blockers === "all" ? "all" : blockers.map((b) => String(b).replace(/^#/, ""));
  return (await req<{ card: Card }>("POST", `board/${slug}/card/${ref(cardId)}/blockers`, { remove }, opts)).card;
}

export async function toggleTask(slug: string, cardId: string | number, index: number, checked: boolean, opts: CallOpts = {}): Promise<Card> {
  return (await req<{ card: Card }>("POST", `board/${slug}/card/${ref(cardId)}/task`, { index, checked }, opts)).card;
}

export async function promote(slug: string, cardId: string | number, index: number, opts: CallOpts = {}): Promise<Card> {
  return (await req<{ card: Card }>("POST", `board/${slug}/card/${ref(cardId)}/promote-task`, { index }, opts)).card;
}

export async function appendBody(slug: string, cardId: string | number, text: string, opts: CallOpts = {}): Promise<Card> {
  return (await req<{ card: Card }>("POST", `board/${slug}/card/${ref(cardId)}/append`, { text }, opts)).card;
}

export async function setBrief(slug: string, text: string, opts: CallOpts = {}): Promise<Board> {
  return (await req<{ board: Board }>("PATCH", `board/${slug}`, { brief: text }, opts)).board;
}

export async function label(slug: string, id: string, name: string, color: string, opts: CallOpts = {}): Promise<Board> {
  return (await req<{ board: Board }>("PUT", `board/${slug}/label/${encodeURIComponent(id)}`, { name, color }, opts)).board;
}

/** Uploads an image (base64 `data`) and appends it to the card body in one server-side step. */
export function attach(
  slug: string,
  cardId: string | number,
  image: { name: string; type: string; data: string; alt?: string },
  opts: CallOpts = {},
): Promise<{ card: Card; url: string }> {
  return req("POST", `board/${slug}/card/${ref(cardId)}/attach`, image, opts);
}

/** Uploads an HTML mockup and appends a link to it on the card in one server-side step. */
export function mockup(
  slug: string,
  cardId: string | number,
  mock: { name: string; html: string; title?: string },
  opts: CallOpts = {},
): Promise<{ card: Card; url: string }> {
  return req("POST", `board/${slug}/card/${ref(cardId)}/mockup`, mock, opts);
}
