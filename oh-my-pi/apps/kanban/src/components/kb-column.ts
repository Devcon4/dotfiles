/* <kb-column .column=${Column}> — one board column: header (drag handle),
 * card list, inline footer composer. Subscribes to state directly.
 * Emits `column-drag` CustomEvent<{ event: PointerEvent; columnId: string }>.
 * Exposes insertionIndexAt() + listElement for the board's DnD orchestration. */

import { LitElement, css, html, nothing } from "lit";
import type { Column } from "../../store.ts";
import { base, tint } from "../shared.ts";
import { state, subscribe } from "../state.ts";
import "./kb-card.ts";

export class KbColumn extends LitElement {
  static properties = {
    column: { attribute: false },
  };

  declare column: Column | null;
  private composing = false;

  constructor() {
    super();
    this.column = null;
    subscribe(this);
  }

  static styles = [
    base,
    css`
      :host {
        display: flex;
        flex-direction: column;
        width: 320px;
        flex: none;
        border-right: 1px solid var(--border-muted);
        min-height: 0;
      }
      :host([data-col-dragging]) {
        opacity: 0.35;
      }
      header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        cursor: grab;
        user-select: none;
        flex: none;
      }
      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex: none;
      }
      .name {
        font-size: 13px;
        font-weight: 600;
      }
      .count {
        font-size: 12px;
        color: var(--fg-muted);
        font-variant-numeric: tabular-nums;
      }
      .count.over {
        color: var(--danger);
        font-weight: 600;
      }
      .done-tag {
        font-size: 10px;
        color: var(--success);
        border: 1px solid rgba(87, 171, 90, 0.4);
        border-radius: 2em;
        padding: 1px 6px;
      }
      .spacer {
        flex: 1;
      }
      .list {
        flex: 1;
        overflow-y: auto;
        padding: 2px 12px 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        scrollbar-width: thin;
        scrollbar-color: var(--border) transparent;
        min-height: 40px;
      }
      .empty {
        border: 1px dashed var(--border-muted);
        border-radius: var(--radius);
        color: var(--fg-subtle);
        font-size: 12px;
        text-align: center;
        padding: 14px 0;
      }
      .composer {
        padding: 6px 12px 12px;
        flex: none;
      }
      .composer textarea {
        width: 100%;
        resize: none;
        font-size: 13px;
        min-height: 54px;
        background: var(--surface);
      }
      .composer .hint {
        font-size: 11px;
        color: var(--fg-subtle);
        margin-top: 4px;
      }
      .add-btn {
        width: 100%;
        justify-content: flex-start;
        border: none;
        color: var(--fg-subtle);
      }
      .add-btn:hover {
        border: none;
      }
    `,
  ];

  /** Card list container (for edge-scroll during drag). */
  get listElement(): HTMLElement | null {
    return this.renderRoot.querySelector(".list");
  }

  /** Insertion index for a pointer at clientY, ignoring the dragged card. */
  insertionIndexAt(clientY: number, excludeId: string): number {
    const cards = this.renderRoot.querySelectorAll<HTMLElement>("kb-card");
    let index = 0;
    for (const el of cards) {
      const id = el.dataset.cardId;
      if (!id || id === excludeId) continue;
      const rect = el.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) index++;
    }
    return index;
  }

  openComposer(): void {
    this.composing = true;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      const area = this.renderRoot.querySelector("textarea");
      area?.focus();
      area?.scrollIntoView({ block: "nearest" });
    });
  }

  private closeComposer(): void {
    this.composing = false;
    this.requestUpdate();
  }

  private composerKey(e: KeyboardEvent): void {
    const area = e.currentTarget;
    if (!(area instanceof HTMLTextAreaElement)) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const title = area.value.trim();
      if (title && this.column) {
        void state.addCard(this.column.id, title);
        area.value = "";
      }
    } else if (e.key === "Escape") {
      e.stopPropagation();
      this.closeComposer();
    }
  }

  private headerPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.column) return;
    const target = e.composedPath()[0];
    if (target instanceof Element && target.closest("button")) return;
    this.dispatchEvent(
      new CustomEvent("column-drag", {
        detail: { event: e, columnId: this.column.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const col = this.column;
    const board = state.board;
    if (!col || !board) return nothing;
    const ids = state.orderFor(col.id);
    const visible = ids.filter((id) => state.matchesFilter(board.cards[id]));
    const total = (board.order[col.id] ?? []).length;
    const over = col.wip > 0 && total > col.wip;

    return html`
      <header @pointerdown=${this.headerPointerDown} title="Drag to reorder column">
        <span class="dot" style="background:${col.color};box-shadow:0 0 0 3px ${tint(col.color, 0.15)}"></span>
        <span class="name">${col.name}</span>
        <span class="count ${over ? "over" : ""}" title=${col.wip > 0 ? `WIP limit ${col.wip}` : ""}>
          ${state.filterActive()
            ? `${visible.length} of ${total}`
            : col.wip > 0
              ? `${total}/${col.wip}`
              : total}
        </span>
        ${col.done ? html`<span class="done-tag">✓ done</span>` : nothing}
        <span class="spacer"></span>
        <button class="icon-btn" title="Add card" @click=${this.openComposer}>+</button>
      </header>

      <div class="list">
        ${visible.length === 0 && !state.drag
          ? html`<div class="empty">${total > 0 ? "No matches" : "No cards"}</div>`
          : nothing}
        ${visible.map((id) => {
          const card = board.cards[id];
          return html`
            <kb-card
              data-card-id=${id}
              .card=${card}
              .labels=${board.labels}
              ?selected=${state.selected === id}
              ?cursor=${state.cursor === id && state.selected !== id}
              ?placeholder=${state.drag?.cardId === id}
              @card-open=${() => {
                state.cursor = id;
                state.selectCard(id);
              }}
            ></kb-card>
          `;
        })}
      </div>

      <div class="composer">
        ${this.composing
          ? html`
              <textarea
                placeholder="Card title…"
                @keydown=${this.composerKey}
                @blur=${(e: FocusEvent) => {
                  const area = e.currentTarget;
                  if (area instanceof HTMLTextAreaElement && !area.value.trim()) this.closeComposer();
                }}
              ></textarea>
              <div class="hint">Enter to add · #label !size @me ^column · Esc to close</div>
            `
          : html`<button class="ghost-btn add-btn" @click=${this.openComposer}>＋ Add card</button>`}
      </div>
    `;
  }
}

customElements.define("kb-column", KbColumn);
