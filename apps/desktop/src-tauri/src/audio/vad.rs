/// Voice Activity Detection - Energy-based approach
/// Based on sensory-server's frontend VAD logic

const RMS_THRESHOLD_MULTIPLIER: f32 = 5.0;
const GRACE_PERIOD_MS: u64 = 300;
const NOISE_SAMPLE_COUNT: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq)]
enum VADState {
    Silence,
    Speaking,
    Grace,
}

pub struct VAD {
    state: VADState,
    noise_level: f32,
    noise_samples: Vec<f32>,
    threshold: f32,
    grace_start: Option<std::time::Instant>,
}

impl VAD {
    pub fn new() -> Self {
        Self {
            state: VADState::Silence,
            noise_level: 0.0,
            noise_samples: Vec::with_capacity(NOISE_SAMPLE_COUNT),
            threshold: 0.0,
            grace_start: None,
        }
    }

    /// Calculate RMS (Root Mean Square) energy of audio samples
    fn calculate_rms(&self, samples: &[i16]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }

        let sum: f64 = samples
            .iter()
            .map(|&s| {
                let normalized = s as f64 / 32768.0;
                normalized * normalized
            })
            .sum();

        (sum / samples.len() as f64).sqrt() as f32
    }

    /// Update noise level estimation
    fn update_noise_level(&mut self, rms: f32) {
        self.noise_samples.push(rms);

        if self.noise_samples.len() > NOISE_SAMPLE_COUNT {
            self.noise_samples.remove(0);
        }

        // Calculate average noise level
        if !self.noise_samples.is_empty() {
            self.noise_level =
                self.noise_samples.iter().sum::<f32>() / self.noise_samples.len() as f32;
            self.threshold = self.noise_level * RMS_THRESHOLD_MULTIPLIER;
        }
    }

    /// Check if current audio samples contain speech
    pub fn is_speech(&mut self, samples: &[i16]) -> bool {
        let rms = self.calculate_rms(samples);

        match self.state {
            VADState::Silence => {
                // Update noise level when silent
                self.update_noise_level(rms);

                if rms > self.threshold {
                    tracing::debug!(
                        "VAD: Silence -> Speaking (RMS: {:.4}, Threshold: {:.4})",
                        rms,
                        self.threshold
                    );
                    self.state = VADState::Speaking;
                    true
                } else {
                    false
                }
            }
            VADState::Speaking => {
                if rms > self.threshold {
                    // Continue speaking
                    true
                } else {
                    // Start grace period
                    tracing::debug!("VAD: Speaking -> Grace");
                    self.state = VADState::Grace;
                    self.grace_start = Some(std::time::Instant::now());
                    true
                }
            }
            VADState::Grace => {
                if rms > self.threshold {
                    // Resume speaking
                    tracing::debug!("VAD: Grace -> Speaking");
                    self.state = VADState::Speaking;
                    self.grace_start = None;
                    true
                } else if let Some(start) = self.grace_start {
                    // Check grace period timeout
                    if start.elapsed().as_millis() > GRACE_PERIOD_MS as u128 {
                        tracing::debug!("VAD: Grace -> Silence (timeout)");
                        self.state = VADState::Silence;
                        self.grace_start = None;
                        false
                    } else {
                        // Still in grace period
                        true
                    }
                } else {
                    false
                }
            }
        }
    }

    /// Reset VAD state
    #[allow(dead_code)]
    pub fn reset(&mut self) {
        self.state = VADState::Silence;
        self.grace_start = None;
    }

    /// Get current VAD state
    #[allow(dead_code)]
    pub fn get_state(&self) -> &str {
        match self.state {
            VADState::Silence => "silence",
            VADState::Speaking => "speaking",
            VADState::Grace => "grace",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rms_calculation() {
        let vad = VAD::new();
        let samples = vec![100, -100, 200, -200];
        let rms = vad.calculate_rms(&samples);
        assert!(rms > 0.0);
    }

    #[test]
    fn test_silence_detection() {
        let mut vad = VAD::new();
        let silence = vec![0i16; 1024];

        // Initial samples should be silence
        for _ in 0..5 {
            assert!(!vad.is_speech(&silence));
        }
    }
}
