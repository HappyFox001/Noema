/**
 * Renderer entrypoint for the desktop UI.
 *
 * Owns the orb surface, audio playback scheduling, voice capture,
 * settings panel interactions, and renderer-side IPC event handling.
 */
import './styles.css'

// ========== Audio Player ==========

class AudioPlayer {
  private audioContext: AudioContext | null = null
  private gainNode: GainNode | null = null
  private isPlaying = false
  private nextStartTime = 0
  private onChunkScheduled?: (payload: { startTime: number; duration: number }) => void
  private onPlaybackStart?: () => void

  private playbackCompleteResolvers: (() => void)[] = []
  private activeSources = new Set<AudioBufferSourceNode>()
  private pendingAudioAdds = 0

  private isFirstAudioOfSession = true

  private validContextId: number = 0
  private rejectedContextIds: Set<number> = new Set()

  private stopGeneration: number = 0

  resetLatencyTracking(): void {
    this.isFirstAudioOfSession = true
  }

  
  setValidContextId(contextId: number): void {
    console.log(`[AudioPlayer] Setting valid context ID: ${contextId}`)
    this.validContextId = contextId
    if (this.rejectedContextIds.size > 10) {
      const idsArray = Array.from(this.rejectedContextIds)
      this.rejectedContextIds = new Set(idsArray.slice(-5))
    }
  }

  
  invalidateContext(contextId: number): void {
    console.log(`[AudioPlayer] Invalidating context ID: ${contextId}`)
    this.rejectedContextIds.add(contextId)
    if (contextId === this.validContextId) {
      console.log(`[AudioPlayer] Current context invalidated, stopping playback`)
      this.stop()
    }
  }

  
  isContextValid(contextId: number): boolean {
    if (this.rejectedContextIds.has(contextId)) {
      return false
    }
    if (contextId < this.validContextId) {
      return false
    }
    return true
  }

  async initialize(): Promise<void> {
    this.audioContext = new AudioContext({ sampleRate: 16000 })

    this.gainNode = this.audioContext.createGain()
    this.gainNode.connect(this.audioContext.destination)

    console.log('[AudioPlayer] Initialized with raw PCM output')

    await this.warmup()
  }

  
  private async warmup(): Promise<void> {
    if (!this.audioContext) return

    console.log('[AudioPlayer] Starting warmup...')
    const startTime = performance.now()

    try {
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }

      const silentBuffer = this.audioContext.createBuffer(1, 16, 16000)
      const source = this.audioContext.createBufferSource()
      source.buffer = silentBuffer

      const silentGain = this.audioContext.createGain()
      silentGain.gain.value = 0
      silentGain.connect(this.audioContext.destination)
      source.connect(silentGain)

      source.start()

      await new Promise<void>((resolve) => {
        source.onended = () => resolve()
        setTimeout(resolve, 50)
      })

      const elapsed = performance.now() - startTime
      console.log(`[AudioPlayer] Warmup complete in ${elapsed.toFixed(1)}ms`)
    } catch (error) {
      console.warn('[AudioPlayer] Warmup failed:', error)
    }
  }

  setChunkScheduledHandler(
    handler: (payload: { startTime: number; duration: number }) => void
  ): void {
    this.onChunkScheduled = handler
  }

  setPlaybackStartHandler(handler: () => void): void {
    this.onPlaybackStart = handler
  }

  getCurrentTime(): number {
    return this.audioContext?.currentTime ?? 0
  }

  
  waitForPlaybackComplete(): Promise<void> {
    if (!this.isPlaying && this.activeSources.size === 0 && this.pendingAudioAdds === 0) {
      console.log('[AudioPlayer] waitForPlaybackComplete: already idle')
      return Promise.resolve()
    }

    console.log('[AudioPlayer] waitForPlaybackComplete: waiting...')
    return new Promise((resolve) => {
      this.playbackCompleteResolvers.push(resolve)
    })
  }

  
  getIsPlaying(): boolean {
    return this.isPlaying
  }

  
  private notifyPlaybackComplete(): void {
    if (!this.isPlaying && this.activeSources.size === 0 && this.pendingAudioAdds === 0) {
      console.log('[AudioPlayer] Playback complete, notifying', this.playbackCompleteResolvers.length, 'waiters')
      const resolvers = this.playbackCompleteResolvers
      this.playbackCompleteResolvers = []
      resolvers.forEach(r => r())
    }
  }

  private pcm16ToAudioBuffer(pcm16Bytes: Uint8Array): AudioBuffer {
    if (!this.audioContext) {
      throw new Error('Audio context not initialized')
    }

    const pcm16 = new Int16Array(
      pcm16Bytes.buffer,
      pcm16Bytes.byteOffset,
      pcm16Bytes.byteLength / 2
    )

    const audioBuffer = this.audioContext.createBuffer(1, pcm16.length, 16000)
    const channelData = audioBuffer.getChannelData(0)

    for (let i = 0; i < pcm16.length; i++) {
      const sample = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7fff)
      channelData[i] = sample
    }

    return audioBuffer
  }

  private playBuffer(buffer: AudioBuffer): void {
    if (!this.audioContext) return

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer

    source.connect(this.gainNode ?? this.audioContext.destination)
    this.activeSources.add(source)

    const currentTime = this.audioContext.currentTime
    const startTime = Math.max(currentTime + 0.01, this.nextStartTime)
    const previousEndTime = this.nextStartTime
    const underrunMs = previousEndTime > 0
      ? Math.max(0, (currentTime - previousEndTime) * 1000)
      : 0
    const scheduleDelayMs = Math.max(0, (startTime - currentTime) * 1000)

    source.start(startTime)
    this.nextStartTime = startTime + buffer.duration
    this.onChunkScheduled?.({ startTime, duration: buffer.duration })
    window.electronAPI.notifyAudioScheduled({
      durationMs: buffer.duration * 1000,
      scheduleDelayMs,
      bufferAheadMs: Math.max(0, (this.nextStartTime - currentTime) * 1000),
      underrunMs,
    })

    const generationAtStart = this.stopGeneration

    source.onended = () => {
      if (this.stopGeneration !== generationAtStart) {
        console.log('[AudioPlayer] Ignoring onended from stopped source')
        return
      }

      this.activeSources.delete(source)
      if (this.activeSources.size === 0) {
        this.isPlaying = false
        this.notifyPlaybackComplete()
      }
    }
  }

  async addAudioChunk(pcm16Bytes: Uint8Array, contextId?: number): Promise<void> {
    this.pendingAudioAdds++
    try {
      const generationAtStart = this.stopGeneration

      if (contextId !== undefined) {
        if (!this.isContextValid(contextId)) {
          console.log(`[AudioPlayer] Rejecting audio chunk from invalid context #${contextId} (valid: #${this.validContextId})`)
          return
        }
      }

      console.log(`[AudioPlayer] Adding chunk (context #${contextId ?? 'N/A'}):`, pcm16Bytes.byteLength, 'bytes, context state:', this.audioContext?.state)

      if (this.audioContext?.state === 'suspended') {
        console.log('[AudioPlayer] Resuming suspended context')
        await this.audioContext.resume()
        await this.warmup()
      }

      if (this.stopGeneration !== generationAtStart) {
        console.log(`[AudioPlayer] Dropping chunk - stop() was called during await (gen ${generationAtStart} -> ${this.stopGeneration})`)
        return
      }

      if (contextId !== undefined && !this.isContextValid(contextId)) {
        console.log(`[AudioPlayer] Dropping chunk - context #${contextId} invalidated during await`)
        return
      }

      updateOrbAudioEnergy('output', pcm16Bytes)
      const audioBuffer = this.pcm16ToAudioBuffer(pcm16Bytes)
      console.log('[AudioPlayer] Created buffer:', audioBuffer.duration.toFixed(2), 'seconds')

      if (!this.isPlaying) {
        this.isPlaying = true
        this.nextStartTime = this.audioContext!.currentTime + 0.01

        console.log('[AudioPlayer] Starting playback')
        this.onPlaybackStart?.()
      }

      this.playBuffer(audioBuffer)
      if (this.isFirstAudioOfSession) {
        this.isFirstAudioOfSession = false
        console.log('[AudioPlayer] First audio of session - notifying latency tracker')
        window.electronAPI.notifyFirstAudioPlay()
      }
    } catch (error) {
      console.error('[AudioPlayer] Failed to add audio chunk:', error)
    } finally {
      this.pendingAudioAdds--
      this.notifyPlaybackComplete()
    }
  }

  stop(): void {
    console.log('[AudioPlayer] Stopping playback')

    this.stopGeneration++

    for (const source of this.activeSources) {
      try {
        source.stop()
      } catch (e) {
      }
    }
    this.activeSources.clear()

    this.isPlaying = false
    this.nextStartTime = 0

    this.notifyPlaybackComplete()
  }

  setVolume(percent: number): void {
    if (!this.gainNode) return
    this.gainNode.gain.value = Math.max(0, Math.min(1, percent / 100))
  }
}

type RevealUnit = {
  text: string
  weight: number
}

class AudioSyncedTextRevealer {
  private pendingChunks: RevealUnit[][] = []
  private visibleText = ''
  private generation = 0

  constructor(
    private getAudioTime: () => number,
    private onReveal: (text: string) => void
  ) {}

  reset(): void {
    this.pendingChunks = []
    this.visibleText = ''
    this.generation += 1
    this.onReveal('')
  }

  enqueueText(text: string): void {
    const chunk: RevealUnit[] = []
    for (const char of Array.from(text)) {
      chunk.push({
        text: char,
        weight: revealWeight(char)
      })
    }

    if (chunk.length > 0) {
      this.pendingChunks.push(chunk)
    }
  }

  scheduleAudioWindow(startTime: number, duration: number): void {
    if (duration <= 0 || this.pendingChunks.length === 0) {
      return
    }

    const budget = duration / 0.085
    const units = this.consumeUnitsForBudget(budget)
    if (units.length === 0) {
      return
    }

    const totalWeight = units.reduce((sum, unit) => sum + unit.weight, 0)
    const generation = this.generation
    let elapsed = 0

    for (const unit of units) {
      const revealAt = startTime + elapsed
      const unitDuration = duration * (unit.weight / totalWeight)
      this.scheduleReveal(unit.text, revealAt, generation)
      elapsed += unitDuration
    }
  }

  private consumeUnitsForBudget(budget: number): RevealUnit[] {
    const currentChunk = this.pendingChunks[0]
    if (!currentChunk || currentChunk.length === 0) {
      if (currentChunk && currentChunk.length === 0) {
        this.pendingChunks.shift()
      }
      return []
    }

    let remaining = budget
    const consumed: RevealUnit[] = []

    while (currentChunk.length > 0) {
      const next = currentChunk[0]

      if (consumed.length > 0 && remaining < next.weight) {
        break
      }

      consumed.push(currentChunk.shift()!)
      remaining -= next.weight

      if (remaining <= 0) {
        break
      }
    }

    if (currentChunk.length === 0) {
      this.pendingChunks.shift()
    }

    return consumed
  }

  private scheduleReveal(text: string, revealAt: number, generation: number): void {
    const delayMs = Math.max(0, (revealAt - this.getAudioTime()) * 1000)
    window.setTimeout(() => {
      if (generation !== this.generation) {
        return
      }

      this.visibleText += text
      this.onReveal(this.visibleText)
    }, delayMs)
  }
}

function revealWeight(char: string): number {
  if (!char.trim()) {
    return 0.18
  }

  if (/[，。！？、；：,.!?]/.test(char)) {
    return 1.8
  }

  if (/[A-Za-z0-9]/.test(char)) {
    return 0.55
  }

  return 1
}

class VoiceRecorder {
  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private highPassFilter: BiquadFilterNode | null = null
  private lowPassFilter: BiquadFilterNode | null = null
  private recording = false
  private warmedUp = false

  
  async warmup(): Promise<void> {
    if (this.warmedUp) return

    console.log('[VoiceRecorder] Starting warmup...')
    const startTime = performance.now()

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      this.context = new AudioContext()
      await this.context.audioWorklet.addModule('./audio-worklet-processor.js')

      this.createNoiseFilters()

      this.source = this.context.createMediaStreamSource(this.stream)
      this.workletNode = new AudioWorkletNode(this.context, 'audio-chunk-processor')


      this.warmedUp = true
      const elapsed = performance.now() - startTime
      console.log(`[VoiceRecorder] Warmup complete in ${elapsed.toFixed(1)}ms`)
    } catch (error) {
      console.warn('[VoiceRecorder] Warmup failed:', error)
    }
  }

  
  private createNoiseFilters(): void {
    if (!this.context) return

    this.highPassFilter = this.context.createBiquadFilter()
    this.highPassFilter.type = 'highpass'
    this.highPassFilter.frequency.value = 80
    this.highPassFilter.Q.value = 0.7

    this.lowPassFilter = this.context.createBiquadFilter()
    this.lowPassFilter.type = 'lowpass'
    this.lowPassFilter.frequency.value = 8000
    this.lowPassFilter.Q.value = 0.7

    console.log('[VoiceRecorder] Noise filters created (80Hz highpass, 8kHz lowpass)')
  }

  async start(): Promise<void> {
    if (this.recording) return

    console.log('[VoiceRecorder] Starting...')

    if (!this.warmedUp) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })

      this.context = new AudioContext()
      await this.context.audioWorklet.addModule('./audio-worklet-processor.js')

      this.createNoiseFilters()

      this.source = this.context.createMediaStreamSource(this.stream)
      this.workletNode = new AudioWorkletNode(this.context, 'audio-chunk-processor')
    }

    if (!this.source || !this.workletNode || !this.context) {
      throw new Error('VoiceRecorder not properly initialized')
    }

    this.workletNode.port.onmessage = (event) => {
      if (!this.recording) return
      const { samples } = event.data
      if (samples) {
        updateOrbAudioEnergy('input', samples)
        window.electronAPI.appendSpeechStream(samples)
      }
    }

    // source -> highpass -> lowpass -> worklet -> destination
    if (this.highPassFilter && this.lowPassFilter) {
      this.source.connect(this.highPassFilter)
      this.highPassFilter.connect(this.lowPassFilter)
      this.lowPassFilter.connect(this.workletNode)
      console.log('[VoiceRecorder] Connected with noise filters')
    } else {
      this.source.connect(this.workletNode)
      console.log('[VoiceRecorder] Connected without noise filters')
    }

    this.workletNode.connect(this.context.destination)
    this.recording = true
    console.log('[VoiceRecorder] Started')
  }

  async stop(): Promise<void> {
    this.recording = false

    this.workletNode?.disconnect()
    this.lowPassFilter?.disconnect()
    this.highPassFilter?.disconnect()
    this.source?.disconnect()

    this.stream?.getTracks().forEach((track) => track.stop())

    await this.context?.close()

    this.workletNode = null
    this.lowPassFilter = null
    this.highPassFilter = null
    this.source = null
    this.stream = null
    this.context = null
    this.warmedUp = false
  }

  isRecording(): boolean {
    return this.recording
  }
}

// ========== UI ==========

const audioPlayer = new AudioPlayer()
const textRevealer = new AudioSyncedTextRevealer(
  () => audioPlayer.getCurrentTime(),
  (text) => setTextDisplay(text)
)
let isInitialized = false
let activeMode: 'conversation' | null = null
let ttsEnabled = false
let voiceInputEnabled = true
let isVoiceListening = false
let conversationStreamActive = false

type LanguageCode = 'zh-CN' | 'en-US'

const I18N: Record<LanguageCode, Record<string, string>> = {
  'zh-CN': {
    'common.add': '+ 添加',
    'common.back': '返回',
    'common.cancel': '取消',
    'common.chooseFile': '选择文件',
    'common.clear': '清空',
    'common.confirm': '确认',
    'common.enable': '开启',
    'common.enabled': '已开启',
    'common.manage': '管理',
    'common.continue': '继续',
    'common.activate': '启用',
    'common.active': '使用中',
    'common.delete': '删除',
    'common.loading': '加载中...',
    'context.clearHistory': '清除对话',
    'context.settings': '设置',
    'status.connectionFailed': 'Connection failed',
    'status.initializing': 'Initializing...',
    'status.listening': 'Listening...',
    'status.processing': 'Processing...',
    'status.ready': 'Ready',
    'status.reconnecting': 'Reconnecting...',
    'status.replying': 'Replying...',
    'status.sharingResult': 'Sharing result...',
    'status.thinking': 'Thinking...',
    'status.voiceDisabled': 'Voice Disabled',
    'status.voiceInputDisabled': 'Voice input is disabled',
    'status.working': 'Working...',
    'button.start': 'Start',
    'button.stop': 'Stop',
    'taskPanel.failed': '任务失败',
    'taskPanel.step': '步骤',
    'taskPanel.title': '任务',
    'nav.about': '关于',
    'nav.memory': '记忆',
    'nav.personality': '人格',
    'nav.plugins': '插件',
    'nav.system': '系统',
    'nav.voice': '语音',
    'nav.models': '模型',
    'models.title': '模型设置',
    'voice.input': '语音输入',
    'voice.inputDesc': '使用麦克风进行语音对话',
    'voice.output': '语音输出',
    'voice.outputDesc': 'EVA 以语音方式回复',
    'voice.title': '语音设置',
    'voice.volume': '音量',
    'memory.accountDesc': '任务执行时请求并长期保存的账号、密钥、密码和固定配置。',
    'memory.accountInfo': '账户信息',
    'memory.accountManage': '账户信息管理',
    'memory.accountManageDesc': '管理任务运行时主动请求并保存的长期信息。',
    'memory.important': '重要记忆',
    'memory.profile': '用户画像',
    'memory.recent': '最近对话',
    'memory.resetAll': '全部重置',
    'memory.resetHint': '清除所有记忆数据，不可恢复',
    'memory.savedInfo': '已保存信息',
    'memory.summaries': '对话摘要',
    'memory.title': '记忆管理',
    'personality.addFile': '添加角色文件',
    'personality.addFileDesc': '选择外部 .yml/.yaml 文件，校验通过后加入人格列表',
    'personality.current': '当前人格',
    'personality.currentDesc': '选择 AI 伴侣的人格配置',
    'personality.title': '人格',
    'system.asr': 'ASR 语音识别',
    'system.dialogueModel': '对话模型',
    'system.downloadMissing': '下载缺失模型',
    'system.language': '界面语言',
    'system.languageDesc': '切换控制面板和桌面界面的显示语言',
    'system.localModels': '本地推理模型',
    'system.proxy': '网络代理',
    'system.proxyDesc': 'HTTP/HTTPS 代理地址，如 http://127.0.0.1:7890',
    'system.proxyPlaceholder': '留空则不使用代理',
    'system.reloadEnv': '从 .env 重新加载配置',
    'system.reloadEnvHint': '将使用 .env 文件中的配置覆盖当前设置',
    'system.runtimeParams': '执行参数',
    'system.taskModel': '任务模型',
    'system.title': '系统设置',
    'system.tts': 'TTS 语音合成',
    'system.downloading': '下载中...',
    'system.modelReady': '模型已就绪',
    'system.installed': '已安装',
    'system.missing': '缺失',
    'system.purpose': '用途',
    'system.file': '文件',
    'system.size': '大小',
    'system.noLlm': '暂无 LLM 配置',
    'system.noTask': '暂无任务模型配置',
    'system.noTts': '暂无 TTS 配置',
    'system.noAsr': '暂无 ASR 配置',
    'system.checking': '检查中...',
    'system.checkFailed': '检查失败',
    'taskRuntime.compactLimit': '自动压缩阈值',
    'taskRuntime.compactLimitDesc': '上下文 token 达到该值时自动压缩，最高为窗口的 90%。',
    'taskRuntime.contextWindow': '模型上下文窗口',
    'taskRuntime.contextWindowDesc': '用于估算任务历史压缩阈值。',
    'taskRuntime.desc': '调整任务模型的执行循环、历史压缩和卡住判定。',
    'taskRuntime.keepRecent': '保留最近轮次',
    'taskRuntime.keepRecentDesc': '压缩时保留最近多少轮原始上下文。',
    'taskRuntime.maxTurns': '最大执行轮次',
    'taskRuntime.maxTurnsDesc': '任务运行超过该轮数后停止。',
    'taskRuntime.title': '任务执行参数',
    'plugins.title': '插件',
    'about.desc': '把一个鲜活的灵魂放进桌面。',
    'about.quote': '把语音、记忆、情绪、人格和工具连接起来，尝试做一个能聊天、能陪伴，也能和你一起做事的桌面 AI。',
    'about.title': '关于',
    'notice.voiceInputDisabled': '语音输入已关闭',
    'notice.voiceInputEnabled': '语音输入已开启',
    'inputMeta.currentOnly': '仅用于当前任务',
    'inputMeta.persistent': '可选择保存，后续任务自动复用',
    'inputMeta.verification': '一次性验证码，不会保存',
  },
  'en-US': {
    'common.add': '+ Add',
    'common.back': 'Back',
    'common.cancel': 'Cancel',
    'common.chooseFile': 'Choose File',
    'common.clear': 'Clear',
    'common.confirm': 'Confirm',
    'common.enable': 'Enable',
    'common.enabled': 'Enabled',
    'common.manage': 'Manage',
    'common.continue': 'Continue',
    'common.activate': 'Activate',
    'common.active': 'Active',
    'common.delete': 'Delete',
    'common.loading': 'Loading...',
    'context.clearHistory': 'Clear Conversation',
    'context.settings': 'Settings',
    'status.connectionFailed': 'Connection failed',
    'status.initializing': 'Initializing...',
    'status.listening': 'Listening...',
    'status.processing': 'Processing...',
    'status.ready': 'Ready',
    'status.reconnecting': 'Reconnecting...',
    'status.replying': 'Replying...',
    'status.sharingResult': 'Sharing result...',
    'status.thinking': 'Thinking...',
    'status.voiceDisabled': 'Voice Disabled',
    'status.voiceInputDisabled': 'Voice input is disabled',
    'status.working': 'Working...',
    'button.start': 'Start',
    'button.stop': 'Stop',
    'taskPanel.failed': 'Task failed',
    'taskPanel.step': 'Step',
    'taskPanel.title': 'Task',
    'nav.about': 'About',
    'nav.memory': 'Memory',
    'nav.personality': 'Persona',
    'nav.plugins': 'Plugins',
    'nav.system': 'System',
    'nav.voice': 'Voice',
    'nav.models': 'Models',
    'models.title': 'Model Settings',
    'voice.input': 'Voice Input',
    'voice.inputDesc': 'Use the microphone for voice conversation',
    'voice.output': 'Voice Output',
    'voice.outputDesc': 'Let EVA reply with speech',
    'voice.title': 'Voice Settings',
    'voice.volume': 'Volume',
    'memory.accountDesc': 'Accounts, keys, passwords, and fixed configuration saved during task execution.',
    'memory.accountInfo': 'Account Info',
    'memory.accountManage': 'Account Info Management',
    'memory.accountManageDesc': 'Manage long-lived information requested and saved during task runtime.',
    'memory.important': 'Important Memories',
    'memory.profile': 'User Profile',
    'memory.recent': 'Recent Conversations',
    'memory.resetAll': 'Reset All',
    'memory.resetHint': 'Clear all memory data. This cannot be undone.',
    'memory.savedInfo': 'Saved Info',
    'memory.summaries': 'Conversation Summaries',
    'memory.title': 'Memory',
    'personality.addFile': 'Add Role File',
    'personality.addFileDesc': 'Choose an external .yml/.yaml file and add it after validation',
    'personality.current': 'Current Personality',
    'personality.currentDesc': 'Choose the AI companion personality profile',
    'personality.title': 'Personality',
    'system.asr': 'ASR Speech Recognition',
    'system.dialogueModel': 'Dialogue Model',
    'system.downloadMissing': 'Download Missing Models',
    'system.language': 'Language',
    'system.languageDesc': 'Switch the control panel and desktop UI language',
    'system.localModels': 'Local Inference Models',
    'system.proxy': 'Network Proxy',
    'system.proxyDesc': 'HTTP/HTTPS proxy URL, such as http://127.0.0.1:7890',
    'system.proxyPlaceholder': 'Leave empty to disable proxy',
    'system.reloadEnv': 'Reload Config from .env',
    'system.reloadEnvHint': 'Use values from the .env file to overwrite current settings',
    'system.runtimeParams': 'Runtime Params',
    'system.taskModel': 'Task Model',
    'system.title': 'System Settings',
    'system.tts': 'TTS Speech Synthesis',
    'system.downloading': 'Downloading...',
    'system.modelReady': 'Models Ready',
    'system.installed': 'Installed',
    'system.missing': 'Missing',
    'system.purpose': 'Purpose',
    'system.file': 'File',
    'system.size': 'Size',
    'system.noLlm': 'No LLM config',
    'system.noTask': 'No task model config',
    'system.noTts': 'No TTS config',
    'system.noAsr': 'No ASR config',
    'system.checking': 'Checking...',
    'system.checkFailed': 'Check failed',
    'taskRuntime.compactLimit': 'Auto Compact Limit',
    'taskRuntime.compactLimitDesc': 'Compact task history when context tokens reach this value, capped at 90% of the window.',
    'taskRuntime.contextWindow': 'Model Context Window',
    'taskRuntime.contextWindowDesc': 'Used to estimate the task history compact threshold.',
    'taskRuntime.desc': 'Tune task model execution loops, history compaction, and stuck handling.',
    'taskRuntime.keepRecent': 'Keep Recent Turns',
    'taskRuntime.keepRecentDesc': 'How many raw recent turns to keep during compaction.',
    'taskRuntime.maxTurns': 'Max Turns',
    'taskRuntime.maxTurnsDesc': 'Stop a task after this many runtime turns.',
    'taskRuntime.title': 'Task Runtime Params',
    'plugins.title': 'Plugins',
    'about.desc': 'Putting a living soul into the desktop.',
    'about.quote': 'Voice, memory, emotion, personality, and tools — an experiment toward AI that can talk, accompany, and act beside us.',
    'about.title': 'About',
    'notice.voiceInputDisabled': 'Voice input disabled',
    'notice.voiceInputEnabled': 'Voice input enabled',
    'inputMeta.currentOnly': 'Only used for the current task',
    'inputMeta.persistent': 'Can be saved and reused in later tasks',
    'inputMeta.verification': 'One-time verification code, not saved',
  }
}

let currentLanguage: LanguageCode = 'zh-CN'

function t(key: string): string {
  return I18N[currentLanguage][key] ?? I18N['zh-CN'][key] ?? key
}

function setLanguage(language: LanguageCode): void {
  currentLanguage = language
  document.documentElement.lang = language
  applyI18n()
  updateConversationButton()
  setStatus(getReadyStatus())
  renderSystemConfigIfReady()
}

function applyI18n(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n || '')
  })
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.dataset.i18nTitle || ''))
  })
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder || '')
  })
}

function renderSystemConfigIfReady(): void {
  if (typeof currentSystemConfig === 'undefined' || !currentSystemConfig) {
    return
  }
  renderLLMModels()
  renderTaskModels()
  renderTTSModels()
  renderASRModels()
  renderLocalModels(lastLocalModels)
}

type LLMModelConfig = {
  id: string
  modelName: string
  apiKey: string
  baseUrl: string
}

type TTSProviderType = 'fish'

type TTSModelConfig = {
  id: string
  provider: TTSProviderType
  modelName: string
  apiKey: string
  voiceId?: string
}

type ASRProviderType = 'qwen'

type ASRModelConfig = {
  id: string
  provider: ASRProviderType
  modelName: string
  apiKey: string
}

type ApiModelTestKind = 'llm' | 'task' | 'tts' | 'asr'

type TaskRuntimeSettings = {
  maxTurns: number
  modelContextWindow: number
  autoCompactTokenLimit: number
  keepRecentTurns: number
}

type SystemConfig = {
  proxy: string
  llmModels: LLMModelConfig[]
  activeLLMId: string
  taskModels: LLMModelConfig[]
  activeTaskId: string
  taskRuntime: TaskRuntimeSettings
  ttsModels: TTSModelConfig[]
  activeTTSId: string
  asrModels: ASRModelConfig[]
  activeASRId: string
}

type LocalModelStatus = {
  id: 'silero-vad' | 'smart-turn'
  name: string
  filename: string
  purpose: string
  exists: boolean
  sizeBytes?: number
  path: string
}

type SetupIssueKind = 'llm' | 'task' | 'tts' | 'asr' | 'models'

type SetupIssue = {
  kind: SetupIssueKind
  label: string
  message: string
}

type SetupReadiness = {
  ready: boolean
  issues: SetupIssue[]
}

type UISettings = {
  language: LanguageCode
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
  volume: number
  selectedPersonality: string
  plugins: Record<string, boolean>
  pluginConfigs: Record<string, Record<string, unknown>>
  system: SystemConfig
}

type PluginConfigField =
  | {
      key: string
      label?: string
      description?: string
      type: 'string'
      default?: string
      placeholder?: string
      multiline?: boolean
      rows?: number
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'number'
      default?: number
      min?: number
      max?: number
      step?: number
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'boolean'
      default?: boolean
    }
  | {
      key: string
      label?: string
      description?: string
      type: 'select'
      default?: string
      options: Array<{ label: string; value: string }>
    }

type PluginUISurface = {
  id: string
  pluginId: string
  slot: 'main-view' | 'task-panel'
  mode: 'replace' | 'overlay'
  title?: string
  src: string
  transparent: boolean
}

type PluginInfo = {
  id: string
  name: string
  description?: string
  version?: string
  enabled: boolean
  pluginDir: string
  permissions: string[]
  config: Record<string, unknown>
  configSchema: PluginConfigField[]
  uiSurfaces: PluginUISurface[]
  adminSchema?: {
    title?: string
    description?: string
    actions?: Array<{
      id: string
      label: string
      description?: string
      variant?: 'primary' | 'secondary' | 'danger'
    }>
  }
}

type ConversationFrame =
  | { type: 'system.reset' }
  | { type: 'control.phase_start'; phase: 'reply' | 'task' | 'task_progress' | 'task_result' }
  | { type: 'control.phase_end'; phase: 'reply' | 'task' | 'task_progress' | 'task_result' }
  | { type: 'control.task_start'; taskDescription: string }
  | { type: 'control.task_status'; status: string; message?: string; severity: 'silent' | 'info' | 'important' | 'blocking' | 'final' }
  | { type: 'control.task_plan'; plan: TaskPanelPlan }
  | { type: 'control.task_end'; success: boolean; summary: string; error?: string }
  | { type: 'data.tts_text'; text: string }
  | {
      type: 'expression.show'
      id: string
      emotion: string
      src: string
      durationMs: number
      priority?: number
    }

type TaskPanelStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

type TaskPanelPlan = {
  id: string
  title: string
  summary: string
  steps: Array<{
    id: string
    title: string
    description: string
    status: TaskPanelStepStatus
    result?: string
    error?: string
  }>
}

const voiceRecorder = new VoiceRecorder()

// Canvas rendering
const pluginUIMainView = document.getElementById('main-view') as HTMLElement
const pluginUITaskPanel = document.getElementById('task-panel') as HTMLElement
const canvas = document.getElementById('orb-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: true })!
let activePluginMainSurface: PluginUISurface | null = null
let activePluginTaskSurface: PluginUISurface | null = null
let lastTaskPanelPlan: TaskPanelPlan | null = null
let pluginUIStateTimer: number | undefined
let orbCanvasWidth = 180
let orbCanvasHeight = 180
let orbCanvasDpr = 1

interface OrbState {
  mode: 'idle' | 'listening' | 'thinking' | 'speaking' | 'interrupted'
  glow: number
  breatheRate: number
  modeChangedAt: number
}

let orbState: OrbState = {
  mode: 'idle',
  glow: 4,
  breatheRate: 1.2,
  modeChangedAt: performance.now()
}
let orbAnimationFrameId: number | null = null
let orbAnimationPaused = false
let orbInputEnergy = 0
let orbOutputEnergy = 0
let orbEnergyUpdatedAt = performance.now()

// Store current radius for mouse detection
let currentOrbRadius = 22

function resizeOrbCanvas(): void {
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width || 180))
  const height = Math.max(1, Math.round(rect.height || 180))
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  const pixelWidth = Math.round(width * dpr)
  const pixelHeight = Math.round(height * dpr)

  if (
    canvas.width !== pixelWidth ||
    canvas.height !== pixelHeight ||
    orbCanvasWidth !== width ||
    orbCanvasHeight !== height ||
    orbCanvasDpr !== dpr
  ) {
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    orbCanvasWidth = width
    orbCanvasHeight = height
    orbCanvasDpr = dpr
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function updateOrbAudioEnergy(source: 'input' | 'output', samples: Int16Array | Uint8Array): void {
  const next = calculatePcmEnergy(samples)
  if (source === 'input') {
    orbInputEnergy = Math.max(orbInputEnergy * 0.72, next)
  } else {
    orbOutputEnergy = Math.max(orbOutputEnergy * 0.70, next)
  }
  orbEnergyUpdatedAt = performance.now()
  syncPluginUIStateSoon()
}

function calculatePcmEnergy(samples: Int16Array | Uint8Array): number {
  const pcm = samples instanceof Int16Array
    ? samples
    : new Int16Array(samples.buffer, samples.byteOffset, Math.floor(samples.byteLength / 2))

  if (pcm.length === 0) {
    return 0
  }

  let sumSquares = 0
  let peak = 0
  const stride = Math.max(1, Math.floor(pcm.length / 2400))

  for (let i = 0; i < pcm.length; i += stride) {
    const normalized = Math.abs(pcm[i]) / 32768
    sumSquares += normalized * normalized
    if (normalized > peak) {
      peak = normalized
    }
  }

  const count = Math.ceil(pcm.length / stride)
  const rms = Math.sqrt(sumSquares / count)
  const energy = rms * 4.8 + peak * 0.55
  return Math.max(0, Math.min(1, energy))
}

function getOrbAudioEnergy(mode: OrbState['mode']): number {
  const now = performance.now()
  const decay = Math.exp(-(now - orbEnergyUpdatedAt) / 220)
  orbInputEnergy *= decay
  orbOutputEnergy *= decay
  orbEnergyUpdatedAt = now

  if (mode === 'listening') {
    return orbInputEnergy
  }

  if (mode === 'speaking') {
    return orbOutputEnergy
  }

  return Math.max(orbInputEnergy, orbOutputEnergy) * 0.35
}

function drawOrb() {
  if (orbAnimationPaused) {
    orbAnimationFrameId = null
    return
  }

  resizeOrbCanvas()
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha = 1
  ctx.clearRect(0, 0, orbCanvasWidth, orbCanvasHeight)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.001)'
  ctx.fillRect(0, 0, orbCanvasWidth, orbCanvasHeight)

  const centerX = orbCanvasWidth / 2
  const centerY = orbCanvasHeight / 2
  const time = Date.now() / 1000
  const elapsed = performance.now() - orbState.modeChangedAt
  const palette = getOrbPalette(orbState.mode)
  const audioEnergy = getOrbAudioEnergy(orbState.mode)
  const breathe = Math.sin(time * orbState.breatheRate) * palette.breathe
  const interruptedPulse = orbState.mode === 'interrupted'
    ? Math.max(0, 1 - elapsed / 220)
    : 0
  const speakingPulse = orbState.mode === 'speaking'
    ? Math.sin(time * 8.2) * 1.5 + Math.sin(time * 13.1) * 0.8
    : 0
  const currentRadius = 22 + breathe + speakingPulse + audioEnergy * 4.5 - interruptedPulse * 3
  currentOrbRadius = currentRadius // Update for mouse detection

  drawOrbAura(centerX, centerY, currentRadius, time, palette, interruptedPulse, audioEnergy)

  ctx.save()
  ctx.shadowColor = palette.shadow
  ctx.shadowBlur = 14 + orbState.glow * palette.shadowStrength
  ctx.shadowOffsetY = 3

  const coreGradient = ctx.createRadialGradient(
    centerX - currentRadius * 0.48,
    centerY - currentRadius * 0.54,
    0,
    centerX + currentRadius * 0.22,
    centerY + currentRadius * 0.34,
    currentRadius * 1.28
  )
  coreGradient.addColorStop(0, palette.coreTop)
  coreGradient.addColorStop(0.26, palette.coreMid)
  coreGradient.addColorStop(0.55, palette.coreTint)
  coreGradient.addColorStop(0.78, palette.coreLow)
  coreGradient.addColorStop(1, 'rgba(0, 0, 0, 1)')

  ctx.fillStyle = coreGradient
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  drawOrbColorVeil(centerX, centerY, currentRadius, time, palette)
  drawOrbInnerLight(centerX, centerY, currentRadius, time, palette)
  drawOrbMembrane(centerX, centerY, currentRadius, time, palette, audioEnergy)

  const highlight = ctx.createRadialGradient(
    centerX - currentRadius * 0.34,
    centerY - currentRadius * 0.46,
    0,
    centerX - currentRadius * 0.34,
    centerY - currentRadius * 0.46,
    currentRadius * 0.42
  )
  highlight.addColorStop(0, palette.highlight)
  highlight.addColorStop(0.42, 'rgba(255, 255, 255, 0.16)')
  highlight.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.fillStyle = highlight
  ctx.beginPath()
  ctx.arc(centerX, centerY, currentRadius, 0, Math.PI * 2)
  ctx.fill()

  orbAnimationFrameId = requestAnimationFrame(drawOrb)
}

type OrbPalette = {
  breathe: number
  shadow: string
  shadowStrength: number
  coreTop: string
  coreMid: string
  coreTint: string
  coreLow: string
  highlight: string
  ring: string
  ringSoft: string
  inner: string
  veilA: string
  veilB: string
}

function getOrbPalette(mode: OrbState['mode']): OrbPalette {
  switch (mode) {
    case 'listening':
      return {
        breathe: 1.5,
        shadow: 'rgba(76, 210, 190, 0.42)',
        shadowStrength: 1.05,
        coreTop: 'rgba(136, 186, 176, 1)',
        coreMid: 'rgba(35, 76, 72, 1)',
        coreTint: 'rgba(7, 36, 35, 1)',
        coreLow: 'rgba(1, 9, 10, 1)',
        highlight: 'rgba(225, 255, 250, 0.58)',
        ring: 'rgba(105, 225, 205, 0.34)',
        ringSoft: 'rgba(105, 225, 205, 0.12)',
        inner: 'rgba(125, 235, 214, 0.24)',
        veilA: 'rgba(83, 230, 205, 0.16)',
        veilB: 'rgba(90, 155, 255, 0.10)',
      }
    case 'thinking':
      return {
        breathe: 1.2,
        shadow: 'rgba(226, 74, 144, 0.38)',
        shadowStrength: 1.15,
        coreTop: 'rgba(156, 114, 150, 1)',
        coreMid: 'rgba(70, 36, 63, 1)',
        coreTint: 'rgba(35, 14, 35, 1)',
        coreLow: 'rgba(9, 3, 12, 1)',
        highlight: 'rgba(255, 226, 242, 0.56)',
        ring: 'rgba(226, 74, 144, 0.28)',
        ringSoft: 'rgba(226, 74, 144, 0.10)',
        inner: 'rgba(255, 180, 220, 0.26)',
        veilA: 'rgba(226, 74, 144, 0.16)',
        veilB: 'rgba(118, 98, 255, 0.12)',
      }
    case 'speaking':
      return {
        breathe: 1.25,
        shadow: 'rgba(255, 190, 112, 0.36)',
        shadowStrength: 1.05,
        coreTop: 'rgba(180, 126, 80, 1)',
        coreMid: 'rgba(82, 49, 28, 1)',
        coreTint: 'rgba(43, 20, 10, 1)',
        coreLow: 'rgba(11, 5, 2, 1)',
        highlight: 'rgba(255, 238, 212, 0.56)',
        ring: 'rgba(255, 197, 120, 0.32)',
        ringSoft: 'rgba(255, 197, 120, 0.12)',
        inner: 'rgba(255, 198, 126, 0.28)',
        veilA: 'rgba(255, 172, 91, 0.18)',
        veilB: 'rgba(255, 95, 118, 0.10)',
      }
    case 'interrupted':
      return {
        breathe: 0.7,
        shadow: 'rgba(255, 255, 255, 0.30)',
        shadowStrength: 1.2,
        coreTop: 'rgba(160, 160, 160, 1)',
        coreMid: 'rgba(58, 58, 58, 1)',
        coreTint: 'rgba(21, 21, 24, 1)',
        coreLow: 'rgba(5, 5, 6, 1)',
        highlight: 'rgba(255, 255, 255, 0.64)',
        ring: 'rgba(255, 255, 255, 0.36)',
        ringSoft: 'rgba(255, 255, 255, 0.12)',
        inner: 'rgba(255, 255, 255, 0.20)',
        veilA: 'rgba(255, 255, 255, 0.12)',
        veilB: 'rgba(190, 210, 255, 0.08)',
      }
    default:
      return {
        breathe: 1.0,
        shadow: 'rgba(0, 0, 0, 0.55)',
        shadowStrength: 0.7,
        coreTop: 'rgba(98, 98, 104, 1)',
        coreMid: 'rgba(29, 29, 33, 1)',
        coreTint: 'rgba(11, 12, 15, 1)',
        coreLow: 'rgba(2, 2, 3, 1)',
        highlight: 'rgba(255, 255, 255, 0.58)',
        ring: 'rgba(255, 255, 255, 0.11)',
        ringSoft: 'rgba(255, 255, 255, 0.045)',
        inner: 'rgba(255, 255, 255, 0.08)',
        veilA: 'rgba(130, 150, 170, 0.06)',
        veilB: 'rgba(255, 255, 255, 0.035)',
      }
  }
}

function drawOrbAura(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette,
  interruptedPulse: number,
  audioEnergy: number
): void {
  if (
    orbState.mode !== 'listening' &&
    orbState.mode !== 'speaking' &&
    orbState.mode !== 'thinking' &&
    orbState.mode !== 'interrupted'
  ) {
    return
  }

  ctx.save()
  ctx.lineWidth = 1.1 + audioEnergy * 1.1

  if (orbState.mode === 'thinking') {
    const orbit = radius + 8 + Math.sin(time * 1.3) * 1.6 + audioEnergy * 5
    ctx.strokeStyle = palette.ringSoft
    ctx.beginPath()
    ctx.arc(centerX, centerY, orbit, Math.PI * 0.18 + time * 0.5, Math.PI * 1.28 + time * 0.5)
    ctx.stroke()
    ctx.restore()
    return
  }

  const pulseSpeed = 3.2 + audioEnergy * 5
  const pulseA = orbState.mode === 'interrupted' ? interruptedPulse : (Math.sin(time * pulseSpeed) + 1) / 2
  const pulseB = orbState.mode === 'interrupted' ? interruptedPulse * 0.65 : (Math.sin(time * pulseSpeed + Math.PI) + 1) / 2
  const rings = [
    { amount: pulseA, alpha: 0.55 },
    { amount: pulseB, alpha: 0.32 },
  ]

  for (const ring of rings) {
    const ringRadius = radius + 6 + ring.amount * (13 + audioEnergy * 16)
    ctx.globalAlpha = (ring.alpha + audioEnergy * 0.26) * (1 - ring.amount * 0.65)
    ctx.strokeStyle = palette.ring
    ctx.beginPath()
    ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()
}

function drawOrbColorVeil(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette
): void {
  const angleA = time * 0.55
  const angleB = -time * 0.38
  const veilA = ctx.createRadialGradient(
    centerX + Math.cos(angleA) * radius * 0.34,
    centerY + Math.sin(angleA * 0.8) * radius * 0.26,
    0,
    centerX + Math.cos(angleA) * radius * 0.34,
    centerY + Math.sin(angleA * 0.8) * radius * 0.26,
    radius * 1.05
  )
  veilA.addColorStop(0, palette.veilA)
  veilA.addColorStop(1, 'rgba(255, 255, 255, 0)')

  const veilB = ctx.createRadialGradient(
    centerX + Math.cos(angleB) * radius * 0.28,
    centerY + Math.sin(angleB * 0.9) * radius * 0.32,
    0,
    centerX + Math.cos(angleB) * radius * 0.28,
    centerY + Math.sin(angleB * 0.9) * radius * 0.32,
    radius * 0.92
  )
  veilB.addColorStop(0, palette.veilB)
  veilB.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius * 0.99, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = veilA
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2)
  ctx.fillStyle = veilB
  ctx.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2)
  ctx.restore()
}

function drawOrbInnerLight(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette
): void {
  if (orbState.mode === 'idle') {
    return
  }

  const angle = time * (orbState.mode === 'thinking' ? 0.9 : 1.45)
  const offsetX = Math.cos(angle) * radius * 0.26
  const offsetY = Math.sin(angle * 0.85) * radius * 0.18
  const inner = ctx.createRadialGradient(
    centerX + offsetX,
    centerY + offsetY,
    0,
    centerX + offsetX,
    centerY + offsetY,
    radius * 0.9
  )
  inner.addColorStop(0, palette.inner)
  inner.addColorStop(1, 'rgba(255, 255, 255, 0)')

  ctx.save()
  ctx.fillStyle = inner
  ctx.beginPath()
  ctx.arc(centerX, centerY, radius * 0.98, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawOrbMembrane(
  centerX: number,
  centerY: number,
  radius: number,
  time: number,
  palette: OrbPalette,
  audioEnergy: number
): void {
  if (audioEnergy < 0.015 && orbState.mode !== 'speaking' && orbState.mode !== 'listening') {
    return
  }

  const points = 96
  const baseRipple = orbState.mode === 'speaking' || orbState.mode === 'listening'
    ? 0.7
    : 0.25
  const rippleAmount = baseRipple + audioEnergy * 4.8

  ctx.save()
  ctx.globalAlpha = Math.min(0.72, 0.22 + audioEnergy * 0.72)
  ctx.strokeStyle = palette.ring
  ctx.lineWidth = 0.9 + audioEnergy * 1.5
  ctx.beginPath()

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2
    const ripple =
      Math.sin(angle * 7 + time * 8.5) * rippleAmount * 0.42 +
      Math.sin(angle * 11 - time * 5.7) * rippleAmount * 0.32 +
      Math.sin(angle * 17 + time * 3.6) * rippleAmount * 0.18
    const nextRadius = radius + 1.5 + ripple
    const x = centerX + Math.cos(angle) * nextRadius
    const y = centerY + Math.sin(angle) * nextRadius

    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }

  ctx.stroke()

  if (audioEnergy > 0.08) {
    ctx.globalAlpha = Math.min(0.26, audioEnergy * 0.42)
    ctx.lineWidth = 0.7
    ctx.beginPath()
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2
      const ripple = Math.sin(angle * 9 - time * 9.2) * audioEnergy * 6
      const nextRadius = radius + 6 + ripple
      const x = centerX + Math.cos(angle) * nextRadius
      const y = centerY + Math.sin(angle) * nextRadius

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()
  }

  ctx.restore()
}

function startOrbAnimation(): void {
  if (orbAnimationFrameId !== null || orbAnimationPaused) {
    return
  }

  drawOrb()
}

function stopOrbAnimation(): void {
  if (orbAnimationFrameId !== null) {
    cancelAnimationFrame(orbAnimationFrameId)
    orbAnimationFrameId = null
  }
}

startOrbAnimation()
window.addEventListener('resize', resizeOrbCanvas)

// Helper function to check if point is inside orb
function isPointInOrb(clientX: number, clientY: number): boolean {
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top
  const centerX = rect.width / 2
  const centerY = rect.height / 2

  const dx = x - centerX
  const dy = y - centerY
  const distance = Math.sqrt(dx * dx + dy * dy)

  return distance <= currentOrbRadius
}

// Track drag state
let isDragging = false
let lastMouseX = 0
let lastMouseY = 0

canvas.addEventListener('mousemove', (e) => {
  if (isDragging) {
    const deltaX = e.screenX - lastMouseX
    const deltaY = e.screenY - lastMouseY
    lastMouseX = e.screenX
    lastMouseY = e.screenY
    window.electronAPI.moveWindow(deltaX, deltaY)
  } else {
    canvas.style.cursor = isPointInOrb(e.clientX, e.clientY) ? 'grab' : 'move'
  }
})

canvas.addEventListener('mouseleave', () => {
  if (!isDragging) {
    canvas.style.cursor = 'default'
  }
})

canvas.addEventListener('mousedown', (e) => {
  isDragging = true
  lastMouseX = e.screenX
  lastMouseY = e.screenY
  canvas.style.cursor = 'grabbing'
})

canvas.addEventListener('mouseup', (e) => {
  if (isDragging) {
    isDragging = false
    canvas.style.cursor = isPointInOrb(e.clientX, e.clientY) ? 'grab' : 'move'
  }
})

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false
    canvas.style.cursor = 'default'
  }
})

function setOrbMode(mode: OrbState['mode']) {
  if (orbState.mode === mode) {
    return
  }

  orbState.mode = mode
  orbState.modeChangedAt = performance.now()
  syncPluginUIStateSoon()
  switch (mode) {
    case 'listening':
      orbState.glow = 8
      orbState.breatheRate = 2.8
      break
    case 'thinking':
      orbState.glow = 11
      orbState.breatheRate = 1.65
      break
    case 'speaking':
      orbState.glow = 10
      orbState.breatheRate = 2.15
      break
    case 'interrupted':
      orbState.glow = 13
      orbState.breatheRate = 3.6
      break
    default:
      orbState.glow = 4
      orbState.breatheRate = 1.2
  }
}

function flashOrbInterrupted(): void {
  setOrbMode('interrupted')
  window.setTimeout(() => {
    if (orbState.mode === 'interrupted') {
      setOrbMode('listening')
    }
  }, 180)
}

let lastStatusText = ''
function setStatus(text: string) {
  if (text === lastStatusText) return
  lastStatusText = text
  const statusEl = document.getElementById('status')!
  replaceControlText(statusEl, text)
  syncPluginUIStateSoon()
}

function replaceControlText(element: HTMLElement, text: string): void {
  element.replaceChildren(document.createTextNode(text))
  element.dataset.text = text
  element.style.transform = 'translateZ(0)'
  void element.offsetWidth
}

let panelNoticeTimer: number | undefined
function hidePanelNotice(): void {
  const notice = document.getElementById('panel-notice')
  if (!notice) return

  window.clearTimeout(panelNoticeTimer)
  panelNoticeTimer = undefined
  notice.classList.remove('visible')
}

function showPanelNotice(text: string, tone: 'info' | 'error' = 'info') {
  const notice = document.getElementById('panel-notice')
  if (!notice) return

  notice.textContent = text
  notice.className = `panel-notice visible ${tone === 'error' ? 'error' : ''}`
  window.clearTimeout(panelNoticeTimer)
  panelNoticeTimer = window.setTimeout(() => {
    notice.classList.remove('visible')
  }, 2200)
}

function setTextDisplay(text: string) {
  const textDisplay = document.getElementById('text-display')!
  replaceControlText(textDisplay, text)
  syncPluginUIStateSoon()
}

function clearTextDisplay() {
  setTextDisplay('')
}

function getPluginUIState() {
  return {
    status: lastStatusText,
    activeMode,
    voiceInputEnabled,
    ttsEnabled,
    text: document.getElementById('text-display')?.textContent ?? '',
    orb: {
      mode: orbState.mode,
      glow: orbState.glow,
      inputEnergy: orbInputEnergy,
      outputEnergy: orbOutputEnergy,
    },
    task: {
      visible: document.body.classList.contains('task-active'),
      plan: lastTaskPanelPlan,
    },
  }
}

function syncPluginUIStateSoon(): void {
  window.clearTimeout(pluginUIStateTimer)
  pluginUIStateTimer = window.setTimeout(syncPluginUIState, 16)
}

function syncPluginUIState(): void {
  const message = {
    type: 'her-text:ui-state',
    state: getPluginUIState(),
  }

  document.querySelectorAll<HTMLIFrameElement>('.plugin-ui-surface-frame').forEach(frame => {
    frame.contentWindow?.postMessage(message, '*')
  })
}

function renderPluginUISurface(container: HTMLElement, surface: PluginUISurface | null): void {
  container.querySelector('.plugin-ui-surface')?.remove()
  if (!surface) {
    return
  }

  const host = document.createElement('div')
  host.className = `plugin-ui-surface ${surface.slot === 'main-view' ? 'plugin-ui-main-surface' : 'plugin-ui-task-surface'} ${surface.mode}`
  host.dataset.pluginId = surface.pluginId
  host.dataset.surfaceId = surface.id

  const frame = document.createElement('iframe')
  frame.className = 'plugin-ui-surface-frame'
  frame.src = surface.src
  frame.title = surface.title || surface.id
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
  frame.setAttribute('aria-label', surface.title || surface.id)
  frame.addEventListener('load', () => syncPluginUIState())

  host.appendChild(frame)
  container.appendChild(host)
}

function applyPluginUISurfaces(surfaces: PluginUISurface[]): void {
  activePluginMainSurface = surfaces.find(surface => surface.slot === 'main-view') ?? null
  activePluginTaskSurface = surfaces.find(surface => surface.slot === 'task-panel') ?? null

  document.body.classList.toggle(
    'plugin-main-surface-replace',
    activePluginMainSurface?.mode === 'replace'
  )
  document.body.classList.toggle(
    'plugin-task-surface-replace',
    activePluginTaskSurface?.mode === 'replace'
  )

  renderPluginUISurface(pluginUIMainView, activePluginMainSurface)
  renderPluginUISurface(pluginUITaskPanel, activePluginTaskSurface)
  syncPluginUIStateSoon()
}

async function loadPluginUISurfaces(): Promise<void> {
  try {
    const result = await window.electronAPI.listPlugins()
    if (!result.success) {
      throw new Error(result.error || '插件 UI 加载失败')
    }

    applyPluginUISurfaces(result.plugins.flatMap(plugin => plugin.enabled ? plugin.uiSurfaces : []))
  } catch (error: any) {
    console.warn('[PluginUI] Failed to load surfaces:', error)
    applyPluginUISurfaces([])
  }
}

window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') {
    return
  }
  if (data.type === 'her-text:ui-ready') {
    syncPluginUIState()
  }
})

let currentExpressionPriority = 0
let expressionClearTimer: number | undefined
let expressionRevealTimer: number | undefined
let expressionShownAt = 0

function clearExpression(): void {
  const layer = document.getElementById('expression-layer')!
  const image = document.getElementById('expression-image') as HTMLImageElement
  layer.classList.remove('visible', 'bubbles-visible')
  currentExpressionPriority = 0

  if (expressionClearTimer !== undefined) {
    window.clearTimeout(expressionClearTimer)
  }
  if (expressionRevealTimer !== undefined) {
    window.clearTimeout(expressionRevealTimer)
    expressionRevealTimer = undefined
  }

  expressionClearTimer = window.setTimeout(() => {
    if (!layer.classList.contains('visible')) {
      image.removeAttribute('src')
    }
    expressionClearTimer = undefined
  }, 220)
}

function showExpression(frame: Extract<ConversationFrame, { type: 'expression.show' }>): void {
  const priority = frame.priority ?? 0
  if (currentExpressionPriority > priority) {
    return
  }

  const layer = document.getElementById('expression-layer')!
  const image = document.getElementById('expression-image') as HTMLImageElement
  if (expressionClearTimer !== undefined) {
    window.clearTimeout(expressionClearTimer)
    expressionClearTimer = undefined
  }

  currentExpressionPriority = priority
  image.src = frame.src
  expressionShownAt = performance.now()
  layer.classList.remove('visible', 'bubbles-visible')
  layer.classList.add('bubbles-visible')
  expressionRevealTimer = window.setTimeout(() => {
    layer.classList.add('visible')
    expressionRevealTimer = undefined
  }, 180)
}

function clearExpressionAfterMinimum(): void {
  const elapsed = performance.now() - expressionShownAt
  const remaining = Math.max(0, 4000 - elapsed)
  if (expressionClearTimer !== undefined) {
    window.clearTimeout(expressionClearTimer)
  }

  expressionClearTimer = window.setTimeout(() => {
    clearExpression()
  }, remaining)
}

let taskPanelHideTimer: number | undefined

function setTaskPanelVisible(visible: boolean): void {
  if (taskPanelHideTimer !== undefined) {
    window.clearTimeout(taskPanelHideTimer)
    taskPanelHideTimer = undefined
  }

  document.body.classList.toggle('task-active', visible)
  pluginUITaskPanel.setAttribute('aria-hidden', String(!visible))
  if (!document.body.classList.contains('settings-open')) {
    window.electronAPI.setTaskWindowMode(visible)
  }
  syncPluginUIStateSoon()
}

function hideTaskPanelSoon(): void {
  if (taskPanelHideTimer !== undefined) {
    window.clearTimeout(taskPanelHideTimer)
  }
  taskPanelHideTimer = window.setTimeout(() => {
    setTaskPanelVisible(false)
  }, 1800)
}

function renderTaskPanel(plan: TaskPanelPlan): void {
  lastTaskPanelPlan = plan
  const title = document.querySelector('.task-panel-title')
  const list = document.getElementById('task-steps')
  if (!title || !list) {
    return
  }

  title.textContent = plan.title || t('taskPanel.title')
  list.textContent = ''

  for (const step of plan.steps.slice(0, 6)) {
    const item = document.createElement('li')
    item.className = `task-step ${step.status}`

    const mark = document.createElement('span')
    mark.className = 'task-step-mark'
    mark.textContent = getTaskStepMark(step.status)

    const text = document.createElement('span')
    text.className = 'task-step-title'
    text.textContent = step.title || step.description || t('taskPanel.step')

    item.append(mark, text)
    list.appendChild(item)
  }

  setTaskPanelVisible(true)
  syncPluginUIStateSoon()
}

function getTaskStepMark(status: TaskPanelStepStatus): string {
  switch (status) {
    case 'completed':
      return '✓'
    case 'running':
      return '•'
    case 'failed':
      return '!'
    case 'skipped':
      return '-'
    default:
      return ''
  }
}

function handleConversationFrame(frame: ConversationFrame) {
  switch (frame.type) {
    case 'system.reset':
      textRevealer.reset()
      clearExpression()
      lastTaskPanelPlan = null
      setTaskPanelVisible(false)
      setStatus(t('status.thinking'))
      setOrbMode('thinking')
      break
    case 'control.phase_start':
      if (frame.phase === 'reply') {
        setStatus(t('status.replying'))
      } else if (frame.phase === 'task_progress') {
        setStatus(t('status.working'))
      } else if (frame.phase === 'task_result') {
        audioPlayer.stop()
        textRevealer.reset()
        setStatus(t('status.sharingResult'))
      }
      setOrbMode('thinking')
      break
    case 'control.phase_end':
      if (frame.phase === 'reply' || frame.phase === 'task_result') {
        if (ttsEnabled) {
          textRevealer.reset()
          clearTextDisplay()
        }
        setStatus(getReadyStatus())
        setOrbMode('idle')
        clearExpressionAfterMinimum()
      }
      break
    case 'control.task_status':
      setStatus(frame.status)
      break
    case 'control.task_start':
      renderTaskPanel({
        id: 'pending',
        title: t('taskPanel.title'),
        summary: frame.taskDescription,
        steps: [{
          id: 'pending-step',
          title: frame.taskDescription,
          description: frame.taskDescription,
          status: 'running',
        }],
      })
      setStatus(t('status.working'))
      setOrbMode('thinking')
      break
    case 'control.task_plan':
      renderTaskPanel(frame.plan)
      break
    case 'control.task_end':
      if (!frame.success) {
        setStatus(frame.error ? `${t('taskPanel.failed')}: ${frame.error}` : t('taskPanel.failed'))
      }
      hideTaskPanelSoon()
      break
    case 'data.tts_text':
      textRevealer.enqueueText(frame.text)
      break
    case 'expression.show':
      showExpression(frame)
      break
  }
}

// ========== Event Handlers ==========

const startConversationBtn = document.getElementById('start-conversation-btn') as HTMLButtonElement

function updateConversationButton(): void {
  document.getElementById('main-view')?.classList.toggle('conversation-active', activeMode === 'conversation')
  replaceControlText(startConversationBtn, voiceInputEnabled
    ? (activeMode === 'conversation' ? t('button.stop') : t('button.start'))
    : t('status.voiceDisabled'))
}

function getReadyStatus(): string {
  return activeMode === 'conversation' ? t('status.listening') : t('status.ready')
}

async function initialize() {
  if (isInitialized) {
    return
  }

  setStatus(t('status.initializing'))
  startConversationBtn.disabled = true

  try {
    await audioPlayer.initialize()
    audioPlayer.setChunkScheduledHandler(({ startTime, duration }) => {
      textRevealer.scheduleAudioWindow(startTime, duration)
    })
    audioPlayer.setPlaybackStartHandler(() => {
      setOrbMode('speaking')
    })

    const result = await window.electronAPI.initializeConversation()

    if (!result.success) {
      throw new Error(result.error || 'Initialization failed')
    }

    isInitialized = true
    ttsEnabled = Boolean(result.ttsEnabled)

    if (result.stats) {
      console.log('[SDK] Stats:', result.stats)
    }

    startConversationBtn.disabled = !voiceInputEnabled
    updateConversationButton()
    setStatus(t('status.ready'))

    window.electronAPI.onTTSAudio((audioData, contextId) => {
      console.log(`[UI] Received TTS audio (context #${contextId}):`, audioData.byteLength, 'bytes')
      audioPlayer.addAudioChunk(audioData, contextId)
    })

    window.electronAPI.onTTSContextStart((contextId) => {
      console.log(`[UI] TTS context started: #${contextId}`)
      audioPlayer.setValidContextId(contextId)
    })

    window.electronAPI.onTTSContextInvalidated((contextId) => {
      console.log(`[UI] TTS context invalidated: #${contextId}`)
      audioPlayer.invalidateContext(contextId)
    })

    window.electronAPI.onConversationResponse((text) => {
      if (!ttsEnabled) {
        setTextDisplay(text)
      }
    })

    window.electronAPI.onConversationFrame((frame) => {
      handleConversationFrame(frame as ConversationFrame)
    })

    window.electronAPI.onTTSConnected((contextId) => {
      console.log(`[UI] TTS connected (context #${contextId})`)
      setOrbMode('thinking')
      audioPlayer.resetLatencyTracking()
    })

    window.electronAPI.onTTSClosed(() => {
      console.log('[UI] TTS closed')
    })

    window.electronAPI.onTTSError((error) => {
      console.error('[UI] TTS error:', error)
      setStatus(`TTS Error: ${error}`)
    })

    window.electronAPI.onLatencyData((data) => {
      console.log('[Latency] Received data:', data)
      if (data.total) {
        const msg = `延迟: ${data.total.toFixed(0)}ms`
        console.log(`[Latency] ${msg}`)
        setStatus(msg)
        setTimeout(() => setStatus(getReadyStatus()), 3000)
      }
    })

    window.electronAPI.onSpeechState((state) => {
      console.log('[UI] Speech state:', state)
      if (state === 'listening') {
        setStatus(t('status.listening'))
        setOrbMode('listening')
      } else if (state === 'processing') {
        setStatus(t('status.processing'))
        setOrbMode('thinking')
      }
    })

    window.electronAPI.onSpeechTranscript((text) => {
      console.log('[UI] Transcript:', text)
    })

    window.electronAPI.onSpeechError((error) => {
      console.error('[UI] Speech error:', error)
      setStatus(`Speech Error: ${error}`)
      setOrbMode('idle')
    })

    window.electronAPI.onSpeechReconnecting(() => {
      console.log('[UI] Speech WebSocket reconnecting...')
      setStatus(t('status.reconnecting'))
    })

    window.electronAPI.onSpeechReconnected(() => {
      console.log('[UI] Speech WebSocket reconnected')
      setStatus(t('status.listening'))
    })

    window.electronAPI.onSpeechConnectionFailed(() => {
      console.error('[UI] Speech WebSocket connection failed')
      setStatus(t('status.connectionFailed'))
      setOrbMode('idle')
    })

    window.electronAPI.onUserSpeaking(() => {
      console.log('[UI] User started speaking, stopping playback')
      audioPlayer.stop()
      textRevealer.reset()
      clearTextDisplay()
      setOrbMode('listening')
    })

    window.electronAPI.onInterruption((turnId) => {
      console.log(`[UI] Interruption detected for turn #${turnId}, clearing all queues`)
      audioPlayer.stop()
      textRevealer.reset()
      clearTextDisplay()
      flashOrbInterrupted()
    })

    window.electronAPI.onTurnStart((turnId) => {
      console.log(`[UI] New turn started: #${turnId}`)
      audioPlayer.stop()
      textRevealer.reset()
      clearTextDisplay()
    })

    window.electronAPI.onInteractiveInputRequest((request) => {
      showInteractiveInputDialog(request)
    })

    window.electronAPI.onPlaybackWaitRequest(async (requestId) => {
      console.log('[UI] Playback wait request received:', requestId)
      await audioPlayer.waitForPlaybackComplete()
      console.log('[UI] Playback complete, notifying main process:', requestId)
      window.electronAPI.notifyPlaybackComplete(requestId)
    })
  } catch (error: any) {
    console.error('Initialization error:', error)
    setStatus(`Error: ${error.message}`)
    startConversationBtn.disabled = false
  }
}

async function stopConversationStreaming(): Promise<void> {
  try {
    conversationStreamActive = false
    isVoiceListening = false

    if (voiceRecorder.isRecording()) {
      await voiceRecorder.stop()
    }

    await window.electronAPI.stopSpeechStream()
  } catch (error: any) {
    setStatus(`Voice Error: ${error.message}`)
    setOrbMode('idle')
  }
}

async function startConversationStreaming(): Promise<void> {
  if (conversationStreamActive && voiceRecorder.isRecording()) {
    return
  }

  const streamResult = await window.electronAPI.startSpeechStream()
  if (!streamResult.success) {
    throw new Error(streamResult.error || 'Failed to start speech stream')
  }

  await voiceRecorder.start()

  conversationStreamActive = true
  isVoiceListening = true
  setStatus(t('status.listening'))
  setOrbMode('listening')
}

startConversationBtn.addEventListener('click', async () => {
  if (activeMode === 'conversation') {
    await stopConversationStreaming()
    activeMode = null
    updateConversationButton()
    setStatus(t('status.ready'))
    setOrbMode('idle')
    return
  }

  if (!voiceInputEnabled) {
    setStatus(t('status.voiceInputDisabled'))
    return
  }

  if (!await ensureSetupReadyForConversation()) {
    return
  }

  await initialize()

  voiceRecorder.warmup().catch(console.warn)

  activeMode = 'conversation'
  await startConversationStreaming()
  updateConversationButton()
})

async function sendMessage(text: string) {
  if (!text.trim() || !isInitialized) return

  audioPlayer.stop()
  textRevealer.reset()
  setOrbMode('thinking')
  clearTextDisplay()

  try {
    const result = await window.electronAPI.sendText(text, ttsEnabled)

    if (!result.success) {
      throw new Error(result.error)
    }
  } catch (error: any) {
    console.error('Send error:', error)
    setStatus(`Error: ${error.message}`)
    setOrbMode('idle')
  } finally {
    if (activeMode === 'conversation' && conversationStreamActive && voiceInputEnabled) {
      setStatus(t('status.listening'))
    } else {
      setStatus(getReadyStatus())
    }
  }
}

// ========== Context Menu & Settings Panel ==========

const contextMenu = document.getElementById('context-menu')!
const settingsPanel = document.getElementById('settings-panel')!
const settingsClose = document.getElementById('settings-close')!
const mainView = document.getElementById('main-view')!
const settingsNav = document.querySelector('.settings-nav') as HTMLElement
const modelNavItem = document.querySelector('.nav-item[data-section="models"]') as HTMLElement | null
const modelNavLabel = modelNavItem?.querySelector('.nav-label') as HTMLElement | null

let settingsCloseAnimationTimer: number | undefined

let setupReadiness: SetupReadiness = { ready: true, issues: [] }
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement
const volumeValue = document.getElementById('volume-value')!
const voiceInputBtn = document.getElementById('voice-input-btn') as HTMLButtonElement
const voiceOutputToggle = document.getElementById('voice-output-toggle') as HTMLInputElement
const languageSelect = document.getElementById('language-select') as HTMLSelectElement
const personalitySelect = document.getElementById('personality-select') as HTMLSelectElement
const addPersonalityFileBtn = document.getElementById('add-personality-file-btn') as HTMLButtonElement
const pluginsList = document.getElementById('plugins-list') as HTMLElement
let memoryRefreshPromise: Promise<void> | null = null
let cachedPlugins: PluginInfo[] = []

function applySettingsToUI(settings: UISettings) {
  setLanguage(settings.language || 'zh-CN')
  languageSelect.value = currentLanguage
  voiceInputEnabled = settings.voiceInputEnabled
  ttsEnabled = settings.voiceOutputEnabled
  voiceInputBtn.textContent = settings.voiceInputEnabled ? t('common.enabled') : t('common.enable')
  voiceInputBtn.classList.toggle('active', settings.voiceInputEnabled)
  voiceOutputToggle.checked = settings.voiceOutputEnabled
  volumeSlider.value = String(settings.volume)
  volumeValue.textContent = `${settings.volume}%`
  audioPlayer.setVolume(settings.volume)

  startConversationBtn.disabled = !settings.voiceInputEnabled
  updateConversationButton()
}

async function loadSettings(): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  const permission = await window.electronAPI.getMicrophonePermissionStatus()

  if (
    settings.voiceInputEnabled &&
    permission.success &&
    permission.status &&
    permission.status !== 'granted' &&
    permission.status !== 'not-determined'
  ) {
    settings.voiceInputEnabled = false
    await window.electronAPI.updateSettings({ voiceInputEnabled: false })
  }

  applySettingsToUI(settings)
}

async function disableVoiceInput(): Promise<void> {
  const settings = await window.electronAPI.updateSettings({
    voiceInputEnabled: false
  })

  if (voiceRecorder.isRecording()) {
    await voiceRecorder.stop()
    isVoiceListening = false
    conversationStreamActive = false
    await window.electronAPI.stopSpeechStream()
  }

  applySettingsToUI(settings)
  showPanelNotice(t('notice.voiceInputDisabled'))
}

async function enableVoiceInput(): Promise<void> {
  const permissionStatus = await window.electronAPI.getMicrophonePermissionStatus()
  const currentStatus = permissionStatus.success ? permissionStatus.status : undefined

  if (currentStatus !== 'granted') {
    const permission = await window.electronAPI.requestMicrophonePermission()
    if (!permission.success || !permission.granted) {
      setStatus(permission.openedSettings
        ? '请在系统设置中开启麦克风权限'
        : (permission.error || '麦克风权限未授予'))
      return
    }
  }

  const settings = await window.electronAPI.updateSettings({
    voiceInputEnabled: true
  })
  applySettingsToUI(settings)
  showPanelNotice(t('notice.voiceInputEnabled'))
}

async function loadPersonalities(): Promise<void> {
  const result = await window.electronAPI.listPersonalities()
  if (!result.success) {
    showPanelNotice(`人格列表加载失败: ${result.error ?? 'unknown error'}`, 'error')
    return
  }

  personalitySelect.innerHTML = ''
  result.items.forEach((item) => {
    const option = document.createElement('option')
    option.value = item.id
    option.textContent = item.source === 'file'
      ? `${item.name} · 外部文件`
      : item.name
    option.title = item.path
    option.selected = item.id === result.current
    personalitySelect.appendChild(option)
  })
}

// Hide context menu when clicking elsewhere
document.addEventListener('click', () => {
  contextMenu.classList.remove('visible')
})

// Right-click on canvas to show context menu
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault()

  // Position the menu at click location
  const x = Math.min(e.clientX, window.innerWidth - 180)
  const y = Math.min(e.clientY, window.innerHeight - 150)

  contextMenu.style.left = `${x}px`
  contextMenu.style.top = `${y}px`
  contextMenu.classList.add('visible')
})

// Context menu actions
contextMenu.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const item = target.closest('.context-menu-item') as HTMLElement
  if (!item) return

  const action = item.dataset.action

  switch (action) {
    case 'settings':
      openSettings()
      break
    case 'clear-history':
      clearHistory()
      break
  }

  contextMenu.classList.remove('visible')
})

// Open settings panel
function switchSettingsSection(section: string): void {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'))
  document.querySelector(`.nav-item[data-section="${cssEscape(section)}"]`)?.classList.add('active')
  document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'))
  document.getElementById(`section-${section}`)?.classList.add('active')

  if (section === 'memory') {
    void refreshMemorySection()
  }
  if (section === 'system' || section === 'models') {
    void loadSystemConfig()
  }
  if (section === 'plugins') {
    void loadPluginsSection()
  }
}

function openSettings(section?: string) {
  if (settingsCloseAnimationTimer !== undefined) {
    window.clearTimeout(settingsCloseAnimationTimer)
    settingsCloseAnimationTimer = undefined
  }

  window.electronAPI.setCompactWindowMode(false)
  orbAnimationPaused = true
  stopOrbAnimation()
  document.body.classList.add('settings-open')
  settingsPanel.classList.remove('warping-out')
  settingsPanel.classList.add('visible', 'warping-in')
  window.setTimeout(() => {
    settingsPanel.classList.remove('warping-in')
  }, 380)
  mainView.setAttribute('aria-hidden', 'true')
  void refreshSetupReadiness()

  if (section) {
    switchSettingsSection(section)
  } else if (isMemorySectionActive()) {
    void refreshMemorySection()
  }
}

// Close settings panel
function closeSettings() {
  hidePanelNotice()
  settingsPanel.classList.remove('warping-in')
  settingsPanel.classList.add('warping-out')

  if (settingsCloseAnimationTimer !== undefined) {
    window.clearTimeout(settingsCloseAnimationTimer)
  }

  settingsCloseAnimationTimer = window.setTimeout(() => {
    if (document.body.classList.contains('task-active')) {
      window.electronAPI.setTaskWindowMode(true)
    } else {
      window.electronAPI.setCompactWindowMode(true)
    }
    orbAnimationPaused = false
    document.body.classList.remove('settings-open')
    settingsPanel.classList.remove('visible', 'warping-out')
    mainView.removeAttribute('aria-hidden')
    startOrbAnimation()
    settingsCloseAnimationTimer = undefined
  }, 260)
}

function handleSettingsClose(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  closeSettings()
}

settingsClose.addEventListener('pointerdown', handleSettingsClose)
settingsClose.addEventListener('click', handleSettingsClose)

languageSelect.addEventListener('change', async () => {
  const language = languageSelect.value === 'en-US' ? 'en-US' : 'zh-CN'
  setLanguage(language)
  await window.electronAPI.updateSettings({ language })
})

type ConfirmDialogTone = 'danger' | 'default'

type ConfirmDialogOptions = {
  title: string
  message: string
  detail?: string
  confirmText?: string
  cancelText?: string
  tone?: ConfirmDialogTone
}

function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.className = 'confirm-dialog-overlay'
    overlay.setAttribute('role', 'presentation')
    let settled = false

    const tone = options.tone ?? 'default'
    const confirmText = options.confirmText ?? t('common.confirm')
    const cancelText = options.cancelText ?? t('common.cancel')

    overlay.innerHTML = `
      <div class="confirm-dialog ${tone}" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div class="confirm-dialog-icon" aria-hidden="true"></div>
        <div class="confirm-dialog-content">
          <h3 id="confirm-dialog-title">${escapeHtml(options.title)}</h3>
          <p>${escapeHtml(options.message)}</p>
          ${options.detail ? `<div class="confirm-dialog-detail">${escapeHtml(options.detail)}</div>` : ''}
        </div>
        <div class="confirm-dialog-actions">
          <button class="confirm-dialog-btn secondary" type="button" data-confirm-action="cancel">${escapeHtml(cancelText)}</button>
          <button class="confirm-dialog-btn primary" type="button" data-confirm-action="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `

    const cleanup = (value: boolean) => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', handleKeydown, true)
      overlay.classList.add('closing')
      window.setTimeout(() => {
        overlay.remove()
        resolve(value)
      }, 120)
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cleanup(false)
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        cleanup(true)
      }
    }

    overlay.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest<HTMLButtonElement>('[data-confirm-action]')?.dataset.confirmAction
      if (action === 'confirm') {
        cleanup(true)
      } else if (action === 'cancel' || target === overlay) {
        cleanup(false)
      }
    })

    document.body.appendChild(overlay)
    document.addEventListener('keydown', handleKeydown, true)
    requestAnimationFrame(() => {
      overlay.classList.add('visible')
      overlay.querySelector<HTMLButtonElement>('[data-confirm-action="cancel"]')?.focus({ preventScroll: true })
    })
  })
}

type InteractiveInputRequest = {
  id: string
  key?: string
  groupKey?: string
  groupLabel?: string
  itemKey?: string
  itemLabel?: string
  label: string
  description?: string
  placeholder?: string
  inputKind: 'text' | 'password' | 'textarea' | 'code'
  persistence: 'temporary' | 'persistent'
  sensitivity: 'normal' | 'secret' | 'verification'
}

function showInteractiveInputDialog(request: InteractiveInputRequest): void {
  const overlay = document.createElement('div')
  overlay.className = 'confirm-dialog-overlay interactive-input-overlay'
  overlay.setAttribute('role', 'presentation')

  const inputTag = request.inputKind === 'textarea'
    ? `<textarea class="interactive-input-control" rows="4" placeholder="${escapeHtml(request.placeholder ?? '')}"></textarea>`
    : `<input class="interactive-input-control" type="${request.inputKind === 'password' ? 'password' : 'text'}" placeholder="${escapeHtml(request.placeholder ?? '')}" autocomplete="off" />`

  overlay.innerHTML = `
    <div class="confirm-dialog interactive-input-dialog" role="dialog" aria-modal="true" aria-labelledby="interactive-input-title">
      <button class="interactive-input-close" type="button" data-input-action="cancel" aria-label="${escapeHtml(t('common.cancel'))}">×</button>
      <div class="confirm-dialog-content">
        <h3 id="interactive-input-title">${escapeHtml(request.label)}</h3>
        ${request.description ? `<p>${escapeHtml(request.description)}</p>` : ''}
        <div class="interactive-input-meta">
          ${request.sensitivity === 'verification' ? t('inputMeta.verification') : request.persistence === 'persistent' ? t('inputMeta.persistent') : t('inputMeta.currentOnly')}
        </div>
        ${inputTag}
      </div>
      <div class="confirm-dialog-actions">
        <button class="confirm-dialog-btn primary" type="button" data-input-action="submit">${escapeHtml(t('common.continue'))}</button>
      </div>
    </div>
  `

  const submitResponse = async (cancelled: boolean) => {
    const input = overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>('.interactive-input-control')
    await window.electronAPI.submitInteractiveInput(request.id, {
      value: cancelled ? '' : input?.value.trim() ?? '',
      remembered: request.persistence === 'persistent' && request.sensitivity !== 'verification',
      cancelled
    })
    overlay.classList.add('closing')
    window.setTimeout(() => overlay.remove(), 120)
  }

  overlay.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const action = target.closest<HTMLButtonElement>('[data-input-action]')?.dataset.inputAction
    if (action === 'submit') {
      void submitResponse(false)
    } else if (action === 'cancel') {
      void submitResponse(true)
    }
  })

  const handleKeydown = (event: KeyboardEvent) => {
    if (!document.body.contains(overlay)) {
      document.removeEventListener('keydown', handleKeydown, true)
      return
    }
    if (event.key === 'Enter' && request.inputKind !== 'textarea') {
      event.preventDefault()
      void submitResponse(false)
    }
  }

  document.body.appendChild(overlay)
  document.addEventListener('keydown', handleKeydown, true)
  requestAnimationFrame(() => {
    overlay.classList.add('visible')
    overlay.querySelector<HTMLInputElement | HTMLTextAreaElement>('.interactive-input-control')?.focus({ preventScroll: true })
  })
}

// Close settings with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.querySelector('.confirm-dialog-overlay')) {
      return
    }
    if (settingsPanel.classList.contains('visible')) {
      closeSettings()
    }
  }
})

let isNavDragging = false
let navDragStartX = 0
let navDragStartY = 0
let navMouseDownTarget: HTMLElement | null = null
let navTotalMovement = 0

settingsNav.addEventListener('mousedown', (e) => {
  isNavDragging = true
  navDragStartX = e.screenX
  navDragStartY = e.screenY
  navMouseDownTarget = e.target as HTMLElement
  navTotalMovement = 0
  settingsNav.style.cursor = 'grabbing'
})

settingsNav.addEventListener('mousemove', (e) => {
  if (isNavDragging) {
    const deltaX = e.screenX - navDragStartX
    const deltaY = e.screenY - navDragStartY
    navDragStartX = e.screenX
    navDragStartY = e.screenY
    navTotalMovement += Math.abs(deltaX) + Math.abs(deltaY)
    window.electronAPI.moveWindow(deltaX, deltaY)
  }
})

settingsNav.addEventListener('mouseup', (e) => {
  if (isNavDragging) {
    isNavDragging = false
    settingsNav.style.cursor = ''

    if (navTotalMovement < 5 && navMouseDownTarget) {
      const navItem = navMouseDownTarget.closest('.nav-item') as HTMLElement
      if (navItem) {
        const section = navItem.dataset.section
        if (section) {
          switchSettingsSection(section)
        }
      }
    }
    navMouseDownTarget = null
  }
})

settingsNav.addEventListener('mouseleave', () => {
})

document.addEventListener('mouseup', () => {
  if (isNavDragging) {
    isNavDragging = false
    settingsNav.style.cursor = ''
    navMouseDownTarget = null
  }
})

document.addEventListener('mousemove', (e) => {
  if (isNavDragging) {
    const deltaX = e.screenX - navDragStartX
    const deltaY = e.screenY - navDragStartY
    navDragStartX = e.screenX
    navDragStartY = e.screenY
    navTotalMovement += Math.abs(deltaX) + Math.abs(deltaY)
    window.electronAPI.moveWindow(deltaX, deltaY)
  }
})

// Volume slider
volumeSlider.addEventListener('input', () => {
  const value = Number(volumeSlider.value)
  volumeValue.textContent = `${value}%`
  audioPlayer.setVolume(value)
  void window.electronAPI.updateSettings({ volume: value })
})

voiceInputBtn.addEventListener('click', async () => {
  voiceInputBtn.disabled = true

  try {
    if (voiceInputEnabled) {
      await disableVoiceInput()
    } else {
      await enableVoiceInput()
    }
  } finally {
    voiceInputBtn.disabled = false
  }
})

voiceOutputToggle.addEventListener('change', async () => {
  const settings = await window.electronAPI.updateSettings({
    voiceOutputEnabled: voiceOutputToggle.checked
  })
  applySettingsToUI(settings)
  if (!settings.voiceOutputEnabled) {
    await window.electronAPI.stopTTS()
    audioPlayer.stop()
  }
  showPanelNotice(settings.voiceOutputEnabled ? '语音输出已开启' : '语音输出已关闭')
})

personalitySelect.addEventListener('change', async () => {
  const selected = personalitySelect.value
  const result = await window.electronAPI.setPersonality(selected)
  if (!result.success) {
    showPanelNotice(`人格切换失败: ${result.error}`, 'error')
    return
  }

  await loadSettings()
  showPanelNotice(`人格已切换为 ${personalitySelect.selectedOptions[0]?.textContent ?? selected}`)
})

async function loadPluginsSection(): Promise<void> {
  pluginsList.innerHTML = '<div class="profile-loading">加载中...</div>'

  const result = await window.electronAPI.listPlugins()
  if (!result.success) {
    pluginsList.innerHTML = `<div class="profile-loading">插件加载失败: ${escapeHtml(result.error ?? 'unknown error')}</div>`
    return
  }

  renderPluginsSection(result.plugins)
}

function renderPluginsSection(plugins: PluginInfo[]): void {
  cachedPlugins = plugins
  if (plugins.length === 0) {
    pluginsList.innerHTML = '<div class="profile-loading">未发现插件</div>'
    return
  }

  pluginsList.innerHTML = plugins.map(plugin => `
    <div class="plugin-card plugin-card-list" data-plugin-id="${escapeHtml(plugin.id)}">
      <div class="plugin-card-main">
        <div class="plugin-info">
          <div class="plugin-title-row">
            <span class="plugin-name">${escapeHtml(plugin.name)}</span>
            ${plugin.version ? `<span class="plugin-version">v${escapeHtml(plugin.version)}</span>` : ''}
          </div>
          <div class="plugin-id">${escapeHtml(plugin.id)}</div>
          ${plugin.description ? `<div class="plugin-description">${escapeHtml(plugin.description)}</div>` : ''}
        </div>
        <label class="settings-toggle plugin-toggle">
          <input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin-toggle="${escapeHtml(plugin.id)}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="plugin-card-footer">
        <span>${plugin.configSchema.length ? `${plugin.configSchema.length} 个参数` : '无可配置参数'}</span>
        ${plugin.uiSurfaces.length ? `<span>${plugin.uiSurfaces.length} 个界面 hook</span>` : ''}
        <span class="plugin-enter">管理</span>
      </div>
    </div>
  `).join('')

  pluginsList.querySelectorAll<HTMLElement>('.plugin-card-list').forEach(card => {
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('.plugin-toggle')) {
        return
      }
      const pluginId = card.dataset.pluginId
      const plugin = cachedPlugins.find(item => item.id === pluginId)
      if (plugin) {
        renderPluginDetail(plugin)
      }
    })
  })

  pluginsList.querySelectorAll<HTMLInputElement>('input[data-plugin-toggle]').forEach(input => {
    input.addEventListener('click', (event) => {
      event.stopPropagation()
    })
    input.addEventListener('change', async (event) => {
      event.stopPropagation()
      const pluginId = input.dataset.pluginToggle
      if (!pluginId) return

      input.disabled = true
      try {
        const settings = await window.electronAPI.getSettings()
        const nextPlugins = {
          ...(settings.plugins ?? {}),
          [pluginId]: input.checked,
        }
        await window.electronAPI.updateSettings({ plugins: nextPlugins })
        await loadPluginUISurfaces()
        showPanelNotice(input.checked ? '插件已启用' : '插件已禁用')
      } catch (error: any) {
        input.checked = !input.checked
        showPanelNotice(`插件设置失败: ${error.message}`, 'error')
      } finally {
        input.disabled = false
      }
    })
  })

  bindPluginConfigInputs()
}

function renderPluginDetail(plugin: PluginInfo): void {
  pluginsList.innerHTML = `
    <div class="plugin-detail-header">
      <button class="plugin-back-btn" type="button">返回</button>
      <div class="plugin-detail-title">
        <span class="plugin-name">${escapeHtml(plugin.name)}</span>
        ${plugin.version ? `<span class="plugin-version">v${escapeHtml(plugin.version)}</span>` : ''}
      </div>
    </div>
    <div class="plugin-card plugin-detail-card" data-plugin-id="${escapeHtml(plugin.id)}">
      <div class="plugin-card-main">
        <div class="plugin-info">
          <div class="plugin-id">${escapeHtml(plugin.id)}</div>
          ${plugin.description ? `<div class="plugin-description plugin-detail-description">${escapeHtml(plugin.description)}</div>` : ''}
          ${plugin.uiSurfaces.length ? `<div class="plugin-permissions">${plugin.uiSurfaces.map(surface => `<span>UI: ${escapeHtml(surface.slot)} / ${escapeHtml(surface.mode)}</span>`).join('')}</div>` : ''}
          ${plugin.permissions.length ? `<div class="plugin-permissions">${plugin.permissions.map(permission => `<span>${escapeHtml(permission)}</span>`).join('')}</div>` : ''}
        </div>
        <label class="settings-toggle plugin-toggle">
          <input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin-toggle="${escapeHtml(plugin.id)}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      ${renderPluginConfigFields(plugin)}
    </div>
    ${renderPluginAdminContainer(plugin)}
  `

  pluginsList.querySelector<HTMLButtonElement>('.plugin-back-btn')?.addEventListener('click', () => {
    renderPluginsSection(cachedPlugins)
  })

  pluginsList.querySelector<HTMLInputElement>('input[data-plugin-toggle]')?.addEventListener('change', async (event) => {
    const input = event.currentTarget as HTMLInputElement
    const pluginId = input.dataset.pluginToggle
    if (!pluginId) return

    input.disabled = true
    try {
      const settings = await window.electronAPI.getSettings()
      const nextPlugins = {
        ...(settings.plugins ?? {}),
        [pluginId]: input.checked,
      }
      await window.electronAPI.updateSettings({ plugins: nextPlugins })
      const target = cachedPlugins.find(item => item.id === pluginId)
      if (target) {
        target.enabled = input.checked
      }
      await loadPluginUISurfaces()
      showPanelNotice(input.checked ? '插件已启用' : '插件已禁用')
    } catch (error: any) {
      input.checked = !input.checked
      showPanelNotice(`插件设置失败: ${error.message}`, 'error')
    } finally {
      input.disabled = false
    }
  })

  bindPluginConfigInputs()
  loadPluginAdminPanel(plugin)
}

function renderPluginAdminContainer(plugin: PluginInfo): string {
  if (plugin.id !== 'mcp-manager' && plugin.id !== 'skills-manager' && !plugin.adminSchema) {
    return ''
  }

  return `
    <div class="plugin-card plugin-admin-card" data-plugin-admin="${escapeHtml(plugin.id)}">
      <div class="plugin-admin-loading">加载管理信息...</div>
    </div>
  `
}

async function loadPluginAdminPanel(plugin: PluginInfo): Promise<void> {
  if (plugin.id !== 'mcp-manager' && plugin.id !== 'skills-manager' && !plugin.adminSchema) {
    return
  }

  const container = pluginsList.querySelector<HTMLElement>(`[data-plugin-admin="${cssEscape(plugin.id)}"]`)
  if (!container) return

  const result = await window.electronAPI.pluginAdminAction(plugin.id, 'state')
  if (!result.success) {
    container.innerHTML = `<div class="plugin-admin-loading">管理信息加载失败: ${escapeHtml(result.error ?? 'unknown error')}</div>`
    return
  }

  if (plugin.id === 'mcp-manager') {
    renderMCPAdmin(container, plugin, result.state as any)
  } else if (plugin.id === 'skills-manager') {
    renderSkillsAdmin(container, plugin, result.state as any)
  } else {
    renderGenericPluginAdmin(container, plugin, result.state)
  }
}

function renderGenericPluginAdmin(container: HTMLElement, plugin: PluginInfo, state: unknown): void {
  const schema = plugin.adminSchema
  if (!schema) {
    container.innerHTML = '<div class="plugin-admin-empty">这个插件没有声明管理面板。</div>'
    return
  }

  const actions = schema.actions ?? []
  container.innerHTML = `
    <div class="plugin-admin-header">
      <div>
        <div class="plugin-admin-title">${escapeHtml(schema.title || '插件管理')}</div>
        ${schema.description ? `<div class="plugin-admin-subtitle">${escapeHtml(schema.description)}</div>` : ''}
      </div>
    </div>
    ${actions.length ? `
      <div class="plugin-admin-actions">
        ${actions.map(action => `
          <button class="plugin-admin-button ${escapeHtml(action.variant || 'secondary')}" type="button" data-generic-admin-action="${escapeHtml(action.id)}">
            ${escapeHtml(action.label)}
          </button>
          ${action.description ? `<div class="plugin-admin-desc">${escapeHtml(action.description)}</div>` : ''}
        `).join('')}
      </div>
    ` : '<div class="plugin-admin-empty">暂无管理动作。</div>'}
    <pre class="plugin-admin-state">${escapeHtml(JSON.stringify(state ?? {}, null, 2))}</pre>
  `

  container.querySelectorAll<HTMLButtonElement>('[data-generic-admin-action]').forEach(button => {
    button.addEventListener('click', async () => {
      const action = button.dataset.genericAdminAction
      if (!action) return
      button.disabled = true
      try {
        await runPluginAdminAction(plugin, action)
      } finally {
        button.disabled = false
      }
    })
  })
}

async function runPluginAdminAction(
  plugin: PluginInfo,
  action: string,
  payload?: unknown,
  options: { refresh?: boolean; silent?: boolean } = {}
): Promise<any | null> {
  const result = await window.electronAPI.pluginAdminAction(plugin.id, action, payload)
  if (!result.success) {
    if (!options.silent) {
      showPanelNotice(`插件操作失败: ${result.error ?? 'unknown error'}`, 'error')
    }
    return null
  }
  if (!options.silent) {
    showPanelNotice('插件操作已完成')
  }
  if (options.refresh !== false) {
    await loadPluginAdminPanel(plugin)
  }
  return result.result
}

function renderMCPAdmin(container: HTMLElement, plugin: PluginInfo, state: any): void {
  const servers = Array.isArray(state?.servers) ? state.servers : []
  container.innerHTML = `
    <div class="plugin-admin-header">
      <div>
        <div class="plugin-admin-title">远程 MCP Servers</div>
        <div class="plugin-admin-subtitle">只管理远程 MCP HTTP endpoint，不启动本地命令。</div>
      </div>
    </div>
    <div class="plugin-admin-form">
      <input class="plugin-config-input" data-mcp-field="id" placeholder="id，例如 github" />
      <input class="plugin-config-input" data-mcp-field="name" placeholder="名称，可选" />
      <input class="plugin-config-input plugin-admin-wide-input" data-mcp-field="url" placeholder="https://example.com/mcp" />
      <textarea class="plugin-config-input plugin-config-textarea" data-mcp-field="headers" rows="3" placeholder='Headers JSON，可选，例如 {"authorization":"Bearer ..."}'></textarea>
      <button class="plugin-admin-button" type="button" data-mcp-action="add">添加远程 MCP</button>
    </div>
    <div class="plugin-admin-list">
      ${servers.length ? servers.map((server: any) => `
        <div class="plugin-admin-item" data-server-id="${escapeHtml(server.id)}">
          <div class="plugin-admin-item-main">
            <div class="plugin-admin-item-title">${escapeHtml(server.name || server.id)}</div>
            <div class="plugin-admin-item-meta">${escapeHtml(server.id)} · ${escapeHtml(server.url || '')}</div>
          </div>
          <label class="settings-toggle plugin-config-toggle">
            <input type="checkbox" ${server.enabled ? 'checked' : ''} data-mcp-action="toggle" />
            <span class="toggle-slider"></span>
          </label>
          <button class="plugin-admin-button secondary" type="button" data-mcp-action="test">测试</button>
          <button class="plugin-admin-button danger" type="button" data-mcp-action="remove">删除</button>
        </div>
      `).join('') : '<div class="plugin-admin-empty">暂无远程 MCP server。</div>'}
    </div>
  `

  container.querySelector<HTMLButtonElement>('[data-mcp-action="add"]')?.addEventListener('click', async () => {
    const id = readAdminField(container, 'mcp', 'id')
    const url = readAdminField(container, 'mcp', 'url')
    const name = readAdminField(container, 'mcp', 'name')
    const headersText = readAdminField(container, 'mcp', 'headers')
    let headers = {}
    if (headersText.trim()) {
      try {
        headers = JSON.parse(headersText)
      } catch {
        showPanelNotice('Headers 必须是合法 JSON', 'error')
        return
      }
    }
    await runPluginAdminAction(plugin, 'upsertServer', { id, name, url, headers, enabled: true })
  })

  bindMCPAdminItemActions(container, plugin)
}

function bindMCPAdminItemActions(container: HTMLElement, plugin: PluginInfo): void {
  container.querySelectorAll<HTMLElement>('.plugin-admin-item').forEach(item => {
    const serverId = item.dataset.serverId
    if (!serverId) return

    item.querySelector<HTMLInputElement>('[data-mcp-action="toggle"]')?.addEventListener('change', async (event) => {
      await runPluginAdminAction(plugin, 'setServerEnabled', {
        serverId,
        enabled: (event.currentTarget as HTMLInputElement).checked,
      })
    })
    item.querySelector<HTMLButtonElement>('[data-mcp-action="test"]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget as HTMLButtonElement
      await runMCPTestAction(plugin, serverId, button)
    })
    item.querySelector<HTMLButtonElement>('[data-mcp-action="remove"]')?.addEventListener('click', async () => {
      await runPluginAdminAction(plugin, 'removeServer', { serverId })
    })
  })
}

async function runMCPTestAction(plugin: PluginInfo, serverId: string, button: HTMLButtonElement): Promise<void> {
  const originalText = button.textContent || '测试'
  button.disabled = true
  button.textContent = '测试中...'
  button.classList.remove('danger')
  button.classList.add('testing')

  const result = await window.electronAPI.pluginAdminAction(plugin.id, 'testServer', { serverId })
  button.classList.remove('testing')

  if (!result.success) {
    button.textContent = '测试失败'
    button.classList.add('danger')
  } else {
    const tools = Array.isArray((result.result as any)?.tools) ? (result.result as any).tools.length : 0
    button.textContent = `${tools} tools`
    button.classList.add('success')
  }

  window.setTimeout(() => {
    button.disabled = false
    button.textContent = originalText
    button.classList.remove('success', 'danger', 'testing')
  }, 1800)
}

function renderSkillsAdmin(container: HTMLElement, plugin: PluginInfo, state: any): void {
  const sources = Array.isArray(state?.sources) ? state.sources : []
  const skills = Array.isArray(state?.skills) ? state.skills : []
  container.innerHTML = `
    <div class="plugin-admin-header">
      <div>
        <div class="plugin-admin-title">Skills Sources</div>
        <div class="plugin-admin-subtitle">从 GitHub 或本地目录导入 SKILL.md。</div>
      </div>
    </div>
    <div class="plugin-admin-form">
      <input class="plugin-config-input plugin-admin-wide-input" data-skill-field="githubUrl" placeholder="GitHub URL，例如 https://github.com/user/repo" />
      <button class="plugin-admin-button" type="button" data-skill-action="add-github">添加 GitHub Source</button>
      <input class="plugin-config-input plugin-admin-wide-input" data-skill-field="localPath" placeholder="本地 skills 目录路径" />
      <button class="plugin-admin-button secondary" type="button" data-skill-action="add-local">添加本地目录</button>
    </div>
    <div class="plugin-admin-section-title">Sources</div>
    <div class="plugin-admin-list">
      ${sources.length ? sources.map((source: any) => `
        <div class="plugin-admin-item" data-source-id="${escapeHtml(source.id)}" data-source-type="${escapeHtml(source.type)}">
          <div class="plugin-admin-item-main">
            <button class="plugin-admin-expand" type="button" data-skill-action="expand" aria-expanded="false"></button>
            <div class="plugin-admin-source-text">
              <div class="plugin-admin-item-title">${escapeHtml(source.id)}</div>
              <div class="plugin-admin-item-meta">
                ${escapeHtml(source.type)} · ${skillsForSource(skills, source).length} skills · ${escapeHtml(source.url || source.path || '')}
              </div>
            </div>
          </div>
          <label class="settings-toggle plugin-config-toggle">
            <input type="checkbox" ${source.enabled ? 'checked' : ''} data-skill-action="toggle" />
            <span class="toggle-slider"></span>
          </label>
          ${source.type === 'github' ? '<button class="plugin-admin-button secondary" type="button" data-skill-action="rescan">更新</button>' : ''}
          <button class="plugin-admin-button danger" type="button" data-skill-action="remove">删除</button>
          <div class="plugin-admin-source-skills" hidden>
            ${renderSourceSkills(skillsForSource(skills, source))}
          </div>
        </div>
      `).join('') : '<div class="plugin-admin-empty">暂无 skill source。</div>'}
    </div>
  `

  container.querySelector<HTMLButtonElement>('[data-skill-action="add-github"]')?.addEventListener('click', async () => {
    await runPluginAdminAction(plugin, 'addGithubSource', {
      url: readAdminField(container, 'skill', 'githubUrl'),
      enabled: true,
    })
  })
  container.querySelector<HTMLButtonElement>('[data-skill-action="add-local"]')?.addEventListener('click', async () => {
    await runPluginAdminAction(plugin, 'addLocalSource', {
      path: readAdminField(container, 'skill', 'localPath'),
      enabled: true,
    })
  })

  bindSkillsAdminItemActions(container, plugin)
}

function bindSkillsAdminItemActions(container: HTMLElement, plugin: PluginInfo): void {
  container.querySelectorAll<HTMLElement>('.plugin-admin-item').forEach(item => {
    const sourceId = item.dataset.sourceId
    if (!sourceId) return
    item.querySelector<HTMLInputElement>('[data-skill-action="toggle"]')?.addEventListener('change', async (event) => {
      await runPluginAdminAction(plugin, 'setSourceEnabled', {
        sourceId,
        enabled: (event.currentTarget as HTMLInputElement).checked,
      })
    })
    item.querySelector<HTMLButtonElement>('[data-skill-action="rescan"]')?.addEventListener('click', async () => {
      await runPluginAdminAction(plugin, 'rescanGithubSource', { sourceId })
    })
    item.querySelector<HTMLButtonElement>('[data-skill-action="remove"]')?.addEventListener('click', async () => {
      await runPluginAdminAction(plugin, 'removeSource', { sourceId })
    })
    item.querySelector<HTMLButtonElement>('[data-skill-action="expand"]')?.addEventListener('click', (event) => {
      const button = event.currentTarget as HTMLButtonElement
      const skillsPanel = item.querySelector<HTMLElement>('.plugin-admin-source-skills')
      const expanded = button.getAttribute('aria-expanded') === 'true'
      button.setAttribute('aria-expanded', String(!expanded))
      item.classList.toggle('plugin-admin-item-expanded', !expanded)
      if (skillsPanel) {
        skillsPanel.hidden = expanded
      }
    })
  })
}

function skillsForSource(skills: any[], source: any): any[] {
  return skills.filter(skill => {
    if (skill.sourceId) {
      return skill.sourceId === source.id
    }
    return skill.source === source.type && String(skill.path || '').startsWith(String(source.path || ''))
  })
}

function renderSourceSkills(skills: any[]): string {
  if (!skills.length) {
    return '<div class="plugin-admin-empty">这个 source 下没有扫描到 SKILL.md。</div>'
  }

  return skills.map((skill: any) => `
    <div class="plugin-admin-skill">
      <div class="plugin-admin-item-title">${escapeHtml(skill.name || skill.id)}</div>
      <div class="plugin-admin-item-meta">${escapeHtml(skill.id)}${skill.path ? ` · ${escapeHtml(skill.path)}` : ''}</div>
      ${skill.description ? `<div class="plugin-admin-desc">${escapeHtml(skill.description)}</div>` : ''}
    </div>
  `).join('')
}

function readAdminField(container: HTMLElement, scope: string, field: string): string {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `[data-${scope}-field="${cssEscape(field)}"]`
  )?.value.trim() ?? ''
}

function bindPluginConfigInputs(): void {
  pluginsList.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input[data-plugin-config], select[data-plugin-config], textarea[data-plugin-config]'
  ).forEach(input => {
    input.addEventListener('change', async () => {
      const pluginId = input.dataset.pluginId
      const key = input.dataset.pluginConfig
      const type = input.dataset.pluginType
      if (!pluginId || !key || !type) return

      input.disabled = true
      try {
        const settings = await window.electronAPI.getSettings()
        const currentPluginConfig = settings.pluginConfigs?.[pluginId] ?? {}
        const nextPluginConfigs = {
          ...(settings.pluginConfigs ?? {}),
          [pluginId]: {
            ...currentPluginConfig,
            [key]: readPluginConfigValue(input, type),
          },
        }
        await window.electronAPI.updateSettings({ pluginConfigs: nextPluginConfigs })
        const target = cachedPlugins.find(item => item.id === pluginId)
        if (target) {
          target.config = nextPluginConfigs[pluginId]
        }
        await loadPluginUISurfaces()
        showPanelNotice('插件参数已更新')
      } catch (error: any) {
        showPanelNotice(`插件参数保存失败: ${error.message}`, 'error')
      } finally {
        input.disabled = false
      }
    })
  })

  pluginsList.querySelectorAll<HTMLButtonElement>('.plugin-number-step').forEach(button => {
    button.addEventListener('click', () => {
      const pluginId = button.dataset.pluginId
      const key = button.dataset.pluginConfig
      const direction = button.dataset.stepDir
      if (!pluginId || !key) return

      const input = pluginsList.querySelector<HTMLInputElement>(
        `input[data-plugin-id="${cssEscape(pluginId)}"][data-plugin-config="${cssEscape(key)}"]`
      )
      if (!input) return

      if (direction === 'up') {
        input.stepUp()
      } else {
        input.stepDown()
      }
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
  })
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

function renderPluginConfigFields(plugin: PluginInfo): string {
  if (!plugin.configSchema.length) {
    return ''
  }

  return `
    <div class="plugin-config-fields">
      ${plugin.configSchema.map(field => renderPluginConfigField(plugin, field)).join('')}
    </div>
  `
}

function renderPluginConfigField(plugin: PluginInfo, field: PluginConfigField): string {
  const rawValue = plugin.config[field.key] ?? field.default
  const label = escapeHtml(field.label ?? field.key)
  const desc = field.description
    ? `<div class="plugin-config-desc">${escapeHtml(field.description)}</div>`
    : ''
  const commonAttrs = `data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" data-plugin-type="${field.type}"`

  let control = ''
  if (field.type === 'boolean') {
    control = `
      <label class="settings-toggle plugin-config-toggle">
        <input type="checkbox" ${rawValue === true ? 'checked' : ''} ${commonAttrs} />
        <span class="toggle-slider"></span>
      </label>
    `
  } else if (field.type === 'number') {
    control = `
      <div class="plugin-number-control">
        <input class="plugin-config-input plugin-config-number" type="number" value="${escapeHtml(String(rawValue ?? ''))}" ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.max !== undefined ? `max="${field.max}"` : ''} ${field.step !== undefined ? `step="${field.step}"` : ''} ${commonAttrs} />
        <div class="plugin-number-stepper">
          <button class="plugin-number-step" type="button" data-step-dir="up" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" tabindex="-1" title="增加"></button>
          <button class="plugin-number-step" type="button" data-step-dir="down" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" tabindex="-1" title="减少"></button>
        </div>
      </div>
    `
  } else if (field.type === 'select') {
    control = `
      <select class="plugin-config-input" ${commonAttrs}>
        ${field.options.map(option => `
          <option value="${escapeHtml(option.value)}" ${option.value === rawValue ? 'selected' : ''}>${escapeHtml(option.label)}</option>
        `).join('')}
      </select>
    `
  } else if (field.type === 'string' && field.multiline) {
    control = `<textarea class="plugin-config-input plugin-config-textarea" rows="${field.rows ?? 5}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs}>${escapeHtml(String(rawValue ?? ''))}</textarea>`
  } else {
    control = `<input class="plugin-config-input" type="text" value="${escapeHtml(String(rawValue ?? ''))}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs} />`
  }

  return `
    <div class="plugin-config-row ${field.type === 'string' && field.multiline ? 'plugin-config-row-multiline' : ''}">
      <div class="plugin-config-meta">
        <div class="plugin-config-label">${label}</div>
        ${desc}
      </div>
      ${control}
    </div>
  `
}

function readPluginConfigValue(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  type: string
): unknown {
  if (type === 'boolean') {
    return (input as HTMLInputElement).checked
  }
  if (type === 'number') {
    return Number(input.value)
  }
  return input.value
}

addPersonalityFileBtn.addEventListener('click', async () => {
  const result = await window.electronAPI.addPersonalityFile()
  if (result.canceled) {
    return
  }

  if (!result.success || !result.item) {
    showPanelNotice(`添加角色失败: ${result.error ?? 'unknown error'}`, 'error')
    return
  }

  await loadPersonalities()
  personalitySelect.value = result.item.id
  const setResult = await window.electronAPI.setPersonality(result.item.id)
  if (!setResult.success) {
    showPanelNotice(`人格切换失败: ${setResult.error}`, 'error')
    return
  }

  showPanelNotice(`已添加并切换为 ${result.item.name}`)
})

// ========== Section Clear Buttons ==========

// Clear profile button
const clearProfileBtn = document.getElementById('clear-profile-btn')
clearProfileBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空用户画像',
    message: '将移除 EVA 已整理的个人信息、偏好和标签。',
    detail: '之后可以通过新的对话重新建立画像。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearProfile()
    if (!result.success) {
      throw new Error(result.error)
    }
    showPanelNotice('用户画像已清空')
    await loadUserProfile()
  } catch (error: any) {
    console.error('Clear profile error:', error)
  }
})

// Clear memories button
const clearMemoriesBtn = document.getElementById('clear-memories-btn')
clearMemoriesBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空重要记忆',
    message: '将删除所有被标记为重要的长期记忆。',
    detail: '这个操作不会影响用户画像和对话摘要。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearImportantMemories()
    if (!result.success) {
      throw new Error(result.error)
    }
    showPanelNotice('重要记忆已清空')
    await loadImportantMemories()
  } catch (error: any) {
    console.error('Clear memories error:', error)
  }
})

// Clear summaries button
const clearSummariesBtn = document.getElementById('clear-summaries-btn')
clearSummariesBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空对话摘要',
    message: '将删除已压缩保存的历史对话摘要。',
    detail: '最近对话和用户画像不会被同时清空。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearConversationSummaries()
    if (!result.success) {
      throw new Error(result.error)
    }
    showPanelNotice('对话摘要已清空')
    await loadConversationSummaries()
  } catch (error: any) {
    console.error('Clear summaries error:', error)
  }
})

// Clear conversations button
const clearConversationsBtn = document.getElementById('clear-conversations-btn')
clearConversationsBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空最近对话',
    message: '将清空当前工作记忆里的最近对话记录。',
    detail: 'EVA 会从新的上下文重新开始对话。',
    confirmText: '清空',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearWorkingMemory()
    if (!result.success) {
      throw new Error(result.error)
    }
    clearTextDisplay()
    showPanelNotice('最近对话已清空')
    await loadWorkingMemory()
  } catch (error: any) {
    console.error('Clear conversations error:', error)
  }
})

// Reset all button
const resetAllBtn = document.getElementById('reset-all-btn')
resetAllBtn?.addEventListener('click', async () => {
  await clearHistory()
})

async function clearHistory(): Promise<void> {
  const confirmed = await showConfirmDialog({
    title: '重置所有记忆',
    message: '将清除用户画像、重要记忆、账户信息、对话摘要和最近对话。',
    detail: '此操作不可恢复。',
    confirmText: '全部重置',
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearHistory()
    if (!result.success) {
      throw new Error(result.error)
    }
    clearTextDisplay()
    showPanelNotice('所有数据已重置')
    await refreshMemorySection()
  } catch (error: any) {
    console.error('Reset all error:', error)
  }
}

// ========== Memory Management ==========

const profileContent = document.getElementById('profile-content')!
const importantMemoriesContent = document.getElementById('important-memories-content')!
const summariesContent = document.getElementById('summaries-content')!
const conversationsContent = document.getElementById('conversations-content')!
const accountInputsContent = document.getElementById('account-inputs-content')!
const profileCount = document.getElementById('profile-count')!
const importantMemoriesCount = document.getElementById('important-memories-count')!
const summariesCount = document.getElementById('summaries-count')!
const conversationsCount = document.getElementById('conversations-count')!
const accountInputsCount = document.getElementById('account-inputs-count')!
const accountInputsPageCount = document.getElementById('account-inputs-page-count')!
const memoryOverviewPage = document.getElementById('memory-overview-page')!
const memoryAccountPage = document.getElementById('memory-account-page')!
const openAccountInputsBtn = document.getElementById('open-account-inputs-btn') as HTMLButtonElement
const backMemoryOverviewBtn = document.getElementById('back-memory-overview-btn') as HTMLButtonElement
const clearAccountInputsBtn = document.getElementById('clear-account-inputs-btn') as HTMLButtonElement

type UserProfile = {
  basic: {
    name?: string
    nickname?: string
    age?: number
    gender?: string
    location?: string
    occupation?: string
  }
  personality?: string[]
  interests?: string[]
  importantMemories?: Record<string, string>
  lastUpdated?: number
}

type AccountInput = {
  key: string
  groupKey?: string
  groupLabel?: string
  itemKey?: string
  itemLabel?: string
  label: string
  value: string
  sensitivity: string
  scope: string
  updatedAt: number
}

let currentProfile: UserProfile | null = null
let currentAccountInputs: AccountInput[] = []

function isMemorySectionActive(): boolean {
  return document.getElementById('section-memory')?.classList.contains('active') === true
}

function switchMemoryPage(page: 'overview' | 'accounts'): void {
  memoryOverviewPage.classList.toggle('active', page === 'overview')
  memoryAccountPage.classList.toggle('active', page === 'accounts')
  if (page === 'accounts') {
    void loadAccountInputs()
  }
}

async function refreshMemorySection(): Promise<void> {
  if (memoryRefreshPromise) {
    return memoryRefreshPromise
  }

  setMemoryLoadingState()
  memoryRefreshPromise = Promise.all([
    loadUserProfile(),
    loadImportantMemories(),
    loadConversationSummaries(),
    loadWorkingMemory(),
    loadAccountInputs()
  ]).then(() => undefined).finally(() => {
    memoryRefreshPromise = null
  })

  return memoryRefreshPromise
}

function setMemoryLoadingState(): void {
  profileCount.textContent = '加载中'
  importantMemoriesCount.textContent = '加载中'
  summariesCount.textContent = '加载中'
  conversationsCount.textContent = '加载中'
  accountInputsCount.textContent = '加载中'
  accountInputsPageCount.textContent = '加载中'
  profileContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
  importantMemoriesContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
  summariesContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
  conversationsContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
  accountInputsContent.innerHTML = '<div class="profile-loading"><span class="loading-spinner"></span>加载中...</div>'
}

async function loadUserProfile(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      throw new Error(result.error || '用户画像返回为空')
    }

    currentProfile = result.profile
    renderProfile(result.profile)
  } catch (error) {
    console.error('Failed to load profile:', error)
    profileCount.textContent = '0 条'
    profileContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderProfile(profile: UserProfile): void {
  const { basic, personality, interests } = profile

  const labelMap: Record<string, string> = {
    nickname: '称呼',
    name: '姓名',
    age: '年龄',
    gender: '性别',
    location: '所在地',
    occupation: '职业',
    currentMood: '当前心情',
  }

  const fields: { key: string; label: string; value: string }[] = []
  if (basic) {
    for (const [key, value] of Object.entries(basic)) {
      if (value !== undefined && value !== null && value !== '') {
        const label = labelMap[key] || key
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
        fields.push({ key, label, value: displayValue })
      }
    }
  }

  const tags = [
    ...(personality || []).map(p => ({ text: p, type: 'personality' })),
    ...(interests || []).map(i => ({ text: i, type: 'interest' })),
  ]

  const profileItemCount = fields.length + tags.length
  profileCount.textContent = `${profileItemCount} 条`

  if (fields.length === 0 && tags.length === 0) {
    profileContent.innerHTML = '<div class="profile-empty">EVA 还不太了解你，多聊聊吧</div>'
    return
  }

  let html = '<div class="profile-fields">'
  fields.forEach(f => {
    html += `
      <div class="profile-field">
        <span class="field-label">${escapeHtml(f.label)}</span>
        <span class="field-value">${escapeHtml(f.value)}</span>
        <button class="delete-icon-btn" data-field="${escapeHtml(f.key)}" title="删除"></button>
      </div>
    `
  })
  html += '</div>'

  if (tags.length > 0) {
    html += '<div class="profile-tags">'
    tags.forEach(t => {
      html += `<span class="profile-tag ${t.type}">${escapeHtml(t.text)}</span>`
    })
    html += '</div>'
  }

  profileContent.innerHTML = html

  // Attach delete handlers
  profileContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const field = (e.target as HTMLButtonElement).dataset.field
      if (!field) return

      const confirmed = await showConfirmDialog({
        title: '删除画像字段',
        message: `将删除“${labelMap[field] || field}”。`,
        detail: '删除后可以在新的对话中重新补充。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteProfileField(field)
      }
    })
  })
}

async function deleteProfileField(field: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteProfileField(field)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadUserProfile()
    showPanelNotice('已删除')
  } catch (error: any) {
    console.error('Failed to delete profile field:', error)
    showPanelNotice('删除失败', 'error')
  }
}

async function loadImportantMemories(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      throw new Error(result.error || '重要记忆返回为空')
    }

    const memories = result.profile.importantMemories || {}
    renderImportantMemories(memories)
  } catch (error) {
    console.error('Failed to load memories:', error)
    importantMemoriesCount.textContent = '0 条'
    importantMemoriesContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderImportantMemories(memories: Record<string, string>): void {
  const entries = Object.entries(memories)
  importantMemoriesCount.textContent = `${entries.length} 条`

  if (entries.length === 0) {
    importantMemoriesContent.innerHTML = '<div class="profile-empty">暂无重要记忆</div>'
    return
  }

  let html = '<div class="memories-list">'
  entries.forEach(([key, value]) => {
    html += `
      <div class="memory-item">
        <div class="memory-content">
          <span class="memory-key">${escapeHtml(key)}</span>
          <span class="memory-value">${escapeHtml(value)}</span>
        </div>
        <button class="delete-icon-btn" data-key="${escapeHtml(key)}" title="删除"></button>
      </div>
    `
  })
  html += '</div>'

  importantMemoriesContent.innerHTML = html

  // Attach delete handlers
  importantMemoriesContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const key = (e.target as HTMLButtonElement).dataset.key
      if (!key) return

      const confirmed = await showConfirmDialog({
        title: '删除重要记忆',
        message: `将删除“${key}”。`,
        detail: '这条长期记忆不会再参与后续上下文。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteImportantMemory(key)
      }
    })
  })
}

async function deleteImportantMemory(key: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteImportantMemory(key)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadImportantMemories()
    showPanelNotice('记忆已删除')
  } catch (error: any) {
    console.error('Failed to delete memory:', error)
    showPanelNotice('删除失败', 'error')
  }
}

async function loadConversationSummaries(): Promise<void> {
  try {
    const result = await window.electronAPI.getConversationSummaries()
    if (!result.success || !result.summaries) {
      throw new Error(result.error || '对话摘要返回为空')
    }

    summariesCount.textContent = `${result.summaries.length} 条`
    renderSummaries(result.summaries)
  } catch (error) {
    console.error('Failed to load summaries:', error)
    summariesContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderSummaries(summaries: Array<{
  id: string
  timestamp: number
  summary: string
  keyTopics: string[]
}>): void {
  if (summaries.length === 0) {
    summariesContent.innerHTML = '<div class="profile-empty">暂无对话摘要</div>'
    return
  }

  let html = '<div class="summaries-list">'
  summaries.slice(0, 10).forEach(s => {
    const date = new Date(s.timestamp).toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    html += `
      <div class="summary-item">
        <div class="summary-header">
          <span class="summary-date">${date}</span>
          <button class="delete-icon-btn" data-id="${escapeHtml(s.id)}" title="删除"></button>
        </div>
        <div class="summary-text">${escapeHtml(s.summary)}</div>
        ${s.keyTopics && s.keyTopics.length > 0 ? `
          <div class="summary-topics">
            ${s.keyTopics.map(t => `<span class="topic-tag">${escapeHtml(t)}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `
  })
  html += '</div>'

  summariesContent.innerHTML = html

  // Attach delete handlers
  summariesContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (e.target as HTMLButtonElement).dataset.id
      if (!id) return

      const confirmed = await showConfirmDialog({
        title: '删除对话摘要',
        message: '将删除这条已压缩保存的历史对话摘要。',
        detail: '其他摘要和最近对话不会受到影响。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteConversationSummary(id)
      }
    })
  })
}

async function deleteConversationSummary(id: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteConversationSummary(id)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadConversationSummaries()
    showPanelNotice('已删除')
  } catch (error: any) {
    console.error('Failed to delete summary:', error)
    showPanelNotice('删除失败', 'error')
  }
}

async function loadWorkingMemory(): Promise<void> {
  try {
    const result = await window.electronAPI.getWorkingMemory()
    if (!result.success || !result.memory) {
      throw new Error(result.error || '最近对话返回为空')
    }

    const turns = result.memory.recentTurns || []
    conversationsCount.textContent = `${turns.length} 条`
    renderConversations(turns)
  } catch (error) {
    console.error('Failed to load working memory:', error)
    conversationsContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderConversations(turns: Array<{
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}>): void {
  if (turns.length === 0) {
    conversationsContent.innerHTML = '<div class="profile-empty">暂无对话记录</div>'
    return
  }

  let html = '<div class="conversations-list">'
  turns.slice(-20).forEach(turn => {
    const roleLabel = turn.role === 'user' ? '你' : 'EVA'
    const roleClass = turn.role === 'user' ? 'user' : 'assistant'
    html += `
      <div class="conversation-item ${roleClass}">
        <span class="conversation-role">${roleLabel}</span>
        <span class="conversation-content">${escapeHtml(turn.content)}</span>
        <button class="delete-icon-btn" data-id="${escapeHtml(turn.id)}" title="删除"></button>
      </div>
    `
  })
  html += '</div>'

  conversationsContent.innerHTML = html

  // Attach delete handlers
  conversationsContent.querySelectorAll('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = (e.target as HTMLButtonElement).dataset.id
      if (!id) return

      const confirmed = await showConfirmDialog({
        title: '删除最近对话',
        message: '将从工作记忆中删除这条最近对话。',
        detail: '这不会删除其他记忆内容。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteConversationTurn(id)
      }
    })
  })
}

async function deleteConversationTurn(id: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteConversationTurn(id)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadWorkingMemory()
    showPanelNotice('已删除')
  } catch (error: any) {
    console.error('Failed to delete conversation turn:', error)
    showPanelNotice('删除失败', 'error')
  }
}

async function loadAccountInputs(): Promise<void> {
  try {
    const result = await window.electronAPI.listAccountInputs()
    if (!result.success || !result.inputs) {
      throw new Error(result.error || '账户信息返回为空')
    }

    currentAccountInputs = result.inputs
    accountInputsCount.textContent = `${result.inputs.length} 条`
    accountInputsPageCount.textContent = `${result.inputs.length} 条`
    renderAccountInputs(result.inputs)
  } catch (error) {
    console.error('Failed to load account inputs:', error)
    accountInputsCount.textContent = '0 条'
    accountInputsPageCount.textContent = '0 条'
    accountInputsContent.innerHTML = '<div class="profile-error">加载失败</div>'
  }
}

function renderAccountInputs(inputs: AccountInput[]): void {
  if (inputs.length === 0) {
    accountInputsContent.innerHTML = '<div class="profile-empty">暂无账户信息</div>'
    return
  }

  let html = '<div class="account-input-list">'
  const groups = groupAccountInputs(inputs)
  groups.forEach(group => {
    html += `
      <div class="account-input-group">
        <div class="account-input-group-title">
          <span>${escapeHtml(group.label)}</span>
          <span>${group.items.length} 项</span>
        </div>
    `
    group.items.forEach(input => {
      const updatedAt = new Date(input.updatedAt).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
      html += `
        <div class="account-input-item">
          <div class="account-input-main">
            <div class="account-input-title">
              <span>${escapeHtml(input.itemLabel || input.label || input.key)}</span>
              <span class="account-input-sensitivity">${escapeHtml(formatInputSensitivity(input.sensitivity))}</span>
            </div>
            <div class="account-input-key">${escapeHtml(input.key)}</div>
            <div class="account-input-value" data-key="${escapeHtml(input.key)}">${escapeHtml(maskAccountValue(input.value))}</div>
            <div class="account-input-meta">更新于 ${escapeHtml(updatedAt)} · ${escapeHtml(input.scope || 'global')}</div>
          </div>
          <div class="account-input-actions">
            <button class="memory-add-btn account-input-toggle" data-key="${escapeHtml(input.key)}" type="button">显示</button>
            <button class="delete-icon-btn visible" data-key="${escapeHtml(input.key)}" title="删除"></button>
          </div>
        </div>
      `
    })
    html += '</div>'
  })
  html += '</div>'

  accountInputsContent.innerHTML = html

  accountInputsContent.querySelectorAll<HTMLButtonElement>('.account-input-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key
      const input = currentAccountInputs.find(item => item.key === key)
      if (!input) {
        return
      }
      const valueEl = accountInputsContent.querySelector<HTMLElement>(`.account-input-value[data-key="${cssEscape(input.key)}"]`)
      const revealing = btn.textContent === '显示'
      if (valueEl) {
        valueEl.textContent = revealing ? input.value : maskAccountValue(input.value)
      }
      btn.textContent = revealing ? '隐藏' : '显示'
    })
  })

  accountInputsContent.querySelectorAll<HTMLButtonElement>('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key
      if (!key) {
        return
      }
      const confirmed = await showConfirmDialog({
        title: '删除账户信息',
        message: `将删除“${key}”。`,
        detail: '之后如果任务仍需要这项信息，会重新向你请求。',
        confirmText: '删除',
        tone: 'danger'
      })
      if (confirmed) {
        await deleteAccountInput(key)
      }
    })
  })
}

function groupAccountInputs(inputs: AccountInput[]): Array<{ key: string; label: string; items: AccountInput[]; updatedAt: number }> {
  const groups = new Map<string, { key: string; label: string; items: AccountInput[]; updatedAt: number }>()

  inputs.forEach(input => {
    const key = input.groupKey || 'global'
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(input)
      existing.updatedAt = Math.max(existing.updatedAt, input.updatedAt)
      return
    }
    groups.set(key, {
      key,
      label: input.groupLabel || key,
      items: [input],
      updatedAt: input.updatedAt,
    })
  })

  return Array.from(groups.values()).sort((left, right) => right.updatedAt - left.updatedAt)
}

function maskAccountValue(value: string): string {
  if (!value) {
    return '(空)'
  }
  if (value.length <= 4) {
    return '••••'
  }
  return `${value.slice(0, 2)}${'•'.repeat(Math.min(12, Math.max(4, value.length - 4)))}${value.slice(-2)}`
}

function formatInputSensitivity(sensitivity: string): string {
  switch (sensitivity) {
    case 'secret':
      return '敏感'
    case 'verification':
      return '验证'
    default:
      return '普通'
  }
}

async function deleteAccountInput(key: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteAccountInput(key)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadAccountInputs()
    showPanelNotice('账户信息已删除')
  } catch (error: any) {
    console.error('Failed to delete account input:', error)
    showPanelNotice('删除失败', 'error')
  }
}

openAccountInputsBtn.addEventListener('click', () => {
  switchMemoryPage('accounts')
})

backMemoryOverviewBtn.addEventListener('click', () => {
  switchMemoryPage('overview')
})

clearAccountInputsBtn.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: '清空账户信息',
    message: '将删除所有由任务执行保存的账号、密钥、密码和固定配置。',
    detail: '普通记忆和对话历史不会被同时清除。',
    confirmText: '清空',
    tone: 'danger'
  })
  if (!confirmed) {
    return
  }

  try {
    const result = await window.electronAPI.clearAccountInputs()
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadAccountInputs()
    showPanelNotice('账户信息已清空')
  } catch (error: any) {
    console.error('Failed to clear account inputs:', error)
    showPanelNotice('清空失败', 'error')
  }
})

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ========== System Config Section ==========

const proxyInput = document.getElementById('proxy-input') as HTMLInputElement
const llmModelsList = document.getElementById('llm-models-list')!
const taskModelsList = document.getElementById('task-models-list')!
const ttsModelsList = document.getElementById('tts-models-list')!
const asrModelsList = document.getElementById('asr-models-list')!
const localModelsList = document.getElementById('local-models-list')!
const addLLMBtn = document.getElementById('add-llm-btn') as HTMLButtonElement
const addTaskBtn = document.getElementById('add-task-btn') as HTMLButtonElement
const taskMaxTurnsInput = document.getElementById('task-max-turns-input') as HTMLInputElement
const taskContextWindowInput = document.getElementById('task-context-window-input') as HTMLInputElement
const taskCompactAfterInput = document.getElementById('task-compact-after-input') as HTMLInputElement
const taskKeepRecentInput = document.getElementById('task-keep-recent-input') as HTMLInputElement
const addTTSBtn = document.getElementById('add-tts-btn') as HTMLButtonElement
const addASRBtn = document.getElementById('add-asr-btn') as HTMLButtonElement
const downloadLocalModelsBtn = document.getElementById('download-local-models-btn') as HTMLButtonElement
const resetSystemBtn = document.getElementById('reset-system-btn') as HTMLButtonElement

let currentSystemConfig: SystemConfig | null = null
let lastLocalModels: LocalModelStatus[] = []

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

async function evaluateSetupReadiness(): Promise<SetupReadiness> {
  const settings = await window.electronAPI.getSettings()
  const system = settings.system
  const issues: SetupIssue[] = []

  const activeLLM = system.llmModels.find(model => model.id === system.activeLLMId) || system.llmModels[0]
  if (!activeLLM?.modelName?.trim() || !activeLLM?.apiKey?.trim() || !activeLLM?.baseUrl?.trim()) {
    issues.push({
      kind: 'llm',
      label: '对话模型',
      message: '补全对话模型的模型名、API Key 和 Base URL',
    })
  }

  const activeTask = system.taskModels.find(model => model.id === system.activeTaskId) || system.taskModels[0]
  if (!activeTask?.modelName?.trim() || !activeTask?.apiKey?.trim() || !activeTask?.baseUrl?.trim()) {
    issues.push({
      kind: 'task',
      label: '任务模型',
      message: '补全任务模型的模型名、API Key 和 Base URL',
    })
  }

  const activeTTS = system.ttsModels.find(model => model.id === system.activeTTSId) || system.ttsModels[0]
  if (!activeTTS?.modelName?.trim() || !activeTTS?.apiKey?.trim() || !activeTTS?.voiceId?.trim()) {
    issues.push({
      kind: 'tts',
      label: 'TTS',
      message: '补全 TTS 的模型名、API Key 和 Voice ID',
    })
  }

  const activeASR = system.asrModels.find(model => model.id === system.activeASRId) || system.asrModels[0]
  if (!activeASR?.modelName?.trim() || !activeASR?.apiKey?.trim()) {
    issues.push({
      kind: 'asr',
      label: 'ASR',
      message: '补全 ASR 的模型名和 API Key',
    })
  }

  try {
    const result = await window.electronAPI.getLocalModelStatus()
    if (!result.success) {
      throw new Error(result.error || '本地模型检查失败')
    }
    const missingModels = result.models.filter(model => !model.exists)
    if (missingModels.length > 0) {
      issues.push({
        kind: 'models',
        label: '本地模型',
        message: `下载缺失的本地模型：${missingModels.map(model => model.name).join('、')}`,
      })
    }
  } catch {
    issues.push({
      kind: 'models',
      label: '本地模型',
      message: '检查本地 VAD / SmartTurn 模型状态',
    })
  }

  return {
    ready: issues.length === 0,
    issues,
  }
}

function updateSetupNavIndicator(readiness: SetupReadiness): void {
  if (!modelNavItem || !modelNavLabel) {
    return
  }

  modelNavItem.classList.toggle('has-setup-issues', !readiness.ready)
  modelNavItem.dataset.issueCount = readiness.ready ? '' : String(readiness.issues.length)
  modelNavItem.title = readiness.ready
    ? ''
    : readiness.issues.map(issue => `${issue.label}: ${issue.message}`).join('\n')

  const existingBadge = modelNavItem.querySelector('.nav-issue-badge')
  if (existingBadge) {
    existingBadge.remove()
  }

  if (!readiness.ready) {
    const badge = document.createElement('span')
    badge.className = 'nav-issue-badge'
    badge.textContent = String(readiness.issues.length)
    modelNavItem.appendChild(badge)
  }
}

function renderSetupGuidance(readiness: SetupReadiness): void {
  const existing = document.getElementById('setup-guidance-card')
  if (existing) {
    existing.remove()
  }

  if (readiness.ready) {
    return
  }

  const modelsSection = document.getElementById('section-models')
  if (!modelsSection) {
    return
  }

  const card = document.createElement('div')
  card.id = 'setup-guidance-card'
  card.className = 'setup-guidance-card'
  card.innerHTML = `
    <div class="setup-guidance-header">
      <span class="setup-guidance-title">启动前需要完成配置</span>
      <span class="setup-guidance-count">${readiness.issues.length} 项</span>
    </div>
    <div class="setup-guidance-list">
      ${readiness.issues.map(issue => `
        <button class="setup-guidance-item" type="button" data-setup-kind="${issue.kind}">
          <span class="setup-guidance-dot"></span>
          <span>
            <strong>${escapeHtml(issue.label)}</strong>
            <small>${escapeHtml(issue.message)}</small>
          </span>
        </button>
      `).join('')}
    </div>
  `

  const title = modelsSection.querySelector('.section-title')
  title?.insertAdjacentElement('afterend', card)

  card.querySelectorAll<HTMLElement>('.setup-guidance-item').forEach(item => {
    item.addEventListener('click', () => {
      const kind = item.dataset.setupKind as SetupIssueKind | undefined
      const targetId = kind === 'models' ? 'local-models-list' : `${kind}-models-list`
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  })
}

async function refreshSetupReadiness(): Promise<SetupReadiness> {
  setupReadiness = await evaluateSetupReadiness()
  updateSetupNavIndicator(setupReadiness)
  renderSetupGuidance(setupReadiness)
  return setupReadiness
}

async function ensureSetupReadyForConversation(): Promise<boolean> {
  const readiness = await refreshSetupReadiness()
  if (readiness.ready) {
    return true
  }

  showPanelNotice(`需要完成 ${readiness.issues.length} 项配置`, 'error')
  openSettings('models')
  return false
}

async function loadSystemConfig(): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  currentSystemConfig = settings.system
  renderSystemConfig()
  void loadLocalModelStatus()
}

function renderSystemConfig(): void {
  if (!currentSystemConfig) return

  proxyInput.value = currentSystemConfig.proxy

  renderLLMModels()
  renderTaskModels()
  renderTaskRuntimeSettings()
  renderTTSModels()
  renderASRModels()
}

async function loadLocalModelStatus(): Promise<void> {
  localModelsList.innerHTML = `<div class="profile-loading"><span class="loading-spinner"></span>${escapeHtml(t('system.checking'))}</div>`
  downloadLocalModelsBtn.disabled = true

  try {
    const result = await window.electronAPI.getLocalModelStatus()
    if (!result.success) {
      throw new Error(result.error || '本地模型状态返回失败')
    }
    renderLocalModels(result.models)
  } catch (error: any) {
    localModelsList.innerHTML = `<div class="profile-error">${escapeHtml(t('system.checkFailed'))}: ${escapeHtml(error.message ?? String(error))}</div>`
    downloadLocalModelsBtn.disabled = false
  }
}

function renderLocalModels(models: LocalModelStatus[]): void {
  lastLocalModels = models
  const missingCount = models.filter(model => !model.exists).length
  downloadLocalModelsBtn.disabled = missingCount === 0
  downloadLocalModelsBtn.textContent = missingCount > 0 ? `${t('system.downloadMissing')} (${missingCount})` : t('system.modelReady')

  localModelsList.innerHTML = models.map(model => `
    <div class="config-model-card local-model-card ${model.exists ? 'active' : 'missing'}">
      <div class="config-model-header">
        <div class="config-model-name local-model-name">
          <span>${escapeHtml(model.name)}</span>
          <span class="config-model-active-badge ${model.exists ? '' : 'missing'}">
            ${model.exists ? t('system.installed') : t('system.missing')}
          </span>
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">${escapeHtml(t('system.purpose'))}</span>
          <span class="config-field-static">${escapeHtml(model.purpose)}</span>
        </div>
        <div class="config-field">
          <span class="config-field-label">${escapeHtml(t('system.file'))}</span>
          <span class="config-field-static">${escapeHtml(model.filename)}</span>
        </div>
        <div class="config-field">
          <span class="config-field-label">${escapeHtml(t('system.size'))}</span>
          <span class="config-field-static">${model.exists ? formatFileSize(model.sizeBytes ?? 0) : '-'}</span>
        </div>
      </div>
    </div>
  `).join('')
}

function formatFileSize(bytes: number): string {
  if (bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function renderLLMModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.llmModels
  if (models.length === 0) {
    llmModelsList.innerHTML = `<div class="config-empty">${escapeHtml(t('system.noLlm'))}</div>`
    return
  }

  llmModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeLLMId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="deepseek-chat" />
          ${model.id === currentSystemConfig!.activeLLMId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${model.id !== currentSystemConfig!.activeLLMId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="sk-..." />
        </div>
        <div class="config-field">
          <span class="config-field-label">Base URL</span>
          <input type="text" class="config-field-input" value="${escapeHtml(model.baseUrl)}" data-field="baseUrl" placeholder="https://api.openai.com/v1" />
        </div>
      </div>
    </div>
  `).join('')

  attachLLMEventListeners()
}

function renderTaskModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.taskModels
  if (models.length === 0) {
    taskModelsList.innerHTML = `<div class="config-empty">${escapeHtml(t('system.noTask'))}</div>`
    return
  }

  taskModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeTaskId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="gemini-3.1-pro-preview" />
          ${model.id === currentSystemConfig!.activeTaskId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${model.id !== currentSystemConfig!.activeTaskId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="sk-..." />
        </div>
        <div class="config-field">
          <span class="config-field-label">Base URL</span>
          <input type="text" class="config-field-input" value="${escapeHtml(model.baseUrl)}" data-field="baseUrl" placeholder="https://generativelanguage.googleapis.com/v1beta/openai" />
        </div>
      </div>
    </div>
  `).join('')

  attachTaskEventListeners()
}

function renderTaskRuntimeSettings(): void {
  if (!currentSystemConfig) return
  const config = currentSystemConfig.taskRuntime
  taskMaxTurnsInput.value = String(config.maxTurns)
  taskContextWindowInput.value = String(config.modelContextWindow)
  taskCompactAfterInput.value = String(config.autoCompactTokenLimit)
  taskKeepRecentInput.value = String(config.keepRecentTurns)
}

const TTS_PROVIDERS: { value: TTSProviderType; label: string }[] = [
  { value: 'fish', label: 'Fish Audio' }
]

function getTTSProviderLabel(provider: TTSProviderType): string {
  return TTS_PROVIDERS.find(p => p.value === provider)?.label || provider
}

function renderTTSModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.ttsModels
  if (models.length === 0) {
    ttsModelsList.innerHTML = `<div class="config-empty">${escapeHtml(t('system.noTts'))}</div>`
    return
  }

  ttsModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeTTSId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <span class="config-provider-label">${getTTSProviderLabel(model.provider)}</span>
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="s2-pro" />
          ${model.id === currentSystemConfig!.activeTTSId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${model.id !== currentSystemConfig!.activeTTSId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          <select class="config-field-input" data-field="provider">
            ${TTS_PROVIDERS.map(p => `<option value="${p.value}" ${p.value === model.provider ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="API Key" />
        </div>
        <div class="config-field">
          <span class="config-field-label">Voice ID</span>
          <input type="text" class="config-field-input" value="${escapeHtml(model.voiceId || '')}" data-field="voiceId" placeholder="音色 ID（可选）" />
        </div>
      </div>
    </div>
  `).join('')

  attachTTSEventListeners()
}

const ASR_PROVIDERS: { value: ASRProviderType; label: string }[] = [
  { value: 'qwen', label: 'Qwen' }
]

function getASRProviderLabel(provider: ASRProviderType): string {
  return ASR_PROVIDERS.find(p => p.value === provider)?.label || provider
}

function renderASRModels(): void {
  if (!currentSystemConfig) return

  const models = currentSystemConfig.asrModels
  if (models.length === 0) {
    asrModelsList.innerHTML = `<div class="config-empty">${escapeHtml(t('system.noAsr'))}</div>`
    return
  }

  asrModelsList.innerHTML = models.map(model => `
    <div class="config-model-card ${model.id === currentSystemConfig!.activeASRId ? 'active' : ''}" data-id="${escapeHtml(model.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          <span class="config-provider-label">${getASRProviderLabel(model.provider)}</span>
          <input type="text" value="${escapeHtml(model.modelName)}" data-field="modelName" placeholder="realtime" />
          ${model.id === currentSystemConfig!.activeASRId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${model.id !== currentSystemConfig!.activeASRId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          <select class="config-field-input" data-field="provider">
            ${ASR_PROVIDERS.map(p => `<option value="${p.value}" ${p.value === model.provider ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(model.apiKey)}" data-field="apiKey" placeholder="API Key" />
        </div>
      </div>
    </div>
  `).join('')

  attachASREventListeners()
}

function renderApiTestButton(): string {
  return '<button class="config-model-btn config-test-btn" data-action="test" title="测试 API 连接">测试</button>'
}

function readCardModel<T extends Record<string, any>>(card: Element, model: T): T {
  const draft = { ...model }
  card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(input => {
    draft[input.dataset.field as keyof T] = input.value as T[keyof T]
  })
  return draft
}

async function testApiModel(
  kind: ApiModelTestKind,
  id: string,
  card: Element,
  button: HTMLButtonElement
): Promise<void> {
  if (!currentSystemConfig || button.disabled) return

  const model =
    kind === 'llm' ? currentSystemConfig.llmModels.find(m => m.id === id) :
    kind === 'task' ? currentSystemConfig.taskModels.find(m => m.id === id) :
    kind === 'tts' ? currentSystemConfig.ttsModels.find(m => m.id === id) :
    currentSystemConfig.asrModels.find(m => m.id === id)

  if (!model) {
    showPanelNotice('模型配置不存在', 'error')
    return
  }

  const originalText = button.textContent || '测试'
  button.disabled = true
  button.textContent = '测试中'
  button.classList.remove('success', 'danger')
  button.classList.add('testing')

  try {
    const result = await window.electronAPI.testApiModel(kind, readCardModel(card, model))
    if (!result.success) {
      throw new Error(result.error || '连接失败')
    }
    button.textContent = '正常'
    button.classList.remove('testing')
    button.classList.add('success')
    showPanelNotice(result.message || 'API 连接正常')
  } catch (error: any) {
    button.textContent = '失败'
    button.classList.remove('testing')
    button.classList.add('danger')
    showPanelNotice(`API 测试失败: ${error.message ?? String(error)}`, 'error')
  } finally {
    window.setTimeout(() => {
      button.disabled = false
      button.textContent = originalText
      button.classList.remove('success', 'danger', 'testing')
    }, 1600)
  }
}

function attachLLMEventListeners(): void {
  llmModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    // Field changes
    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateLLMModel(id, { [field]: value })
      })
    })

    // Action buttons
    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateLLMModel(id)
        } else if (action === 'delete') {
          await deleteLLMModel(id)
        } else if (action === 'test') {
          await testApiModel('llm', id, card, btn as HTMLButtonElement)
        }
      })
    })
  })
}

function attachTaskEventListeners(): void {
  taskModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateTaskModel(id, { [field]: value })
      })
    })

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateTaskModel(id)
        } else if (action === 'delete') {
          await deleteTaskModel(id)
        } else if (action === 'test') {
          await testApiModel('task', id, card, btn as HTMLButtonElement)
        }
      })
    })
  })
}

function attachTTSEventListeners(): void {
  ttsModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateTTSModel(id, { [field]: value })
      })
    })

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateTTSModel(id)
        } else if (action === 'delete') {
          await deleteTTSModel(id)
        } else if (action === 'test') {
          await testApiModel('tts', id, card, btn as HTMLButtonElement)
        }
      })
    })
  })
}

function attachASREventListeners(): void {
  asrModelsList.querySelectorAll('.config-model-card').forEach(card => {
    const id = (card as HTMLElement).dataset.id!

    card.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', async () => {
        const field = (input as HTMLInputElement).dataset.field!
        const value = (input as HTMLInputElement).value
        await updateASRModel(id, { [field]: value })
      })
    })

    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = (btn as HTMLButtonElement).dataset.action
        if (action === 'activate') {
          await activateASRModel(id)
        } else if (action === 'delete') {
          await deleteASRModel(id)
        } else if (action === 'test') {
          await testApiModel('asr', id, card, btn as HTMLButtonElement)
        }
      })
    })
  })
}

async function saveSystemConfig(): Promise<void> {
  if (!currentSystemConfig) return
  await window.electronAPI.updateSettings({ system: currentSystemConfig })
  await refreshSetupReadiness()
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(numeric)))
}

async function updateTaskRuntimeSettings(): Promise<void> {
  if (!currentSystemConfig) return
  const maxTurns = clampInteger(taskMaxTurnsInput.value, currentSystemConfig.taskRuntime.maxTurns, 4, 100)
  const modelContextWindow = clampInteger(
    taskContextWindowInput.value,
    currentSystemConfig.taskRuntime.modelContextWindow,
    4096,
    1000000
  )
  const autoCompactTokenLimit = Math.min(
    clampInteger(
      taskCompactAfterInput.value,
      currentSystemConfig.taskRuntime.autoCompactTokenLimit,
      1000,
      modelContextWindow
    ),
    Math.floor(modelContextWindow * 0.9)
  )
  const keepRecentTurns = clampInteger(
    taskKeepRecentInput.value,
    currentSystemConfig.taskRuntime.keepRecentTurns,
    1,
    maxTurns
  )

  currentSystemConfig.taskRuntime = {
    maxTurns,
    modelContextWindow,
    autoCompactTokenLimit,
    keepRecentTurns
  }
  renderTaskRuntimeSettings()
  await saveSystemConfig()
}

async function updateLLMModel(id: string, updates: Partial<LLMModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.llmModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateLLMModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeLLMId = id
  await saveSystemConfig()
  renderLLMModels()
}

async function deleteLLMModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.llmModels.length <= 1) return
  currentSystemConfig.llmModels = currentSystemConfig.llmModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeLLMId === id && currentSystemConfig.llmModels.length > 0) {
    currentSystemConfig.activeLLMId = currentSystemConfig.llmModels[0].id
  }
  await saveSystemConfig()
  renderLLMModels()
}

async function addLLMModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: LLMModelConfig = {
    id: generateId(),
    modelName: '',
    apiKey: '',
    baseUrl: ''
  }
  currentSystemConfig.llmModels.push(newModel)
  await saveSystemConfig()
  renderLLMModels()
}

async function updateTaskModel(id: string, updates: Partial<LLMModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.taskModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateTaskModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeTaskId = id
  await saveSystemConfig()
  renderTaskModels()
}

async function deleteTaskModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.taskModels.length <= 1) return
  currentSystemConfig.taskModels = currentSystemConfig.taskModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeTaskId === id && currentSystemConfig.taskModels.length > 0) {
    currentSystemConfig.activeTaskId = currentSystemConfig.taskModels[0].id
  }
  await saveSystemConfig()
  renderTaskModels()
}

async function addTaskModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: LLMModelConfig = {
    id: generateId(),
    modelName: 'gemini-3.1-pro-preview',
    apiKey: '',
    baseUrl: ''
  }
  currentSystemConfig.taskModels.push(newModel)
  await saveSystemConfig()
  renderTaskModels()
}

async function updateTTSModel(id: string, updates: Partial<TTSModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.ttsModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateTTSModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeTTSId = id
  await saveSystemConfig()
  renderTTSModels()
}

async function deleteTTSModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.ttsModels.length <= 1) return
  currentSystemConfig.ttsModels = currentSystemConfig.ttsModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeTTSId === id && currentSystemConfig.ttsModels.length > 0) {
    currentSystemConfig.activeTTSId = currentSystemConfig.ttsModels[0].id
  }
  await saveSystemConfig()
  renderTTSModels()
}

async function addTTSModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: TTSModelConfig = {
    id: generateId(),
    provider: 'fish',
    modelName: 's2-pro',
    apiKey: '',
    voiceId: ''
  }
  currentSystemConfig.ttsModels.push(newModel)
  await saveSystemConfig()
  renderTTSModels()
}

async function updateASRModel(id: string, updates: Partial<ASRModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.asrModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfig()
  }
}

async function activateASRModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  currentSystemConfig.activeASRId = id
  await saveSystemConfig()
  renderASRModels()
}

async function deleteASRModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.asrModels.length <= 1) return
  currentSystemConfig.asrModels = currentSystemConfig.asrModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeASRId === id && currentSystemConfig.asrModels.length > 0) {
    currentSystemConfig.activeASRId = currentSystemConfig.asrModels[0].id
  }
  await saveSystemConfig()
  renderASRModels()
}

async function addASRModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: ASRModelConfig = {
    id: generateId(),
    provider: 'qwen',
    modelName: 'realtime',
    apiKey: ''
  }
  currentSystemConfig.asrModels.push(newModel)
  await saveSystemConfig()
  renderASRModels()
}

// Proxy input handler
proxyInput.addEventListener('change', async () => {
  if (!currentSystemConfig) return
  currentSystemConfig.proxy = proxyInput.value.trim()
  await saveSystemConfig()
})

// Add button handlers
addLLMBtn.addEventListener('click', () => void addLLMModel())
addTaskBtn.addEventListener('click', () => void addTaskModel())
;[
  taskMaxTurnsInput,
  taskContextWindowInput,
  taskCompactAfterInput,
  taskKeepRecentInput
].forEach(input => {
  input.addEventListener('change', () => void updateTaskRuntimeSettings())
})
addTTSBtn.addEventListener('click', () => void addTTSModel())
addASRBtn.addEventListener('click', () => void addASRModel())

downloadLocalModelsBtn.addEventListener('click', async () => {
  downloadLocalModelsBtn.disabled = true
  downloadLocalModelsBtn.textContent = t('system.downloading')
  localModelsList.querySelectorAll('.local-model-card.missing').forEach(card => {
    card.classList.add('downloading')
  })

  try {
    const result = await window.electronAPI.downloadMissingLocalModels()
    if (!result.success) {
      throw new Error(result.error || '模型下载失败')
    }
    renderLocalModels(result.models)
    showPanelNotice('本地模型已就绪')
    await refreshSetupReadiness()
  } catch (error: any) {
    showPanelNotice(`模型下载失败: ${error.message ?? String(error)}`, 'error')
    await loadLocalModelStatus()
    await refreshSetupReadiness()
  }
})

// Reset system config from .env
async function resetSystemConfigFromEnv(): Promise<void> {
  resetSystemBtn.disabled = true
  resetSystemBtn.textContent = t('common.loading')

  try {
    const result = await window.electronAPI.resetSystemConfigFromEnv()
    if (result.success) {
      await loadSystemConfig()
      await refreshSetupReadiness()
      console.log('[Settings] System config reloaded from .env')
    } else {
      console.error('[Settings] Failed to reset:', result.error)
    }
  } catch (error) {
    console.error('[Settings] Reset error:', error)
  } finally {
    resetSystemBtn.disabled = false
    resetSystemBtn.innerHTML = `<span class="reset-icon">↻</span><span>${escapeHtml(t('system.reloadEnv'))}</span>`
  }
}

resetSystemBtn.addEventListener('click', () => void resetSystemConfigFromEnv())

async function initializeApp(): Promise<void> {
  try {
    await loadSettings()
    await loadPersonalities()
    await loadSystemConfig()
    await loadPluginUISurfaces()
    await refreshSetupReadiness()
    updateConversationButton()
    console.log('Her-Text Renderer initialized')
  } catch (error) {
    console.error('Failed to initialize app:', error)
  }
}

void initializeApp()
