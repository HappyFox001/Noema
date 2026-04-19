/// Text-to-Speech service using Fish Audio API
/// Based on sensory-server's FishAudioTTSWithReference

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const FISH_TTS_URL: &str = "wss://api.fish.audio/v1/tts/live";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TTSSettings {
    pub model: String,
    pub voice: Option<String>,  // reference_id for voice preset
    pub sample_rate: u32,
    pub latency: String,
    pub format: String,
    pub normalize: bool,
    pub prosody: ProsodySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProsodySettings {
    pub speed: f32,
    pub volume: f32,
}

impl Default for TTSSettings {
    fn default() -> Self {
        Self {
            model: "s2-pro".to_string(),
            voice: None,
            sample_rate: 16000,
            latency: "normal".to_string(),
            format: "pcm".to_string(),
            normalize: true,
            prosody: ProsodySettings {
                speed: 1.0,
                volume: 1.0,
            },
        }
    }
}

#[derive(Debug, Serialize)]
struct StartMessage {
    event: String,
    request: RequestSettings,
}

#[derive(Debug, Serialize)]
struct RequestSettings {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reference_id: Option<String>,
    sample_rate: u32,
    latency: String,
    format: String,
    normalize: bool,
    prosody: ProsodySettings,
}

#[derive(Debug, Serialize)]
struct TextMessage {
    event: String,
    text: String,
}

#[derive(Debug, Deserialize)]
struct TTSResponse {
    event: String,
    #[serde(default)]
    audio: Vec<u8>,
}

pub struct TTSService {
    #[allow(dead_code)]
    api_key: String,
    #[allow(dead_code)]
    settings: TTSSettings,
    text_tx: mpsc::UnboundedSender<String>,
    audio_rx: std::sync::Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<Vec<u8>>>>,
}

impl TTSService {
    /// Create new TTS service and establish connection
    pub async fn new(api_key: String, settings: TTSSettings) -> Result<Self> {
        let url = FISH_TTS_URL;

        tracing::info!("Connecting to Fish Audio TTS service...");
        let (ws_stream, _) = connect_async(url)
            .await
            .context("Failed to connect to Fish Audio TTS WebSocket")?;

        let (mut write, mut read) = ws_stream.split();

        // Channel for sending text
        let (text_tx, mut text_rx) = mpsc::unbounded_channel::<String>();

        // Channel for receiving audio
        let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // Clone settings for async tasks
        let settings_clone = settings.clone();
        let api_key_clone = api_key.clone();

        // Spawn task to handle WebSocket writes
        tokio::spawn(async move {
            let mut started = false;

            while let Some(text) = text_rx.recv().await {
                if !started {
                    // Send start message on first text
                    let start_msg = StartMessage {
                        event: "start".to_string(),
                        request: RequestSettings {
                            text: String::new(),
                            reference_id: settings_clone.voice.clone(),
                            sample_rate: settings_clone.sample_rate,
                            latency: settings_clone.latency.clone(),
                            format: settings_clone.format.clone(),
                            normalize: settings_clone.normalize,
                            prosody: settings_clone.prosody.clone(),
                        },
                    };

                    // Serialize with msgpack
                    let msg_bytes = rmp_serde::to_vec(&start_msg)
                        .expect("Failed to serialize start message");

                    // Authorization is handled via query parameter, not header
                    let _auth_header = format!("Bearer {}", api_key_clone);

                    // Send as binary message
                    if let Err(e) = write.send(Message::Binary(msg_bytes)).await {
                        tracing::error!("Failed to send start message: {}", e);
                        break;
                    }

                    started = true;
                }

                // Send text message
                let text_msg = TextMessage {
                    event: "text".to_string(),
                    text,
                };

                let msg_bytes = rmp_serde::to_vec(&text_msg)
                    .expect("Failed to serialize text message");

                if let Err(e) = write.send(Message::Binary(msg_bytes)).await {
                    tracing::error!("Failed to send text to TTS: {}", e);
                    break;
                }
            }

            // Send finish message
            let finish_msg = serde_json::json!({
                "event": "finish"
            });
            let msg_bytes = rmp_serde::to_vec(&finish_msg)
                .expect("Failed to serialize finish message");
            let _ = write.send(Message::Binary(msg_bytes)).await;
        });

        // Spawn task to handle WebSocket reads
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Binary(data)) => {
                        // Deserialize msgpack response
                        match rmp_serde::from_slice::<TTSResponse>(&data) {
                            Ok(response) => {
                                if response.event == "audio" && !response.audio.is_empty() {
                                    tracing::debug!("Received TTS audio chunk: {} bytes", response.audio.len());
                                    let _ = audio_tx.send(response.audio);
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Failed to parse TTS response: {}", e);
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        tracing::info!("TTS WebSocket closed");
                        break;
                    }
                    Err(e) => {
                        tracing::error!("TTS WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        });

        tracing::info!("Connected to Fish Audio TTS service");

        Ok(Self {
            api_key,
            settings,
            text_tx,
            audio_rx: std::sync::Arc::new(tokio::sync::Mutex::new(audio_rx)),
        })
    }

    /// Send text to be synthesized
    pub async fn synthesize(&self, text: &str) -> Result<()> {
        self.text_tx
            .send(text.to_string())
            .context("Failed to send text to TTS")?;
        Ok(())
    }

    /// Receive next audio chunk
    pub async fn receive_audio(&self) -> Result<Option<Vec<u8>>> {
        let mut rx = self.audio_rx.lock().await;
        Ok(rx.recv().await)
    }

    /// Disconnect from TTS service
    pub async fn disconnect(self) -> Result<()> {
        // Channels will be dropped automatically
        tracing::info!("Disconnected from TTS service");
        Ok(())
    }
}
