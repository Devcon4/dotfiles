/* App state service — the reactive core (the "state service" pattern).
 *
 * A single AppState EventTarget holds route + board + UI state and exposes
 * every mutation as an action method. Actions apply optimistically to the
 * local board, emit "change", then hit the API; failures refetch + toast.
 * Lit components subscribe via `subscribe(host)` (a ReactiveController)
 * and re-render on every emit.
 *
 * Server pushes (SSE) refetch the current board unless a drag or an
 * inline edit is in flight — user input always wins over a refresh.
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { Board, Card, CardPatch, Column, Label, Size } from "../store.ts";
import { taskStats, toggleTaskMarker } from "../tasks.ts";
import { api, onServerChange, setApiProject } from "./api.ts";
import type { ActivityEntry, BoardSummary, ProjectSummary, SearchResult } from "./api.ts";
import { SIZES } from "./shared.ts";

export interface Filter {
  text: string;
  labels: string[];
  assignee: "" | "ai" | "user";
  hideDone: boolean;
}

const EMPTY_FILTER: Filter = { text: "", labels: [], assignee: "", hideDone: false };

export interface DragPreview {
  cardId: string;
  fromColumn: string;
  toColumn: string;
  toIndex: number;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
  danger?: boolean;
}

export type Route =
  | { view: "projects" }
  | { view: "home"; project: string }
  | { view: "board"; project: string; slug: string };

function parseRoute(pathname: string): Route {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return { view: "projects" };
  if (parts.length === 1) return { view: "home", project: parts[0] };
  return { view: "board", project: parts[0], slug: parts[1] };
}

class AppState extends EventTarget {
  route: Route = parseRoute(location.pathname);
  project = "";
  projects: ProjectSummary[] = [];
  boards: BoardSummary[] = [];
  unreadable: { slug: string; error: string }[] = [];
  board: Board | null = null;
  loading = false;
  loadError = "";

  /** Recent activity for the open board (newest last). */
  activity: ActivityEntry[] = [];
  /** Entries since the previous visit — the "while you were away" digest. */
  digest: ActivityEntry[] = [];
  digestDismissed = false;

  searchResults: SearchResult[] = [];
  searchQuery = "";

  selected: string | null = null; // card id open in the side panel
  cursor: string | null = null; // keyboard focus ring (independent of panel)
  settingsOpen = false;
  keymapOpen = false;
  filter: Filter = { ...EMPTY_FILTER };
  drag: DragPreview | null = null;
  columnDrag: { columnId: string; toIndex: number } | null = null;
  toasts: Toast[] = [];

  /** Move the keyboard cursor: dx = columns, dy = rows. Selects the first
   * visible card when nothing is focused yet. Follows the panel if open. */
  cursorMove(dx: number, dy: number): void {
    const cols = this.columnsView()
      .map((c) => ({ id: c.id, ids: this.orderFor(c.id).filter((id) => this.matchesFilter(this.board!.cards[id])) }))
      .filter((c) => c.ids.length > 0);
    if (cols.length === 0) return;
    let ci = cols.findIndex((c) => this.cursor !== null && c.ids.includes(this.cursor));
    let ri = ci >= 0 ? cols[ci].ids.indexOf(this.cursor!) : 0;
    if (ci < 0) ci = 0;
    else {
      ci = Math.max(0, Math.min(cols.length - 1, ci + dx));
      ri = Math.max(0, Math.min(cols[ci].ids.length - 1, ri + dy));
    }
    this.cursor = cols[ci].ids[ri];
    if (this.selected) this.selected = this.cursor;
    this.emit();
  }

  /** Edits in flight (panel textarea etc.) suppress SSE refetches. */
  editHold = 0;

  private toastSeq = 1;
  private refetchTimer: number | NodeJS.Timeout | undefined; // DOM in the browser; Timeout under the repo tsconfig's node types

  private sseUnsubscribe: (() => void) | null = null;

  constructor() {
    super();
    this.reconnectSse();
    addEventListener("popstate", () => {
      this.route = parseRoute(location.pathname);
      void this.loadRoute();
    });
  }

  private reconnectSse(): void {
    if (this.sseUnsubscribe) this.sseUnsubscribe();
    this.sseUnsubscribe = onServerChange((slug) => {
      if (this.route.view === "board" && this.route.slug === slug) this.scheduleRefetch();
      else if (this.route.view === "home") void this.loadBoards();
    });
  }

  emit(): void {
    this.dispatchEvent(new Event("change"));
  }

  // --- routing ---------------------------------------------------------------

  navigate(path: string): void {
    history.pushState(null, "", path);
    this.route = parseRoute(path);
    this.selected = null;
    this.settingsOpen = false;
    if (this.route.view === "projects") {
      this.project = "";
      setApiProject("");
      this.reconnectSse();
      this.board = null;
      this.boards = [];
      this.activity = [];
    } else if (this.route.view === "home") {
      this.board = null;
      this.activity = [];
    }
    void this.loadRoute();
    this.emit();
  }

  async loadRoute(): Promise<void> {
    if (this.route.view === "projects") {
      this.project = "";
      setApiProject("");
      this.reconnectSse();
      await this.loadProjects();
    } else if (this.route.view === "home") {
      if (this.project !== this.route.project) {
        this.project = this.route.project;
        setApiProject(this.project);
        this.reconnectSse();
      }
      void this.loadProjects();
      await this.loadBoards();
    } else {
      if (this.project !== this.route.project) {
        this.project = this.route.project;
        setApiProject(this.project);
        this.reconnectSse();
      }
      void this.loadProjects();
      await this.loadBoard(this.route.slug);
    }
  }

  async loadProjects(): Promise<void> {
    try {
      const res = await api.projects();
      this.projects = res.projects;
      this.loadError = "";
    } catch (e) {
      this.loadError = (e as Error).message;
    }
    this.emit();
  }

  async loadBoards(): Promise<void> {
    try {
      const listing = await api.boards();
      this.boards = listing.boards;
      this.unreadable = listing.unreadable ?? [];
      this.loadError = "";
    } catch (e) {
      this.loadError = (e as Error).message;
    }
    this.emit();
  }

  async loadBoard(slug: string, opts?: { silent?: boolean }): Promise<void> {
    if (!opts?.silent) {
      this.loading = true;
      this.emit();
    }
    try {
      this.board = await api.board(slug);
      this.loadError = "";
      this.restoreFilter(slug);
      await this.loadActivity(slug, !opts?.silent);
    } catch (e) {
      this.board = null;
      this.loadError = (e as Error).message;
    }
    this.loading = false;
    this.emit();
  }

  private async loadActivity(slug: string, computeDigest: boolean): Promise<void> {
    try {
      this.activity = (await api.activity(slug, 60)).activity;
    } catch {
      this.activity = [];
    }
    if (!computeDigest) return;
    const lastSeen = localStorage.getItem(`kb-seen-${slug}`) ?? "";
    this.digest = lastSeen ? this.activity.filter((e) => e.at > lastSeen) : [];
    this.digestDismissed = this.digest.length === 0;
    // This visit becomes the new watermark once the board is open.
    localStorage.setItem(`kb-seen-${slug}`, new Date().toISOString());
  }

  dismissDigest(): void {
    this.digestDismissed = true;
    this.emit();
  }

  async runSearch(q: string): Promise<void> {
    this.searchQuery = q;
    if (!q.trim()) {
      this.searchResults = [];
      this.emit();
      return;
    }
    try {
      this.searchResults = (await api.search(q)).results;
    } catch {
      this.searchResults = [];
    }
    this.emit();
  }

  /** Client mirror of the store's blocked rule (reason OR open blocker). */
  isBlockedCard(card: Card): boolean {
    if (card.blocked) return true;
    const board = this.board;
    if (!board) return false;
    return card.blockedBy.some((id) => {
      const blocker = board.cards[id];
      return !!blocker && !blocker.completed && !blocker.archived;
    });
  }

  /** Cards that list `id` as a blocker (reverse relation). */
  blocksOf(id: string): Card[] {
    const board = this.board;
    if (!board) return [];
    return Object.values(board.cards).filter((c) => !c.archived && c.blockedBy.includes(id));
  }

  async promoteTask(cardId: string, index: number): Promise<void> {
    try {
      const { card } = await api.promoteTask(this.slug, cardId, index);
      if (this.route.view === "board") await this.loadBoard(this.route.slug, { silent: true });
      this.toast(`Split into #${card.num} "${card.title}"`);
    } catch (e) {
      await this.recover(e);
    }
  }

  private scheduleRefetch(): void {
    clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => {
      if (this.drag || this.columnDrag || this.editHold > 0) return this.scheduleRefetch();
      if (this.route.view === "board") void this.loadBoard(this.route.slug, { silent: true });
    }, 200);
  }

  // --- derived ---------------------------------------------------------------

  card(id: string): Card | null {
    return this.board?.cards[id] ?? null;
  }

  /** Column order with the live drag preview applied. */
  orderFor(columnId: string): string[] {
    const board = this.board;
    if (!board) return [];
    let ids = board.order[columnId] ?? [];
    const drag = this.drag;
    if (!drag) return ids;
    ids = ids.filter((id) => id !== drag.cardId);
    if (drag.toColumn === columnId) {
      ids = [...ids];
      ids.splice(Math.min(drag.toIndex, ids.length), 0, drag.cardId);
    }
    return ids;
  }

  /** Columns with the live column-drag preview applied. */
  columnsView(): Column[] {
    const board = this.board;
    if (!board) return [];
    const cd = this.columnDrag;
    if (!cd) return board.columns;
    const cols = board.columns.filter((c) => c.id !== cd.columnId);
    const dragged = board.columns.find((c) => c.id === cd.columnId);
    if (dragged) cols.splice(Math.min(cd.toIndex, cols.length), 0, dragged);
    return cols;
  }

  matchesFilter(card: Card): boolean {
    const f = this.filter;
    if (f.hideDone && card.completed) return false;
    if (f.assignee && card.assignee !== f.assignee) return false;
    // OR semantics — the universal tag-filter expectation (v2 UX-2).
    if (f.labels.length && !f.labels.some((l) => card.labels.includes(l))) return false;
    if (f.text) {
      const needle = f.text.toLowerCase();
      const hay = `#${card.num} ${card.title}\n${card.body}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  }

  filterActive(): boolean {
    const f = this.filter;
    return !!(f.text || f.labels.length || f.assignee || f.hideDone);
  }

  // --- ui state ----------------------------------------------------------------

  selectCard(id: string | null): void {
    this.selected = id;
    if (id) this.settingsOpen = false;
    this.emit();
  }

  toggleSettings(open?: boolean): void {
    this.settingsOpen = open ?? !this.settingsOpen;
    if (this.settingsOpen) this.selected = null;
    this.emit();
  }

  setFilter(patch: Partial<Filter>): void {
    this.filter = { ...this.filter, ...patch };
    if (this.route.view === "board")
      localStorage.setItem(`kb-filter-${this.route.slug}`, JSON.stringify(this.filter));
    this.emit();
  }

  private restoreFilter(slug: string): void {
    try {
      const raw = localStorage.getItem(`kb-filter-${slug}`);
      this.filter = raw ? { ...EMPTY_FILTER, ...JSON.parse(raw) } : { ...EMPTY_FILTER };
    } catch {
      this.filter = { ...EMPTY_FILTER };
    }
  }

  toast(message: string, opts?: { action?: ToastAction; danger?: boolean }): void {
    const id = this.toastSeq++;
    this.toasts = [...this.toasts, { id, message, ...opts }];
    this.emit();
    setTimeout(() => this.dismissToast(id), 6500);
  }

  dismissToast(id: number): void {
    if (!this.toasts.some((t) => t.id === id)) return;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  // --- actions -------------------------------------------------------------------

  private get slug(): string {
    return this.board?.slug ?? "";
  }

  /** Refetch after a failed optimistic action. */
  private async recover(e: unknown): Promise<void> {
    this.toast((e as Error).message, { danger: true });
    if (this.route.view === "board") await this.loadBoard(this.route.slug, { silent: true });
  }

  async createBoard(name: string, template?: string): Promise<string | null> {
    try {
      const { board } = await api.createBoard({ name, template });
      await this.loadBoards();
      return board.slug;
    } catch (e) {
      this.toast((e as Error).message, { danger: true });
      return null;
    }
  }

  /** Parse composer quick-syntax: `title #label !size @me ^column`.
   * Unrecognized tokens stay in the title (predictability over magic). */
  parseQuickAdd(raw: string, columnId: string): { title: string; patch: CardPatch; column: string } {
    const board = this.board;
    const patch: CardPatch = {};
    let column = columnId;
    if (!board) return { title: raw.trim(), patch, column };
    const kept: string[] = [];
    for (const token of raw.split(/\s+/)) {
      if (/^#\S+$/.test(token)) {
        const key = token.slice(1).toLowerCase();
        const label = board.labels.find(
          (l) => l.id.toLowerCase() === key || l.name.toLowerCase().startsWith(key),
        );
        if (label) {
          patch.labels = [...(patch.labels ?? []), label.id];
          continue;
        }
      } else if (/^!\S+$/.test(token)) {
        const size = token.slice(1).toUpperCase();
        if ((SIZES as readonly string[]).includes(size)) {
          patch.size = size as Size; // narrowing: SIZES.includes proves membership
          continue;
        }
      } else if (token === "@me" || token === "@user") {
        patch.assignee = "user";
        continue;
      } else if (token === "@ai") {
        patch.assignee = "ai";
        continue;
      } else if (/^\^\S+$/.test(token)) {
        const key = token.slice(1).toLowerCase();
        const col = board.columns.find(
          (c) => c.id.toLowerCase() === key || c.name.toLowerCase().startsWith(key),
        );
        if (col) {
          column = col.id;
          continue;
        }
      }
      kept.push(token);
    }
    return { title: kept.join(" ").trim(), patch, column };
  }

  async addCard(columnId: string, rawTitle: string): Promise<void> {
    const board = this.board;
    if (!board) return;
    const { title, patch, column } = this.parseQuickAdd(rawTitle, columnId);
    if (!title) return;
    // Optimistic: fabricate the card with the next id; server assigns the same.
    const num = board.nextCardId;
    const card: Card = {
      id: `c${num}`,
      num,
      title,
      body: "",
      labels: patch.labels ?? [],
      size: patch.size ?? null,
      assignee: patch.assignee ?? null,
      color: null,
      blocked: null,
      blockedBy: [],
      completed: false,
      archived: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
    board.nextCardId++;
    board.cards[card.id] = card;
    board.order[column] = [...(board.order[column] ?? []), card.id];
    this.emit();
    try {
      await api.addCard(this.slug, { ...patch, title, column });
    } catch (e) {
      await this.recover(e);
    }
  }

  async updateCard(id: string, patch: CardPatch): Promise<void> {
    const card = this.card(id);
    if (!card) return;
    if (patch.title !== undefined) card.title = patch.title;
    if (patch.body !== undefined) card.body = patch.body;
    if (patch.labels !== undefined) card.labels = patch.labels;
    if (patch.size !== undefined) card.size = patch.size;
    if (patch.assignee !== undefined) card.assignee = patch.assignee;
    if (patch.color !== undefined) card.color = patch.color;
    if (patch.blocked !== undefined) card.blocked = patch.blocked;
    if (patch.blockedBy !== undefined) card.blockedBy = patch.blockedBy;
    if (patch.completed !== undefined) {
      card.completed = patch.completed;
      card.completedAt = patch.completed ? new Date().toISOString() : null;
    }
    card.updatedAt = new Date().toISOString();
    this.emit();
    try {
      await api.patchCard(this.slug, id, patch);
    } catch (e) {
      await this.recover(e);
    }
  }

  async moveCard(id: string, toColumn: string, toIndex: number): Promise<void> {
    const board = this.board;
    if (!board) return;
    for (const colId of Object.keys(board.order))
      board.order[colId] = board.order[colId].filter((x) => x !== id);
    const list = board.order[toColumn] ?? [];
    list.splice(Math.min(toIndex, list.length), 0, id);
    board.order[toColumn] = list;
    const card = board.cards[id];
    const col = board.columns.find((c) => c.id === toColumn);
    if (card && col?.done && !card.completed) {
      card.completed = true;
      card.completedAt = new Date().toISOString();
    }
    this.emit();
    try {
      await api.moveCard(this.slug, id, toColumn, toIndex);
    } catch (e) {
      await this.recover(e);
    }
  }

  /** Move relative to current position: dir -1 = column left, +1 = right. */
  async nudgeCard(id: string, dir: -1 | 1): Promise<void> {
    const board = this.board;
    if (!board) return;
    const colIndex = board.columns.findIndex((c) => (board.order[c.id] ?? []).includes(id));
    const target = board.columns[colIndex + dir];
    if (colIndex < 0 || !target) return;
    await this.moveCard(id, target.id, (board.order[target.id] ?? []).length);
  }

  async archiveCard(id: string): Promise<void> {
    const board = this.board;
    if (!board) return;
    const card = board.cards[id];
    const fromColumn = Object.keys(board.order).find((c) => board.order[c].includes(id));
    for (const colId of Object.keys(board.order))
      board.order[colId] = board.order[colId].filter((x) => x !== id);
    if (card) card.archived = true;
    if (this.selected === id) this.selected = null;
    this.emit();
    try {
      await api.archiveCard(this.slug, id, true);
      this.toast(`Archived #${card?.num} ${card?.title ?? ""}`, {
        action: { label: "Undo", run: () => void this.restoreCard(id, fromColumn) },
      });
    } catch (e) {
      await this.recover(e);
    }
  }

  async restoreCard(id: string, column?: string): Promise<void> {
    try {
      await api.archiveCard(this.slug, id, false, column);
      if (this.route.view === "board") await this.loadBoard(this.route.slug, { silent: true });
    } catch (e) {
      await this.recover(e);
    }
  }

  async toggleTask(id: string, index: number, checked: boolean): Promise<void> {
    const card = this.card(id);
    if (!card) return;
    const body = toggleTaskMarker(card.body, index, checked);
    if (body === null) return;
    card.body = body;
    this.emit();
    try {
      await api.toggleTask(this.slug, id, index, checked);
    } catch (e) {
      await this.recover(e);
    }
  }

  async patchBoard(patch: {
    name?: string;
    accent?: string;
    archived?: boolean;
    brief?: string;
    labels?: Label[];
    columns?: Column[];
  }): Promise<void> {
    const board = this.board;
    if (!board) return;
    const previousName = board.name;
    if (patch.name) board.name = patch.name;
    if (patch.accent) board.accent = patch.accent;
    if (patch.brief !== undefined) board.brief = patch.brief;
    if (patch.labels) board.labels = patch.labels;
    if (patch.columns) {
      board.columns = patch.columns;
      for (const c of patch.columns) board.order[c.id] ??= [];
    }
    this.emit();
    try {
      await api.patchBoard(this.slug, patch);
      await this.loadBoard(this.slug, { silent: true });
      if (patch.name && patch.name !== previousName)
        this.toast(`Renamed board to "${patch.name}"`, {
          action: { label: "Undo", run: () => void this.patchBoard({ name: previousName }) },
        });
    } catch (e) {
      await this.recover(e);
    }
  }

  taskProgress(card: Card): { total: number; done: number } {
    return taskStats(card.body);
  }
}

export const state = new AppState();

/** Lit ReactiveController: re-render `host` on every state emit. */
export function subscribe(host: ReactiveControllerHost): void {
  const listener = () => host.requestUpdate();
  const controller: ReactiveController = {
    hostConnected: () => state.addEventListener("change", listener),
    hostDisconnected: () => state.removeEventListener("change", listener),
  };
  host.addController(controller);
}
