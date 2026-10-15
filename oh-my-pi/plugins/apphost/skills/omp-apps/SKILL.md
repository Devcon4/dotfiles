---
name: omp-apps
description: "Build, add, port or debug an omp app: a local web app (kanban, moodboard, a dashboard, a previewer) that the omp app host runs for every repo that opts in. Use when asked to make a tool with its own browser UI available across repos or in one repo, to turn an existing local server into an app, to opt a repo into an app, or when /apps reports a problem. Covers the manifest, the host contract, runtimes, opt-in configs, and how to verify an app."
argument-hint: "What the app does, e.g. 'a dialogue previewer for shrike' or 'port the kanban server'"
---

# omp apps

The app host is an omp extension (the `omp-apphost` plugin). It finds apps, checks which ones
a repo opted into, runs one server per app for all those repos, and gives each app a slash
command, an optional session-start digest and optional CLI commands. It knows nothing about
what an app shows. Each app owns its config format, its words for things (projects,
collections, sessions), its URLs and its UI.

## User app or repo app

| Kind | Lives in | Available in | Opt-in |
| --- | --- | --- | --- |
| User app | `~/.omp/agent/apps/<name>/` (a symlink to `<dotfiles>/oh-my-pi/apps/`) | every repo | the repo commits the app's config file |
| Repo app | `<repo>/.omp/apps/<name>/` | that repo only | none; on in its own repo |

Make a user app when the tool is useful in more than one repo. Make a repo app for a one-off
tool tied to one codebase. A repo app's digest and CLI shims stay off until the dev runs
`/apps trust <name>`, because it is code from the repo. After that its shims stay on PATH in
every shell, including omp sessions started in other repos.

## Add an app

1. Copy `skill://omp-apps/template` to the app folder and rename it.
2. Edit `app.json` (below). Pick a free port: run `/apps` to see the ports in use; kanban
   uses 5174 and moodboard 5173.
3. Decide the opt-in config: its file (default `.omp/apps/<name>.json`) and its fields. The
   host never reads it; only the app does. Use the app's own words for its fields.
4. Write the server against the contract below. Keep the app's data in the opted-in repos,
   at paths the config names, so it lands in each repo's git history.
5. Write the app's own `SKILL.md` in the app folder, for agents using the app (its CLI, its
   data files, its conventions). omp finds it through `skills.customDirectories`. A repo
   app's skill goes in the repo's `.omp/skills/<name>/SKILL.md` instead.
6. Restart omp: commands register when the extension loads. Then verify (below).

## Manifest: `app.json`

```json
{
  "host": 1,
  "name": "hello",
  "description": "Example omp app: lists the repos that opted in",
  "command": "hello",
  "port": 5199,
  "config": ".omp/apps/hello.json",
  "start": ["node", "server.ts"],
  "build": { "run": ["npm", "run", "build"], "output": "dist/index.html", "inputs": ["src", "index.html"] },
  "init": ["node", "${APP_DIR}/cli.ts", "init"],
  "digest": ["node", "${APP_DIR}/cli.ts", "digest"],
  "bin": { "hello": ["node", "${APP_DIR}/cli.ts"] }
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `host` | yes | Contract version; `1`. |
| `name` | yes | `[a-z][a-z0-9-]*`, unique across apps. Names the index, PID and log files. |
| `description` | no | Shown in the slash-command list. |
| `command` | no | Slash command; defaults to `name`. `apps` is reserved. |
| `port` | yes | Fixed port, unique across apps. |
| `config` | no | Opt-in file relative to a repo root; default `.omp/apps/<name>.json`. |
| `start` | yes | Server argv, run from the app folder. |
| `build` | no | Runs before start when `output` is missing or older than any `inputs` path. |
| `init` | no | Run by `/<command> init` from the session's directory; should write the opt-in config. |
| `digest` | no | Run at session start from the repo root; its stdout is added to the model's context. |
| `bin` | no | CLI commands put on PATH as shims (user apps, and repo apps once trusted). |

Every argv is exec'd without a shell. `${APP_DIR}` expands to the app folder; use it in
`init`, `digest` and `bin`, which run from a repo, not from the app folder.

## Environment

Every app process gets these variables:

| Variable | Value |
| --- | --- |
| `APP_NAME`, `APP_DIR`, `APP_PORT` | from the manifest |
| `APP_CONFIG_PATH` | the opt-in file path relative to a repo root |
| `APP_INDEX` | JSON file listing every opted-in repo: `{ "entries": [{ "root", "config" }] }` |
| `APP_KIT` | folder holding `kit.ts` (TypeScript helpers below) |
| `APP_HOST_VERSION` | `1` |
| `APP_ROOT`, `APP_CONFIG` | digest only: the current repo root and its config file |

## Server contract

- Serve every opted-in repo from one process. Read `APP_INDEX` at start and again when it
  changes; the host appends a repo the first time it is opened or a session starts in it.
- Answer `GET /_app/health` with `{ "app": "<name>" }`. The host uses it to tell your server
  from another program on the port.
- Answer `GET /_app/open?root=<repo root>` with `{ "url": "<page for that repo>" }`. The URL
  layout is yours, for example `/<project>/`.
- Before routing, reject requests whose Host header is not a local name (`localhost`,
  `127.0.0.1`, `::1`, or a local interface address) with 403, and requests with a body that
  is not `application/json` with 415. A JSON body forces a CORS preflight on a page from
  another origin, and the server must never approve one. A body-less `DELETE` passes.
- Bind `0.0.0.0`. WSL's localhost forwarding to a 127.0.0.1 socket can wedge after a restart.
- Log to stdout and stderr; the host writes them to the app's log file.

The template's `server.ts` does all of this in about 50 lines.

## Kit (TypeScript)

Import it from `APP_KIT`, because an app can live in any repo:

```ts
import type * as Kit from "../../plugins/apphost/kit/kit.ts";   // editor types only; fix the relative path
const kit: typeof Kit = await import(`${process.env.APP_KIT}/kit.ts`);
```

| Export | Use |
| --- | --- |
| `appEnv()` | the `APP_*` variables, typed; throws when started outside the host |
| `readIndex(path)`, `watchIndex(path, onChange)` | opted-in repos, now and on change |
| `findConfig(relPath, cwd?)` | nearest ancestor of cwd holding the opt-in file; for CLIs |
| `checkRequest(method, header)` | the access rules; returns `{ status, error }` to refuse |
| `healthPayload(name)` | the `/_app/health` body |

`${APP_KIT}/launch.ts` exports `ensureAppServer(cwd?)` for app CLIs: agents cannot run slash
commands, so a CLI such as `kb up` calls it to record the current repo and start the server
the way the host does. It returns `{ url, root, config, started }` and throws when the repo
has not opted in.

Both files use only `node:` built-ins, so they run under node 24 or later and Bun.

## Runtimes

The host runs argvs, so any language works. A server in another language implements the
contract itself (the two routes, the access rules, reading `APP_INDEX`).

| Runtime | `start` | `build` |
| --- | --- | --- |
| node 24+ | `["node", "server.ts"]` | `["npm", "run", "build"]` for a bundled client |
| Bun | `["bun", "server.ts"]` | |
| Go | `["./bin/server"]` | `{ "run": ["go", "build", "-o", "bin/server", "."], "output": "bin/server", "inputs": ["."] }` |
| .NET | `["dotnet", "bin/app/App.dll"]` | `{ "run": ["dotnet", "build", "-o", "bin/app"], "output": "bin/app/App.dll", "inputs": ["src"] }` |
| Python (uv) | `["uv", "run", "server.py"]` | |

Prefer a build step plus a compiled `start` over `go run` or `dotnet run`, so a restart does
not recompile. The tool must be on PATH; the host reports "cannot run" otherwise.

## Commands

- `/<command>`: start the server if needed and open this repo's page. Says how to opt in when
  the repo has no config.
- `/<command> init | stop | restart | status | logs`
- `/apps`: apps, ports, servers, which repos opted in, and discovery problems.
- `/apps stop | restart | logs | trust <app>`, `/apps prune` (drops repos whose config is gone).

## Verify a new or changed app

1. `/apps` lists it with no problems.
2. In a repo, `/<command> init` (or create the config), then `/<command>`; the page opens.
3. `curl -s localhost:<port>/_app/health` returns the app name.
4. `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' localhost:<port>/` returns 403.
5. `curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: text/plain' -d x localhost:<port>/` returns 415.
6. With a `digest`, start a new omp session in the repo and check the digest reached the
   model (ask it, or read the session).
7. `/<command> logs` after a failure; `/<command> restart` after editing the server.

## Files the host keeps

- `${XDG_STATE_HOME:-~/.local/state}/omp-apps/<name>.json`: the index of opted-in repos.
- `${XDG_STATE_HOME:-~/.local/state}/omp-apps/trust.json`: repo apps allowed to run a digest.
- `${XDG_RUNTIME_DIR:-/tmp}/omp-apps/<name>.{pid,log}`: server PID and log.
- `${XDG_DATA_HOME:-~/.local/share}/omp-apps/bin/`: `bin` shims; on PATH for omp and shells.
