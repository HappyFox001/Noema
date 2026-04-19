/// Speech-to-Text service using Qwen Omni STT
/// Based on sensory-server's QwenOmniSTTService

use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

const QWEN_STT_URL: &str = "wss://dashscope-intl.aliyuncs.com/api-ws/v1/inference";
const MODEL: &str = "qwen3-asr-flash-realtime";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTRequest {
    model: String,
    input: STTInput,
    parameters: STTParameters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTInput {
    audio: String,  // base64 encoded PCM16
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTParameters {
    sample_rate: u32,
    format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTResponse {
    output: Option<STTOutput>,
    usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTOutput {
    text: Option<String>,
    sentence: Option<STTSentence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTSentence {
    text: String,
    #[serde(rename = "beginTime")]
    begin_time: Option<u64>,
    #[serde(rename = "endTime")]
    end_time: Option<u64>,
}

pub struct STTService {
    api_key: String,
    ws_tx: mpsc::UnboundedSender<Vec<i16>>,
    result_rx: std::sync::Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<String>>>,
}

impl STTService {
    /// Create new STT service and establish connection
    pub async fn new(api_key: String) -> Result<Self> {
        let url = format!("{}?api-key={}", QWEN_STT_URL, api_key);

        tracing::info!("Connecting to Qwen STT service...");
        let (ws_stream, _) = connect_async(&url)
            .await
            .context("Failed to connect to Qwen STT WebSocket")?;

        let (mut write, mut read) = ws_stream.split();

        // Channel for sending audio data
        let (audio_tx, mut audio_rx) = mpsc::unbounded_channel::<Vec<i16>>();

        // Channel for receiving transcription results
        let (result_tx, result_rx) = mpsc::unbounded_channel::<String>();

        // Spawn task to handle WebSocket writes
        tokio::spawn(async move {
            while let Some(audio_data) = audio_rx.recv().await {
                // Convert PCM16 to base64
                let pcm_bytes: Vec<u8> = audio_data
                    .iter()
                    .flat_map(|&sample| sample.to_le_bytes())
                    .collect();

                let audio_b64 = general_purpose::STANDARD.encode(&pcm_bytes);

                let request = json!({
                    "model": MODEL,
                    "input": {
                        "audio": audio_b64
                    },
                    "parameters": {
                        "sample_rate": 16000,
                        "format": "pcm"
                    }
                });

                let msg = Message::Text(request.to_string());
                if let Err(e) = write.send(msg).await {
                    tracing::error!("Failed to send audio to STT: {}", e);
                    break;
                }
            }
        });

        // Spawn task to handle WebSocket reads
        let result_tx_clone = result_tx.clone();
        tokio::spawn(async move {
            while let Some(msg) = read.next().await {
                match msg {
                    Ok(Message::Text(text)) => {
                        match serde_json::from_str::<STTResponse>(&text) {
                            Ok(response) => {
                                if let Some(output) = response.output {
                                    // Prefer sentence output (final) over interim text
                                    if let Some(sentence) = output.sentence {
                                        if !sentence.text.is_empty() {
                                            tracing::debug!("STT final: {}", sentence.text);
                                            let _ = result_tx_clone.send(sentence.text);
                                        }
                                    } else if let Some(text) = output.text {
                                        if !text.is_empty() {
                                            tracing::debug!("STT interim: {}", text);
                                        }
                                    }
                                }
                            }
                            Err(e) => {
                                tracing::warn!("Failed to parse STT response: {}", e);
                            }
                        }
                    }
                    Ok(Message::Close(_)) => {
                        tracing::info!("STT WebSocket closed");
                        break;
                    }
                    Err(e) => {
                        tracing::error!("STT WebSocket error: {}", e);
                        break;
                    }
                    _ => {}
                }
            }
        });

        tracing::info!("Connected to Qwen STT service");

        Ok(Self {
            api_key,
            ws_tx: audio_tx,
            result_rx: std::sync::Arc::new(tokio::sync::Mutex::new(result_rx)),
        })
    }

    /// Transcribe audio data
    pub async fn transcribe(&self, audio_data: &[i16]) -> Result<String> {
        // Send audio data
        self.ws_tx
            .send(audio_data.to_vec())
            .context("Failed to send audio data")?;

        // Wait for result with timeout
        let mut rx = self.result_rx.lock().await;
        match tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv()).await {
            Ok(Some(text)) => Ok(text),
            Ok(None) => Err(anyhow::anyhow!("STT channel closed")),
            Err(_) => Err(anyhow::anyhow!("STT transcription timeout")),
        }
    }

    /// Disconnect from STT service
    pub async fn disconnect(self) -> Result<()> {
        // Channels will be dropped automatically
        tracing::info!("Disconnected from STT service");
        Ok(())
    }
}
