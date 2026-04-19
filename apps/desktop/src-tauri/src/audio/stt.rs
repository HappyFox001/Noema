/// Speech-to-Text service using Qwen Omni STT
/// Based on sensory-server's QwenOmniSTTService
use anyhow::{Context, Result};
use base64::{engine::general_purpose, Engine as _};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
};

const DEFAULT_QWEN_STT_URL: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/realtime";
const MODEL: &str = "qwen3-asr-flash-realtime";
const AUDIO_CHUNK_BYTES: usize = 3200;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTRequest {
    model: String,
    input: STTInput,
    parameters: STTParameters,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTInput {
    audio: String, // base64 encoded PCM16
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTParameters {
    sample_rate: u32,
    format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct STTResponse {
    #[serde(rename = "type")]
    event_type: Option<String>,
    transcript: Option<String>,
    text: Option<String>,
    stash: Option<String>,
    output: Option<STTOutput>,
    error: Option<serde_json::Value>,
    error_message: Option<String>,
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
    #[allow(dead_code)]
    api_key: String,
    ws_tx: mpsc::UnboundedSender<Vec<i16>>,
    result_rx: std::sync::Arc<tokio::sync::Mutex<mpsc::UnboundedReceiver<String>>>,
}

impl STTService {
    /// Create new STT service and establish connection
    pub async fn new(api_key: String, stt_url: Option<String>) -> Result<Self> {
        let api_key = api_key.trim().to_string();
        if api_key.is_empty() {
            return Err(anyhow::anyhow!("Qwen STT API key is not configured"));
        }

        let base_url = stt_url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())
            .unwrap_or(DEFAULT_QWEN_STT_URL);
        let url = format!("{}?model={}", base_url.trim_end_matches('/'), MODEL);
        let mut request = url
            .into_client_request()
            .context("Failed to create Qwen STT WebSocket request")?;
        let bearer = format!("Bearer {}", api_key);
        request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&bearer).context("Invalid Qwen STT API key header value")?,
        );
        request
            .headers_mut()
            .insert("OpenAI-Beta", HeaderValue::from_static("realtime=v1"));

        tracing::info!("Connecting to Qwen STT service...");
        let (ws_stream, response) = connect_async(request)
            .await
            .with_context(|| format!("Failed to connect to Qwen STT WebSocket at {}", base_url))?;
        tracing::debug!("Qwen STT WebSocket handshake status: {}", response.status());

        let (mut write, mut read) = ws_stream.split();

        let session_update = json!({
            "event_id": event_id(),
            "type": "session.update",
            "session": {
                "modalities": ["text"],
                "input_audio_format": "pcm",
                "sample_rate": 16000,
                "input_audio_transcription": {
                    "language": "zh"
                },
                "turn_detection": null
            }
        });

        write
            .send(Message::Text(session_update.to_string()))
            .await
            .context("Failed to configure Qwen STT session")?;

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

                for chunk in pcm_bytes.chunks(AUDIO_CHUNK_BYTES) {
                    let audio_b64 = general_purpose::STANDARD.encode(chunk);
                    let append_audio = json!({
                        "event_id": event_id(),
                        "type": "input_audio_buffer.append",
                        "audio": audio_b64
                    });

                    if let Err(e) = write.send(Message::Text(append_audio.to_string())).await {
                        tracing::error!("Failed to send audio to STT: {}", e);
                        return;
                    }
                }

                let commit_audio = json!({
                    "event_id": event_id(),
                    "type": "input_audio_buffer.commit"
                });
                if let Err(e) = write.send(Message::Text(commit_audio.to_string())).await {
                    tracing::error!("Failed to commit audio to STT: {}", e);
                    return;
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
                                match response.event_type.as_deref() {
                                    Some(
                                        "conversation.item.input_audio_transcription.completed",
                                    ) => {
                                        if let Some(transcript) = response.transcript {
                                            if !transcript.is_empty() {
                                                tracing::debug!("STT final: {}", transcript);
                                                let _ = result_tx_clone.send(transcript);
                                            }
                                        }
                                    }
                                    Some("conversation.item.input_audio_transcription.text") => {
                                        if let Some(text) = response.text.or(response.stash) {
                                            if !text.is_empty() {
                                                tracing::debug!("STT interim: {}", text);
                                            }
                                        }
                                    }
                                    Some("error") => {
                                        tracing::error!(
                                            "Qwen STT error: {}",
                                            response
                                                .error_message
                                                .unwrap_or_else(|| format!("{:?}", response.error))
                                        );
                                    }
                                    Some(event_type) => {
                                        tracing::debug!("Qwen STT event: {}", event_type);
                                    }
                                    None => {}
                                }

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
                                tracing::warn!(
                                    "Failed to parse STT response: {}. Raw: {}",
                                    e,
                                    text
                                );
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

fn event_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("event_{}", millis)
}
