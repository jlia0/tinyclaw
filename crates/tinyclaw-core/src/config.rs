use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub channels: ChannelSettings,
    #[serde(default)]
    pub models: ModelSettings,
    #[serde(default)]
    pub monitoring: MonitoringSettings,
    #[serde(default)]
    pub http: HttpSettings,
    #[serde(default)]
    pub freehold: FreeholdSettings,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChannelSettings {
    #[serde(default)]
    pub enabled: Vec<String>,
    #[serde(default)]
    pub discord: DiscordConfig,
    #[serde(default)]
    pub telegram: TelegramConfig,
    #[serde(default)]
    pub whatsapp: WhatsappConfig,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DiscordConfig {
    #[serde(default)]
    pub bot_token: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TelegramConfig {
    #[serde(default)]
    pub bot_token: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WhatsappConfig {}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSettings {
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub local: LocalModelConfig,
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            provider: default_provider(),
            local: LocalModelConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalModelConfig {
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default = "default_backend")]
    pub backend: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
}

impl Default for LocalModelConfig {
    fn default() -> Self {
        Self {
            model: default_model(),
            backend: default_backend(),
            max_tokens: default_max_tokens(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_http_port")]
    pub port: u16,
    #[serde(default)]
    pub cors_origins: Vec<String>,
}

impl Default for HttpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            port: default_http_port(),
            cors_origins: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FreeholdSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_relay")]
    pub relay: String,
    #[serde(default)]
    pub domain: Option<String>,
}

impl Default for FreeholdSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            relay: default_relay(),
            domain: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringSettings {
    #[serde(default = "default_heartbeat_interval")]
    pub heartbeat_interval: u64,
}

impl Default for MonitoringSettings {
    fn default() -> Self {
        Self {
            heartbeat_interval: default_heartbeat_interval(),
        }
    }
}

fn default_provider() -> String {
    "local".into()
}
fn default_model() -> String {
    "gemma3-1b".into()
}
fn default_backend() -> String {
    "cpu".into()
}
fn default_max_tokens() -> u32 {
    2048
}
fn default_http_port() -> u16 {
    8787
}
fn default_relay() -> String {
    "freehold.lit.app:9999".into()
}
fn default_heartbeat_interval() -> u64 {
    3600
}

impl Settings {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let settings: Settings = serde_json::from_str(&content)?;
        Ok(settings)
    }

    pub fn save(&self, path: &Path) -> anyhow::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(self)?;
        std::fs::write(path, content)?;
        Ok(())
    }
}
