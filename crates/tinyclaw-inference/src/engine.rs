use crate::conversation::ConversationManager;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Local inference engine that talks to an OpenAI-compatible server.
///
/// On desktop, spawns `litert-lm serve <model>` as a subprocess.
/// On Android (or when the subprocess is unavailable), expects an inference
/// server to already be running on the configured port.
pub struct InferenceEngine {
    conversation: Mutex<ConversationManager>,
    model_id: String,
    server_url: String,
    http_client: reqwest::Client,
    _server_handle: Option<Arc<Mutex<Option<tokio::process::Child>>>>,
}

impl InferenceEngine {
    /// Create a new inference engine.
    ///
    /// Attempts to spawn a `litert-lm` server subprocess.  If the binary is
    /// not found (typical on Android), falls back to connecting to an existing
    /// server on the inference port.
    pub async fn new(model_id: &str, system_prompt: &str, data_dir: &Path) -> anyhow::Result<Self> {
        let server_port = 18787_u16;
        let server_url = format!("http://127.0.0.1:{}", server_port);

        // Try to start the inference server subprocess
        let server_handle = match Self::start_server(model_id, server_port, data_dir).await {
            Ok(child) => {
                tracing::info!(
                    port = server_port,
                    model = model_id,
                    "LiteRT-LM server starting"
                );
                // Give the server time to bind its port
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                Some(Arc::new(Mutex::new(Some(child))))
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "Could not start litert-lm server; will connect to existing instance on {}",
                    server_url
                );
                None
            }
        };

        let engine = Self {
            conversation: Mutex::new(ConversationManager::new(system_prompt.to_string())),
            model_id: model_id.to_string(),
            server_url: server_url.clone(),
            http_client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()?,
            _server_handle: server_handle,
        };

        // Log whether the inference backend is reachable
        match engine.health_check().await {
            Ok(()) => tracing::info!(url = %server_url, "Inference server is reachable"),
            Err(e) => tracing::warn!(
                url = %server_url,
                error = %e,
                "Inference server not reachable yet — messages will retry"
            ),
        }

        Ok(engine)
    }

    async fn start_server(
        model_id: &str,
        port: u16,
        data_dir: &Path,
    ) -> anyhow::Result<tokio::process::Child> {
        let child = tokio::process::Command::new("litert-lm")
            .args(["serve", model_id, "--port", &port.to_string()])
            .env("TINYCLAW_DATA_DIR", data_dir.as_os_str())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        Ok(child)
    }

    /// Check if the inference server is reachable.
    pub async fn health_check(&self) -> anyhow::Result<()> {
        let url = format!("{}/v1/models", self.server_url);
        let resp = self
            .http_client
            .get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await?;
        if resp.status().is_success() || resp.status().as_u16() == 404 {
            // 404 is fine — server is up, just doesn't have /v1/models
            Ok(())
        } else {
            anyhow::bail!("Unexpected status {}", resp.status());
        }
    }

    /// Process a message and return the response via the OpenAI-compatible API.
    pub async fn process(&self, user_message: &str) -> anyhow::Result<String> {
        let mut conv = self.conversation.lock().await;
        conv.add_user_message(user_message.to_string());

        let messages = conv.build_messages();

        let request_body = serde_json::json!({
            "model": self.model_id,
            "messages": messages,
            "max_tokens": 2048,
            "stream": false
        });

        let response = self
            .http_client
            .post(format!("{}/v1/chat/completions", self.server_url))
            .json(&request_body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Inference server returned {}: {}", status, body);
        }

        let body: serde_json::Value = response.json().await?;

        let response_text = body["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("Sorry, I could not generate a response.")
            .to_string();

        // Truncate at 4000 chars
        let response_text = if response_text.len() > 4000 {
            format!("{}\n\n[Response truncated...]", &response_text[..3900])
        } else {
            response_text
        };

        conv.add_assistant_message(response_text.clone());
        Ok(response_text)
    }

    /// Reset conversation state.
    pub async fn reset(&self) {
        self.conversation.lock().await.reset();
    }

    /// Check if reset flag exists and clear it.
    pub async fn check_and_clear_reset_flag(data_dir: &Path) -> bool {
        let flag = data_dir.join("reset_flag");
        if flag.exists() {
            let _ = tokio::fs::remove_file(&flag).await;
            true
        } else {
            false
        }
    }
}

impl Drop for InferenceEngine {
    fn drop(&mut self) {
        // Server process will be killed when the Child handle is dropped
    }
}
