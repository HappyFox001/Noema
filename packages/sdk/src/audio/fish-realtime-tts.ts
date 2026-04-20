export interface RealtimeWebSocketTransport {
  connect(options: {
    url: string
    headers: Record<string, string>
  }): Promise<void>
  sendBinary(data: Uint8Array): Promise<void>
  sendText(data: string): Promise<void>
  receive(): Promise<Uint8Array | null>
  close(): Promise<void>
}

export interface FishRealtimeTTSConfig {
  apiKey: string
  model?: string
  voiceId?: string
  url?: string
  sampleRate?: number
  latency?: 'normal' | 'balanced' | 'low'
  format?: 'pcm' | 'mp3' | 'opus'
  normalize?: boolean
  prosody?: {
    speed?: number
    volume?: number
  }
}

export type FishRealtimeTTSEvent =
  | { type: 'audio'; audio: Uint8Array }
  | { type: 'finish'; reason?: string; message?: string; error?: string }
  | { type: 'event'; event: string; payload: any }
  | { type: 'error'; error: Error }
  | { type: 'close' }

export class FishRealtimeTTS {
  private isConnected = false
  private isReceiving = false
  private onEvent?: (event: FishRealtimeTTSEvent) => void

  constructor(
    private config: FishRealtimeTTSConfig,
    private transport: RealtimeWebSocketTransport
  ) {}

  setEventHandler(handler: (event: FishRealtimeTTSEvent) => void): void {
    this.onEvent = handler
  }

  async start(): Promise<void> {
    if (!this.config.apiKey.trim()) {
      throw new Error('Fish Audio API key is not configured')
    }

    await this.transport.connect({
      url: this.config.url || 'wss://api.fish.audio/v1/tts/live',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        model: this.config.model || 's2-pro',
      },
    })

    this.isConnected = true
    await this.send({
      event: 'start',
      request: this.buildStartRequest(),
    })

    this.startReceiveLoop()
  }

  async sendText(text: string): Promise<void> {
    if (!text.trim()) {
      return
    }

    await this.send({ event: 'text', text })
  }

  async flush(): Promise<void> {
    await this.send({ event: 'flush' })
  }

  async sendTextAndFlush(text: string): Promise<void> {
    await this.sendText(text)
    await this.flush()
  }

  async stop(): Promise<void> {
    if (!this.isConnected) {
      return
    }

    await this.send({ event: 'stop' })
  }

  async close(): Promise<void> {
    this.isConnected = false
    await this.transport.close()
  }

  isOpen(): boolean {
    return this.isConnected
  }

  private buildStartRequest(): Record<string, any> {
    const request: Record<string, any> = {
      text: '',
      sample_rate: this.config.sampleRate || 16000,
      latency: this.config.latency || 'balanced',
      format: this.config.format || 'pcm',
      normalize: this.config.normalize ?? true,
      prosody: {
        speed: this.config.prosody?.speed ?? 1.0,
        volume: this.config.prosody?.volume ?? 0,
      },
    }

    if (this.config.voiceId) {
      request.reference_id = this.config.voiceId
    }

    return request
  }

  private async send(payload: Record<string, any>): Promise<void> {
    if (!this.isConnected) {
      throw new Error('Fish WebSocket is already closed')
    }

    await this.transport.sendBinary(encodeMsgpack(payload))
  }

  private startReceiveLoop(): void {
    if (this.isReceiving) return
    this.isReceiving = true

    const receive = async () => {
      try {
        while (this.isConnected) {
          const data = await this.transport.receive()
          if (!data) break

          const payload = decodeMsgpack(data)
          this.handlePayload(payload)
        }
      } catch (error) {
        this.onEvent?.({ type: 'error', error: error as Error })
      } finally {
        this.isConnected = false
        this.isReceiving = false
        this.onEvent?.({ type: 'close' })
      }
    }

    void receive()
  }

  private handlePayload(payload: any): void {
    if (!payload || typeof payload !== 'object') {
      this.onEvent?.({ type: 'event', event: 'unknown', payload })
      return
    }

    const event = String(payload.event || 'unknown')
    if (event === 'audio' && payload.audio) {
      this.onEvent?.({ type: 'audio', audio: toUint8Array(payload.audio) })
      return
    }

    if (event === 'finish') {
      this.onEvent?.({
        type: 'finish',
        reason: payload.reason,
        message: payload.message,
        error: payload.error,
      })
      return
    }

    if (event === 'error') {
      this.onEvent?.({ type: 'error', error: new Error(JSON.stringify(payload)) })
      return
    }

    this.onEvent?.({ type: 'event', event, payload })
  }
}

function encodeMsgpack(value: any): Uint8Array {
  const bytes: number[] = []
  writeValue(bytes, value)
  return new Uint8Array(bytes)
}

function writeValue(out: number[], value: any): void {
  if (value === null || value === undefined) {
    out.push(0xc0)
    return
  }

  if (typeof value === 'boolean') {
    out.push(value ? 0xc3 : 0xc2)
    return
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 0 && value <= 0x7f) {
      out.push(value)
      return
    }
    out.push(0xcb)
    const buffer = new ArrayBuffer(8)
    new DataView(buffer).setFloat64(0, value, false)
    out.push(...new Uint8Array(buffer))
    return
  }

  if (typeof value === 'string') {
    writeString(out, value)
    return
  }

  if (value instanceof Uint8Array) {
    writeBinary(out, value)
    return
  }

  if (Array.isArray(value)) {
    if (value.length < 16) out.push(0x90 | value.length)
    else {
      out.push(0xdc, (value.length >> 8) & 0xff, value.length & 0xff)
    }
    value.forEach((item) => writeValue(out, item))
    return
  }

  const entries = Object.entries(value).filter(([, v]) => v !== undefined)
  if (entries.length < 16) out.push(0x80 | entries.length)
  else {
    out.push(0xde, (entries.length >> 8) & 0xff, entries.length & 0xff)
  }
  for (const [key, item] of entries) {
    writeString(out, key)
    writeValue(out, item)
  }
}

function writeString(out: number[], value: string): void {
  const bytes = new TextEncoder().encode(value)
  if (bytes.length < 32) out.push(0xa0 | bytes.length)
  else if (bytes.length <= 0xff) out.push(0xd9, bytes.length)
  else out.push(0xda, (bytes.length >> 8) & 0xff, bytes.length & 0xff)
  out.push(...bytes)
}

function writeBinary(out: number[], value: Uint8Array): void {
  if (value.length <= 0xff) out.push(0xc4, value.length)
  else out.push(0xc5, (value.length >> 8) & 0xff, value.length & 0xff)
  out.push(...value)
}

function decodeMsgpack(data: Uint8Array): any {
  const reader = new MsgpackReader(data)
  return reader.read()
}

class MsgpackReader {
  private offset = 0

  constructor(private bytes: Uint8Array) {}

  read(): any {
    const prefix = this.readByte()

    if (prefix <= 0x7f) return prefix
    if ((prefix & 0xe0) === 0xa0) return this.readString(prefix & 0x1f)
    if ((prefix & 0xf0) === 0x80) return this.readMap(prefix & 0x0f)
    if ((prefix & 0xf0) === 0x90) return this.readArray(prefix & 0x0f)

    switch (prefix) {
      case 0xc0:
        return null
      case 0xc2:
        return false
      case 0xc3:
        return true
      case 0xc4:
        return this.readBinary(this.readByte())
      case 0xc5:
        return this.readBinary(this.readU16())
      case 0xcb:
        return this.readF64()
      case 0xcc:
        return this.readByte()
      case 0xcd:
        return this.readU16()
      case 0xce:
        return this.readU32()
      case 0xd9:
        return this.readString(this.readByte())
      case 0xda:
        return this.readString(this.readU16())
      case 0xdc:
        return this.readArray(this.readU16())
      case 0xde:
        return this.readMap(this.readU16())
      default:
        throw new Error(`Unsupported msgpack prefix: 0x${prefix.toString(16)}`)
    }
  }

  private readMap(length: number): Record<string, any> {
    const result: Record<string, any> = {}
    for (let i = 0; i < length; i++) {
      result[String(this.read())] = this.read()
    }
    return result
  }

  private readArray(length: number): any[] {
    const result = []
    for (let i = 0; i < length; i++) result.push(this.read())
    return result
  }

  private readString(length: number): string {
    const bytes = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return new TextDecoder().decode(bytes)
  }

  private readBinary(length: number): Uint8Array {
    const bytes = this.bytes.slice(this.offset, this.offset + length)
    this.offset += length
    return bytes
  }

  private readByte(): number {
    return this.bytes[this.offset++]
  }

  private readU16(): number {
    const value = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1]
    this.offset += 2
    return value
  }

  private readU32(): number {
    const value =
      (this.bytes[this.offset] * 0x1000000) +
      ((this.bytes[this.offset + 1] << 16) |
        (this.bytes[this.offset + 2] << 8) |
        this.bytes[this.offset + 3])
    this.offset += 4
    return value
  }

  private readF64(): number {
    const view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + this.offset,
      8
    )
    const value = view.getFloat64(0, false)
    this.offset += 8
    return value
  }
}

function toUint8Array(data: any): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) return new Uint8Array(data)
  throw new Error('Unsupported Fish audio payload')
}
