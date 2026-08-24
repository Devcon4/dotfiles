#!/usr/bin/env sh
# Re-capture the machine's live config into this repo.
# Identity (usernames, email, distro) is stripped back to __VAR__
# placeholders via .env -- see env.lib.sh.
# Run from the repo root; review `git diff` afterwards, commit manually.
set -eu
cd "$(dirname "$0")"

. ./env.lib.sh
load_env

WINHOME="/mnt/c/Users/$WIN_USER"
WT_STATE="$WINHOME/AppData/Local/Packages/Microsoft.WindowsTerminal_8wekyb3d8bbwe/LocalState"

mkdir -p zsh git oh-my-posh oh-my-pi wsl windows

cp ~/.zshrc  zsh/zshrc
cp ~/.zshenv zsh/zshenv
cp ~/.gitconfig git/gitconfig
cp ~/.config/oh-my-posh/national-park.omp.json oh-my-posh/

cp ~/.omp/agent/config.yml ~/.omp/agent/lsp.json oh-my-pi/
rm -rf oh-my-pi/rules oh-my-pi/extensions oh-my-pi/themes
cp -r ~/.omp/agent/rules ~/.omp/agent/extensions ~/.omp/agent/themes oh-my-pi/

# standalone theme repos (VS Code extension + Firefox theme)
rm -rf themes/vscode themes/firefox
mkdir -p themes/vscode themes/firefox
cp -r ~/code/park-ranger-dark-vscode/package.json ~/code/park-ranger-dark-vscode/themes themes/vscode/
cp ~/code/park-ranger-dark-firefox/manifest.json ~/code/park-ranger-dark-firefox/build.sh themes/firefox/

cp /etc/wsl.conf wsl/wsl.conf
cp "$WINHOME/.wslconfig" windows/wslconfig
cp "$WT_STATE/settings.json" windows/windows-terminal.settings.json
cp "$WINHOME/Documents/PowerShell/Microsoft.PowerShell_profile.ps1"        windows/pwsh7-profile.ps1
cp "$WINHOME/Documents/WindowsPowerShell/Microsoft.PowerShell_profile.ps1" windows/pwsh5-profile.ps1

# strip machine identity back to placeholders
for f in $TEMPLATED_FILES; do
  subst "$f" capture
done

echo "Synced. Review with: git diff"
