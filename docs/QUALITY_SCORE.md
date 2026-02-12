# Quality Score

## Rubric

Quality is tracked across five dimensions.  Each is scored 1-5 where 3 means
"acceptable for a solo-developer project" and 5 means "production-grade".

| Dimension | Current | Target | Notes |
|-----------|---------|--------|-------|
| **Correctness** | 4 | 5 | Queue atomicity is solid; edge cases around `processing/` recovery are open |
| **Reliability** | 3 | 4 | No dead-letter queue, no automatic crash recovery of in-flight messages |
| **Performance** | 3 | 3 | Bottleneck is LLM inference; queue overhead is negligible |
| **Security** | 3 | 4 | Permissive CORS, no HTTP auth, secrets in plaintext JSON |
| **Developer UX** | 4 | 5 | CLI is clean; docs are being built out; CI is green |

## Metrics (future)

These are not instrumented yet but should be:

- **p99 message latency** — time from `enqueue` to `ack_outgoing`.
- **Queue depth** — files in `incoming/` at any point.
- **Inference errors/hour** — count of `queue.retry()` calls.
- **Uptime** — percentage of time the heartbeat fires on schedule.

## SLOs (aspirational)

| SLO | Target |
|-----|--------|
| Message processed within 30 s of arrival | 95 % |
| Zero messages permanently lost | 100 % |
| Graceful shutdown completes within 5 s | 99 % |
