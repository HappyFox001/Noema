


export enum VADState {
  
  QUIET = 'quiet',
  
  STARTING = 'starting',
  
  SPEAKING = 'speaking',
  
  STOPPING = 'stopping',
}


export interface VADParams {
  
  confidence: number

  
  startSecs: number

  
  stopSecs: number

  
  minVolume: number

  
  sampleRate: number
}


export interface VADEvent {
  
  type: 'speech_start' | 'speech_stop' | 'speech_activity'
  
  timestamp: number
  
  stopSecs?: number
}


export interface VADAnalyzerInterface {
  
  analyze(audio: Int16Array | Float32Array): Promise<VADState>

  
  getState(): VADState

  
  reset(): void

  
  setEventHandler(handler: (event: VADEvent) => void): void
}


export interface VoiceConfidenceProvider {
  
  getVoiceConfidence(audio: Float32Array): Promise<number>

  
  reset(): void
}


export const DEFAULT_VAD_PARAMS: VADParams = {
  confidence: 0.7,
  startSecs: 0.2,
  stopSecs: 0.2,
  minVolume: 0.6,
  sampleRate: 16000,
}


export function calculateRmsVolume(samples: Int16Array | Float32Array): number {
  if (samples.length === 0) return 0

  let sum = 0
  const isInt16 = samples instanceof Int16Array
  const maxValue = isInt16 ? 32768 : 1

  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / maxValue
    sum += normalized * normalized
  }

  return Math.sqrt(sum / samples.length)
}


export function int16ToFloat32(samples: Int16Array): Float32Array {
  const float32 = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    float32[i] = samples[i] / 32768
  }
  return float32
}
