import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync("node_modules")) {
  execSync("npm install", { stdio: "inherit" });
}
execSync("npx vite build", { stdio: "inherit" });
