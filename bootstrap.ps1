# Bootstrap the Windows side of this setup: Windows Terminal, PowerShell 7,
# oh-my-posh, the Monaspace Nerd Font, profiles, .wslconfig, and the
# Park Ranger Dark VS Code theme (sideloaded).
#
# Prereq: WSL Ubuntu already installed (`wsl --install -d Ubuntu`) and this
# repo cloned inside it. Run from Windows PowerShell 7:
#   pwsh -File \\wsl.localhost\Ubuntu\home\<user>\code\dotfiles\bootstrap.ps1
#
# Idempotent: existing files are backed up as *.bak before being replaced.
#
# Identity: repo configs hold __VAR__ placeholders; values come from the
# repo's .env (run ./bootstrap.sh in WSL first -- it generates .env).
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Green }

# --- machine identity (.env) --------------------------------------------------
$dotenv = @{}
if (-not (Test-Path "$repo\.env")) {
    throw ".env not found next to bootstrap.ps1 -- run ./bootstrap.sh inside WSL first (it generates .env), or cp .env.template .env and fill it in"
}
foreach ($line in Get-Content "$repo\.env") {
    if ($line -match '^\s*([A-Z_]+)\s*=\s*"?([^"#]*?)"?\s*(#.*)?$' -and $Matches[2]) {
        $dotenv[$Matches[1]] = $Matches[2].Trim()
    }
}
foreach ($key in 'WIN_USER', 'WSL_USER', 'WSL_DISTRO', 'GIT_NAME', 'GIT_EMAIL') {
    if (-not $dotenv[$key]) { throw ".env: $key is empty" }
}

# --- packages ---------------------------------------------------------------
foreach ($pkg in 'Microsoft.WindowsTerminal', 'Microsoft.PowerShell', 'JanDeDobbeleer.OhMyPosh', 'Mozilla.Firefox.DeveloperEdition') {
    if (winget list --id $pkg --exact 2>$null | Select-String $pkg) {
        Write-Host "    $pkg already installed"
    } else {
        Step "winget install $pkg"
        winget install --id $pkg --exact --silent --accept-package-agreements --accept-source-agreements
    }
}

# --- font: MonaspiceNe Nerd Font (Monaspace Neon, Nerd Font patched) --------
if (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Windows\Fonts", "$env:WINDIR\Fonts" -Filter 'MonaspiceNe*' -ErrorAction SilentlyContinue) {
    Write-Host "    MonaspiceNe Nerd Font already installed"
} else {
    Step "installing Monaspace Nerd Font via oh-my-posh"
    oh-my-posh font install Monaspace
}

# --- config copies -----------------------------------------------------------
# Copy with __VAR__ placeholders rendered from .env; backs up a differing
# destination first. Comparison is against the rendered content.
function Install-File($src, $dst) {
    $dir = Split-Path $dst
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $content = Get-Content $src -Raw
    foreach ($key in $dotenv.Keys) { $content = $content.Replace("__${key}__", $dotenv[$key]) }
    if (Test-Path $dst) {
        if ($content.Equals((Get-Content $dst -Raw))) {
            Write-Host "    $dst already up to date"
            return
        }
        Copy-Item $dst "$dst.bak" -Force
        Write-Host "    backed up existing -> $dst.bak"
    }
    Set-Content -Path $dst -Value $content -NoNewline -Encoding UTF8
    Step "installed $dst"
}

Install-File "$repo\windows\wslconfig" "$env:USERPROFILE\.wslconfig"
Install-File "$repo\windows\pwsh7-profile.ps1" "$env:USERPROFILE\Documents\PowerShell\Microsoft.PowerShell_profile.ps1"
Install-File "$repo\windows\pwsh5-profile.ps1" "$env:USERPROFILE\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1"

$wtState = "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState"
if (Test-Path $wtState) {
    Install-File "$repo\windows\windows-terminal.settings.json" "$wtState\settings.json"
} else {
    Write-Warning "Windows Terminal LocalState not found (launch Terminal once, then re-run)"
}

# --- VS Code theme (sideload: copy straight into the extensions dir) ---------
$vsix = "$env:USERPROFILE\.vscode\extensions\devyn.park-ranger-dark-1.0.0"
if (Test-Path $vsix) {
    Write-Host "    VS Code theme already sideloaded"
} elseif (Test-Path "$env:USERPROFILE\.vscode\extensions") {
    Step "sideloading Park Ranger Dark VS Code theme"
    Copy-Item "$repo\themes\vscode" $vsix -Recurse
    Write-Host "    select it via Ctrl+K Ctrl+T -> 'Park Ranger Dark'"
} else {
    Write-Warning "VS Code not installed; skipping theme sideload"
}

Step "done"
Write-Host @'
    Remaining manual steps:
      - wsl --shutdown        (applies .wslconfig; reopen terminals after)
      - Firefox theme: run themes/firefox/build.sh in WSL, then install the
        .xpi via about:addons -> gear -> Install Add-on From File
        (unsigned needs xpinstall.signatures.required=false in about:config --
        Dev Edition allows this; or sign via AMO keys in .env)
      - Inside WSL: run ./bootstrap.sh from this repo
'@
