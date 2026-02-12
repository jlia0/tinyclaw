# Tech Debt Tracker

Debt items sorted by priority (P0 = blocking, P1 = should fix soon, P2 = nice to have).

| # | Priority | Area | Description | Tracking |
|---|----------|------|-------------|----------|
| 1 | P1 | Queue | No dead-letter queue — permanently failing messages sit in `processing/` forever | — |
| 2 | P1 | Queue | No automatic recovery of `processing/` files on startup | — |
| 3 | P1 | HTTP | No authentication on `/v1/chat` — anyone on localhost can inject messages | — |
| 4 | P2 | Inference | Response truncation is a hard 4000-char cut; should be configurable | — |
| 5 | P2 | Android | No model-download progress UI; user has no feedback during `pull` | — |
| 6 | P2 | Legacy | TypeScript sources in `src/` are unmaintained; should be archived or removed | — |
| 7 | P2 | CI | No integration tests — only `cargo check` + `clippy` + `fmt` | — |
| 8 | P2 | Config | `Settings` is loaded once at startup; runtime changes require restart | — |

## Process

- When you discover new debt, add a row here.
- When debt is resolved, delete the row and note the resolving commit/PR.
- Review this file at least once per milestone.
