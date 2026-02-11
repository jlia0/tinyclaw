use crate::message::{Channel, IncomingMessage, OutgoingMessage};
use std::path::{Path, PathBuf};
use tokio::fs;

pub struct QueueDir {
    pub incoming: PathBuf,
    pub processing: PathBuf,
    pub outgoing: PathBuf,
}

impl QueueDir {
    pub async fn new(base: impl AsRef<Path>) -> anyhow::Result<Self> {
        let base = base.as_ref().to_path_buf();
        let incoming = base.join("incoming");
        let processing = base.join("processing");
        let outgoing = base.join("outgoing");

        fs::create_dir_all(&incoming).await?;
        fs::create_dir_all(&processing).await?;
        fs::create_dir_all(&outgoing).await?;

        Ok(Self {
            incoming,
            processing,
            outgoing,
        })
    }

    /// Write an incoming message to the queue (called by channels).
    /// Uses tmp+rename for atomicity.
    pub async fn enqueue(&self, msg: &IncomingMessage) -> anyhow::Result<()> {
        let filename = format!("{}_{}.json", msg.channel.as_str(), msg.message_id);
        let path = self.incoming.join(&filename);
        let content = serde_json::to_string_pretty(msg)?;
        let tmp = self.incoming.join(format!(".{}.tmp", filename));
        fs::write(&tmp, &content).await?;
        fs::rename(&tmp, &path).await?;
        Ok(())
    }

    /// Claim the next message for processing (FIFO by modification time).
    /// Moves the file from incoming/ to processing/.
    pub async fn claim_next(&self) -> anyhow::Result<Option<(PathBuf, IncomingMessage)>> {
        let mut entries = Vec::new();
        let mut dir = fs::read_dir(&self.incoming).await?;
        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Ok(meta) = entry.metadata().await {
                    if let Ok(modified) = meta.modified() {
                        entries.push((path, modified));
                    }
                }
            }
        }

        // Sort by modification time (oldest first = FIFO)
        entries.sort_by_key(|(_, t)| *t);

        for (path, _) in entries {
            let filename = match path.file_name() {
                Some(f) => f.to_owned(),
                None => continue,
            };

            // Skip temp files
            if filename.to_string_lossy().starts_with('.') {
                continue;
            }

            let processing_path = self.processing.join(&filename);

            // Try to claim by renaming
            if fs::rename(&path, &processing_path).await.is_ok() {
                match fs::read_to_string(&processing_path).await {
                    Ok(content) => match serde_json::from_str::<IncomingMessage>(&content) {
                        Ok(msg) => return Ok(Some((processing_path, msg))),
                        Err(e) => {
                            tracing::error!(
                                "Failed to parse message {}: {}",
                                filename.to_string_lossy(),
                                e
                            );
                            // Move corrupt file back
                            let _ = fs::rename(&processing_path, &path).await;
                            continue;
                        }
                    },
                    Err(e) => {
                        tracing::error!(
                            "Failed to read message {}: {}",
                            filename.to_string_lossy(),
                            e
                        );
                        let _ = fs::rename(&processing_path, &path).await;
                        continue;
                    }
                }
            }
        }

        Ok(None)
    }

    /// Write response to outgoing and clean up processing file.
    pub async fn complete(
        &self,
        processing_path: &Path,
        response: &OutgoingMessage,
    ) -> anyhow::Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        let filename = if response.channel == Channel::Heartbeat {
            // Heartbeat messages use just the messageId
            format!("{}.json", response.message_id)
        } else {
            format!(
                "{}_{}_{}_.json",
                response.channel.as_str(),
                response.message_id,
                now
            )
        };
        let out_path = self.outgoing.join(filename);
        let content = serde_json::to_string_pretty(response)?;
        fs::write(&out_path, &content).await?;
        fs::remove_file(processing_path).await?;
        Ok(())
    }

    /// Move failed message back to incoming for retry.
    pub async fn retry(&self, processing_path: &Path) -> anyhow::Result<()> {
        if let Some(filename) = processing_path.file_name() {
            let dest = self.incoming.join(filename);
            fs::rename(processing_path, &dest).await?;
        }
        Ok(())
    }

    /// Poll for outgoing messages matching a channel prefix.
    pub async fn poll_outgoing(
        &self,
        channel_prefix: &str,
    ) -> anyhow::Result<Vec<(PathBuf, OutgoingMessage)>> {
        let mut results = Vec::new();
        let mut dir = fs::read_dir(&self.outgoing).await?;
        while let Some(entry) = dir.next_entry().await? {
            let path = entry.path();
            let filename = match path.file_name().and_then(|f| f.to_str()) {
                Some(f) => f.to_string(),
                None => continue,
            };

            if filename.starts_with(channel_prefix) && filename.ends_with(".json") {
                match fs::read_to_string(&path).await {
                    Ok(content) => match serde_json::from_str::<OutgoingMessage>(&content) {
                        Ok(msg) => results.push((path, msg)),
                        Err(e) => {
                            tracing::error!("Failed to parse outgoing {}: {}", filename, e);
                        }
                    },
                    Err(e) => {
                        tracing::error!("Failed to read outgoing {}: {}", filename, e);
                    }
                }
            }
        }
        Ok(results)
    }

    /// Delete an outgoing message after successful delivery.
    pub async fn ack_outgoing(&self, path: &Path) -> anyhow::Result<()> {
        fs::remove_file(path).await?;
        Ok(())
    }
}
