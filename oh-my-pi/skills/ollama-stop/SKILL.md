---
name: ollama-stop
description: Use when the user asks to stop, shut down, kill, or quit the local Ollama daemon. Mirrors the start strategy (systemd / brew / manual PID file) and verifies the port is released.
---

# Stop Ollama

Shut the local Ollama daemon down cleanly. Mirror whichever strategy `ollama-start` used.

## Preflight

If the API is already unreachable, there is nothing to stop:
```bash
curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 || { echo "ollama already stopped"; exit 0; }
```

## Stop strategy (in order)

Try each in order. Stop at the first one that brings the port down.

### A. systemd (system)
```bash
systemctl is-enabled ollama 2>/dev/null && sudo systemctl stop ollama
```

### B. systemd (user)
```bash
systemctl --user is-enabled ollama 2>/dev/null && systemctl --user stop ollama
```

### C. macOS (Homebrew)
```bash
brew services stop ollama
```

### D. PID file from manual `ollama serve`
```bash
PIDFILE="$HOME/.ollama/ollama.pid"
if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID"
    for i in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID"
  fi
  rm -f "$PIDFILE"
fi
```

### E. Last resort — find by port

Only if A–D didn't apply (e.g. user started it by hand without our PID file):
```bash
# Linux
PID=$(ss -ltnpH 'sport = :11434' 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -n1)
# macOS fallback
[ -z "$PID" ] && PID=$(lsof -tiTCP:11434 -sTCP:LISTEN 2>/dev/null | head -n1)
[ -n "$PID" ] && kill "$PID"
```

You **MUST NOT** `pkill ollama` blindly — it also kills `ollama run`/`ollama pull` clients the user may have open in another shell.

## Verify

```bash
for i in $(seq 1 20); do
  curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 || { echo "ollama stopped"; exit 0; }
  sleep 0.25
done
echo "ollama still responding after 5s" >&2
exit 1
```

## Notes

- Stopping does **not** unload models from disk; it only frees VRAM/RAM. Pulled models stay in `~/.ollama/models/`.
- Respect `OLLAMA_HOST` for the health-check URL if it's set.
