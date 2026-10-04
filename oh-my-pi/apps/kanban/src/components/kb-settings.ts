/* <kb-settings> — board settings side panel: name, accent, columns
 * (rename / recolor / WIP / done-flag / reorder / add / delete), labels
 * (rename / recolor / add / delete). Immediate-apply; the server refuses
 * deleting a non-empty column and the failure surfaces as a toast. */

import { LitElement, css, html, nothing } from "lit";
import type { Column, Label } from "../../store.ts";
import { PALETTE, base, slugifyId } from "../shared.ts";
import { state, subscribe } from "../state.ts";
import "./kb-swatch.ts";

export class KbSettings extends LitElement {
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
        width: 420px;
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
      .head .label {
        font-size: 12px;
        font-weight: 600;
        color: var(--fg-muted);
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .spacer {
        flex: 1;
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
      h3 {
        margin: 0 0 10px;
        font-size: 12px;
        font-weight: 600;
        color: var(--fg-muted);
        text-transform: uppercase;
        letter-spacing: 0.4px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 0;
      }
      .row + .row {
        border-top: 1px solid var(--border-muted);
      }
      .dot-btn {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        flex: none;
        border: 1px solid rgba(255, 255, 255, 0.25);
      }
      .dot-btn:hover {
        transform: scale(1.2);
      }
      input.name {
        flex: 1;
        min-width: 0;
        font-size: 13px;
        background: transparent;
        border-color: transparent;
        padding: 3px 6px;
      }
      input.name:hover {
        border-color: var(--border);
      }
      input.name:focus-visible {
        background: var(--surface);
      }
      .wip-wrap {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        flex: none;
      }
      .wip-label {
        font-size: 10px;
        color: var(--fg-subtle);
        letter-spacing: 0.4px;
      }
      input.wip {
        width: 44px;
        font-size: 12px;
        padding: 3px 6px;
        background: var(--surface);
        text-align: center;
      }
      textarea.brief-editor {
        width: 100%;
        min-height: 110px;
        font-size: 12.5px;
        background: var(--surface);
        resize: vertical;
        font-family: var(--mono);
      }
      .mini {
        font-size: 11px;
        color: var(--fg-subtle);
      }
      .done-toggle {
        font-size: 11px;
        padding: 2px 8px;
        border: 1px solid var(--border);
        border-radius: 2em;
        color: var(--fg-subtle);
      }
      .done-toggle.on {
        border-color: var(--success);
        color: var(--success);
        background: ${css`rgba(87, 171, 90, 0.12)`};
      }
      .arrows button {
        color: var(--fg-subtle);
        width: 18px;
      }
      .arrows button:hover {
        color: var(--fg);
      }
      .del:hover {
        color: var(--danger);
      }
      .add-row {
        display: flex;
        gap: 6px;
        margin-top: 10px;
      }
      .add-row input {
        flex: 1;
        font-size: 12px;
        background: var(--surface);
      }
      .board-name {
        width: 100%;
        font-size: 14px;
        background: var(--surface);
        margin-bottom: 10px;
      }
      .danger-zone button {
        color: var(--fg-muted);
        font-size: 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 5px 12px;
      }
      .danger-zone button:hover {
        border-color: var(--danger);
        color: var(--danger);
      }
    `,
  ];

  private saveColumns(columns: Column[]): void {
    void state.patchBoard({ columns });
  }

  private saveLabels(labels: Label[]): void {
    void state.patchBoard({ labels });
  }

  private addColumn(name: string): void {
    const board = state.board;
    const trimmed = name.trim();
    if (!board || !trimmed) return;
    let id = slugifyId(trimmed);
    while (board.columns.some((c) => c.id === id)) id = `${id}-2`;
    this.saveColumns([
      ...board.columns,
      { id, name: trimmed, color: PALETTE[board.columns.length % PALETTE.length], wip: 0, done: false },
    ]);
  }

  private addLabel(name: string): void {
    const board = state.board;
    const trimmed = name.trim();
    if (!board || !trimmed) return;
    let id = slugifyId(trimmed);
    while (board.labels.some((l) => l.id === id)) id = `${id}-2`;
    this.saveLabels([
      ...board.labels,
      { id, name: trimmed, color: PALETTE[board.labels.length % PALETTE.length] },
    ]);
  }

  private cycleColor(current: string): string {
    const i = PALETTE.findIndex((c) => c === current);
    return PALETTE[(i + 1) % PALETTE.length];
  }

  render() {
    const board = state.board;
    if (!board) return nothing;

    return html`
      <div class="head">
        <span class="label">Board settings</span>
        <span class="spacer"></span>
        <button class="icon-btn" title="Close (Esc)" @click=${() => state.toggleSettings(false)}>✕</button>
      </div>

      <div class="body">
        <section>
          <h3>Board</h3>
          <input
            class="board-name"
            .value=${board.name}
            @change=${(e: Event) => {
              const el = e.currentTarget;
              if (el instanceof HTMLInputElement && el.value.trim())
                void state.patchBoard({ name: el.value.trim() });
            }}
          />
          <div class="row" style="border:none">
            <span class="mini" style="width:78px">Accent</span>
            <kb-swatch
              .value=${board.accent}
              @pick=${(e: CustomEvent<{ color: string | null }>) => {
                if (e.detail.color) void state.patchBoard({ accent: e.detail.color });
              }}
            ></kb-swatch>
          </div>
        </section>

        <section>
          <h3>Brief</h3>
          <div class="mini" style="margin-bottom:8px">
            Standing context shown atop the board — conventions, current focus, definition of done.
            The AI reads it at session start.
          </div>
          <textarea
            class="brief-editor"
            placeholder="Markdown brief…"
            .value=${board.brief}
            @change=${(e: Event) => {
              const el = e.currentTarget;
              if (el instanceof HTMLTextAreaElement) void state.patchBoard({ brief: el.value });
            }}
          ></textarea>
        </section>

        <section>
          <h3>Columns</h3>
          ${board.columns.map((col, i) => {
            const count = (board.order[col.id] ?? []).length;
            return html`
              <div class="row">
                <button
                  class="dot-btn"
                  style="background:${col.color}"
                  title="Cycle color"
                  @click=${() =>
                    this.saveColumns(board.columns.map((c) => (c.id === col.id ? { ...c, color: this.cycleColor(c.color) } : c)))}
                ></button>
                <input
                  class="name"
                  .value=${col.name}
                  @change=${(e: Event) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLInputElement && el.value.trim())
                      this.saveColumns(board.columns.map((c) => (c.id === col.id ? { ...c, name: el.value.trim() } : c)));
                  }}
                />
                <span class="wip-wrap" title="WIP limit — max cards in this column (0 = no limit)">
                  <span class="wip-label">WIP</span>
                  <input
                    class="wip"
                    type="number"
                    min="0"
                    .value=${String(col.wip)}
                  @change=${(e: Event) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLInputElement)
                      this.saveColumns(
                        board.columns.map((c) => (c.id === col.id ? { ...c, wip: Math.max(0, Number(el.value) || 0) } : c)),
                      );
                  }}
                  />
                </span>
                <button
                  class="done-toggle ${col.done ? "on" : ""}"
                  title="Cards moved here auto-complete"
                  @click=${() =>
                    this.saveColumns(board.columns.map((c) => (c.id === col.id ? { ...c, done: !c.done } : c)))}
                >
                  ✓ done
                </button>
                <span class="arrows">
                  <button
                    ?disabled=${i === 0}
                    @click=${() => {
                      const cols = [...board.columns];
                      [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
                      this.saveColumns(cols);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    ?disabled=${i === board.columns.length - 1}
                    @click=${() => {
                      const cols = [...board.columns];
                      [cols[i], cols[i + 1]] = [cols[i + 1], cols[i]];
                      this.saveColumns(cols);
                    }}
                  >
                    ↓
                  </button>
                </span>
                <button
                  class="icon-btn del"
                  title=${count > 0 ? `${count} cards — move them first` : "Delete column"}
                  @click=${() => this.saveColumns(board.columns.filter((c) => c.id !== col.id))}
                >
                  ✕
                </button>
              </div>
            `;
          })}
          <div class="add-row">
            <input
              placeholder="New column…"
              @keydown=${(e: KeyboardEvent) => {
                const el = e.currentTarget;
                if (e.key === "Enter" && el instanceof HTMLInputElement) {
                  this.addColumn(el.value);
                  el.value = "";
                }
              }}
            />
          </div>
        </section>

        <section>
          <h3>Labels</h3>
          ${board.labels.map(
            (label) => html`
              <div class="row">
                <button
                  class="dot-btn"
                  style="background:${label.color}"
                  title="Cycle color"
                  @click=${() =>
                    this.saveLabels(
                      board.labels.map((l) => (l.id === label.id ? { ...l, color: this.cycleColor(l.color) } : l)),
                    )}
                ></button>
                <input
                  class="name"
                  .value=${label.name}
                  @change=${(e: Event) => {
                    const el = e.currentTarget;
                    if (el instanceof HTMLInputElement && el.value.trim())
                      this.saveLabels(board.labels.map((l) => (l.id === label.id ? { ...l, name: el.value.trim() } : l)));
                  }}
                />
                <span class="mini">${Object.values(board.cards).filter((c) => !c.archived && c.labels.includes(label.id)).length} cards</span>
                <button
                  class="icon-btn del"
                  title="Delete label (removed from all cards)"
                  @click=${() => this.saveLabels(board.labels.filter((l) => l.id !== label.id))}
                >
                  ✕
                </button>
              </div>
            `,
          )}
          <div class="add-row">
            <input
              placeholder="New label…"
              @keydown=${(e: KeyboardEvent) => {
                const el = e.currentTarget;
                if (e.key === "Enter" && el instanceof HTMLInputElement) {
                  this.addLabel(el.value);
                  el.value = "";
                }
              }}
            />
          </div>
        </section>

        ${Object.values(board.cards).some((c) => c.archived)
          ? html`
              <section>
                <h3>Archived cards</h3>
                ${Object.values(board.cards)
                  .filter((c) => c.archived)
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .map(
                    (c) => html`
                      <div class="row">
                        <span class="mini" style="font-family:var(--mono)">#${c.num}</span>
                        <span style="flex:1;font-size:13px;color:var(--fg-muted)">${c.title}</span>
                        <button class="done-toggle" @click=${() => void state.restoreCard(c.id)}>restore</button>
                      </div>
                    `,
                  )}
              </section>
            `
          : nothing}

        <section class="danger-zone">
          <h3>Danger zone</h3>
          <button
            @click=${async () => {
              await state.patchBoard({ archived: true });
              state.navigate(`/${state.project}/`);
            }}
          >
            Archive board
          </button>
          <div class="mini" style="margin-top:6px">Archived boards are restorable from the homepage.</div>
        </section>
      </div>
    `;
  }
}

customElements.define("kb-settings", KbSettings);
