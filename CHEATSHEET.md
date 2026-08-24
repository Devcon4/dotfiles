# Cheatsheet

The non-obvious stuff. Everything here works out of the box with this repo's
configs — muscle-memory upgrades over the stock equivalents.

## Getting around (stop typing `cd`)

| Instead of | Do | Notes |
|---|---|---|
| `cd ~/code/mdm` | `z mdm` | zoxide: fuzzy-jumps to the most [frecent](https://en.wikipedia.org/wiki/Frecency) match from *anywhere* |
| remembering the path | `zi mdm` | interactive picker (fzf) over all matching dirs |
| `cd -` | `z -` | back to previous dir |
| `cd some/dir` | `some/dir` | `autocd`: a bare path *is* a cd |
| browsing for a dir | `Alt+C` | fzf: fuzzy-pick a subdirectory, cd into it |

zoxide learns from every `cd`/`z` you do — it gets better the longer you use it.

## History & line editing

| Key | Effect |
|---|---|
| `Ctrl+R` | fzf fuzzy search over 100k lines of history |
| `Up`/`Down` | history filtered by what you already typed (`git ` + Up cycles git commands only) |
| `→` or `End` | accept the gray ghost-text suggestion (from history) |
| `Ctrl+→` | accept the suggestion one word at a time |
| ` cmd` (leading space) | keep a command out of history (secrets, one-offs) |

Syntax highlighting is a live linter: the command name turns **green** when
it resolves, stays **red** while it doesn't — catch typos before Enter.
History is shared live across all panes/tabs (`sharehistory`).

## Files

| Command | What |
|---|---|
| `ls` / `ll` / `la` | eza with icons, dirs first; `ll`/`la` add git status column |
| `lt` | tree view, 2 levels |
| `Ctrl+T` | fzf: fuzzy-pick file path(s), inserted at cursor — e.g. type `vim `, hit Ctrl+T |
| `cls` | clear |

## Docker & TUIs

- `lzd` → **lazydocker**: containers/images/volumes/logs in one TUI.
  Arrow keys + Enter to drill in, `x` shows every keybinding for the current
  panel. Faster than any `docker ps`/`docker logs -f` incantation.
- `docker` CLI works against the same daemon when you need scripting.

## Kubernetes (strix)

- Interactive shells carry the **admin** kubeconfig (exported at the bottom
  of `.zshrc`) — `kubectl`, `helm`, `flux` just work.
- `kro get pods ...` — same kubectl, but explicitly through the **readonly**
  config; use it when you want a guaranteed-safe look.
- Agents never get admin, enforced three ways: the `omp` alias launches the
  harness with readonly `KUBECONFIG`; the `kube-admin-guard` extension
  rewrites every agent `kubectl`/`helm`/`flux`/`k9s` call to inject the
  readonly config (so raw `kubectl` from an agent *is* `kro`) and blocks
  mutating verbs, `talosctl`, and any admin-credential reference outright.

## Windows Terminal

| Key | Effect |
|---|---|
| `Alt+Q` | global summon — show/hide the terminal from *any* app (quake mode) |
| `Ctrl+Alt` `+` / `-` | split current pane with **Ubuntu** right / down |
| `Ctrl+Shift` `+` / `-` | split with **PowerShell** right / down |
| `Alt+Shift+D` | duplicate current pane |
| `Alt+Z` | zoom pane to full window (again to restore) |
| `Alt+←→↑↓` | move focus between panes (WT default) |
| `Ctrl+C` / `Ctrl+V` | copy/paste (copy still sends SIGINT when nothing is selected) |

## Oh My Pi (`omp`)

| Command | What |
|---|---|
| `omp` | interactive session in the current repo |
| `omp -c` | continue the previous session |
| `omp -r` | resume via session picker (or `-r <id-prefix>`) |
| `omp -p "question"` | non-interactive one-shot: answer and exit |
| `omp --model opus` | fuzzy model pick for this session; `Ctrl+P` cycles models in-TUI |
| `!cmd` (in TUI) | run a shell command inline without the model seeing/paying for it |
| `@path/file` (in TUI) | attach a file to the message (fuzzy autocomplete) |
| `/tail` (in TUI) | **custom extension** (`launch-viewer.ts`): fullscreen picker over hub-launched processes *and* running docker containers, then follow the chosen log — spinners/ANSI colors render properly |
| `/tail <name>` | skip the picker, straight to that process/container log |
| `/tail <path>` | follow any file (`/tail ~/.omp/logs/...`, `/tail ./out.log`) — anything with a `/`, `.`, or `~` is treated as a path |
| `tail -f ~/.omp/logs/omp.$(date +%F).*.log` | live harness logs (extension loads, tool errors) |

## WSL ⇄ Windows interop

| Command (from WSL) | What |
|---|---|
| `code .` | VS Code on Windows, attached to this Linux dir via Remote-WSL |
| `explorer.exe .` | open current dir in Windows Explorer |
| `cmd \| clip.exe` | pipe into the Windows clipboard |
| `wslpath 'C:\Users\...'` | convert Windows ⇄ Linux paths |
| `powershell.exe -c ...` / `pwsh.exe` | run something on the Windows side |

From Windows, the distro is a UNC share: `\\wsl.localhost\Ubuntu\home\dev\...`
(that's how the PowerShell prompts read the theme). After editing
`.wslconfig`: `wsl --shutdown` from PowerShell, reopen terminals.

## Project tooling

- `just` — per-repo task runner; `just --list` shows a repo's recipes.
- `yq` — jq for YAML: `yq '.spec.replicas' deploy.yml`.
- `sops` + `age` — encrypted secrets in git (GitOps repos).
- `volta pin node@24` — pin a node version *into* a repo's package.json;
  volta auto-switches per directory.
- `gitleaks detect` — scan a repo for committed secrets before pushing.

## When things look stale

| Symptom | Fix |
|---|---|
| prompt/theme changes not showing | `rm ~/.cache/zsh/omp-init.zsh`, new shell (Windows: delete `~/.config/oh-my-posh/init-pwsh*.ps1`) |
| upgraded oh-my-posh/zoxide, weirdness | same — the init output is cached |
| new completions missing | `rm ~/.zcompdump*`, new shell |
| `/mnt/*` slow or acting up | check `findmnt -no FSTYPE /mnt/c` says `virtiofs`; `wsl --shutdown` |
