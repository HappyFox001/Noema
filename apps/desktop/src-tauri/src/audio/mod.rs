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
}

impl AudioProcessor {
    pub fn new() -> Self {
        Self {
            config: AudioConfig::default(),
            vad: Arc::new(Mutex::new(vad::VAD::new())),
        }
    }

    /// Process audio chunk and detect voice activity
    pub async fn process_audio(&self, audio_data: Vec<i16>) -> anyhow::Result<bool> {
        let mut vad = self.vad.lock().await;
        Ok(vad.is_speech(&audio_data))
    }
}
