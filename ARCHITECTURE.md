# Architecture

This document describes the high-level architecture of TinyClaw.
If you want to familiarize yourself with the codebase, you are in the right place.

See also the [AGENTS.md](AGENTS.md) table of contents for pointers into
the rest of the knowledge base.

## Bird's Eye View

TinyClaw is a modular, multi-channel AI assistant that runs local LLM
inference on-device via LiteRT-LM.  Messaging channels (Discord, Telegram,
HTTP) feed into a **file-based FIFO queue**; a single queue-processor goroutine
claims one message at a time, sends it through the inference engine, and writes
the reply back to an outgoing queue that each channel polls independently.

The queue is the backbone.  Every channel writes JSON files to `incoming/`; the
processor atomically renames (claims) the oldest file into `processing/`; on
completion the response goes to `outgoing/` and the processing file is deleted.
Because the file system provides atomic rename, no two processors can claim the
same file, and there are zero race conditions without any external lock service.

```
 Discord ──┐                              ┌── Discord
 Telegram ─┤   incoming/   processing/    ├── Telegram
 HTTP ─────┤──→  *.json  ─→  *.json  ─→  ├── HTTP
 Heartbeat ┘       ↑           │          └── (any channel)
                   │           ↓
                   │     InferenceEngine
                   │     (litert-lm on :18787)
                   │           │
                   │           ↓
                   │      outgoing/
                   │        *.json
                   └────── (retry on error)
```

## Codemap

### `crates/tinyclaw-core`

Foundation crate.  Every other crate depends on it.  Search for:

- `IncomingMessage`, `OutgoingMessage` — the canonical message types.
- `Channel` — enum of all channel kinds (Discord, Telegram, Http, Heartbeat, …).
- `ChannelClient` — async trait every channel implements (`start`, `channel_id`, `name`).
- `QueueDir` — file-based FIFO queue with `enqueue`, `claim_next`, `complete`,
  `retry`, `poll_outgoing`, `ack_outgoing`.
- `Settings` — deserialized from `.tinyclaw/settings.json`; covers channels,
  models, monitoring, HTTP, and freehold relay config.
- `init_logging` — dual-sink tracing (stdout + rolling file).

Nothing in `tinyclaw-core` depends on any other workspace crate.

### `crates/tinyclaw-inference`

Local LLM engine.  Search for:

- `InferenceEngine` — spawns `litert-lm serve <model> --port 18787` as a
  child process and talks to it over an OpenAI-compatible HTTP API.
- `ConversationManager` — sliding-window context with a 4 096-token budget.
  System prompt is prepended to every request.
- `run_queue_processor` — the main 1-second polling loop that calls
  `queue.claim_next()` → `engine.process()` → `queue.complete()`.

Depends only on `tinyclaw-core`.

### `crates/tinyclaw-channel-discord`

Discord I/O via serenity 0.12.  Search for `DiscordClient`, `DiscordHandler`.
Spawns three tasks: gateway event loop, outgoing poller (1 s), typing
indicator (8 s).  Message splitting at 2 000 chars.

### `crates/tinyclaw-channel-telegram`

Telegram I/O via teloxide 0.13.  Search for `TelegramClient`, `PendingMsg`.
Same three-task pattern as Discord.  Message splitting at 4 096 chars.

### `crates/tinyclaw-http`

Axum 0.8 server with three routes:

| Route | Purpose |
|-------|---------|
| `POST /v1/chat` | Accept `ChatRequest`, enqueue, poll outgoing for up to 120 s |
| `GET  /v1/status` | Health check (`{ status: "ok" }`) |
| `POST /v1/reset` | Write `.tinyclaw/reset_flag` |

CORS is permissive (any origin) to support the browser bookmarklet.

### `crates/tinyclaw-cli`

The `tinyclaw` binary.  Subcommands: `start`, `setup`, `status`, `send`,
`reset`, `model`, `pull`, `models`, `bookmarklet`, `install-service`.

`start` is the orchestrator: loads settings, creates a broadcast shutdown
channel, spawns the inference engine + queue processor + every enabled
channel + HTTP server + heartbeat task, then awaits Ctrl-C.

### `crates/tinyclaw-android`

`cdylib` producing `libtinyclaw_android.so`.  Exports two JNI functions
(`nativeStart`, `nativeStop`) called from the Kotlin foreground service.
Uses a `OnceLock` Tokio runtime so the JVM can start/stop the Rust world.

### `android/`

Minimal Android project (AGP 8.7, Kotlin 2.0).  Search for `TinyClawService`
(foreground service, `START_STICKY`), `TinyClawApp` (notification channel),
`MainActivity` (start/stop UI, model spinner).

### Legacy TypeScript (`src/`)

The original Node.js implementation.  `discord-client.ts`,
`telegram-client.ts`, `whatsapp-client.ts`, `queue-processor.ts`.  These call
out to `claude` / `codex` CLIs.  They are superseded by the Rust crates but
retained for reference and for the WhatsApp channel which has no Rust port yet.

## Crate Dependency Graph

```
tinyclaw-core
├── tinyclaw-inference
│   ├── tinyclaw-cli
│   └── tinyclaw-android
├── tinyclaw-channel-discord ──→ tinyclaw-cli (optional feature)
├── tinyclaw-channel-telegram ─→ tinyclaw-cli (optional feature)
├── tinyclaw-http
│   ├── tinyclaw-cli (optional feature)
│   └── tinyclaw-android
└── (no other internal deps)
```

## Invariants

- **Sequential processing.**  The queue processor claims exactly one message at
  a time.  There is no parallelism in the inference path.
- **Atomic queue operations.**  Every queue transition (enqueue, claim,
  complete) uses a temporary file + `fs::rename`.  This is the only
  concurrency primitive the queue needs.
- **Channel isolation.**  Channels share nothing except the queue directory.
  Each manages its own authentication, connection, and retry logic.
- **Core is dependency-free (relative to the workspace).**  `tinyclaw-core`
  never imports another workspace crate.  All data flows through it.
- **No model layer depends on any channel.**  `tinyclaw-inference` knows
  nothing about Discord, Telegram, or HTTP.  It consumes `IncomingMessage`
  and produces `OutgoingMessage`.

## Cross-Cutting Concerns

**Error handling.**  `anyhow` for application errors, `thiserror` for typed
errors in core.  Channel errors are logged and retried; inference errors move
the message back to `incoming/` via `queue.retry()`.

**Logging.**  `tracing` + `tracing-subscriber` with a dual sink: stdout for
interactive use, rolling file under `.tinyclaw/logs/` for production.
`serenity` and `teloxide` debug noise is filtered out.

**Shutdown.**  A `tokio::sync::broadcast` channel.  `start` sends a single
message on Ctrl-C; every spawned task holds a receiver and exits cleanly.

**Configuration.**  Single JSON file at `.tinyclaw/settings.json`.  Loaded once
at startup; the `setup` wizard and `model` subcommand write it.

**Reset.**  Writing the sentinel file `.tinyclaw/reset_flag` signals the
processor to call `InferenceEngine::reset()`.  Any channel can trigger this.

## Build & CI

GitHub Actions (`.github/workflows/build.yml`) builds for five targets:
`aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`,
`aarch64-unknown-linux-gnu`, `x86_64-pc-windows-msvc`, and
`aarch64-linux-android`.  A `check` job runs `cargo check`, `clippy -D warnings`,
and `cargo fmt --check` on every push and PR.
