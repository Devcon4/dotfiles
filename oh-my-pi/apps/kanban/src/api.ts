import type { Board, BoardPatch, Card, CardPatch, Column } from "../store.ts";

export interface ColumnSummary {
  id: string;
  name: string;
  color: string;
  count: number;
}

export interface BoardSummary {
  slug: string;
  name: string;
  accent: string;
  archived: boolean;
  updatedAt: string;
  cardCount: number;
  doneCount: number;
  tasksTotal: number;
  tasksDone: number;
  columns: ColumnSummary[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  root: string;
  boardCount: number;
}

let activeProject = "";

export function setApiProject(project: string): void {
  activeProject = project;
}

export function getApiProject(): string {
  return activeProject;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const fullPath = normalized.startsWith("/api/projects")
    ? normalized
    : activeProject
      ? `/${activeProject}${normalized}`
      : normalized;

  const res = await fetch(fullPath, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `${res.status} ${res.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  projects: () => request<{ projects: ProjectSummary[] }>("/api/projects"),

  boards: () =>
    request<{ boards: BoardSummary[]; unreadable: { slug: string; error: string }[] }>("/api/boards"),

  createBoard: (opts: { name: string; slug?: string; accent?: string; template?: string }) =>
    request<{ board: Board }>("/api/boards", { method: "POST", body: JSON.stringify(opts) }),

  board: (slug: string) => request<Board>(`/api/board/${slug}`),

  patchBoard: (slug: string, patch: BoardPatch & { columns?: Column[] }) =>
    request<{ board: Board }>(`/api/board/${slug}`, { method: "PATCH", body: JSON.stringify(patch) }),

  addCard: (slug: string, opts: CardPatch & { title: string; column?: string; index?: number }) =>
    request<{ card: Card }>(`/api/board/${slug}/cards`, { method: "POST", body: JSON.stringify(opts) }),

  patchCard: (slug: string, cardId: string, patch: CardPatch) =>
    request<{ card: Card }>(`/api/board/${slug}/card/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  moveCard: (slug: string, cardId: string, column: string, index: number) =>
    request<{ card: Card }>(`/api/board/${slug}/card/${cardId}/move`, {
      method: "POST",
      body: JSON.stringify({ column, index }),
    }),

  archiveCard: (slug: string, cardId: string, archived: boolean, restoreColumn?: string) =>
    request<{ card: Card }>(`/api/board/${slug}/card/${cardId}/archive`, {
      method: "POST",
      body: JSON.stringify({ archived, restoreColumn }),
    }),

  toggleTask: (slug: string, cardId: string, index: number, checked: boolean) =>
    request<{ card: Card }>(`/api/board/${slug}/card/${cardId}/task`, {
      method: "POST",
      body: JSON.stringify({ index, checked }),
    }),

  promoteTask: (slug: string, cardId: string, index: number) =>
    request<{ card: Card }>(`/api/board/${slug}/card/${cardId}/promote-task`, {
      method: "POST",
      body: JSON.stringify({ index }),
    }),

  activity: (slug: string, limit = 30) =>
    request<{ activity: ActivityEntry[] }>(`/api/board/${slug}/activity?limit=${limit}`),

  search: (q: string) =>
    request<{ results: SearchResult[] }>(`/api/search?q=${encodeURIComponent(q)}`),
};

export interface ActivityEntry {
  at: string;
  actor: "user" | "ai";
  verb: string;
  card?: string;
  num?: number;
  summary: string;
}

export interface SearchResult {
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
}

export function onServerChange(handler: (slug: string) => void): () => void {
  const url = activeProject ? `/${activeProject}/api/events` : `/api/events`;
  const source = new EventSource(url);
  source.onmessage = (e) => {
    try {
      const data: unknown = JSON.parse(e.data);
      if (data && typeof data === "object" && "slug" in data && typeof data.slug === "string")
        handler(data.slug);
    } catch {
      /* ignore malformed events */
    }
  };
  return () => source.close();
}
