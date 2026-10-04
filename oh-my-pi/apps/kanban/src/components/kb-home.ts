/* <kb-home> — the boards index: hairline-divided rows with a mini column
 * distribution bar, plus an inline create row. Archived boards collapse
 * into a <details> at the bottom. */

import { LitElement, css, html, nothing } from "lit";
import type { BoardSummary } from "../api.ts";
import { api } from "../api.ts";
import { base, relTime, tint } from "../shared.ts";
import { state, subscribe } from "../state.ts";

export class KbHome extends LitElement {
  constructor() {
    super();
    subscribe(this);
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
      }
      .wrap {
        max-width: 760px;
        margin: 0 auto;
        padding: 48px 24px 80px;
      }
      header {
        display: flex;
        align-items: baseline;
        gap: 12px;
        padding-bottom: 14px;
        border-bottom: 1px solid var(--border);
      }
      h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
      }
      .sub {
        font-size: 12px;
        color: var(--fg-muted);
      }
      .board-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 10px;
        border-bottom: 1px solid var(--border-muted);
        cursor: pointer;
        border-radius: var(--radius);
      }
      .board-row:hover {
        background: var(--surface);
      }
      .board-row.unreadable {
        cursor: default;
        border-left: 3px solid var(--danger);
        padding-left: 7px;
      }
      .board-row.unreadable:hover {
        background: transparent;
      }
      .board-row.unreadable .slug {
        color: var(--danger);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        flex: none;
      }
      .name {
        font-size: 14px;
        font-weight: 600;
      }
      .slug {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--fg-subtle);
      }
      .grow {
        flex: 1;
        min-width: 0;
      }
      .distr {
        display: flex;
        width: 160px;
        height: 6px;
        border-radius: 3px;
        overflow: hidden;
        background: var(--surface-3);
        flex: none;
      }
      .distr span {
        height: 100%;
      }
      .meta {
        font-size: 12px;
        color: var(--fg-muted);
        white-space: nowrap;
        text-align: right;
      }
      .meta .faint {
        color: var(--fg-subtle);
        font-size: 11px;
      }
      .create {
        display: flex;
        gap: 8px;
        margin-top: 22px;
      }
      .create input {
        flex: 1;
        background: var(--surface);
      }
      .create button {
        border: 1px solid var(--success);
        color: var(--success);
        background: ${css`rgba(87, 171, 90, 0.12)`};
        border-radius: var(--radius);
        padding: 5px 16px;
        font-size: 13px;
        font-weight: 600;
      }
      details {
        margin-top: 28px;
      }
      summary {
        font-size: 12px;
        color: var(--fg-subtle);
        cursor: pointer;
        user-select: none;
      }
      .empty {
        margin-top: 40px;
        text-align: center;
        color: var(--fg-muted);
        font-size: 13px;
        line-height: 1.8;
      }
      .restore {
        font-size: 11px;
        border: 1px solid var(--border);
        border-radius: 2em;
        padding: 2px 10px;
        color: var(--fg-muted);
      }
      .restore:hover {
        color: var(--fg);
        border-color: var(--fg-subtle);
      }
      .search-row {
        margin-top: 16px;
      }
      input.global-search {
        width: 100%;
        background: var(--surface);
        font-size: 13px;
      }
      .results {
        margin-top: 6px;
      }
      .result-row {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 9px 10px;
        border-bottom: 1px solid var(--border-muted);
        cursor: pointer;
        border-radius: var(--radius);
        min-width: 0;
      }
      .result-row:hover {
        background: var(--surface);
      }
      .result-row .dot {
        width: 8px;
        height: 8px;
        align-self: center;
      }
      .rnum {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--fg-subtle);
        flex: none;
      }
      .rtitle {
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .rtitle.done {
        text-decoration: line-through;
        color: var(--fg-muted);
      }
      .rflag {
        font-size: 11px;
      }
      .rmeta {
        font-size: 11px;
        color: var(--fg-muted);
        white-space: nowrap;
        flex: none;
      }
      .rsnippet {
        font-size: 11px;
        color: var(--fg-subtle);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
      select.tmpl {
        font-size: 12px;
        background: var(--surface);
      }
    `,
  ];

  connectedCallback(): void {
    super.connectedCallback();
    void state.loadBoards();
  }

  private async create(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (!name) return;
    const tmpl = this.renderRoot.querySelector("select.tmpl");
    const template = tmpl instanceof HTMLSelectElement ? tmpl.value : undefined;
    const slug = await state.createBoard(name, template);
    input.value = "";
    if (slug) state.navigate(`/${state.project}/${slug}/`);
  }

  private boardRow(b: BoardSummary, archived: boolean) {
    const total = b.columns.reduce((n, c) => n + c.count, 0) || 1;
    return html`
      <div class="board-row" @click=${() => (archived ? null : state.navigate(`/${state.project}/${b.slug}/`))}>
        <span class="dot" style="background:${b.accent};box-shadow:0 0 0 3px ${tint(b.accent, 0.18)}"></span>
        <span class="grow">
          <span class="name">${b.name}</span>
          <span class="slug">/${b.slug}</span>
        </span>
        <span class="distr" title=${b.columns.map((c) => `${c.name} ${c.count}`).join(" · ")}>
          ${b.columns.map((c) => html`<span style="width:${(c.count / total) * 100}%;background:${c.color}"></span>`)}
        </span>
        <span class="meta">
          ${b.doneCount}/${b.cardCount} done
          ${b.tasksTotal > 0 ? html`· ▣ ${b.tasksDone}/${b.tasksTotal}` : nothing}
          <br />
          <span class="faint">updated ${relTime(b.updatedAt)}</span>
        </span>
        ${archived
          ? html`<button
              class="restore"
              @click=${async (e: Event) => {
                e.stopPropagation();
                await api.patchBoard(b.slug, { archived: false });
                void state.loadBoards();
              }}
            >
              restore
            </button>`
          : nothing}
      </div>
    `;
  }

  private loaded = false;

  render() {
    // Gate: render nothing until the first fetch resolves (no "0 boards" flash).
    if (state.boards.length === 0 && state.unreadable.length === 0 && !this.loaded && !state.loadError) {
      void state
        .loadBoards()
        .then(() => {
          this.loaded = true;
          this.requestUpdate();
        });
      return nothing;
    }
    this.loaded = true;
    const live = state.boards.filter((b) => !b.archived);
    const archived = state.boards.filter((b) => b.archived);
    const q = state.searchQuery.trim();

    return html`
      <div class="wrap">
        <header>
          <h1>Boards</h1>
          <span class="sub">kanban for ${state.project || "project"} — shared by you and the AI · ${live.length} board${live.length === 1 ? "" : "s"}</span>
        </header>

        <div class="search-row">
          <input
            class="global-search"
            type="search"
            placeholder="Search every board…"
            .value=${state.searchQuery}
            @input=${(e: Event) => {
              const el = e.currentTarget;
              if (el instanceof HTMLInputElement) void state.runSearch(el.value);
            }}
          />
        </div>

        ${q
          ? html`
              <div class="results">
                ${state.searchResults.length === 0
                  ? html`<div class="empty">No cards match "${q}"</div>`
                  : state.searchResults.map(
                      (r) => html`
                        <div
                          class="result-row"
                          @click=${() => {
                            state.navigate(`/${state.project}/${r.slug}/`);
                            // Open the card once the board loads.
                            const openIt = () => {
                              if (state.board?.slug === r.slug) {
                                state.selectCard(r.id);
                                state.removeEventListener("change", openIt);
                              }
                            };
                            state.addEventListener("change", openIt);
                          }}
                        >
                          <span class="dot" style="background:${r.accent}"></span>
                          <span class="rnum">#${r.num}</span>
                          <span class="rtitle ${r.completed ? "done" : ""}">${r.title}</span>
                          ${r.blocked ? html`<span class="rflag">⛔</span>` : nothing}
                          <span class="rmeta">${r.board} · ${r.column}</span>
                          ${r.snippet ? html`<span class="rsnippet">…${r.snippet}…</span>` : nothing}
                        </div>
                      `,
                    )}
              </div>
            `
          : html`
              ${live.map((b) => this.boardRow(b, false))}
              ${state.unreadable.map(
                (u) => html`
                  <div class="board-row unreadable" title=${u.error}>
                    <span class="dot" style="background:var(--danger)"></span>
                    <span class="grow">
                      <span class="name">${u.slug}</span>
                      <span class="slug">unreadable — ${u.error}</span>
                    </span>
                    <span class="meta faint">fix docs/kanban/boards/${u.slug}.json</span>
                  </div>
                `,
              )}
              ${live.length === 0
                ? html`<div class="empty">
                    No boards yet — a board is a set of columns you move task cards across.<br />
                    Create one below, or seed from the CLI:
                    <code>kb new-board "Name"</code>
                  </div>`
                : nothing}

              <div class="create">
                <input
                  placeholder="New board name…"
                  @keydown=${(e: KeyboardEvent) => {
                    const el = e.currentTarget;
                    if (e.key === "Enter" && el instanceof HTMLInputElement) void this.create(el);
                  }}
                />
                <select class="tmpl" title="Template">
                  <option value="simple">simple</option>
                  <option value="asset-production">asset production</option>
                </select>
                <button
                  @click=${(e: Event) => {
                    const btn = e.currentTarget;
                    if (!(btn instanceof HTMLElement)) return;
                    const input = btn.parentElement?.querySelector("input");
                    if (input instanceof HTMLInputElement) void this.create(input);
                  }}
                >
                  Create
                </button>
              </div>

              ${archived.length > 0
                ? html`<details>
                    <summary>${archived.length} archived</summary>
                    ${archived.map((b) => this.boardRow(b, true))}
                  </details>`
                : nothing}
            `}
      </div>
    `;
  }
}

customElements.define("kb-home", KbHome);
