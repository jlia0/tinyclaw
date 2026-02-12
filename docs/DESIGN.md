# Design Philosophy

## Principles

1. **Local-first.**  All inference happens on-device.  No API keys, no cloud
   calls, no data leaves the machine.  LiteRT-LM runs the model as a
   subprocess and TinyClaw talks to it over localhost.

2. **File-based queue over message brokers.**  The queue is a directory of
   JSON files.  `fs::rename` is the only concurrency primitive.  This
   eliminates Redis, RabbitMQ, and every other moving part that could crash
   independently.

3. **One message at a time.**  The queue processor is deliberately single-
   threaded.  Parallelism adds complexity without benefit when the bottleneck
   is LLM inference latency.

4. **Channels are plugins.**  Implementing a new channel means implementing
   the `ChannelClient` trait and adding a feature flag.  Channels share
   nothing except the queue directory.

5. **Minimal surface area.**  Every crate exposes only what the next layer
   needs.  `tinyclaw-core` never imports a workspace sibling.  Inference
   knows nothing about Discord.

## Architecture Decision Records

See [design-docs/index.md](design-docs/index.md) for the full ADR log.

## Related

- [ARCHITECTURE.md](../ARCHITECTURE.md) — codemap and invariants
- [RELIABILITY.md](RELIABILITY.md) — operational guarantees
- [SECURITY.md](SECURITY.md) — threat model
