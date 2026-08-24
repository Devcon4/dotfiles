# Theming: how Park Ranger Dark works, and how to make your own

Every surface in this setup — terminal, prompt, agent TUI, VS Code, Firefox —
is painted from **one shared set of hex values**. There is no build step or
token pipeline: the same literal hexes appear in five files. That makes a new
palette a mechanical find-and-replace job.

## The master palette

| Role | Hex | Used as |
|---|---|---|
| background | `#121614` | terminal/editor/browser background, "ink"/"night" |
| panel | `#1B211C` | raised surfaces: tabs, popups, ANSI black |
| sidebar | `#151A16` | halfway between background and panel (VS Code/Firefox sidebars) |
| selection | `#2C3A30` | selection background, borders, "forest" |
| selection-hover | `#35473B` | hover/active states on selection surfaces |
| border | `#3E5C48` | omp TUI borders, "pine" |
| fg-bright | `#F4EFE2` | brightest text, ANSI brightWhite, "cream"/"paper" |
| fg | `#E9E0CB` | normal text, ANSI white, "sand" |
| muted | `#B5AD97` | secondary text, comments-adjacent UI |
| gray | `#4A5548` | dimmed UI, ANSI brightBlack |
| green | `#5F8A6C` | ANSI green, git-clean, "moss" |
| green-bright | `#7FA98A` | ANSI brightGreen, success |
| cyan | `#6FA39A` | ANSI cyan, "sage" |
| cyan-bright | `#8FBFB6` | ANSI brightCyan |
| yellow | `#D8A04A` | ANSI yellow, warnings, git-dirty, "amber" |
| yellow-bright | `#E6B968` | ANSI brightYellow |
| red | `#D9542F` | ANSI red, cursor, accent, errors, "ember" |
| red-bright | `#E57352` | ANSI brightRed, error text |
| blue | `#6B8CA3` | ANSI blue, info, git ahead/behind |
| blue-bright | `#8DABBF` | ANSI brightBlue |
| magenta | `#A9707E` | ANSI purple |
| magenta-bright | `#C48D99` | ANSI brightPurple |

## Where each file gets its colors

| File | Mechanism |
|---|---|
| `oh-my-posh/national-park.omp.json` | `palette` block defines named colors (`p:ember`, `p:moss`, ...); segments reference names, so **only the palette block holds hexes** |
| `windows/windows-terminal.settings.json` | one scheme object in `schemes[]` (+ `theme`/`colorScheme` referencing it by name) |
| `oh-my-pi/themes/park-ranger-dark.json` | `vars` block maps names → hexes; the `colors`/`syntax` sections reference var names, so **only `vars` holds hexes** |
| `themes/vscode/themes/park-ranger-dark-color-theme.json` | raw hexes throughout (VS Code themes have no variable layer); some carry alpha suffixes like `#D9542F40` — keep the last two digits when replacing |
| `themes/firefox/manifest.json` | raw hexes in `theme.colors` |

The zsh side has no colors of its own — it renders whatever oh-my-posh and
the terminal scheme say. `eza`/`fzf`/syntax-highlighting use ANSI colors, so
they inherit the Windows Terminal scheme automatically. That's the trick:
**keep semantic meaning in ANSI slots** (green = ok, red = error) and every
ANSI-speaking tool themes itself for free.

## Making a new palette (e.g. purple/slate/yellow)

1. **Pick hexes for the roles above.** Rough recipe for the neutrals: pick a
   near-black background tinted toward your primary hue (slate: `#131518`),
   then derive panel (+4% lightness), sidebar (halfway), selection (+10%),
   hover (+14%), border (+20%). Keep fg/fg-bright warm-neutral unless you
   want a tinted paper look. Accent roles: your primary (purple) takes the
   red/cursor/accent slots, secondary (yellow) keeps warning/dirty, and keep
   *some* green for success/git-clean — muted slate-green fits.
2. **Replace hexes.** Each old hex maps to exactly one new hex, so from the
   repo root:
   ```sh
   sed -i 's/#121614/#131518/gI; s/#D9542F/#9D7CD8/gI; ...' \
     oh-my-posh/national-park.omp.json \
     windows/windows-terminal.settings.json \
     oh-my-pi/themes/park-ranger-dark.json \
     themes/vscode/themes/park-ranger-dark-color-theme.json \
     themes/firefox/manifest.json
   ```
   (`gI` = case-insensitive; the VS Code theme's 8-digit alpha hexes are
   prefix-matched by the same rule, so alpha is preserved.)
3. **Rename** so the new theme can live beside this one: the scheme `name` +
   `colorScheme` + `theme` in the WT settings, `name` in the omp TUI theme
   (+ its filename + `theme.dark` in `oh-my-pi/config.yml`), `label`/`name`
   in the VS Code `package.json`, `name` in the Firefox manifest, and the
   theme filename passed to `oh-my-posh init` in `zsh/zshrc` + both
   PowerShell profiles.
4. **Apply**: `./sync.sh` works repo→machine only in reverse — instead
   re-run the copy steps from `bootstrap.sh` (or just `./bootstrap.sh`),
   delete `~/.cache/zsh/omp-init.zsh`, and restart the terminal. Windows
   Terminal hot-reloads its settings file on save.

## Verifying a palette

- Contrast: body text (fg on background) should clear WCAG 4.5:1; muted text
  ≥ 3:1. Quick check: https://webaim.org/resources/contrastchecker/
- Run `oh-my-posh print primary` in a themed shell to eyeball the prompt.
- ANSI sanity: `for i in {30..37} {90..97}; do print -P "\e[${i}m color $i \e[0m"; done`
