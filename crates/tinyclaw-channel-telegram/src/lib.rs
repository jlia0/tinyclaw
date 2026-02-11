use dashmap::DashMap;
use std::sync::Arc;
use teloxide::prelude::*;
use teloxide::respond;
use teloxide::types::ChatKind;
use tinyclaw_core::channel::{generate_message_id, now_millis, split_message, ChannelClient};
use tinyclaw_core::message::{Channel, IncomingMessage};
use tinyclaw_core::queue::QueueDir;

/// Telegram channel client using teloxide.
/// Listens for private messages, writes to the file queue, polls for responses.
pub struct TelegramClient {
    token: String,
}

impl TelegramClient {
    pub fn new(token: String) -> Self {
        Self { token }
    }
}

#[derive(Debug, Clone)]
struct PendingMsg {
    chat_id: ChatId,
    message_id: teloxide::types::MessageId,
}

#[async_trait::async_trait]
impl ChannelClient for TelegramClient {
    fn name(&self) -> &str {
        "Telegram"
    }

    fn channel_id(&self) -> Channel {
        Channel::Telegram
    }

    async fn start(
        self: Arc<Self>,
        queue: Arc<QueueDir>,
        mut shutdown: tokio::sync::broadcast::Receiver<()>,
    ) -> anyhow::Result<()> {
        let bot = Bot::new(&self.token);
        let pending: Arc<DashMap<String, PendingMsg>> = Arc::new(DashMap::new());

        // Spawn outgoing queue poller
        let queue_out = queue.clone();
        let pending_out = pending.clone();
        let bot_out = bot.clone();
        let mut shutdown_out = shutdown.resubscribe();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(e) = poll_outgoing(&queue_out, &pending_out, &bot_out).await {
                            tracing::error!(error = %e, "Telegram outgoing poll error");
                        }
                    }
                    _ = shutdown_out.recv() => break,
                }
            }
        });

        // Spawn typing indicator refresh (every 4s)
        let pending_typing = pending.clone();
        let bot_typing = bot.clone();
        let mut shutdown_typing = shutdown.resubscribe();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(4));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        for entry in pending_typing.iter() {
                            let _ = bot_typing
                                .send_chat_action(entry.value().chat_id, teloxide::types::ChatAction::Typing)
                                .await;
                        }
                    }
                    _ = shutdown_typing.recv() => break,
                }
            }
        });

        // Build message handler
        let queue_handler = queue.clone();
        let pending_handler = pending.clone();

        let handler = Update::filter_message().endpoint(
            move |bot: Bot, msg: teloxide::types::Message| {
                let queue = queue_handler.clone();
                let pending = pending_handler.clone();
                async move {
                    // Skip non-private messages
                    if !matches!(msg.chat.kind, ChatKind::Private(_)) {
                        return respond(());
                    }

                    let text = match msg.text() {
                        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
                        _ => return respond(()),
                    };

                    let sender = msg
                        .from
                        .as_ref()
                        .map(|u| {
                            let first = &u.first_name;
                            match &u.last_name {
                                Some(last) => format!("{} {}", first, last),
                                None => first.clone(),
                            }
                        })
                        .unwrap_or_else(|| "Unknown".to_string());

                    let sender_id = msg
                        .from
                        .as_ref()
                        .map(|u| u.id.0.to_string())
                        .unwrap_or_else(|| msg.chat.id.0.to_string());

                    // Handle reset command
                    if text.eq_ignore_ascii_case("/reset") || text.eq_ignore_ascii_case("!reset") {
                        let reset_flag = std::path::Path::new(".tinyclaw/reset_flag");
                        let _ = tokio::fs::write(reset_flag, "reset").await;
                        let _ = bot
                            .send_message(
                                msg.chat.id,
                                "Conversation reset! Next message will start a fresh conversation.",
                            )
                            .reply_parameters(teloxide::types::ReplyParameters::new(msg.id))
                            .await;
                        return respond(());
                    }

                    // Typing indicator
                    let _ = bot
                        .send_chat_action(msg.chat.id, teloxide::types::ChatAction::Typing)
                        .await;

                    let message_id = generate_message_id();

                    let incoming = IncomingMessage {
                        channel: Channel::Telegram,
                        sender: sender.clone(),
                        sender_id,
                        message: text,
                        timestamp: now_millis(),
                        message_id: message_id.clone(),
                    };

                    if let Err(e) = queue.enqueue(&incoming).await {
                        tracing::error!(error = %e, "Failed to enqueue Telegram message");
                        return respond(());
                    }

                    tracing::info!(sender = %sender, "Telegram message queued: {}", message_id);

                    pending.insert(
                        message_id,
                        PendingMsg {
                            chat_id: msg.chat.id,
                            message_id: msg.id,
                        },
                    );

                    respond(())
                }
            },
        );

        tracing::info!("Telegram bot starting...");

        // Run dispatcher with shutdown
        let mut dispatcher = Dispatcher::builder(bot, handler)
            .build();

        tokio::select! {
            _ = dispatcher.dispatch() => {}
            _ = shutdown.recv() => {
                tracing::info!("Telegram client shutting down");
                dispatcher.shutdown_token().shutdown().expect("failed to shutdown dispatcher").await;
            }
        }

        Ok(())
    }
}

async fn poll_outgoing(
    queue: &QueueDir,
    pending: &DashMap<String, PendingMsg>,
    bot: &Bot,
) -> anyhow::Result<()> {
    let responses = queue.poll_outgoing("telegram_").await?;

    for (path, response) in responses {
        if let Some((_, pending_msg)) = pending.remove(&response.message_id) {
            let chunks = split_message(&response.message, 4096);

            // First chunk as reply
            if let Some(first) = chunks.first() {
                let _ = bot
                    .send_message(pending_msg.chat_id, first)
                    .reply_parameters(teloxide::types::ReplyParameters::new(
                        pending_msg.message_id,
                    ))
                    .await;
            }

            // Remaining chunks as follow-ups
            for chunk in chunks.iter().skip(1) {
                let _ = bot.send_message(pending_msg.chat_id, chunk).await;
            }

            tracing::info!(
                sender = %response.sender,
                len = response.message.len(),
                chunks = chunks.len(),
                "Telegram response sent"
            );

            queue.ack_outgoing(&path).await?;
        } else {
            tracing::warn!(
                message_id = %response.message_id,
                "No pending Telegram message, cleaning up"
            );
            queue.ack_outgoing(&path).await?;
        }
    }

    Ok(())
}
