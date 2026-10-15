import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import { loadApp, optIn, recordOptIn, userAppsDir } from "../extension/apps.ts";
import { ensureServer } from "../extension/server.ts";

export interface Launched {
	url: string;
	root: string;
	config: string;
	started: boolean;
}

/**
 * Starts the app's server the way the host does, for CLIs that agents run (`kb up`). Records the
 * repo holding cwd as opted in first, so the server knows it. Throws when the repo has not opted in.
 */
export async function ensureAppServer(cwd: string = process.cwd(), appDir: string | undefined = process.env.APP_DIR): Promise<Launched> {
	if (!appDir) throw new Error("apphost: APP_DIR is not set; run this through the app's CLI shim");
	const isUserApp = realpathSync(dirname(appDir)) === realpathSync(userAppsDir());
	const app = isUserApp ? loadApp(appDir, "user") : loadApp(appDir, "repo", dirname(dirname(dirname(appDir))));
	const entry = optIn(app, cwd);
	if (!entry) throw new Error(`${app.name} is off in this repo; create ${app.config} at the repo root or run /${app.command} init`);
	recordOptIn(app, entry);
	const state = await ensureServer(app, message => console.error(message));
	return { url: `http://localhost:${app.port}/`, root: entry.root, config: entry.config, started: state === "started" };
}
