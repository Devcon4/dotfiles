/* <kb-panel> — the card detail side panel (GitHub Projects style, never a
 * modal). Every field edits in place: click-to-edit title, Write|Preview
 * description with interactive task lists, chip-toggle labels, segmented
 * size/assignee, swatch color, blocked reason input. */

import { LitElement, css, html, nothing } from "lit";
import type { Card } from "../../store.ts";
import { SIZES, base, relTime, tint } from "../shared.ts";
import { state, subscribe } from "../state.ts";
import "./kb-markdown.ts";
import "./kb-swatch.ts";

export class KbPanel extends LitElement {
  private editingTitle = false;
  private editingBody = false;
  private draft = "";
  private lastCardId: string | null = null;

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
        width: 460px;
        flex: none;
        border-left: 1px solid var(--border);
        background: var(--bg);
        min-height: 0;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 16px;
        border-bottom: 1px solid var(--border-muted);
        flex: none;
      }
      .num {
        font-family: var(--mono);
        font-size: 12px;
        color: var(--fg-subtle);
      }
      .spacer {
        flex: 1;
      }
      .complete-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        padding: 4px 10px;
        border: 1px solid var(--border);
        border-radius: 2em;
        color: var(--fg-muted);
      }
      .complete-btn:hover {
        border-color: var(--success);
        color: var(--success);
      }
      .complete-btn.on {
        background: ${css`rgba(87, 171, 90, 0.15)`};
        border-color: var(--success);
        color: var(--success);
      }
      .archive-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 12px;
        padding: 4px 10px;
        border: 1px solid var(--border);
        border-radius: 2em;
        color: var(--fg-muted);
      }
      .archive-btn:hover {
        border-color: var(--danger);
        color: var(--danger);
      }
      .label-toggle:not(.on) {
        border-style: dashed;
        color: var(--fg-subtle);
      }
      .label-toggle:not(.on):hover {
        border-style: solid;
        color: var(--fg-muted);
      }
      .body {
        flex: 1;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: var(--border) transparent;
      }
      section {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border-muted);
      }
      h2.title {
        margin: 0;
        font-size: 17px;
        font-weight: 600;
        line-height: 1.35;
        cursor: text;
        border-radius: var(--radius);
      }
      h2.title:hover {
        background: var(--surface);
        outline: 4px solid var(--surface);
      }
      h2.title.completed {
        color: var(--fg-muted);
        text-decoration: line-through;
      }
      input.title-input {
        width: 100%;
        font-size: 17px;
        font-weight: 600;
      }
      .row {
        display: grid;
        grid-template-columns: 84px 1fr;
        gap: 10px;
        align-items: start;
        padding: 7px 0;
      }
      .row + .row {
        border-top: 1px solid var(--border-muted);
      }
      .row .key {
        font-size: 12px;
        color: var(--fg-muted);
        padding-top: 3px;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .chip {
        cursor: pointer;
        background: transparent;
        border-color: var(--border);
        color: var(--fg-subtle);
        height: 20px;
      }
      .seg {
        display: inline-flex;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
      }
      .seg button {
        font-size: 11px;
        padding: 4px 10px;
        color: var(--fg-muted);
        border-right: 1px solid var(--border);
      }
      .seg button:last-child {
        border-right: none;
      }
      .seg button.on {
        background: var(--surface-3);
        color: var(--fg);
        font-weight: 600;
      }
      select {
        font-size: 12px;
        padding: 4px 8px;
        background: var(--surface);
      }
      input.blocked {
        width: 100%;
        font-size: 12px;
        background: var(--surface);
      }
      input.blocked.set {
        border-color: ${css`rgba(210, 153, 34, 0.55)`};
        color: var(--warn);
      }
      .blocked-cell {
        display: block;
        min-width: 0;
      }
      .blocker-chip {
        cursor: pointer;
        border-color: ${css`rgba(210, 153, 34, 0.5)`};
        color: var(--warn);
        background: rgba(210, 153, 34, 0.1);
      }
      .blocker-chip.resolved {
        border-color: var(--border);
        color: var(--fg-subtle);
        background: transparent;
      }
      .chip-x {
        margin-left: 4px;
        opacity: 0.6;
      }
      .chip-x:hover {
        opacity: 1;
        color: var(--danger);
      }
      input.blocker-add {
        width: 92px;
        font-size: 11px;
        padding: 1px 7px;
        height: 20px;
        border-radius: 2em;
        background: transparent;
        border-style: dashed;
      }
      .blocks-line {
        margin-top: 6px;
        font-size: 11px;
        color: var(--fg-muted);
        display: flex;
        gap: 4px;
        align-items: center;
        flex-wrap: wrap;
      }
      .blocks-line .chip {
        cursor: pointer;
        border-color: var(--border);
        color: var(--fg-muted);
        background: transparent;
      }
      .act-row {
        display: flex;
        gap: 8px;
        align-items: baseline;
        padding: 4px 0;
        font-size: 12px;
        border-top: 1px solid var(--border-muted);
      }
      .act-row:first-of-type {
        border-top: none;
      }
      .act-actor.ai {
        color: #bf91f3;
      }
      .act-actor.user {
        color: #6cb6ff;
      }
      .act-summary {
        flex: 1;
        color: var(--fg-muted);
      }
      .act-time {
        color: var(--fg-subtle);
        font-size: 11px;
        white-space: nowrap;
      }
      .desc-head {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }
      .desc-head .label {
        font-size: 12px;
        font-weight: 600;
        color: var(--fg-muted);
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      textarea.editor {
        width: 100%;
        min-height: 240px;
        font-family: var(--mono);
        font-size: 12.5px;
        line-height: 1.55;
        background: var(--surface);
        resize: vertical;
      }
      .editor-foot {
        display: flex;
        gap: 8px;
        margin-top: 8px;
        justify-content: flex-end;
        align-items: center;
      }
      .editor-foot .hint {
        font-size: 11px;
        color: var(--fg-subtle);
        margin-right: auto;
      }
      .save-btn {
        background: ${css`rgba(87, 171, 90, 0.18)`};
        border: 1px solid var(--success);
        color: var(--success);
        border-radius: var(--radius);
        padding: 4px 14px;
        font-size: 12px;
        font-weight: 600;
      }
      .empty-desc {
        color: var(--fg-subtle);
        font-size: 13px;
        cursor: pointer;
        border: 1px dashed var(--border-muted);
        border-radius: var(--radius);
        padding: 14px;
        text-align: center;
      }
      .empty-desc:hover {
        color: var(--fg-muted);
        border-color: var(--border);
      }
      .foot {
        padding: 10px 16px;
        font-size: 11px;
        color: var(--fg-subtle);
        display: flex;
        gap: 14px;
        flex: none;
      }
      .danger-btn:hover {
        color: var(--danger);
      }
    `,
  ];

  private card(): Card | null {
    return state.selected ? state.card(state.selected) : null;
  }

  private cardActivity() {
    const id = state.selected;
    if (!id) return [];
    return state.activity
      .filter((a) => a.card === id)
      .slice(-8)
      .reverse();
  }

  willUpdate(): void {
    // Reset in-place editors when the panel switches cards.
    const id = state.selected;
    if (id !== this.lastCardId) {
      this.lastCardId = id;
      this.editingTitle = false;
      if (this.editingBody) state.editHold--;
      this.editingBody = false;
      this.draft = "";
    }
  }

  private startBodyEdit(): void {
    const card = this.card();
    if (!card) return;
    this.draft = card.body;
    this.editingBody = true;
    state.editHold++;
    this.requestUpdate();
    void this.updateComplete.then(() => this.renderRoot.querySelector("textarea")?.focus());
  }

  private commitBody(): void {
    const card = this.card();
    if (card && this.draft !== card.body) void state.updateCard(card.id, { body: this.draft });
    this.editingBody = false;
    state.editHold--;
    this.requestUpdate();
  }

  private cancelBody(): void {
    this.editingBody = false;
    state.editHold--;
    this.draft = "";
    this.requestUpdate();
  }

  /** Paste an image into the editor → upload → insert markdown at the caret. */
  private async pasteImage(e: ClipboardEvent): Promise<void> {
    const file = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (!file) return; // plain text paste — let it through
    e.preventDefault();
    const slug = state.board?.slug;
    const area = e.currentTarget;
    if (!slug || !(area instanceof HTMLTextAreaElement)) return;
    try {
      const res = await fetch(`/api/images?board=${slug}&name=${encodeURIComponent(file.name || "paste")}`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      const data: unknown = await res.json();
      if (!res.ok || !data || typeof data !== "object" || !("url" in data) || typeof data.url !== "string") {
        state.toast("Image upload failed", { danger: true });
        return;
      }
      const md = `![](${data.url})`;
      const at = area.selectionStart ?? this.draft.length;
      this.draft = this.draft.slice(0, at) + md + this.draft.slice(area.selectionEnd ?? at);
      this.requestUpdate();
      void this.updateComplete.then(() => {
        area.focus();
        area.selectionStart = area.selectionEnd = at + md.length;
      });
    } catch {
      state.toast("Image upload failed", { danger: true });
    }
  }

  private commitTitle(value: string): void {
    const card = this.card();
    const title = value.trim();
    if (card && title && title !== card.title) void state.updateCard(card.id, { title });
    this.editingTitle = false;
    this.requestUpdate();
  }

  render() {
    const card = this.card();
    const board = state.board;
    if (!card || !board) return nothing;
    const column = board.columns.find((c) => (board.order[c.id] ?? []).includes(card.id));

    return html`
      <div class="head">
        <span class="num">#${card.num}</span>
        <span class="spacer"></span>
        <button
          class="complete-btn ${card.completed ? "on" : ""}"
          @click=${() => void state.updateCard(card.id, { completed: !card.completed })}
        >
          ✓ ${card.completed ? "Completed" : "Complete"}
        </button>
        <button class="archive-btn" title="Archive card (restorable from board settings)" @click=${() => void state.archiveCard(card.id)}>
          ⌫ Archive
        </button>
        <button class="icon-btn" title="Close (Esc)" @click=${() => state.selectCard(null)}>✕</button>
      </div>

      <div class="body">
        <section>
          ${this.editingTitle
            ? html`<input
                class="title-input"
                .value=${card.title}
                @blur=${(e: FocusEvent) => {
                  const el = e.currentTarget;
                  if (el instanceof HTMLInputElement) this.commitTitle(el.value);
                }}
                @keydown=${(e: KeyboardEvent) => {
                  const el = e.currentTarget;
                  if (!(el instanceof HTMLInputElement)) return;
                  if (e.key === "Enter") this.commitTitle(el.value);
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    this.editingTitle = false;
                    this.requestUpdate();
                  }
                }}
              />`
            : html`<h2
                class="title ${card.completed ? "completed" : ""}"
                title="Click to edit"
                @click=${() => {
                  this.editingTitle = true;
                  this.requestUpdate();
                  void this.updateComplete.then(() => {
                    const el = this.renderRoot.querySelector("input.title-input");
                    if (el instanceof HTMLInputElement) {
                      el.focus();
                      el.select();
                    }
                  });
                }}
              >
                ${card.title}
              </h2>`}
        </section>

        <section>
          <div class="row">
            <span class="key">Column</span>
            <span>
              <select
                @change=${(e: Event) => {
                  const el = e.currentTarget;
                  if (el instanceof HTMLSelectElement)
                    void state.moveCard(card.id, el.value, (board.order[el.value] ?? []).length);
                }}
              >
                ${board.columns.map(
                  (c) => html`<option value=${c.id} ?selected=${column?.id === c.id}>${c.name}</option>`,
                )}
              </select>
            </span>
          </div>

          <div class="row">
            <span class="key">Labels</span>
            <span class="chips">
              ${board.labels.length === 0 ? html`<span style="font-size:12px;color:var(--fg-subtle)">none defined — add in board settings</span>` : nothing}
              ${board.labels.map((l) => {
                const on = card.labels.includes(l.id);
                return html`
                  <button
                    class="chip label-toggle ${on ? "on" : ""}"
                    title=${on ? `Remove label "${l.name}"` : `Add label "${l.name}"`}
                    style=${on ? `border-color:${tint(l.color, 0.6)};color:${l.color};background:${tint(l.color, 0.16)}` : ""}
                    @click=${() =>
                      void state.updateCard(card.id, {
                        labels: on ? card.labels.filter((x) => x !== l.id) : [...card.labels, l.id],
                      })}
                  >
                    ${on ? "✓" : "＋"} ${l.name}
                  </button>
                `;
              })}
            </span>
          </div>

          <div class="row">
            <span class="key">Size</span>
            <span class="seg">
              <button class=${card.size === null ? "on" : ""} @click=${() => void state.updateCard(card.id, { size: null })}>—</button>
              ${SIZES.map(
                (s) => html`
                  <button class=${card.size === s ? "on" : ""} @click=${() => void state.updateCard(card.id, { size: s })}>
                    ${s}
                  </button>
                `,
              )}
            </span>
          </div>

          <div class="row">
            <span class="key">Assignee</span>
            <span class="seg">
              ${([null, "user", "ai"] as const).map(
                (a) => html`
                  <button
                    class=${card.assignee === a ? "on" : ""}
                    @click=${() => void state.updateCard(card.id, { assignee: a })}
                  >
                    ${a === null ? "—" : a === "user" ? "● me" : "◆ ai"}
                  </button>
                `,
              )}
            </span>
          </div>

          <div class="row">
            <span class="key">Color</span>
            <kb-swatch
              .value=${card.color}
              allowNone
              @pick=${(e: CustomEvent<{ color: string | null }>) =>
                void state.updateCard(card.id, { color: e.detail.color })}
            ></kb-swatch>
          </div>

          <div class="row">
            <span class="key">Blocked</span>
            <span class="blocked-cell">
              <input
                class="blocked ${card.blocked ? "set" : ""}"
                placeholder="Reason (external blockers)…"
                .value=${card.blocked ?? ""}
                @change=${(e: Event) => {
                  const el = e.currentTarget;
                  if (el instanceof HTMLInputElement)
                    void state.updateCard(card.id, { blocked: el.value.trim() || null });
                }}
              />
              <span class="chips" style="margin-top:6px">
                ${card.blockedBy.map((id) => {
                  const blocker = state.card(id);
                  if (!blocker) return nothing;
                  const open = !blocker.completed && !blocker.archived;
                  return html`
                    <button
                      class="chip blocker-chip ${open ? "" : "resolved"}"
                      title="${blocker.title} — click to open · ✕ removes"
                      @click=${() => state.selectCard(blocker.id)}
                    >
                      ${open ? "⛔" : "✓"} #${blocker.num}
                      <span
                        class="chip-x"
                        title="Remove blocker"
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          void state.updateCard(card.id, {
                            blockedBy: card.blockedBy.filter((x) => x !== id),
                          });
                        }}
                        >✕</span
                      >
                    </button>
                  `;
                })}
                <input
                  class="blocker-add"
                  placeholder="+ blocker #"
                  title="Type a card number and press Enter"
                  @keydown=${(e: KeyboardEvent) => {
                    const el = e.currentTarget;
                    if (e.key !== "Enter" || !(el instanceof HTMLInputElement)) return;
                    const num = el.value.replace(/^#/, "").trim();
                    const target = Object.values(board.cards).find((c) => `${c.num}` === num);
                    if (target && target.id !== card.id) {
                      void state.updateCard(card.id, { blockedBy: [...card.blockedBy, target.id] });
                      el.value = "";
                    } else {
                      el.select();
                    }
                  }}
                />
              </span>
              ${state.blocksOf(card.id).length
                ? html`<div class="blocks-line">
                    blocks:
                    ${state.blocksOf(card.id).map(
                      (c) => html`<button class="chip" @click=${() => state.selectCard(c.id)}>#${c.num}</button>`,
                    )}
                  </div>`
                : nothing}
            </span>
          </div>
        </section>

        <section>
          <div class="desc-head">
            <span class="label">Description</span>
            <span class="spacer" style="flex:1"></span>
            ${this.editingBody
              ? nothing
              : html`<button class="ghost-btn" @click=${() => this.startBodyEdit()}>✎ Edit</button>`}
          </div>
          ${this.editingBody
            ? html`
                <textarea
                  class="editor"
                  .value=${this.draft}
                  @input=${(e: Event) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLTextAreaElement) this.draft = el.value;
                  }}
                  @paste=${(e: ClipboardEvent) => void this.pasteImage(e)}
                  @keydown=${(e: KeyboardEvent) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") this.commitBody();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      this.cancelBody();
                    }
                  }}
                ></textarea>
                <div class="editor-foot">
                  <span class="hint">markdown + task lists · paste images · ⌘⏎ save · Esc cancel</span>
                  <button class="ghost-btn" @click=${() => this.cancelBody()}>Cancel</button>
                  <button class="save-btn" @click=${() => this.commitBody()}>Save</button>
                </div>
              `
            : card.body.trim()
              ? html`<kb-markdown
                  .md=${card.body}
                  interactive
                  promotable
                  @task-toggle=${(e: CustomEvent<{ index: number; checked: boolean }>) =>
                    void state.toggleTask(card.id, e.detail.index, e.detail.checked)}
                  @task-promote=${(e: CustomEvent<{ index: number }>) =>
                    void state.promoteTask(card.id, e.detail.index)}
                  @card-ref=${(e: CustomEvent<{ num: number }>) => {
                    const target = Object.values(board.cards).find((c) => c.num === e.detail.num);
                    if (target) state.selectCard(target.id);
                  }}
                ></kb-markdown>`
              : html`<div class="empty-desc" @click=${() => this.startBodyEdit()}>
                  Add a description — it's the card's living document
                </div>`}
        </section>

        ${this.cardActivity().length
          ? html`
              <section>
                <div class="desc-head"><span class="label">Activity</span></div>
                ${this.cardActivity().map(
                  (a) => html`
                    <div class="act-row">
                      <span class="act-actor ${a.actor}">${a.actor === "ai" ? "◆" : "●"}</span>
                      <span class="act-summary">${a.summary}</span>
                      <span class="act-time">${relTime(a.at)}</span>
                    </div>
                  `,
                )}
              </section>
            `
          : nothing}
      </div>

      <div class="foot">
        <span>created ${relTime(card.createdAt)}</span>
        <span>updated ${relTime(card.updatedAt)}</span>
        ${card.completedAt ? html`<span>completed ${relTime(card.completedAt)}</span>` : nothing}
      </div>
    `;
  }
}

customElements.define("kb-panel", KbPanel);
