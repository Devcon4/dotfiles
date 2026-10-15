#!/usr/bin/env bash
# Bootstrap the WSL (Ubuntu) side of this setup.
# Idempotent: every step checks before acting, so re-running is safe.
# Run from the repo root inside WSL:   ./bootstrap.sh
#
# The Windows half (Terminal, fonts, PowerShell profiles, .wslconfig) is
# bootstrap.ps1 -- run that from Windows PowerShell 7.
set -euo pipefail
cd "$(dirname "$0")"

BIN="$HOME/.local/bin"
SHARE="$HOME/.local/share"
mkdir -p "$BIN" "$SHARE/zsh/plugins" "$SHARE/zsh/completions" "$HOME/.cache/zsh"

have() { command -v "$1" >/dev/null 2>&1; }
step() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
skip() { printf '    %s already present\n' "$*"; }

# --- machine identity (.env) ----------------------------------------------
. ./env.lib.sh
if [[ ! -f .env ]]; then
  step "generating .env from detected values"
  win_user=$(powershell.exe -NoProfile -Command '$env:USERNAME' 2>/dev/null | tr -d '\r' || true)
  cat > .env <<EOF
WIN_USER="${win_user}"
WSL_USER="$USER"
WSL_DISTRO="${WSL_DISTRO_NAME:-}"
GIT_NAME="$(git config --global user.name 2>/dev/null || true)"
GIT_EMAIL="$(git config --global user.email 2>/dev/null || true)"
EOF
  echo "    wrote .env -- review it (fill any blanks), then re-run ./bootstrap.sh"
  exit 1
fi
load_env


# --- apt basics -------------------------------------------------------------
missing=()
for p in zsh git curl unzip; do have "$p" || missing+=("$p"); done
if ((${#missing[@]})); then
  step "apt install: ${missing[*]}"
  sudo apt-get update -qq && sudo apt-get install -y "${missing[@]}"
else
  skip "apt basics (zsh git curl unzip)"
fi

# --- prompt + CLI tools (all land in ~/.local/bin) ---------------------------
if have oh-my-posh; then skip oh-my-posh; else
  step "installing oh-my-posh"
  curl -s https://ohmyposh.dev/install.sh | bash -s -- -d "$BIN"
fi

if [[ -d $SHARE/fzf ]]; then skip fzf; else
  step "installing fzf (clone + build, shell integration sourced from the clone)"
  git clone --depth 1 https://github.com/junegunn/fzf.git "$SHARE/fzf"
  "$SHARE/fzf/install" --bin
  ln -sf "$SHARE/fzf/bin/fzf" "$BIN/fzf"
fi

if have zoxide; then skip zoxide; else
  step "installing zoxide"
  curl -sSfL https://raw.githubusercontent.com/ajeetdsouza/zoxide/main/install.sh | sh
fi

if have eza; then skip eza; else
  step "installing eza"
  curl -sSfL https://github.com/eza-community/eza/releases/latest/download/eza_x86_64-unknown-linux-gnu.tar.gz | tar xz -C "$BIN"
fi

for plugin in zsh-autosuggestions zsh-syntax-highlighting; do
  if [[ -d $SHARE/zsh/plugins/$plugin ]]; then skip "$plugin"; else
    step "cloning $plugin"
    git clone --depth 1 "https://github.com/zsh-users/$plugin.git" "$SHARE/zsh/plugins/$plugin"
  fi
done

if have volta; then skip volta; else
  step "installing volta (node toolchain manager)"
  curl -sSf https://get.volta.sh | bash -s -- --skip-setup   # .zshrc already sets VOLTA_HOME/PATH
  "$HOME/.volta/bin/volta" install node@24
fi

# --- configs ------------------------------------------------------------------
step "copying configs (identity placeholders rendered from .env)"
render_to zsh/zshrc  "$HOME/.zshrc"
render_to zsh/zshenv "$HOME/.zshenv"
mkdir -p "$HOME/.config/oh-my-posh"
render_to oh-my-posh/national-park.omp.json "$HOME/.config/oh-my-posh/national-park.omp.json"
mkdir -p "$HOME/.omp/agent"
cp oh-my-pi/config.yml "$HOME/.omp/agent/"
render_to oh-my-pi/lsp.json "$HOME/.omp/agent/lsp.json"
cp -r oh-my-pi/rules oh-my-pi/skills oh-my-pi/agents oh-my-pi/hooks oh-my-pi/extensions oh-my-pi/themes "$HOME/.omp/agent/"
# omp apps: user apps are a symlink into this repo; the host plugin is linked so edits here are live
if [[ -L $HOME/.omp/agent/apps || ! -e $HOME/.omp/agent/apps ]]; then
  ln -sfn "$PWD/oh-my-pi/apps" "$HOME/.omp/agent/apps"
else
  echo "    ~/.omp/agent/apps is a real directory; move its apps into oh-my-pi/apps/ and re-run"
fi
if ! have omp; then
  echo "    omp not installed; afterwards run: omp plugin link $PWD/oh-my-pi/plugins/apphost"
elif omp plugin list 2>/dev/null | grep -q 'omp-apphost'; then
  skip "omp-apphost plugin"
else
  step "linking the omp-apphost plugin"
  omp plugin link "$PWD/oh-my-pi/plugins/apphost"
fi
# stale init caches would resurrect the old prompt/tool versions
rm -f "$HOME/.cache/zsh/omp-init.zsh" "$HOME/.cache/zsh/zoxide-init.zsh"

if [[ -f $HOME/.gitconfig ]]; then skip ".gitconfig (left untouched)"; else
  render_to git/gitconfig "$HOME/.gitconfig"
fi

# /etc/wsl.conf (systemd, default user) -- needs sudo; applies after wsl --shutdown
if [[ -f /etc/wsl.conf ]] && render_to wsl/wsl.conf /tmp/.wsl.conf.rendered && cmp -s /tmp/.wsl.conf.rendered /etc/wsl.conf; then
  skip "/etc/wsl.conf"
else
  step "installing /etc/wsl.conf (sudo; takes effect after 'wsl --shutdown')"
  render_to wsl/wsl.conf /tmp/.wsl.conf.rendered
  sudo cp /tmp/.wsl.conf.rendered /etc/wsl.conf
fi
rm -f /tmp/.wsl.conf.rendered

# --- default shell ------------------------------------------------------------
if [[ $(getent passwd "$USER" | cut -d: -f7) == *zsh ]]; then skip "zsh as login shell"; else
  step "setting zsh as login shell (asks for your password)"
  chsh -s "$(command -v zsh)"
fi

step "done -- open a new terminal (first zsh start builds the caches)"
cat <<'EOF'
    Not covered here (install separately if you need them):
      - Oh My Pi itself (`omp`) -- internal harness binary, drop into ~/.local/bin
      - project tooling: dotnet SDK, kubectl/helm/flux/kustomize, sops/age,
        just, yq, lazydocker, gitleaks -- release binaries into ~/.local/bin
      - lsp.json expects: `volta install typescript` (tsgo) and
        `dotnet tool install -g csharp-ls`
EOF
