# Sandbox Runtime

TinyClaw supports sandboxed execution for agent provider CLIs with three modes:

- `host` - current behavior, runs directly on host.
- `docker` - runs each invocation in an ephemeral Docker container.
- `apple` - runs each invocation using a configurable Apple container runtime command.

## Why Sandbox Mode

- Isolates agent execution from host filesystem/process namespace.
- Applies explicit resource limits and invocation timeouts.
- Enforces fail-closed behavior when sandbox runtime is unavailable or misconfigured.

## Configuration

Sandbox configuration is stored in `~/.tinyclaw/settings.json` (or local `.tinyclaw/settings.json`).

```json
{
  "sandbox": {
    "mode": "host",
    "timeout_seconds": 600,
    "max_attempts": 3,
    "max_concurrency": 0,
    "env_allowlist": ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
    "path_mapping_mode": "mapped",
    "docker": {
      "image": "tinyclaw/agent-runner:latest",
      "network": "default",
      "memory": "2g",
      "cpus": "1.0",
      "pids_limit": 256
    },
    "apple": {
      "runtime_command": "apple-container",
      "image": "tinyclaw/agent-runner:latest",
      "network": "default",
      "memory": "2g",
      "cpus": "1.0"
    }
  }
}
```

## Per-Agent Override

Agents can override the global mode:

```json
{
  "agents": {
    "coder": {
      "name": "Coder",
      "provider": "openai",
      "model": "gpt-5.3-codex",
      "working_directory": "/Users/me/tinyclaw-workspace/coder",
      "sandbox_mode": "docker"
    }
  }
}
```

## Path Mapping and File Attachments

When agents return tags like:

```text
[send_file: /workspace/result.png]
```

TinyClaw maps container paths back to host paths before attaching files to channel replies.

- `path_mapping_mode: "mapped"` maps `/workspace` to the agent host working directory.
- `path_mapping_mode: "same-path"` expects the same absolute path inside/outside the container.

If a file cannot be resolved on host, TinyClaw strips the tag and appends a warning to the response.

## Fail-Closed Behavior

In `docker`/`apple` mode:

- missing runtime command,
- missing required API key env vars,
- invalid sandbox configuration,
- or terminal container runtime errors

all cause request failure without host fallback.

## Retries and Dead-Letter

- Transient errors are retried up to `sandbox.max_attempts`.
- Messages that exhaust retries or fail terminally are written to:
  - `~/.tinyclaw/queue/dead-letter/`

## Commands

```bash
tinyclaw sandbox show
tinyclaw sandbox set docker
tinyclaw sandbox doctor
tinyclaw sandbox build-image
```

## Generic User Flow (Docker)

```bash
# Set API keys in shell
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."   # only if Anthropic agents are configured

# Build sandbox image and validate
tinyclaw sandbox build-image
tinyclaw sandbox doctor

# Restart to apply env + mode
tinyclaw restart
```

Verification:

```bash
# Containers are ephemeral, so inspect events instead of docker ps
docker events --filter type=container --format '{{.Time}} {{.Action}} {{.Actor.Attributes.image}} {{.Actor.Attributes.name}}'
```

## Image Notes

`Dockerfile.agent-runner` provides a minimal base image.  
For production, build a derived image that includes provider CLIs (`claude`, `codex`).
