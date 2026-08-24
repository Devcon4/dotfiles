---
alwaysApply: true
description: The dev runs all git commands themselves; agents never mutate git state
---
# Git policy

- NEVER run mutating git commands (`add`, `commit`, `push`, `pull`, `merge`, `rebase`, `reset`, `rm`, `mv`, `checkout`/`switch`, `stash`, `tag`, `remote`, config changes). The dev runs these personally.
- When a git action is needed, print the exact command(s) for the dev to run instead.
- Read-only inspection (`status`, `log`, `diff`, `show`, `ls-files`, `branch --show-current`) is fine.
