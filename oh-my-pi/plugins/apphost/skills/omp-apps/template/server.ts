import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { basename } from "node:path";
import type * as Kit from "../../../kit/kit.ts";

// The host passes the kit's location in APP_KIT; an app can live in any repo, so no static path reaches it.
const kit: typeof Kit = await import(`${process.env.APP_KIT}/kit.ts`);
const env = kit.appEnv();

interface Space {
	label: string;
	root: string;
	greeting: string;
}

let spaces: Space[] = [];
kit.watchIndex(env.index, entries => {
	spaces = entries.flatMap(entry => {
		// A repo app is on without a config file, so a missing file means defaults.
		let config: { label?: string; greeting?: string } = {};
		try {
			if (existsSync(entry.config)) config = JSON.parse(readFileSync(entry.config, "utf8"));
		} catch {
			console.error(`${entry.config}: not valid JSON; skipped`);
			return [];
		}
		return [{ label: config.label ?? basename(entry.root), root: entry.root, greeting: config.greeting ?? "hello" }];
	});
});

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
	const denied = kit.checkRequest(req.method ?? "GET", name => req.headers[name] as string | undefined);
	if (denied) return send(res, denied.status, { error: denied.error });
	const url = new URL(req.url ?? "/", "http://localhost");

	if (url.pathname === "/_app/health") return send(res, 200, kit.healthPayload(env.name));
	if (url.pathname === "/_app/open") {
		const space = spaces.find(s => s.root === url.searchParams.get("root"));
		return send(res, 200, { url: `http://localhost:${env.port}/${space ? `${space.label}/` : ""}` });
	}
	if (url.pathname === "/") {
		const items = spaces.map(s => `<li><a href="/${s.label}/">${s.label}</a> <small>${s.root}</small></li>`).join("");
		return html(res, `<h1>${env.name}</h1><ul>${items || "<li>no repo has opted in yet</li>"}</ul>`);
	}
	const space = spaces.find(s => url.pathname === `/${s.label}/`);
	if (space) return html(res, `<p><a href="/">all</a></p><h1>${space.greeting}, ${space.label}</h1><p>${space.root}</p>`);
	send(res, 404, { error: "not found" });
});

// All interfaces: WSL's localhost forwarding to a 127.0.0.1 socket can wedge after a restart.
server.listen(env.port, "0.0.0.0", () => console.log(`${env.name} on http://localhost:${env.port}/`));

function send(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

function html(res: ServerResponse, body: string): void {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(`<!doctype html><meta charset="utf-8">${body}`);
}
