import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type * as Kit from "../../../kit/kit.ts";

// The host passes the kit's location in APP_KIT; an app can live in any repo, so no static path reaches it.
const kit: typeof Kit = await import(`${process.env.APP_KIT}/kit.ts`);
const env = kit.appEnv();

const [command] = process.argv.slice(2);

if (command === "init") {
	const existing = kit.findConfig(env.configPath);
	if (existing) {
		console.log(`${env.name} is already on for ${existing.root}`);
		process.exit(0);
	}
	const root = kit.findConfig(".git")?.root ?? process.cwd();
	const path = join(root, env.configPath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ label: basename(root), greeting: "hello" }, null, 2)}\n`);
	console.log(`${env.name} is on for ${root} (${path})`);
} else if (command === "digest") {
	const configPath = process.env.APP_CONFIG ?? kit.findConfig(env.configPath)?.config;
	const root = process.env.APP_ROOT ?? process.cwd();
	const config: { label?: string; greeting?: string } =
		configPath && existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
	console.log(`${config.greeting ?? "hello"} from ${config.label ?? basename(root)}; open it with /${env.name}`);
} else {
	console.error(`usage: ${env.name} init|digest`);
	process.exit(2);
}
