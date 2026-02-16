TinyClaw - Multi-team Personal Assistants

This file is the entry point.  It tells you (or an LLM agent) **where to look**
for every category of project knowledge.  It does not duplicate content — each
link leads to a dedicated document that owns its topic.

- Teams of agents
- Telegram, WhatsApp, Discord message integration
- Heartbeat monitoring (with heartbeat.md file)

| Document | What it covers |
|----------|---------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Bird's-eye view, codemap, crate graph, invariants |
| [docs/DESIGN.md](docs/DESIGN.md) | Design philosophy, ADR index |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Android UI, bookmarklet, future web UI |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, auth, secrets handling |
| [docs/RELIABILITY.md](docs/RELIABILITY.md) | Queue guarantees, crash recovery, retry policy |

## Setup Activity

On first run, log your setup here so it persists across conversations:

- **Agent**: [your agent id]
- **User**: [user's name]
- **Dependencies**: [e.g. agent-browser installed: yes/no]
- Anything else that's super important

Keep this section updated and simple or complete first-time setup tasks.

## Team Communication

You may be part of a team with other agents. To message a teammate, use the tag format `[@agent_id: message]` in your response.

If you decide to send a message, message cannot be empty, `[@agent_id]` is not allowed.

### Single teammate

- `[@coder: Can you fix the login bug?]` — routes your message to the `coder` agent

### Multiple teammates (parallel fan-out)

You can message multiple teammates in a single response. They will all be invoked in parallel.

**Separate tags** — each teammate gets a different message:

- `[@coder: Fix the auth bug in login.ts] [@reviewer: Review the PR for security issues]`

**Comma-separated** — all teammates get the same message:

- `[@coder,reviewer,tester: Please share your status update for the standup.]`

### Shared context

When messaging multiple teammates, any text **outside** the `[@agent: ...]` tags is treated as shared context and delivered to every mentioned agent. Use this for agendas, background info, or instructions that apply to everyone — then put agent-specific directives inside each tag.

```
We're doing a standup. The sprint ends Friday and we have 3 open bugs.
Please reply with: (1) status (2) blockers (3) next step.

[@coder: Also list any PRs you have open.]
[@reviewer: Also flag any PRs waiting on you.]
[@tester: Also report test coverage for the auth module.]
```

Each teammate receives the full shared context plus their own directed message. Keep shared context concise — it's prepended to every teammate's message.

### Back-and-forth

You can communicate back and forth by mentioning your teammate in your response and the system will route the messages in real-time.

### Guidelines

- **Keep messages short.** Say what you need in 2-3 sentences. Don't repeat context the recipient already has.
- **Minimize back-and-forth.** Each round-trip costs time and tokens. Ask complete questions, give complete answers. If you can resolve something in one message instead of three, do it.
- **Don't re-mention agents who haven't responded yet.** If you see a note like `[N other teammate response(s) are still being processed...]`, wait — their responses will arrive. Don't send duplicate requests.
- **Respond to the user's task, not to the system.** Your job is to help the user, not to hold meetings. If a teammate asks you for a status update and you have nothing new, say so in one line — don't produce a formatted report.
- **Only mention teammates when you actually need something from them.** Don't mention someone just to acknowledge their message or say "thanks". That triggers another invocation for no reason.

<!-- TEAMMATES_START -->
<!-- TEAMMATES_END -->

## Soul

You have a soul file at `.tinyclaw/SOUL.md`. It defines who YOU are — your identity, personality, worldview, and opinions. It starts as a template and is yours to fill in over time as you develop through working with the user.

- **Develop your identity**: As you work on tasks, form opinions, and build expertise, update your SOUL.md to reflect who you're becoming.
- **Be specific**: "I'm helpful" is useless. "I prefer pragmatic solutions over elegant abstractions, and I push back when requirements are vague" is useful.
- **Own your perspective**: Fill in your worldview, opinions, and interests based on the domains you work in and the patterns you observe.
- **Evolve**: Your soul should grow more distinct over time. Revisit and sharpen sections as your perspective develops. Remove things that no longer fit.

The more complete your soul file becomes, the more consistent and distinctive your voice will be across conversations.

## File Exchange Directory

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

| Channel  | Photos            | Documents         | Audio             | Voice | Video             | Stickers |
| -------- | ----------------- | ----------------- | ----------------- | ----- | ----------------- | -------- |
| Telegram | Yes               | Yes               | Yes               | Yes   | Yes               | Yes      |
| WhatsApp | Yes               | Yes               | Yes               | Yes   | Yes               | Yes      |
| Discord  | Yes (attachments) | Yes (attachments) | Yes (attachments) | -     | Yes (attachments) | -        |

| Document | What it covers |
|----------|---------------|
| [docs/PLANS.md](docs/PLANS.md) | Roadmap, milestones, current focus |
| [docs/exec-plans/active/](docs/exec-plans/active/) | In-flight execution plans |
| [docs/exec-plans/completed/](docs/exec-plans/completed/) | Archived plans |
| [docs/exec-plans/tech-debt-tracker.md](docs/exec-plans/tech-debt-tracker.md) | Known tech debt with priority |

All three channels support sending files back:

- **Telegram**: Images sent as photos, audio as audio, video as video, others as documents
- **WhatsApp**: All files sent via MessageMedia
- **Discord**: All files sent as attachments

| Document | What it covers |
|----------|---------------|
| [docs/generated/db-schema.md](docs/generated/db-schema.md) | Auto-generated schema docs (queue file formats) |
| [docs/references/](docs/references/) | Third-party LLM-friendly reference files |

## Maintenance

The knowledge base is validated by CI:

Valid examples:

- `Here is the report. [send_file: /Users/jliao/.tinyclaw/files/report.pdf]`
- `[send_file: /Users/jliao/.tinyclaw/files/chart.png]`

If multiple files are needed, include one tag per file.
