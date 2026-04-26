// AudioWorklet processor - runs in a separate thread
class AudioChunkProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.bufferSize = 4096
    this.buffer = new Float32Array(this.bufferSize)
    this.bufferIndex = 0
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]
    if (!input || !input[0]) {
      return true
    }

    const channelData = input[0]

    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i]

      if (this.bufferIndex >= this.bufferSize) {
        // Calculate RMS
        let sum = 0
        for (let j = 0; j < this.bufferSize; j++) {
          sum += this.buffer[j] * this.buffer[j]
        }
        const rms = Math.sqrt(sum / this.bufferSize)

        // Send buffer copy to main thread
        this.port.postMessage({
          type: 'audio',
          samples: this.buffer.slice(),
          rms: rms
        })

        this.bufferIndex = 0
      }
    }

    return true
  }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor)
