/* Shared client constants + shadow-DOM base styles.
 * NEVER import runtime values from ../store.ts here — that would drag
 * node builtins into the browser bundle. Types only (they erase). */

import { css } from "lit";

export const SIZES = ["XS", "S", "M", "L", "XL"] as const;

/** Curated GitHub-dark-friendly palette for labels / cards / columns / accents. */
export const PALETTE = [
  "#e5534b",
  "#e8a13a",
  "#d4a72c",
  "#57ab5a",
  "#6bc46d",
  "#39c5cf",
  "#539bf5",
  "#986ee2",
  "#bf91f3",
  "#ec6cb9",
  "#8b949e",
] as const;

/** rgba() of a #rrggbb hex at the given alpha — chip/tint backgrounds. */
export function tint(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Kebab id from a display name (columns, labels). */
export function slugifyId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "item"
  );
}

export function relTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const mins = Math.round(delta / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

/** Base styles included by every component's `static styles`. */
export const base = css`
  * {
    box-sizing: border-box;
  }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
  }
  input,
  textarea,
  select {
    font: inherit;
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 5px 10px;
    outline: none;
  }
  input:focus-visible,
  textarea:focus-visible,
  select:focus-visible {
    border-color: transparent;
    box-shadow: 0 0 0 2px var(--focus);
  }
  ::placeholder {
    color: var(--fg-subtle);
  }

  .chip {
    display: inline-block;
    box-sizing: border-box;
    height: 18px;
    padding: 0 7px;
    border-radius: 2em;
    border: 1px solid;
    font-size: 11px;
    font-weight: 500;
    line-height: 16px;
    white-space: nowrap;
    max-width: min(100%, 240px);
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: var(--radius);
    color: var(--fg-muted);
    flex: none;
  }
  .icon-btn:hover {
    background: var(--surface-3);
    color: var(--fg);
  }

  .ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    color: var(--fg-muted);
    font-size: 12px;
    background: transparent;
  }
  .ghost-btn:hover {
    background: var(--surface-2);
    color: var(--fg);
    border-color: var(--fg-subtle);
  }
`;
