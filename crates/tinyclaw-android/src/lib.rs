//! Android JNI bridge for TinyClaw.
//!
//! This crate produces a `cdylib` (`libtinyclaw.so`) that is loaded by the
//! Android foreground service via JNI. It starts a tokio runtime and runs
//! the inference engine + HTTP API + Telegram channel.
//!
//! The Android app (Kotlin) is responsible for:
//! - Creating the foreground service with notification
//! - Managing START_STICKY lifecycle
//! - Calling nativeStart/nativeStop JNI functions

#![allow(dead_code)]

use std::sync::OnceLock;
use tokio::sync::broadcast;

static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
static SHUTDOWN: OnceLock<broadcast::Sender<()>> = OnceLock::new();

fn get_runtime() -> &'static tokio::runtime::Runtime {
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("Failed to create tokio runtime")
    })
}

async fn start_tinyclaw(data_dir: &str) -> anyhow::Result<()> {
    let data_path = std::path::PathBuf::from(data_dir);
    let tinyclaw_dir = data_path.join(".tinyclaw");

    // Load or create default settings
    let settings_path = tinyclaw_dir.join("settings.json");
    let settings = if settings_path.exists() {
        tinyclaw_core::Settings::load(&settings_path)?
    } else {
        let settings = tinyclaw_core::Settings {
            channels: Default::default(),
            models: Default::default(),
            monitoring: Default::default(),
            http: tinyclaw_core::config::HttpSettings {
                enabled: true,
                port: 8787,
                cors_origins: Vec::new(),
            },
            freehold: Default::default(),
        };
        settings.save(&settings_path)?;
        settings
    };

    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    let _ = SHUTDOWN.set(shutdown_tx.clone());

    // Initialize queue
    let queue = std::sync::Arc::new(
        tinyclaw_core::QueueDir::new(tinyclaw_dir.join("queue")).await?,
    );

    // Initialize inference engine
    let engine = std::sync::Arc::new(
        tinyclaw_inference::InferenceEngine::new(
            &settings.models.local.model,
            "You are TinyClaw, a helpful AI assistant.",
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

    // Spawn HTTP API (always enabled on Android for bookmarklet)
    let http = tinyclaw_http::HttpServer::new(queue.clone(), settings.http.clone());
    tokio::spawn(async move {
        if let Err(e) = http.start(shutdown_tx.subscribe()).await {
            tracing::error!(error = %e, "HTTP server error");
        }
    });

    tracing::info!("TinyClaw started on Android");
    Ok(())
}

// JNI exports are only compiled for Android targets
#[cfg(target_os = "android")]
mod jni_bridge {
    use super::*;
    use jni::objects::{JClass, JString};
    use jni::sys::jint;
    use jni::JNIEnv;

    #[no_mangle]
    pub extern "system" fn Java_com_tinyclaw_TinyClawService_nativeStart(
        mut env: JNIEnv,
        _class: JClass,
        data_dir: JString,
    ) -> jint {
        let data_dir: String = match env.get_string(&data_dir) {
            Ok(s) => s.into(),
            Err(_) => return -1,
        };

        let rt = get_runtime();
        rt.spawn(async move {
            if let Err(e) = start_tinyclaw(&data_dir).await {
                tracing::error!(error = %e, "Failed to start TinyClaw");
            }
        });

        0
    }

    #[no_mangle]
    pub extern "system" fn Java_com_tinyclaw_TinyClawService_nativeStop(
        _env: JNIEnv,
        _class: JClass,
    ) -> jint {
        if let Some(tx) = SHUTDOWN.get() {
            let _ = tx.send(());
        }
        0
    }
}

// For non-Android builds, provide stub functions for testing
#[cfg(not(target_os = "android"))]
pub async fn start(data_dir: &str) -> anyhow::Result<()> {
    start_tinyclaw(data_dir).await
}
