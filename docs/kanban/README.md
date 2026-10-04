# Dotfiles Kanban Boards

Task tracking for dotfiles and omp tooling. Managed with the `kb` CLI tool and browser interface at `http://localhost:5174/dotfiles/`.

## Boards

- `kanban-roadmap` — Backlog and shipped log for the kanban tool and omp app host ecosystem.
- `qa-stress-test` (archived) — Visual QA fixture testing edge cases (long titles, unicode, dense markdown, WIP overflow).

## Conventions

- Run `kb boards` to view active boards.
- Session ritual: `kb brief <board>`, `kb activity <board> --lines 20`, `kb stats <board>`.
- Acceptance for kanban-roadmap is verified code and automated checks.
