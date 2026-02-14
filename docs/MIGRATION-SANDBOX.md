# Sandbox Migration Guide

This guide helps existing TinyClaw installations adopt sandbox mode safely.

## Upgrade-Safe Defaults

- Existing installs keep `sandbox.mode = "host"` unless changed.
- New setup wizard runs can default to containerized mode if runtime is available.

## Step-by-Step Migration

1. Verify environment variables in your shell startup:

```bash
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
```

2. Review current settings:

```bash
tinyclaw sandbox show
```

3. Build or pull your sandbox image:

```bash
tinyclaw sandbox build-image
```

4. Run preflight checks:

```bash
tinyclaw sandbox doctor
```

5. Enable sandbox mode:

```bash
tinyclaw sandbox set docker
# or
tinyclaw sandbox set apple
```

6. Restart TinyClaw:

```bash
tinyclaw restart
```

## Rollback

If runtime issues occur:

```bash
tinyclaw sandbox set host
tinyclaw restart
```

## Dead-Letter Recovery

If messages fail repeatedly, inspect:

```bash
ls -la ~/.tinyclaw/queue/dead-letter/
```

Each file contains:

- original payload,
- error class (`transient` or `terminal`),
- attempt counters,
- failure timestamp.
