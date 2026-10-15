/* <kb-board> — the column strip + drag-and-drop orchestration.
 *
 * Card drag: kb-card emits `card-drag` on pointerdown; trackDrag() runs the
 * pointer lifecycle. During the drag we only mutate state.drag (a pure
 * preview); lit re-renders columns from orderFor(), so the DOM stays
 * lit-owned. Drop commits via state.moveCard. Column drag mirrors this
 * with state.columnDrag and a PATCH of the column array on drop. */

import { LitElement, css, html, nothing } from "lit";
import { edgeScroll, trackDrag } from "../dnd.ts";
import { base } from "../shared.ts";
import { state, subscribe } from "../state.ts";
import { KbCard } from "./kb-card.ts";
import type { KbColumn } from "./kb-column.ts";
import "./kb-column.ts";

export class KbBoard extends LitElement {
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
        min-width: 0;
        position: relative;
      }
      .strip {
        display: flex;
        height: 100%;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--border) transparent;
      }
      .ghost-layer {
        position: fixed;
        left: 0;
        top: 0;
        z-index: 50;
        pointer-events: none;
      }
      .col-ghost {
        background: var(--surface);
        border: 1px solid var(--accent);
        border-radius: var(--radius);
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      }
    `,
  ];

  private ghostEl: HTMLElement | null = null;

  private columns(): KbColumn[] {
    return [...this.renderRoot.querySelectorAll<KbColumn>("kb-column")];
  }

  private columnUnder(x: number): KbColumn | null {
    for (const col of this.columns()) {
      const r = col.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return col;
    }
    // Off the strip: clamp to nearest end column.
    const cols = this.columns();
    if (cols.length === 0) return null;
    return x < cols[0].getBoundingClientRect().left ? cols[0] : cols[cols.length - 1];
  }

  private placeGhost(e: PointerEvent, dx: number, dy: number): void {
    if (this.ghostEl) this.ghostEl.style.transform = `translate(${e.clientX - dx}px, ${e.clientY - dy}px)`;
  }

  // --- card drag -------------------------------------------------------------

  private onCardDrag(e: CustomEvent<{ event: PointerEvent; cardId: string }>): void {
    const board = state.board;
    if (!board || state.filterActive()) return;
    const { cardId } = e.detail;
    const fromColumn = board.columns.find((c) => (board.order[c.id] ?? []).includes(cardId))?.id;
    if (!fromColumn) return;

    // Size/anchor the ghost from the grabbed card face (composedPath sees
    // through the column's shadow boundary; e.target does not).
    const down = e.detail.event;
    const face = e.composedPath().find((n): n is KbCard => n instanceof KbCard);
    const rect = face?.getBoundingClientRect() ?? new DOMRect(down.clientX - 150, down.clientY - 20, 300, 40);
    const grabX = down.clientX - rect.left;
    const grabY = down.clientY - rect.top;

    trackDrag(down, {
      onStart: () => {
        const startIndex = (board.order[fromColumn] ?? []).indexOf(cardId);
        state.drag = { cardId, fromColumn, toColumn: fromColumn, toIndex: startIndex };
        state.emit();

        const ghost = new KbCard();
        ghost.card = board.cards[cardId];
        ghost.labels = board.labels;
        ghost.ghost = true;
        ghost.style.width = `${rect.width}px`;
        this.ghostLayer()?.appendChild(ghost);
        this.ghostEl = ghost;
        this.placeGhost(down, grabX, grabY);
        document.body.style.cursor = "grabbing";
      },
      onMove: (ev) => {
        this.placeGhost(ev, grabX, grabY);
        const strip = this.renderRoot.querySelector(".strip");
        if (strip) edgeScroll(strip, ev.clientX, ev.clientY, { axis: "x" });
        const col = this.columnUnder(ev.clientX);
        if (!col?.column) return;
        if (col.listElement) edgeScroll(col.listElement, ev.clientX, ev.clientY, { axis: "y" });
        const drag = state.drag;
        if (!drag) return;
        const index = col.insertionIndexAt(ev.clientY, cardId);
        if (drag.toColumn !== col.column.id || drag.toIndex !== index) {
          state.drag = { ...drag, toColumn: col.column.id, toIndex: index };
          state.emit();
        }
      },
      onDrop: () => {
        const drag = state.drag;
        this.endDrag();
        if (drag) void state.moveCard(drag.cardId, drag.toColumn, drag.toIndex);
      },
      onCancel: (started) => {
        this.endDrag();
        if (!started) return; // plain click — kb-card's click handler opens the panel
      },
    });
  }

  private endDrag(): void {
    state.drag = null;
    state.columnDrag = null;
    this.ghostEl?.remove();
    this.ghostEl = null;
    document.body.style.cursor = "";
    state.emit();
  }

  // --- column drag ---------------------------------------------------------------

  private onColumnDrag(e: CustomEvent<{ event: PointerEvent; columnId: string }>): void {
    const board = state.board;
    if (!board) return;
    const { columnId } = e.detail;
    const down = e.detail.event;

    trackDrag(down, {
      onStart: () => {
        const index = board.columns.findIndex((c) => c.id === columnId);
        state.columnDrag = { columnId, toIndex: index };
        state.emit();
        const ghost = document.createElement("div");
        ghost.className = "col-ghost";
        ghost.textContent = board.columns.find((c) => c.id === columnId)?.name ?? "";
        this.ghostLayer()?.appendChild(ghost);
        this.ghostEl = ghost;
        this.placeGhost(down, 20, 20);
        document.body.style.cursor = "grabbing";
      },
      onMove: (ev) => {
        this.placeGhost(ev, 20, 20);
        const strip = this.renderRoot.querySelector(".strip");
        if (strip) edgeScroll(strip, ev.clientX, ev.clientY, { axis: "x" });
        const cd = state.columnDrag;
        if (!cd) return;
        let index = 0;
        for (const col of this.columns()) {
          if (col.column?.id === columnId) continue;
          const r = col.getBoundingClientRect();
          if (ev.clientX > r.left + r.width / 2) index++;
        }
        if (index !== cd.toIndex) {
          state.columnDrag = { ...cd, toIndex: index };
          state.emit();
        }
      },
      onDrop: () => {
        const cd = state.columnDrag;
        const columns = state.columnsView();
        this.endDrag();
        if (cd) void state.patchBoard({ columns });
      },
      onCancel: () => this.endDrag(),
    });
  }

  private ghostLayer(): HTMLElement | null {
    return this.renderRoot.querySelector(".ghost-layer");
  }

  render() {
    const board = state.board;
    if (!board) return nothing;
    return html`
      <div class="strip" @card-drag=${this.onCardDrag} @column-drag=${this.onColumnDrag}>
        ${state.columnsView().map(
          (col) => html`
            <kb-column
              .column=${col}
              ?data-col-dragging=${state.columnDrag?.columnId === col.id}
            ></kb-column>
          `,
        )}
      </div>
      <div class="ghost-layer"></div>
    `;
  }
}

customElements.define("kb-board", KbBoard);
