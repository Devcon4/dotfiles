import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type * as Kit from "../../plugins/apphost/kit/kit.ts";
import type * as Launch from "../../plugins/apphost/kit/launch.ts";

// The host passes the kit's location in APP_KIT; an app can live in any repo, so no static path reaches it.
const kit: typeof Kit = await import(`${process.env.APP_KIT}/kit.ts`);
const { ensureAppServer }: typeof Launch = await import(`${process.env.APP_KIT}/launch.ts`);
const env = kit.appEnv();

const [command = "up"] = process.argv.slice(2);

if (command === "up") {
  const launched = await ensureAppServer(process.cwd(), env.dir).catch((err: Error) => {
    console.error(`moodboard: ${err.message}`);
    process.exit(1);
  });
  let collectionUrl = launched.url;
  try {
    const res = await fetch(`http://127.0.0.1:${env.port}/_app/open?root=${encodeURIComponent(launched.root)}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data: unknown = await res.json().catch(() => null);
      if (data && typeof data === "object" && "url" in data && typeof data.url === "string") {
        collectionUrl = data.url;
      }
    }
  } catch {
    // Server request failed, fall through to config check
  }
  if (collectionUrl === `http://localhost:${env.port}/` || collectionUrl === `http://127.0.0.1:${env.port}/`) {
    try {
      if (existsSync(launched.config)) {
        const text = readFileSync(launched.config, "utf8");
        const cfg: unknown = JSON.parse(text);
        if (cfg && typeof cfg === "object" && "collection" in cfg && typeof cfg.collection === "string") {
          collectionUrl = `http://localhost:${env.port}/${cfg.collection}/`;
        }
      }
    } catch {
      // Keep base URL when config cannot be read
    }
  }
  console.log(collectionUrl);
} else if (command === "init") {
  const existing = kit.findConfig(env.configPath);
  if (existing) {
    console.log(`${env.name} is already on for ${existing.root}`);
    process.exit(0);
  }
  const root = kit.findConfig(".git")?.root ?? process.cwd();
  const path = join(root, env.configPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify({ collection: basename(root), dataDir: "docs/moodboards" }, null, 2)}\n`,
  );
  console.log(`${env.name} is on for ${root} (${path})`);
} else if (command === "status") {
  try {
    const res = await fetch(`http://127.0.0.1:${env.port}/_app/health`, { signal: AbortSignal.timeout(1000) });
    const body: unknown = await res.json().catch(() => null);
    if (body && typeof body === "object" && "app" in body && body.app === env.name) {
      console.log(`${env.name} is running on port ${env.port}`);
      process.exit(0);
    }
  } catch {
    // Falls through to not running
  }
  console.log(`${env.name} is not running`);
} else {
  console.error(`usage: ${env.name} [up|init|status]`);
  process.exit(2);
}
