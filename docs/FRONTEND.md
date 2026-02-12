# Frontend & UI

## Android App (`android/`)

Minimal Material3 app targeting API 26+ (arm64 only).

### Components

- **MainActivity** — Single-screen UI with a model spinner, start/stop button,
  and status text.  Requests `POST_NOTIFICATIONS` on Android 13+.
- **TinyClawService** — `START_STICKY` foreground service.  Loads
  `libtinyclaw_android.so` and calls `nativeStart(filesDir)` /
  `nativeStop()` via JNI.
- **TinyClawApp** — Application subclass that creates the notification channel
  on `onCreate`.

### Data flow

```
MainActivity  ──→  startForegroundService()
                       │
                 TinyClawService.onStartCommand()
                       │
                  System.loadLibrary("tinyclaw_android")
                       │
                  nativeStart(filesDir)
                       │
              ┌────────┴────────┐
              │  Tokio runtime  │
              │  (OnceLock)     │
              │  ┌────────────┐ │
              │  │ QueueProc  │ │
              │  │ HTTP :8787 │ │
              │  └────────────┘ │
              └─────────────────┘
```

### Build

```bash
cargo ndk -t arm64-v8a build --release -p tinyclaw-android
# then copy libtinyclaw_android.so into android/app/src/main/jniLibs/arm64-v8a/
```

## Bookmarklet

The `bookmarklet` CLI subcommand generates a JavaScript snippet that hits
`/v1/chat` on the local (or freehold-relayed) HTTP server.  No dedicated
frontend — it runs inside the user's browser on any page.

## Future: Web UI

No web frontend exists yet.  When one is added it should be a static SPA
served by `tinyclaw-http` on the same port (8787) and should consume the
existing `/v1/chat`, `/v1/status`, and `/v1/reset` endpoints.
