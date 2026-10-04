import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { rewriteTaskLine, taskLineText, taskStats, toggleTaskMarker } from "./tasks.ts";
import { appendActivity } from "./activity.ts";
import type { Actor } from "./activity.ts";

export const SIZES = ["XS", "S", "M", "L", "XL"] as const;
export type Size = (typeof SIZES)[number];
export type Assignee = "ai" | "user";

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Column {
  id: string;
  name: string;
  color: string;
  wip: number;
  done: boolean;
}

export interface Card {
  id: string;
  num: number;
  title: string;
  body: string;
  labels: string[];
  size: Size | null;
  assignee: Assignee | null;
  color: string | null;
  blocked: string | null;
  blockedBy: string[];
  completed: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Board {
  name: string;
  slug: string;
  accent: string;
  archived: boolean;
  brief: string;
  nextCardId: number;
  labels: Label[];
  columns: Column[];
  order: Record<string, string[]>;
  cards: Record<string, Card>;
  createdAt: string;
  updatedAt: string;
}

export class StoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function safeSlug(s: string): string {
  const slug = String(s ?? "").replace(/[^a-z0-9-]/g, "");
  if (!slug) throw new StoreError("invalid slug", 400);
  return slug;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function checkColor(c: unknown, field: string): string {
  if (typeof c !== "string" || !HEX_RE.test(c))
    throw new StoreError(`${field}: expected #rrggbb, got ${JSON.stringify(c)}`);
  return c;
}

function boardPath(dataRoot: string, slug: string): string {
  return join(dataRoot, "boards", `${safeSlug(slug)}.json`);
}

let tmpSeq = 0;

async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${++tmpSeq}`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n");
  await rename(tmp, path);
}

const boardLocks = new Map<string, Promise<unknown>>();

function withBoardLock<T>(dataRoot: string, slug: string, op: () => Promise<T>): Promise<T> {
  const key = `${resolve(dataRoot)}:${slug}`;
  const prev = boardLocks.get(key) ?? Promise.resolve();
  const next = prev.then(op, op);
  boardLocks.set(key, next.catch(() => undefined));
  return next;
}

export function validateBoard(data: unknown): Board {
  const b = data as Board;
  if (!b || typeof b !== "object") throw new StoreError("board: not an object");
  if (typeof b.name !== "string" || !b.name.trim()) throw new StoreError("board.name required");
  if (typeof b.slug !== "string") throw new StoreError("board.slug required");
  checkColor(b.accent, "board.accent");
  if (typeof b.nextCardId !== "number") throw new StoreError("board.nextCardId required");
  if (typeof b.brief !== "string") b.brief = "";
  if (!Array.isArray(b.labels)) throw new StoreError("board.labels must be an array");
  for (const l of b.labels) {
    if (!l.id || typeof l.name !== "string") throw new StoreError(`label ${JSON.stringify(l)} malformed`);
    checkColor(l.color, `label ${l.id}.color`);
  }
  if (!Array.isArray(b.columns) || b.columns.length === 0)
    throw new StoreError("board.columns must be a non-empty array");
  const colIds = new Set<string>();
  for (const c of b.columns) {
    if (!c.id || typeof c.name !== "string") throw new StoreError(`column ${JSON.stringify(c)} malformed`);
    if (colIds.has(c.id)) throw new StoreError(`duplicate column id ${c.id}`);
    colIds.add(c.id);
    checkColor(c.color, `column ${c.id}.color`);
    if (typeof c.wip !== "number" || c.wip < 0) throw new StoreError(`column ${c.id}.wip must be >= 0`);
    if (typeof c.done !== "boolean") throw new StoreError(`column ${c.id}.done must be boolean`);
  }
  if (!b.order || typeof b.order !== "object") throw new StoreError("board.order required");
  if (!b.cards || typeof b.cards !== "object") throw new StoreError("board.cards required");

  const seen = new Set<string>();
  for (const colId of Object.keys(b.order)) {
    if (!colIds.has(colId)) throw new StoreError(`order has unknown column ${colId}`);
    for (const cardId of b.order[colId]) {
      if (!b.cards[cardId]) throw new StoreError(`order.${colId} references missing card ${cardId}`);
      if (seen.has(cardId)) throw new StoreError(`card ${cardId} appears in order twice`);
      seen.add(cardId);
    }
  }
  for (const colId of colIds) if (!b.order[colId]) b.order[colId] = [];

  const labelIds = new Set(b.labels.map((l) => l.id));
  for (const [id, card] of Object.entries(b.cards)) {
    if (card.id !== id) throw new StoreError(`card key ${id} != card.id ${card.id}`);
    if (typeof card.title !== "string") throw new StoreError(`card ${id}.title required`);
    if (typeof card.body !== "string") throw new StoreError(`card ${id}.body must be a string`);
    if (card.size !== null && !SIZES.includes(card.size)) throw new StoreError(`card ${id}.size invalid`);
    if (card.assignee !== null && card.assignee !== "ai" && card.assignee !== "user")
      throw new StoreError(`card ${id}.assignee invalid`);
    if (card.color !== null) checkColor(card.color, `card ${id}.color`);
    for (const l of card.labels) if (!labelIds.has(l)) throw new StoreError(`card ${id} has unknown label ${l}`);
    if (!Array.isArray(card.blockedBy)) card.blockedBy = [];
    card.blockedBy = card.blockedBy.filter((ref) => typeof ref === "string" && !!b.cards[ref] && ref !== id);
    if (!card.archived && !seen.has(id))
      throw new StoreError(`card ${id} is active but missing from order`);
  }
  return b;
}

export interface BoardListing {
  boards: Board[];
  unreadable: { slug: string; error: string }[];
}

export async function listBoards(dataRoot: string): Promise<BoardListing> {
  const dir = join(dataRoot, "boards");
  await mkdir(dir, { recursive: true });
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const listing: BoardListing = { boards: [], unreadable: [] };
  for (const f of files.sort()) {
    const slug = f.replace(/\.json$/, "");
    try {
      listing.boards.push(await readBoard(dataRoot, slug));
    } catch (e) {
      listing.unreadable.push({ slug, error: (e as Error).message });
    }
  }
  return listing;
}

export async function readBoard(dataRoot: string, slug: string): Promise<Board> {
  const path = boardPath(dataRoot, slug);
  if (!existsSync(path)) throw new StoreError(`board ${slug} not found`, 404);
  const raw = await readFile(path, "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new StoreError(`board ${slug}: invalid JSON (${(e as Error).message})`, 500);
  }
  return validateBoard(data);
}

export async function writeBoard(dataRoot: string, board: Board): Promise<Board> {
  board.updatedAt = new Date().toISOString();
  validateBoard(board);
  const dir = join(dataRoot, "boards");
  await mkdir(dir, { recursive: true });
  await writeJsonAtomic(boardPath(dataRoot, board.slug), board);
  return board;
}

const DEFAULT_COLUMNS: Column[] = [
  { id: "backlog", name: "Backlog", color: "#8b949e", wip: 0, done: false },
  { id: "todo", name: "Todo", color: "#539bf5", wip: 0, done: false },
  { id: "doing", name: "In Progress", color: "#e8a13a", wip: 0, done: false },
  { id: "done", name: "Done", color: "#57ab5a", wip: 0, done: true },
];

export const TEMPLATES: Record<string, { columns: Column[]; labels: Label[] }> = {
  simple: {
    columns: DEFAULT_COLUMNS,
    labels: [],
  },
  "asset-production": {
    columns: [
      { id: "backlog", name: "Backlog", color: "#8b949e", wip: 0, done: false },
      { id: "ready", name: "Ready", color: "#539bf5", wip: 0, done: false },
      { id: "doing", name: "In Progress", color: "#e8a13a", wip: 2, done: false },
      { id: "review", name: "In Game", color: "#bf91f3", wip: 0, done: false },
      { id: "done", name: "Done", color: "#57ab5a", wip: 0, done: true },
    ],
    labels: [
      { id: "art", name: "art", color: "#e5534b" },
      { id: "2d", name: "2D", color: "#39c5cf" },
      { id: "audio", name: "audio", color: "#d4a72c" },
      { id: "engineering", name: "engineering", color: "#8b949e" },
      { id: "vfx", name: "vfx", color: "#986ee2" },
      { id: "blocked-external", name: "waiting", color: "#ec6cb9" },
    ],
  },
};

export async function createBoard(
  dataRoot: string,
  opts: {
    name: string;
    slug?: string;
    accent?: string;
    columns?: Column[];
    template?: string;
    review?: boolean;
  },
  actor: Actor = "ai",
): Promise<Board> {
  const name = String(opts.name ?? "").trim();
  if (!name) throw new StoreError("board name required");
  const slug = safeSlug(opts.slug ? slugify(opts.slug) : slugify(name));
  if (existsSync(boardPath(dataRoot, slug))) throw new StoreError(`board ${slug} already exists`, 409);
  const template = opts.template ? TEMPLATES[opts.template] : undefined;
  if (opts.template && !template)
    throw new StoreError(`unknown template ${opts.template} (have: ${Object.keys(TEMPLATES).join(", ")})`);

  let columns = opts.columns?.length ? opts.columns : structuredClone(template?.columns ?? DEFAULT_COLUMNS);
  if (opts.review && !columns.some((c) => c.id === "review")) {
    const doneIdx = columns.findIndex((c) => c.done);
    const reviewCol: Column = { id: "review", name: "Review", color: "#a371f7", wip: 0, done: false };
    if (doneIdx >= 0) columns.splice(doneIdx, 0, reviewCol);
    else columns.push(reviewCol);
  }

  const nowStr = new Date().toISOString();
  const board: Board = {
    name,
    slug,
    accent: opts.accent ?? "#e8a13a",
    archived: false,
    brief: "",
    nextCardId: 1,
    labels: structuredClone(template?.labels ?? []),
    columns,
    order: {},
    cards: {},
    createdAt: nowStr,
    updatedAt: nowStr,
  };
  for (const c of board.columns) board.order[c.id] = [];
  const written = await writeBoard(dataRoot, board);
  await appendActivity(dataRoot, slug, { at: nowStr, actor, verb: "board-create", summary: `created board "${name}"` });
  return written;
}

export interface BoardPatch {
  name?: string;
  accent?: string;
  archived?: boolean;
  brief?: string;
  labels?: Label[];
  columns?: Column[];
}

export function patchBoard(dataRoot: string, slug: string, patch: BoardPatch, actor: Actor = "ai"): Promise<Board> {
  return withBoardLock(dataRoot, slug, async () => {
    const board = await readBoard(dataRoot, slug);
    if (patch.brief !== undefined) board.brief = String(patch.brief);
    if (patch.name !== undefined) board.name = String(patch.name).trim() || board.name;
    if (patch.accent !== undefined) board.accent = checkColor(patch.accent, "accent");
    if (patch.archived !== undefined) board.archived = !!patch.archived;
    if (patch.labels !== undefined) {
      board.labels = patch.labels;
      const ids = new Set(board.labels.map((l) => l.id));
      for (const card of Object.values(board.cards)) card.labels = card.labels.filter((l) => ids.has(l));
    }
    if (patch.columns !== undefined) {
      const newIds = new Set(patch.columns.map((c) => c.id));
      for (const col of board.columns) {
        if (!newIds.has(col.id) && (board.order[col.id]?.length ?? 0) > 0)
          throw new StoreError(`column ${col.id} still has cards; move them first`, 409);
      }
      board.columns = patch.columns;
      const order: Record<string, string[]> = {};
      for (const c of patch.columns) order[c.id] = board.order[c.id] ?? [];
      board.order = order;
      syncDoneColumns(board);
    }
    const written = await writeBoard(dataRoot, board);
    await appendActivity(dataRoot, slug, {
      at: new Date().toISOString(),
      actor,
      verb: "board-edit",
      summary: patch.archived === true ? "archived the board" : "edited board settings",
    });
    return written;
  });
}

function getCard(board: Board, cardId: string): Card {
  const card = board.cards[cardId] ?? Object.values(board.cards).find((c) => `${c.num}` === cardId);
  if (!card) throw new StoreError(`card ${cardId} not found in ${board.slug}`, 404);
  return card;
}

function columnOf(board: Board, cardId: string): string | null {
  for (const [colId, ids] of Object.entries(board.order)) if (ids.includes(cardId)) return colId;
  return null;
}

function setCompleted(card: Card, completed: boolean): void {
  if (card.completed === completed) return;
  card.completed = completed;
  card.completedAt = completed ? new Date().toISOString() : null;
}

function syncDoneColumns(board: Board): void {
  for (const col of board.columns) {
    if (!col.done) continue;
    for (const id of board.order[col.id]) setCompleted(board.cards[id], true);
  }
}

export function isBlocked(board: Board, card: Card): boolean {
  if (card.blocked) return true;
  return card.blockedBy.some((id) => {
    const blocker = board.cards[id];
    return !!blocker && !blocker.completed && !blocker.archived;
  });
}

export interface CardPatch {
  title?: string;
  body?: string;
  labels?: string[];
  size?: Size | null;
  assignee?: Assignee | null;
  color?: string | null;
  blocked?: string | null;
  blockedBy?: string[];
  completed?: boolean;
}

export function createCard(
  dataRoot: string,
  slug: string,
  opts: CardPatch & { title: string; column?: string; index?: number },
  actor: Actor = "ai",
): Promise<{ board: Board; card: Card }> {
  return withBoardLock(dataRoot, slug, async () => {
    const board = await readBoard(dataRoot, slug);
    const colId = opts.column ?? board.columns[0].id;
    const col = board.columns.find((c) => c.id === colId);
    if (!col) throw new StoreError(`column ${colId} not found`, 404);
    const title = String(opts.title ?? "").trim();
    if (!title) throw new StoreError("card title required");
    const num = board.nextCardId++;
    const nowStr = new Date().toISOString();
    const card: Card = {
      id: `c${num}`,
      num,
      title,
      body: opts.body ?? "",
      labels: [],
      size: null,
      assignee: null,
      color: null,
      blocked: null,
      blockedBy: [],
      completed: false,
      archived: false,
      createdAt: nowStr,
      updatedAt: nowStr,
      completedAt: null,
    };
    board.cards[card.id] = card;
    const list = board.order[colId];
    const index = opts.index ?? list.length;
    list.splice(Math.max(0, Math.min(index, list.length)), 0, card.id);
    applyCardPatch(board, card, opts);
    if (col.done) setCompleted(card, true);
    await writeBoard(dataRoot, board);
    await appendActivity(dataRoot, slug, {
      at: nowStr,
      actor,
      verb: "card-add",
      card: card.id,
      num: card.num,
      summary: `added #${card.num} "${card.title}" to ${col.name}`,
    });
    return { board, card };
  });
}

function applyCardPatch(board: Board, card: Card, patch: CardPatch): void {
  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    if (!t) throw new StoreError("card title cannot be empty");
    card.title = t;
  }
  if (patch.body !== undefined) card.body = String(patch.body);
  if (patch.labels !== undefined) {
    const ids = new Set(board.labels.map((l) => l.id));
    card.labels = patch.labels.filter((l) => ids.has(l));
  }
  if (patch.size !== undefined) card.size = patch.size;
  if (patch.assignee !== undefined) card.assignee = patch.assignee;
  if (patch.color !== undefined) card.color = patch.color === null ? null : checkColor(patch.color, "color");
  if (patch.blocked !== undefined) card.blocked = patch.blocked ? String(patch.blocked) : null;
  if (patch.blockedBy !== undefined)
    card.blockedBy = [...new Set(patch.blockedBy.filter((id) => !!board.cards[id] && id !== card.id))];
  if (patch.completed !== undefined) setCompleted(card, !!patch.completed);
  card.updatedAt = new Date().toISOString();
}

function describeCardPatch(patch: CardPatch, card: Card): string {
  const bits: string[] = [];
  if (patch.title !== undefined) bits.push("title");
  if (patch.body !== undefined) bits.push("description");
  if (patch.labels !== undefined) bits.push("labels");
  if (patch.size !== undefined) bits.push("size");
  if (patch.assignee !== undefined) bits.push("assignee");
  if (patch.color !== undefined) bits.push("color");
  if (patch.blocked !== undefined) bits.push(patch.blocked ? "blocked reason" : "unblocked");
  if (patch.blockedBy !== undefined)
    bits.push(patch.blockedBy.length ? `blockers → ${patch.blockedBy.join(", ")}` : "blockers cleared");
  if (patch.completed !== undefined) return patch.completed ? `completed #${card.num}` : `reopened #${card.num}`;
  return `edited #${card.num} (${bits.join(", ") || "no-op"})`;
}

export function patchCard(
  dataRoot: string,
  slug: string,
  cardId: string,
  patch: CardPatch,
  actor: Actor = "ai",
): Promise<{ board: Board; card: Card }> {
  return withBoardLock(dataRoot, slug, async () => {
    const board = await readBoard(dataRoot, slug);
    const card = getCard(board, cardId);
    applyCardPatch(board, card, patch);
    await writeBoard(dataRoot, board);
    await appendActivity(dataRoot, slug, {
      at: new Date().toISOString(),
      actor,
      verb: "card-edit",
      card: card.id,
      num: card.num,
      summary: describeCardPatch(patch, card),
    });
    return { board, card };
  });
}

export function moveCard(
  dataRoot: string,
  slug: string,
  cardId: string,
  toColumn: string,
  index?: number,
  actor: Actor = "ai",
): Promise<{ board: Board; card: Card }> {
  return withBoardLock(dataRoot, slug, async () => {
    const board = await readBoard(dataRoot, slug);
    const card = getCard(board, cardId);
    const to = board.columns.find((c) => c.id === toColumn);
    if (!to) throw new StoreError(`column ${toColumn} not found`, 404);
    const from = columnOf(board, card.id);
    if (from) {
      const list = board.order[from];
      list.splice(list.indexOf(card.id), 1);
    }
    const list = board.order[toColumn];
    const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length));
    list.splice(at, 0, card.id);
    if (to.done) setCompleted(card, true);
    else if (from && board.columns.find((c) => c.id === from)?.done) setCompleted(card, false);
    card.updatedAt = new Date().toISOString();
    await writeBoard(dataRoot, board);
    if (from !== toColumn)
      await appendActivity(dataRoot, slug, {
        at: new Date().toISOString(),
        actor,
        verb: "card-move",
        card: card.id,
        num: card.num,
        summary: `moved #${card.num} → ${to.name}${card.completed && to.done ? " (completed)" : ""}`,
      });
    return { board, card };
  });
}

export function archiveCard(
  dataRoot: string,
  slug: string,
  cardId: string,
  archived: boolean,
  restoreColumn?: string,
  actor: Actor = "ai",
): Promise<{ board: Board; card: Card }> {
  return withBoardLock(dataRoot, slug, async () => {
    const board = await readBoard(dataRoot, slug);
    const card = getCard(board, cardId);
    if (archived && !card.archived) {
      const from = columnOf(board, card.id);
      if (from) {
        const list = board.order[from];
        list.splice(list.indexOf(card.id), 1);
      }
      card.archived = true;
    } else if (!archived && card.archived) {
      card.archived = false;
      const colId = restoreColumn && board.order[restoreColumn] ? restoreColumn : board.columns[0].id;
      board.order[colId].push(card.id);
    }
    card.updatedAt = new Date().toISOString();
    await writeBoard(dataRoot, board);
    await appendActivity(dataRoot, slug, {
      at: new Date().toISOString(),
      actor,
      verb: archived ? "card-archive" : "card-restore",
      card: card.id,
      num: card.num,
      summary: `${archived ? "archived" : "restored"} #${card.num} "${card.title}"`,
    });
    return { board, card };
  });
}

export { taskStats } from "./tasks.ts";

export function toggleCardTask(
  dataRoot: string,
  slug: string,
  cardId: string,
  index: number,
  checked: boolean,
  actor: Actor = "ai",
): Promise<{ board: Board; card: Card }> {
  return withBoardLock(dataRoot, slug, async () => {
    const board = await readBoard(dataRoot, slug);
    const card = getCard(board, cardId);
    const body = toggleTaskMarker(card.body, index, checked);
    if (body === null) throw new StoreError(`task index ${index} out of range`, 400);
    card.body = body;
    card.updatedAt = new Date().toISOString();
    await writeBoard(dataRoot, board);
    const stats = taskStats(card.body);
    await appendActivity(dataRoot, slug, {
      at: new Date().toISOString(),
      actor,
      verb: "task-toggle",
      card: card.id,
      num: card.num,
      summary: `${checked ? "checked" : "unchecked"} a task on #${card.num} (${stats.done}/${stats.total})`,
    });
    return { board, card };
  });
}

export function promoteTask(
  dataRoot: string,
  slug: string,
  cardId: string,
  index: number,
  actor: Actor = "ai",
): Promise<{ board: Board; card: Card }> {
  return withBoardLock(dataRoot, slug, async () => {
    const board = await readBoard(dataRoot, slug);
    const parent = getCard(board, cardId);
    const line = taskLineText(parent.body, index);
    if (line === null) throw new StoreError(`task index ${index} out of range`, 400);
    const title = line.replace(/^#\d+\s+/, "").trim() || `Split from #${parent.num}`;

    const num = board.nextCardId++;
    const nowStr = new Date().toISOString();
    const card: Card = {
      id: `c${num}`,
      num,
      title,
      body: `Split from #${parent.num} ${parent.title}.`,
      labels: [...parent.labels],
      size: null,
      assignee: parent.assignee,
      color: null,
      blocked: null,
      blockedBy: [],
      completed: false,
      archived: false,
      createdAt: nowStr,
      updatedAt: nowStr,
      completedAt: null,
    };
    board.cards[card.id] = card;
    const colId = columnOf(board, parent.id) ?? board.columns[0].id;
    const list = board.order[colId];
    const parentAt = list.indexOf(parent.id);
    list.splice(parentAt >= 0 ? parentAt + 1 : list.length, 0, card.id);

    const rewritten = rewriteTaskLine(parent.body, index, `#${num} ${title}`);
    if (rewritten !== null) parent.body = rewritten;
    parent.updatedAt = nowStr;

    await writeBoard(dataRoot, board);
    await appendActivity(dataRoot, slug, {
      at: nowStr,
      actor,
      verb: "task-promote",
      card: card.id,
      num: card.num,
      summary: `split #${parent.num}'s task into #${card.num} "${title}"`,
    });
    return { board, card };
  });
}
