/* Link previews: the Open Graph image and title a page on this machine
 * declares. Shared by serve.ts (fetch) and the browser client (host check).
 * MUST stay free of node imports. */

export interface LinkPreview {
  url: string;
  image: string;
  title: string | null;
}

const PREVIEW_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true };
const FETCH_TIMEOUT_MS = 3000;
const MAX_HEAD_CHARS = 256 * 1024;
const CACHE_MS = 60_000;
const CACHE_ENTRIES = 256;

const cache = new Map<string, { at: number; preview: Promise<LinkPreview | null> }>();

/** True for an http(s) URL on a loopback host, the only links the server fetches for a preview. */
export function isPreviewable(target: string): boolean {
  try {
    const url = new URL(target);
    return (url.protocol === "http:" || url.protocol === "https:") && PREVIEW_HOSTS[url.hostname] === true;
  } catch {
    return false;
  }
}

/** The page's `og:image` as an absolute URL and its `og:title`; null when the page declares no
 * image, is not HTML, redirects, fails or times out. Results, null included, are cached for a minute. */
export function linkPreview(target: string): Promise<LinkPreview | null> {
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.preview;
  const preview = fetchPreview(target);
  cache.delete(target);
  cache.set(target, { at: Date.now(), preview });
  if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return preview;
}

async function fetchPreview(target: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "text/html" },
    });
    if (!res.ok || !res.body || !(res.headers.get("content-type") ?? "").includes("text/html")) {
      await res.body?.cancel();
      return null;
    }
    const meta = openGraph(await readHead(res.body));
    const image = meta.get("og:image");
    if (!image) return null;
    const imageUrl = new URL(image, target);
    if (imageUrl.protocol !== "http:" && imageUrl.protocol !== "https:") return null;
    return { url: target, image: imageUrl.href, title: meta.get("og:title") ?? null };
  } catch {
    return null;
  }
}

async function readHead(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (html.length < MAX_HEAD_CHARS && !/<\/head>/i.test(html)) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel();
  }
  return html;
}

function openGraph(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs.set(m[1].toLowerCase(), decodeEntities(m[2] ?? m[3]));
    }
    const key = attrs.get("property") ?? attrs.get("name");
    const content = attrs.get("content");
    if (key?.startsWith("og:") && content && !meta.has(key)) meta.set(key, content);
  }
  return meta;
}

const ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? all;
    const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point <= 0x10ffff ? String.fromCodePoint(point) : all;
  });
}
