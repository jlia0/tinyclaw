# Reliability

## Queue Guarantees

The file-based queue provides **at-least-once delivery**:

1. `enqueue()` writes to a temp file then atomically renames into `incoming/`.
   If the process crashes mid-write the temp file is orphaned but never
   visible to the processor.

2. `claim_next()` atomically renames the oldest file from `incoming/` to
   `processing/`.  Only one processor can win the rename.

3. On success, `complete()` writes the response to `outgoing/` and deletes
   the processing file.

4. On failure, `retry()` renames the file back to `incoming/` so it will be
   re-processed.

5. If the process crashes while a file is in `processing/`, it stays there.
   A future startup or operator can move it back to `incoming/` manually.

## Crash Recovery

| Scenario | Recovery |
|----------|----------|
| Crash before `claim_next` | Message stays in `incoming/`, picked up on restart |
| Crash during inference | Message in `processing/`, needs manual move back |
| Crash after `complete` | Response in `outgoing/`, channel will deliver on restart |
| LiteRT-LM dies | `InferenceEngine` reports error, message retried |

## Retry Policy

- Queue processor retries immediately via `queue.retry()` on inference error.
- Channels poll outgoing every 1 second.  If delivery fails the file stays
  in `outgoing/` for the next poll cycle.
- No exponential backoff currently — the 1-second poll interval is the
  implicit retry rate.

## Shutdown

Graceful shutdown via `tokio::sync::broadcast`.  Every spawned task holds a
receiver.  On Ctrl-C the orchestrator sends a single message; tasks drain
current work and exit.  The Android `nativeStop()` JNI call triggers the same
broadcast.

## Known Gaps

- No dead-letter queue.  Messages that permanently fail stay in `processing/`
  until manually resolved.
- No automatic recovery of `processing/` files on startup.
- No health check endpoint that verifies LiteRT-LM is responsive (only
  `/v1/status` which checks the HTTP server itself).
