# ADR-001: Core Beliefs

**Status:** Accepted
**Date:** 2025-01

## Context

TinyClaw started as a Node.js prototype calling cloud LLM APIs.  As the
project matured, several fundamental questions needed permanent answers:

- Where does inference run?
- How do channels communicate with the processor?
- What language should the core be written in?

## Decision

1. **Local-only inference.**  All models run on-device via LiteRT-LM.  No
   cloud API calls.  This maximizes privacy and eliminates billing surprises.

2. **File-based FIFO queue.**  Communication between channels and the
   processor happens through JSON files in a shared directory.  Atomic
   `rename(2)` is the only synchronization mechanism.  This avoids external
   dependencies (Redis, SQLite) and works on every OS including Android's
   app-private storage.

3. **Rust for the core.**  The original TypeScript was rewritten in Rust for:
   - Single static binary per platform (no Node.js runtime).
   - Safe concurrency via the type system.
   - Straightforward cross-compilation to Android via `cargo-ndk`.

## Consequences

- **Positive:** No API keys, no cloud costs, no network dependency for
  inference.  Single binary simplifies distribution.  File queue is trivially
  debuggable (`ls`, `cat`).
- **Negative:** Model quality is limited by what runs locally.  The file
  queue has no built-in dead-letter or TTL mechanism.  Rust has a steeper
  learning curve for contributors coming from TypeScript.
