---
name: "mem"
description: "Use when the user asks for persistent memory, context retention, memory debugging, decision logging, or long-lived project memory. Installs and operates amcbstudio/mem as an external local sidecar (not vendored), then asks the user which memory mode they want before enabling workflows."
---

# mem Skill

Use `mem` as a deterministic memory sidecar for this repo. It records append-only events and compacts them into readable artifacts for humans and agents.

## Important constraints

- `mem` is local CLI tooling, not a cloud memory API.
- Do not vendor `mem` into this repository.
- Install it outside this repo and point to it by absolute path.
- Treat `mem` as assistive memory; keep operational truth in TinyClaw's structured files/queues/settings.

## First action: ask the user their memory mode

Before installing or writing events, ask one compact question:

"How do you want memory used in this workspace? (A) Dev timeline/audit only, (B) Agent context notes/decisions, (C) Both, (D) Not now)"

Then confirm two policies:
- retention window (for example: 30 days, 90 days, forever)
- sensitivity policy (what must never be stored)

If the user does not specify, default to:
- mode: A (dev timeline/audit)
- retention: 90 days
- sensitivity: no secrets, tokens, personal identifiers

## Install (external, from GitHub)

Install under `~/.tinyclaw/tools/mem`:

```bash
mkdir -p ~/.tinyclaw/tools
git clone --recurse-submodules https://github.com/amcbstudio/mem.git ~/.tinyclaw/tools/mem
```

Verify:

```bash
~/.tinyclaw/tools/mem/bin/mem --help
```

## Enable in the target repo

From this TinyClaw repo root:

```bash
~/.tinyclaw/tools/mem/hooks/install.sh
~/.tinyclaw/tools/mem/bin/mem init
~/.tinyclaw/tools/mem/bin/mem sync
~/.tinyclaw/tools/mem/bin/mem show
```

This creates `.amcb/memory/` artifacts in the repo.

## Usage patterns for TinyClaw

### Mode A: Dev timeline/audit (recommended default)

- Rely on git hooks (`post-commit`, `post-merge`) installed by `mem`.
- Add occasional notes/decisions:

```bash
~/.tinyclaw/tools/mem/bin/mem add decision scope="queue routing" rationale="reduce regressions"
~/.tinyclaw/tools/mem/bin/mem sync
```

### Mode B: Agent context notes/decisions

- Add explicit events at key moments (incident, routing decision, policy choice).
- Keep payloads minimal and non-sensitive.
- Prefer short key/value fields over long prose.

Example:

```bash
~/.tinyclaw/tools/mem/bin/mem add note agent="coder" topic="memory-strategy" summary="hybrid memory adopted"
~/.tinyclaw/tools/mem/bin/mem sync
```

### Mode C: Both

- Combine A + B.
- Keep `mem` as retrieval/audit context, not as authoritative queue state.

## "Cloud" clarification (be explicit)

If the user asks for cloud memory, clarify that upstream `mem` has no remote runtime service.

Offer two alternatives:
- Git-backed sharing: commit/push `.amcb/memory/` artifacts to a remote repo.
- Separate cloud memory service: keep `mem` locally for deterministic logs and integrate a second system for cloud retrieval.

Do not claim native cloud sync for `mem`.

## Operational guardrails

- Never store secrets, API keys, auth tokens, personal identifiers, or private conversation dumps.
- Keep events compact and typed (`note`, `decision`, `run`, `commit`, `merge`).
- Run `mem sync` after batched writes.
- If schema drift appears, keep going but add a follow-up `note` documenting the change.

## Quick checks

```bash
test -d .amcb/memory && echo "mem initialized"
jq -r '.counters.events_total' .amcb/memory/state.json
tail -n 10 .amcb/memory/events.jsonl
```

## When not to use

- Do not use `mem` as TinyClaw's queue, scheduler, or pairing source of truth.
- Do not use `mem` as a replacement for repo docs like `AGENTS.md` and `SOUL.md`.
- Do not use `mem` if the user forbids local event storage.
