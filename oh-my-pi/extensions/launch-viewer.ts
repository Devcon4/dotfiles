/**
 * launch-viewer — /tail: pick an omp hub-supervised process and follow its logs.
 *
 * Reads broker state from disk (~/.omp/run/daemons/<hash>/daemons/<name>/meta.json
 * + output.log) — read-only, no broker socket involvement.
 *
 * The tail view runs a minimal terminal emulation over the log stream: SGR styling
 * is tracked as state and re-emitted per line, and line-editing sequences (cursor
 * up, erase-line, column moves, \r) are APPLIED to the buffer instead of stripped,
 * so progress spinners and Serilog color themes render the same as a raw shell.
 */
import { closeSync, openSync, readSync, readdirSync, readFileSync, readlinkSync, statSync, watch, type FSWatcher } from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { getSelectListTheme, type ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { SelectList, matchesKey, truncateToWidth, type Component } from "@oh-my-pi/pi-tui";

const DAEMON_ROOT = join(homedir(), ".omp", "run", "daemons");
const INIT_TAIL_BYTES = 1024 * 1024;
const BACKFILL_BYTES = 512 * 1024;
const MAX_CHUNK_BYTES = 1024 * 1024;
const MAX_LINES = 50000;
const POLL_MS = 200;
const META_REFRESH_TICKS = 15;
// rows this far above the cursor can no longer be edited by realistic cursor-up
// sequences; they are frozen to serialized strings and their cells released
const FREEZE_MARGIN = 500;
const SGR_RESET = "\x1b[0m";
// stable ref: the editor-slot forwarder renders nothing while fullscreen is up
const EMPTY_LINES: readonly string[] = [];

/** Structural views of the runtime objects handed to extension UI factories. */
interface ThemeLike {
	fg(color: string, text: string): string;
}
interface OverlayHandle {
	hide(): void;
}
interface TuiLike {
	requestRender?(): void;
	setFocus?(component: Component): void;
	showOverlay?(component: Component, options?: Record<string, unknown>): OverlayHandle;
	terminal?: { rows?: number };
}
/** parsed SGR mouse report as dispatched by pi-tui's routeMouse path */
interface MouseEventLike {
	/** -1 wheel-up, +1 wheel-down, null for non-wheel events */
	wheel: number | null;
}
interface KeybindingsLike {
	matches(data: string, action: string): boolean;
}
interface CommandCtx {
	hasUI: boolean;
	cwd: string;
	ui: {
		notify(message: string, level: string): void;
		custom<T>(
			factory: (tui: TuiLike, theme: ThemeLike, keybindings: KeybindingsLike, done: (result: T) => void) => Component & { dispose?(): void },
			options?: { overlay?: boolean },
		): Promise<T>;
	};
}

interface LaunchItem {
	name: string;
	state: string;
	alive: boolean;
	pid?: number;
	startedAt?: number;
	exitedAt?: number;
	exitCode?: number;
	restartCount: number;
	cwd?: string;
	command: string;
	inProject: boolean;
	logPath: string;
	ports: number[];
	/** present for docker-container items (state === "docker") */
	docker?: { status: string };
}

interface DaemonMeta {
	daemon?: {
		name?: string;
		state?: string;
		pid?: number;
		startedAt?: number;
		exitedAt?: number;
		exitCode?: number;
		restartCount?: number;
	};
	spec?: {
		application?: string;
		args?: string[];
		cwd?: string;
		ready?: { port?: number };
	};
}

/**
 * TCP ports the process tree rooted at `rootPid` is LISTENing on, via /proc:
 * pid tree -> owned socket inodes -> /proc/net/tcp{,6} LISTEN rows (state 0A).
 */
function listeningPorts(rootPid: number): number[] {
	try {
		const children = new Map<number, number[]>();
		for (const ent of readdirSync("/proc")) {
			if (!/^\d+$/.test(ent)) continue;
			let stat: string;
			try {
				stat = readFileSync(`/proc/${ent}/stat`, "utf8");
			} catch {
				continue;
			}
			// fields after the parenthesized comm: state ppid ...
			const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
			const ppid = Number.parseInt(fields[1], 10);
			const pid = Number.parseInt(ent, 10);
			const arr = children.get(ppid);
			if (arr) arr.push(pid);
			else children.set(ppid, [pid]);
		}
		const pids = [rootPid];
		for (let i = 0; i < pids.length; i++) for (const c of children.get(pids[i]) ?? []) pids.push(c);
		const inodes = new Set<string>();
		for (const pid of pids) {
			let fds: string[];
			try {
				fds = readdirSync(`/proc/${pid}/fd`);
			} catch {
				continue;
			}
			for (const fd of fds) {
				try {
					const link = readlinkSync(`/proc/${pid}/fd/${fd}`);
					if (link.startsWith("socket:[")) inodes.add(link.slice(8, -1));
				} catch {
					// fd closed while iterating
				}
			}
		}
		const ports = new Set<number>();
		for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
			let text: string;
			try {
				text = readFileSync(file, "utf8");
			} catch {
				continue;
			}
			for (const line of text.split("\n").slice(1)) {
				const cols = line.trim().split(/\s+/);
				if (cols.length < 10 || cols[3] !== "0A" || !inodes.has(cols[9])) continue;
				ports.add(Number.parseInt(cols[1].split(":")[1], 16));
			}
		}
		return [...ports].sort((a, b) => a - b);
	} catch {
		return [];
	}
}

function readLaunchItem(dir: string, fallbackName: string, proj: string): LaunchItem | null {
	let meta: DaemonMeta;
	try {
		meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as DaemonMeta;
	} catch {
		return null;
	}
	const d = meta.daemon ?? {};
	const spec = meta.spec ?? {};
	const cwd = spec.cwd;
	let state = d.state ?? "unknown";
	let alive = false;
	if (state !== "exited" && typeof d.pid === "number") {
		try {
			process.kill(d.pid, 0);
			alive = true;
		} catch {
			state = "stale";
		}
	}
	let ports: number[] = [];
	if (alive && typeof d.pid === "number") ports = listeningPorts(d.pid);
	if (ports.length === 0 && alive && spec.ready?.port) ports = [spec.ready.port];
	return {
		name: d.name ?? fallbackName,
		state,
		alive,
		pid: d.pid,
		startedAt: d.startedAt,
		exitedAt: d.exitedAt,
		exitCode: d.exitCode,
		restartCount: d.restartCount ?? 0,
		cwd,
		command: [spec.application, ...(spec.args ?? [])].filter(Boolean).join(" "),
		inProject: !!cwd && (cwd === proj || cwd.startsWith(proj + sep) || proj.startsWith(cwd + sep)),
		logPath: join(dir, "output.log"),
		ports,
	};
}

function scanLaunchItems(projectCwd: string): LaunchItem[] {
	const items: LaunchItem[] = [];
	let brokers: string[] = [];
	try {
		brokers = readdirSync(DAEMON_ROOT);
	} catch {
		return items;
	}
	const proj = projectCwd.replace(/\/+$/, "");
	for (const broker of brokers) {
		const daemonsDir = join(DAEMON_ROOT, broker, "daemons");
		let names: string[] = [];
		try {
			names = readdirSync(daemonsDir);
		} catch {
			continue;
		}
		for (const name of names) {
			const item = readLaunchItem(join(daemonsDir, name), name, proj);
			if (item) items.push(item);
		}
	}
	// Live first, then most recently started
	items.sort((a, b) => Number(b.alive) - Number(a.alive) || (b.startedAt ?? 0) - (a.startedAt ?? 0));
	return items;
}

function fmtDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "?";
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h${m % 60 ? `${m % 60}m` : ""}`;
	const days = Math.floor(h / 24);
	return `${days}d${h % 24 ? `${h % 24}h` : ""}`;
}

function fmtBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KiB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1048576).toFixed(1)}MiB`;
	return `${(n / 1073741824).toFixed(2)}GiB`;
}

/** synthetic item for tailing an arbitrary file (no broker metadata) */
function fileItem(path: string): LaunchItem | null {
	let size: number;
	try {
		size = statSync(path).size;
	} catch {
		return null;
	}
	return {
		name: path.slice(path.lastIndexOf("/") + 1),
		state: "file",
		alive: false,
		restartCount: 0,
		command: path,
		inProject: true,
		logPath: path,
		ports: [],
		startedAt: undefined,
		exitedAt: undefined,
		exitCode: undefined,
		pid: undefined,
		cwd: undefined,
	};
}

function itemStatus(it: LaunchItem): string {
	if (it.state === "docker") return it.docker?.status ?? "container";
	if (it.state === "file") {
		try {
			return `file ${fmtBytes(statSync(it.logPath).size)}`;
		} catch {
			return "file (missing)";
		}
	}
	if (it.state === "exited") {
		const ran = it.startedAt && it.exitedAt ? fmtDuration(it.exitedAt - it.startedAt) : "?";
		return `exited exit=${it.exitCode ?? "?"} ran=${ran}`;
	}
	if (!it.alive) return `${it.state} (pid gone)`;
	const up = it.startedAt ? fmtDuration(Date.now() - it.startedAt) : "?";
	return `${it.state} pid=${it.pid} up=${up}${it.restartCount ? ` restarts=${it.restartCount}` : ""}`;
}

const DOCKER_BLUE = "\x1b[94m";

/** running docker containers as tail-able items ([] when docker is unavailable) */
function dockerItems(): LaunchItem[] {
	let out: string;
	try {
		out = execFileSync("docker", ["ps", "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"], {
			encoding: "utf8",
			timeout: 3000,
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return [];
	}
	const items: LaunchItem[] = [];
	for (const line of out.split("\n")) {
		const [name, status, portsRaw, image] = line.split("\t");
		if (!name) continue;
		const ports = new Set<number>();
		for (const m of (portsRaw ?? "").matchAll(/:(\d+)->/g)) ports.add(Number(m[1]));
		items.push({
			name,
			state: "docker",
			alive: true,
			restartCount: 0,
			command: image ?? "",
			inProject: true,
			logPath: "",
			ports: [...ports].sort((a, b) => a - b),
			docker: { status: status ?? "" },
			startedAt: undefined,
			exitedAt: undefined,
			exitCode: undefined,
			pid: undefined,
			cwd: undefined,
		});
	}
	return items;
}

// matchesKey with unknown-name tolerance across pi-tui versions.
function isKey(data: string, name: string, raw: string[]): boolean {
	try {
		if (matchesKey(data, name)) return true;
	} catch {
		// unknown key name in this pi-tui version — raw fallback below
	}
	return raw.includes(data);
}

class Picker implements Component {
	private list: SelectList;

	constructor(
		items: LaunchItem[],
		theme: ThemeLike,
		private keybindings: KeybindingsLike,
		private done: (value: LaunchItem | undefined) => void,
	) {
		const nameW = Math.max(...items.map((i) => i.name.length), 4);
		const statusW = Math.max(...items.map((i) => itemStatus(i).length), 6);
		const rows = items.map((it) => {
			const name = it.name.padEnd(nameW);
			const status = itemStatus(it).padEnd(statusW);
			const ports = it.ports.length ? `${it.ports.map((p) => `:${p}`).join(" ")}  ` : "";
			const extra = `${ports}${it.inProject ? it.command : `${it.command}  [${it.cwd}]`}`;
			const label =
				it.state === "docker"
					? `${DOCKER_BLUE}${name}${SGR_RESET}  ${status}  ${theme.fg("muted", extra)}`
					: it.alive
						? `${theme.fg("accent", name)}  ${status}  ${theme.fg("muted", extra)}`
						: theme.fg("dim", `${name}  ${status}  ${extra}`);
			return { value: it.name, label };
		});
		this.list = new SelectList(rows, Math.min(rows.length, 12), getSelectListTheme());
		this.list.onSelect = (row: { value: string }) => this.done(items.find((i) => i.name === row.value));
		this.list.onCancel = () => this.done(undefined);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "app.interrupt")) {
			this.done(undefined);
			return;
		}
		this.list.handleInput(data);
	}

	render(width: number): readonly string[] {
		return this.list.render(width).map((l: string) => truncateToWidth(l, width));
	}

	invalidate(): void {
		this.list.invalidate?.();
	}
}

// ---------------------------------------------------------------------------
// Minimal terminal emulation for the tail buffer
// ---------------------------------------------------------------------------

interface Cell {
	ch: string;
	/** canonical SGR params active when this cell was written; "" = plain */
	st: string;
}
interface Row {
	cells: Cell[];
	/** serialized cache; null after any edit */
	str: string | null;
}

// bit flags for simple attributes, indexed by SGR code
const SGR_FLAG_SET: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 7: 32, 8: 64, 9: 128 };
const SGR_FLAG_CLEAR: Record<number, number> = { 22: 3, 23: 4, 24: 8, 25: 16, 27: 32, 28: 64, 29: 128 };
const SGR_FLAG_CODES: Array<[number, string]> = [
	[1, "1"],
	[2, "2"],
	[4, "3"],
	[8, "4"],
	[16, "5"],
	[32, "7"],
	[64, "8"],
	[128, "9"],
];

/** Parsed SGR attribute state; canonicalizes to a stable params string. */
class SgrState {
	private flags = 0;
	private fg = "";
	private bg = "";
	/** cached canonical form */
	value = "";

	apply(paramStr: string): void {
		const parts = paramStr.length === 0 ? [0] : paramStr.split(";").map((p) => (p.length === 0 ? 0 : Number.parseInt(p, 10)));
		for (let i = 0; i < parts.length; i++) {
			const c = parts[i];
			if (Number.isNaN(c)) continue;
			if (c === 0) {
				this.flags = 0;
				this.fg = "";
				this.bg = "";
			} else if (SGR_FLAG_SET[c] !== undefined) this.flags |= SGR_FLAG_SET[c];
			else if (SGR_FLAG_CLEAR[c] !== undefined) this.flags &= ~SGR_FLAG_CLEAR[c];
			else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) this.fg = String(c);
			else if (c === 39) this.fg = "";
			else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) this.bg = String(c);
			else if (c === 49) this.bg = "";
			else if (c === 38 || c === 48) {
				// extended color: 38;5;n or 38;2;r;g;b
				let ext = "";
				if (parts[i + 1] === 5 && i + 2 < parts.length) {
					ext = `${c};5;${parts[i + 2]}`;
					i += 2;
				} else if (parts[i + 1] === 2 && i + 4 < parts.length) {
					ext = `${c};2;${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
					i += 4;
				} else break; // malformed — stop parsing this sequence
				if (c === 38) this.fg = ext;
				else this.bg = ext;
			}
			// anything else (fonts, ideogram, ...) — ignore
		}
		const codes: string[] = [];
		for (const [bit, code] of SGR_FLAG_CODES) if (this.flags & bit) codes.push(code);
		if (this.fg) codes.push(this.fg);
		if (this.bg) codes.push(this.bg);
		this.value = codes.join(";");
	}
}

const TOKEN_RE = /\x1b\[([0-9;?]*)[ -\/]*([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|\r\n|\r|\n|\t/g;
// a trailing partial escape held back until the next chunk completes it
const PARTIAL_ESC_RE = /^\x1b(?:\[[0-9;?]*[ -\/]*)?$|^\x1b\][^\x07\x1b]*$/;
const C0_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Log-stream screen model: applies SGR + line-editing control sequences to a
 * scrollback row buffer, the way a terminal would, instead of stripping them.
 */
class Screen {
	rows: Row[] = [{ cells: [], str: null }];
	private row = 0;
	private col = 0;
	private style = new SgrState();
	private escRem = "";

	/** @returns number of rows appended (for scroll anchoring) */
	ingest(chunk: string): number {
		const before = this.rows.length;
		let data = this.escRem + chunk;
		this.escRem = "";
		const lastEsc = data.lastIndexOf("\x1b");
		if (lastEsc >= 0 && data.length - lastEsc < 64 && PARTIAL_ESC_RE.test(data.slice(lastEsc))) {
			this.escRem = data.slice(lastEsc);
			data = data.slice(0, lastEsc);
		}
		TOKEN_RE.lastIndex = 0;
		let pos = 0;
		for (let m = TOKEN_RE.exec(data); m !== null; m = TOKEN_RE.exec(data)) {
			if (m.index > pos) this.writeText(data.slice(pos, m.index));
			pos = TOKEN_RE.lastIndex;
			const tok = m[0];
			if (tok === "\r\n" || tok === "\n") this.newline();
			else if (tok === "\r") this.col = 0;
			else if (tok === "\t") this.col += 8 - (this.col % 8);
			else if (m[2] !== undefined) this.applyCsi(m[1] ?? "", m[2]);
			// OSC / other lone escapes — drop
		}
		if (pos < data.length) this.writeText(data.slice(pos));
		const added = this.rows.length - before;
		if (this.rows.length > MAX_LINES) {
			const excess = this.rows.length - MAX_LINES;
			this.rows.splice(0, excess);
			this.row = Math.max(0, this.row - excess);
		}
		// freeze rows the cursor can no longer plausibly reach: serialize once,
		// release cell memory
		if (this.rows.length > FREEZE_MARGIN) {
			const limit = this.rows.length - FREEZE_MARGIN;
			for (let i = 0; i < limit; i++) {
				const r = this.rows[i];
				if (r.cells.length > 0) {
					r.str = serializeRow(r);
					r.cells = [];
				}
			}
		}
		return added;
	}

	/** splice older (already-frozen) rows in front; cursor keeps its position */
	prepend(rows: Row[]): void {
		this.rows.unshift(...rows);
		this.row += rows.length;
	}

	/** append a plain marker line at the bottom, resetting cursor/style state */
	mark(text: string): void {
		this.style.apply("0");
		this.row = this.rows.length - 1;
		if (this.rows[this.row].cells.length > 0) this.newline();
		this.writeText(text);
		this.newline();
	}

	private newline(): void {
		this.row++;
		if (this.row === this.rows.length) this.rows.push({ cells: [], str: null });
		this.col = 0;
	}

	private writeText(text: string): void {
		const clean = text.replace(C0_RE, "");
		if (clean.length === 0) return;
		const r = this.rows[this.row];
		for (const ch of clean) {
			while (r.cells.length < this.col) r.cells.push({ ch: " ", st: "" });
			r.cells[this.col] = { ch, st: this.style.value };
			this.col++;
		}
		r.str = null;
	}

	private applyCsi(params: string, final: string): void {
		if (final === "m") {
			if (!params.includes("?")) this.style.apply(params);
			return;
		}
		const n = Math.max(1, Number.parseInt(params, 10) || 0);
		const r = this.rows[this.row];
		switch (final) {
			case "A":
				this.row = Math.max(0, this.row - n);
				break;
			case "B":
				this.row = Math.min(this.rows.length - 1, this.row + n);
				break;
			case "C":
				this.col += n;
				break;
			case "D":
				this.col = Math.max(0, this.col - n);
				break;
			case "G":
			case "`":
				this.col = n - 1;
				break;
			case "K": {
				const mode = Number.parseInt(params, 10) || 0;
				if (mode === 2) r.cells = [];
				else if (mode === 1) for (let i = 0; i < Math.min(this.col + 1, r.cells.length); i++) r.cells[i] = { ch: " ", st: "" };
				else r.cells.length = Math.min(r.cells.length, this.col);
				r.str = null;
				break;
			}
			case "J": {
				const mode = Number.parseInt(params, 10) || 0;
				if (mode === 0) {
					this.rows.splice(this.row + 1);
					r.cells.length = Math.min(r.cells.length, this.col);
					r.str = null;
				}
				// 2J clears the visible screen but not scrollback — for a log tail,
				// keeping prior rows matches what a scrolled-back shell shows.
				break;
			}
			// H/f (absolute addressing) and everything else: meaningless without
			// real screen geometry — drop.
		}
	}
}

function serializeRow(r: Row): string {
	let out = "";
	let cur = "";
	for (const cell of r.cells) {
		if (cell.st !== cur) {
			out += cell.st === "" ? SGR_RESET : `\x1b[0;${cell.st}m`;
			cur = cell.st;
		}
		out += cell.ch;
	}
	if (cur !== "") out += SGR_RESET;
	return out;
}

class TailView implements Component {
	private screen = new Screen();
	private cursor = 0;
	/** byte offset in the log file of the first ingested line */
	private loadedStart = 0;
	private scrollUp = 0; // 0 = follow bottom
	private note = "";
	private rev = 0;
	private cachedWidth = -1;
	private cachedRev = -1;
	private cached: string[] = [];
	private timer: NodeJS.Timeout | null = null;
	private child: ChildProcess | null = null;
	private watcher: FSWatcher | null = null;
	private tickScheduled = false;
	private disposed = false;
	private status: string;
	private ticks = 0;
	private cachedLines = -1;

	constructor(
		private tui: TuiLike,
		private theme: ThemeLike,
		private keybindings: KeybindingsLike,
		private item: LaunchItem,
		private done: (v: undefined) => void,
		private fullscreen: boolean,
	) {
		this.status = itemStatus(item);
		if (item.state === "docker") {
			// stream source: docker CLI demuxes and follows; no file, no watch/poll
			this.spawnStream();
		} else {
			this.initialLoad();
			this.armWatch();
			this.timer = setInterval(() => this.tick(), POLL_MS);
		}
	}

	private spawnStream(): void {
		// log driver "none" (e.g. this repo's database/mailpit) breaks `docker logs`;
		// `attach` taps live stdout directly, bypassing the log driver — no history
		let useAttach = false;
		try {
			const driver = execFileSync("docker", ["inspect", "--format", "{{.HostConfig.LogConfig.Type}}", this.item.name], {
				encoding: "utf8",
				timeout: 3000,
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
			useAttach = driver === "none";
		} catch {
			// inspect failed — try logs anyway
		}
		if (useAttach) this.note = "log driver 'none' — live output only";
		const args = useAttach ? ["attach", "--no-stdin", "--sig-proxy=false", this.item.name] : ["logs", "-f", "--tail", "5000", this.item.name];
		try {
			const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
			this.child = child;
			const onData = (buf: Buffer) => {
				try {
					const added = this.screen.ingest(buf.toString("utf8"));
					if (this.scrollUp > 0 && added > 0) this.scrollUp = Math.min(this.scrollUp + added, this.maxScroll());
					this.rev++;
					this.tui.requestRender?.();
				} catch {
					// keep the stream alive on a bad chunk
				}
			};
			child.stdout?.on("data", onData);
			child.stderr?.on("data", onData);
			child.on("exit", () => {
				if (this.disposed) return;
				this.note = "stream ended";
				this.rev++;
				this.tui.requestRender?.();
			});
			child.on("error", () => {
				this.note = "docker logs failed";
				this.rev++;
				this.tui.requestRender?.();
			});
		} catch {
			this.note = "docker logs failed";
		}
	}

	// re-read every render so terminal resizes are picked up
	private viewLines(): number {
		const rows = this.tui.terminal?.rows ?? process.stdout.rows ?? 34;
		// fullscreen: whole alt screen minus header+footer; inline: leave room for the frame
		return this.fullscreen ? Math.max(10, rows - 2) : Math.min(60, Math.max(10, rows - 8));
	}

	private initialLoad(): void {
		try {
			const size = statSync(this.item.logPath).size;
			const start = Math.max(0, size - INIT_TAIL_BYTES);
			const text = this.readRange(start, size);
			let body = text;
			if (start > 0) {
				const nl = text.indexOf("\n");
				body = text.slice(nl + 1);
				this.loadedStart = start + Buffer.byteLength(text.slice(0, nl + 1));
			}
			this.screen.ingest(body);
			this.cursor = size;
		} catch {
			this.note = "log file not readable yet";
		}
	}

	// fs.watch gives near-instant appends; the interval remains as a fallback
	// (watch dies on rotation and is best-effort on some filesystems)
	private armWatch(): void {
		try {
			this.watcher?.close();
		} catch {
			// already closed
		}
		this.watcher = null;
		try {
			this.watcher = watch(this.item.logPath, () => this.scheduleTick());
		} catch {
			// no watch support — interval covers it
		}
	}

	private scheduleTick(): void {
		if (this.tickScheduled || this.disposed) return;
		this.tickScheduled = true;
		setTimeout(() => {
			this.tickScheduled = false;
			this.tick();
		}, 10);
	}

	private tick(): void {
		if (this.disposed) return;
		try {
			let dirty = this.poll();
			// periodic: refresh status — broker meta for launches, size for plain files
			if (++this.ticks % META_REFRESH_TICKS === 0) {
				if (this.item.state === "file") {
					const status = itemStatus(this.item);
					if (status !== this.status) {
						this.status = status;
						dirty = true;
					}
				} else {
					const fresh = readLaunchItem(dirname(this.item.logPath), this.item.name, "");
					if (fresh) {
						const portsChanged = fresh.ports.join() !== this.item.ports.join();
						this.item = { ...fresh, inProject: this.item.inProject };
						const status = itemStatus(this.item);
						if (status !== this.status || portsChanged) {
							this.status = status;
							dirty = true;
						}
					}
				}
			}
			if (dirty) {
				this.rev++;
				this.tui.requestRender?.();
			}
		} catch {
			// transient fs error — keep polling
		}
	}

	/** @returns true when new content arrived */
	private poll(): boolean {
		let size: number;
		try {
			size = statSync(this.item.logPath).size;
		} catch {
			return false;
		}
		let changed = false;
		if (size < this.cursor) {
			// rotation: broker moved output.log -> output.previous.log
			this.cursor = 0;
			this.loadedStart = 0;
			this.screen.mark("--- log rotated ---");
			this.armWatch(); // old inode is gone
			changed = true;
		}
		let loops = 0;
		while (size > this.cursor && loops++ < 8) {
			const end = Math.min(size, this.cursor + MAX_CHUNK_BYTES);
			const added = this.screen.ingest(this.readRange(this.cursor, end));
			this.cursor = end;
			// keep the viewport anchored while scrolled up
			if (this.scrollUp > 0 && added > 0) this.scrollUp = Math.min(this.scrollUp + added, this.maxScroll());
			changed = true;
		}
		return changed;
	}

	/** load the previous chunk of the file and prepend it as frozen scrollback */
	private backfill(): void {
		if (this.loadedStart <= 0) return;
		const newStart = Math.max(0, this.loadedStart - BACKFILL_BYTES);
		const text = this.readRange(newStart, this.loadedStart);
		let body = text;
		let bodyStart = newStart;
		if (newStart > 0) {
			const nl = text.indexOf("\n");
			if (nl < 0) {
				this.loadedStart = newStart; // one huge partial line — skip it
				return;
			}
			body = text.slice(nl + 1);
			bodyStart = newStart + Buffer.byteLength(text.slice(0, nl + 1));
		}
		const tmp = new Screen();
		tmp.ingest(body);
		const rows = tmp.rows;
		if (rows.length > 0 && rows[rows.length - 1].cells.length === 0) rows.pop(); // trailing newline row
		// tmp's own ingest may have frozen older rows already (cells released,
		// str set) — re-serializing those from empty cells would blank them
		for (const r of rows) {
			if (r.cells.length > 0) {
				r.str = serializeRow(r);
				r.cells = [];
			}
		}
		this.screen.prepend(rows);
		this.loadedStart = bodyStart;
		this.rev++;
	}

	private readRange(start: number, end: number): string {
		const fd = openSync(this.item.logPath, "r");
		try {
			const buf = Buffer.alloc(end - start);
			const n = readSync(fd, buf, 0, buf.length, start);
			return buf.toString("utf8", 0, n);
		} finally {
			closeSync(fd);
		}
	}

	private maxScroll(): number {
		return Math.max(0, this.screen.rows.length - this.viewLines());
	}

	private setScroll(target: number): void {
		// hitting the top pulls older file content into scrollback
		if (target > this.maxScroll() && this.loadedStart > 0) this.backfill();
		const next = Math.max(0, Math.min(target, this.maxScroll()));
		if (next === this.scrollUp && this.rev === this.cachedRev) return;
		this.scrollUp = next;
		this.rev++;
		this.tui.requestRender?.();
	}

	/** pi-tui dispatches parsed SGR mouse reports here when mouse tracking is on */
	routeMouse(ev: MouseEventLike): void {
		if (ev.wheel !== null) this.setScroll(this.scrollUp - ev.wheel * 3);
	}
	handleInput(data: string): void {
		// SGR mouse reports (wheel = buttons 64/65), if the host forwards them
		const wheel = data.match(/\x1b\[<6[45];\d+;\d+M/g);
		if (wheel) {
			let delta = 0;
			for (const w of wheel) delta += w.startsWith("\x1b[<64") ? 3 : -3;
			this.setScroll(this.scrollUp + delta);
			return;
		}
		if (this.keybindings.matches(data, "app.interrupt") || isKey(data, "escape", ["\x1b", "q"])) {
			this.done(undefined);
			return;
		}
		const half = Math.max(1, this.viewLines() >> 1);
		const page = this.viewLines() - 2;
		if (isKey(data, "up", ["\x1b[A", "\x1bOA", "k"])) this.setScroll(this.scrollUp + 1);
		else if (isKey(data, "down", ["\x1b[B", "\x1bOB", "j"])) this.setScroll(this.scrollUp - 1);
		else if (data === "u") this.setScroll(this.scrollUp + half);
		else if (data === "d") this.setScroll(this.scrollUp - half);
		else if (isKey(data, "pageup", ["\x1b[5~", "b"])) this.setScroll(this.scrollUp + page);
		else if (isKey(data, "pagedown", ["\x1b[6~", "f", " "])) this.setScroll(this.scrollUp - page);
		else if (isKey(data, "home", ["\x1b[H", "\x1bOH", "G"])) this.setScroll(Number.MAX_SAFE_INTEGER);
		else if (isKey(data, "end", ["\x1b[F", "\x1bOF", "g"])) this.setScroll(0);
	}

	render(width: number): readonly string[] {
		const viewLines = this.viewLines();
		if (width === this.cachedWidth && this.rev === this.cachedRev && viewLines === this.cachedLines) return this.cached;
		const ports = this.item.ports.length ? ` · ${this.item.ports.map((p) => `:${p}`).join(" ")}` : "";
		const pos = this.scrollUp === 0 ? "following" : `↑${this.scrollUp}/${this.maxScroll()}${this.loadedStart > 0 ? "+" : ""}`;
		const header = ` ${this.item.name} · ${this.status}${ports} · ${pos}${this.note ? ` · ${this.note}` : ""}`;
		const footer = " q close · j/k line · u/d half · f/b/Space page · g bottom/follow · G top · top loads older";
		const rows = this.screen.rows;
		const endIdx = rows.length - this.scrollUp;
		const view = rows.slice(Math.max(0, endIdx - viewLines), endIdx);
		const body = view.map((r) => {
			const s = r.str ?? (r.str = serializeRow(r));
			return s.includes("\x1b") ? truncateToWidth(s, width) + SGR_RESET : truncateToWidth(s, width);
		});
		while (body.length < viewLines) body.unshift("");
		const coloredHeader = this.item.state === "docker" ? `${DOCKER_BLUE}${header}${SGR_RESET}` : this.theme.fg("accent", header);
		const out = [truncateToWidth(coloredHeader, width), ...body, truncateToWidth(this.theme.fg("dim", footer), width)];
		this.cachedWidth = width;
		this.cachedRev = this.rev;
		this.cachedLines = viewLines;
		this.cached = out;
		return out;
	}

	invalidate(): void {
		this.cachedWidth = -1;
	}

	dispose(): void {
		this.disposed = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		try {
			this.watcher?.close();
		} catch {
			// already closed
		}
		this.watcher = null;
		if (this.child) {
			try {
				this.child.kill("SIGTERM");
			} catch {
				// already gone
			}
			this.child = null;
		}
	}
}

export default function launchViewer(pi: ExtensionAPI): void {
	pi.setLabel("Launch Viewer");

	// Bare /tail opens the process picker; /tail <name> goes straight to that log.
	async function runViewer(ctx: CommandCtx, query: string): Promise<void> {
		if (!ctx.hasUI) return;
		let target: LaunchItem | undefined;
		// a path-looking query tails any file, not just broker launches
		if (query && (query.includes("/") || query.startsWith(".") || query.startsWith("~"))) {
			const expanded = query.startsWith("~") ? join(homedir(), query.slice(1)) : query;
			const resolved = expanded.startsWith("/") ? expanded : join(ctx.cwd, expanded);
			const fi = fileItem(resolved);
			if (!fi) {
				ctx.ui.notify(`Cannot read file "${resolved}".`, "warning");
				return;
			}
			target = fi;
			query = "";
		}
		// launches first (accent), then running containers as a second section (blue)
		const all = target ? [] : [...scanLaunchItems(ctx.cwd), ...dockerItems()];
		const project = all.filter((i) => i.inProject);
		const items = project.length > 0 ? project : all;
		if (!target && items.length === 0) {
			ctx.ui.notify("No launched processes found.", "info");
			return;
		}
		if (!target && query) {
			target = items.find((i) => i.name === query) ?? items.find((i) => i.name.startsWith(query)) ?? items.find((i) => i.name.includes(query));
			if (!target) {
				ctx.ui.notify(`No launched process matching "${query}".`, "warning");
				return;
			}
		} else if (!target) {
			target = await ctx.ui.custom<LaunchItem | undefined>((_tui, theme, keybindings, done) => new Picker(items, theme, keybindings, done));
		}
		if (!target) return;
		// Prefer a fullscreen overlay (alternate screen, like less/vim): pi-tui
		// manages ?1049h/l and mouse tracking. The component returned to custom()
		// occupies the editor slot and forwards input to the overlay view.
		await ctx.ui.custom<undefined>((tui, theme, keybindings, done) => {
			const canFullscreen = typeof tui.showOverlay === "function";
			let handle: OverlayHandle | null = null;
			const tail = new TailView(
				tui,
				theme,
				keybindings,
				target,
				() => {
					handle?.hide();
					done(undefined);
				},
				canFullscreen,
			);
			if (!canFullscreen) return tail;
			handle = tui.showOverlay!(tail, { anchor: "bottom-center", width: "100%", maxHeight: "100%", margin: 0, fullscreen: true });
			const forwarder: Component & { routeMouse(ev: MouseEventLike): void; dispose(): void } = {
				render: () => EMPTY_LINES,
				handleInput: (data: string) => tail.handleInput(data),
				routeMouse: (ev: MouseEventLike) => tail.routeMouse(ev),
				invalidate: () => tail.invalidate(),
				dispose: () => {
					handle?.hide();
					tail.dispose();
				},
			};
			return forwarder;
		});
	}

	pi.registerCommand("tail", {
		description: "View launched processes / tail one's logs: /tail [name]",
		handler: async (args: unknown, ctx: CommandCtx) => {
			const query = (Array.isArray(args) ? args.join(" ") : typeof args === "string" ? args : "").trim();
			return runViewer(ctx, query);
		},
	});
}
