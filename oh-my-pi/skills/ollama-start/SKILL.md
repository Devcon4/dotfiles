---
name: ollama-start
description: Use when the user asks to start, launch, run, install, update, or boot Ollama locally. Installs the binary if missing, upgrades it in-place when the local version is older than the latest GitHub release, then brings the daemon up on 127.0.0.1:11434 and waits for readiness.
---

# Start Ollama

Bring the local Ollama daemon up and confirm it's serving on `http://127.0.0.1:11434`.

## Preflight

1. Ensure the binary is on PATH; if not, install it (see **Install if missing** below) before continuing:
   ```bash
   command -v ollama >/dev/null 2>&1 || install_ollama
   ```
2. If the binary is present, check whether it's outdated and upgrade if so (see **Update if outdated**):
   ```bash
   command -v ollama >/dev/null 2>&1 && update_ollama_if_outdated
   ```
3. Check whether it is already running. If this returns 200, **stop here** — it's up:
   ```bash
   curl -fsS http://127.0.0.1:11434/api/version
   ```

## Install if missing

`install_ollama` is the procedure invoked by the preflight when the binary isn't found. Pick the path matching the OS; ask the user before running anything that needs `sudo`.

### Linux (including WSL)

Use the official installer. It writes the binary to `/usr/local/bin/ollama` and registers a systemd unit on hosts that have systemd:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

- The script needs `sudo` internally — run it as a normal user; it will prompt.
- On WSL without systemd, the script still installs the binary but skips unit registration. That's fine — strategy **D** (manual `ollama serve`) will pick up.
- Verify after install: `command -v ollama && ollama --version`.

### macOS

Prefer Homebrew if present; otherwise direct the user to the `.dmg`:

```bash
if command -v brew >/dev/null 2>&1; then
  brew install ollama
else
  echo "Install the Ollama.app from https://ollama.com/download/mac, then re-run." >&2
  exit 1
fi
```

The `.app` bundle is GUI-only — it doesn't expose `ollama` on PATH for non-interactive shells. Homebrew's formula does, which is why it's preferred here.

### Windows (native, not WSL)

No silent install path — point the user at `https://ollama.com/download/windows` and stop. Do **NOT** attempt `winget`/`choco` without confirmation; the user may not have either configured.

### Unknown / unsupported

Fail loudly with the download URL rather than guessing:

```bash
echo "ollama auto-install not supported on $(uname -s); see https://ollama.com/download" >&2
exit 1
```

After install, **re-check** `command -v ollama` before falling through to **Start strategy**. If it's still missing, abort — do not proceed to `ollama serve`.

## Update if outdated

`update_ollama_if_outdated` checks the local version against the latest GitHub release and upgrades in-place when they differ. **Skip silently** on any network error — a stale-but-working ollama beats blocking startup on a dead network.

Compare versions:

```bash
LOCAL=$(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
LATEST=$(curl -fsSL --max-time 5 https://api.github.com/repos/ollama/ollama/releases/latest \
  | grep -oE '"tag_name":\s*"v?[0-9]+\.[0-9]+\.[0-9]+"' \
  | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)

[ -z "$LOCAL" ] || [ -z "$LATEST" ] && { echo "version check skipped"; return 0 2>/dev/null || exit 0; }
[ "$LOCAL" = "$LATEST" ] && { echo "ollama $LOCAL is current"; return 0 2>/dev/null || exit 0; }
echo "ollama $LOCAL → $LATEST: upgrading"
```

Then upgrade. **Stop the daemon first** if it's running — replacing the binary under a live process is fine on Linux but the running daemon will be the old version until restart, and in-flight pulls/generates may be killed mid-stream:

```bash
curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 && was_running=1
[ -n "$was_running" ] && { invoke ollama-stop skill; }
```

Pick the upgrade command matching how it was originally installed:

| Install path | Upgrade command |
|---|---|
| Linux/WSL via `install.sh` | `curl -fsSL https://ollama.com/install.sh \| sh` (re-running is the documented upgrade) |
| macOS via Homebrew | `brew upgrade ollama` |
| macOS `.app` bundle | Tell the user — the app self-updates on launch; CLI shipped inside the bundle follows that |
| Windows native | Tell the user to re-run the installer from `https://ollama.com/download/windows` |

Verify the upgrade landed:

```bash
NEW=$(ollama --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
[ "$NEW" = "$LATEST" ] || echo "warning: expected $LATEST, got $NEW" >&2
```

If we stopped the daemon to upgrade, the **Start strategy** below brings it back up — that's the rest of the skill's job, no special handling needed.

### When to skip the update check

- `OLLAMA_SKIP_UPDATE=1` is set in the environment — respect it, do **NOT** prompt.
- The user is on a metered/offline connection and asked to skip — same.
- The GitHub API is rate-limited (HTTP 403). Treat as "skip silently" — do not retry, do not authenticate.

## Start strategy (in order)

Pick the **first** strategy that applies. Do **NOT** fall through to the next once one succeeds.

### A. systemd service (default for the official Linux install script)

```bash
systemctl is-enabled ollama 2>/dev/null && sudo systemctl start ollama
```

If `is-enabled` returns `enabled`/`static`/`alias`, use this path. The installer script at `https://ollama.com/install.sh` registers this unit.

### B. user-level systemd unit

```bash
systemctl --user is-enabled ollama 2>/dev/null && systemctl --user start ollama
```

### C. macOS (Homebrew)

```bash
brew services start ollama
```

### D. Manual / WSL / no service manager

Run the daemon detached and capture logs. Use `nohup` so it survives the shell exiting:

```bash
mkdir -p "$HOME/.ollama/logs"
nohup ollama serve >"$HOME/.ollama/logs/serve.log" 2>&1 &
disown
echo $! > "$HOME/.ollama/ollama.pid"
```

The PID file at `~/.ollama/ollama.pid` lets `ollama-stop` find it without `pkill` heuristics.

## Wait for readiness

After starting via any path, poll the API. Fail loudly if it doesn't come up in ~15s:

```bash
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 && { echo "ollama ready"; exit 0; }
  sleep 0.5
done
echo "ollama did not become ready in 15s" >&2
tail -n 50 "$HOME/.ollama/logs/serve.log" 2>/dev/null
exit 1
```

## Common pitfalls

- **Port already bound.** If `:11434` is taken by an old run, `ollama serve` exits immediately. Check with `ss -ltnp 'sport = :11434'` (Linux) or `lsof -iTCP:11434 -sTCP:LISTEN` (macOS) and stop the offending process first via the `ollama-stop` skill.
- **GPU not visible inside WSL.** That's a host-driver issue, not Ollama's — the daemon still starts on CPU. Mention it; do not block.
- **Custom host/port.** Respect `OLLAMA_HOST` if set; substitute it for `127.0.0.1:11434` in every health check above.
