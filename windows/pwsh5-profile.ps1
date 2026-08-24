# oh-my-posh prompt (Park Ranger Dark) -- theme master lives in WSL ext4,
# shared with WSL zsh via \\wsl.localhost.
# Init is deferred to the first prompt so profile load stays ~0ms and
# ConsoleHost's "Loading personal and system profiles took Nms" never appears.
# After an oh-my-posh upgrade, delete init-pwsh.ps1 to regenerate the cache.
function prompt {
    try {
        $ompInit = "$env:USERPROFILE\.config\oh-my-posh\init-pwsh.ps1"
        if (-not (Test-Path $ompInit)) {
            oh-my-posh init pwsh --config '\\wsl.localhost\__WSL_DISTRO__\home\__WSL_USER__\.config\oh-my-posh\national-park.omp.json' --print | Set-Content $ompInit -Encoding UTF8
        }
        . $ompInit   # replaces this prompt function with oh-my-posh's
        prompt       # resolves to the new definition
    } catch {
        Set-Item Function:prompt -Value { "PS $PWD> " }
        "PS $PWD> "
    }
}
