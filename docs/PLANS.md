# Plans & Roadmap

## Current Focus

- Stabilize Rust rewrite across all platforms (macOS, Linux, Windows, Android).
- Validate Android foreground-service lifecycle on real devices.
- Ensure CI builds green for all five targets.

## Near-term

- [ ] WhatsApp channel in Rust (currently TypeScript-only).
- [ ] Automatic recovery of orphaned `processing/` files on startup.
- [ ] Dead-letter queue for permanently failing messages.
- [ ] HTTP API authentication (bearer token or mTLS).
- [ ] Integration tests for the queue processor.

## Medium-term

- [ ] Web UI served by `tinyclaw-http`.
- [ ] Model download progress reporting on Android.
- [ ] Multi-model support (route different channels to different models).
- [ ] Freehold relay E2E encryption.

## Long-term

- [ ] Plugin system for custom pre/post-processing hooks.
- [ ] Voice channel support (speech-to-text → LLM → text-to-speech).
- [ ] Federated mode (multiple TinyClaw instances sharing a queue).

## See Also

- [exec-plans/active/](exec-plans/active/) — detailed plans for in-flight work.
- [exec-plans/completed/](exec-plans/completed/) — archived plans.
- [exec-plans/tech-debt-tracker.md](exec-plans/tech-debt-tracker.md) — known debt.
