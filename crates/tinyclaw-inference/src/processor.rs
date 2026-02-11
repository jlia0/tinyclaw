use crate::engine::InferenceEngine;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tinyclaw_core::channel::now_millis;
use tinyclaw_core::message::OutgoingMessage;
use tinyclaw_core::queue::QueueDir;

/// Run the queue processor loop. Polls incoming/ for messages, processes
/// them through the inference engine, and writes responses to outgoing/.
pub async fn run_queue_processor(
    queue: Arc<QueueDir>,
    engine: Arc<InferenceEngine>,
    data_dir: PathBuf,
    mut shutdown: tokio::sync::broadcast::Receiver<()>,
) -> anyhow::Result<()> {
    let mut poll_interval = tokio::time::interval(Duration::from_secs(1));

    tracing::info!("Queue processor started, watching for messages");

    loop {
        tokio::select! {
            _ = poll_interval.tick() => {
                // Check reset flag
                if InferenceEngine::check_and_clear_reset_flag(&data_dir).await {
                    tracing::info!("Resetting conversation");
                    engine.reset().await;
                }

                // Process all pending messages (one at a time, FIFO)
                while let Some((processing_path, msg)) = queue.claim_next().await? {
                    tracing::info!(
                        channel = %msg.channel,
                        sender = %msg.sender,
                        "Processing: {}...",
                        &msg.message[..msg.message.len().min(50)]
                    );

                    let response_text = match engine.process(&msg.message).await {
                        Ok(response) => response,
                        Err(e) => {
                            tracing::error!(error = %e, "Inference error");
                            "Sorry, I encountered an error processing your request.".to_string()
                        }
                    };

                    let response = OutgoingMessage {
                        channel: msg.channel.clone(),
                        sender: msg.sender.clone(),
                        message: response_text.clone(),
                        original_message: msg.message.clone(),
                        timestamp: now_millis(),
                        message_id: msg.message_id.clone(),
                    };

                    if let Err(e) = queue.complete(&processing_path, &response).await {
                        tracing::error!(error = %e, "Failed to write response");
                        // Try to move back to incoming for retry
                        let _ = queue.retry(&processing_path).await;
                    } else {
                        tracing::info!(
                            channel = %msg.channel,
                            sender = %msg.sender,
                            len = response_text.len(),
                            "Response ready"
                        );
                    }
                }
            }
            _ = shutdown.recv() => {
                tracing::info!("Queue processor shutting down");
                break;
            }
        }
    }

    Ok(())
}
