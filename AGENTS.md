# TinyClaw Knowledge Base — Table of Contents

This file is the entry point.  It tells you (or an LLM agent) **where to look**
for every category of project knowledge.  It does not duplicate content — each
link leads to a dedicated document that owns its topic.

## Architecture & Code

| Document | What it covers |
|----------|---------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Bird's-eye view, codemap, crate graph, invariants |
| [docs/DESIGN.md](docs/DESIGN.md) | Design philosophy, ADR index |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Android UI, bookmarklet, future web UI |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, auth, secrets handling |
| [docs/RELIABILITY.md](docs/RELIABILITY.md) | Queue guarantees, crash recovery, retry policy |

## Product

| Document | What it covers |
|----------|---------------|
| [docs/PRODUCT_SENSE.md](docs/PRODUCT_SENSE.md) | Target users, jobs-to-be-done, product principles |
| [docs/product-specs/index.md](docs/product-specs/index.md) | Feature specs index |
| [docs/product-specs/new-user-onboarding.md](docs/product-specs/new-user-onboarding.md) | Setup wizard, first-run UX |
| [docs/QUALITY_SCORE.md](docs/QUALITY_SCORE.md) | Quality rubric, metrics, SLOs |

## Design Decisions

| Document | What it covers |
|----------|---------------|
| [docs/design-docs/index.md](docs/design-docs/index.md) | ADR log (index of all design docs) |
| [docs/design-docs/core-beliefs.md](docs/design-docs/core-beliefs.md) | Foundational technical bets |

## Planning & Execution

| Document | What it covers |
|----------|---------------|
| [docs/PLANS.md](docs/PLANS.md) | Roadmap, milestones, current focus |
| [docs/exec-plans/active/](docs/exec-plans/active/) | In-flight execution plans |
| [docs/exec-plans/completed/](docs/exec-plans/completed/) | Archived plans |
| [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) | Known tech debt with priority |

## Generated & Reference

| Document | What it covers |
|----------|---------------|
| [docs/generated/db-schema.md](docs/generated/db-schema.md) | Auto-generated schema docs (queue file formats) |
| [docs/references/](docs/references/) | Third-party LLM-friendly reference files |

## Maintenance

The knowledge base is validated by CI:

- **`.github/workflows/docs-lint.yml`** — checks structure, cross-links, and
  freshness on every PR.
- **`scripts/doc-gardening.sh`** — agent that scans for stale docs and opens
  fix-up PRs.  Runs weekly via `.github/workflows/doc-gardening.yml`.
