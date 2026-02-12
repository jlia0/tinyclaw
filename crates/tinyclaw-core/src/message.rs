use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Discord,
    Telegram,
    Whatsapp,
    Heartbeat,
    Http,
    Manual,
}

impl Channel {
    pub fn as_str(&self) -> &str {
        match self {
            Channel::Discord => "discord",
            Channel::Telegram => "telegram",
            Channel::Whatsapp => "whatsapp",
            Channel::Heartbeat => "heartbeat",
            Channel::Http => "http",
            Channel::Manual => "manual",
        }
    }
}

impl fmt::Display for Channel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncomingMessage {
    pub channel: Channel,
    pub sender: String,
    pub sender_id: String,
    pub message: String,
    pub timestamp: u64,
    pub message_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutgoingMessage {
    pub channel: Channel,
    pub sender: String,
    pub message: String,
    pub original_message: String,
    pub timestamp: u64,
    pub message_id: String,
}
