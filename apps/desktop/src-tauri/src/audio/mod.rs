pub mod stt;
pub mod tts;
pub mod vad;

use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioConfig {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
}

impl Default for AudioConfig {
    fn default() -> Self {
        Self {
            sample_rate: 16000,  // 16kHz as per sensory-server
            channels: 1,         // mono
            bits_per_sample: 16, // 16-bit PCM
        }
    }
}

/// Audio processor state
pub struct AudioProcessor {
    #[allow(dead_code)]
    config: AudioConfig,
    vad: Arc<Mutex<vad::VAD>>,
    stt: Arc<Mutex<Option<stt::STTService>>>,
    tts: Arc<Mutex<Option<tts::TTSService>>>,
}

impl AudioProcessor {
    pub fn new() -> Self {
        Self {
            config: AudioConfig::default(),
            vad: Arc::new(Mutex::new(vad::VAD::new())),
            stt: Arc::new(Mutex::new(None)),
            tts: Arc::new(Mutex::new(None)),
        }
    }

    /// Initialize STT service with API key
    pub async fn init_stt(&self, api_key: String) -> anyhow::Result<()> {
        let mut stt = self.stt.lock().await;
        *stt = Some(stt::STTService::new(api_key).await?);
        Ok(())
    }

    /// Process audio chunk and detect voice activity
    pub async fn process_audio(&self, audio_data: Vec<i16>) -> anyhow::Result<bool> {
        let mut vad = self.vad.lock().await;
        Ok(vad.is_speech(&audio_data))
    }

    /// Send audio to STT service for transcription
    pub async fn transcribe(&self, audio_data: Vec<i16>) -> anyhow::Result<String> {
        let stt = self.stt.lock().await;
        if let Some(ref service) = *stt {
            service.transcribe(&audio_data).await
        } else {
            Err(anyhow::anyhow!("STT service not initialized"))
        }
    }

    /// Initialize TTS service with API key
    pub async fn init_tts(&self, api_key: String, voice_id: Option<String>) -> anyhow::Result<()> {
        let mut settings = tts::TTSSettings::default();
        settings.voice = voice_id;

        let mut tts = self.tts.lock().await;
        *tts = Some(tts::TTSService::new(api_key, settings).await?);
        Ok(())
    }

    /// Synthesize text to speech
    pub async fn synthesize(&self, text: &str) -> anyhow::Result<()> {
        let tts = self.tts.lock().await;
        if let Some(ref service) = *tts {
            service.synthesize(text).await
        } else {
            Err(anyhow::anyhow!("TTS service not initialized"))
        }
    }

    /// Receive next audio chunk from TTS
    pub async fn receive_tts_audio(&self) -> anyhow::Result<Option<Vec<u8>>> {
        let tts = self.tts.lock().await;
        if let Some(ref service) = *tts {
            service.receive_audio().await
        } else {
            Err(anyhow::anyhow!("TTS service not initialized"))
        }
    }

    /// Shutdown the audio processor
    pub async fn shutdown(&self) -> anyhow::Result<()> {
        let mut stt = self.stt.lock().await;
        if let Some(service) = stt.take() {
            service.disconnect().await?;
        }

        let mut tts = self.tts.lock().await;
        if let Some(service) = tts.take() {
            service.disconnect().await?;
        }

        Ok(())
    }
}
