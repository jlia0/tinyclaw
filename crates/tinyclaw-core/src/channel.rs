use crate::message::Channel;
use crate::queue::QueueDir;
use std::sync::Arc;

/// Trait that all channel implementations must satisfy.
#[async_trait::async_trait]
pub trait ChannelClient: Send + Sync + 'static {
    /// Human-readable channel name (e.g., "Discord", "Telegram")
    fn name(&self) -> &str;

    /// Channel identifier used in queue filenames
    fn channel_id(&self) -> Channel;

    /// Start the channel client. This should spawn its own tasks
    /// for listening to incoming messages and polling for outgoing ones.
    /// Returns when shutdown signal is received.
    async fn start(
        self: Arc<Self>,
        queue: Arc<QueueDir>,
        shutdown: tokio::sync::broadcast::Receiver<()>,
    ) -> anyhow::Result<()>;
}

/// Generate a unique message ID (matches TypeScript format: timestamp_random)
pub fn generate_message_id() -> String {
    let ts = chrono::Utc::now().timestamp_millis();
    let rand: String = uuid::Uuid::new_v4().to_string()[..7].to_string();
    format!("{}_{}", ts, rand)
}

/// Split a long message into chunks at natural boundaries.
pub fn split_message(text: &str, max_length: usize) -> Vec<String> {
    if text.len() <= max_length {
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut remaining = text;

    while !remaining.is_empty() {
        if remaining.len() <= max_length {
            chunks.push(remaining.to_string());
            break;
        }

        // Try to split at a newline boundary
        let search_area = &remaining[..max_length];
        let split_index = search_area
            .rfind('\n')
            .or_else(|| search_area.rfind(' '))
            .unwrap_or(max_length);

        let split_index = if split_index == 0 {
            max_length
        } else {
            split_index
        };

        chunks.push(remaining[..split_index].to_string());
        remaining = &remaining[split_index..];
        // Strip leading newline after split
        if remaining.starts_with('\n') {
            remaining = &remaining[1..];
        }
    }

    chunks
}

/// Get current time as milliseconds since epoch
pub fn now_millis() -> u64 {
    chrono::Utc::now().timestamp_millis() as u64
}
