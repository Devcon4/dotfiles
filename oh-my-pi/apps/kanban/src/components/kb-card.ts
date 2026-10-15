/* <kb-card .card=${Card} .labels=${Label[]}> — the board card face.
 * Attributes: selected / cursor / placeholder / ghost (styling states).
 * Emits: `card-open` (click), `card-drag` CustomEvent<{ event: PointerEvent }>
 * (pointerdown outside interactive children). */

import { LitElement, css, html, nothing } from "lit";
import type { Card, Label } from "../../store.ts";
import { hasMockup, taskStats } from "../../tasks.ts";
import { base, tint } from "../shared.ts";
import { state } from "../state.ts";

export class KbCard extends LitElement {
  static properties = {
    card: { attribute: false },
    labels: { attribute: false },
    selected: { type: Boolean, reflect: true },
    cursor: { type: Boolean, reflect: true },
    placeholder: { type: Boolean, reflect: true },
    ghost: { type: Boolean, reflect: true },
  };

  declare card: Card | null;
  declare labels: Label[];
  declare selected: boolean;
  declare cursor: boolean;
  declare placeholder: boolean;
  declare ghost: boolean;

  constructor() {
    super();
    this.card = null;
    this.labels = [];
    this.selected = false;
    this.cursor = false;
    this.placeholder = false;
    this.ghost = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
      }
      .card {
        position: relative;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 8px 10px 9px;
        cursor: pointer;
        transition: border-color 80ms ease, background 80ms ease;
      }
      .card.tinted {
        border-left: 3px solid var(--card-accent);
        padding-left: 8px;
      }
      .card:hover {
        background: var(--surface-2);
        border-color: var(--fg-subtle);
      }
      :host([selected]) .card,
      :host([cursor]) .card {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent);
      }
      :host([placeholder]) .card {
        opacity: 0.3;
        border-style: dashed;
        background: transparent;
      }
      :host([ghost]) {
        pointer-events: none;
      }
      :host([ghost]) .card {
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        transform: rotate(1.5deg);
        background: var(--surface-2);
      }

      .title-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .num {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--fg-subtle);
        flex: none;
      }
      .title {
        font-size: 13px;
        font-weight: 500;
        line-height: 1.35;
        flex: 1;
        min-width: 0;
      }
      .done-check {
        flex: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 1px solid var(--border);
        color: transparent;
        font-size: 10px;
        line-height: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        align-self: center;
        opacity: 0;
        transition: opacity 80ms ease;
      }
      .card:hover .done-check {
        opacity: 1;
      }
      .done-check:hover {
        border-color: var(--success);
        color: var(--success);
      }
      :host([data-completed]) .done-check {
        opacity: 1;
        background: var(--success);
        border-color: var(--success);
        color: #0d1117;
      }
      :host([data-completed]) .title {
        color: var(--fg-muted);
        text-decoration: line-through;
        text-decoration-color: var(--fg-subtle);
      }
      :host([data-completed]) .card {
        opacity: 0.62;
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 7px;
        align-items: center;
      }
      .chips:empty {
        display: none;
      }
      .meta-chip {
        border-color: var(--border);
        color: var(--fg-muted);
        background: transparent;
      }
      .blocked-chip {
        border-color: ${css`rgba(210, 153, 34, 0.5)`};
        color: var(--warn);
        background: rgba(210, 153, 34, 0.12);
      }
      .blocked-note {
        margin-top: 6px;
        font-size: 11px;
        line-height: 1.4;
        color: var(--warn);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `,
  ];

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || !this.card) return;
    const target = e.composedPath()[0];
    if (target instanceof Element && target.closest("button, a, input")) return;
    this.dispatchEvent(
      new CustomEvent("card-drag", {
        detail: { event: e, cardId: this.card.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private onClick(e: MouseEvent): void {
    const target = e.composedPath()[0];
    if (target instanceof Element && target.closest("button, a, input")) return;
    this.dispatchEvent(new CustomEvent("card-open", { bubbles: true, composed: true }));
  }

  render() {
    const card = this.card;
    if (!card) return nothing;
    this.toggleAttribute("data-completed", card.completed);
    const labelDefs = card.labels
      .map((id) => this.labels.find((l) => l.id === id))
      .filter((l): l is Label => !!l);
    const tasks = taskStats(card.body);
    const style = card.color ? `--card-accent:${card.color}` : "";
    const blocked = state.isBlockedCard(card);
    const blockedText = card.blocked
      ? card.blocked
      : card.blockedBy.length
        ? `blocked by ${card.blockedBy
            .map((id) => this.card && state.card(id))
            .filter((c): c is Card => !!c && !c.completed && !c.archived)
            .map((c) => `#${c.num}`)
            .join(", ")}`
        : "";

    return html`
      <div
        class="card ${card.color ? "tinted" : ""}"
        style=${style}
        @pointerdown=${this.onPointerDown}
        @click=${this.onClick}
      >
        <div class="title-row">
          <span class="num">#${card.num}</span>
          <span class="title">${card.title}</span>
          <button
            class="done-check"
            title=${card.completed ? "Mark incomplete" : "Mark complete"}
            @click=${() => void state.updateCard(card.id, { completed: !card.completed })}
          >
            ✓
          </button>
        </div>
        <div class="chips">
          ${blocked ? html`<span class="chip blocked-chip">⛔ blocked</span>` : nothing}
          ${labelDefs.map(
            (l) => html`
              <span class="chip" style="border-color:${tint(l.color, 0.55)};color:${l.color};background:${tint(l.color, 0.14)}">
                ${l.name}
              </span>
            `,
          )}
          ${card.size ? html`<span class="chip meta-chip">${card.size}</span>` : nothing}
          ${card.assignee
            ? html`<span
                class="chip"
                style=${card.assignee === "ai"
                  ? `border-color:${tint("#986ee2", 0.55)};color:#bf91f3;background:${tint("#986ee2", 0.12)}`
                  : `border-color:${tint("#539bf5", 0.55)};color:#6cb6ff;background:${tint("#539bf5", 0.12)}`}
                >${card.assignee === "ai" ? "◆ ai" : "● me"}</span
              >`
            : nothing}
          ${hasMockup(card.body)
            ? html`<span class="chip meta-chip" title="Has a live HTML mockup">🖼 mockup</span>`
            : nothing}
          ${tasks.total > 0
            ? html`<span class="chip meta-chip" title="${tasks.done}/${tasks.total} tasks">
                ▣ ${tasks.done}/${tasks.total}
              </span>`
            : nothing}
        </div>
        ${blocked
          ? html`<div class="blocked-note" title=${blockedText}>${blockedText}</div>`
          : nothing}
      </div>
    `;
  }
}

customElements.define("kb-card", KbCard);
