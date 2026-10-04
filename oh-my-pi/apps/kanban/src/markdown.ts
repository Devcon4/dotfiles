/* Markdown rendering: marked (GFM) + DOMPurify. */

import DOMPurify from "dompurify";
import { marked } from "marked";

marked.use({ gfm: true, breaks: true });

export function mdToHtml(md: string): string {
  const raw = marked.parse(md, { async: false });
  if (typeof raw !== "string") return ""; // async never set; defensive
  return DOMPurify.sanitize(raw);
}
