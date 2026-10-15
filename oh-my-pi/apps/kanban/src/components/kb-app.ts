/* <kb-app> — root shell: routing (home | board), top bar, keyboard map,
 * side panel slot (card panel or settings), toasts, keymap overlay. */

import { LitElement, css, html, nothing } from "lit";
import { base } from "../shared.ts";
import { state, subscribe } from "../state.ts";
import type { KbBoard } from "./kb-board.ts";
import type { KbColumn } from "./kb-column.ts";
import type { KbFilter } from "./kb-filter.ts";
import "./kb-board.ts";
import "./kb-filter.ts";
import "./kb-home.ts";
import "./kb-markdown.ts";
import "./kb-panel.ts";
import "./kb-settings.ts";
import "./kb-toast.ts";
import "./kb-projects.ts";

const KEYMAP: Array<[string, string]> = [
  ["/", "focus filter"],
  ["n", "new card (first column)"],
  ["↑ ↓ ← →", "move focus between cards"],
  ["Enter", "open focused card"],
  ["x", "toggle complete on focused card"],
  ["[  ]", "move focused card a column left / right"],
  ["Esc", "close panel / clear focus"],
  ["?", "toggle this keymap"],
];

export class KbApp extends LitElement {
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor() {
    super();
    subscribe(this);
  }

  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
      }
      .topbar {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 46px;
        padding: 0 16px;
        border-bottom: 1px solid var(--border);
        flex: none;
      }
      .home-link {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: var(--fg-muted);
        font-size: 13px;
      }
      .home-link:hover {
        color: var(--fg);
      }
      .logo {
        display: inline-flex;
        gap: 2px;
        align-items: flex-start;
      }
      .logo i {
        width: 4px;
        border-radius: 1px;
        background: var(--accent);
        display: inline-block;
      }
      .crumb-sep {
        color: var(--fg-subtle);
      }
      .crumb-link {
        color: var(--fg-muted);
        font-size: 13px;
        text-decoration: none;
      }
      .crumb-link:hover {
        color: var(--fg);
      }
      select.project-switcher {
        background: var(--surface-2);
        color: var(--fg);
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        padding: 3px 8px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
      }
      input.board-name {
        font-size: 14px;
        font-weight: 600;
        background: transparent;
        border-color: transparent;
        padding: 3px 8px;
        width: 280px;
      }
      input.board-name:hover {
        border-color: var(--border);
      }
      input.board-name:focus-visible {
        background: var(--surface);
      }
      .counts {
        font-size: 12px;
        color: var(--fg-muted);
        font-variant-numeric: tabular-nums;
      }
      .spacer {
        flex: 1;
      }
      main {
        flex: 1;
        display: flex;
        min-height: 0;
      }
      kb-board {
        flex: 1;
        min-width: 0;
      }
      .loading,
      .error {
        margin: auto;
        color: var(--fg-muted);
        font-size: 13px;
      }
      .error {
        color: var(--danger);
      }
      .digest {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 16px;
        border-bottom: 1px solid var(--border-muted);
        font-size: 12px;
        color: var(--fg-muted);
        background: ${css`rgba(232, 161, 58, 0.05)`};
        flex: none;
      }
      .digest-title {
        font-weight: 600;
        color: var(--accent);
      }
      .digest-list {
        display: inline-flex;
        gap: 10px;
        margin-left: 10px;
        min-width: 0;
        overflow: hidden;
      }
      .digest-item {
        color: var(--fg-subtle);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 260px;
      }
      .ai-glyph {
        color: #bf91f3;
      }
      .brief {
        border-bottom: 1px solid var(--border-muted);
        flex: none;
      }
      .brief-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 6px 16px;
        font-size: 12px;
        color: var(--fg-muted);
        text-align: left;
      }
      .brief-toggle:hover {
        color: var(--fg);
      }
      .brief-toggle .chev {
        color: var(--fg-subtle);
        width: 10px;
      }
      .brief-preview {
        color: var(--fg-subtle);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      .brief-body {
        padding: 4px 16px 12px 34px;
        max-height: 320px;
        overflow-y: auto;
      }
      .keymap {
        position: fixed;
        bottom: 46px;
        right: 14px;
        z-index: 90;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 12px 14px;
        font-size: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
      }
      .keymap table {
        border-collapse: collapse;
      }
      .keymap td {
        padding: 2px 6px;
      }
      .keymap td:first-child {
        font-family: var(--mono);
        color: var(--accent);
        text-align: right;
        white-space: nowrap;
      }
      .keymap-chip {
        position: fixed;
        bottom: 14px;
        right: 14px;
        z-index: 90;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid var(--border);
        color: var(--fg-subtle);
        font-size: 12px;
        background: var(--surface);
      }
      .keymap-chip:hover {
        color: var(--fg);
        border-color: var(--fg-subtle);
      }
      .gear.on {
        background: var(--surface-3);
        color: var(--fg);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    addEventListener("keydown", this.keyHandler);
    void state.loadRoute();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    removeEventListener("keydown", this.keyHandler);
  }

  private onKey(e: KeyboardEvent): void {
    const src = e.composedPath()[0];
    const typing =
      src instanceof HTMLElement &&
      (src.tagName === "INPUT" || src.tagName === "TEXTAREA" || src.tagName === "SELECT" || src.isContentEditable);
    if (typing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    const board = state.route.view === "board" && state.board;

    switch (e.key) {
      case "?":
        state.keymapOpen = !state.keymapOpen;
        state.emit();
        break;
      case "Escape":
        if (state.keymapOpen) state.keymapOpen = false;
        else if (state.settingsOpen) state.settingsOpen = false;
        else if (state.selected) state.selected = null;
        else state.cursor = null;
        state.emit();
        break;
      case "/":
        if (!board) return;
        e.preventDefault();
        this.renderRoot.querySelector<KbFilter>("kb-filter")?.focusInput();
        break;
      case "n": {
        if (!board) return;
        e.preventDefault();
        const firstColumn = this.renderRoot
          .querySelector<KbBoard>("kb-board")
          ?.renderRoot.querySelector<KbColumn>("kb-column");
        firstColumn?.openComposer();
        break;
      }
      case "ArrowUp":
        if (board) {
          e.preventDefault();
          state.cursorMove(0, -1);
        }
        break;
      case "ArrowDown":
        if (board) {
          e.preventDefault();
          state.cursorMove(0, 1);
        }
        break;
      case "ArrowLeft":
        if (board) {
          e.preventDefault();
          state.cursorMove(-1, 0);
        }
        break;
      case "ArrowRight":
        if (board) {
          e.preventDefault();
          state.cursorMove(1, 0);
        }
        break;
      case "Enter":
        if (board && state.cursor) state.selectCard(state.cursor);
        break;
      case "x": {
        if (!board || !state.cursor) return;
        const card = state.card(state.cursor);
        if (card) void state.updateCard(card.id, { completed: !card.completed });
        break;
      }
      case "[":
        if (board && state.cursor) void state.nudgeCard(state.cursor, -1);
        break;
      case "]":
        if (board && state.cursor) void state.nudgeCard(state.cursor, 1);
        break;
    }
  }

  updated(): void {
    const accent = state.board?.accent;
    if (state.route.view === "board" && accent) this.style.setProperty("--accent", accent);
    else this.style.removeProperty("--accent");
    document.title =
      state.route.view === "board" && state.board
        ? `${state.board.name} · ${state.project} · Kanban`
        : state.route.view === "home"
          ? `${state.project} · Kanban`
          : "Projects · Kanban";
  }

  private renderTopbar() {
    const board = state.board;
    return html`
      <div class="topbar">
        <a class="home-link" href="/" title="All projects" @click=${(e: Event) => {
          e.preventDefault();
          state.navigate("/");
        }}>
          <span class="logo" aria-hidden="true">
            <i style="height:14px"></i>
            <i style="height:10px;opacity:.65"></i>
            <i style="height:7px;opacity:.4"></i>
          </span>
          Kanban
        </a>
        ${state.route.view !== "projects"
          ? html`
              <span class="crumb-sep">/</span>
              <select
                class="project-switcher"
                @change=${(e: Event) => {
                  const el = e.currentTarget as HTMLSelectElement;
                  if (el.value) state.navigate(`/${el.value}/`);
                  else state.navigate("/");
                }}
              >
                <option value="">All projects</option>
                ${state.projects.map(
                  (p) => html`<option value=${p.id} ?selected=${p.id === state.project}>${p.name}</option>`,
                )}
              </select>
            `
          : nothing}
        ${state.route.view === "board"
          ? html`
              <span class="crumb-sep">/</span>
              <a class="crumb-link" href="/${state.project}/" @click=${(e: Event) => {
                e.preventDefault();
                state.navigate(`/${state.project}/`);
              }}>Boards</a>
            `
          : nothing}
        ${board
          ? html`
              <span class="crumb-sep">/</span>
              <input
                class="board-name"
                .value=${board.name}
                title="Rename board"
                @change=${(e: Event) => {
                  const el = e.currentTarget;
                  if (el instanceof HTMLInputElement && el.value.trim())
                    void state.patchBoard({ name: el.value.trim() });
                }}
              />
              <span class="counts">
                ${Object.values(board.cards).filter((c) => !c.archived && c.completed).length}/${Object.values(
                  board.cards,
                ).filter((c) => !c.archived).length}
                done
              </span>
              <span class="spacer"></span>
              <button
                class="icon-btn gear ${state.settingsOpen ? "on" : ""}"
                title="Board settings"
                @click=${() => state.toggleSettings()}
              >
                ⚙
              </button>
            `
          : nothing}
      </div>
    `;
  }

  private renderDigest() {
    if (state.digestDismissed || state.digest.length === 0) return nothing;
    const completed = state.digest.filter((a) => a.summary.startsWith("completed")).length;
    const added = state.digest.filter((a) => a.verb === "card-add").length;
    const byAi = state.digest.filter((a) => a.actor === "ai").length;
    return html`
      <div class="digest">
        <span class="digest-title">Since you were last here:</span>
        <span>${state.digest.length} change${state.digest.length === 1 ? "" : "s"}</span>
        ${added ? html`<span>· ${added} added</span>` : nothing}
        ${completed ? html`<span>· ${completed} completed</span>` : nothing}
        ${byAi ? html`<span>· ${byAi} by <span class="ai-glyph">◆ ai</span></span>` : nothing}
        <span class="digest-list">
          ${state.digest.slice(-3).map((a) => html`<span class="digest-item">${a.summary}</span>`)}
        </span>
        <span class="spacer"></span>
        <button class="icon-btn" title="Dismiss" @click=${() => state.dismissDigest()}>✕</button>
      </div>
    `;
  }

  private briefOpen = false;

  private renderBrief() {
    const brief = state.board?.brief?.trim();
    if (!brief) return nothing;
    return html`
      <div class="brief ${this.briefOpen ? "open" : ""}">
        <button
          class="brief-toggle"
          @click=${() => {
            this.briefOpen = !this.briefOpen;
            this.requestUpdate();
          }}
        >
          <span class="chev">${this.briefOpen ? "▾" : "▸"}</span> Brief
          ${this.briefOpen ? nothing : html`<span class="brief-preview">${brief.split("\n")[0]}</span>`}
        </button>
        ${this.briefOpen ? html`<kb-markdown class="brief-body" .md=${brief}></kb-markdown>` : nothing}
      </div>
    `;
  }

  render() {
    const route = state.route;
    return html`
      ${this.renderTopbar()}
      ${route.view === "projects"
        ? html`<kb-projects></kb-projects>`
        : route.view === "home"
          ? html`<kb-home></kb-home>`
          : html`
            ${state.board ? html`${this.renderBrief()}<kb-filter></kb-filter>${this.renderDigest()}` : nothing}
            <main>
              ${state.loading
                ? html`<div class="loading">Loading…</div>`
                : state.board
                  ? html`
                      <kb-board></kb-board>
                      ${state.selected ? html`<kb-panel></kb-panel>` : nothing}
                      ${state.settingsOpen ? html`<kb-settings></kb-settings>` : nothing}
                    `
                  : html`<div class="error">${state.loadError || "Board not found"} — <a href="/${state.project}/" style="color:var(--accent)">back to boards</a></div>`}
            </main>
          `}
      <kb-toast></kb-toast>
      ${state.keymapOpen
        ? html`<div class="keymap">
            <table>
              ${KEYMAP.map(([k, v]) => html`<tr><td>${k}</td><td>${v}</td></tr>`)}
            </table>
          </div>`
        : nothing}
      <button class="keymap-chip" title="Keyboard shortcuts (?)" @click=${() => {
        state.keymapOpen = !state.keymapOpen;
        state.emit();
      }}>
        ?
      </button>
    `;
  }
}

customElements.define("kb-app", KbApp);
