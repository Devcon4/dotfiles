# Shared identity substitution for bootstrap.sh and sync.sh. Source from the
# repo root (both scripts cd there first).
#
# Repo config files store __VAR__ placeholders; .env holds this machine's
# values. `subst FILE render` turns placeholders into values (install path),
# `subst FILE capture` turns values back into placeholders (sync path), so
# real usernames/emails never land in the repo.
#
# All replacements are FIXED strings anchored by surrounding context
# ("home/<user>", "Users\<user>", "default=<user>", ...) -- a short value
# like a username "dev" can never mangle unrelated text.

# Repo files that may contain identity placeholders.
TEMPLATED_FILES="
git/gitconfig
oh-my-posh/national-park.omp.json
oh-my-pi/lsp.json
wsl/wsl.conf
windows/windows-terminal.settings.json
windows/pwsh7-profile.ps1
windows/pwsh5-profile.ps1
zsh/zshrc
zsh/zshenv
"

load_env() {
  if [ ! -f .env ]; then
    echo "error: .env not found -- cp .env.template .env and fill it in" >&2
    echo "       (./bootstrap.sh auto-generates one from detected values)" >&2
    exit 1
  fi
  # shellcheck source=/dev/null
  . ./.env
  for v in WIN_USER WSL_USER WSL_DISTRO GIT_NAME GIT_EMAIL; do
    eval "val=\${$v:-}"
    if [ -z "$val" ]; then
      echo "error: .env: $v is empty" >&2
      exit 1
    fi
  done
  export WIN_USER WSL_USER WSL_DISTRO GIT_NAME GIT_EMAIL
}

# subst FILE render|capture -- in-place, byte-exact, context-anchored.
subst() {
  python3 - "$1" "$2" <<'PYEOF'
import os, sys

path, direction = sys.argv[1], sys.argv[2]
e = {k: os.environ[k] for k in ("WIN_USER", "WSL_USER", "WSL_DISTRO", "GIT_NAME", "GIT_EMAIL")}

# (placeholder-form, value-form); backslash flavors cover raw text (\) and
# JSON-escaped (\\) files. Capture order matters: email before the
# Users\<win_user> pairs so "user@corp.com" is not half-eaten.
pairs = [
    ("__GIT_EMAIL__",                        e["GIT_EMAIL"]),
    ("__GIT_NAME__",                         e["GIT_NAME"]),
    ("Users\\\\__WIN_USER__",                "Users\\\\" + e["WIN_USER"]),
    ("Users\\__WIN_USER__",                  "Users\\" + e["WIN_USER"]),
    ("wsl.localhost\\\\__WSL_DISTRO__",      "wsl.localhost\\\\" + e["WSL_DISTRO"]),
    ("wsl.localhost\\__WSL_DISTRO__",        "wsl.localhost\\" + e["WSL_DISTRO"]),
    ("wsl$\\\\__WSL_DISTRO__",               "wsl$\\\\" + e["WSL_DISTRO"]),
    ("home/__WSL_USER__",                    "home/" + e["WSL_USER"]),
    ("home\\\\__WSL_USER__",                 "home\\\\" + e["WSL_USER"]),
    ("home\\__WSL_USER__",                   "home\\" + e["WSL_USER"]),
    ("default=__WSL_USER__",                 "default=" + e["WSL_USER"]),
]

with open(path, encoding="utf-8") as f:
    text = f.read()
for placeholder, value in pairs:
    if direction == "render":
        text = text.replace(placeholder, value)
    else:
        text = text.replace(value, placeholder)
with open(path, "w", encoding="utf-8") as f:
    f.write(text)
PYEOF
}

# render_to SRC DST -- install a repo template with placeholders filled in.
render_to() {
  _tmp=$(mktemp)
  cp "$1" "$_tmp"
  subst "$_tmp" render
  cp "$_tmp" "$2"
  rm -f "$_tmp"
}
