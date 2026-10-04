/* <kb-toast> — bottom-center toast stack with optional action (Undo).
 * Renders state.toasts; no imperative API. */

import { LitElement, css, html } from "lit";
import { base } from "../shared.ts";
import { state, subscribe } from "../state.ts";

export class KbToast extends LitElement {
  constructor() {
    super();
    subscribe(this);
  }

  static styles = [
    base,
    css`
      :host {
        position: fixed;
        bottom: 18px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
        pointer-events: none;
      }
      .toast {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        padding: 8px 12px;
        font-size: 13px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        animation: rise 160ms ease;
      }
      .toast.danger {
        border-left: 3px solid var(--danger);
      }
      @keyframes rise {
        from {
          opacity: 0;
          transform: translateY(6px);
        }
      }
      .action {
        color: var(--accent);
        font-weight: 600;
      }
      .action:hover {
        text-decoration: underline;
      }
      .close {
        color: var(--fg-subtle);
      }
      .close:hover {
        color: var(--fg);
      }
    `,
  ];

  render() {
    return html`
      ${state.toasts.map(
        (t) => html`
          <div class="toast ${t.danger ? "danger" : ""}">
            <span>${t.message}</span>
            ${t.action
              ? html`<button
                  class="action"
                  @click=${() => {
                    t.action?.run();
                    state.dismissToast(t.id);
                  }}
                >
                  ${t.action.label}
                </button>`
              : null}
            <button class="close" @click=${() => state.dismissToast(t.id)}>✕</button>
          </div>
        `,
      )}
    `;
  }
}

customElements.define("kb-toast", KbToast);
