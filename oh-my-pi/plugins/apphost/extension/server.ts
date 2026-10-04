import { spawn } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { appVars, binDir, expand, runDir, type App } from "./apps.ts";

export type Health = { state: "up" } | { state: "down" } | { state: "taken"; by: string };

export interface CommandResult {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

const pidFile = (app: App): string => join(runDir(), `${app.name}.pid`);
export const logFile = (app: App): string => join(runDir(), `${app.name}.log`);

export async function health(app: App): Promise<Health> {
	let body: { app?: unknown };
	try {
		const res = await fetch(`http://127.0.0.1:${app.port}/_app/health`, { signal: AbortSignal.timeout(1000) });
		body = (await res.json().catch(() => ({}))) as { app?: unknown };
	} catch {
		return { state: "down" };
	}
	if (body.app === app.name) return { state: "up" };
	return { state: "taken", by: typeof body.app === "string" ? `the "${body.app}" app` : "another server" };
}

/** Starts the app's server unless it already answers. Builds first when the build output is stale. */
export async function ensureServer(app: App, onProgress: (message: string) => void): Promise<"running" | "started"> {
	const before = await health(app);
	if (before.state === "up") return "running";
	if (before.state === "taken") throw new Error(`port ${app.port} answers for ${before.by}, not ${app.name}`);
	if (buildIsStale(app)) {
		onProgress(`${app.name}: building…`);
		await build(app);
	}
	onProgress(`${app.name}: starting on port ${app.port}…`);
	const pid = await spawnServer(app);
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		await sleep(250);
		if ((await health(app)).state === "up") return "started";
		if (!isAlive(pid)) break;
	}
	throw new Error(`${app.name} did not answer on port ${app.port}. Log tail:\n${logTail(app, 20)}`);
}

export async function stopServer(app: App): Promise<string> {
	const pid = readPid(app);
	if (pid === undefined || !isAlive(pid)) {
		rmSync(pidFile(app), { force: true });
		return (await health(app)).state === "up"
			? `${app.name} is running but omp did not start it; stop it where it was started`
			: `${app.name} is not running`;
	}
	// The server was spawned detached, so it leads its own process group; this also stops wrappers' children.
	process.kill(-pid, "SIGTERM");
	const deadline = Date.now() + 3000;
	while (isAlive(pid) && Date.now() < deadline) await sleep(100);
	if (isAlive(pid)) process.kill(-pid, "SIGKILL");
	rmSync(pidFile(app), { force: true });
	return `${app.name} stopped`;
}

export function serverPid(app: App): number | undefined {
	const pid = readPid(app);
	return pid !== undefined && isAlive(pid) ? pid : undefined;
}

/** Runs a manifest command from cwd with the app variables set, capturing its output. */
export function runCommand(
	app: App,
	argv: string[],
	options: { cwd: string; env?: Record<string, string>; timeoutMs: number },
): Promise<CommandResult> {
	const [cmd, ...args] = expand(argv, app);
	const { promise, resolve } = Promise.withResolvers<CommandResult>();
	const child = spawn(cmd, args, {
		cwd: options.cwd,
		env: { ...process.env, ...appVars(app), ...options.env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	let timedOut = false;
	child.stdout?.on("data", chunk => (stdout += chunk));
	child.stderr?.on("data", chunk => (stderr += chunk));
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, options.timeoutMs);
	child.once("error", err => {
		clearTimeout(timer);
		resolve({ code: null, stdout, stderr: `cannot run "${cmd}": ${err.message}`, timedOut });
	});
	child.once("close", code => {
		clearTimeout(timer);
		resolve({ code, stdout, stderr, timedOut });
	});
	return promise;
}

export function logTail(app: App, lines: number): string {
	try {
		const text = readFileSync(logFile(app), "utf8");
		return text.split("\n").slice(-lines - 1).join("\n").trimEnd() || "(log is empty)";
	} catch {
		return "(no log yet)";
	}
}

/**
 * Writes a PATH shim per `bin` entry of the given apps and removes shims of apps that are gone.
 * Returns a problem line for each name held by a file the host did not write.
 */
export function writeShims(apps: App[]): string[] {
	const dir = binDir();
	mkdirSync(dir, { recursive: true });
	const wanted = new Map<string, string>();
	for (const app of apps) {
		for (const [name, argv] of Object.entries(app.bin)) wanted.set(name, shim(app, argv));
	}
	const problems: string[] = [];
	for (const file of readdirSync(dir)) {
		const path = join(dir, file);
		if (!wanted.has(file) && readFileSync(path, "utf8").includes(SHIM_MARK)) unlinkSync(path);
	}
	for (const [name, content] of wanted) {
		const path = join(dir, name);
		const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
		if (current === content) continue;
		if (current !== undefined && !current.includes(SHIM_MARK)) {
			problems.push(`bin "${name}": ${path} exists and was not written by omp apps; left alone`);
			continue;
		}
		writeFileSync(path, content, { mode: 0o755 });
	}
	const path = process.env.PATH ?? "";
	if (!path.split(delimiter).includes(dir)) process.env.PATH = `${dir}${delimiter}${path}`;
	return problems;
}

const SHIM_MARK = "# omp-apps shim";

function shim(app: App, argv: string[]): string {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const exports = Object.entries(appVars(app)).map(([key, value]) => `export ${key}=${quote(value)}`);
	return ["#!/bin/sh", `${SHIM_MARK} for ${app.name}`, ...exports, `exec ${expand(argv, app).map(quote).join(" ")} "$@"`, ""].join(
		"\n",
	);
}

function buildIsStale(app: App): boolean {
	if (!app.build) return false;
	const output = join(app.dir, app.build.output);
	if (!existsSync(output)) return true;
	const builtAt = statSync(output).mtimeMs;
	return app.build.inputs.some(input => newestMtime(join(app.dir, input)) > builtAt);
}

async function build(app: App): Promise<void> {
	if (!app.build) return;
	mkdirSync(runDir(), { recursive: true });
	const result = await runCommand(app, app.build.run, { cwd: app.dir, timeoutMs: 10 * 60_000 });
	writeFileSync(logFile(app), `--- build ---\n${result.stdout}${result.stderr}`);
	if (result.code !== 0) {
		throw new Error(`${app.name}: build failed (${result.timedOut ? "timed out" : `exit ${result.code}`}). Log tail:\n${logTail(app, 20)}`);
	}
}

function spawnServer(app: App): Promise<number> {
	mkdirSync(runDir(), { recursive: true });
	const log = openSync(logFile(app), "a");
	const [cmd, ...args] = expand(app.start, app);
	const child = spawn(cmd, args, {
		cwd: app.dir,
		env: { ...process.env, ...appVars(app) },
		detached: true,
		stdio: ["ignore", log, log],
	});
	const { promise, resolve, reject } = Promise.withResolvers<number>();
	child.once("spawn", () => {
		closeSync(log);
		writeFileSync(pidFile(app), String(child.pid));
		child.unref();
		resolve(child.pid as number);
	});
	child.once("error", err => {
		closeSync(log);
		reject(new Error(`${app.name}: cannot run "${cmd}" (${err.message}); is it installed and on PATH?`));
	});
	return promise;
}

function readPid(app: App): number | undefined {
	try {
		const pid = Number(readFileSync(pidFile(app), "utf8").trim());
		return Number.isInteger(pid) && pid > 0 ? pid : undefined;
	} catch {
		return undefined;
	}
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function newestMtime(path: string): number {
	let stat;
	try {
		stat = statSync(path);
	} catch {
		return 0;
	}
	if (!stat.isDirectory()) return stat.mtimeMs;
	let newest = stat.mtimeMs;
	for (const entry of readdirSync(path)) {
		if (entry === "node_modules" || entry.startsWith(".")) continue;
		newest = Math.max(newest, newestMtime(join(path, entry)));
	}
	return newest;
}
