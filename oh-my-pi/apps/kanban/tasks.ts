/* Pure markdown task-list helpers — shared by store.ts (server), kb.ts
 * (CLI), and the browser client. MUST stay free of node imports. */

const TASK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

export interface TaskStats {
  total: number;
  done: number;
}

/** Count `- [ ]` task markers outside fenced code blocks. */
export function taskStats(body: string): TaskStats {
  let total = 0;
  let done = 0;
  let fence = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = line.match(TASK_RE);
    if (m) {
      total++;
      if (m[2] !== " ") done++;
    }
  }
  return { total, done };
}

/** Does the body reference a live HTML mockup (`](/mockups/….html)`)? */
export function hasMockup(body: string): boolean {
  return /\]\((?:\/[^/]+)?\/mockups\/[^)]+\.html?(\?|#|\))/.test(body);
}

/** Toggle the nth (0-based) task marker in a markdown body. Returns the new
 * body, or null when the index is out of range. */
export function toggleTaskMarker(body: string, index: number, checked: boolean): string | null {
  const lines = body.split("\n");
  let fence = false;
  let i = -1;
  for (let n = 0; n < lines.length; n++) {
    if (/^\s*(```|~~~)/.test(lines[n])) fence = !fence;
    if (fence) continue;
    if (!TASK_RE.test(lines[n])) continue;
    i++;
    if (i === index) {
      lines[n] = lines[n].replace(TASK_RE, `$1${checked ? "x" : " "}$3`);
      return lines.join("\n");
    }
  }
  return null;
}

/** Rewrite the text of the nth (0-based) task marker in a markdown body. */
export function rewriteTaskLine(body: string, index: number, newText: string): string | null {
  const lines = body.split("\n");
  let fence = false;
  let i = -1;
  for (let n = 0; n < lines.length; n++) {
    if (/^\s*(```|~~~)/.test(lines[n])) fence = !fence;
    if (fence) continue;
    const m = lines[n].match(TASK_RE);
    if (!m) continue;
    i++;
    if (i === index) {
      const indent = lines[n].slice(0, lines[n].indexOf(m[0]));
      const marker = m[0].trim();
      lines[n] = `${indent}${marker} ${newText.trim()}`;
      return lines.join("\n");
    }
  }
  return null;
}

/** Extract the text of the nth task line (everything after `- [ ] `). */
export function taskLineText(body: string, index: number): string | null {
  const lines = body.split("\n");
  let fence = false;
  let i = -1;
  for (let n = 0; n < lines.length; n++) {
    if (/^\s*(```|~~~)/.test(lines[n])) fence = !fence;
    if (fence) continue;
    const m = lines[n].match(TASK_RE);
    if (!m) continue;
    i++;
    if (i === index) {
      return lines[n].slice(lines[n].indexOf(m[0]) + m[0].length).trim();
    }
  }
  return null;
}
