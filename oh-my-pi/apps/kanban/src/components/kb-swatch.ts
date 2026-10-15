/* <kb-swatch .value=${string|null} ?allowNone> — palette picker row.
 * Emits `pick` CustomEvent<{ color: string | null }>. */

import { LitElement, css, html } from "lit";
import { PALETTE, base } from "../shared.ts";

export class KbSwatch extends LitElement {
  static properties = {
    value: { type: String },
    allowNone: { type: Boolean },
  };

  declare value: string | null;
  declare allowNone: boolean;

  constructor() {
    super();
    this.value = null;
    this.allowNone = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: inline-flex;
        gap: 5px;
        flex-wrap: wrap;
      }
      button {
        width: 18px;
        height: 18px;
        border-radius: 5px;
        border: 1px solid transparent;
        position: relative;
      }
      button:hover {
        transform: scale(1.15);
      }
      button.on {
        outline: 2px solid var(--fg);
        outline-offset: 1px;
      }
      button.none {
        border-color: var(--border);
        background:
          linear-gradient(to top right, transparent 44%, var(--danger) 46%, var(--danger) 54%, transparent 56%),
          var(--surface);
      }
    `,
  ];

  private pick(color: string | null): void {
    this.dispatchEvent(new CustomEvent("pick", { detail: { color }, bubbles: true, composed: true }));
  }

  render() {
    return html`
      ${this.allowNone
        ? html`<button
            class="none ${this.value === null ? "on" : ""}"
            title="No color"
            @click=${() => this.pick(null)}
          ></button>`
        : null}
      ${PALETTE.map(
        (c) => html`
          <button
            class=${this.value === c ? "on" : ""}
            style="background:${c}"
            title=${c}
            @click=${() => this.pick(c)}
          ></button>
        `,
      )}
    `;
  }
}

customElements.define("kb-swatch", KbSwatch);
