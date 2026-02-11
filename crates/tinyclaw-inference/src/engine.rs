use crate::conversation::ConversationManager;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

/// LiteRT-LM based local inference engine.
///
/// Uses the litert-lm high-level crate which provides:
/// - Auto-download of platform-specific LiteRT-LM binaries
/// - OpenAI-compatible HTTP endpoint at /v1/chat/completions
/// - Process isolation per model
///
/// The engine spawns a litert-lm server process and communicates via HTTP.
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
    /// This starts a local litert-lm server process that hosts the model
    /// and exposes an OpenAI-compatible API.
    pub async fn new(
        model_id: &str,
        system_prompt: &str,
        data_dir: &Path,
    ) -> anyhow::Result<Self> {
        let server_port = 18787_u16;
        let server_url = format!("http://127.0.0.1:{}", server_port);

        // Try to start litert-lm server as a subprocess
        // The litert-lm CLI auto-downloads models and platform binaries
        let server_handle = match Self::start_server(model_id, server_port, data_dir).await {
            Ok(child) => {
                tracing::info!(
                    "LiteRT-LM server starting on port {} with model {}",
                    server_port,
                    model_id
                );
                // Give the server time to start
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                Some(Arc::new(Mutex::new(Some(child))))
            }
            Err(e) => {
                tracing::warn!(
                    "Could not start litert-lm server ({}). Will try connecting to existing instance.",
                    e
                );
                None
            }
        };

        Ok(Self {
            conversation: Mutex::new(ConversationManager::new(system_prompt.to_string())),
            model_id: model_id.to_string(),
            server_url,
            http_client: reqwest::Client::new(),
            _server_handle: server_handle,
        })
    }

    async fn start_server(
        model_id: &str,
        port: u16,
        _data_dir: &Path,
    ) -> anyhow::Result<tokio::process::Child> {
        // litert-lm serve <model> --port <port>
        let child = tokio::process::Command::new("litert-lm")
            .args(["serve", model_id, "--port", &port.to_string()])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;

        Ok(child)
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

        // Truncate at 4000 chars (matching existing behavior)
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
