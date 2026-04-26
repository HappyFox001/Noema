// AudioWorklet processor - runs in a separate thread
// Handles: audio capture, downsampling to 16kHz
//
// 移植自 Pipecat: 使用 10ms 分块以更快响应打断
// - 原来: 100ms (1600 samples @ 16kHz)
// - 现在: 10ms (160 samples @ 16kHz)
//
// 10ms 分块的好处:
// 1. 更快检测到用户说话开始 (打断响应更快)
// 2. VAD 状态更新更及时
// 3. 音频流更平滑
class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.targetSampleRate = 16000
    // 10ms at 16kHz = 160 samples (移植自 Pipecat)
    // 这样可以更快响应打断，而不是等待 100ms
    this.targetChunkSize = 160
    this.buffer = []
    this.sourceSampleRate = sampleRate // AudioWorklet global
  }

  // Downsample from source rate to 16kHz and convert to Int16
  downsample(input) {
    if (this.sourceSampleRate === this.targetSampleRate) {
      return this.float32ToInt16(input)
    }

    const ratio = this.sourceSampleRate / this.targetSampleRate
    const outputLength = Math.floor(input.length / ratio)
    const output = new Int16Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = Math.floor(i * ratio)
      const sample = input[srcIndex]
      const clamped = Math.max(-1, Math.min(1, sample))
      output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    }

    return output
  }

  float32ToInt16(input) {
    const output = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const clamped = Math.max(-1, Math.min(1, input[i]))
      output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    }
    return output
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (!input || !input[0]) {
      return true
    }

    // Downsample this chunk (in worklet thread, not main thread)
    const downsampled = this.downsample(input[0])

    // Add to buffer
    for (let i = 0; i < downsampled.length; i++) {
      this.buffer.push(downsampled[i])
    }

    // When we have enough samples (10ms), send a chunk
    while (this.buffer.length >= this.targetChunkSize) {
      const chunk = new Int16Array(this.buffer.splice(0, this.targetChunkSize))

      // Send Int16 samples directly - main process will do VAD
      this.port.postMessage({
        type: 'audio',
        samples: chunk
      }, [chunk.buffer]) // Transfer buffer for zero-copy
    }

    return true
  }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor)
