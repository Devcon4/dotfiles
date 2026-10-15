/* <kb-filter> — the board filter row: text search, label chips, assignee
 * segmented control, hide-done toggle. All state lives in state.filter. */

import { LitElement, css, html, nothing } from "lit";
import { base, tint } from "../shared.ts";
import { state, subscribe } from "../state.ts";

export class KbFilter extends LitElement {
  constructor() {
    super();
    subscribe(this);
  }

  static styles = [
    base,
    css`
      :host {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border-muted);
        flex-wrap: wrap;
      }
      input.search {
        width: 240px;
        height: 28px;
        font-size: 12px;
        background: var(--surface);
      }
      .labels {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        align-items: center;
      }
      .chip {
        cursor: pointer;
        height: 20px;
        background: transparent;
        border-color: var(--border);
        color: var(--fg-muted);
      }
      .seg {
        display: inline-flex;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
      }
      .seg button {
        font-size: 11px;
        padding: 4px 9px;
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
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--fg-muted);
        cursor: pointer;
        user-select: none;
      }
      .toggle .track {
        width: 26px;
        height: 15px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: var(--surface);
        position: relative;
        transition: background 120ms ease;
      }
      .toggle .track::after {
        content: "";
        position: absolute;
        top: 1px;
        left: 1px;
        width: 11px;
        height: 11px;
        border-radius: 50%;
        background: var(--fg-muted);
        transition: transform 120ms ease, background 120ms ease;
      }
      .toggle.on .track {
        background: ${css`rgba(87, 171, 90, 0.25)`};
        border-color: var(--success);
      }
      .toggle.on .track::after {
        transform: translateX(11px);
        background: var(--success);
      }
      .clear {
        font-size: 12px;
        color: var(--fg-muted);
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .clear:hover {
        color: var(--fg);
      }
      .spacer {
        flex: 1;
      }
      .hint {
        font-size: 11px;
        color: var(--fg-subtle);
      }
    `,
  ];

  focusInput(): void {
    this.renderRoot.querySelector("input")?.focus();
  }

  render() {
    const board = state.board;
    if (!board) return nothing;
    const f = state.filter;

    return html`
      <input
        class="search"
        type="search"
        placeholder="Filter cards…  ( / )"
        .value=${f.text}
        @input=${(e: Event) => {
          const el = e.currentTarget;
          if (el instanceof HTMLInputElement) state.setFilter({ text: el.value });
        }}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            state.setFilter({ text: "" });
            (e.currentTarget instanceof HTMLElement) && e.currentTarget.blur();
          }
        }}
      />

      <span class="labels">
        ${board.labels.map((l) => {
          const on = f.labels.includes(l.id);
          return html`
            <button
              class="chip"
              style=${on ? `border-color:${tint(l.color, 0.6)};color:${l.color};background:${tint(l.color, 0.16)}` : ""}
              @click=${() =>
                state.setFilter({
                  labels: on ? f.labels.filter((x) => x !== l.id) : [...f.labels, l.id],
                })}
            >
              ${l.name}
            </button>
          `;
        })}
      </span>

      <span class="seg">
        ${(["", "user", "ai"] as const).map(
          (a) => html`
            <button class=${f.assignee === a ? "on" : ""} @click=${() => state.setFilter({ assignee: a })}>
              ${a === "" ? "all" : a === "user" ? "me" : "ai"}
            </button>
          `,
        )}
      </span>

      <label class="toggle ${f.hideDone ? "on" : ""}" @click=${() => state.setFilter({ hideDone: !f.hideDone })}>
        <span class="track"></span> hide done
      </label>

      ${state.filterActive()
        ? html`<button class="clear" @click=${() => state.setFilter({ text: "", labels: [], assignee: "", hideDone: false })}>
            clear
          </button>
          <span class="hint">drag disabled while filtering</span>`
        : nothing}
      <span class="spacer"></span>
    `;
  }
}

customElements.define("kb-filter", KbFilter);
