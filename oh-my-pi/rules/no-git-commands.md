---
alwaysApply: true
description: The dev runs all git commands themselves; agents never mutate git state
---
# Git policy

- NEVER run mutating git commands (`add`, `commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `rm`, `mv`, `checkout`/`switch`, `stash`, `tag`, `remote`, config changes). The dev runs these personally.
- When a git action is needed, print the exact command(s) for the dev to run instead.
- Read-only inspection (`status`, `log`, `diff`, `show`, `ls-files`, `branch --show-current`) is fine, from WSL or PowerShell. The dev runs git writes from PowerShell on the Windows side.
- Suggest `git add` / `git commit` commands only when an effort or plan is finished, or when the dev asks. Not on every reply. The commit message follows `skill://gh-writing`.
- A command handed to the dev for PowerShell is one line, with no `\` or backtick line continuations. PowerShell does not accept `\` continuations, and the dev pastes commands as a single line.
