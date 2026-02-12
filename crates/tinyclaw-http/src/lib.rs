use axum::extract::State;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tinyclaw_core::channel::{generate_message_id, now_millis};
use tinyclaw_core::config::HttpSettings;
use tinyclaw_core::message::{Channel, IncomingMessage};
use tinyclaw_core::queue::QueueDir;
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    queue: Arc<QueueDir>,
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    message: String,
}

#[derive(Debug, Serialize)]
struct ChatResponse {
    message: String,
    message_id: String,
}

#[derive(Debug, Serialize)]
struct StatusResponse {
    status: String,
    version: String,
}

struct AppError(anyhow::Error);

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": self.0.to_string() })),
        )
            .into_response()
    }
}

impl<E: Into<anyhow::Error>> From<E> for AppError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

/// HTTP API server for the bookmarklet use case.
pub struct HttpServer {
    queue: Arc<QueueDir>,
    settings: HttpSettings,
}

impl HttpServer {
    pub fn new(queue: Arc<QueueDir>, settings: HttpSettings) -> Self {
        Self { queue, settings }
    }

    pub async fn start(
        &self,
        mut shutdown: tokio::sync::broadcast::Receiver<()>,
    ) -> anyhow::Result<()> {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let state = AppState {
            queue: self.queue.clone(),
        };

        let app = Router::new()
            .route("/v1/chat", post(chat_handler))
            .route("/v1/status", get(status_handler))
            .route("/v1/reset", post(reset_handler))
            .layer(cors)
            .with_state(state);

        let addr = SocketAddr::from(([0, 0, 0, 0], self.settings.port));
        tracing::info!("HTTP API listening on {}", addr);

        let listener = tokio::net::TcpListener::bind(addr).await?;

        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = shutdown.recv().await;
            })
            .await?;

        Ok(())
    }
}

async fn chat_handler(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<Json<ChatResponse>, AppError> {
    let message_id = generate_message_id();

    let incoming = IncomingMessage {
        channel: Channel::Http,
        sender: "bookmarklet".into(),
        sender_id: "http".into(),
        message: req.message,
        timestamp: now_millis(),
        message_id: message_id.clone(),
    };

    state.queue.enqueue(&incoming).await?;

    tracing::info!("HTTP message queued: {}", message_id);

    // Poll for response with timeout
    let timeout = Duration::from_secs(120);
    let start = std::time::Instant::now();
    let poll_interval = Duration::from_millis(500);

    loop {
        if start.elapsed() > timeout {
            return Ok(Json(ChatResponse {
                message: "Request timed out waiting for response.".to_string(),
                message_id,
            }));
        }

        // Check outgoing queue for our response
        let responses = state.queue.poll_outgoing("http_").await?;
        for (path, response) in responses {
            if response.message_id == message_id {
                state.queue.ack_outgoing(&path).await?;
                return Ok(Json(ChatResponse {
                    message: response.message,
                    message_id,
                }));
            }
        }

        tokio::time::sleep(poll_interval).await;
    }
}

async fn status_handler() -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

async fn reset_handler() -> Result<Json<serde_json::Value>, AppError> {
    let reset_flag = std::path::Path::new(".tinyclaw/reset_flag");
    tokio::fs::write(reset_flag, "reset").await?;
    Ok(Json(
        serde_json::json!({ "status": "ok", "message": "Conversation reset" }),
    ))
}
