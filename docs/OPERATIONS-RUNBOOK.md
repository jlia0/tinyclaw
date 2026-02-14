# Operations Runbook

Day-2 operational guide for sandbox-enabled TinyClaw deployments.

## Health Checks

1. Daemon status:

```bash
tinyclaw status
```

2. Sandbox diagnostics:

```bash
tinyclaw sandbox doctor
```

3. Queue depth:

```bash
ls -1 ~/.tinyclaw/queue/incoming | wc -l
ls -1 ~/.tinyclaw/queue/processing | wc -l
ls -1 ~/.tinyclaw/queue/dead-letter | wc -l
```

4. Log tails:

```bash
tinyclaw logs queue
tinyclaw logs daemon
```

## Standard Playbooks

### Runtime Missing or Broken

1. Switch to host mode for immediate service restoration:

```bash
tinyclaw sandbox set host
tinyclaw restart
```

2. Fix container runtime.
3. Re-run `tinyclaw sandbox doctor`.
4. Switch back to sandbox mode.

### Image Drift or Missing CLI Inside Image

1. Rebuild image:

```bash
tinyclaw sandbox build-image
```

2. Confirm image exists via `tinyclaw sandbox doctor`.
3. Restart daemon.

### Dead-Letter Growth

1. Inspect newest dead-letter entries.
2. Identify class:
   - `terminal`: configuration/runtime issue, no retries expected.
   - `transient`: intermittent runtime/provider failures.
3. Fix root cause, then replay manually by re-enqueuing payloads.

## Alerting Recommendations

- Alert when dead-letter file count increases rapidly.
- Alert when queue `processing` age exceeds timeout budget.
- Alert on repeated `sandbox_invocation_error` events for same agent.

## Capacity Controls

- Use `sandbox.max_concurrency` to cap concurrent container invocations.
- Tune `sandbox.timeout_seconds` based on provider latency and task size.
- Keep per-agent fan-out behavior under observation in busy teams.
