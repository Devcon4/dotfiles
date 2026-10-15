# dotfiles

Terminal/CLI workflow for a Windows 11 + WSL2 (Ubuntu) dev machine.
The stack: **Windows Terminal → WSL2 Ubuntu → zsh → oh-my-posh**, with the
same prompt theme shared by PowerShell 5/7 on the Windows side, and
**Oh My Pi** (`omp`) as the coding-agent harness.

Everything here is a verbatim copy of the live config.
- `./sync.sh` — re-capture the machine's current state into this repo.
- `./bootstrap.sh` — set up the WSL side of a new machine.
- `bootstrap.ps1` — set up the Windows side of a new machine.
- [THEMING.md](THEMING.md) — how the Park Ranger Dark palette flows through
  every surface, and how to build your own (purple/slate/whatever).
- [CHEATSHEET.md](CHEATSHEET.md) — the daily-driver commands and keybindings
  that aren't obvious from the configs (z-navigation, fzf keys, lazydocker,
  omp session tricks, WSL interop).

## File map

| Repo file | Live location | What it is |
|---|---|---|
| `zsh/zshrc` | `~/.zshrc` | Interactive shell config (see below) |
| `zsh/zshenv` | `~/.zshenv` | Skips Ubuntu's global compinit (we run our own) |
| `git/gitconfig` | `~/.gitconfig` | Git QoL defaults (rerere, prune, autoSetupRemote) |
| `oh-my-posh/national-park.omp.json` | `~/.config/oh-my-posh/` | Prompt theme — **single master copy**, read by zsh *and* both Windows PowerShells |
| `oh-my-pi/config.yml` | `~/.omp/agent/config.yml` | Oh My Pi agent config (model roles, status line, theme) |
| `oh-my-pi/lsp.json` | `~/.omp/agent/lsp.json` | LSP servers for the agent (tsgo, csharp-ls) |
| `oh-my-pi/rules/` | `~/.omp/agent/rules/` | Always-apply agent rules: git and kube credential policy, `plain-voice`, `gh-writing`, `adr`, `minimal-comments`. A repo's `.omp/rules/<name>.md` replaces the user rule of the same name for that repo |
| `oh-my-pi/skills/` | `~/.omp/agent/skills/` | User-level skills every repo sees: `scratch-docs`, `gh-writing`, `plain-voice`, `adr`, and the `ollama-*` local-model skills. On a name collision with a repo's `.github/skills/` copy, the user copy keeps `skill://<name>` and the repo copy gets a namespaced name |
| `oh-my-pi/agents/` | `~/.omp/agent/agents/` | User-level subagent roles for executing a scratch-docs `spec`: `lead` (runs one spec, spawns implementers, answers their questions, only writer of the spec and its board cards during the run), `implementer` (builds one unit inside its file list and asks the lead instead of guessing) and `oracle` (verifies one finished unit against its acceptance criteria and returns pass, fail or blocked with proof) |
| `oh-my-pi/hooks/` | `~/.omp/agent/hooks/` | `pre/gh-writing.ts` blocks `gh pr`/`gh issue` writes until the session has read `skill://gh-writing` |
| `oh-my-pi/extensions/` | `~/.omp/agent/extensions/` | Agent extensions: `kube-admin-guard` (blocks admin-credential use), `launch-viewer` (adds the `/tail` process/docker log viewer, see CHEATSHEET) and `scratch-digest` (at session start, tells the model which `docs/scratch` files are unfinished, done but not deleted, or missing a header) |
| `oh-my-pi/themes/` | `~/.omp/agent/themes/` | Park Ranger Dark theme for the omp TUI |
| `oh-my-pi/plugins/apphost/` | linked with `omp plugin link` (`~/.omp/plugins/node_modules/omp-apphost`) | The omp app host: runs local web apps for the repos that opt into them (see "Local apps" below), plus the `omp-apps` skill for writing one |
| `oh-my-pi/apps/` | `~/.omp/agent/apps` (a symlink to this folder) | User apps the host runs, one folder per app with an `app.json` and the app's own `SKILL.md`: `kanban` (`/board`, the `kb` CLI) and `moodboard` (`/moodboard`, the `moodboard` CLI). This repo opts into kanban (`.omp/apps/kanban.json`); its `docs/kanban/` holds the `kanban-roadmap` board for these tools |
| `wsl/wsl.conf` | `/etc/wsl.conf` (in-distro) | systemd on, default user |
| `windows/wslconfig` | `C:\Users\<you>\.wslconfig` | WSL2 VM settings — networking, virtiofs, memory reclaim |
| `windows/windows-terminal.settings.json` | `%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json` | Profiles, Park Ranger Dark scheme, keybindings |
| `windows/pwsh7-profile.ps1` | `Documents\PowerShell\Microsoft.PowerShell_profile.ps1` | PowerShell 7 profile (lazy oh-my-posh init) |
| `windows/pwsh5-profile.ps1` | `Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1` | Windows PowerShell 5 profile (same pattern) |
| `themes/vscode/` | `%USERPROFILE%\.vscode\extensions\devyn.park-ranger-dark-1.0.0` | Park Ranger Dark VS Code theme (sideloaded extension) |
| `themes/firefox/` | built to an `.xpi` by `build.sh` | Park Ranger Dark Firefox theme |
| `.env.template` | copy to `.env` (gitignored) | machine identity: usernames, distro, git name/email — see below |
| `env.lib.sh` | sourced by `bootstrap.sh`/`sync.sh` | placeholder ⇄ value substitution |

## The WSL-first workflow

Windows is just the display server here; **all real work happens inside WSL**:

- **Code lives on ext4** (`/home/dev/code`), never on `/mnt/c`. Linux-native
  file I/O is an order of magnitude faster than the 9P/virtiofs bridge, and
  watchers/inotify actually work. The Windows drives are only mounted for
  reaching Windows-side config (this repo's `sync.sh` does exactly that).
- **Every terminal lands in the code.** The default Windows Terminal profile
  is Ubuntu starting in `\\wsl.localhost\Ubuntu\home\dev\code`; even the
  PowerShell profiles start in a `code` directory.
- **Editors reach in, not out.** VS Code runs the Remote-WSL server: `code .`
  from a WSL shell opens the Windows UI attached to the Linux workspace, so
  the toolchain (node via volta, dotnet, LSPs) is the Linux one.
- **Windows-side tools read WSL as the source of truth** via
  `\\wsl.localhost\Ubuntu\...` — e.g. both PowerShell prompts render from the
  oh-my-posh theme stored on ext4.
- **Agents run inside WSL too.** Oh My Pi, its LSP servers, and its rules all
  live in the Linux home.

## Design decisions

### One prompt theme, three shells
The oh-my-posh theme master lives on WSL ext4 (`~/.config/oh-my-posh/national-park.omp.json`).
- zsh initializes from it directly.
- Both Windows PowerShell profiles read the *same file* via `\\wsl.localhost\Ubuntu\...` — edit once, every shell updates.

### Everything init-heavy is cached
Shell startup forks nothing it doesn't have to:
- `oh-my-posh init` and `zoxide init` output is cached under `~/.cache/zsh/` and sourced as plain files. **Delete the cache file after upgrading the tool.**
- `compinit` runs the full security audit at most once per 24h, otherwise trusts `~/.zcompdump` (`-C`), and the dump is `zcompile`d to bytecode.
- `dircolors` output is cached (static per coreutils version).
- The PowerShell profiles defer oh-my-posh init to the *first prompt render* and cache the init script (`~/.config/oh-my-posh/init-pwsh*.ps1` on the Windows side), so profile load is ~0ms and ConsoleHost never prints the "Loading personal profiles took Nms" banner.

### PSReadLine-style editing in zsh
- `zsh-autosuggestions`: ghost-text from history (Right/End accepts, Ctrl+Right one word).
- Up/Down do prefix-filtered history search.
- `zsh-syntax-highlighting`: valid-green/invalid-red, sourced **last** in `.zshrc`.
- fzf keybindings: Ctrl+R fuzzy history, Ctrl+T fuzzy files, Alt+C fuzzy cd.
- `zoxide`: `z <fuzzy>` jumps to frecent dirs, `zi` picks interactively.
- `eza` aliased over `ls`/`ll`/`la`/`lt` with nerd-font icons.

### WSL2 networking (read `windows/wslconfig` comments)
On this machine (corporate AOVPN force tunnel + NCP Secure Client), **NAT is
the only networking mode that passes traffic** — `mirrored` gets dropped by
host WFP filters. `dnsTunneling=true` resolves DNS via Windows so VPN DNS
works. `virtiofs=true` replaces 9P for `/mnt/*` drives. Details and the
localhost-interop rules are commented inline in the file.

### Split kube credentials (agent safety)
Interactive shells export a `KUBECONFIG` pointing at the cluster-admin
kubeconfig (see the bottom of `zsh/zshrc`); `kro` is the explicit-readonly
kubectl alias. Agents are held to readonly by layered enforcement:

1. **Env at launch** — the `omp` alias starts the harness (and thus every
   agent shell, eval kernel, and subprocess) with `KUBECONFIG` pointing at
   readonly `~/.kube/config`, so the interactive shell's admin env is never
   inherited.
2. **Per-call rewrite** — `kube-admin-guard` rewrites agent
   `kubectl`/`helm`/`flux`/`k9s` invocations (bash + hub-started processes)
   to inject the readonly config; an explicitly supplied `KUBECONFIG`
   (kind/k3d test clusters) is respected since it already passed the
   credential deny-list. Kube CLIs inside `eval` are blocked toward bash.
3. **Deny-list** — mutating kubectl/helm/flux verbs, all of `talosctl`, and
   any reference to the admin kubeconfig are blocked outright, backed by the
   always-apply rules in `oh-my-pi/rules/`. (The guard even blocks writing
   files that mention the admin kubeconfig path — this README found out the
   hard way.)

### TTY-less interactive shells (the `can't change option: zle` trap)
VS Code's environment probe and agent harnesses run `zsh -ilc ...` —
*interactive* but with **no terminal attached**. Forced-interactive zsh
reports the `zle` option as on, yet actually re-setting it fails, which made
fzf's option-save/restore eval print `(eval):1: can't change option: zle`
twice on every `code .`. The fix in `zsh/zshrc`: all line-editor extras
(fzf bindings, autosuggestions, history search, syntax highlighting) sit
behind a `[[ -t 0 ]]` guard — they're useless without a terminal anyway.
Bonus: TTY-less shells start faster since they skip four plugin sources.

### Local apps (the omp app host)
Some tools are small web apps with their own server, like kanban boards and
moodboards. The `omp-apphost` plugin runs them for every repo that opts in:
- An app is a folder with an `app.json` manifest. User apps live in
  `oh-my-pi/apps/` and are available everywhere; a repo can carry its own in
  `<repo>/.omp/apps/<name>/`.
- A repo turns a user app on by committing the app's config file (by default
  `.omp/apps/<name>.json`). The host only checks that the file exists; the app
  reads it, so each app picks its own fields and words.
- One server per app serves every opted-in repo. `/<command>` opens the
  current repo's page; `/apps` lists apps, servers and opted-in repos.
- Apps can add a session-start digest for the model and CLI commands, which
  the host writes as shims to `~/.local/share/omp-apps/bin` (on PATH via
  `zsh/zshrc`). A repo app's digest and CLI stay off until `/apps trust <app>`.
- The plugin is linked, not copied, and `~/.omp/agent/apps` is a symlink, so
  edits in this repo are live and `sync.sh` has nothing to capture. The app
  skills are found through `skills.customDirectories` in `config.yml`.
- To write or port an app, read `skill://omp-apps`.

## Setting up a new machine

Scripted path:
1. On Windows: `wsl --install -d Ubuntu`, clone this repo inside WSL.
2. In WSL: `./bootstrap.sh` — first run generates `.env` from detected
   values and stops for review; re-run to install (apt basics, prompt + CLI
   tools into `~/.local/bin`, plugin clones, configs rendered from the
   `__VAR__` templates, `/etc/wsl.conf`, zsh as login shell).
3. In pwsh 7: `pwsh -File \\wsl.localhost\<distro>\home\<user>\code\dotfiles\bootstrap.ps1`
   (reads the same `.env`; Terminal + pwsh + oh-my-posh + Firefox Dev Edition
   + Monaspace Nerd Font via winget, rendered config copies with `.bak`
   backups, VS Code theme sideload), then `wsl --shutdown`.
4. Firefox theme: `themes/firefox/build.sh` — packages the theme as an `.xpi`,
   installed via about:addons → gear → Install Add-on From File. Unsigned is
   fine on Dev Edition with `xpinstall.signatures.required=false` in
   about:config; release Firefox instead needs it signed — set
   `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` (AMO API keys, optional entries in
   `.env`) and the script signs it unlisted on AMO.

What the scripts do, for the record:

### Windows side
1. Install [Windows Terminal](https://aka.ms/terminal) and a Nerd Font — this setup uses **MonaspiceNe Nerd Font** (Monaspace Neon patched), size 11.
2. `wsl --install -d Ubuntu`, then place `windows/wslconfig` at `%USERPROFILE%\.wslconfig` and `wsl/wsl.conf` at `/etc/wsl.conf` inside the distro; `wsl --shutdown` to apply.
3. Drop `windows/windows-terminal.settings.json` into the Terminal `LocalState` folder (path in the table above). Notable bindings: `Alt+Q` global summon (quake-style show/hide), `Ctrl+Alt +/-` split Ubuntu right/down, `Ctrl+Shift +/-` split PowerShell, `Alt+Z` zoom pane, `Alt+Shift+D` duplicate pane. Launches fullscreen, default profile = Ubuntu, starting dir `~/code`.
4. Copy the PowerShell profiles into `Documents\PowerShell\` (pwsh 7) and `Documents\WindowsPowerShell\` (5.1). They expect `oh-my-posh` on the Windows PATH (`winget install JanDeDobbeleer.OhMyPosh`).

### WSL side
Tools live in `~/.local/bin` (static binaries) unless noted. Versions as of 2026-08-19:

| Tool | Version | Install |
|---|---|---|
| zsh | Ubuntu package | `apt install zsh && chsh -s $(which zsh)` |
| oh-my-posh | 30.4.0 | `curl -s https://ohmyposh.dev/install.sh \| bash -s -- -d ~/.local/bin` |
| eza | 0.23.5 | GitHub release binary |
| fzf | 0.74.2 | git clone to `~/.local/share/fzf`, run `./install --bin`; `.zshrc` sources its `shell/*.zsh` |
| zoxide | 0.10.0 | GitHub release binary |
| zsh-autosuggestions | git clone | `~/.local/share/zsh/plugins/zsh-autosuggestions` |
| zsh-syntax-highlighting | git clone | `~/.local/share/zsh/plugins/zsh-syntax-highlighting` |
| volta | 2.0.2 | `curl https://get.volta.sh \| bash` — pins node 24.19.0, typescript 7.0.2 |
| Oh My Pi (`omp`) | 17.2.10 | harness binary in `~/.local/bin` |
| misc | — | `just`, `yq`, `lazydocker`, `kubectl`, `helm`, `flux`, `kustomize`, `sops`, `age`, `gitleaks`, `7zz`, `pwsh`, `wslc` (uv tool) — all release binaries in `~/.local/bin` |

`bootstrap.sh` then copies the configs per the file map and resets the init
caches. First zsh launch rebuilds them automatically.

### Identity is parameterized (`.env`)
No usernames, emails, or distro names live in the repo's config files — they
hold `__VAR__` placeholders (`__WIN_USER__`, `__WSL_USER__`, `__WSL_DISTRO__`,
`__GIT_NAME__`, `__GIT_EMAIL__`):

- `.env.template` → copy to `.env` and fill in (or let `./bootstrap.sh`
  auto-generate it from detected values). `.env` is gitignored.
- `bootstrap.sh` / `bootstrap.ps1` render placeholders → values when
  installing configs (`env.lib.sh` on the WSL side).
- `sync.sh` strips values → placeholders when capturing, so identity never
  re-enters the repo. Replacements are context-anchored fixed strings
  (`home/<user>`, `Users\<user>`, `default=<user>`, ...), so a short
  username like `dev` can't mangle unrelated text.

Still hardcoded on purpose: the theme publisher id (`devyn`, part of the
extension identity) and the org-specific kube policy prose in
`oh-my-pi/rules/` — rewrite those if you fork this for another org.
The kube/talos configs themselves are **not** in this repo (credentials);
only the policy around them is.
