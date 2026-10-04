import { LitElement, css, html } from "lit";
import { base } from "../shared.ts";
import { state, subscribe } from "../state.ts";

export class KbProjects extends LitElement {
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
      .project-row {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 16px 12px;
        border-bottom: 1px solid var(--border-muted);
        cursor: pointer;
        border-radius: var(--radius);
        transition: background 0.12s;
      }
      .project-row:hover {
        background: var(--surface);
      }
      .grow {
        flex: 1;
        min-width: 0;
      }
      .name {
        font-size: 15px;
        font-weight: 600;
        color: var(--fg);
        display: block;
      }
      .root {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--fg-subtle);
        display: block;
        margin-top: 2px;
      }
      .badge {
        font-size: 12px;
        color: var(--fg-muted);
        padding: 4px 10px;
        border-radius: 12px;
        background: var(--surface-2);
        border: 1px solid var(--border-muted);
      }
      .empty {
        padding: 48px 0;
        text-align: center;
        color: var(--fg-muted);
        font-size: 13px;
        line-height: 1.6;
      }
      code {
        font-family: var(--mono);
        font-size: 12px;
        background: var(--surface-2);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }
    `,
  ];

  render() {
    const list = state.projects;

    return html`
      <div class="wrap">
        <header>
          <h1>Projects</h1>
          <span class="sub">
            Repositories opted into kanban · ${list.length} project${list.length === 1 ? "" : "s"}
          </span>
        </header>

        ${list.length === 0
          ? html`
              <div class="empty">
                No repositories have opted into kanban yet.<br />
                Run <code>kb init</code> in any repo to enable it.
              </div>
            `
          : html`
              <div class="list">
                ${list.map(
                  (p) => html`
                    <div
                      class="project-row"
                      @click=${() => state.navigate(`/${p.id}/`)}
                    >
                      <div class="grow">
                        <span class="name">${p.name}</span>
                        <span class="root">${p.root}</span>
                      </div>
                      <span class="badge">${p.boardCount} board${p.boardCount === 1 ? "" : "s"}</span>
                    </div>
                  `,
                )}
              </div>
            `}
      </div>
    `;
  }
}

customElements.define("kb-projects", KbProjects);
