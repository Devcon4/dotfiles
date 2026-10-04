/* <kb-markdown .md=${string} ?interactive=${bool}>
 * Rendered GFM. When `interactive`, task checkboxes are live and emit
 * `task-toggle` CustomEvent<{ index: number; checked: boolean }>. */

import { LitElement, css, html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { mdToHtml } from "../markdown.ts";
import { base } from "../shared.ts";

export class KbMarkdown extends LitElement {
  static properties = {
    md: { type: String },
    interactive: { type: Boolean },
    promotable: { type: Boolean },
  };

  declare md: string;
  declare interactive: boolean;
  declare promotable: boolean;

  constructor() {
    super();
    this.md = "";
    this.interactive = false;
    this.promotable = false;
  }

  static styles = [
    base,
    css`
      :host {
        display: block;
        font-size: 13px;
        line-height: 1.55;
        color: var(--fg);
        word-wrap: break-word;
      }
      .md > :first-child {
        margin-top: 0;
      }
      .md > :last-child {
        margin-bottom: 0;
      }
      h1, h2, h3, h4 {
        margin: 18px 0 8px;
        font-weight: 600;
        line-height: 1.3;
      }
      h1 { font-size: 16px; padding-bottom: 6px; border-bottom: 1px solid var(--border-muted); }
      h2 { font-size: 14px; padding-bottom: 4px; border-bottom: 1px solid var(--border-muted); }
      h3 { font-size: 13px; }
      p { margin: 8px 0; }
      a { color: #539bf5; text-decoration: none; }
      a:hover { text-decoration: underline; }
      ul, ol { margin: 6px 0; padding-left: 22px; }
      li { margin: 3px 0; }
      li:has(> input[type="checkbox"]) {
        list-style: none;
        margin-left: -22px;
        padding-left: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 0 7px;
        align-items: baseline;
      }
      /* nested lists inside a task li: own line, not a flex sibling */
      li:has(> input[type="checkbox"]) > ul,
      li:has(> input[type="checkbox"]) > ol {
        flex-basis: 100%;
        text-decoration: none;
        color: var(--fg);
        margin: 2px 0 0;
        padding-left: 34px;
      }
      li:has(> input[type="checkbox"]:checked) {
        color: var(--fg-muted);
        text-decoration: line-through;
        text-decoration-color: var(--fg-subtle);
      }
      input[type="checkbox"] {
        accent-color: var(--accent);
        margin: 0;
        position: relative;
        top: 2px;
        flex: none;
        padding: 0;
      }
      :host([interactive]) input[type="checkbox"] {
        cursor: pointer;
      }
      code {
        font-family: var(--mono);
        font-size: 12px;
        background: var(--surface-3);
        border-radius: 4px;
        padding: 1px 5px;
      }
      pre {
        background: var(--surface);
        border: 1px solid var(--border-muted);
        border-radius: var(--radius);
        padding: 10px 12px;
        overflow-x: auto;
      }
      pre code { background: none; padding: 0; }
      blockquote {
        margin: 8px 0;
        padding: 2px 0 2px 12px;
        border-left: 3px solid var(--border);
        color: var(--fg-muted);
      }
      hr { border: none; border-top: 1px solid var(--border-muted); margin: 14px 0; }
      img { max-width: 100%; border-radius: var(--radius); }
      table { border-collapse: collapse; margin: 8px 0; display: block; overflow-x: auto; }
      th, td { border: 1px solid var(--border); padding: 4px 10px; font-size: 12px; }
      th { background: var(--surface-2); }
      figure.mockup {
        margin: 12px 0;
        border: 1px solid var(--border);
        border-radius: var(--radius);
        overflow: hidden;
        background: var(--surface);
      }
      .mockup-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 5px 10px;
        border-bottom: 1px solid var(--border-muted);
        background: var(--surface-2);
      }
      .mockup-title {
        font-size: 12px;
        font-weight: 600;
        color: var(--fg-muted);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mockup-btn {
        font: inherit;
        font-size: 11px;
        color: var(--fg-subtle);
        background: none;
        border: 1px solid var(--border);
        border-radius: 2em;
        padding: 1px 9px;
        cursor: pointer;
        white-space: nowrap;
      }
      .mockup-btn:hover {
        color: var(--fg);
        border-color: var(--fg-subtle);
      }
      .mockup-frame {
        display: block;
        width: 100%;
        height: 460px;
        border: none;
        background: #fff;
        transition: height 120ms ease;
      }
      .mockup-frame.tall {
        height: 760px;
      }
      .card-ref {
        font: inherit;
        font-family: var(--mono);
        font-size: 12px;
        color: #539bf5;
        background: rgba(83, 155, 245, 0.1);
        border: none;
        border-radius: 4px;
        padding: 0 4px;
        cursor: pointer;
      }
      .card-ref:hover {
        text-decoration: underline;
      }
      .promote-btn {
        font: inherit;
        font-size: 11px;
        color: var(--fg-subtle);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0 4px;
        opacity: 0;
        transition: opacity 80ms ease;
      }
      li:hover > .promote-btn {
        opacity: 1;
      }
      .promote-btn:hover {
        color: var(--accent);
      }
    `,
  ];

  render() {
    return html`<div class="md">${unsafeHTML(mdToHtml(this.md))}</div>`;
  }

  updated(): void {
    const boxes = this.renderRoot.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    boxes.forEach((box, index) => {
      if (this.interactive) {
        box.disabled = false;
        box.onchange = () => {
          this.dispatchEvent(
            new CustomEvent("task-toggle", {
              detail: { index, checked: box.checked },
              bubbles: true,
              composed: true,
            }),
          );
        };
      } else {
        box.disabled = true;
      }
      const li = box.closest("li");
      if (this.promotable && li && !li.querySelector(".promote-btn")) {
        const btn = document.createElement("button");
        btn.className = "promote-btn";
        btn.textContent = "⤴";
        btn.title = "Split this task into its own card";
        btn.onclick = (e) => {
          e.stopPropagation();
          this.dispatchEvent(
            new CustomEvent("task-promote", { detail: { index }, bubbles: true, composed: true }),
          );
        };
        li.appendChild(btn);
      }
    });
    for (const a of this.renderRoot.querySelectorAll("a")) {
      a.target = "_blank";
      a.rel = "noopener";
    }
    this.embedMockups();
    this.linkifyCardRefs();
  }

  /** Upgrade a link to `/mockups/…(.html)` into an inline sandboxed live
   * preview. Interactive but isolated (allow-scripts, no allow-same-origin). */
  private embedMockups(): void {
    const links = this.renderRoot.querySelectorAll<HTMLAnchorElement>('a[href*="/mockups/"]');
    for (const a of links) {
      const href = a.getAttribute("href") ?? "";
      if (!/\/mockups\/.+\.html?(\?|#|$)/.test(href)) continue;
      const title = a.textContent?.trim() || "Mockup";
      const fig = document.createElement("figure");
      fig.className = "mockup";
      const bar = document.createElement("div");
      bar.className = "mockup-bar";
      const label = document.createElement("span");
      label.className = "mockup-title";
      label.textContent = `🖼 ${title}`;
      const grow = document.createElement("span");
      grow.style.flex = "1";
      const expand = document.createElement("button");
      expand.className = "mockup-btn";
      expand.textContent = "⤢ taller";
      const open = document.createElement("button");
      open.className = "mockup-btn";
      open.textContent = "open ↗";
      open.onclick = () => window.open(href, "_blank", "noopener");
      bar.append(label, grow, expand, open);
      const frame = document.createElement("iframe");
      frame.className = "mockup-frame";
      frame.setAttribute("sandbox", "allow-scripts allow-forms");
      frame.setAttribute("loading", "lazy");
      frame.src = href;
      expand.onclick = () => {
        frame.classList.toggle("tall");
        expand.textContent = frame.classList.contains("tall") ? "⤡ shorter" : "⤢ taller";
      };
      fig.append(bar, frame);
      a.replaceWith(fig);
    }
  }

  /** Turn `#12` in plain text into clickable card refs (skips code/links). */
  private linkifyCardRefs(): void {
    const root = this.renderRoot.querySelector(".md");
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n;
      if (!(text instanceof Text) || !/#\d+/.test(text.data)) continue;
      const parent = text.parentElement;
      if (!parent || parent.closest("code, pre, a, .card-ref")) continue;
      targets.push(text);
    }
    for (const text of targets) {
      const frag = document.createDocumentFragment();
      let rest = text.data;
      let match = rest.match(/#(\d+)/);
      while (match && match.index !== undefined) {
        frag.append(rest.slice(0, match.index));
        const ref = document.createElement("button");
        ref.className = "card-ref";
        ref.textContent = `#${match[1]}`;
        const num = Number(match[1]);
        ref.onclick = (e) => {
          e.stopPropagation();
          this.dispatchEvent(
            new CustomEvent("card-ref", { detail: { num }, bubbles: true, composed: true }),
          );
        };
        frag.append(ref);
        rest = rest.slice(match.index + match[0].length);
        match = rest.match(/#(\d+)/);
      }
      frag.append(rest);
      text.replaceWith(frag);
    }
  }
}

customElements.define("kb-markdown", KbMarkdown);
