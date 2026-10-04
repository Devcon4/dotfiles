import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findConfig, HOST_VERSION, readIndex, type IndexEntry } from "../kit/kit.ts";

export interface BuildSpec {
	run: string[];
	output: string;
	inputs: string[];
}

export interface App {
	name: string;
	description: string;
	command: string;
	port: number;
	config: string;
	start: string[];
	build?: BuildSpec;
	init?: string[];
	digest?: string[];
	bin: Record<string, string[]>;
	dir: string;
	source: "user" | "repo";
	repoRoot?: string;
}

export interface Discovery {
	apps: App[];
	problems: string[];
}

const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const HOME = homedir();

export const KIT_DIR = resolve(import.meta.dirname, "..", "kit");
export const userAppsDir = (): string =>
	process.env.OMP_APPS_DIR ?? join(process.env.PI_CODING_AGENT_DIR ?? join(HOME, ".omp", "agent"), "apps");
export const stateDir = (): string => join(process.env.XDG_STATE_HOME ?? join(HOME, ".local", "state"), "omp-apps");
export const runDir = (): string => join(process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? "/tmp", "omp-apps");
export const binDir = (): string => join(process.env.XDG_DATA_HOME ?? join(HOME, ".local", "share"), "omp-apps", "bin");
export const indexFile = (app: App): string => join(stateDir(), `${app.name}.json`);

/** Replaces `${APP_DIR}` in a manifest command, so commands run from a repo can point into the app. */
export function expand(argv: string[], app: App): string[] {
	return argv.map(arg => arg.replaceAll("${APP_DIR}", app.dir));
}

/** The variables every app process gets: servers, build, init, digest and bin commands. */
export function appVars(app: App): Record<string, string> {
	return {
		APP_NAME: app.name,
		APP_DIR: app.dir,
		APP_PORT: String(app.port),
		APP_INDEX: indexFile(app),
		APP_CONFIG_PATH: app.config,
		APP_KIT: KIT_DIR,
		APP_HOST_VERSION: String(HOST_VERSION),
	};
}

export function loadApp(dir: string, source: App["source"], repoRoot?: string): App {
	const file = join(dir, "app.json");
	const fail = (message: string): never => {
		throw new Error(`${file}: ${message}`);
	};
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	} catch (err) {
		return fail(`not valid JSON (${(err as Error).message})`);
	}
	const argv = (field: string, value: unknown): string[] => {
		if (!Array.isArray(value) || value.length === 0 || !value.every(v => typeof v === "string" && v.length > 0)) {
			return fail(`"${field}" must be a non-empty array of strings (an argv)`);
		}
		return value as string[];
	};
	const optionalArgv = (field: string): string[] | undefined => (raw[field] === undefined ? undefined : argv(field, raw[field]));

	if (raw.host !== HOST_VERSION) fail(`"host" must be ${HOST_VERSION}`);
	const name = raw.name;
	if (typeof name !== "string" || !NAME.test(name)) return fail(`"name" must match ${NAME}`);
	const command = raw.command ?? name;
	if (typeof command !== "string" || !NAME.test(command)) return fail(`"command" must match ${NAME}`);
	if (command === "apps") fail(`"command" cannot be "apps"; the host owns /apps`);
	const port = raw.port;
	if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
		return fail(`"port" must be an integer from 1024 to 65535`);
	}
	const config = raw.config ?? `.omp/apps/${name}.json`;
	if (typeof config !== "string" || config.startsWith("/") || config.split("/").includes("..")) {
		return fail(`"config" must be a path relative to a repo root`);
	}

	let build: BuildSpec | undefined;
	if (raw.build !== undefined) {
		const spec = raw.build as Record<string, unknown>;
		if (typeof spec.output !== "string") fail(`"build.output" must be a path relative to the app folder`);
		const inputs = spec.inputs ?? [];
		if (!Array.isArray(inputs) || !inputs.every(i => typeof i === "string")) fail(`"build.inputs" must be an array of paths`);
		build = { run: argv("build.run", spec.run), output: spec.output as string, inputs: inputs as string[] };
	}

	const bin: Record<string, string[]> = {};
	if (raw.bin !== undefined) {
		if (typeof raw.bin !== "object" || raw.bin === null || Array.isArray(raw.bin)) fail(`"bin" must map command names to argvs`);
		for (const [binName, value] of Object.entries(raw.bin as Record<string, unknown>)) {
			if (!NAME.test(binName)) fail(`bin name "${binName}" must match ${NAME}`);
			bin[binName] = argv(`bin.${binName}`, value);
		}
	}

	return {
		name,
		description: typeof raw.description === "string" ? raw.description : `Open the ${name} app`,
		command,
		port,
		config,
		start: argv("start", raw.start),
		build,
		init: optionalArgv("init"),
		digest: optionalArgv("digest"),
		bin,
		dir,
		source,
		repoRoot,
	};
}

/** User apps, plus the repo apps of the nearest ancestor of cwd that has any. */
export function discoverApps(cwd: string): Discovery {
	const apps: App[] = [];
	const problems: string[] = [];
	const add = (dir: string, source: App["source"], repoRoot?: string) => {
		let app: App;
		try {
			app = loadApp(dir, source, repoRoot);
		} catch (err) {
			problems.push((err as Error).message);
			return;
		}
		const clash = apps.find(
			other => other.name === app.name || other.command === app.command || other.port === app.port,
		);
		if (clash) {
			problems.push(`${dir}: skipped; its name, command or port clashes with ${clash.dir}`);
			return;
		}
		const binClash = Object.keys(app.bin).find(binName => apps.some(other => binName in other.bin));
		if (binClash) {
			problems.push(`${dir}: skipped; bin "${binClash}" is already provided by another app`);
			return;
		}
		apps.push(app);
	};

	for (const dir of appDirs(userAppsDir())) add(dir, "user");
	const repoRoot = repoAppsRoot(cwd);
	if (repoRoot) for (const dir of appDirs(join(repoRoot, ".omp", "apps"))) add(dir, "repo", repoRoot);
	return { apps, problems };
}

function appDirs(root: string): string[] {
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return [];
	}
	return names
		.sort()
		.map(entry => join(root, entry))
		.filter(dir => existsSync(join(dir, "app.json")));
}

function repoAppsRoot(cwd: string): string | undefined {
	let dir = resolve(cwd);
	for (;;) {
		if (appDirs(join(dir, ".omp", "apps")).length > 0) return dir;
		const parent = dirname(dir);
		if (parent === dir || dir === HOME) return undefined;
		dir = parent;
	}
}

/** Where the app is on for cwd: a user app needs its opt-in file, a repo app is on in its repo. */
export function optIn(app: App, cwd: string): IndexEntry | undefined {
	if (app.source === "repo" && app.repoRoot) return { root: app.repoRoot, config: join(app.repoRoot, app.config) };
	return findConfig(app.config, cwd);
}

export function recordOptIn(app: App, entry: IndexEntry): void {
	const entries = readIndex(indexFile(app));
	if (entries.some(e => e.root === entry.root && e.config === entry.config)) return;
	writeJson(indexFile(app), { version: HOST_VERSION, entries: [...entries, entry] });
}

/** Drops index entries whose opt-in file is gone. Returns the dropped entries. */
export function pruneIndex(app: App): IndexEntry[] {
	const entries = readIndex(indexFile(app));
	const kept = entries.filter(e => existsSync(e.config) || (app.source === "repo" && existsSync(e.root)));
	if (kept.length !== entries.length) writeJson(indexFile(app), { version: HOST_VERSION, entries: kept });
	return entries.filter(e => !kept.includes(e));
}

interface TrustEntry {
	app: string;
	root: string;
}

function trustFile(): string {
	return join(stateDir(), "trust.json");
}

function readTrust(): TrustEntry[] {
	try {
		const data = JSON.parse(readFileSync(trustFile(), "utf8")) as { entries?: TrustEntry[] };
		return Array.isArray(data.entries) ? data.entries : [];
	} catch {
		return [];
	}
}

/** Repo apps run code from the repo, so their digests stay off until the dev trusts them once. */
export function isTrusted(app: App): boolean {
	return app.source === "user" || readTrust().some(t => t.app === app.name && t.root === app.repoRoot);
}

export function trust(app: App): void {
	if (isTrusted(app) || !app.repoRoot) return;
	writeJson(trustFile(), { entries: [...readTrust(), { app: app.name, root: app.repoRoot }] });
}

function writeJson(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
	renameSync(tmp, path);
}
