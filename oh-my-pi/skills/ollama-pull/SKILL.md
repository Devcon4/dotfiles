---
name: ollama-pull
description: Use when the user asks to pull, download, fetch, or install an Ollama model (e.g. "pull llama3.1", "get qwen2.5-coder:7b"). Validates the daemon is up, pulls the tag, and verifies it landed in the local registry.
---

# Pull an Ollama model

Download a model into the local Ollama registry. The daemon **MUST** be running — pull goes through the HTTP API on `127.0.0.1:11434`.

## Inputs

- `MODEL` — the tag to pull (e.g. `llama3.1`, `llama3.1:8b`, `qwen2.5-coder:7b-instruct`).
  - If the user says just "llama3" without a size, ask which tag they want or default to the unsuffixed tag (Ollama resolves it to its `latest` alias).
  - **Never invent tag names.** If unsure, list candidates from `https://ollama.com/library/<name>/tags` first.

## Procedure

1. **Confirm daemon is up** (otherwise invoke the `ollama-start` skill first):
   ```bash
   curl -fsS http://127.0.0.1:11434/api/version >/dev/null || { echo "ollama not running"; exit 1; }
   ```

2. **Pull**, streaming progress to the user:
   ```bash
   ollama pull "$MODEL"
   ```
   The CLI streams layer-by-layer progress. Don't redirect stdout — the user wants to see it.

3. **Verify it registered**:
   ```bash
   ollama list | awk -v m="$MODEL" 'NR>1 && $1==m {found=1} END{exit !found}'
   ```
   If the user passed a bare name (no `:tag`), match either `MODEL` or `MODEL:latest`.

## Failure modes

- **`pull model manifest: file does not exist`** — tag is wrong. Surface the error verbatim and suggest checking `https://ollama.com/library/<name>/tags`.
- **Disk full mid-pull.** Ollama leaves a partial blob in `~/.ollama/models/blobs/`. A subsequent `ollama pull` resumes from it; do **NOT** wipe the directory unless the user explicitly asks.
- **Network/proxy.** Respect `HTTPS_PROXY` / `HTTP_PROXY` env vars; if pulls hang at 0%, ask whether a proxy is required.
- **Custom registry.** If `OLLAMA_HOST` points elsewhere, the pull goes there — flag this to the user before a long download.

## After pulling

Briefly report:
- model name + tag
- size on disk (`ollama list` column)
- a one-line ready-to-run example: `ollama run "$MODEL"` or a `curl` against `/api/generate`.
