use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

/// Manages conversation history for local inference.
/// Keeps a sliding window of messages within a token budget.
pub struct ConversationManager {
    history: VecDeque<ChatMessage>,
    system_prompt: String,
    max_history_tokens: usize,
}

impl ConversationManager {
    pub fn new(system_prompt: String) -> Self {
        Self {
            history: VecDeque::new(),
            system_prompt,
            max_history_tokens: 4096,
        }
    }

    pub fn add_user_message(&mut self, content: String) {
        self.history.push_back(ChatMessage {
            role: Role::User,
            content,
        });
        self.trim_history();
    }

    pub fn add_assistant_message(&mut self, content: String) {
        self.history.push_back(ChatMessage {
            role: Role::Assistant,
            content,
        });
    }

    pub fn reset(&mut self) {
        self.history.clear();
    }

    /// Build the messages array for the OpenAI-compatible API.
    pub fn build_messages(&self) -> Vec<serde_json::Value> {
        let mut messages = Vec::new();

        messages.push(serde_json::json!({
            "role": "system",
            "content": self.system_prompt
        }));

        for msg in &self.history {
            let role = match msg.role {
                Role::User => "user",
                Role::Assistant => "assistant",
                Role::System => "system",
            };
            messages.push(serde_json::json!({
                "role": role,
                "content": msg.content
            }));
        }

        messages
    }

    /// Build a formatted prompt string for direct model invocation.
    pub fn build_prompt(&self) -> String {
        let mut prompt = format!("System: {}\n\n", self.system_prompt);
        for msg in &self.history {
            match msg.role {
                Role::User => prompt.push_str(&format!("User: {}\n", msg.content)),
                Role::Assistant => prompt.push_str(&format!("Assistant: {}\n", msg.content)),
                Role::System => {}
            }
        }
        prompt.push_str("Assistant: ");
        prompt
    }

    fn trim_history(&mut self) {
        // Rough token estimation: ~4 chars per token
        while self.estimated_tokens() > self.max_history_tokens && self.history.len() > 2 {
            self.history.pop_front();
        }
    }

    fn estimated_tokens(&self) -> usize {
        self.history.iter().map(|m| m.content.len() / 4).sum()
    }
}
