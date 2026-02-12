# Product Sense

## Who is TinyClaw for?

**Primary user:** A technical individual who wants a private, always-on AI
assistant reachable from any messaging app they already use — without sending
their data to a cloud API.

**Jobs to be done:**

1. Ask a question from my phone (Telegram/Discord) and get an answer from a
   local model within seconds.
2. Run the assistant 24/7 on a home server or phone and forget about it.
3. Extend the assistant to new channels without rewriting the core.
4. Keep full control — no API keys, no cloud billing, no vendor lock-in.

## Product Principles

1. **Zero-config happy path.**  `tinyclaw setup` + `tinyclaw start` should
   get a user from nothing to a working assistant in under two minutes.
2. **One binary.**  The Rust build produces a single static binary for each
   platform.  No runtime dependencies beyond LiteRT-LM.
3. **Channels are disposable.**  Enable or disable any channel without
   affecting the rest.  The queue decouples everything.
4. **Quiet by default.**  The assistant only speaks when spoken to, except
   for the opt-in heartbeat.

## Non-goals

- Multi-user / multi-tenant operation.
- Cloud-hosted SaaS offering.
- GUI configuration (CLI and settings.json are the interface).
- Competing with full-featured chatbot frameworks (Rasa, Botpress, etc.).
