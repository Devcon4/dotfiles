import { existsSync, readFileSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";

export const HOST_VERSION = 1;

export interface IndexEntry {
	root: string;
	config: string;
}

export interface AppEnv {
	name: string;
	dir: string;
	port: number;
	index: string;
	configPath: string;
}

export type HeaderGetter = (name: string) => string | null | undefined;

/** The variables the host sets for servers and CLIs. Throws when one is missing. */
export function appEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
	const port = Number(env.APP_PORT);
	const { APP_NAME: name, APP_DIR: dir, APP_INDEX: index, APP_CONFIG_PATH: configPath } = env;
	if (!name || !dir || !index || !configPath || !Number.isInteger(port)) {
		throw new Error("apphost: APP_NAME, APP_DIR, APP_PORT, APP_INDEX and APP_CONFIG_PATH must be set; start the app through omp");
	}
	return { name, dir, port, index, configPath };
}

/** Repos opted into the app, as recorded by the host. A missing or unreadable index means none. */
export function readIndex(path: string): IndexEntry[] {
	try {
		const data = JSON.parse(readFileSync(path, "utf8")) as { entries?: unknown };
		return Array.isArray(data.entries) ? data.entries.filter(isEntry) : [];
	} catch {
		return [];
	}
}

/** Calls onChange with the entries now and after every change to the index file. Returns a stop function. */
export function watchIndex(path: string, onChange: (entries: IndexEntry[]) => void, intervalMs = 1000): () => void {
	let last = mtimeOf(path);
	onChange(readIndex(path));
	const timer = setInterval(() => {
		const now = mtimeOf(path);
		if (now === last) return;
		last = now;
		onChange(readIndex(path));
	}, intervalMs);
	timer.unref?.();
	return () => clearInterval(timer);
}

/** The nearest ancestor of cwd that holds relPath (an app's opt-in file), or undefined. */
export function findConfig(relPath: string, cwd: string = process.cwd()): IndexEntry | undefined {
	let dir = resolve(cwd);
	for (;;) {
		const config = join(dir, relPath);
		if (existsSync(config)) return { root: dir, config };
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/** The body of `GET /_app/health`; the host matches `app` against the manifest name. */
export function healthPayload(name: string): { app: string; host: number } {
	return { app: name, host: HOST_VERSION };
}

/**
 * Access rules every app server applies before routing. Returns undefined when the request may
 * proceed, else the status and message to answer with.
 */
export function checkRequest(method: string, header: HeaderGetter): { status: number; error: string } | undefined {
	if (!isLocalHost(header("host"))) return { status: 403, error: "host not allowed" };
	if (method === "GET" || method === "HEAD" || method === "OPTIONS") return undefined;
	if (!hasBody(header)) return undefined;
	const type = (header("content-type") ?? "").toLowerCase();
	// A JSON body forces a CORS preflight on cross-origin pages, and these servers never approve one.
	if (!type.startsWith("application/json")) return { status: 415, error: "request bodies must be application/json" };
	return undefined;
}

function hasBody(header: HeaderGetter): boolean {
	if (header("transfer-encoding")) return true;
	return Number(header("content-length") ?? 0) > 0;
}

function isLocalHost(host: string | null | undefined): boolean {
	if (!host) return false;
	return localNames().has(hostName(host));
}

function hostName(host: string): string {
	if (host.startsWith("[")) return host.slice(1, host.indexOf("]")).toLowerCase();
	const colon = host.lastIndexOf(":");
	return (colon === -1 ? host : host.slice(0, colon)).toLowerCase();
}

function localNames(): Set<string> {
	const names = new Set(["localhost", "127.0.0.1", "::1"]);
	for (const addrs of Object.values(networkInterfaces())) {
		for (const addr of addrs ?? []) names.add(addr.address.toLowerCase());
	}
	return names;
}

function isEntry(value: unknown): value is IndexEntry {
	const e = value as IndexEntry;
	return typeof e?.root === "string" && typeof e?.config === "string";
}

function mtimeOf(path: string): number {
	try {
		return statSync(path).mtimeMs;
	} catch {
		return 0;
	}
}
