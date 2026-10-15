import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { readIndex } from "../kit/kit.ts";
import {
	discoverApps,
	indexFile,
	isTrusted,
	optIn,
	pruneIndex,
	recordOptIn,
	trust,
	userAppsDir,
	type App,
} from "./apps.ts";
import { ensureServer, health, logFile, logTail, runCommand, serverPid, stopServer, writeShims } from "./server.ts";

type Level = "info" | "warning" | "error";

interface Ctx {
	cwd: string;
	ui: { notify(message: string, level?: Level): void };
}

interface SessionCtx extends Ctx {
	agent?: { kind: string };
	sessionManager: { getBranch(): Array<{ type: string; customType?: string; content?: unknown }> };
}

/** The part of omp's ExtensionAPI this extension uses, declared here so the plugin needs no omp package install. */
interface HostAPI {
	registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: Ctx) => Promise<void> }): void;
	on(event: "session_start", handler: (event: unknown, ctx: SessionCtx) => Promise<void>): void;
	sendMessage(
		message: { customType: string; content: string; display: boolean },
		options?: { deliverAs?: "steer" | "followUp" | "nextTurn" | "aside"; triggerTurn?: boolean },
	): void;
}

export default function apphost(pi: HostAPI): void {
	const { apps, problems } = discoverApps(process.cwd());
	try {
		problems.push(...writeShims(apps));
	} catch (err) {
		problems.push(`bin shims: ${(err as Error).message}`);
	}
	const show = (text: string) => pi.sendMessage({ customType: "omp-apps", content: text, display: true });

	for (const app of apps) {
		pi.registerCommand(app.command, {
			description: `${app.description} (subcommands: init, stop, restart, status, logs)`,
			handler: async (args, ctx) => {
				try {
					await appCommand(app, args, ctx, show);
				} catch (err) {
					ctx.ui.notify((err as Error).message, "error");
				}
			},
		});
	}

	pi.registerCommand("apps", {
		description: "List omp apps; /apps stop|restart|logs|trust <app>, /apps prune",
		handler: async (args, ctx) => {
			try {
				await appsCommand(apps, problems, args, ctx, show);
			} catch (err) {
				ctx.ui.notify((err as Error).message, "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.agent?.kind === "sub") return;
		if (problems.length > 0) ctx.ui.notify(`omp apps: ${problems.length} problem(s), see /apps`, "warning");
		await Promise.all(apps.map(app => injectDigest(pi, app, ctx)));
	});
}

async function appCommand(app: App, args: string, ctx: Ctx, show: (text: string) => void): Promise<void> {
	const sub = args.trim().split(/\s+/)[0] ?? "";
	switch (sub) {
		case "":
			return openApp(app, ctx);
		case "init":
			return initApp(app, ctx);
		case "stop":
			return ctx.ui.notify(await stopServer(app), "info");
		case "restart":
			ctx.ui.notify(await stopServer(app), "info");
			return openApp(app, ctx);
		case "status":
			return show(await describe(app, ctx.cwd, true));
		case "logs":
			return show(`${app.name} log (${logFile(app)}):\n${logTail(app, 40)}`);
		default:
			ctx.ui.notify(`usage: /${app.command} [init|stop|restart|status|logs]`, "warning");
	}
}

async function appsCommand(apps: App[], problems: string[], args: string, ctx: Ctx, show: (text: string) => void): Promise<void> {
	const [sub = "", name] = args.trim().split(/\s+/).filter(Boolean);
	if (sub === "") {
		const lines = [`omp apps (user apps in ${userAppsDir()})`];
		for (const app of apps) lines.push(await describe(app, ctx.cwd, false));
		if (apps.length === 0) lines.push("- none installed");
		if (problems.length > 0) lines.push("problems:", ...problems.map(p => `- ${p}`));
		return show(lines.join("\n"));
	}
	if (sub === "prune") {
		const dropped = apps.flatMap(app => pruneIndex(app).map(e => `${app.name}: ${e.root}`));
		return show(dropped.length > 0 ? `pruned:\n${dropped.join("\n")}` : "nothing to prune");
	}
	const app = apps.find(a => a.name === name || a.command === name);
	if (!app) return ctx.ui.notify(`usage: /apps ${sub} <app>; "${name ?? ""}" is not an installed app`, "warning");
	switch (sub) {
		case "stop":
			return ctx.ui.notify(await stopServer(app), "info");
		case "restart":
			ctx.ui.notify(await stopServer(app), "info");
			return openApp(app, ctx);
		case "logs":
			return show(`${app.name} log (${logFile(app)}):\n${logTail(app, 40)}`);
		case "trust":
			if (app.source !== "repo") return ctx.ui.notify(`${app.name} is a user app; nothing to trust`, "info");
			trust(app);
			for (const problem of writeShims(apps)) ctx.ui.notify(problem, "warning");
			return ctx.ui.notify(`${app.name}: digest and CLI allowed for ${app.repoRoot}`, "info");
		default:
			ctx.ui.notify("usage: /apps [stop|restart|logs|trust <app>] [prune]", "warning");
	}
}

async function openApp(app: App, ctx: Ctx): Promise<void> {
	const entry = optIn(app, ctx.cwd);
	if (!entry) {
		const how = app.init ? `run /${app.command} init` : `create ${app.config} at the repo root`;
		return ctx.ui.notify(`${app.name} is off in this repo; ${how} to turn it on`, "warning");
	}
	recordOptIn(app, entry);
	await ensureServer(app, message => ctx.ui.notify(message, "info"));
	const url = await pageUrl(app, entry.root);
	const opened = openBrowser(url);
	ctx.ui.notify(`${app.name}: ${url}${opened ? "" : " (open it in a browser)"}`, "info");
}

async function initApp(app: App, ctx: Ctx): Promise<void> {
	if (!app.init) return ctx.ui.notify(`${app.name} has no init command; create ${app.config} at the repo root`, "warning");
	const result = await runCommand(app, app.init, { cwd: ctx.cwd, timeoutMs: 60_000 });
	const output = `${result.stdout}${result.stderr}`.trim();
	if (result.code !== 0) {
		return ctx.ui.notify(`${app.name} init failed: ${output || `exit ${result.code}`}`, "error");
	}
	const entry = optIn(app, ctx.cwd);
	if (entry) recordOptIn(app, entry);
	ctx.ui.notify(output || `${app.name} is on in this repo`, "info");
}

async function describe(app: App, cwd: string, detailed: boolean): Promise<string> {
	const state = await health(app);
	const pid = serverPid(app);
	const server =
		state.state === "up" ? `running${pid ? `, pid ${pid}` : ""}` : state.state === "down" ? "stopped" : `port taken by ${state.by}`;
	const here = optIn(app, cwd);
	const entries = readIndex(indexFile(app));
	const line =
		`- ${app.name} (/${app.command}, ${app.source} app, port ${app.port}): ${server}; ` +
		`${here ? "on" : "off"} in this repo; ${entries.length} repo(s) opted in`;
	if (!detailed) return line;
	return [line, `  folder: ${app.dir}`, `  opt-in file: ${app.config}`, `  log: ${logFile(app)}`, ...entries.map(e => `  repo: ${e.root}`)].join(
		"\n",
	);
}

async function pageUrl(app: App, root: string): Promise<string> {
	const fallback = `http://localhost:${app.port}/`;
	try {
		const res = await fetch(`http://127.0.0.1:${app.port}/_app/open?root=${encodeURIComponent(root)}`, {
			signal: AbortSignal.timeout(2000),
		});
		const body = (await res.json()) as { url?: unknown };
		return res.ok && typeof body.url === "string" ? body.url : fallback;
	} catch {
		return fallback;
	}
}

async function injectDigest(pi: HostAPI, app: App, ctx: SessionCtx): Promise<void> {
	const entry = optIn(app, ctx.cwd);
	if (!entry) return;
	recordOptIn(app, entry);
	if (!app.digest) return;
	if (!isTrusted(app)) {
		return ctx.ui.notify(`${app.name} is a repo app with a digest; /apps trust ${app.name} to allow it`, "info");
	}
	const result = await runCommand(app, app.digest, {
		cwd: entry.root,
		env: { APP_ROOT: entry.root, APP_CONFIG: entry.config },
		timeoutMs: 10_000,
	});
	const text = result.stdout.trim();
	if (result.code !== 0) {
		const reason = result.timedOut ? "timed out" : (result.stderr.trim() || `exit ${result.code}`).slice(0, 300);
		return ctx.ui.notify(`${app.name} digest failed: ${reason}`, "warning");
	}
	if (!text) return;
	const customType = `omp-apps.digest.${app.name}`;
	const content = `${app.name} app digest for ${entry.root}:\n${text}`;
	const previous = ctx.sessionManager.getBranch().filter(e => e.type === "custom_message" && e.customType === customType).at(-1);
	if (previous?.content === content) return;
	pi.sendMessage({ customType, content, display: false }, { deliverAs: "nextTurn" });
}

function openBrowser(url: string): boolean {
	if (process.env.OMP_APPS_NO_BROWSER) return false;
	const onPath = (cmd: string) => (process.env.PATH ?? "").split(delimiter).some(dir => existsSync(join(dir, cmd)));
	const argv = onPath("wslview")
		? ["wslview", url]
		: onPath("cmd.exe")
			? ["cmd.exe", "/c", "start", url]
			: onPath("xdg-open")
				? ["xdg-open", url]
				: undefined;
	if (!argv) return false;
	const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore" });
	child.on("error", () => {});
	child.unref();
	return true;
}
