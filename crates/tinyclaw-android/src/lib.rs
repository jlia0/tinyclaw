//! Android JNI bridge for TinyClaw.
//!
//! This crate produces a `cdylib` (`libtinyclaw_android.so`) that is loaded by
//! the Android foreground service via JNI.  It starts a tokio runtime and runs
//! the inference engine + HTTP API.
//!
//! The Android app (Kotlin) is responsible for:
//! - Creating the foreground service with notification
//! - Managing START_STICKY lifecycle
//! - Calling nativeStart/nativeStop JNI functions

use std::sync::OnceLock;
use tokio::sync::broadcast;

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
static SHUTDOWN: OnceLock<broadcast::Sender<()>> = OnceLock::new();

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn get_runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create tokio runtime")
    })
}

/// Initialize tracing for the current platform.
fn init_tracing() {
    #[cfg(target_os = "android")]
    {
        use android_logger::Config;
        use log::LevelFilter;

        // Route log crate records → Android logcat
        android_logger::init_once(
            Config::default()
                .with_max_level(LevelFilter::Info)
                .with_tag("TinyClaw"),
        );

        // Bridge tracing events → log crate → logcat
        let _ = tracing_log::LogTracer::init();
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = tracing_subscriber::fmt().with_ansi(true).try_init();
    }
}

async fn start_tinyclaw(data_dir: &str, model_id: &str) -> anyhow::Result<()> {
    let data_path = std::path::PathBuf::from(data_dir);
    let tinyclaw_dir = data_path.join(".tinyclaw");

    // Ensure directory structure exists
    tokio::fs::create_dir_all(tinyclaw_dir.join("queue/incoming")).await?;
    tokio::fs::create_dir_all(tinyclaw_dir.join("queue/processing")).await?;
    tokio::fs::create_dir_all(tinyclaw_dir.join("queue/outgoing")).await?;
    tokio::fs::create_dir_all(tinyclaw_dir.join("logs")).await?;

    // Load or create settings, applying the selected model
    let settings_path = tinyclaw_dir.join("settings.json");
    let mut settings = if settings_path.exists() {
        tinyclaw_core::Settings::load(&settings_path)?
    } else {
        tinyclaw_core::Settings {
            channels: Default::default(),
            models: Default::default(),
            monitoring: Default::default(),
            http: tinyclaw_core::config::HttpSettings {
                enabled: true,
                port: 8787,
                cors_origins: Vec::new(),
            },
            freehold: Default::default(),
        }
    };

    // Apply model selected in the Android UI
    settings.models.local.model = model_id.to_string();
    settings.http.enabled = true;
    settings.save(&settings_path)?;

    tracing::info!(
        model = model_id,
        port = settings.http.port,
        "Starting TinyClaw"
    );

    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let _ = SHUTDOWN.set(shutdown_tx.clone());

    // Initialize queue
    let queue =
        std::sync::Arc::new(tinyclaw_core::QueueDir::new(tinyclaw_dir.join("queue")).await?);

    // Initialize inference engine
    let engine = std::sync::Arc::new(
        tinyclaw_inference::InferenceEngine::new(
            model_id,
            "You are TinyClaw, a helpful AI assistant running locally on an Android device.",
            &tinyclaw_dir,
        )
        .await?,
    );

    // Spawn queue processor
    tokio::spawn(tinyclaw_inference::run_queue_processor(
        queue.clone(),
        engine.clone(),
        tinyclaw_dir.clone(),
        shutdown_tx.subscribe(),
    ));

    // Spawn HTTP API (always enabled on Android for bookmarklet access)
    let http = tinyclaw_http::HttpServer::new(queue.clone(), settings.http.clone());
    tokio::spawn(async move {
        if let Err(e) = http.start(shutdown_tx.subscribe()).await {
            tracing::error!(error = %e, "HTTP server error");
        }
    });

    tracing::info!("TinyClaw started on Android");
    Ok(())
}

// ─── JNI exports (Android only) ───────────────────────────────────────────

#[cfg(target_os = "android")]
mod jni_bridge {
    use super::*;
    use jni::objects::{JClass, JString};
    use jni::sys::jint;
    use jni::JNIEnv;

    /// Called from `TinyClawService.nativeStart(dataDir, modelId)`.
    ///
    /// Returns 0 on success, negative on JNI string extraction failure.
    #[no_mangle]
    pub extern "system" fn Java_com_tinyclaw_TinyClawService_nativeStart(
        mut env: JNIEnv,
        _class: JClass,
        data_dir: JString,
        model_id: JString,
    ) -> jint {
        init_tracing();

        let data_dir: String = match env.get_string(&data_dir) {
            Ok(s) => s.into(),
            Err(_) => return -1,
        };

        let model_id: String = match env.get_string(&model_id) {
            Ok(s) => s.into(),
            Err(_) => return -2,
        };

        tracing::info!(
            data_dir = %data_dir,
            model_id = %model_id,
            "nativeStart called"
        );

        let rt = get_runtime();
        rt.spawn(async move {
            if let Err(e) = start_tinyclaw(&data_dir, &model_id).await {
                tracing::error!(error = %e, "Failed to start TinyClaw");
            }
        });

        0
    }

    /// Called from `TinyClawService.nativeStop()`.
    #[no_mangle]
    pub extern "system" fn Java_com_tinyclaw_TinyClawService_nativeStop(
        _env: JNIEnv,
        _class: JClass,
    ) -> jint {
        tracing::info!("nativeStop called");
        if let Some(tx) = SHUTDOWN.get() {
            let _ = tx.send(());
        }
        0
    }

    /// Called from `MainActivity.nativeGetStatus()`.
    ///
    /// Returns a JSON string with engine status for UI display.
    #[no_mangle]
    pub extern "system" fn Java_com_tinyclaw_MainActivity_nativeGetStatus<'local>(
        env: JNIEnv<'local>,
        _class: JClass<'local>,
    ) -> jni::sys::jobject {
        let running = SHUTDOWN.get().is_some();
        let json = serde_json::json!({
            "running": running,
            "version": env!("CARGO_PKG_VERSION"),
        });
        match env.new_string(json.to_string()) {
            Ok(s) => s.into_raw(),
            Err(_) => std::ptr::null_mut(),
        }
    }
}

// ─── Non-Android stub for testing ─────────────────────────────────────────

#[cfg(not(target_os = "android"))]
pub async fn start(data_dir: &str, model_id: &str) -> anyhow::Result<()> {
    init_tracing();
    start_tinyclaw(data_dir, model_id).await
}
