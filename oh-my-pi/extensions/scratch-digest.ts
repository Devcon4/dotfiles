/**
 * scratch-digest: at session start, tells the model which docs/scratch files are unfinished,
 * which are done but still on disk, and which lack the Status/Updated/Owner header.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

interface SessionCtx {
	cwd: string;
	agent?: { kind: string };
}

/** The part of omp's ExtensionAPI this extension uses, declared here so it needs no omp package install. */
interface HostAPI {
	on(event: "session_start", handler: (event: unknown, ctx: SessionCtx) => Promise<void>): void;
	sendMessage(
		message: { customType: string; content: string; display: boolean },
		options?: { deliverAs?: "nextTurn" },
	): void;
}

interface Doc {
	name: string;
	status: string;
	updated: string;
}

const BUCKETS: Array<{ label: string; match: (status: string) => boolean }> = [
	{ label: "Executing", match: s => s === "executing" },
	{ label: "Approved, not started", match: s => s === "approved" },
	{ label: "In review", match: s => s === "in-review" || /^revised-\d+$/.test(s) },
	{ label: "Draft", match: s => s === "draft" },
];
const LIST_CAP = 8;
const STALE_DAYS = 21;

function scratchDir(cwd: string): string | undefined {
	for (let dir = cwd; ; dir = dirname(dir)) {
		const candidate = join(dir, "docs", "scratch");
		if (existsSync(candidate)) return candidate;
		if (existsSync(join(dir, ".git")) || dirname(dir) === dir) return undefined;
	}
}

function readDoc(path: string): Doc {
	const head = readFileSync(path, "utf8").split("\n", 8).join("\n");
	return {
		name: basename(path, ".md"),
		status: /^Status:\s*(\S+)/m.exec(head)?.[1]?.toLowerCase() ?? "",
		updated: /^Updated:\s*(\d{4}-\d{2}-\d{2})/m.exec(head)?.[1] ?? "",
	};
}

function list(docs: Doc[], withDate: boolean, today: number): string {
	const shown = docs.slice(0, LIST_CAP).map(d => {
		if (!withDate || !d.updated) return d.name;
		const stale = (today - Date.parse(d.updated)) / 86_400_000 > STALE_DAYS ? ", stale" : "";
		return `${d.name} (${d.updated}${stale})`;
	});
	const more = docs.length > LIST_CAP ? `, +${docs.length - LIST_CAP} more` : "";
	return shown.join(", ") + more;
}

export function digest(dir: string, today = Date.now()): string | undefined {
	const docs = readdirSync(dir)
		.filter(f => f.endsWith(".md") && f !== "AGENTS.md" && f !== "README.md")
		.map(f => readDoc(join(dir, f)))
		.sort((a, b) => b.updated.localeCompare(a.updated) || a.name.localeCompare(b.name));
	if (docs.length === 0) return undefined;

	const lines = [`Scratch docs in ${dir} (${docs.length}):`];
	const claimed = new Set<Doc>();
	for (const bucket of BUCKETS) {
		const hits = docs.filter(d => bucket.match(d.status));
		hits.forEach(d => claimed.add(d));
		if (hits.length) lines.push(`- ${bucket.label}: ${list(hits, true, today)}`);
	}
	const done = docs.filter(d => d.status === "done");
	done.forEach(d => claimed.add(d));
	if (done.length) lines.push(`- Done but still on disk (offer the dev a git rm once promoted): ${list(done, false, today)}`);
	const headerless = docs.filter(d => !d.status);
	headerless.forEach(d => claimed.add(d));
	if (headerless.length) lines.push(`- No Status header: ${list(headerless, false, today)}`);
	const other = docs.filter(d => !claimed.has(d));
	if (other.length) lines.push(`- Status outside the skill's list: ${other.slice(0, LIST_CAP).map(d => `${d.name} (${d.status})`).join(", ")}`);
	return lines.join("\n");
}

export default function scratchDigest(pi: HostAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent?.kind === "sub") return;
		const dir = scratchDir(ctx.cwd);
		if (!dir) return;
		const text = digest(dir);
		if (text) pi.sendMessage({ customType: "scratch-digest", content: text, display: false }, { deliverAs: "nextTurn" });
	});
}
