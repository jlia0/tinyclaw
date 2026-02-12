# Security

## Threat Model

TinyClaw is designed as a **single-user, self-hosted** assistant.  The primary
security boundary is the host machine.  There is no multi-tenancy.

### Trust boundaries

| Boundary | Trust level |
|----------|------------|
| Local filesystem (`.tinyclaw/`) | Fully trusted |
| `localhost:18787` (LiteRT-LM) | Trusted — same machine, no auth |
| `localhost:8787` (HTTP API) | Semi-trusted — CORS is permissive |
| Discord / Telegram gateways | Untrusted network; auth via bot tokens |
| Freehold relay | Untrusted network relay; optional |

### Secrets

- **Bot tokens** are stored in `.tinyclaw/settings.json`.  This file should
  have mode `0600`.  It is `.gitignore`d.
- **No API keys** are needed for inference — LiteRT-LM runs locally.
- The `.tinyclaw/` directory should never be committed to version control.

### Attack surface

- **HTTP API.**  CORS is set to allow any origin so the bookmarklet works from
  any page.  If the host is network-reachable, anyone on the LAN can call
  `/v1/chat`.  Bind to `127.0.0.1` (current default) to limit exposure.
- **Queue injection.**  Any process with filesystem write access to
  `.tinyclaw/queue/incoming/` can inject messages.  This is by design for
  extensibility but means filesystem permissions are the auth layer.
- **LiteRT-LM subprocess.**  Spawned with the same privileges as the TinyClaw
  process.  No sandboxing beyond the OS process model.

## Recommendations

1. Run TinyClaw under a dedicated unprivileged user.
2. Ensure `.tinyclaw/settings.json` is `0600`.
3. Do not expose port 8787 to the public internet without an auth proxy.
4. Keep bot tokens out of version control.
