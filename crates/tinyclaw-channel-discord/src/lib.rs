use dashmap::DashMap;
use serenity::all::*;
use std::sync::Arc;
use tinyclaw_core::channel::{generate_message_id, now_millis, split_message, ChannelClient};
use tinyclaw_core::message::{Channel, IncomingMessage};
use tinyclaw_core::queue::QueueDir;

/// Discord channel client using serenity.
/// Listens for DMs, writes to the file queue, polls for responses.
pub struct DiscordClient {
    token: String,
}

impl DiscordClient {
    pub fn new(token: String) -> Self {
        Self { token }
    }
}

#[async_trait::async_trait]
impl ChannelClient for DiscordClient {
    fn name(&self) -> &str {
        "Discord"
    }

    fn channel_id(&self) -> Channel {
        Channel::Discord
    }

    async fn start(
        self: Arc<Self>,
        queue: Arc<QueueDir>,
        mut shutdown: tokio::sync::broadcast::Receiver<()>,
    ) -> anyhow::Result<()> {
        let pending: Arc<DashMap<String, (ChannelId, MessageId)>> = Arc::new(DashMap::new());

        let handler = DiscordHandler {
            queue: queue.clone(),
            pending: pending.clone(),
        };

        let intents = GatewayIntents::DIRECT_MESSAGES
            | GatewayIntents::MESSAGE_CONTENT
            | GatewayIntents::GUILDS;

        let mut client = serenity::Client::builder(&self.token, intents)
            .event_handler(handler)
            .await?;

        let http = client.http.clone();

        // Spawn outgoing queue poller
        let queue_clone = queue.clone();
        let pending_clone = pending.clone();
        let mut shutdown_outgoing = shutdown.resubscribe();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        if let Err(e) = poll_outgoing(&queue_clone, &pending_clone, &http).await {
                            tracing::error!(error = %e, "Discord outgoing poll error");
                        }
                    }
                    _ = shutdown_outgoing.recv() => break,
                }
            }
        });

        // Spawn typing indicator refresh (every 8s)
        let pending_typing = pending.clone();
        let http_typing = client.http.clone();
        let mut shutdown_typing = shutdown.resubscribe();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(8));
            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        for entry in pending_typing.iter() {
                            let (channel_id, _) = entry.value();
                            let _ = channel_id.broadcast_typing(&http_typing).await;
                        }
                    }
                    _ = shutdown_typing.recv() => break,
                }
            }
        });

        // Run the Discord gateway client
        tokio::select! {
            result = client.start() => {
                if let Err(e) = result {
                    tracing::error!(error = %e, "Discord client error");
                }
            }
            _ = shutdown.recv() => {
                tracing::info!("Discord client shutting down");
                client.shard_manager.shutdown_all().await;
            }
        }

        Ok(())
    }
}

struct DiscordHandler {
    queue: Arc<QueueDir>,
    pending: Arc<DashMap<String, (ChannelId, MessageId)>>,
}

#[async_trait::async_trait]
impl EventHandler for DiscordHandler {
    async fn message(&self, ctx: Context, msg: Message) {
        // Skip bots
        if msg.author.bot {
            return;
        }

        // Skip non-DM (guild = server channel)
        if msg.guild_id.is_some() {
            return;
        }

        // Skip empty
        let content = msg.content.trim();
        if content.is_empty() {
            return;
        }

        let sender = msg
            .author
            .global_name
            .as_deref()
            .unwrap_or(&msg.author.name);

        // Handle reset command
        if content.eq_ignore_ascii_case("/reset") || content.eq_ignore_ascii_case("!reset") {
            // Write reset flag
            let reset_flag = std::path::Path::new(".tinyclaw/reset_flag");
            let _ = tokio::fs::write(reset_flag, "reset").await;
            let _ = msg
                .reply(
                    &ctx,
                    "Conversation reset! Next message will start a fresh conversation.",
                )
                .await;
            return;
        }

        // Show typing indicator
        let _ = msg.channel_id.broadcast_typing(&ctx).await;

        let message_id = generate_message_id();

        let incoming = IncomingMessage {
            channel: Channel::Discord,
            sender: sender.to_string(),
            sender_id: msg.author.id.to_string(),
            message: msg.content.clone(),
            timestamp: now_millis(),
            message_id: message_id.clone(),
        };

        if let Err(e) = self.queue.enqueue(&incoming).await {
            tracing::error!(error = %e, "Failed to enqueue Discord message");
            return;
        }

        tracing::info!(sender = %sender, "Discord message queued: {}", message_id);

        // Track pending for response delivery
        self.pending.insert(message_id, (msg.channel_id, msg.id));

        // Clean up old pending messages (older than 5 minutes)
        let five_minutes_ago = now_millis() - (5 * 60 * 1000);
        self.pending.retain(|_, _| true); // DashMap doesn't have timestamp, rely on queue cleanup
        let _ = five_minutes_ago; // placeholder for future cleanup
    }

    async fn ready(&self, _ctx: Context, ready: Ready) {
        tracing::info!("Discord bot connected as {}", ready.user.name);
    }
}

async fn poll_outgoing(
    queue: &QueueDir,
    pending: &DashMap<String, (ChannelId, MessageId)>,
    http: &Arc<serenity::http::Http>,
) -> anyhow::Result<()> {
    let responses = queue.poll_outgoing("discord_").await?;

    for (path, response) in responses {
        if let Some((_, (channel_id, original_msg_id))) = pending.remove(&response.message_id) {
            let chunks = split_message(&response.message, 2000);

            // First chunk as reply
            if let Some(first) = chunks.first() {
                let _ = channel_id
                    .send_message(
                        http,
                        CreateMessage::new().content(first).reference_message(
                            MessageReference::from((channel_id, original_msg_id)),
                        ),
                    )
                    .await;
            }

            // Remaining chunks as follow-ups
            for chunk in chunks.iter().skip(1) {
                let _ = channel_id
                    .send_message(http, CreateMessage::new().content(chunk))
                    .await;
            }

            tracing::info!(
                sender = %response.sender,
                len = response.message.len(),
                chunks = chunks.len(),
                "Discord response sent"
            );

            queue.ack_outgoing(&path).await?;
        } else {
            // No pending message for this response, clean up
            tracing::warn!(
                message_id = %response.message_id,
                "No pending Discord message, cleaning up"
            );
            queue.ack_outgoing(&path).await?;
        }
    }

    Ok(())
}
