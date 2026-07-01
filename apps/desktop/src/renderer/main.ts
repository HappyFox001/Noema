/**
 * Renderer entrypoint for the desktop UI.
 *
 * Owns the orb surface, audio playback scheduling, voice capture,
 * settings panel interactions, and renderer-side IPC event handling.
 */
import './styles.css'
import { initializeLiquidGlassSurface } from './liquid-glass-surface'
import { initializeDragonCursorEffect } from './dragon-cursor-effect'
import { initializeChatPanel } from './surfaces/chat-panel'
import { initializeOrbEntryMenu } from './surfaces/orb-entry-menu'
import claudeCodeLogoUrl from './assets/claude_code_logo.png'
import codexLogoUrl from './assets/codex_logo.png'
import claudeIconUrl from '@lobehub/icons-static-svg/icons/claude-color.svg?url'
import assemblyAIIconUrl from '@lobehub/icons-static-svg/icons/assemblyai-color.svg?url'
import azureAIIconUrl from '@lobehub/icons-static-svg/icons/azureai-color.svg?url'
import deepseekIconUrl from '@lobehub/icons-static-svg/icons/deepseek-color.svg?url'
import elevenLabsIconUrl from '@lobehub/icons-static-svg/icons/elevenlabs.svg?url'
import fishAudioIconUrl from '@lobehub/icons-static-svg/icons/fishaudio.svg?url'
import geminiIconUrl from '@lobehub/icons-static-svg/icons/gemini-color.svg?url'
import googleCloudIconUrl from '@lobehub/icons-static-svg/icons/googlecloud-color.svg?url'
import groqIconUrl from '@lobehub/icons-static-svg/icons/groq.svg?url'
import newAPIIconUrl from '@lobehub/icons-static-svg/icons/newapi-color.svg?url'
import ollamaIconUrl from '@lobehub/icons-static-svg/icons/ollama.svg?url'
import openAIIconUrl from '@lobehub/icons-static-svg/icons/openai.svg?url'
import qwenIconUrl from '@lobehub/icons-static-svg/icons/qwen-color.svg?url'
/*
 * Hidden TTS-provider icon import note for future re-enablement.
 * Current TTS provider support is intentionally limited to Fish Audio and ElevenLabs.
 *
 * import minimaxIconUrl from '@lobehub/icons-static-svg/icons/minimax-color.svg?url'
 */
import {
  ASR_PROVIDER_CATALOG,
  LLM_PROVIDER_CATALOG,
  TTS_PROVIDER_CATALOG,
  getASRProviderCatalogEntry,
  getLLMProviderCatalogEntry,
  getTTSProviderCatalogEntry,
  type ASRProviderType,
  type LLMProviderType,
  type TTSProviderType,
} from '../main/model-provider-catalog'

// ========== Audio Player ==========

initializeDragonCursorEffect()

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
    'common.increase': '增加',
    'common.decrease': '减少',
    'common.manage': '管理',
    'common.continue': '继续',
    'common.activate': '启用',
    'common.active': '使用中',
    'common.delete': '删除',
    'common.loading': '加载中...',
    'common.none': '无',
    'common.items': '{count} 项',
    'common.records': '{count} 条',
    'common.failed': '失败',
    'common.ready': '正常',
    'common.deleted': '已删除',
    'common.deleteFailed': '删除失败',
    'common.empty': '(空)',
    'common.show': '显示',
    'common.hide': '隐藏',
    'common.updatedAt': '更新于 {time}',
    'context.captureOrb': '截取小球',
    'context.chat': '聊天',
    'context.clearHistory': '清除对话',
    'context.settings': '系统面板',
    'entry.chat': 'Chat',
    'entry.system': '系统页面',
    'chat.background': '背景',
    'chat.characterProfile': '角色资料',
    'chat.identity': '陈千语',
    'chat.kicker': 'Noema chat',
    'chat.navArchive': '归档',
    'chat.navAssets': '资源',
    'chat.navCharacters': '角色',
    'chat.navConversations': '会话',
    'chat.navRuntime': '运行时',
    'chat.navSession': '当前会话',
    'chat.navVoice': '语音',
    'chat.new': '新建',
    'chat.placeholder': '输入消息...',
    'chat.profileDesc': '独立角色资源只描述角色本身，不包含 UI 状态或测试流程。',
    'chat.profileTags': '标签',
    'chat.resourceKicker': '角色资源',
    'chat.workflow.category.Agent': 'Agent',
    'chat.workflow.category.Assets': '资源',
    'chat.workflow.category.Constraints': '约束',
    'chat.workflow.category.Controls': '控制',
    'chat.workflow.category.Evaluation': '评估',
    'chat.workflow.category.Goal': '目标',
    'chat.workflow.category.Model': '模型',
    'chat.workflow.category.Outputs': '输出',
    'chat.workflow.category.Sources': '素材',
    'chat.workflow.category.Strategy': '策略',
    'chat.workflow.category.Targets': '目标资源',
    'chat.workflow.category.Taste': '风格',
    'chat.workflow.node.agent-policy': 'Agent 策略',
    'chat.workflow.node.character-card-target': '角色卡目标',
    'chat.workflow.node.character-field-target': '字段目标',
    'chat.workflow.node.continuity-control': '连续性控制',
    'chat.workflow.node.constraint': '硬约束',
    'chat.workflow.node.critique-loop': '自评修复',
    'chat.workflow.node.field-generation-control': '字段生成控制',
    'chat.workflow.node.generation-strategy': '生成策略',
    'chat.workflow.node.goal': '生成目标',
    'chat.workflow.node.image-generation-control': '图片生成控制',
    'chat.workflow.node.image-target': '图片目标',
    'chat.workflow.node.image-tool': '图像模型',
    'chat.workflow.node.llm-tool': '语言模型',
    'chat.workflow.node.material-document-resource': '文本资源',
    'chat.workflow.node.material-image-resource': '图片资源',
    'chat.workflow.node.npc-pack-target': 'NPC 包目标',
    'chat.workflow.node.npc-target': 'NPC 目标',
    'chat.workflow.node.opening-layout-target': '开幕版面目标',
    'chat.workflow.node.output-adapter': '输出适配',
    'chat.workflow.node.plot-arc-target': '剧情线目标',
    'chat.workflow.node.quality-gate': '质量门槛',
    'chat.workflow.node.relationship-control': '关系控制',
    'chat.workflow.node.retrieval-tool': '检索工具',
    'chat.workflow.node.scene-card-target': '场景卡目标',
    'chat.workflow.node.source-material': '素材来源',
    'chat.workflow.node.style-pressure': '风格压力',
    'chat.workflow.node.voice-tool': '语音工具',
    'chat.workflow.node.world-card-target': '世界卡目标',
    'chat.workflow.param.allowAgentExpansion': '允许扩展',
    'chat.workflow.param.arcShape': '剧情形状',
    'chat.workflow.param.aspectRatio': '画幅比例',
    'chat.workflow.param.assetPurpose': '资源用途',
    'chat.workflow.param.appealMode': '吸引力模式',
    'chat.workflow.param.askUserThreshold': '询问阈值',
    'chat.workflow.param.autoRepair': '自动修复',
    'chat.workflow.param.avoidPatterns': '规避模式',
    'chat.workflow.param.backgroundInteraction': '背景/道具互动',
    'chat.workflow.param.blockExport': '阻止导出',
    'chat.workflow.param.branchCount': '分支数',
    'chat.workflow.param.citationRequired': '需要引用',
    'chat.workflow.param.composition': '构图',
    'chat.workflow.param.compositionFreedom': '构图自由度',
    'chat.workflow.param.consistencyMode': '一致性模式',
    'chat.workflow.param.dimensions': '检查维度',
    'chat.workflow.param.editModelRef': '编辑模型 / 工作流',
    'chat.workflow.param.enabled': '启用',
    'chat.workflow.param.fields': '字段',
    'chat.workflow.param.fieldPurpose': '字段目的',
    'chat.workflow.param.format': '格式',
    'chat.workflow.param.forbidResettingFacts': '禁止重置事实',
    'chat.workflow.param.goalPrompt': '目标提示词',
    'chat.workflow.param.groundingStrength': '参考强度',
    'chat.workflow.param.hardBoundary': '硬边界',
    'chat.workflow.param.imageRole': '图片角色',
    'chat.workflow.param.imageStyleDomain': '风格域',
    'chat.workflow.param.identityStrength': '角色一致性',
    'chat.workflow.param.imageType': '图片类型',
    'chat.workflow.param.imageTypes': '图片类型',
    'chat.workflow.param.includeAlternates': '包含备选',
    'chat.workflow.param.includeAssets': '包含资源',
    'chat.workflow.param.includeFields': '包含字段',
    'chat.workflow.param.includeSections': '包含版块',
    'chat.workflow.param.includeSupportFields': '支持字段',
    'chat.workflow.param.intensity': '强度',
    'chat.workflow.param.iterations': '迭代次数',
    'chat.workflow.param.lengthPolicy': '长度策略',
    'chat.workflow.param.layoutKind': '版面类型',
    'chat.workflow.param.layoutPrompt': '版面提示词',
    'chat.workflow.param.memoryAnchors': '记忆锚点',
    'chat.workflow.param.milestoneCount': '里程碑数',
    'chat.workflow.param.minimumScore': '最低分',
    'chat.workflow.param.modelRef': '模型',
    'chat.workflow.param.mode': '模式',
    'chat.workflow.param.mustHave': '必须包含',
    'chat.workflow.param.mustNot': '禁止出现',
    'chat.workflow.param.materials': '素材',
    'chat.workflow.param.notes': '备注',
    'chat.workflow.param.npcCount': 'NPC 数量',
    'chat.workflow.param.npcRole': 'NPC 职能',
    'chat.workflow.param.npcRoles': 'NPC 职能组',
    'chat.workflow.param.preset': '预设',
    'chat.workflow.param.poseGoals': '姿势目标',
    'chat.workflow.param.progressionPacing': '推进节奏',
    'chat.workflow.param.promptPurpose': '提示词目的',
    'chat.workflow.param.provider': '服务商',
    'chat.workflow.param.purpose': '目的',
    'chat.workflow.param.priorityAssets': '优先资源',
    'chat.workflow.param.reasoningEffort': '推理强度',
    'chat.workflow.param.referenceStrength': '参考权重',
    'chat.workflow.param.relationshipMode': '关系模式',
    'chat.workflow.param.requiredChecks': '必要检查',
    'chat.workflow.param.revisionBudget': '修复预算',
    'chat.workflow.param.sceneCount': '场景数量',
    'chat.workflow.param.sceneTypes': '场景类型',
    'chat.workflow.param.scope': '作用范围',
    'chat.workflow.param.scopePrompt': '范围提示词',
    'chat.workflow.param.seedMode': 'Seed 策略',
    'chat.workflow.param.sensualityLevel': '性感强度',
    'chat.workflow.param.shotType': '镜头类型',
    'chat.workflow.param.sourceKind': '素材类型',
    'chat.workflow.param.speed': '语速',
    'chat.workflow.param.storyFunction': '剧情功能',
    'chat.workflow.param.stylePrompt': '风格提示词',
    'chat.workflow.param.targetAudience': '目标受众',
    'chat.workflow.param.targetKind': '目标类型',
    'chat.workflow.param.targets': '目标资源',
    'chat.workflow.param.targetImageCount': '图片数量',
    'chat.workflow.param.temperature': '温度',
    'chat.workflow.param.tensionRules': '张力规则',
    'chat.workflow.param.tone': '语气',
    'chat.workflow.param.autonomyLevel': '自主级别',
    'chat.workflow.param.voice': '音色',
    'chat.workflow.param.wardrobeExposure': '服装/暴露呈现',
    'chat.workflow.param.worldSections': '世界卡章节',
    'chat.workflow.param.image-tool.modelRef': '模型 / 工作流',
    'chat.workflow.param.image-tool.editModelRef': '编辑模型 / 工作流',
    'chat.workflow.option.adventure-campaign': '冒险战役',
    'chat.workflow.option.ambiguous-ally': '暧昧盟友',
    'chat.workflow.option.appearance': '外貌',
    'chat.workflow.option.avatar': '头像',
    'chat.workflow.option.background': '背景',
    'chat.workflow.option.body': '全身图',
    'chat.workflow.option.blocked-only': '仅阻塞时',
    'chat.workflow.option.branch-and-refine': '分支并打磨',
    'chat.workflow.option.campus-romance': '校园恋爱',
    'chat.workflow.option.character-focused': '角色主体',
    'chat.workflow.option.character-base-image': '基础角色图片',
    'chat.workflow.option.character-overview-sheet': '角色总览图',
    'chat.workflow.option.characterSummary': '角色摘要',
    'chat.workflow.option.connected-targets': '连接目标',
    'chat.workflow.option.ally': '盟友',
    'chat.workflow.option.antagonist': '反派',
    'chat.workflow.option.asymmetric-information': '信息不对称',
    'chat.workflow.option.asking-user-intent': '询问用户意图',
    'chat.workflow.option.boundaries': '边界',
    'chat.workflow.option.conflict-scene': '冲突场景',
    'chat.workflow.option.conflicting-motives': '动机冲突',
    'chat.workflow.option.consistency': '一致性',
    'chat.workflow.option.covered': '包裹穿着',
    'chat.workflow.option.custom': '自定义',
    'chat.workflow.option.coverImage': '封面图片',
    'chat.workflow.option.dark-adult': '暗色成人',
    'chat.workflow.option.description': '简介',
    'chat.workflow.option.dialogueStyle': '对话风格',
    'chat.workflow.option.do-not-resolve-immediately': '不要立即解决',
    'chat.workflow.option.downtime-scene': '日常场景',
    'chat.workflow.option.dramatic': '戏剧化',
    'chat.workflow.option.erotic': '情色',
    'chat.workflow.option.erotic-tension': '情色张力',
    'chat.workflow.option.environmental-scene': '环境场景',
    'chat.workflow.option.episodic': '单元剧',
    'chat.workflow.option.existing-card': '已有角色卡',
    'chat.workflow.option.explicit': '直接成人',
    'chat.workflow.option.explore-then-converge': '探索后收束',
    'chat.workflow.option.expression': '表情',
    'chat.workflow.option.expression-sheet': '表情表',
    'chat.workflow.option.factions': '势力',
    'chat.workflow.option.fantasy-companion': '幻想陪伴',
    'chat.workflow.option.field': '字段目标',
    'chat.workflow.option.field-completeness': '字段完整度',
    'chat.workflow.option.firstMessage': '开场白',
    'chat.workflow.option.forum-post-card': '论坛帖卡片',
    'chat.workflow.option.full-body': '全身构图',
    'chat.workflow.option.global': '全局目标',
    'chat.workflow.option.goal-match': '目标匹配',
    'chat.workflow.option.hero-cover': '主视觉封面',
    'chat.workflow.option.high': '高',
    'chat.workflow.option.image': '图片目标',
    'chat.workflow.option.image-pack': '图片包',
    'chat.workflow.option.image-reference': '图片参考',
    'chat.workflow.option.appearance-prompt': '外貌提示词',
    'chat.workflow.option.appearancePrompt': '外貌提示词',
    'chat.workflow.option.immersive-card-css': '沉浸式 CSS 卡片',
    'chat.workflow.option.independent': '独立图片',
    'chat.workflow.option.implied-nude': '暗示裸感',
    'chat.workflow.option.instant-compliance': '瞬间顺从',
    'chat.workflow.option.lore-dump': '设定倾倒',
    'chat.workflow.option.long-term-goals': '长期目标',
    'chat.workflow.option.lingerie-swimwear': '内衣 / 泳装',
    'chat.workflow.option.local-only': '仅本地',
    'chat.workflow.option.low-confidence': '低置信度',
    'chat.workflow.option.long': '长',
    'chat.workflow.option.low': '低',
    'chat.workflow.option.markdown-dossier': 'Markdown 档案',
    'chat.workflow.option.medium': '中',
    'chat.workflow.option.mobile-chat-intro': '移动聊天开幕',
    'chat.workflow.option.mentor': '导师',
    'chat.workflow.option.mystery-escalation': '悬疑升级',
    'chat.workflow.option.name': '名称',
    'chat.workflow.option.never': '运行中不询问',
    'chat.workflow.option.neutral': '中性',
    'chat.workflow.option.noema-role-chat': 'Noema 角色聊天',
    'chat.workflow.option.notes': '备注',
    'chat.workflow.option.ooc-explanation': 'OOC 解释',
    'chat.workflow.option.opening': '开场',
    'chat.workflow.option.opening-layout': '开幕版面',
    'chat.workflow.option.opening-moment': '开场瞬间',
    'chat.workflow.option.opening-scene': '开场场景',
    'chat.workflow.option.outfit-detail': '服装细节',
    'chat.workflow.option.personality': '性格',
    'chat.workflow.option.plot-hooks': '剧情钩子',
    'chat.workflow.option.portable-json': '通用 JSON',
    'chat.workflow.option.protective-companion': '保护型陪伴',
    'chat.workflow.option.private-conversation': '私密对话',
    'chat.workflow.option.primary-npc': '主要 NPC',
    'chat.workflow.option.reference': '参考图',
    'chat.workflow.option.relationship-changes': '关系变化',
    'chat.workflow.option.relationship-drama': '关系戏剧',
    'chat.workflow.option.relationship-moment': '关系瞬间',
    'chat.workflow.option.relationship-network': '关系网络',
    'chat.workflow.option.restrained': '克制',
    'chat.workflow.option.reveal-scene': '揭示场景',
    'chat.workflow.option.rival-tension': '竞争张力',
    'chat.workflow.option.rival': '竞争者',
    'chat.workflow.option.roleplay-usability': '角色扮演可用性',
    'chat.workflow.option.role-card': '角色卡',
    'chat.workflow.option.rules': '规则',
    'chat.workflow.option.same-character': '同一角色',
    'chat.workflow.option.same-world': '同一世界',
    'chat.workflow.option.scene': '场景',
    'chat.workflow.option.scenario': '场景设定',
    'chat.workflow.option.self-introduction': '自我介绍',
    'chat.workflow.option.sensual': '性感',
    'chat.workflow.option.sensual-confidence': '性感自信',
    'chat.workflow.option.setting': '设定',
    'chat.workflow.option.stylish-revealing': '时髦露肤',
    'chat.workflow.option.subtle': '微妙',
    'chat.workflow.option.sharp': '锐利',
    'chat.workflow.option.short': '短',
    'chat.workflow.option.sillytavern': 'SillyTavern',
    'chat.workflow.option.sillytavern-description-block': 'SillyTavern 描述块',
    'chat.workflow.option.single-pass': '单轮生成',
    'chat.workflow.option.slice-of-life': '日常切片',
    'chat.workflow.option.slow-burn': '慢热推进',
    'chat.workflow.option.slow-trust': '慢慢建立信任',
    'chat.workflow.option.slow-trust-rule': '慢信任推进',
    'chat.workflow.option.steady-escalation': '稳定升级',
    'chat.workflow.option.story-moment': '剧情瞬间',
    'chat.workflow.option.supportImages': '辅助图片',
    'chat.workflow.option.tags': '标签',
    'chat.workflow.option.title': '标题',
    'chat.workflow.option.unresolved-promises': '未兑现承诺',
    'chat.workflow.option.upper-body-portrait': '半身肖像',
    'chat.workflow.option.urban-suspense': '都市悬疑',
    'chat.workflow.option.user-preference': '用户偏好',
    'chat.workflow.option.vector-index': '向量索引',
    'chat.workflow.option.web-summary': '网页摘要',
    'chat.workflow.option.world-context': '世界上下文',
    'chat.workflow.option.warm': '温和',
    'chat.workflow.option.wildcard': '不稳定变量',
    'chat.workflow.option.world': '世界目标',
    'chat.workflow.option.worldContext': '世界观',
    'chat.workflow.option.world-facts': '世界事实',
    'chat.workflow.option.plain-natural-rp': '自然角色扮演',
    'chat.workflow.option.immersive-second-person': '沉浸式第二人称',
    'chat.workflow.option.close-third-person': '贴近第三人称',
    'chat.workflow.option.first-person-confessional': '第一人称自白',
    'chat.workflow.option.dialogue-forward': '对话驱动',
    'chat.workflow.option.cinematic-scene-prose': '电影化场景文',
    'chat.workflow.option.sensory-rich-prose': '感官细节文',
    'chat.workflow.option.minimalist-prose': '极简文风',
    'chat.workflow.option.precise-literary-prose': '精确文学文风',
    'chat.workflow.option.lush-poetic-prose': '华丽诗性文风',
    'chat.workflow.option.noir-detective-voice': '黑色侦探腔',
    'chat.workflow.option.gothic-romance-prose': '哥特浪漫文风',
    'chat.workflow.option.dark-fantasy-prose': '黑暗幻想文风',
    'chat.workflow.option.urban-fantasy-prose': '都市幻想文风',
    'chat.workflow.option.grimdark-prose': '残酷黑暗文风',
    'chat.workflow.option.cozy-fantasy-prose': '舒适幻想文风',
    'chat.workflow.option.high-fantasy-epic': '高幻想史诗',
    'chat.workflow.option.sword-and-sorcery': '剑与魔法',
    'chat.workflow.option.wuxia-xianxia-prose': '武侠仙侠文风',
    'chat.workflow.option.isekai-adventure': '异世界冒险',
    'chat.workflow.option.space-opera-prose': '太空歌剧文风',
    'chat.workflow.option.cyberpunk-noir': '赛博朋克黑色文风',
    'chat.workflow.option.post-apocalyptic-survival': '末世生存',
    'chat.workflow.option.dystopian-drama': '反乌托邦戏剧',
    'chat.workflow.option.occult-mystery': '神秘学悬疑',
    'chat.workflow.option.cosmic-horror-prose': '宇宙恐怖文风',
    'chat.workflow.option.psychological-thriller': '心理惊悚',
    'chat.workflow.option.cozy-mystery': '舒适悬疑',
    'chat.workflow.option.crime-drama': '犯罪剧',
    'chat.workflow.option.medical-drama': '医疗剧',
    'chat.workflow.option.legal-drama': '律政剧',
    'chat.workflow.option.political-intrigue': '政治阴谋',
    'chat.workflow.option.military-sci-fi': '军事科幻',
    'chat.workflow.option.slow-burn-romance': '慢热恋爱',
    'chat.workflow.option.office-romance': '职场恋爱',
    'chat.workflow.option.forbidden-romance': '禁忌恋爱',
    'chat.workflow.option.rivals-to-lovers': '宿敌变恋人',
    'chat.workflow.option.enemies-to-lovers': '敌人变恋人',
    'chat.workflow.option.childhood-friends': '青梅竹马',
    'chat.workflow.option.found-family': '找到的家人',
    'chat.workflow.option.hurt-comfort': '伤痛慰藉',
    'chat.workflow.option.angst-with-comfort': '虐心后慰藉',
    'chat.workflow.option.mentor-student-tension': '师生张力',
    'chat.workflow.option.arranged-marriage-drama': '包办婚姻戏剧',
    'chat.workflow.option.royal-court-romance': '宫廷恋爱',
    'chat.workflow.option.monster-romance': '怪物恋爱',
    'chat.workflow.option.paranormal-romance': '超自然恋爱',
    'chat.workflow.option.yandere-tension': '病娇张力',
    'chat.workflow.option.obsessive-devotion': '偏执奉献',
    'chat.workflow.option.toxic-romance-drama': '有毒关系戏剧',
    'chat.workflow.option.dark-adult-drama': '黑暗成人戏剧',
    'chat.workflow.option.power-imbalance-drama': '权力不对等戏剧',
    'chat.workflow.option.mature-psychological-romance': '成熟心理恋爱',
    'chat.workflow.option.taboo-tension-drama': '禁忌张力戏剧',
    'chat.workflow.option.jealousy-and-possession': '嫉妒与占有',
    'chat.workflow.option.betrayal-and-reconciliation': '背叛与和解',
    'chat.workflow.option.domestic-suspense': '亲密关系悬疑',
    'chat.workflow.option.melodrama': '情节剧',
    'chat.workflow.option.soap-opera': '肥皂剧',
    'chat.workflow.option.comedic-banter': '喜剧拌嘴',
    'chat.workflow.option.dry-wit': '冷幽默',
    'chat.workflow.option.satirical-prose': '讽刺文风',
    'chat.workflow.option.wholesome-comfort': '健康慰藉',
    'chat.workflow.option.healing-slow-life': '治愈慢生活',
    'chat.workflow.option.dreamlike-surreal': '梦境超现实',
    'chat.workflow.option.liminal-horror': '阈限恐怖',
    'chat.workflow.option.fairytale-retelling': '童话改写',
    'chat.workflow.option.mythic-legendary': '神话传奇',
    'chat.workflow.option.picaresque-adventure': '流浪汉冒险',
    'chat.workflow.option.journal-entry-style': '日记体',
    'chat.workflow.option.epistolary-style': '书信体',
    'chat.workflow.option.chat-log-style': '聊天记录体',
    'chat.workflow.option.scenario-card-direct': '场景卡直写',
    'chat.workflow.option.sillytavern-natural-card': 'SillyTavern 自然卡',
    'chat.workflow.option.ali-chat-dialogue-samples': 'Ali:Chat 对话样例',
    'chat.workflow.option.w-plus-plus-structured': 'W++ 结构化',
    'chat.workflow.option.longform-novelistic-rp': '长篇小说式 RP',
    'chat.workflow.option.auto': '自动',
    'chat.workflow.option.close-up': '特写',
    'chat.workflow.option.bust': '胸像',
    'chat.workflow.option.knee-up': '膝上构图',
    'chat.workflow.option.wide-scene': '广角场景',
    'chat.workflow.option.lock-character': '锁定角色',
    'chat.workflow.option.vary-slightly': '轻微变化',
    'chat.workflow.option.explore': '探索变化',
    'chat.workflow.option.1:1': '1:1',
    'chat.workflow.option.2:3': '2:3',
    'chat.workflow.option.3:4': '3:4',
    'chat.workflow.option.4:5': '4:5',
    'chat.workflow.option.16:9': '16:9',
    'chat.workflow.option.9:16': '9:16',
    'chat.workflow.option.roleplay-character-avatar': '角色卡头像',
    'chat.workflow.option.photoreal-portrait': '写实肖像',
    'chat.workflow.option.photoreal': '真人写实',
    'chat.workflow.option.anime': '动漫',
    'chat.workflow.option.illustration': '插画',
    'chat.workflow.option.stylized': '风格化',
    'chat.workflow.option.cinematic-realism': '电影写实',
    'chat.workflow.option.editorial-photography': '编辑摄影',
    'chat.workflow.option.high-fashion-editorial': '高级时装大片',
    'chat.workflow.option.magazine-cover-gloss': '杂志封面光泽',
    'chat.workflow.option.analog-film': '胶片摄影',
    'chat.workflow.option.35mm-film-still': '35mm 电影剧照',
    'chat.workflow.option.polaroid': '拍立得',
    'chat.workflow.option.disposable-camera': '一次性相机',
    'chat.workflow.option.lomography': 'Lomo 摄影',
    'chat.workflow.option.film-noir': '黑色电影',
    'chat.workflow.option.dreamy-soft-focus': '梦幻柔焦',
    'chat.workflow.option.bokeh-portrait': '虚化肖像',
    'chat.workflow.option.wet-plate-photo': '湿版摄影',
    'chat.workflow.option.infrared-photo': '红外摄影',
    'chat.workflow.option.greasy-glossy-aesthetic': '油腻光泽美学',
    'chat.workflow.option.oily-skin-glow': '油润皮肤光泽',
    'chat.workflow.option.dewy-beauty-lighting': '水润美妆光',
    'chat.workflow.option.plastic-gloss': '塑料光泽',
    'chat.workflow.option.latex-shine': '乳胶高光',
    'chat.workflow.option.oil-painting': '油画',
    'chat.workflow.option.impasto-oil-painting': '厚涂油画',
    'chat.workflow.option.classical-portrait-painting': '古典肖像画',
    'chat.workflow.option.renaissance-painting': '文艺复兴绘画',
    'chat.workflow.option.baroque-painting': '巴洛克绘画',
    'chat.workflow.option.rococo-painting': '洛可可绘画',
    'chat.workflow.option.neoclassical-painting': '新古典主义绘画',
    'chat.workflow.option.romanticism-painting': '浪漫主义绘画',
    'chat.workflow.option.realist-painting': '现实主义绘画',
    'chat.workflow.option.impressionist-painting': '印象派绘画',
    'chat.workflow.option.post-impressionist-painting': '后印象派绘画',
    'chat.workflow.option.expressionist-painting': '表现主义绘画',
    'chat.workflow.option.fauvism-painting': '野兽派绘画',
    'chat.workflow.option.cubist-painting': '立体主义绘画',
    'chat.workflow.option.surrealist-painting': '超现实主义绘画',
    'chat.workflow.option.symbolist-painting': '象征主义绘画',
    'chat.workflow.option.abstract-expressionism': '抽象表现主义',
    'chat.workflow.option.pop-art': '波普艺术',
    'chat.workflow.option.op-art': '欧普艺术',
    'chat.workflow.option.minimalist-art': '极简艺术',
    'chat.workflow.option.art-nouveau': '新艺术运动',
    'chat.workflow.option.art-deco': '装饰艺术',
    'chat.workflow.option.bauhaus-poster': '包豪斯海报',
    'chat.workflow.option.constructivist-poster': '构成主义海报',
    'chat.workflow.option.suprematist-abstraction': '至上主义抽象',
    'chat.workflow.option.watercolor': '水彩',
    'chat.workflow.option.loose-watercolor': '松弛水彩',
    'chat.workflow.option.gouache': '水粉',
    'chat.workflow.option.acrylic-painting': '丙烯绘画',
    'chat.workflow.option.pastel-drawing': '粉彩画',
    'chat.workflow.option.charcoal-drawing': '炭笔画',
    'chat.workflow.option.graphite-sketch': '石墨素描',
    'chat.workflow.option.colored-pencil': '彩色铅笔',
    'chat.workflow.option.ink-drawing': '墨线画',
    'chat.workflow.option.ink-wash': '水墨渲染',
    'chat.workflow.option.sumi-e': '墨绘',
    'chat.workflow.option.ukiyo-e': '浮世绘',
    'chat.workflow.option.woodblock-print': '木版画',
    'chat.workflow.option.linocut-print': '亚麻胶版画',
    'chat.workflow.option.etching': '蚀刻版画',
    'chat.workflow.option.lithograph': '石版画',
    'chat.workflow.option.risograph-print': '孔版印刷',
    'chat.workflow.option.screen-print': '丝网印刷',
    'chat.workflow.option.collage': '拼贴',
    'chat.workflow.option.mixed-media': '混合媒介',
    'chat.workflow.option.digital-painting': '数字绘画',
    'chat.workflow.option.concept-art': '概念艺术',
    'chat.workflow.option.matte-painting': '遮罩绘景',
    'chat.workflow.option.splash-art': '游戏宣传原画',
    'chat.workflow.option.trading-card-art': '卡牌插画',
    'chat.workflow.option.character-sheet': '角色设定表',
    'chat.workflow.option.model-sheet': '模型设定表',
    'chat.workflow.option.turnaround-reference': '转面参考图',
    'chat.workflow.option.anime-key-visual': '动画主视觉',
    'chat.workflow.option.anime-screenshot': '动画截图',
    'chat.workflow.option.cel-shaded-anime': '赛璐璐动画',
    'chat.workflow.option.semi-realistic-anime': '半写实动画',
    'chat.workflow.option.90s-anime': '90 年代动画',
    'chat.workflow.option.retro-anime': '复古动画',
    'chat.workflow.option.shoujo-manga': '少女漫画',
    'chat.workflow.option.shonen-manga': '少年漫画',
    'chat.workflow.option.seinen-manga': '青年漫画',
    'chat.workflow.option.josei-manga': '女性漫画',
    'chat.workflow.option.chibi': 'Q 版',
    'chat.workflow.option.moe': '萌系',
    'chat.workflow.option.mecha-anime': '机甲动画',
    'chat.workflow.option.magical-girl': '魔法少女',
    'chat.workflow.option.cyberpunk-anime': '赛博朋克动画',
    'chat.workflow.option.game-cg': '游戏 CG',
    'chat.workflow.option.visual-novel-cg': '视觉小说 CG',
    'chat.workflow.option.light-novel-cover': '轻小说封面',
    'chat.workflow.option.manga-screentone': '漫画网点',
    'chat.workflow.option.webtoon': '条漫',
    'chat.workflow.option.manhwa': '韩漫',
    'chat.workflow.option.comic-book': '美式漫画',
    'chat.workflow.option.graphic-novel': '图像小说',
    'chat.workflow.option.noir-comic': '黑色漫画',
    'chat.workflow.option.pulp-comic': '低俗小说漫画',
    'chat.workflow.option.ligne-claire': '清线派',
    'chat.workflow.option.children-book-illustration': '童书插画',
    'chat.workflow.option.sticker-art': '贴纸风格',
    'chat.workflow.option.emoji-style': '表情符号风格',
    'chat.workflow.option.tattoo-flash': '纹身闪稿',
    'chat.workflow.option.flat-vector': '扁平矢量',
    'chat.workflow.option.isometric-illustration': '等距插画',
    'chat.workflow.option.low-poly-3d': '低多边形 3D',
    'chat.workflow.option.voxel-art': '体素艺术',
    'chat.workflow.option.pixel-art': '像素艺术',
    'chat.workflow.option.8-bit-pixel-art': '8-bit 像素艺术',
    'chat.workflow.option.16-bit-pixel-art': '16-bit 像素艺术',
    'chat.workflow.option.ps1-low-poly': 'PS1 低多边形',
    'chat.workflow.option.clay-render': '黏土渲染',
    'chat.workflow.option.claymation': '黏土动画',
    'chat.workflow.option.stop-motion': '定格动画',
    'chat.workflow.option.toy-photography': '玩具摄影',
    'chat.workflow.option.vinyl-figure': '乙烯基手办',
    'chat.workflow.option.3d-animated-film': '3D 动画电影',
    'chat.workflow.option.path-traced-3d': '路径追踪 3D',
    'chat.workflow.option.product-render': '产品渲染',
    'chat.workflow.option.architectural-visualization': '建筑可视化',
    'chat.workflow.option.technical-illustration': '技术插画',
    'chat.workflow.option.blueprint-drawing': '蓝图绘制',
    'chat.workflow.option.cyberpunk': '赛博朋克',
    'chat.workflow.option.solarpunk': '太阳朋克',
    'chat.workflow.option.steampunk': '蒸汽朋克',
    'chat.workflow.option.dieselpunk': '柴油朋克',
    'chat.workflow.option.biopunk': '生物朋克',
    'chat.workflow.option.retrofuturism': '复古未来主义',
    'chat.workflow.option.cassette-futurism': '磁带未来主义',
    'chat.workflow.option.y2k-aesthetic': 'Y2K 美学',
    'chat.workflow.option.frutiger-aero': 'Frutiger Aero',
    'chat.workflow.option.vaporwave': '蒸汽波',
    'chat.workflow.option.synthwave': '合成波',
    'chat.workflow.option.outrun': 'Outrun',
    'chat.workflow.option.psychedelic-poster': '迷幻海报',
    'chat.workflow.option.blacklight-poster': '黑光海报',
    'chat.workflow.option.acid-graphics': '酸性平面',
    'chat.workflow.option.brutalist-graphic-design': '粗野主义平面设计',
    'chat.workflow.option.swiss-poster': '瑞士海报',
    'chat.workflow.option.vintage-travel-poster': '复古旅行海报',
    'chat.workflow.option.propaganda-poster': '宣传画',
    'chat.workflow.option.dark-fantasy': '黑暗幻想',
    'chat.workflow.option.high-fantasy': '高幻想',
    'chat.workflow.option.gothic-horror': '哥特恐怖',
    'chat.workflow.option.cosmic-horror': '宇宙恐怖',
    'chat.workflow.option.occult-illustration': '神秘学插画',
    'chat.workflow.option.kawaii-pastel': '可爱粉彩',
    'chat.workflow.option.harajuku-street-style': '原宿街头风',
    'chat.workflow.option.fairycore': '仙境核',
    'chat.workflow.option.cottagecore': '田园核',
    'chat.workflow.option.dreamcore': '梦核',
    'chat.workflow.option.weirdcore': '怪核',
    'chat.workflow.option.liminal-space': '阈限空间',
    'chat.workflow.option.grunge-poster': '垃圾摇滚海报',
    'chat.workflow.option.punk-zine': '朋克小志',
    'chat.workflow.option.metal-album-cover': '金属专辑封面',
    'chat.workflow.slot.assets': '资源',
    'chat.workflow.slot.card': '角色卡',
    'chat.workflow.slot.candidate': '候选',
    'chat.workflow.slot.constraint': '约束',
    'chat.workflow.slot.continuity': '连续性',
    'chat.workflow.slot.critique': '自评',
    'chat.workflow.slot.export': '导出',
    'chat.workflow.slot.field': '字段',
    'chat.workflow.slot.fieldControl': '字段控制',
    'chat.workflow.slot.fieldTarget': '字段',
    'chat.workflow.slot.goal': '目标',
    'chat.workflow.slot.image': '图片',
    'chat.workflow.slot.imageAsset': '图片',
    'chat.workflow.slot.imageControl': '图片控制',
    'chat.workflow.slot.imageTarget': '图片目标',
    'chat.workflow.slot.model': '模型',
    'chat.workflow.slot.policy': '策略',
    'chat.workflow.slot.plot': '剧情',
    'chat.workflow.slot.report': '报告',
    'chat.workflow.slot.resource': '资源',
    'chat.workflow.slot.retrieval': '检索',
    'chat.workflow.slot.target': '目标资源',
    'chat.workflow.slot.npc': 'NPC',
    'chat.workflow.slot.npcPack': 'NPC 包',
    'chat.workflow.slot.relationship': '关系',
    'chat.workflow.slot.scene': '场景',
    'chat.workflow.slot.source': '素材',
    'chat.workflow.slot.strategy': '策略',
    'chat.workflow.slot.style': '风格',
    'chat.workflow.slot.voice': '语音',
    'chat.workflow.slot.world': '世界',
    'chat.workflow.source.agent': 'Agent',
    'chat.workflow.source.asset': '资源',
    'chat.workflow.source.core': '核心',
    'chat.workflow.source.safety': '安全',
    'chat.search': '搜索历史角色或对话',
    'chat.subtitle': '历史角色对话',
    'chat.threadEva': '陈千语基础资料已接入。',
    'chat.threadRuntime': '流式文本、工具调用和本地任务状态',
    'chat.title': '会话',
    'status.connectionFailed': 'Connection failed',
    'status.initializing': 'Initializing...',
    'status.listening': 'Listening...',
    'status.latency': '延迟: {ms}ms',
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
    'nav.learning': '学习',
    'nav.personality': '人格',
    'nav.plugins': '插件',
    'nav.system': '系统',
    'nav.voice': '语音',
    'nav.models': '模型',
    'nav.logs': '日志',
    'appearance.title': '页面设置',
    'appearance.orbStyle': '小球样式',
    'appearance.orbStyleDesc': '选择主界面小球的视觉表现。',
    'appearance.defaultOrb': '流光',
    'appearance.advancedOrb': '琥珀',
    'appearance.planetOrb': '光晕',
    'appearance.theme': '界面模式',
    'appearance.themeDesc': '切换控制区域的明暗显示。',
    'appearance.themeNight': '夜间',
    'appearance.themeDay': '白天',
    'appearance.liquidGlass': '液态水效果',
    'appearance.liquidGlassDesc': '关闭设置面板的液态覆盖层以降低 GPU 占用。',
    'appearance.dragonCursor': '游龙效果',
    'appearance.dragonCursorDesc': '在设置面板中显示跟随鼠标游动的龙形光标。',
    'experimental.title': '实验功能',
    'experimental.selfLearning': '自动学习',
    'experimental.selfLearningDesc': '允许自动记录 runtime 事件、生成学习候选和创建 specialized agents。关闭后相关后台流程全部停用。',
    'learning.disabled': '自动学习已关闭。开启实验功能里的“自动学习”后，这里才会记录事件、反思和 agents。',
    'models.title': '模型设置',
    'voice.input': '语音输入',
    'voice.inputDesc': '使用麦克风进行语音对话',
    'voice.output': '语音输出',
    'voice.outputDesc': 'EVA 以语音方式回复',
    'voice.title': '语音设置',
    'voice.volume': '音量',
    'voice.outputEnabled': '语音输出已开启',
    'voice.outputDisabled': '语音输出已关闭',
    'voice.micPermissionSettings': '请在系统设置中开启麦克风权限',
    'voice.micPermissionDenied': '麦克风权限未授予',
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
    'memory.loadFailed': '加载失败',
    'memory.profileEmpty': 'EVA 还不太了解你，多聊聊吧',
    'memory.importantEmpty': '暂无重要记忆',
    'memory.summaryEmpty': '暂无对话摘要',
    'memory.conversationEmpty': '暂无对话记录',
    'memory.accountEmpty': '暂无账户信息',
    'memory.userRole': '你',
    'memory.profileCleared': '用户画像已清空',
    'memory.importantCleared': '重要记忆已清空',
    'memory.summariesCleared': '对话摘要已清空',
    'memory.conversationsCleared': '最近对话已清空',
    'memory.allReset': '所有数据已重置',
    'memory.accountDeleted': '账户信息已删除',
    'memory.accountCleared': '账户信息已清空',
    'memory.clearFailed': '清空失败',
    'memory.memoryDeleted': '记忆已删除',
    'memory.sensitivitySecret': '敏感',
    'memory.sensitivityVerification': '验证',
    'memory.sensitivityNormal': '普通',
    'memory.field.nickname': '称呼',
    'memory.field.name': '姓名',
    'memory.field.age': '年龄',
    'memory.field.gender': '性别',
    'memory.field.location': '所在地',
    'memory.field.occupation': '职业',
    'memory.field.currentMood': '当前心情',
    'memory.confirm.clearProfile.title': '清空用户画像',
    'memory.confirm.clearProfile.message': '将移除 EVA 已整理的个人信息、偏好和标签。',
    'memory.confirm.clearProfile.detail': '之后可以通过新的对话重新建立画像。',
    'memory.confirm.clearImportant.title': '清空重要记忆',
    'memory.confirm.clearImportant.message': '将删除所有被标记为重要的长期记忆。',
    'memory.confirm.clearImportant.detail': '这个操作不会影响用户画像和对话摘要。',
    'memory.confirm.clearSummaries.title': '清空对话摘要',
    'memory.confirm.clearSummaries.message': '将删除已压缩保存的历史对话摘要。',
    'memory.confirm.clearSummaries.detail': '最近对话和用户画像不会被同时清空。',
    'memory.confirm.clearConversations.title': '清空最近对话',
    'memory.confirm.clearConversations.message': '将清空当前工作记忆里的最近对话记录。',
    'memory.confirm.clearConversations.detail': 'EVA 会从新的上下文重新开始对话。',
    'memory.confirm.resetAll.title': '重置所有记忆',
    'memory.confirm.resetAll.message': '将清除用户画像、重要记忆、账户信息、对话摘要和最近对话。',
    'memory.confirm.resetAll.detail': '此操作不可恢复。',
    'memory.confirm.deleteProfile.title': '删除画像字段',
    'memory.confirm.deleteProfile.message': '将删除“{name}”。',
    'memory.confirm.deleteProfile.detail': '删除后可以在新的对话中重新补充。',
    'memory.confirm.deleteImportant.title': '删除重要记忆',
    'memory.confirm.deleteImportant.message': '将删除“{name}”。',
    'memory.confirm.deleteImportant.detail': '这条长期记忆不会再参与后续上下文。',
    'memory.confirm.deleteSummary.title': '删除对话摘要',
    'memory.confirm.deleteSummary.message': '将删除这条已压缩保存的历史对话摘要。',
    'memory.confirm.deleteSummary.detail': '其他摘要和最近对话不会受到影响。',
    'memory.confirm.deleteConversation.title': '删除最近对话',
    'memory.confirm.deleteConversation.message': '将从工作记忆中删除这条最近对话。',
    'memory.confirm.deleteConversation.detail': '这不会删除其他记忆内容。',
    'memory.confirm.deleteAccount.title': '删除账户信息',
    'memory.confirm.deleteAccount.message': '将删除“{name}”。',
    'memory.confirm.deleteAccount.detail': '之后如果任务仍需要这项信息，会重新向你请求。',
    'memory.confirm.clearAccount.title': '清空账户信息',
    'memory.confirm.clearAccount.message': '将删除所有由任务执行保存的账号、密钥、密码和固定配置。',
    'memory.confirm.clearAccount.detail': '普通记忆和对话历史不会被同时清除。',
    'learning.title': '自学习',
    'learning.open': '进入',
    'learning.desc': '查看 runtime events、反思记录、候选学习资产和 specialized agents。',
    'learning.reflect': '反思最近事件',
    'learning.events': '事件',
    'learning.reflections': '反思',
    'learning.candidates': '候选',
    'learning.assets': '资产',
    'learning.agents': 'Agents',
    'learning.decisions': '自动化决策',
    'learning.rollbacks': '回滚',
    'learning.empty': '暂无数据',
    'learning.loadFailed': 'Learning 加载失败: {error}',
    'learning.deployFailed': '部署失败: {error}',
    'learning.updateFailed': '更新失败: {error}',
    'learning.rollbackFailed': '回滚失败: {error}',
    'learning.viewOverview': '概览',
    'learning.viewAgents': 'Agents',
    'learning.viewCandidates': '候选',
    'learning.viewAssets': '资产',
    'learning.viewActivity': '活动',
    'learning.health': '学习健康度',
    'learning.healthReady': '稳定',
    'learning.healthNeedsReview': '需要审查',
    'learning.pendingReview': '待审查',
    'learning.activeAssets': '活跃资产',
    'learning.activeAgents': '活跃 Agents',
    'learning.recentSignals': '最近信号',
    'learning.queue': '审查队列',
    'learning.operations': '运行面板',
    'learning.agentControl': 'Agent 控制台',
    'learning.assetLibrary': '学习资产库',
    'learning.activityTimeline': '活动时间线',
    'learning.openDetail': '查看详情',
    'learning.detail': '详情',
    'learning.noSelection': '选择左侧条目查看详情。',
    'learning.activate': '启用',
    'learning.disable': '停用',
    'learning.archive': '归档',
    'learning.rollback': '回滚',
    'learning.createDraft': '生成草稿',
    'learning.kind': '类型',
    'learning.status': '状态',
    'learning.confidence': '置信度',
    'learning.risk': '风险',
    'learning.mode': '模式',
    'learning.scope': '范围',
    'learning.routingPolicy': '路由策略',
    'learning.capabilities': '能力',
    'learning.evidence': '证据',
    'learning.expectedBenefit': '预期收益',
    'learning.createdAt': '创建时间',
    'learning.updatedAt': '更新时间',
    'learning.emptyHint': '这里暂时没有可管理对象。',
    'personality.addFile': '添加角色文件',
    'personality.addFileDesc': '选择外部 .yml/.yaml 文件，校验通过后加入人格列表',
    'personality.current': '当前人格',
    'personality.currentDesc': '选择 AI 伴侣的人格配置',
    'personality.title': '人格',
    'personality.externalFile': '外部文件',
    'personality.listLoadFailed': '人格列表加载失败: {error}',
    'personality.switchFailed': '人格切换失败: {error}',
    'personality.switched': '人格已切换为 {name}',
    'personality.addFailed': '添加角色失败: {error}',
    'personality.addedAndSwitched': '已添加并切换为 {name}',
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
    'system.modelManager': '模型管理',
    'system.modelManagerDesc': '新增、测试、激活或删除模型配置',
    'system.configCount': '{count} 个配置',
    'system.ready': '已就绪',
    'system.missingPrefix': '缺少 {items}',
    'system.manage': '管理',
    'system.currentUsing': '当前使用 {model}',
    'system.needComplete': '需要补全 {items}',
    'system.notConfigured': '未配置',
    'system.config': '配置',
    'system.modelName': '模型名',
    'system.statusCheck': '状态检查',
    'system.installedRatio': '{installed}/{total} 已安装',
    'system.startupNeedsConfig': '启动前需要完成配置',
    'system.needConfigCount': '需要完成 {count} 项配置',
    'system.completeDialogueModel': '补全对话模型的模型名、API Key 和 Base URL',
    'system.completeTaskModel': '补全任务模型的模型名、API Key 和 Base URL',
    'system.completeTtsModel': '补全 TTS 的模型名、API Key 和 Voice ID',
    'system.completeTtsModelNoVoice': '补全 TTS 的模型名和 API Key',
    'system.completeAsrModel': '补全 ASR 的模型名和 API Key',
    'system.downloadMissingLocal': '下载缺失的本地模型：{models}',
    'system.checkLocalModels': '检查本地 VAD / SmartTurn 模型状态',
    'system.localModelStatusFailed': '本地模型状态返回失败',
    'system.localModelReady': '本地模型已就绪',
    'system.localModelDownloadFailed': '模型下载失败: {error}',
    'system.modelMissing': '模型配置不存在',
    'system.apiTestTitle': '测试 API 连接',
    'system.testing': '测试中',
    'system.connectionFailed': '连接失败',
    'system.apiOk': 'API 连接正常',
    'system.apiFailed': 'API 测试失败: {error}',
    'system.voiceIdPlaceholder': '音色 ID',
    'system.languagePlaceholderOptional': 'zh / en（可选）',
    'logs.loadFailed': '日志加载失败',
    'logs.empty': '暂无日志',
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
    'plugins.marketplace': '插件市场',
    'plugins.installed': '本地插件',
    'plugins.refresh': '刷新',
    'plugins.refreshing': '刷新中...',
    'plugins.install': '安装',
    'plugins.installing': '安装中...',
    'plugins.installedNotice': '插件已安装',
    'plugins.installFailed': '插件安装失败: {error}',
    'plugins.marketplaceCached': '缓存于 {time}',
    'plugins.marketplaceFetched': '更新于 {time}',
    'plugins.marketplaceRefreshFailed': '刷新失败: {error}',
    'plugins.marketplaceSearch': '搜索插件、标签或描述',
    'plugins.marketplaceEmpty': '未找到匹配的远程插件',
    'plugins.marketplaceUnavailable': '插件市场暂不可用',
    'plugins.marketplaceSource': '来源',
    'plugins.viewSource': '查看仓库',
    'plugins.installedStatus': '已安装',
    'plugins.enabledStatus': '已启用',
    'plugins.availableStatus': '可获取',
    'plugins.uninstall': '卸载插件',
    'plugins.uninstallTitle': '卸载插件',
    'plugins.uninstallConfirm': '将从本地删除 {name} 的插件目录。这个操作无法撤销。',
    'plugins.uninstalled': '插件已卸载',
    'plugins.uninstallFailed': '插件卸载失败: {error}',
    'plugins.dangerZone': '危险操作',
    'plugins.uninstallDesc': '从本机删除这个插件目录。若插件正在运行，运行时会在下一次插件重载后完全移除。',
    'plugins.loadFailed': '插件加载失败',
    'plugins.uiLoadFailed': '插件 UI 加载失败',
    'plugins.empty': '未发现插件',
    'plugins.configCount': '{count} 个参数',
    'plugins.noConfig': '无可配置参数',
    'plugins.uiHookCount': '{count} 个界面 hook',
    'plugins.advancedModelParams': '高级模型参数',
    'plugins.advancedModelParamsDesc': '模型适配边距、位置、口型平滑、状态 motion 映射',
    'plugins.enabled': '插件已启用',
    'plugins.disabled': '插件已禁用',
    'plugins.updateFailed': '插件设置失败: {error}',
    'plugins.configUpdated': '插件参数已更新',
    'plugins.configSaveFailed': '插件参数保存失败: {error}',
    'plugins.pathUpdated': '插件路径已更新',
    'plugins.pathSelectFailed': '路径选择失败: {error}',
    'plugins.pathSelectFailedFallback': '路径选择失败',
    'plugins.directorySelectFailed': '目录选择失败',
    'plugins.fileSelectFailed': '文件选择失败',
    'plugins.missingResolvedFile': '目录中没有找到 {extensions} 文件',
    'plugins.chooseDirectory': '选择目录',
    'plugins.chooseFile': '选择文件',
    'plugins.choose': '选择',
    'plugins.chooseField': '选择{label}',
    'plugins.adminLoading': '加载管理信息...',
    'plugins.adminLoadFailed': '管理信息加载失败',
    'plugins.noAdminPanel': '这个插件没有声明管理面板。',
    'plugins.adminTitle': '插件管理',
    'plugins.noAdminActions': '暂无管理动作。',
    'plugins.actionFailed': '插件操作失败: {error}',
    'plugins.actionDone': '插件操作已完成',
    'plugins.mcpTitle': '远程 MCP Servers',
    'plugins.mcpSubtitle': '只管理远程 MCP HTTP endpoint，不启动本地命令。',
    'plugins.mcpIdPlaceholder': 'id，例如 github',
    'plugins.mcpNamePlaceholder': '名称，可选',
    'plugins.mcpHeadersPlaceholder': "Headers JSON，可选，例如 {\"authorization\":\"Bearer ...\"}",
    'plugins.mcpAdd': '添加远程 MCP',
    'plugins.mcpEmpty': '暂无远程 MCP server。',
    'plugins.mcpHeadersInvalid': 'Headers 必须是合法 JSON',
    'plugins.test': '测试',
    'plugins.testing': '测试中...',
    'plugins.testFailed': '测试失败',
    'plugins.skillsTitle': 'Skills Sources',
    'plugins.skillsSubtitle': '从 GitHub 或本地目录导入 SKILL.md。',
    'plugins.skillsGithubPlaceholder': 'GitHub URL，例如 https://github.com/user/repo',
    'plugins.skillsLocalPlaceholder': '本地 skills 目录路径',
    'plugins.skillsAddGithub': '添加 GitHub Source',
    'plugins.skillsAddLocal': '添加本地目录',
    'plugins.skillsEmpty': '暂无 skill source。',
    'plugins.skillsNoneInSource': '这个 source 下没有扫描到 SKILL.md。',
    'plugins.rescan': '更新',
    'plugins.live2dCapabilitiesLoading': '正在读取模型能力...',
    'plugins.live2dCapabilitiesUnavailable': '未读取到模型能力',
    'plugins.live2dCapabilitiesTitle': '模型能力',
    'plugins.live2dMotionGroups': 'Motion groups',
    'plugins.live2dExpressions': 'Expressions',
    'plugins.live2dLipSyncParams': 'LipSync 参数',
    'logs.title': '运行日志',
    'logs.desc': '按时间、等级和类型查看当前会话的运行状态。',
    'about.desc': '把一个鲜活的灵魂放进桌面。',
    'about.quote': '把语音、记忆、情绪、人格和工具连接起来，尝试做一个能聊天、能陪伴，也能和你一起做事的桌面 AI。',
    'about.title': '关于',
    'updates.kicker': '版本更新',
    'updates.idleTitle': '检查 Noema 是否有新版本',
    'updates.idleDesc': '更新提示只会出现在这里，不会打断当前对话。',
    'updates.check': '检查更新',
    'updates.checking': '检查中...',
    'updates.latestTitle': '当前已是最新版本',
    'updates.latestDesc': '当前版本 v{current}，上次检查 {time}。',
    'updates.availableTitle': '发现新版本 v{latest}',
    'updates.availableDesc': '当前版本 v{current}。这是非强制更新，你可以稍后再处理。',
    'updates.failedTitle': '暂时无法检查更新',
    'updates.failedDesc': '{error}',
    'updates.openRelease': '查看发布页',
    'notice.voiceInputDisabled': '语音输入已关闭',
    'notice.voiceInputEnabled': '语音输入已开启',
    'notice.orbCaptureCopied': '小球截图已复制到剪贴板',
    'notice.orbCaptureFailed': '截图失败：{error}',
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
    'common.increase': 'Increase',
    'common.decrease': 'Decrease',
    'common.manage': 'Manage',
    'common.continue': 'Continue',
    'common.activate': 'Activate',
    'common.active': 'Active',
    'common.delete': 'Delete',
    'common.loading': 'Loading...',
    'common.none': 'None',
    'common.items': '{count} items',
    'common.records': '{count} records',
    'common.failed': 'Failed',
    'common.ready': 'OK',
    'common.deleted': 'Deleted',
    'common.deleteFailed': 'Delete failed',
    'common.empty': '(empty)',
    'common.show': 'Show',
    'common.hide': 'Hide',
    'common.updatedAt': 'Updated {time}',
    'context.captureOrb': 'Capture Orb',
    'context.chat': 'Chat',
    'context.clearHistory': 'Clear Conversation',
    'context.settings': 'System Panel',
    'entry.chat': 'Chat',
    'entry.system': 'System',
    'chat.background': 'Background',
    'chat.characterProfile': 'Character profile',
    'chat.identity': 'Chen Qianyu',
    'chat.kicker': 'Noema chat',
    'chat.navArchive': 'Archive',
    'chat.navAssets': 'Assets',
    'chat.navCharacters': 'Characters',
    'chat.navConversations': 'Conversations',
    'chat.navRuntime': 'Runtime',
    'chat.navSession': 'Session',
    'chat.navVoice': 'Voice',
    'chat.new': 'New',
    'chat.placeholder': 'Write a message...',
    'chat.profileDesc': 'Independent character resources describe the character itself, without UI state or test-flow fields.',
    'chat.profileTags': 'Tags',
    'chat.resourceKicker': 'Character resource',
    'chat.workflow.category.Agent': 'Agent',
    'chat.workflow.category.Assets': 'Assets',
    'chat.workflow.category.Constraints': 'Constraints',
    'chat.workflow.category.Controls': 'Controls',
    'chat.workflow.category.Evaluation': 'Evaluation',
    'chat.workflow.category.Goal': 'Goal',
    'chat.workflow.category.Model': 'Model',
    'chat.workflow.category.Outputs': 'Outputs',
    'chat.workflow.category.Sources': 'Sources',
    'chat.workflow.category.Strategy': 'Strategy',
    'chat.workflow.category.Targets': 'Targets',
    'chat.workflow.category.Taste': 'Taste',
    'chat.workflow.node.agent-policy': 'Agent Policy',
    'chat.workflow.node.character-card-target': 'Character Card Target',
    'chat.workflow.node.character-field-target': 'Character Field Target',
    'chat.workflow.node.continuity-control': 'Continuity Control',
    'chat.workflow.node.constraint': 'Hard Constraint',
    'chat.workflow.node.critique-loop': 'Critique Loop',
    'chat.workflow.node.field-generation-control': 'Field Generation Control',
    'chat.workflow.node.generation-strategy': 'Generation Strategy',
    'chat.workflow.node.goal': 'Generation Goal',
    'chat.workflow.node.image-generation-control': 'Image Generation Control',
    'chat.workflow.node.image-target': 'Image Target',
    'chat.workflow.node.image-tool': 'Image Model',
    'chat.workflow.node.llm-tool': 'Language Model',
    'chat.workflow.node.material-document-resource': 'Text Resource',
    'chat.workflow.node.material-image-resource': 'Image Resource',
    'chat.workflow.node.npc-pack-target': 'NPC Pack Target',
    'chat.workflow.node.npc-target': 'NPC Target',
    'chat.workflow.node.opening-layout-target': 'Opening Layout Target',
    'chat.workflow.node.output-adapter': 'Output Adapter',
    'chat.workflow.node.plot-arc-target': 'Plot Arc Target',
    'chat.workflow.node.quality-gate': 'Quality Gate',
    'chat.workflow.node.relationship-control': 'Relationship Control',
    'chat.workflow.node.retrieval-tool': 'Retrieval Tool',
    'chat.workflow.node.scene-card-target': 'Scene Card Target',
    'chat.workflow.node.source-material': 'Source Material',
    'chat.workflow.node.style-pressure': 'Style Pressure',
    'chat.workflow.node.voice-tool': 'Voice Tool',
    'chat.workflow.node.world-card-target': 'World Card Target',
    'chat.workflow.param.allowAgentExpansion': 'Allow Agent Expansion',
    'chat.workflow.param.arcShape': 'Arc Shape',
    'chat.workflow.param.aspectRatio': 'Aspect Ratio',
    'chat.workflow.param.assetPurpose': 'Asset Purpose',
    'chat.workflow.param.appealMode': 'Appeal Mode',
    'chat.workflow.param.askUserThreshold': 'Ask User Threshold',
    'chat.workflow.param.autoRepair': 'Auto Repair',
    'chat.workflow.param.avoidPatterns': 'Avoid Patterns',
    'chat.workflow.param.backgroundInteraction': 'Background / Prop Interaction',
    'chat.workflow.param.blockExport': 'Block Export',
    'chat.workflow.param.branchCount': 'Branch Count',
    'chat.workflow.param.citationRequired': 'Citation Required',
    'chat.workflow.param.composition': 'Composition',
    'chat.workflow.param.compositionFreedom': 'Composition Freedom',
    'chat.workflow.param.consistencyMode': 'Consistency Mode',
    'chat.workflow.param.dimensions': 'Dimensions',
    'chat.workflow.param.editModelRef': 'Edit Model / Workflow',
    'chat.workflow.param.enabled': 'Enabled',
    'chat.workflow.param.fields': 'Fields',
    'chat.workflow.param.fieldPurpose': 'Field Purpose',
    'chat.workflow.param.format': 'Format',
    'chat.workflow.param.forbidResettingFacts': 'Forbid Resetting Facts',
    'chat.workflow.param.goalPrompt': 'Goal Prompt',
    'chat.workflow.param.groundingStrength': 'Grounding Strength',
    'chat.workflow.param.hardBoundary': 'Hard Boundary',
    'chat.workflow.param.imageRole': 'Image Role',
    'chat.workflow.param.imageStyleDomain': 'Style Domain',
    'chat.workflow.param.identityStrength': 'Identity Strength',
    'chat.workflow.param.imageType': 'Image Type',
    'chat.workflow.param.imageTypes': 'Image Types',
    'chat.workflow.param.includeAlternates': 'Include Alternates',
    'chat.workflow.param.includeAssets': 'Include Assets',
    'chat.workflow.param.includeFields': 'Include Fields',
    'chat.workflow.param.includeSections': 'Include Sections',
    'chat.workflow.param.includeSupportFields': 'Support Fields',
    'chat.workflow.param.intensity': 'Intensity',
    'chat.workflow.param.iterations': 'Iterations',
    'chat.workflow.param.lengthPolicy': 'Length Policy',
    'chat.workflow.param.layoutKind': 'Layout Kind',
    'chat.workflow.param.layoutPrompt': 'Layout Prompt',
    'chat.workflow.param.memoryAnchors': 'Memory Anchors',
    'chat.workflow.param.milestoneCount': 'Milestone Count',
    'chat.workflow.param.minimumScore': 'Minimum Score',
    'chat.workflow.param.modelRef': 'Model',
    'chat.workflow.param.mode': 'Mode',
    'chat.workflow.param.mustHave': 'Must Have',
    'chat.workflow.param.mustNot': 'Must Not',
    'chat.workflow.param.materials': 'Materials',
    'chat.workflow.param.notes': 'Notes',
    'chat.workflow.param.npcCount': 'NPC Count',
    'chat.workflow.param.npcRole': 'NPC Role',
    'chat.workflow.param.npcRoles': 'NPC Roles',
    'chat.workflow.param.preset': 'Preset',
    'chat.workflow.param.poseGoals': 'Pose Goals',
    'chat.workflow.param.progressionPacing': 'Progression Pacing',
    'chat.workflow.param.promptPurpose': 'Prompt Purpose',
    'chat.workflow.param.provider': 'Provider',
    'chat.workflow.param.purpose': 'Purpose',
    'chat.workflow.param.priorityAssets': 'Priority Assets',
    'chat.workflow.param.reasoningEffort': 'Reasoning Effort',
    'chat.workflow.param.referenceStrength': 'Reference Strength',
    'chat.workflow.param.relationshipMode': 'Relationship Mode',
    'chat.workflow.param.requiredChecks': 'Required Checks',
    'chat.workflow.param.revisionBudget': 'Revision Budget',
    'chat.workflow.param.sceneCount': 'Scene Count',
    'chat.workflow.param.sceneTypes': 'Scene Types',
    'chat.workflow.param.scope': 'Scope',
    'chat.workflow.param.scopePrompt': 'Scope Prompt',
    'chat.workflow.param.seedMode': 'Seed Mode',
    'chat.workflow.param.sensualityLevel': 'Sensuality Level',
    'chat.workflow.param.shotType': 'Shot Type',
    'chat.workflow.param.sourceKind': 'Source Kind',
    'chat.workflow.param.speed': 'Speed',
    'chat.workflow.param.storyFunction': 'Story Function',
    'chat.workflow.param.stylePrompt': 'Style Prompt',
    'chat.workflow.param.targetAudience': 'Target Audience',
    'chat.workflow.param.targetKind': 'Target Kind',
    'chat.workflow.param.targets': 'Targets',
    'chat.workflow.param.targetImageCount': 'Image Count',
    'chat.workflow.param.temperature': 'Temperature',
    'chat.workflow.param.tensionRules': 'Tension Rules',
    'chat.workflow.param.tone': 'Tone',
    'chat.workflow.param.autonomyLevel': 'Autonomy Level',
    'chat.workflow.param.voice': 'Voice',
    'chat.workflow.param.wardrobeExposure': 'Wardrobe / Exposure',
    'chat.workflow.param.worldSections': 'World Sections',
    'chat.workflow.param.image-tool.modelRef': 'Model / Workflow',
    'chat.workflow.param.image-tool.editModelRef': 'Edit Model / Workflow',
    'chat.workflow.option.adventure-campaign': 'Adventure Campaign',
    'chat.workflow.option.ambiguous-ally': 'Ambiguous Ally',
    'chat.workflow.option.ally': 'Ally',
    'chat.workflow.option.antagonist': 'Antagonist',
    'chat.workflow.option.appearance': 'Appearance',
    'chat.workflow.option.asymmetric-information': 'Asymmetric Information',
    'chat.workflow.option.asking-user-intent': 'Asking User Intent',
    'chat.workflow.option.avatar': 'Avatar',
    'chat.workflow.option.background': 'Background',
    'chat.workflow.option.body': 'Body',
    'chat.workflow.option.blocked-only': 'Blocked Only',
    'chat.workflow.option.boundaries': 'Boundaries',
    'chat.workflow.option.branch-and-refine': 'Branch and Refine',
    'chat.workflow.option.campus-romance': 'Campus Romance',
    'chat.workflow.option.character-focused': 'Character Focused',
    'chat.workflow.option.character-base-image': 'Base Character Image',
    'chat.workflow.option.character-overview-sheet': 'Character Overview Sheet',
    'chat.workflow.option.characterSummary': 'Character Summary',
    'chat.workflow.option.connected-targets': 'Connected Targets',
    'chat.workflow.option.conflict-scene': 'Conflict Scene',
    'chat.workflow.option.conflicting-motives': 'Conflicting Motives',
    'chat.workflow.option.consistency': 'Consistency',
    'chat.workflow.option.covered': 'Covered',
    'chat.workflow.option.coverImage': 'Cover Image',
    'chat.workflow.option.custom': 'Custom',
    'chat.workflow.option.dark-adult': 'Dark Adult',
    'chat.workflow.option.description': 'Description',
    'chat.workflow.option.dialogueStyle': 'Dialogue Style',
    'chat.workflow.option.do-not-resolve-immediately': 'Do Not Resolve Immediately',
    'chat.workflow.option.downtime-scene': 'Downtime Scene',
    'chat.workflow.option.dramatic': 'Dramatic',
    'chat.workflow.option.erotic': 'Erotic',
    'chat.workflow.option.erotic-tension': 'Erotic Tension',
    'chat.workflow.option.environmental-scene': 'Environmental Scene',
    'chat.workflow.option.episodic': 'Episodic',
    'chat.workflow.option.existing-card': 'Existing Card',
    'chat.workflow.option.explicit': 'Explicit Adult',
    'chat.workflow.option.explore-then-converge': 'Explore then Converge',
    'chat.workflow.option.expression': 'Expression',
    'chat.workflow.option.expression-sheet': 'Expression Sheet',
    'chat.workflow.option.factions': 'Factions',
    'chat.workflow.option.fantasy-companion': 'Fantasy Companion',
    'chat.workflow.option.field': 'Field Targets',
    'chat.workflow.option.field-completeness': 'Field Completeness',
    'chat.workflow.option.firstMessage': 'First Message',
    'chat.workflow.option.forum-post-card': 'Forum Post Card',
    'chat.workflow.option.full-body': 'Full Body',
    'chat.workflow.option.global': 'Global Goal',
    'chat.workflow.option.goal-match': 'Goal Match',
    'chat.workflow.option.hero-cover': 'Hero Cover',
    'chat.workflow.option.high': 'High',
    'chat.workflow.option.image': 'Image Targets',
    'chat.workflow.option.image-pack': 'Image Pack',
    'chat.workflow.option.image-reference': 'Image Reference',
    'chat.workflow.option.appearance-prompt': 'Appearance Prompt',
    'chat.workflow.option.appearancePrompt': 'Appearance Prompt',
    'chat.workflow.option.immersive-card-css': 'Immersive Card CSS',
    'chat.workflow.option.independent': 'Independent Images',
    'chat.workflow.option.implied-nude': 'Implied Nude',
    'chat.workflow.option.instant-compliance': 'Instant Compliance',
    'chat.workflow.option.local-only': 'Local Only',
    'chat.workflow.option.low-confidence': 'Low Confidence',
    'chat.workflow.option.lore-dump': 'Lore Dump',
    'chat.workflow.option.long': 'Long',
    'chat.workflow.option.long-term-goals': 'Long Term Goals',
    'chat.workflow.option.lingerie-swimwear': 'Lingerie / Swimwear',
    'chat.workflow.option.low': 'Low',
    'chat.workflow.option.markdown-dossier': 'Markdown Dossier',
    'chat.workflow.option.medium': 'Medium',
    'chat.workflow.option.mentor': 'Mentor',
    'chat.workflow.option.mobile-chat-intro': 'Mobile Chat Intro',
    'chat.workflow.option.mystery-escalation': 'Mystery Escalation',
    'chat.workflow.option.name': 'Name',
    'chat.workflow.option.never': 'Never During Run',
    'chat.workflow.option.neutral': 'Neutral',
    'chat.workflow.option.noema-role-chat': 'Noema Role Chat',
    'chat.workflow.option.notes': 'Notes',
    'chat.workflow.option.ooc-explanation': 'OOC Explanation',
    'chat.workflow.option.opening': 'Opening',
    'chat.workflow.option.opening-layout': 'Opening Layout',
    'chat.workflow.option.opening-moment': 'Opening Moment',
    'chat.workflow.option.opening-scene': 'Opening Scene',
    'chat.workflow.option.outfit-detail': 'Outfit Detail',
    'chat.workflow.option.personality': 'Personality',
    'chat.workflow.option.plot-hooks': 'Plot Hooks',
    'chat.workflow.option.portable-json': 'Portable JSON',
    'chat.workflow.option.protective-companion': 'Protective Companion',
    'chat.workflow.option.private-conversation': 'Private Conversation',
    'chat.workflow.option.primary-npc': 'Primary NPC',
    'chat.workflow.option.reference': 'Reference',
    'chat.workflow.option.relationship-changes': 'Relationship Changes',
    'chat.workflow.option.relationship-drama': 'Relationship Drama',
    'chat.workflow.option.relationship-moment': 'Relationship Moment',
    'chat.workflow.option.relationship-network': 'Relationship Network',
    'chat.workflow.option.restrained': 'Restrained',
    'chat.workflow.option.reveal-scene': 'Reveal Scene',
    'chat.workflow.option.rival-tension': 'Rival Tension',
    'chat.workflow.option.rival': 'Rival',
    'chat.workflow.option.roleplay-usability': 'Roleplay Usability',
    'chat.workflow.option.role-card': 'Role Card',
    'chat.workflow.option.rules': 'Rules',
    'chat.workflow.option.same-character': 'Same Character',
    'chat.workflow.option.same-world': 'Same World',
    'chat.workflow.option.scene': 'Scene',
    'chat.workflow.option.scenario': 'Scenario',
    'chat.workflow.option.self-introduction': 'Self Introduction',
    'chat.workflow.option.sensual': 'Sensual',
    'chat.workflow.option.sensual-confidence': 'Sensual Confidence',
    'chat.workflow.option.setting': 'Setting',
    'chat.workflow.option.stylish-revealing': 'Stylish Revealing',
    'chat.workflow.option.subtle': 'Subtle',
    'chat.workflow.option.sharp': 'Sharp',
    'chat.workflow.option.short': 'Short',
    'chat.workflow.option.sillytavern': 'SillyTavern',
    'chat.workflow.option.sillytavern-description-block': 'SillyTavern Description Block',
    'chat.workflow.option.single-pass': 'Single Pass',
    'chat.workflow.option.slice-of-life': 'Slice of Life',
    'chat.workflow.option.slow-burn': 'Slow Burn',
    'chat.workflow.option.slow-trust': 'Slow Trust',
    'chat.workflow.option.slow-trust-rule': 'Slow Trust',
    'chat.workflow.option.steady-escalation': 'Steady Escalation',
    'chat.workflow.option.story-moment': 'Story Moment',
    'chat.workflow.option.supportImages': 'Support Images',
    'chat.workflow.option.tags': 'Tags',
    'chat.workflow.option.title': 'Title',
    'chat.workflow.option.unresolved-promises': 'Unresolved Promises',
    'chat.workflow.option.upper-body-portrait': 'Upper Body Portrait',
    'chat.workflow.option.urban-suspense': 'Urban Suspense',
    'chat.workflow.option.user-preference': 'User Preference',
    'chat.workflow.option.vector-index': 'Vector Index',
    'chat.workflow.option.web-summary': 'Web Summary',
    'chat.workflow.option.warm': 'Warm',
    'chat.workflow.option.wildcard': 'Wildcard',
    'chat.workflow.option.world': 'World Targets',
    'chat.workflow.option.worldContext': 'World Context',
    'chat.workflow.option.world-context': 'World Context',
    'chat.workflow.option.world-facts': 'World Facts',
    'chat.workflow.option.plain-natural-rp': 'Plain Natural RP',
    'chat.workflow.option.immersive-second-person': 'Immersive Second Person',
    'chat.workflow.option.close-third-person': 'Close Third Person',
    'chat.workflow.option.first-person-confessional': 'First Person Confessional',
    'chat.workflow.option.dialogue-forward': 'Dialogue Forward',
    'chat.workflow.option.cinematic-scene-prose': 'Cinematic Scene Prose',
    'chat.workflow.option.sensory-rich-prose': 'Sensory Rich Prose',
    'chat.workflow.option.minimalist-prose': 'Minimalist Prose',
    'chat.workflow.option.precise-literary-prose': 'Precise Literary Prose',
    'chat.workflow.option.lush-poetic-prose': 'Lush Poetic Prose',
    'chat.workflow.option.noir-detective-voice': 'Noir Detective Voice',
    'chat.workflow.option.gothic-romance-prose': 'Gothic Romance Prose',
    'chat.workflow.option.dark-fantasy-prose': 'Dark Fantasy Prose',
    'chat.workflow.option.urban-fantasy-prose': 'Urban Fantasy Prose',
    'chat.workflow.option.grimdark-prose': 'Grimdark Prose',
    'chat.workflow.option.cozy-fantasy-prose': 'Cozy Fantasy Prose',
    'chat.workflow.option.high-fantasy-epic': 'High Fantasy Epic',
    'chat.workflow.option.sword-and-sorcery': 'Sword and Sorcery',
    'chat.workflow.option.wuxia-xianxia-prose': 'Wuxia Xianxia Prose',
    'chat.workflow.option.isekai-adventure': 'Isekai Adventure',
    'chat.workflow.option.space-opera-prose': 'Space Opera Prose',
    'chat.workflow.option.cyberpunk-noir': 'Cyberpunk Noir',
    'chat.workflow.option.post-apocalyptic-survival': 'Post Apocalyptic Survival',
    'chat.workflow.option.dystopian-drama': 'Dystopian Drama',
    'chat.workflow.option.occult-mystery': 'Occult Mystery',
    'chat.workflow.option.cosmic-horror-prose': 'Cosmic Horror Prose',
    'chat.workflow.option.psychological-thriller': 'Psychological Thriller',
    'chat.workflow.option.cozy-mystery': 'Cozy Mystery',
    'chat.workflow.option.crime-drama': 'Crime Drama',
    'chat.workflow.option.medical-drama': 'Medical Drama',
    'chat.workflow.option.legal-drama': 'Legal Drama',
    'chat.workflow.option.political-intrigue': 'Political Intrigue',
    'chat.workflow.option.military-sci-fi': 'Military Sci Fi',
    'chat.workflow.option.slow-burn-romance': 'Slow Burn Romance',
    'chat.workflow.option.office-romance': 'Office Romance',
    'chat.workflow.option.forbidden-romance': 'Forbidden Romance',
    'chat.workflow.option.rivals-to-lovers': 'Rivals to Lovers',
    'chat.workflow.option.enemies-to-lovers': 'Enemies to Lovers',
    'chat.workflow.option.childhood-friends': 'Childhood Friends',
    'chat.workflow.option.found-family': 'Found Family',
    'chat.workflow.option.hurt-comfort': 'Hurt Comfort',
    'chat.workflow.option.angst-with-comfort': 'Angst with Comfort',
    'chat.workflow.option.mentor-student-tension': 'Mentor Student Tension',
    'chat.workflow.option.arranged-marriage-drama': 'Arranged Marriage Drama',
    'chat.workflow.option.royal-court-romance': 'Royal Court Romance',
    'chat.workflow.option.monster-romance': 'Monster Romance',
    'chat.workflow.option.paranormal-romance': 'Paranormal Romance',
    'chat.workflow.option.yandere-tension': 'Yandere Tension',
    'chat.workflow.option.obsessive-devotion': 'Obsessive Devotion',
    'chat.workflow.option.toxic-romance-drama': 'Toxic Romance Drama',
    'chat.workflow.option.dark-adult-drama': 'Dark Adult Drama',
    'chat.workflow.option.power-imbalance-drama': 'Power Imbalance Drama',
    'chat.workflow.option.mature-psychological-romance': 'Mature Psychological Romance',
    'chat.workflow.option.taboo-tension-drama': 'Taboo Tension Drama',
    'chat.workflow.option.jealousy-and-possession': 'Jealousy and Possession',
    'chat.workflow.option.betrayal-and-reconciliation': 'Betrayal and Reconciliation',
    'chat.workflow.option.domestic-suspense': 'Domestic Suspense',
    'chat.workflow.option.melodrama': 'Melodrama',
    'chat.workflow.option.soap-opera': 'Soap Opera',
    'chat.workflow.option.comedic-banter': 'Comedic Banter',
    'chat.workflow.option.dry-wit': 'Dry Wit',
    'chat.workflow.option.satirical-prose': 'Satirical Prose',
    'chat.workflow.option.wholesome-comfort': 'Wholesome Comfort',
    'chat.workflow.option.healing-slow-life': 'Healing Slow Life',
    'chat.workflow.option.dreamlike-surreal': 'Dreamlike Surreal',
    'chat.workflow.option.liminal-horror': 'Liminal Horror',
    'chat.workflow.option.fairytale-retelling': 'Fairytale Retelling',
    'chat.workflow.option.mythic-legendary': 'Mythic Legendary',
    'chat.workflow.option.picaresque-adventure': 'Picaresque Adventure',
    'chat.workflow.option.journal-entry-style': 'Journal Entry Style',
    'chat.workflow.option.epistolary-style': 'Epistolary Style',
    'chat.workflow.option.chat-log-style': 'Chat Log Style',
    'chat.workflow.option.scenario-card-direct': 'Scenario Card Direct',
    'chat.workflow.option.sillytavern-natural-card': 'SillyTavern Natural Card',
    'chat.workflow.option.ali-chat-dialogue-samples': 'Ali:Chat Dialogue Samples',
    'chat.workflow.option.w-plus-plus-structured': 'W++ Structured',
    'chat.workflow.option.longform-novelistic-rp': 'Longform Novelistic RP',
    'chat.workflow.option.auto': 'Auto',
    'chat.workflow.option.close-up': 'Close Up',
    'chat.workflow.option.bust': 'Bust',
    'chat.workflow.option.knee-up': 'Knee Up',
    'chat.workflow.option.wide-scene': 'Wide Scene',
    'chat.workflow.option.lock-character': 'Lock Character',
    'chat.workflow.option.vary-slightly': 'Vary Slightly',
    'chat.workflow.option.explore': 'Explore',
    'chat.workflow.option.1:1': '1:1',
    'chat.workflow.option.2:3': '2:3',
    'chat.workflow.option.3:4': '3:4',
    'chat.workflow.option.4:5': '4:5',
    'chat.workflow.option.16:9': '16:9',
    'chat.workflow.option.9:16': '9:16',
    'chat.workflow.option.roleplay-character-avatar': 'Roleplay Character Avatar',
    'chat.workflow.option.photoreal-portrait': 'Photoreal Portrait',
    'chat.workflow.option.photoreal': 'Photoreal',
    'chat.workflow.option.anime': 'Anime',
    'chat.workflow.option.illustration': 'Illustration',
    'chat.workflow.option.stylized': 'Stylized',
    'chat.workflow.option.cinematic-realism': 'Cinematic Realism',
    'chat.workflow.option.editorial-photography': 'Editorial Photography',
    'chat.workflow.option.high-fashion-editorial': 'High Fashion Editorial',
    'chat.workflow.option.magazine-cover-gloss': 'Magazine Cover Gloss',
    'chat.workflow.option.analog-film': 'Analog Film',
    'chat.workflow.option.35mm-film-still': '35mm Film Still',
    'chat.workflow.option.polaroid': 'Polaroid',
    'chat.workflow.option.disposable-camera': 'Disposable Camera',
    'chat.workflow.option.lomography': 'Lomography',
    'chat.workflow.option.film-noir': 'Film Noir',
    'chat.workflow.option.dreamy-soft-focus': 'Dreamy Soft Focus',
    'chat.workflow.option.bokeh-portrait': 'Bokeh Portrait',
    'chat.workflow.option.wet-plate-photo': 'Wet Plate Photo',
    'chat.workflow.option.infrared-photo': 'Infrared Photo',
    'chat.workflow.option.greasy-glossy-aesthetic': 'Greasy Glossy Aesthetic',
    'chat.workflow.option.oily-skin-glow': 'Oily Skin Glow',
    'chat.workflow.option.dewy-beauty-lighting': 'Dewy Beauty Lighting',
    'chat.workflow.option.plastic-gloss': 'Plastic Gloss',
    'chat.workflow.option.latex-shine': 'Latex Shine',
    'chat.workflow.option.oil-painting': 'Oil Painting',
    'chat.workflow.option.impasto-oil-painting': 'Impasto Oil Painting',
    'chat.workflow.option.classical-portrait-painting': 'Classical Portrait Painting',
    'chat.workflow.option.renaissance-painting': 'Renaissance Painting',
    'chat.workflow.option.baroque-painting': 'Baroque Painting',
    'chat.workflow.option.rococo-painting': 'Rococo Painting',
    'chat.workflow.option.neoclassical-painting': 'Neoclassical Painting',
    'chat.workflow.option.romanticism-painting': 'Romanticism Painting',
    'chat.workflow.option.realist-painting': 'Realist Painting',
    'chat.workflow.option.impressionist-painting': 'Impressionist Painting',
    'chat.workflow.option.post-impressionist-painting': 'Post Impressionist Painting',
    'chat.workflow.option.expressionist-painting': 'Expressionist Painting',
    'chat.workflow.option.fauvism-painting': 'Fauvism Painting',
    'chat.workflow.option.cubist-painting': 'Cubist Painting',
    'chat.workflow.option.surrealist-painting': 'Surrealist Painting',
    'chat.workflow.option.symbolist-painting': 'Symbolist Painting',
    'chat.workflow.option.abstract-expressionism': 'Abstract Expressionism',
    'chat.workflow.option.pop-art': 'Pop Art',
    'chat.workflow.option.op-art': 'Op Art',
    'chat.workflow.option.minimalist-art': 'Minimalist Art',
    'chat.workflow.option.art-nouveau': 'Art Nouveau',
    'chat.workflow.option.art-deco': 'Art Deco',
    'chat.workflow.option.bauhaus-poster': 'Bauhaus Poster',
    'chat.workflow.option.constructivist-poster': 'Constructivist Poster',
    'chat.workflow.option.suprematist-abstraction': 'Suprematist Abstraction',
    'chat.workflow.option.watercolor': 'Watercolor',
    'chat.workflow.option.loose-watercolor': 'Loose Watercolor',
    'chat.workflow.option.gouache': 'Gouache',
    'chat.workflow.option.acrylic-painting': 'Acrylic Painting',
    'chat.workflow.option.pastel-drawing': 'Pastel Drawing',
    'chat.workflow.option.charcoal-drawing': 'Charcoal Drawing',
    'chat.workflow.option.graphite-sketch': 'Graphite Sketch',
    'chat.workflow.option.colored-pencil': 'Colored Pencil',
    'chat.workflow.option.ink-drawing': 'Ink Drawing',
    'chat.workflow.option.ink-wash': 'Ink Wash',
    'chat.workflow.option.sumi-e': 'Sumi-e',
    'chat.workflow.option.ukiyo-e': 'Ukiyo-e',
    'chat.workflow.option.woodblock-print': 'Woodblock Print',
    'chat.workflow.option.linocut-print': 'Linocut Print',
    'chat.workflow.option.etching': 'Etching',
    'chat.workflow.option.lithograph': 'Lithograph',
    'chat.workflow.option.risograph-print': 'Risograph Print',
    'chat.workflow.option.screen-print': 'Screen Print',
    'chat.workflow.option.collage': 'Collage',
    'chat.workflow.option.mixed-media': 'Mixed Media',
    'chat.workflow.option.digital-painting': 'Digital Painting',
    'chat.workflow.option.concept-art': 'Concept Art',
    'chat.workflow.option.matte-painting': 'Matte Painting',
    'chat.workflow.option.splash-art': 'Splash Art',
    'chat.workflow.option.trading-card-art': 'Trading Card Art',
    'chat.workflow.option.character-sheet': 'Character Sheet',
    'chat.workflow.option.model-sheet': 'Model Sheet',
    'chat.workflow.option.turnaround-reference': 'Turnaround Reference',
    'chat.workflow.option.anime-key-visual': 'Anime Key Visual',
    'chat.workflow.option.anime-screenshot': 'Anime Screenshot',
    'chat.workflow.option.cel-shaded-anime': 'Cel Shaded Anime',
    'chat.workflow.option.semi-realistic-anime': 'Semi Realistic Anime',
    'chat.workflow.option.90s-anime': '90s Anime',
    'chat.workflow.option.retro-anime': 'Retro Anime',
    'chat.workflow.option.shoujo-manga': 'Shoujo Manga',
    'chat.workflow.option.shonen-manga': 'Shonen Manga',
    'chat.workflow.option.seinen-manga': 'Seinen Manga',
    'chat.workflow.option.josei-manga': 'Josei Manga',
    'chat.workflow.option.chibi': 'Chibi',
    'chat.workflow.option.moe': 'Moe',
    'chat.workflow.option.mecha-anime': 'Mecha Anime',
    'chat.workflow.option.magical-girl': 'Magical Girl',
    'chat.workflow.option.cyberpunk-anime': 'Cyberpunk Anime',
    'chat.workflow.option.game-cg': 'Game CG',
    'chat.workflow.option.visual-novel-cg': 'Visual Novel CG',
    'chat.workflow.option.light-novel-cover': 'Light Novel Cover',
    'chat.workflow.option.manga-screentone': 'Manga Screentone',
    'chat.workflow.option.webtoon': 'Webtoon',
    'chat.workflow.option.manhwa': 'Manhwa',
    'chat.workflow.option.comic-book': 'Comic Book',
    'chat.workflow.option.graphic-novel': 'Graphic Novel',
    'chat.workflow.option.noir-comic': 'Noir Comic',
    'chat.workflow.option.pulp-comic': 'Pulp Comic',
    'chat.workflow.option.ligne-claire': 'Ligne Claire',
    'chat.workflow.option.children-book-illustration': 'Children Book Illustration',
    'chat.workflow.option.sticker-art': 'Sticker Art',
    'chat.workflow.option.emoji-style': 'Emoji Style',
    'chat.workflow.option.tattoo-flash': 'Tattoo Flash',
    'chat.workflow.option.flat-vector': 'Flat Vector',
    'chat.workflow.option.isometric-illustration': 'Isometric Illustration',
    'chat.workflow.option.low-poly-3d': 'Low Poly 3D',
    'chat.workflow.option.voxel-art': 'Voxel Art',
    'chat.workflow.option.pixel-art': 'Pixel Art',
    'chat.workflow.option.8-bit-pixel-art': '8 Bit Pixel Art',
    'chat.workflow.option.16-bit-pixel-art': '16 Bit Pixel Art',
    'chat.workflow.option.ps1-low-poly': 'PS1 Low Poly',
    'chat.workflow.option.clay-render': 'Clay Render',
    'chat.workflow.option.claymation': 'Claymation',
    'chat.workflow.option.stop-motion': 'Stop Motion',
    'chat.workflow.option.toy-photography': 'Toy Photography',
    'chat.workflow.option.vinyl-figure': 'Vinyl Figure',
    'chat.workflow.option.3d-animated-film': '3D Animated Film',
    'chat.workflow.option.path-traced-3d': 'Path Traced 3D',
    'chat.workflow.option.product-render': 'Product Render',
    'chat.workflow.option.architectural-visualization': 'Architectural Visualization',
    'chat.workflow.option.technical-illustration': 'Technical Illustration',
    'chat.workflow.option.blueprint-drawing': 'Blueprint Drawing',
    'chat.workflow.option.cyberpunk': 'Cyberpunk',
    'chat.workflow.option.solarpunk': 'Solarpunk',
    'chat.workflow.option.steampunk': 'Steampunk',
    'chat.workflow.option.dieselpunk': 'Dieselpunk',
    'chat.workflow.option.biopunk': 'Biopunk',
    'chat.workflow.option.retrofuturism': 'Retrofuturism',
    'chat.workflow.option.cassette-futurism': 'Cassette Futurism',
    'chat.workflow.option.y2k-aesthetic': 'Y2K Aesthetic',
    'chat.workflow.option.frutiger-aero': 'Frutiger Aero',
    'chat.workflow.option.vaporwave': 'Vaporwave',
    'chat.workflow.option.synthwave': 'Synthwave',
    'chat.workflow.option.outrun': 'Outrun',
    'chat.workflow.option.psychedelic-poster': 'Psychedelic Poster',
    'chat.workflow.option.blacklight-poster': 'Blacklight Poster',
    'chat.workflow.option.acid-graphics': 'Acid Graphics',
    'chat.workflow.option.brutalist-graphic-design': 'Brutalist Graphic Design',
    'chat.workflow.option.swiss-poster': 'Swiss Poster',
    'chat.workflow.option.vintage-travel-poster': 'Vintage Travel Poster',
    'chat.workflow.option.propaganda-poster': 'Propaganda Poster',
    'chat.workflow.option.dark-fantasy': 'Dark Fantasy',
    'chat.workflow.option.high-fantasy': 'High Fantasy',
    'chat.workflow.option.gothic-horror': 'Gothic Horror',
    'chat.workflow.option.cosmic-horror': 'Cosmic Horror',
    'chat.workflow.option.occult-illustration': 'Occult Illustration',
    'chat.workflow.option.kawaii-pastel': 'Kawaii Pastel',
    'chat.workflow.option.harajuku-street-style': 'Harajuku Street Style',
    'chat.workflow.option.fairycore': 'Fairycore',
    'chat.workflow.option.cottagecore': 'Cottagecore',
    'chat.workflow.option.dreamcore': 'Dreamcore',
    'chat.workflow.option.weirdcore': 'Weirdcore',
    'chat.workflow.option.liminal-space': 'Liminal Space',
    'chat.workflow.option.grunge-poster': 'Grunge Poster',
    'chat.workflow.option.punk-zine': 'Punk Zine',
    'chat.workflow.option.metal-album-cover': 'Metal Album Cover',
    'chat.workflow.slot.assets': 'Assets',
    'chat.workflow.slot.card': 'Character Card',
    'chat.workflow.slot.candidate': 'Candidate',
    'chat.workflow.slot.constraint': 'Constraint',
    'chat.workflow.slot.continuity': 'Continuity',
    'chat.workflow.slot.critique': 'Critique',
    'chat.workflow.slot.export': 'Export',
    'chat.workflow.slot.field': 'Field',
    'chat.workflow.slot.fieldControl': 'Field Control',
    'chat.workflow.slot.fieldTarget': 'Field',
    'chat.workflow.slot.goal': 'Goal',
    'chat.workflow.slot.image': 'Image',
    'chat.workflow.slot.imageAsset': 'Image',
    'chat.workflow.slot.imageControl': 'Image Control',
    'chat.workflow.slot.imageTarget': 'Image Target',
    'chat.workflow.slot.model': 'Model',
    'chat.workflow.slot.policy': 'Policy',
    'chat.workflow.slot.plot': 'Plot',
    'chat.workflow.slot.report': 'Report',
    'chat.workflow.slot.resource': 'Resource',
    'chat.workflow.slot.retrieval': 'Retrieval',
    'chat.workflow.slot.target': 'Target Resource',
    'chat.workflow.slot.npc': 'NPC',
    'chat.workflow.slot.npcPack': 'NPC Pack',
    'chat.workflow.slot.relationship': 'Relationship',
    'chat.workflow.slot.scene': 'Scene',
    'chat.workflow.slot.source': 'Source',
    'chat.workflow.slot.strategy': 'Strategy',
    'chat.workflow.slot.style': 'Style',
    'chat.workflow.slot.voice': 'Voice',
    'chat.workflow.slot.world': 'World',
    'chat.workflow.source.agent': 'agent',
    'chat.workflow.source.asset': 'asset',
    'chat.workflow.source.core': 'core',
    'chat.workflow.source.safety': 'safety',
    'chat.search': 'Search history characters or chats',
    'chat.subtitle': 'History character chat',
    'chat.threadEva': 'Chen Qianyu basic profile is connected.',
    'chat.threadRuntime': 'Streaming text, tool calls, and local task status',
    'chat.title': 'Chat',
    'status.connectionFailed': 'Connection failed',
    'status.initializing': 'Initializing...',
    'status.listening': 'Listening...',
    'status.latency': 'Latency: {ms}ms',
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
    'nav.learning': 'Learning',
    'nav.personality': 'Persona',
    'nav.plugins': 'Plugins',
    'nav.system': 'System',
    'nav.voice': 'Voice',
    'nav.models': 'Models',
    'nav.logs': 'Logs',
    'appearance.title': 'Page Settings',
    'appearance.orbStyle': 'Orb Style',
    'appearance.orbStyleDesc': 'Choose the main screen orb visual.',
    'appearance.defaultOrb': 'Lumen',
    'appearance.advancedOrb': 'Amber',
    'appearance.planetOrb': 'Halo',
    'appearance.theme': 'Interface Mode',
    'appearance.themeDesc': 'Switch the control surface brightness.',
    'appearance.themeNight': 'Night',
    'appearance.themeDay': 'Day',
    'appearance.liquidGlass': 'Liquid Effect',
    'appearance.liquidGlassDesc': 'Disable the liquid overlay on the settings panel to reduce GPU usage.',
    'appearance.dragonCursor': 'Dragon Effect',
    'appearance.dragonCursorDesc': 'Show the mouse-following dragon cursor in the settings panel.',
    'experimental.title': 'Experimental',
    'experimental.selfLearning': 'Self-Learning',
    'experimental.selfLearningDesc': 'Allow runtime event learning, candidate generation, and specialized agents. Disabling it stops the related background flows.',
    'learning.disabled': 'Self-learning is disabled. Enable Self-Learning in Experimental before events, reflections, and agents are recorded.',
    'models.title': 'Models',
    'voice.input': 'Voice Input',
    'voice.inputDesc': 'Use the microphone for voice conversation',
    'voice.output': 'Voice Output',
    'voice.outputDesc': 'Let EVA reply with speech',
    'voice.title': 'Voice Settings',
    'voice.volume': 'Volume',
    'voice.outputEnabled': 'Voice output enabled',
    'voice.outputDisabled': 'Voice output disabled',
    'voice.micPermissionSettings': 'Enable microphone permission in System Settings',
    'voice.micPermissionDenied': 'Microphone permission was not granted',
    'memory.accountDesc': 'Accounts, keys, passwords, and fixed configuration saved during task execution.',
    'memory.accountInfo': 'Account Info',
    'memory.accountManage': 'Account',
    'memory.accountManageDesc': 'Manage long-lived information requested and saved during task runtime.',
    'memory.important': 'Important Memories',
    'memory.profile': 'User Profile',
    'memory.recent': 'Recent Conversations',
    'memory.resetAll': 'Reset All',
    'memory.resetHint': 'Clear all memory data. This cannot be undone.',
    'memory.savedInfo': 'Saved Info',
    'memory.summaries': 'Conversation Summaries',
    'memory.title': 'Memory',
    'memory.loadFailed': 'Load failed',
    'memory.profileEmpty': 'EVA does not know much about you yet. Keep chatting.',
    'memory.importantEmpty': 'No important memories',
    'memory.summaryEmpty': 'No conversation summaries',
    'memory.conversationEmpty': 'No recent conversations',
    'memory.accountEmpty': 'No account info',
    'memory.userRole': 'You',
    'memory.profileCleared': 'User profile cleared',
    'memory.importantCleared': 'Important memories cleared',
    'memory.summariesCleared': 'Conversation summaries cleared',
    'memory.conversationsCleared': 'Recent conversations cleared',
    'memory.allReset': 'All data reset',
    'memory.accountDeleted': 'Account info deleted',
    'memory.accountCleared': 'Account info cleared',
    'memory.clearFailed': 'Clear failed',
    'memory.memoryDeleted': 'Memory deleted',
    'memory.sensitivitySecret': 'Secret',
    'memory.sensitivityVerification': 'Verification',
    'memory.sensitivityNormal': 'Normal',
    'memory.field.nickname': 'Nickname',
    'memory.field.name': 'Name',
    'memory.field.age': 'Age',
    'memory.field.gender': 'Gender',
    'memory.field.location': 'Location',
    'memory.field.occupation': 'Occupation',
    'memory.field.currentMood': 'Current Mood',
    'memory.confirm.clearProfile.title': 'Clear User Profile',
    'memory.confirm.clearProfile.message': 'Remove EVA’s organized personal information, preferences, and tags.',
    'memory.confirm.clearProfile.detail': 'A new profile can be rebuilt through future conversations.',
    'memory.confirm.clearImportant.title': 'Clear Important Memories',
    'memory.confirm.clearImportant.message': 'Delete all long-term memories marked as important.',
    'memory.confirm.clearImportant.detail': 'This will not affect the user profile or conversation summaries.',
    'memory.confirm.clearSummaries.title': 'Clear Conversation Summaries',
    'memory.confirm.clearSummaries.message': 'Delete compressed historical conversation summaries.',
    'memory.confirm.clearSummaries.detail': 'Recent conversations and the user profile will not be cleared.',
    'memory.confirm.clearConversations.title': 'Clear Recent Conversations',
    'memory.confirm.clearConversations.message': 'Clear recent conversation records from working memory.',
    'memory.confirm.clearConversations.detail': 'EVA will start from a fresh context.',
    'memory.confirm.resetAll.title': 'Reset All Memory',
    'memory.confirm.resetAll.message': 'Clear the user profile, important memories, account info, summaries, and recent conversations.',
    'memory.confirm.resetAll.detail': 'This cannot be undone.',
    'memory.confirm.deleteProfile.title': 'Delete Profile Field',
    'memory.confirm.deleteProfile.message': 'Delete “{name}”.',
    'memory.confirm.deleteProfile.detail': 'It can be rebuilt in future conversations.',
    'memory.confirm.deleteImportant.title': 'Delete Important Memory',
    'memory.confirm.deleteImportant.message': 'Delete “{name}”.',
    'memory.confirm.deleteImportant.detail': 'This long-term memory will no longer be used in future context.',
    'memory.confirm.deleteSummary.title': 'Delete Conversation Summary',
    'memory.confirm.deleteSummary.message': 'Delete this compressed historical conversation summary.',
    'memory.confirm.deleteSummary.detail': 'Other summaries and recent conversations are unaffected.',
    'memory.confirm.deleteConversation.title': 'Delete Recent Conversation',
    'memory.confirm.deleteConversation.message': 'Delete this recent conversation from working memory.',
    'memory.confirm.deleteConversation.detail': 'This will not delete other memory content.',
    'memory.confirm.deleteAccount.title': 'Delete Account Info',
    'memory.confirm.deleteAccount.message': 'Delete “{name}”.',
    'memory.confirm.deleteAccount.detail': 'If a future task needs it, it will ask again.',
    'memory.confirm.clearAccount.title': 'Clear Account Info',
    'memory.confirm.clearAccount.message': 'Delete all accounts, keys, passwords, and fixed configuration saved during tasks.',
    'memory.confirm.clearAccount.detail': 'Normal memories and conversation history will not be cleared.',
    'learning.title': 'Learning',
    'learning.open': 'Open',
    'learning.desc': 'Inspect runtime events, reflections, learning candidates, and specialized agents.',
    'learning.reflect': 'Reflect Recent Events',
    'learning.events': 'Events',
    'learning.reflections': 'Reflections',
    'learning.candidates': 'Candidates',
    'learning.assets': 'Assets',
    'learning.agents': 'Agents',
    'learning.decisions': 'Automation Decisions',
    'learning.rollbacks': 'Rollbacks',
    'learning.empty': 'No data',
    'learning.loadFailed': 'Learning load failed: {error}',
    'learning.deployFailed': 'Deploy failed: {error}',
    'learning.updateFailed': 'Update failed: {error}',
    'learning.rollbackFailed': 'Rollback failed: {error}',
    'learning.viewOverview': 'Overview',
    'learning.viewAgents': 'Agents',
    'learning.viewCandidates': 'Candidates',
    'learning.viewAssets': 'Assets',
    'learning.viewActivity': 'Activity',
    'learning.health': 'Learning Health',
    'learning.healthReady': 'Stable',
    'learning.healthNeedsReview': 'Needs review',
    'learning.pendingReview': 'Pending Review',
    'learning.activeAssets': 'Active Assets',
    'learning.activeAgents': 'Active Agents',
    'learning.recentSignals': 'Recent Signals',
    'learning.queue': 'Review Queue',
    'learning.operations': 'Operations',
    'learning.agentControl': 'Agent Console',
    'learning.assetLibrary': 'Learning Asset Library',
    'learning.activityTimeline': 'Activity Timeline',
    'learning.openDetail': 'Open detail',
    'learning.detail': 'Detail',
    'learning.noSelection': 'Select an item on the left to inspect it.',
    'learning.activate': 'Activate',
    'learning.disable': 'Disable',
    'learning.archive': 'Archive',
    'learning.rollback': 'Rollback',
    'learning.createDraft': 'Create draft',
    'learning.kind': 'Kind',
    'learning.status': 'Status',
    'learning.confidence': 'Confidence',
    'learning.risk': 'Risk',
    'learning.mode': 'Mode',
    'learning.scope': 'Scope',
    'learning.routingPolicy': 'Routing policy',
    'learning.capabilities': 'Capabilities',
    'learning.evidence': 'Evidence',
    'learning.expectedBenefit': 'Expected benefit',
    'learning.createdAt': 'Created',
    'learning.updatedAt': 'Updated',
    'learning.emptyHint': 'No manageable objects yet.',
    'personality.addFile': 'Add Role File',
    'personality.addFileDesc': 'Choose an external .yml/.yaml file and add it after validation',
    'personality.current': 'Current Personality',
    'personality.currentDesc': 'Choose the AI companion personality profile',
    'personality.title': 'Personality',
    'personality.externalFile': 'External file',
    'personality.listLoadFailed': 'Failed to load personality list: {error}',
    'personality.switchFailed': 'Failed to switch personality: {error}',
    'personality.switched': 'Switched personality to {name}',
    'personality.addFailed': 'Failed to add role: {error}',
    'personality.addedAndSwitched': 'Added and switched to {name}',
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
    'system.title': 'System',
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
    'system.modelManager': 'Model Manager',
    'system.modelManagerDesc': 'Add, test, activate, or delete model configs',
    'system.configCount': '{count} configs',
    'system.ready': 'Ready',
    'system.missingPrefix': 'Missing {items}',
    'system.manage': 'Manage',
    'system.currentUsing': 'Using {model}',
    'system.needComplete': 'Complete {items}',
    'system.notConfigured': 'Not configured',
    'system.config': 'Config',
    'system.modelName': 'Model name',
    'system.statusCheck': 'Status check',
    'system.installedRatio': '{installed}/{total} installed',
    'system.startupNeedsConfig': 'Setup required before starting',
    'system.needConfigCount': '{count} setup items required',
    'system.completeDialogueModel': 'Complete dialogue model name, API Key, and Base URL',
    'system.completeTaskModel': 'Complete task model name, API Key, and Base URL',
    'system.completeTtsModel': 'Complete TTS model name, API Key, and Voice ID',
    'system.completeTtsModelNoVoice': 'Complete TTS model name and API Key',
    'system.completeAsrModel': 'Complete ASR model name and API Key',
    'system.downloadMissingLocal': 'Download missing local models: {models}',
    'system.checkLocalModels': 'Check local VAD / SmartTurn model status',
    'system.localModelStatusFailed': 'Local model status failed',
    'system.localModelReady': 'Local models ready',
    'system.localModelDownloadFailed': 'Model download failed: {error}',
    'system.modelMissing': 'Model config does not exist',
    'system.apiTestTitle': 'Test API connection',
    'system.testing': 'Testing',
    'system.connectionFailed': 'Connection failed',
    'system.apiOk': 'API connection OK',
    'system.apiFailed': 'API test failed: {error}',
    'system.voiceIdPlaceholder': 'Voice ID',
    'system.languagePlaceholderOptional': 'zh / en (optional)',
    'logs.loadFailed': 'Failed to load logs',
    'logs.empty': 'No logs',
    'taskRuntime.compactLimit': 'Auto Compact Limit',
    'taskRuntime.compactLimitDesc': 'Compact task history when context tokens reach this value, capped at 90% of the window.',
    'taskRuntime.contextWindow': 'Model Context Window',
    'taskRuntime.contextWindowDesc': 'Used to estimate the task history compact threshold.',
    'taskRuntime.desc': 'Runtime loop and memory limits.',
    'taskRuntime.keepRecent': 'Keep Recent Turns',
    'taskRuntime.keepRecentDesc': 'How many raw recent turns to keep during compaction.',
    'taskRuntime.maxTurns': 'Max Turns',
    'taskRuntime.maxTurnsDesc': 'Stop a task after this many runtime turns.',
    'taskRuntime.title': 'Task Runtime Params',
    'plugins.title': 'Plugins',
    'plugins.marketplace': 'Marketplace',
    'plugins.installed': 'Installed',
    'plugins.refresh': 'Refresh',
    'plugins.refreshing': 'Refreshing...',
    'plugins.install': 'Install',
    'plugins.installing': 'Installing...',
    'plugins.installedNotice': 'Plugin installed',
    'plugins.installFailed': 'Plugin install failed: {error}',
    'plugins.marketplaceCached': 'Cached at {time}',
    'plugins.marketplaceFetched': 'Updated at {time}',
    'plugins.marketplaceRefreshFailed': 'Refresh failed: {error}',
    'plugins.marketplaceSearch': 'Search plugins, tags, or descriptions',
    'plugins.marketplaceEmpty': 'No remote plugins match your search',
    'plugins.marketplaceUnavailable': 'Plugin marketplace unavailable',
    'plugins.marketplaceSource': 'Source',
    'plugins.viewSource': 'View Source',
    'plugins.installedStatus': 'Installed',
    'plugins.enabledStatus': 'Enabled',
    'plugins.availableStatus': 'Available',
    'plugins.uninstall': 'Uninstall Plugin',
    'plugins.uninstallTitle': 'Uninstall Plugin',
    'plugins.uninstallConfirm': 'Delete the local plugin directory for {name}. This cannot be undone.',
    'plugins.uninstalled': 'Plugin uninstalled',
    'plugins.uninstallFailed': 'Plugin uninstall failed: {error}',
    'plugins.dangerZone': 'Danger Zone',
    'plugins.uninstallDesc': 'Delete this plugin directory from this machine. If it is running, it is fully removed on the next plugin reload.',
    'plugins.loadFailed': 'Failed to load plugins',
    'plugins.uiLoadFailed': 'Plugin UI load failed',
    'plugins.empty': 'No plugins found',
    'plugins.configCount': '{count} parameters',
    'plugins.noConfig': 'No configurable parameters',
    'plugins.uiHookCount': '{count} UI hooks',
    'plugins.advancedModelParams': 'Advanced Model Parameters',
    'plugins.advancedModelParamsDesc': 'Model fit, position, lip-sync smoothing, and state motion mapping',
    'plugins.enabled': 'Plugin enabled',
    'plugins.disabled': 'Plugin disabled',
    'plugins.updateFailed': 'Plugin update failed: {error}',
    'plugins.configUpdated': 'Plugin parameters updated',
    'plugins.configSaveFailed': 'Failed to save plugin parameters: {error}',
    'plugins.pathUpdated': 'Plugin path updated',
    'plugins.pathSelectFailed': 'Path selection failed: {error}',
    'plugins.pathSelectFailedFallback': 'Path selection failed',
    'plugins.directorySelectFailed': 'Directory selection failed',
    'plugins.fileSelectFailed': 'File selection failed',
    'plugins.missingResolvedFile': 'No {extensions} file found in the selected directory',
    'plugins.chooseDirectory': 'Choose Directory',
    'plugins.chooseFile': 'Choose File',
    'plugins.choose': 'Choose',
    'plugins.chooseField': 'Choose {label}',
    'plugins.adminLoading': 'Loading admin information...',
    'plugins.adminLoadFailed': 'Failed to load admin information',
    'plugins.noAdminPanel': 'This plugin does not declare an admin panel.',
    'plugins.adminTitle': 'Plugin Admin',
    'plugins.noAdminActions': 'No admin actions.',
    'plugins.actionFailed': 'Plugin action failed: {error}',
    'plugins.actionDone': 'Plugin action completed',
    'plugins.mcpTitle': 'Remote MCP Servers',
    'plugins.mcpSubtitle': 'Manage remote MCP HTTP endpoints only; no local commands are started.',
    'plugins.mcpIdPlaceholder': 'id, e.g. github',
    'plugins.mcpNamePlaceholder': 'Name, optional',
    'plugins.mcpHeadersPlaceholder': "Headers JSON, optional, e.g. {\"authorization\":\"Bearer ...\"}",
    'plugins.mcpAdd': 'Add Remote MCP',
    'plugins.mcpEmpty': 'No remote MCP servers.',
    'plugins.mcpHeadersInvalid': 'Headers must be valid JSON',
    'plugins.test': 'Test',
    'plugins.testing': 'Testing...',
    'plugins.testFailed': 'Test Failed',
    'plugins.skillsTitle': 'Skills Sources',
    'plugins.skillsSubtitle': 'Import SKILL.md from GitHub or local directories.',
    'plugins.skillsGithubPlaceholder': 'GitHub URL, e.g. https://github.com/user/repo',
    'plugins.skillsLocalPlaceholder': 'Local skills directory path',
    'plugins.skillsAddGithub': 'Add GitHub Source',
    'plugins.skillsAddLocal': 'Add Local Directory',
    'plugins.skillsEmpty': 'No skill sources.',
    'plugins.skillsNoneInSource': 'No SKILL.md files found under this source.',
    'plugins.rescan': 'Rescan',
    'plugins.live2dCapabilitiesLoading': 'Reading model capabilities...',
    'plugins.live2dCapabilitiesUnavailable': 'Model capabilities unavailable',
    'plugins.live2dCapabilitiesTitle': 'Model Capabilities',
    'plugins.live2dMotionGroups': 'Motion groups',
    'plugins.live2dExpressions': 'Expressions',
    'plugins.live2dLipSyncParams': 'LipSync params',
    'logs.title': 'Logs',
    'logs.desc': 'Inspect the current session by time, level, and subsystem.',
    'about.desc': 'Putting a living soul into the desktop.',
    'about.quote': 'Voice, memory, emotion, personality, and tools — an experiment toward AI that can talk, accompany, and act beside us.',
    'about.title': 'About',
    'updates.kicker': 'Version Update',
    'updates.idleTitle': 'Check whether a new Noema version is available',
    'updates.idleDesc': 'Update prompts only appear here and never interrupt the current conversation.',
    'updates.check': 'Check Updates',
    'updates.checking': 'Checking...',
    'updates.latestTitle': 'You are on the latest version',
    'updates.latestDesc': 'Current version v{current}. Last checked {time}.',
    'updates.availableTitle': 'New version v{latest} available',
    'updates.availableDesc': 'Current version v{current}. This update is optional; you can handle it later.',
    'updates.failedTitle': 'Unable to check for updates',
    'updates.failedDesc': '{error}',
    'updates.openRelease': 'View Release',
    'notice.voiceInputDisabled': 'Voice input disabled',
    'notice.voiceInputEnabled': 'Voice input enabled',
    'notice.orbCaptureCopied': 'Orb screenshot copied to clipboard',
    'notice.orbCaptureFailed': 'Capture failed: {error}',
    'inputMeta.currentOnly': 'Only used for the current task',
    'inputMeta.persistent': 'Can be saved and reused in later tasks',
    'inputMeta.verification': 'One-time verification code, not saved',
  }
}

let currentLanguage: LanguageCode = 'zh-CN'
let refreshChatLanguage: (() => void) | null = null

function t(key: string): string {
  return I18N[currentLanguage][key] ?? I18N['zh-CN'][key] ?? key
}

function tf(key: string, values: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''))
}

function setLanguage(language: LanguageCode): void {
  currentLanguage = language
  document.documentElement.lang = language
  applyI18n()
  updateConversationButton()
  setStatus(getReadyStatus())
  renderOrbStyleControls()
  renderAppearanceThemeControls()
  renderSystemConfigIfReady()
  renderPluginsForCurrentLanguage()
  renderAppUpdateState()
  refreshChatLanguage?.()
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
  if (!document.body.classList.contains('settings-open') || !isSettingsSectionActive('models')) {
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
  provider?: LLMProviderType
  transport?: 'openai_compatible' | 'codex_local' | 'claude_code_local'
  modelName: string
  apiKey: string
  baseUrl: string
}

type TTSModelConfig = {
  id: string
  provider: TTSProviderType
  modelName: string
  apiKey: string
  voiceId?: string
  baseUrl?: string
  language?: string
  format?: 'pcm' | 'mp3' | 'opus'
  sampleRate?: number
  extra?: Record<string, unknown>
}

type ASRModelConfig = {
  id: string
  provider: ASRProviderType
  modelName: string
  apiKey: string
  baseUrl?: string
  language?: string
  sampleRate?: number
  extra?: Record<string, unknown>
}

type ApiModelTestKind = 'llm' | 'task' | 'tts' | 'asr'

type ModelLogo = {
  src: string
  alt: string
  tone?: 'color' | 'light'
}

type TaskRuntimeSettings = {
  adapterId: string
  maxTurns: number
  modelContextWindow: number
  autoCompactTokenLimit: number
  keepRecentTurns: number
  cwd: string
  timeoutMs: number
  command: string
  model: string
  extraArgs: string[]
}

type SystemConfig = {
  proxy: string
  llmModels: LLMModelConfig[]
  activeLLMId: string
  chatModels: LLMModelConfig[]
  activeChatId: string
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
type ModelManagerKind = 'llm' | 'task' | 'tts' | 'asr' | 'models'
type AppLogLevel = 'debug' | 'info' | 'warn' | 'error'
type AppLogType = 'app' | 'asr' | 'audio' | 'conversation' | 'latency' | 'llm' | 'memory' | 'plugin' | 'settings' | 'task' | 'tts' | 'turn' | 'vad'

type AppLogEntry = {
  id: number
  time: number
  level: AppLogLevel
  type: AppLogType
  message: string
}

type SystemTelemetry = {
  success: boolean
  cpuPercent: number
  memoryBytes: number
  activeNetworkInterfaces: number
  proxyActive: boolean
  activeProxyUrl?: string
  error?: string
}

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
  appearance?: {
    orbStyle?: OrbStyle
    theme?: AppearanceTheme
    liquidGlassEnabled?: boolean
    dragonCursorEnabled?: boolean
  }
  experimental?: {
    selfLearningEnabled?: boolean
  }
  selectedPersonality: string
  plugins: Record<string, boolean>
  pluginConfigs: Record<string, Record<string, unknown>>
  pluginPathHistory?: Record<string, { mode: 'file' | 'directory'; lastPath: string; recentPaths: string[] }>
  system: SystemConfig
}

type OrbStyle = 'default' | 'advanced' | 'planet'
type AppearanceTheme = 'night' | 'day'

const ORB_STYLE_OPTIONS: Array<{ value: OrbStyle; labelKey: string }> = [
  { value: 'default', labelKey: 'appearance.defaultOrb' },
  { value: 'advanced', labelKey: 'appearance.advancedOrb' },
  { value: 'planet', labelKey: 'appearance.planetOrb' }
]

const APPEARANCE_THEME_OPTIONS: Array<{ value: AppearanceTheme; labelKey: string }> = [
  { value: 'night', labelKey: 'appearance.themeNight' },
  { value: 'day', labelKey: 'appearance.themeDay' }
]

type WindowCapture = {
  success: boolean
  width?: number
  height?: number
  dataUrl?: string
  error?: string
}

class ThemeSliceTransition {
  private running = false

  async run(applyTheme: () => void): Promise<void> {
    if (this.running) {
      return
    }

    this.running = true
    let coverActive = false
    try {
      const before = await this.beginCover()
      if (!before.dataUrl) {
        applyTheme()
        return
      }
      coverActive = true

      applyTheme()
      await this.waitForPaint()
      await this.waitForCompositor()
      await this.waitForPaint()

      const after = await this.capture()
      if (!after.dataUrl) {
        return
      }

      const result = await window.electronAPI.playThemeTransitionCover(after.dataUrl)
      coverActive = false
      if (!result.success) {
        console.warn('[ThemeTransition] Cover transition playback failed:', result.error)
      }
    } catch (error) {
      console.warn('[ThemeTransition] Theme slice transition failed:', error)
    } finally {
      if (coverActive) {
        await window.electronAPI.endThemeTransitionCover()
      }
      this.running = false
    }
  }

  private async beginCover(): Promise<WindowCapture> {
    try {
      const capture = await window.electronAPI.beginThemeTransitionCover()
      if (!capture.success || !capture.dataUrl) {
        console.warn('[ThemeTransition] Failed to begin transition cover:', capture.error)
        return { success: false, error: capture.error }
      }
      return capture
    } catch (error) {
      console.warn('[ThemeTransition] Failed to begin transition cover:', error)
      return { success: false, error: String(error) }
    }
  }

  private async capture(): Promise<WindowCapture> {
    try {
      const capture = await window.electronAPI.captureWindow()
      if (!capture.success || !capture.dataUrl) {
        console.warn('[ThemeTransition] Failed to capture window:', capture.error)
        return { success: false, error: capture.error }
      }
      return capture
    } catch (error) {
      console.warn('[ThemeTransition] Failed to capture window:', error)
      return { success: false, error: String(error) }
    }
  }

  private waitForPaint(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })
      })
    })
  }

  private waitForCompositor(): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, 80))
  }
}

type PluginConfigField =
  | {
      key: string
      label?: string
      description?: string
      advanced?: boolean
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
      advanced?: boolean
      type: 'file'
      default?: string
      defaultPath?: string
      placeholder?: string
      buttonLabel?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }
  | {
      key: string
      label?: string
      description?: string
      advanced?: boolean
      type: 'directory'
      default?: string
      defaultPath?: string
      placeholder?: string
      buttonLabel?: string
      targetKey?: string
      resolveFileExtensions?: string[]
      resolveRecursive?: boolean
    }
  | {
      key: string
      label?: string
      description?: string
      advanced?: boolean
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
      advanced?: boolean
      type: 'boolean'
      default?: boolean
    }
  | {
      key: string
      label?: string
      description?: string
      advanced?: boolean
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
  config: Record<string, unknown>
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
  i18n?: Record<string, Record<string, string>>
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

type PluginMarketplaceItem = {
  id: string
  name: string
  version?: string
  description?: string
  i18n?: Record<string, { name?: string; description?: string }>
  path?: string
  manifest?: string
  tags: string[]
  sourceUrl: string
  installed: boolean
  enabled: boolean
}

type PluginPage = 'local' | 'marketplace'

type Live2dModelCapabilities = {
  motionGroups: string[]
  expressions: string[]
  lipSyncParameters: string[]
  error?: string
}

type ConversationFrame =
  | { type: 'system.reset' }
  | { type: 'control.phase_start'; phase: 'reply' | 'task_progress' | 'task_result' }
  | { type: 'control.phase_end'; phase: 'reply' | 'task_progress' | 'task_result' }
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
  threads?: Array<{
    id: string
    goal: string
    status: string
    bucket: 'active' | 'paused' | 'waiting' | 'recoverable_failed' | 'completed' | 'abandoned'
    focused: boolean
    updatedAt: number
  }>
  currentThread?: {
    id: string
    goal: string
    status: string
    bucket: string
    focused: boolean
    updatedAt: number
  }
  currentStep?: string
  lastObservation?: string
  nextAction?: string
  longRuns?: Array<{
    id: string
    goal: string
    metric: string
    baseline: number
    bestResult: number
    latestResult: number
    iterationCount: number
    status: string
  }>
}

const voiceRecorder = new VoiceRecorder()

// Canvas rendering
const pluginUIMainView = document.getElementById('orb-slot') as HTMLElement
const pluginUITaskPanel = document.getElementById('task-panel') as HTMLElement
const canvas = document.getElementById('orb-canvas') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: true })!
const advancedOrbCanvas = document.getElementById('advanced-orb-canvas') as HTMLCanvasElement
const planetOrbCanvas = document.getElementById('planet-orb-canvas') as HTMLCanvasElement
let activePluginMainSurface: PluginUISurface | null = null
let activePluginTaskSurface: PluginUISurface | null = null
let lastTaskPanelPlan: TaskPanelPlan | null = null
let lastConversationPhase: ConversationFrame['phase'] | null = null
let lastExpressionState: {
  id: string
  emotion: string
  src: string
  priority?: number
} | null = null
let pluginUIStateTimer: number | undefined
let pluginControlsPeekTimer: number | undefined
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
let currentOrbStyle: OrbStyle = 'default'
let currentAppearanceTheme: AppearanceTheme = 'night'
type AdvancedGlassOrbRendererInstance = import('./orbs/advanced-glass-orb').AdvancedGlassOrbRenderer
type PlanetOrbRendererInstance = import('./orbs/planet-orb').PlanetOrbRenderer
let advancedOrbRenderer: AdvancedGlassOrbRendererInstance | null = null
let advancedOrbRendererPromise: Promise<AdvancedGlassOrbRendererInstance> | null = null
let planetOrbRenderer: PlanetOrbRendererInstance | null = null
let planetOrbRendererPromise: Promise<PlanetOrbRendererInstance> | null = null

// Store current radius for mouse detection
let currentOrbRadius = 22

async function getAdvancedOrbRenderer(): Promise<AdvancedGlassOrbRendererInstance> {
  if (advancedOrbRenderer) {
    return advancedOrbRenderer
  }
  if (!advancedOrbRendererPromise) {
    advancedOrbRendererPromise = import('./orbs/advanced-glass-orb').then(({ AdvancedGlassOrbRenderer }) => {
      advancedOrbRenderer = new AdvancedGlassOrbRenderer(advancedOrbCanvas)
      advancedOrbRenderer.setMode(orbState.mode)
      return advancedOrbRenderer
    })
  }
  return advancedOrbRendererPromise
}

async function getPlanetOrbRenderer(): Promise<PlanetOrbRendererInstance> {
  if (planetOrbRenderer) {
    return planetOrbRenderer
  }
  if (!planetOrbRendererPromise) {
    planetOrbRendererPromise = import('./orbs/planet-orb').then(({ PlanetOrbRenderer }) => {
      planetOrbRenderer = new PlanetOrbRenderer(planetOrbCanvas, () => {
        if (currentOrbStyle === 'planet') {
          setOrbStyle('default')
        }
      })
      planetOrbRenderer.setMode(orbState.mode)
      return planetOrbRenderer
    })
  }
  return planetOrbRendererPromise
}

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
  const orbSuspended = orbAnimationPaused || document.body.classList.contains('settings-open')
  if (currentOrbStyle === 'advanced') {
    if (!orbSuspended && advancedOrbRenderer) {
      advancedOrbRenderer.updateAudioEnergy(source, samples)
    }
  } else if (currentOrbStyle === 'planet') {
    if (!orbSuspended && planetOrbRenderer) {
      planetOrbRenderer.updateAudioEnergy(source, samples)
    }
  }
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
  if (orbAnimationPaused || document.body.classList.contains('settings-open')) {
    return
  }
  if (currentOrbStyle === 'advanced') {
    void getAdvancedOrbRenderer()
      .then(renderer => renderer.setEnabled(true))
      .then((ready) => {
        if (!ready && currentOrbStyle === 'advanced') {
          setOrbStyle('default')
        }
      })
    return
  }
  if (currentOrbStyle === 'planet') {
    void getPlanetOrbRenderer()
      .then(renderer => renderer.setEnabled(true))
      .then((ready) => {
        if (!ready && currentOrbStyle === 'planet') {
          setOrbStyle('default')
        }
      })
    return
  }
  if (orbAnimationFrameId !== null || orbAnimationPaused) {
    return
  }

  drawOrb()
}

function stopOrbAnimation(): void {
  void advancedOrbRenderer?.setEnabled(false)
  void planetOrbRenderer?.setEnabled(false)
  if (orbAnimationFrameId !== null) {
    cancelAnimationFrame(orbAnimationFrameId)
    orbAnimationFrameId = null
  }
}

function disposeInactiveOrbRenderers(activeStyle: OrbStyle): void {
  if (activeStyle !== 'advanced' && advancedOrbRenderer) {
    advancedOrbRenderer.dispose()
    advancedOrbRenderer = null
    advancedOrbRendererPromise = null
  }
  if (activeStyle !== 'planet' && planetOrbRenderer) {
    planetOrbRenderer.dispose()
    planetOrbRenderer = null
    planetOrbRendererPromise = null
  }
}

startOrbAnimation()
window.addEventListener('resize', () => {
  resizeOrbCanvas()
  advancedOrbRenderer?.resize()
  planetOrbRenderer?.resize()
})

// Helper function to check if point is inside orb
function isPointInOrb(surface: HTMLCanvasElement, clientX: number, clientY: number): boolean {
  const rect = surface.getBoundingClientRect()
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
let activeDragSurface: HTMLElement | null = null

function attachOrbDragHandlers(surface: HTMLCanvasElement): void {
  surface.addEventListener('mousemove', (e) => {
    if (isDragging && activeDragSurface === surface) {
      const deltaX = e.screenX - lastMouseX
      const deltaY = e.screenY - lastMouseY
      lastMouseX = e.screenX
      lastMouseY = e.screenY
      window.electronAPI.moveWindow(deltaX, deltaY)
    } else {
      surface.style.cursor = isPointInOrb(surface, e.clientX, e.clientY) ? 'grab' : 'move'
    }
  })

  surface.addEventListener('mouseleave', () => {
    if (!isDragging || activeDragSurface !== surface) {
      surface.style.cursor = 'default'
    }
  })

  surface.addEventListener('mousedown', (e) => {
    isDragging = true
    activeDragSurface = surface
    lastMouseX = e.screenX
    lastMouseY = e.screenY
    surface.style.cursor = 'grabbing'
  })

  surface.addEventListener('mouseup', (e) => {
    if (isDragging && activeDragSurface === surface) {
      isDragging = false
      activeDragSurface = null
      surface.style.cursor = isPointInOrb(surface, e.clientX, e.clientY) ? 'grab' : 'move'
    }
  })
}

function isPluginMainSurfaceActive(): boolean {
  return activePluginMainSurface?.mode === 'replace' && !document.body.classList.contains('settings-open')
}

function attachPluginMainSurfaceHandlers(surface: HTMLElement): void {
  surface.addEventListener('mousemove', (e) => {
    if (!isPluginMainSurfaceActive()) {
      return
    }

    queuePluginMainPointer(e, true)
    if (isDragging && activeDragSurface === surface) {
      const deltaX = e.screenX - lastMouseX
      const deltaY = e.screenY - lastMouseY
      lastMouseX = e.screenX
      lastMouseY = e.screenY
      window.electronAPI.moveWindow(deltaX, deltaY)
      surface.style.cursor = 'grabbing'
    } else {
      surface.style.cursor = 'move'
    }
  })

  surface.addEventListener('mouseleave', () => {
    if (!isPluginMainSurfaceActive()) {
      return
    }
    queuePluginMainPointer(null, false)
    if (!isDragging || activeDragSurface !== surface) {
      surface.style.cursor = 'move'
    }
  })

  surface.addEventListener('mousedown', (e) => {
    if (!isPluginMainSurfaceActive()) {
      return
    }
    isDragging = true
    activeDragSurface = surface
    lastMouseX = e.screenX
    lastMouseY = e.screenY
    queuePluginMainPointer(e, true)
    surface.style.cursor = 'grabbing'
    e.preventDefault()
  })

  surface.addEventListener('mouseup', (e) => {
    if (isDragging && activeDragSurface === surface) {
      isDragging = false
      activeDragSurface = null
      queuePluginMainPointer(e, true)
      surface.style.cursor = 'move'
    }
  })
}

attachOrbDragHandlers(canvas)
attachOrbDragHandlers(advancedOrbCanvas)
attachOrbDragHandlers(planetOrbCanvas)
attachPluginMainSurfaceHandlers(pluginUIMainView)

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false
    activeDragSurface?.style.setProperty('cursor', 'default')
    activeDragSurface = null
  }
})

function setOrbMode(mode: OrbState['mode']) {
  if (orbState.mode === mode) {
    return
  }

  orbState.mode = mode
  orbState.modeChangedAt = performance.now()
  advancedOrbRenderer?.setMode(mode)
  planetOrbRenderer?.setMode(mode)
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

function setOrbStyle(style: OrbStyle): void {
  if (currentOrbStyle === style) {
    renderOrbStyleControls()
    return
  }

  currentOrbStyle = style
  document.body.classList.toggle('advanced-orb-active', style === 'advanced')
  document.body.classList.toggle('planet-orb-active', style === 'planet')
  renderOrbStyleControls()
  stopOrbAnimation()
  disposeInactiveOrbRenderers(style)
  if (!orbAnimationPaused) {
    startOrbAnimation()
  }
}

type NoticeTone = 'info' | 'error'
type MainErrorScope =
  | 'asr'
  | 'tts'
  | 'voice'
  | 'task'
  | 'initialization'
  | 'message'
  | 'permission'

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || 'unknown error'
  }
  if (typeof error === 'string') {
    return error || 'unknown error'
  }
  return String(error ?? 'unknown error')
}

function formatErrorText(prefix: string, error: unknown): string {
  return `${prefix}: ${getErrorText(error)}`
}

function formatMainError(scope: MainErrorScope, error?: unknown): string {
  const message = getErrorText(error).trim()
  const lower = message.toLowerCase()

  if (scope === 'asr' || scope === 'voice') {
    if (lower.includes('unexpected server response: 404') || lower.includes(' 404')) {
      return 'ASR endpoint not found (404). Check the provider and Base URL.'
    }
    if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401')) {
      return 'ASR authentication failed. Check the API key.'
    }
    if (lower.includes('websocket connection aborted')) {
      return 'ASR connection was interrupted. Please try again.'
    }
    if (lower.includes('websocket') || lower.includes('connection') || lower.includes('network')) {
      return formatErrorText('ASR connection failed', error)
    }
    return formatErrorText('Voice input failed', error)
  }

  if (scope === 'tts') {
    if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('401')) {
      return 'TTS authentication failed. Check the API key.'
    }
    if (lower.includes('voice') || lower.includes('voiceid')) {
      return 'TTS voice is not available. Check the Voice ID.'
    }
    return formatErrorText('TTS playback failed', error)
  }

  if (scope === 'permission') {
    return message || 'Microphone permission is required.'
  }

  if (scope === 'task') {
    return message ? formatErrorText('Task failed', error) : 'Task failed.'
  }

  if (scope === 'initialization') {
    return formatErrorText('Initialization failed', error)
  }

  return formatErrorText('Message failed', error)
}

let mainNoticeTimer: number | undefined
function showMainNotice(text: string, tone: NoticeTone = 'info'): void {
  const notice = document.getElementById('main-notice')
  if (!notice) return

  notice.textContent = text
  notice.className = `main-notice visible ${tone === 'error' ? 'error' : ''}`
  window.clearTimeout(mainNoticeTimer)
  mainNoticeTimer = window.setTimeout(() => {
    notice.classList.remove('visible')
  }, tone === 'error' ? 3600 : 2200)
}

function showMainError(scope: MainErrorScope, error?: unknown): void {
  showMainNotice(formatMainError(scope, error), 'error')
}

let panelNoticeTimer: number | undefined
function hidePanelNotice(): void {
  const notice = document.getElementById('panel-notice')
  if (!notice) return

  window.clearTimeout(panelNoticeTimer)
  panelNoticeTimer = undefined
  notice.classList.remove('visible')
}

function showPanelNotice(text: string, tone: NoticeTone = 'info') {
  const notice = document.getElementById('panel-notice')
  if (!notice) return

  notice.textContent = text
  notice.className = `panel-notice visible ${tone === 'error' ? 'error' : ''}`
  window.clearTimeout(panelNoticeTimer)
  panelNoticeTimer = window.setTimeout(() => {
    notice.classList.remove('visible')
  }, tone === 'error' ? 3600 : 2200)
}

function showPanelError(prefix: string, error: unknown): void {
  showPanelNotice(formatErrorText(prefix, error), 'error')
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
    phase: lastConversationPhase,
    voiceInputEnabled,
    ttsEnabled,
    text: document.getElementById('text-display')?.textContent ?? '',
    expression: lastExpressionState,
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
    type: 'noema:ui-state',
    config: activePluginMainSurface?.config ?? activePluginTaskSurface?.config ?? {},
    state: getPluginUIState(),
  }

  document.querySelectorAll<HTMLIFrameElement>('.plugin-ui-surface-frame').forEach(frame => {
    frame.contentWindow?.postMessage(message, '*')
  })
}

type PluginPointerSnapshot = {
  active: boolean
  x: number
  y: number
  width: number
  height: number
}

let pendingPluginMainPointer: PluginPointerSnapshot | null = null
let pluginMainPointerFrame = 0
let lastPluginMainPointerActive = false

function queuePluginMainPointer(event: PointerEvent | null, active: boolean): void {
  queuePluginMainPointerClientPoint(
    event ? event.clientX : null,
    event ? event.clientY : null,
    active
  )
}

function queuePluginMainPointerClientPoint(clientX: number | null, clientY: number | null, active: boolean): void {
  const rect = pluginUIMainView.getBoundingClientRect()
  if (!active && !lastPluginMainPointerActive && !pendingPluginMainPointer) {
    return
  }

  pendingPluginMainPointer = {
    active,
    x: clientX === null ? rect.width / 2 : clientX - rect.left,
    y: clientY === null ? rect.height / 2 : clientY - rect.top,
    width: rect.width,
    height: rect.height,
  }

  if (pluginMainPointerFrame) {
    return
  }

  pluginMainPointerFrame = window.requestAnimationFrame(() => {
    pluginMainPointerFrame = 0
    const payload = pendingPluginMainPointer
    pendingPluginMainPointer = null
    if (!payload) {
      return
    }

    const frame = pluginUIMainView.querySelector<HTMLIFrameElement>('.plugin-ui-main-surface .plugin-ui-surface-frame')
    frame?.contentWindow?.postMessage({ type: 'noema:pointer', ...payload }, '*')
    lastPluginMainPointerActive = payload.active
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
  frame.src = appendPluginUIConfig(surface.src, surface.config)
  frame.title = surface.title || surface.id
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
  frame.setAttribute('aria-label', surface.title || surface.id)
  frame.addEventListener('load', () => syncPluginUIState())

  host.appendChild(frame)
  container.appendChild(host)
}

function appendPluginUIConfig(src: string, config: Record<string, unknown>): string {
  const url = new URL(src)
  url.searchParams.set('pluginConfig', btoa(unescape(encodeURIComponent(JSON.stringify(config)))))
  return url.toString()
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

  if (activePluginMainSurface?.mode !== 'replace') {
    pluginUIMainView.classList.remove('controls-peek')
  }

  renderPluginUISurface(pluginUIMainView, activePluginMainSurface)
  renderPluginUISurface(pluginUITaskPanel, activePluginTaskSurface)
  syncPluginUIStateSoon()
}

async function loadPluginUISurfaces(): Promise<void> {
  try {
    const result = await window.electronAPI.listPlugins()
    if (!result.success) {
      throw new Error(result.error || t('plugins.uiLoadFailed'))
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
  if (data.type === 'noema:ui-ready') {
    syncPluginUIState()
  } else if (data.type === 'noema:context-menu') {
    const x = Number.isFinite(data.x) ? Number(data.x) : window.innerWidth / 2
    const y = Number.isFinite(data.y) ? Number(data.y) : window.innerHeight / 2
    showContextMenuAt(x, y)
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
  lastExpressionState = null
  syncPluginUIStateSoon()

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
  lastExpressionState = {
    id: frame.id,
    emotion: frame.emotion,
    src: frame.src,
    priority,
  }
  syncPluginUIStateSoon()
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
    void window.electronAPI.setTaskWindowMode(visible)
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

  const details = [plan.currentStep, plan.nextAction, plan.lastObservation].filter(Boolean)
  const maxDetails = Math.max(0, 3 - Math.min(plan.steps.length, 3))
  for (const detail of details.slice(0, maxDetails)) {
    const item = document.createElement('li')
    item.className = 'task-step running'

    const mark = document.createElement('span')
    mark.className = 'task-step-mark'
    mark.textContent = '•'

    const text = document.createElement('span')
    text.className = 'task-step-title'
    text.textContent = detail

    item.append(mark, text)
    list.appendChild(item)
  }

  for (const thread of (plan.threads ?? []).slice(0, 4)) {
    const item = document.createElement('li')
    item.className = `task-step ${mapThreadBucketToStepStatus(thread.bucket)}`

    const mark = document.createElement('span')
    mark.className = 'task-step-mark'
    mark.textContent = thread.focused ? '•' : getThreadBucketMark(thread.bucket)

    const text = document.createElement('span')
    text.className = 'task-step-title'
    text.textContent = `${thread.goal} · ${thread.status}`

    item.append(mark, text)
    list.appendChild(item)
  }

  for (const run of (plan.longRuns ?? []).slice(0, 3)) {
    const item = document.createElement('li')
    item.className = `task-step ${run.status === 'failed' || run.status === 'needs_human' ? 'failed' : run.status === 'completed' ? 'completed' : 'running'}`

    const mark = document.createElement('span')
    mark.className = 'task-step-mark'
    mark.textContent = run.status === 'completed' ? '✓' : run.status === 'failed' ? '!' : '•'

    const text = document.createElement('span')
    text.className = 'task-step-title'
    text.textContent = `${run.goal} · ${run.metric}: ${run.latestResult} / best ${run.bestResult} / baseline ${run.baseline} · ${run.iterationCount} iterations`

    item.append(mark, text)
    list.appendChild(item)
  }

  setTaskPanelVisible(true)
  syncPluginUIStateSoon()
}

function mapThreadBucketToStepStatus(bucket: NonNullable<TaskPanelPlan['threads']>[number]['bucket']): TaskPanelStepStatus {
  if (bucket === 'completed') return 'completed'
  if (bucket === 'abandoned' || bucket === 'recoverable_failed') return 'failed'
  if (bucket === 'paused' || bucket === 'waiting') return 'pending'
  return 'running'
}

function getThreadBucketMark(bucket: NonNullable<TaskPanelPlan['threads']>[number]['bucket']): string {
  switch (bucket) {
    case 'completed':
      return '✓'
    case 'abandoned':
    case 'recoverable_failed':
      return '!'
    case 'paused':
    case 'waiting':
      return '-'
    default:
      return '•'
  }
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
      lastConversationPhase = null
      setTaskPanelVisible(false)
      setStatus(t('status.thinking'))
      setOrbMode('thinking')
      break
    case 'control.phase_start':
      lastConversationPhase = frame.phase
      if (frame.phase === 'reply') {
        setStatus(t('status.replying'))
      } else if (frame.phase === 'task_progress') {
        textRevealer.reset()
        clearTextDisplay()
        setStatus(t('status.working'))
      } else if (frame.phase === 'task_result') {
        audioPlayer.stop()
        textRevealer.reset()
        setStatus(t('status.sharingResult'))
      }
      setOrbMode('thinking')
      syncPluginUIStateSoon()
      break
    case 'control.phase_end':
      if (lastConversationPhase === frame.phase) {
        lastConversationPhase = null
      }
      if (frame.phase === 'reply' || frame.phase === 'task_progress' || frame.phase === 'task_result') {
        if (ttsEnabled) {
          textRevealer.reset()
          clearTextDisplay()
        }
        setStatus(getReadyStatus())
        setOrbMode('idle')
        clearExpressionAfterMinimum()
      }
      syncPluginUIStateSoon()
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
        showMainError('task', frame.error)
        setStatus(getReadyStatus())
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
      showMainError('tts', error)
      setStatus(getReadyStatus())
    })

    window.electronAPI.onLatencyData((data) => {
      console.log('[Latency] Received data:', data)
      if (data.total) {
        const msg = tf('status.latency', { ms: data.total.toFixed(0) })
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
      showMainError('asr', error)
      setStatus(getReadyStatus())
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
      showMainError('asr', 'Speech connection failed')
      setStatus(getReadyStatus())
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
    showMainError('initialization', error)
    setStatus(getReadyStatus())
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
    showMainError('voice', error)
    setStatus(getReadyStatus())
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
    showMainNotice('Voice input is disabled', 'info')
    setStatus(t('status.voiceInputDisabled'))
    return
  }

  if (!await ensureSetupReadyForConversation()) {
    return
  }

  try {
    await initialize()
    if (!isInitialized) {
      return
    }

    voiceRecorder.warmup().catch(console.warn)

    activeMode = 'conversation'
    await startConversationStreaming()
    updateConversationButton()
  } catch (error) {
    activeMode = null
    conversationStreamActive = false
    isVoiceListening = false
    textRevealer.reset()
    clearTextDisplay()
    showMainError('voice', error)
    setStatus(getReadyStatus())
    setOrbMode('idle')
    updateConversationButton()
  }
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
    showMainError('message', error)
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
const orbSettingsBtn = document.getElementById('orb-settings-btn') as HTMLButtonElement
const orbEntryMenu = document.getElementById('orb-entry-menu') as HTMLElement
const chatPanel = document.getElementById('chat-panel') as HTMLElement
const chatClose = document.getElementById('chat-close') as HTMLButtonElement
const chatComposeForm = document.getElementById('chat-compose-form') as HTMLFormElement
const chatComposeInput = document.getElementById('chat-compose-input') as HTMLTextAreaElement
const chatMessageList = document.getElementById('chat-message-list') as HTMLElement
const mainView = document.getElementById('main-view')!
const settingsNav = document.querySelector('.settings-nav') as HTMLElement
const modelNavItem = document.querySelector('.nav-item[data-section="models"]') as HTMLElement | null
const modelNavLabel = modelNavItem?.querySelector('.nav-label') as HTMLElement | null
const telemetryCpu = document.getElementById('telemetry-cpu') as HTMLElement
const telemetryWifi = document.getElementById('telemetry-wifi') as HTMLElement
const telemetryNetworkIcon = document.getElementById('telemetry-network-icon') as HTMLElement
const telemetryNetwork = document.getElementById('telemetry-network') as HTMLElement
const telemetryProxy = document.getElementById('telemetry-proxy') as HTMLElement
const aboutVersion = document.getElementById('about-version') as HTMLElement
const appUpdateButton = document.getElementById('app-update-button') as HTMLButtonElement
const appUpdateLabel = document.getElementById('app-update-label') as HTMLElement

let settingsCloseAnimationTimer: number | undefined
let telemetryRefreshTimer: number | undefined
let currentAppVersion = ''
let appUpdateChecking = false
let lastAppUpdateResult: AppUpdateCheckResult | null = null

let setupReadiness: SetupReadiness = { ready: true, issues: [] }
const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement
const volumeValue = document.getElementById('volume-value')!
const voiceInputBtn = document.getElementById('voice-input-btn') as HTMLButtonElement
const voiceOutputToggle = document.getElementById('voice-output-toggle') as HTMLInputElement
const languageSelect = document.getElementById('language-select') as HTMLSelectElement
const orbStyleTrigger = document.getElementById('orb-style-trigger') as HTMLButtonElement
const orbStyleLabel = document.getElementById('orb-style-label') as HTMLElement
const appearanceThemeTrigger = document.getElementById('appearance-theme-trigger') as HTMLButtonElement
const appearanceThemeLabel = document.getElementById('appearance-theme-label') as HTMLElement
const liquidGlassToggle = document.getElementById('liquid-glass-toggle') as HTMLInputElement
const dragonCursorToggle = document.getElementById('dragon-cursor-toggle') as HTMLInputElement
const selfLearningToggle = document.getElementById('self-learning-toggle') as HTMLInputElement
const selfLearningOpenBtn = document.getElementById('self-learning-open-btn') as HTMLButtonElement
const personalitySelect = document.getElementById('personality-select') as HTMLSelectElement
const addPersonalityFileBtn = document.getElementById('add-personality-file-btn') as HTMLButtonElement
const pluginsList = document.getElementById('plugins-list') as HTMLElement
const logsList = document.getElementById('logs-list') as HTMLElement
const clearLogsBtn = document.getElementById('clear-logs-btn') as HTMLButtonElement
const learningOverview = document.getElementById('learning-overview') as HTMLElement
const learningNav = document.getElementById('learning-nav') as HTMLElement
const learningReflectBtn = document.getElementById('learning-reflect-btn') as HTMLButtonElement
let memoryRefreshPromise: Promise<void> | null = null
let learningRefreshPromise: Promise<void> | null = null
type LearningView = 'overview' | 'agents' | 'candidates' | 'assets' | 'activity'
type LearningDetailType = 'agent' | 'candidate' | 'asset' | 'event' | 'reflection' | 'decision' | 'rollback'
type LearningOverviewData = {
  disabled?: boolean
  events?: any[]
  reflections?: any[]
  candidates?: any[]
  assets?: any[]
  agents?: any[]
  automationDecisions?: any[]
  rollbacks?: any[]
}

type AppUpdateCheckResult = Awaited<ReturnType<typeof window.electronAPI.checkForUpdates>>
let activeLearningView: LearningView = 'overview'
let lastLearningOverview: LearningOverviewData | null = null
let activeLearningDetail: { type: LearningDetailType; id: string } | null = null
let cachedPlugins: PluginInfo[] = []
let cachedPluginMarketplace: PluginMarketplaceItem[] = []
let pluginMarketplaceError = ''
let pluginMarketplaceSource = ''
let pluginMarketplaceQuery = ''
let pluginMarketplaceCached = false
let pluginMarketplaceFetchedAt: number | undefined
let pluginMarketplaceRefreshing = false
let installingMarketplacePluginId = ''
let activePluginPage: PluginPage = 'local'
let activePluginDetail: { pluginId: string; page: 'main' | 'advanced' } | null = null
let pluginsListLoadPromise: Promise<void> | null = null
let pluginsListLoaded = false
const live2dCapabilitiesCache = new Map<string, Live2dModelCapabilities>()
let logEntries: AppLogEntry[] = []
let activeLogLevel: AppLogLevel | 'all' = 'all'
let currentLiquidGlassEnabled = true
let currentDragonCursorEnabled = true
let liquidGlassSurface: ReturnType<typeof initializeLiquidGlassSurface> | null = null
const themeSliceTransition = new ThemeSliceTransition()

function applySettingsToUI(settings: UISettings) {
  setLanguage(settings.language || 'zh-CN')
  languageSelect.value = currentLanguage
  voiceInputEnabled = settings.voiceInputEnabled
  ttsEnabled = settings.voiceOutputEnabled
  voiceInputBtn.textContent = settings.voiceInputEnabled ? t('common.enabled') : t('common.enable')
  voiceInputBtn.classList.toggle('active', settings.voiceInputEnabled)
  voiceInputBtn.setAttribute('aria-pressed', settings.voiceInputEnabled ? 'true' : 'false')
  voiceOutputToggle.checked = settings.voiceOutputEnabled
  volumeSlider.value = String(settings.volume)
  volumeValue.textContent = `${settings.volume}%`
  audioPlayer.setVolume(settings.volume)
  setAppearanceTheme(parseAppearanceTheme(settings.appearance?.theme))
  setOrbStyle(parseOrbStyle(settings.appearance?.orbStyle))
  setLiquidGlassEnabled(settings.appearance?.liquidGlassEnabled !== false)
  setDragonCursorEnabled(settings.appearance?.dragonCursorEnabled !== false)
  selfLearningToggle.checked = settings.experimental?.selfLearningEnabled !== false
  selfLearningOpenBtn.hidden = settings.experimental?.selfLearningEnabled === false

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
      showMainError(
        'permission',
        permission.openedSettings
          ? 'Microphone permission requires approval in System Settings.'
          : formatErrorText('Microphone permission denied', permission.error)
      )
      setStatus(getReadyStatus())
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
    showPanelError('Failed to load personality list', result.error)
    return
  }

  personalitySelect.innerHTML = ''
  result.items.forEach((item) => {
    const option = document.createElement('option')
    option.value = item.id
    option.textContent = item.source === 'file'
      ? `${item.name} · ${t('personality.externalFile')}`
      : item.name
    option.title = item.path
    option.selected = item.id === result.current
    personalitySelect.appendChild(option)
  })
}

function renderOrbStyleControls(): void {
  const option = ORB_STYLE_OPTIONS.find(item => item.value === currentOrbStyle) ?? ORB_STYLE_OPTIONS[0]
  orbStyleLabel.textContent = t(option.labelKey)
  orbStyleTrigger.dataset.orbStyle = currentOrbStyle
}

function parseOrbStyle(value: unknown): OrbStyle {
  return value === 'advanced' || value === 'planet' ? value : 'default'
}

function renderAppearanceThemeControls(): void {
  const option = APPEARANCE_THEME_OPTIONS.find(item => item.value === currentAppearanceTheme) ?? APPEARANCE_THEME_OPTIONS[0]
  appearanceThemeLabel.textContent = t(option.labelKey)
  appearanceThemeTrigger.dataset.appearanceTheme = currentAppearanceTheme
}

function parseAppearanceTheme(value: unknown): AppearanceTheme {
  return value === 'day' ? 'day' : 'night'
}

function setAppearanceTheme(theme: AppearanceTheme): void {
  currentAppearanceTheme = theme
  document.body.classList.toggle('theme-day', theme === 'day')
  renderAppearanceThemeControls()
}

async function switchAppearanceTheme(theme: AppearanceTheme): Promise<void> {
  await themeSliceTransition.run(() => setAppearanceTheme(theme))
}

function setLiquidGlassEnabled(enabled: boolean): void {
  currentLiquidGlassEnabled = enabled
  liquidGlassToggle.checked = enabled
  document.body.classList.toggle('liquid-glass-disabled', !enabled)
  if (!enabled) {
    liquidGlassSurface?.destroy()
    liquidGlassSurface = null
    return
  }
  if (document.body.classList.contains('settings-open')) {
    ensureLiquidGlassSurfaceActive(true)
  }
}

function setDragonCursorEnabled(enabled: boolean): void {
  currentDragonCursorEnabled = enabled
  dragonCursorToggle.checked = enabled
  document.body.classList.toggle('dragon-cursor-disabled', !enabled)
}

function ensureLiquidGlassSurfaceActive(active: boolean): void {
  if (!currentLiquidGlassEnabled) {
    return
  }
  if (active && !liquidGlassSurface) {
    liquidGlassSurface = initializeLiquidGlassSurface()
  }
  liquidGlassSurface?.setActive(active)
}

function closeOrbStyleMenu(): void {
  document.getElementById('orb-style-floating-menu')?.remove()
  orbStyleTrigger.setAttribute('aria-expanded', 'false')
}

function closeAppearanceThemeMenu(): void {
  document.getElementById('appearance-theme-floating-menu')?.remove()
  appearanceThemeTrigger.setAttribute('aria-expanded', 'false')
}

function openOrbStyleMenu(): void {
  closeProviderMenu()
  closeOrbStyleMenu()
  orbStyleTrigger.setAttribute('aria-expanded', 'true')

  const rect = orbStyleTrigger.getBoundingClientRect()
  const menuWidth = Math.max(168, rect.width)
  const optionHeight = 32
  const menu = document.createElement('div')
  menu.id = 'orb-style-floating-menu'
  menu.className = 'config-provider-floating-menu appearance-provider-menu'
  menu.setAttribute('role', 'listbox')
  menu.style.minWidth = `${menuWidth}px`
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menuWidth - 12)}px`
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - ORB_STYLE_OPTIONS.length * optionHeight - 14)}px`
  menu.innerHTML = ORB_STYLE_OPTIONS.map(option => `
    <button class="config-provider-option appearance-provider-option ${option.value === currentOrbStyle ? 'selected' : ''}" type="button" role="option" aria-selected="${option.value === currentOrbStyle ? 'true' : 'false'}" data-orb-style="${option.value}">
      <span class="config-provider-option-check">${option.value === currentOrbStyle ? '✓' : ''}</span>
      <span class="orb-style-glyph" data-orb-style="${option.value}" aria-hidden="true"></span>
      <span class="config-provider-option-label">${escapeHtml(t(option.labelKey))}</span>
    </button>
  `).join('')

  menu.querySelectorAll<HTMLButtonElement>('.appearance-provider-option').forEach(option => {
    option.addEventListener('click', async () => {
      const orbStyle = parseOrbStyle(option.dataset.orbStyle)
      closeOrbStyleMenu()
      if (orbStyle === currentOrbStyle) return
      setOrbStyle(orbStyle)
      await window.electronAPI.updateSettings({
        appearance: {
          orbStyle,
          theme: currentAppearanceTheme,
          liquidGlassEnabled: currentLiquidGlassEnabled,
          dragonCursorEnabled: currentDragonCursorEnabled
        }
      })
    })
  })

  document.body.appendChild(menu)
}

function openAppearanceThemeMenu(): void {
  closeProviderMenu()
  closeOrbStyleMenu()
  closeAppearanceThemeMenu()
  appearanceThemeTrigger.setAttribute('aria-expanded', 'true')

  const rect = appearanceThemeTrigger.getBoundingClientRect()
  const menuWidth = Math.max(168, rect.width)
  const optionHeight = 32
  const menu = document.createElement('div')
  menu.id = 'appearance-theme-floating-menu'
  menu.className = 'config-provider-floating-menu appearance-provider-menu'
  menu.setAttribute('role', 'listbox')
  menu.style.minWidth = `${menuWidth}px`
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menuWidth - 12)}px`
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - APPEARANCE_THEME_OPTIONS.length * optionHeight - 14)}px`
  menu.innerHTML = APPEARANCE_THEME_OPTIONS.map(option => `
    <button class="config-provider-option appearance-theme-option ${option.value === currentAppearanceTheme ? 'selected' : ''}" type="button" role="option" aria-selected="${option.value === currentAppearanceTheme ? 'true' : 'false'}" data-appearance-theme="${option.value}">
      <span class="config-provider-option-check">${option.value === currentAppearanceTheme ? '✓' : ''}</span>
      <span class="appearance-provider-option-spacer" aria-hidden="true"></span>
      <span class="config-provider-option-label">${escapeHtml(t(option.labelKey))}</span>
    </button>
  `).join('')

  menu.querySelectorAll<HTMLButtonElement>('.appearance-theme-option').forEach(option => {
    option.addEventListener('click', async () => {
      const theme = parseAppearanceTheme(option.dataset.appearanceTheme)
      closeAppearanceThemeMenu()
      if (theme === currentAppearanceTheme) return
      await switchAppearanceTheme(theme)
      await window.electronAPI.updateSettings({
        appearance: {
          orbStyle: currentOrbStyle,
          theme,
          liquidGlassEnabled: currentLiquidGlassEnabled,
          dragonCursorEnabled: currentDragonCursorEnabled
        }
      })
    })
  })

  document.body.appendChild(menu)
}

orbStyleTrigger.addEventListener('click', (event) => {
  event.stopPropagation()
  if (orbStyleTrigger.getAttribute('aria-expanded') === 'true') {
    closeOrbStyleMenu()
  } else {
    openOrbStyleMenu()
  }
})

appearanceThemeTrigger.addEventListener('click', (event) => {
  event.stopPropagation()
  if (appearanceThemeTrigger.getAttribute('aria-expanded') === 'true') {
    closeAppearanceThemeMenu()
  } else {
    openAppearanceThemeMenu()
  }
})

liquidGlassToggle.addEventListener('change', async () => {
  const enabled = liquidGlassToggle.checked
  setLiquidGlassEnabled(enabled)
  await window.electronAPI.updateSettings({
    appearance: {
      orbStyle: currentOrbStyle,
      theme: currentAppearanceTheme,
      liquidGlassEnabled: enabled,
      dragonCursorEnabled: currentDragonCursorEnabled
    }
  })
})

dragonCursorToggle.addEventListener('change', async () => {
  const enabled = dragonCursorToggle.checked
  setDragonCursorEnabled(enabled)
  await window.electronAPI.updateSettings({
    appearance: {
      orbStyle: currentOrbStyle,
      theme: currentAppearanceTheme,
      liquidGlassEnabled: currentLiquidGlassEnabled,
      dragonCursorEnabled: enabled
    }
  })
})

selfLearningToggle.addEventListener('change', async () => {
  const settings = await window.electronAPI.updateSettings({
    experimental: {
      selfLearningEnabled: selfLearningToggle.checked
    }
  })
  applySettingsToUI(settings)
  if (document.getElementById('section-learning')?.classList.contains('active')) {
    await refreshLearningSection()
  }
})

selfLearningOpenBtn.addEventListener('click', () => {
  switchSettingsSection('learning')
})

// Hide context menu when clicking elsewhere
document.addEventListener('click', () => {
  contextMenu.classList.remove('visible')
})

function showContextMenuAt(clientX: number, clientY: number): void {
  const x = Math.max(0, Math.min(clientX, window.innerWidth - 180))
  const y = Math.max(0, Math.min(clientY, window.innerHeight - 150))

  contextMenu.style.left = `${x}px`
  contextMenu.style.top = `${y}px`
  contextMenu.classList.add('visible')
}

mainView.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  showContextMenuAt(e.clientX, e.clientY)
})

function waitForNextPaint(): Promise<void> {
  return new Promise(resolve => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}

function getVisibleOrbElement(): HTMLElement {
  if (activePluginMainSurface?.mode === 'replace') {
    const pluginSurface = pluginUIMainView.querySelector<HTMLElement>('.plugin-ui-main-surface.replace')
    if (pluginSurface) {
      return pluginUIMainView
    }
  }

  const candidates: HTMLElement[] = [
    planetOrbCanvas,
    advancedOrbCanvas,
    canvas,
  ]
  return candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && getComputedStyle(candidate).display !== 'none'
  }) ?? pluginUIMainView
}

function getOrbCaptureRect(): { x: number; y: number; width: number; height: number } {
  const target = getVisibleOrbElement()
  const targetRect = target.getBoundingClientRect()
  const slotRect = pluginUIMainView.getBoundingClientRect()
  const padding = target === pluginUIMainView ? 0 : 14

  const left = Math.max(0, Math.max(slotRect.left, targetRect.left - padding))
  const top = Math.max(0, Math.max(slotRect.top, targetRect.top - padding))
  const right = Math.min(window.innerWidth, Math.min(slotRect.right, targetRect.right + padding))
  const bottom = Math.min(window.innerHeight, Math.min(slotRect.bottom, targetRect.bottom + padding))

  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

function getHighResolutionCaptureRect(): {
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
} {
  const rect = getOrbCaptureRect()
  const scaleFactor = Math.max(1, Math.min(4, window.devicePixelRatio || 1))
  return {
    ...rect,
    scaleFactor,
  }
}

async function captureOrbToClipboard(): Promise<void> {
  contextMenu.classList.remove('visible')
  contextMenu.style.display = 'none'

  try {
    await waitForNextPaint()

    const result = await window.electronAPI.captureToClipboard(getHighResolutionCaptureRect())
    if (result.success) {
      showPanelNotice(t('notice.orbCaptureCopied'))
      return
    }

    showPanelError('Capture failed', result.error)
  } finally {
    contextMenu.style.removeProperty('display')
  }
}

function setPluginControlsPeek(visible: boolean): void {
  if (activePluginMainSurface?.mode !== 'replace') {
    mainView.classList.remove('controls-peek')
    return
  }

  mainView.classList.toggle('controls-peek', visible)
  if (pluginControlsPeekTimer !== undefined) {
    window.clearTimeout(pluginControlsPeekTimer)
    pluginControlsPeekTimer = undefined
  }

  if (visible) {
    pluginControlsPeekTimer = window.setTimeout(() => {
      mainView.classList.remove('controls-peek')
      pluginControlsPeekTimer = undefined
    }, 1800)
  }
}

window.addEventListener('pointermove', (event) => {
  if (activePluginMainSurface?.mode !== 'replace' || document.body.classList.contains('settings-open')) {
    setPluginControlsPeek(false)
    queuePluginMainPointer(null, false)
    return
  }
  if (event.target instanceof Node && pluginUIMainView.contains(event.target)) {
    return
  }

  const rect = mainView.getBoundingClientRect()
  const insideMainView = event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom

  const controls = startConversationBtn.closest<HTMLElement>('.controls')
  const controlsRect = controls?.getBoundingClientRect()
  const insideControls = Boolean(controlsRect &&
    event.clientX >= controlsRect.left - 24 &&
    event.clientX <= controlsRect.right + 24 &&
    event.clientY >= controlsRect.top - 24 &&
    event.clientY <= controlsRect.bottom + 32)
  const nearControlBand = insideMainView && event.clientY >= rect.bottom - Math.max(96, rect.height * 0.26)

  queuePluginMainPointer(event, insideMainView)
  setPluginControlsPeek(insideControls || nearControlBand)
})

window.addEventListener('pointerleave', () => {
  queuePluginMainPointer(null, false)
  setPluginControlsPeek(false)
})

async function loadLogsSection(): Promise<void> {
  const result = await window.electronAPI.listLogs(1200)
  if (!result.success) {
    logsList.innerHTML = `<div class="config-empty">${escapeHtml(t('logs.loadFailed'))}</div>`
    return
  }
  logEntries = result.logs
  renderLogs()
}

function renderLogs(): void {
  const visibleLogs = activeLogLevel === 'all'
    ? logEntries
    : logEntries.filter(entry => entry.level === activeLogLevel)

  if (visibleLogs.length === 0) {
    logsList.innerHTML = `<div class="config-empty">${escapeHtml(t('logs.empty'))}</div>`
    return
  }

  logsList.innerHTML = visibleLogs.slice(-500).reverse().map(renderLogEntry).join('')
}

function appendVisibleLogs(entries: AppLogEntry[]): void {
  const visibleEntries = activeLogLevel === 'all'
    ? entries
    : entries.filter(entry => entry.level === activeLogLevel)
  if (visibleEntries.length === 0) return

  if (logsList.querySelector('.config-empty')) {
    logsList.innerHTML = ''
  }

  const fragment = document.createDocumentFragment()
  visibleEntries.slice(-500).reverse().forEach(entry => {
    const template = document.createElement('template')
    template.innerHTML = renderLogEntry(entry).trim()
    const node = template.content.firstElementChild
    if (node) {
      fragment.appendChild(node)
    }
  })
  logsList.insertBefore(fragment, logsList.firstChild)

  while (logsList.children.length > 500) {
    logsList.lastElementChild?.remove()
  }
}

function renderLogEntry(entry: AppLogEntry): string {
  return `
    <article class="log-entry level-${entry.level}" data-log-key="${escapeHtml(`${entry.time}:${entry.type}:${entry.level}`)}">
      <div class="log-entry-meta">
        <span class="log-time">${escapeHtml(formatLogTime(entry.time))}</span>
        <span class="log-level">${escapeHtml(entry.level.toUpperCase())}</span>
        <span class="log-type">${escapeHtml(entry.type)}</span>
      </div>
      <pre class="log-message">${escapeHtml(entry.message)}</pre>
    </article>
  `
}

function formatLogTime(time: number): string {
  const date = new Date(time)
  const pad = (value: number, length = 2) => String(value).padStart(length, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function isLogsSectionActive(): boolean {
  return document.getElementById('section-logs')?.classList.contains('active') === true
}

function isSettingsSectionActive(section: string): boolean {
  return document.getElementById(`section-${section}`)?.classList.contains('active') === true
}

function updateLogsStreaming(): void {
  window.electronAPI.setLogsStreaming(document.body.classList.contains('settings-open') && isLogsSectionActive())
}

async function refreshLearningSection(): Promise<void> {
  if (learningRefreshPromise) {
    return learningRefreshPromise
  }

  learningOverview.innerHTML = `<div class="profile-loading">${escapeHtml(t('common.loading'))}</div>`
  learningRefreshPromise = window.electronAPI.getLearningOverview()
    .then((result) => {
      if (!result.success) {
        learningOverview.innerHTML = `<div class="profile-loading">${escapeHtml(tf('learning.loadFailed', { error: result.error ?? 'unknown error' }))}</div>`
        return
      }
      if (result.disabled) {
        lastLearningOverview = result
        learningOverview.innerHTML = `<div class="profile-loading">${escapeHtml(t('learning.disabled'))}</div>`
        return
      }
      renderLearningOverview(result)
    })
    .catch((error) => {
      learningOverview.innerHTML = `<div class="profile-loading">${escapeHtml(tf('learning.loadFailed', { error: error instanceof Error ? error.message : String(error) }))}</div>`
    })
    .finally(() => {
      learningRefreshPromise = null
    })

  return learningRefreshPromise
}

function renderLearningOverview(result: LearningOverviewData): void {
  lastLearningOverview = result
  learningNav.querySelectorAll<HTMLButtonElement>('.learning-nav-item').forEach(button => {
    button.classList.toggle('active', button.dataset.learningView === activeLearningView)
  })
  learningOverview.innerHTML = renderLearningApp(result)
  attachLearningAppHandlers()
}

function renderLearningApp(result: LearningOverviewData): string {
  switch (activeLearningView) {
    case 'agents':
      return renderLearningAgents(result)
    case 'candidates':
      return renderLearningCandidates(result)
    case 'assets':
      return renderLearningAssets(result)
    case 'activity':
      return renderLearningActivity(result)
    case 'overview':
    default:
      return renderLearningDashboard(result)
  }
}

function renderLearningDashboard(result: LearningOverviewData): string {
  const candidates = result.candidates ?? []
  const assets = result.assets ?? []
  const agents = result.agents ?? []
  const events = result.events ?? []
  const pendingCandidates = candidates.filter(item => item.status === 'pending')
  const activeAssets = assets.filter(item => item.status === 'active')
  const activeAgents = agents.filter(item => item.status === 'active')
  const needsReview = pendingCandidates.length + assets.filter(item => item.status === 'draft').length

  return `
    <div class="learning-dashboard">
      <div class="learning-metrics">
        ${renderLearningMetric(t('learning.health'), needsReview > 0 ? t('learning.healthNeedsReview') : t('learning.healthReady'), needsReview > 0 ? 'warn' : 'ready')}
        ${renderLearningMetric(t('learning.pendingReview'), String(needsReview), 'neutral')}
        ${renderLearningMetric(t('learning.activeAssets'), String(activeAssets.length), 'ready')}
        ${renderLearningMetric(t('learning.activeAgents'), String(activeAgents.length), 'ready')}
      </div>
      <div class="learning-two-column">
        <section class="learning-panel">
          <div class="learning-panel-header">
            <span>${escapeHtml(t('learning.queue'))}</span>
            <button class="learning-panel-link" type="button" data-learning-view-jump="candidates">${escapeHtml(t('learning.viewCandidates'))}</button>
          </div>
          <div class="learning-list compact">
            ${pendingCandidates.length
              ? pendingCandidates.slice(0, 5).map(item => renderLearningObjectRow('candidate', item)).join('')
              : renderLearningEmpty()}
          </div>
        </section>
        <section class="learning-panel">
          <div class="learning-panel-header">
            <span>${escapeHtml(t('learning.agentControl'))}</span>
            <button class="learning-panel-link" type="button" data-learning-view-jump="agents">${escapeHtml(t('learning.viewAgents'))}</button>
          </div>
          <div class="learning-list compact">
            ${agents.length
              ? agents.slice(0, 5).map(item => renderLearningObjectRow('agent', item)).join('')
              : renderLearningEmpty()}
          </div>
        </section>
      </div>
      <section class="learning-panel">
        <div class="learning-panel-header">
          <span>${escapeHtml(t('learning.recentSignals'))}</span>
          <button class="learning-panel-link" type="button" data-learning-view-jump="activity">${escapeHtml(t('learning.viewActivity'))}</button>
        </div>
        <div class="learning-timeline compact">
          ${events.length ? events.slice(-8).reverse().map(item => renderLearningActivityItem('event', item)).join('') : renderLearningEmpty()}
        </div>
      </section>
    </div>
  `
}

function renderLearningAgents(result: LearningOverviewData): string {
  const agents = result.agents ?? []
  return renderLearningSplitPage(
    t('learning.agentControl'),
    agents,
    (item) => renderLearningObjectRow('agent', item),
    renderLearningDetail('agent', findLearningDetailItem(result, 'agent', activeLearningDetail?.id))
  )
}

function renderLearningCandidates(result: LearningOverviewData): string {
  const candidates = result.candidates ?? []
  return renderLearningSplitPage(
    t('learning.queue'),
    candidates,
    (item) => renderLearningObjectRow('candidate', item),
    renderLearningDetail('candidate', findLearningDetailItem(result, 'candidate', activeLearningDetail?.id))
  )
}

function renderLearningAssets(result: LearningOverviewData): string {
  const assets = result.assets ?? []
  return renderLearningSplitPage(
    t('learning.assetLibrary'),
    assets,
    (item) => renderLearningObjectRow('asset', item),
    renderLearningDetail('asset', findLearningDetailItem(result, 'asset', activeLearningDetail?.id))
  )
}

function renderLearningActivity(result: LearningOverviewData): string {
  const activity = [
    ...(result.automationDecisions ?? []).map(item => ({ type: 'decision' as const, item })),
    ...(result.rollbacks ?? []).map(item => ({ type: 'rollback' as const, item })),
    ...(result.reflections ?? []).map(item => ({ type: 'reflection' as const, item })),
    ...(result.events ?? []).map(item => ({ type: 'event' as const, item })),
  ].sort((left, right) => getLearningTime(right.item) - getLearningTime(left.item))

  return renderLearningSplitPage(
    t('learning.activityTimeline'),
    activity,
    ({ type, item }) => renderLearningActivityItem(type, item),
    activeLearningDetail ? renderLearningDetail(activeLearningDetail.type, findLearningDetailItem(result, activeLearningDetail.type, activeLearningDetail.id)) : renderLearningNoSelection()
  )
}

function renderLearningSplitPage<T>(
  title: string,
  items: T[],
  renderItem: (item: T) => string,
  detail: string
): string {
  return `
    <div class="learning-split-page">
      <section class="learning-panel learning-master">
        <div class="learning-panel-header">
          <span>${escapeHtml(title)}</span>
          <span>${escapeHtml(tf('common.items', { count: items.length }))}</span>
        </div>
        <div class="learning-list">
          ${items.length ? items.map(renderItem).join('') : renderLearningEmpty()}
        </div>
      </section>
      <section class="learning-panel learning-detail">
        <div class="learning-detail-content" data-learning-detail-pane>
          ${detail}
        </div>
      </section>
    </div>
  `
}

function renderLearningMetric(label: string, value: string, tone: 'ready' | 'warn' | 'neutral'): string {
  return `
    <div class="learning-metric ${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `
}

function renderLearningObjectRow(type: 'agent' | 'candidate' | 'asset', item: any): string {
  const id = String(item.id ?? '')
  const selected = activeLearningDetail?.type === type && activeLearningDetail.id === id
  const title = type === 'agent' ? item.name ?? id : type === 'asset' ? item.scope ?? id : item.reason ?? id
  const subtitle = type === 'agent'
    ? item.purpose ?? item.routingPolicy ?? ''
    : type === 'asset'
      ? `${item.kind ?? ''} · ${item.status ?? ''}`
      : `${item.kind ?? ''} · ${item.status ?? ''} · ${formatConfidence(item.confidence)}`
  const actions = type === 'agent'
    ? renderAgentActions(item)
    : type === 'asset'
      ? renderAssetActions(item)
      : renderCandidateActions(item)
  return `
    <article class="learning-object ${selected ? 'selected' : ''}" data-learning-detail-type="${type}" data-learning-detail-id="${escapeHtml(id)}">
      <div class="learning-object-main">
        <div class="learning-object-title">${escapeHtml(title)}</div>
        <div class="learning-object-meta">${escapeHtml(subtitle)}</div>
      </div>
      <div class="learning-object-actions">${actions}</div>
    </article>
  `
}

function renderCandidateActions(item: any): string {
  if (item.status === 'deployed') {
    return ''
  }
  return `<button class="settings-btn compact-btn" type="button" data-learning-deploy="${escapeHtml(item.id ?? '')}" data-learning-kind="${escapeHtml(item.kind ?? '')}">${escapeHtml(t('learning.createDraft'))}</button>`
}

function renderAssetActions(item: any): string {
  const nextStatus = item.status === 'active' ? 'disabled' : 'active'
  const label = nextStatus === 'active' ? t('learning.activate') : t('learning.disable')
  return `
    <button class="settings-btn compact-btn" type="button" data-asset-status="${escapeHtml(item.id ?? '')}" data-status="${nextStatus}">${escapeHtml(label)}</button>
    <button class="settings-btn compact-btn" type="button" data-asset-rollback="${escapeHtml(item.id ?? '')}">${escapeHtml(t('learning.rollback'))}</button>
  `
}

function renderAgentActions(item: any): string {
  const nextStatus = item.status === 'active' ? 'disabled' : 'active'
  const label = nextStatus === 'active' ? t('learning.activate') : t('learning.disable')
  return `<button class="settings-btn compact-btn" type="button" data-agent-status="${escapeHtml(item.id ?? '')}" data-status="${nextStatus}">${escapeHtml(label)}</button>`
}

function renderLearningActivityItem(type: 'event' | 'reflection' | 'decision' | 'rollback', item: any): string {
  const id = String(item.id ?? `${type}-${getLearningTime(item)}`)
  const title = type === 'event'
    ? item.name ?? 'event'
    : type === 'reflection'
      ? item.summary ?? 'reflection'
      : type === 'decision'
        ? item.action ?? 'decision'
        : item.assetId ?? 'rollback'
  const desc = type === 'event'
    ? [item.taskId ? `task ${item.taskId}` : '', item.turnId ? `turn ${item.turnId}` : '', formatTimestamp(item.timestamp)].filter(Boolean).join(' · ')
    : type === 'reflection'
      ? [`${(item.sourceEventIds ?? []).length} events`, formatTimestamp(item.createdAt)].join(' · ')
      : type === 'decision'
        ? [item.risk ? `${t('learning.risk')} ${item.risk}` : '', item.reason ?? '', formatTimestamp(item.createdAt)].filter(Boolean).join(' · ')
        : [`${item.previousStatus ?? ''} -> ${item.restoredStatus ?? ''}`, item.reason ?? '', formatTimestamp(item.createdAt)].filter(Boolean).join(' · ')
  const selected = activeLearningDetail?.type === type && activeLearningDetail.id === id
  return `
    <article class="learning-activity-item ${selected ? 'selected' : ''}" data-learning-detail-type="${type}" data-learning-detail-id="${escapeHtml(id)}">
      <span class="learning-activity-dot"></span>
      <div>
        <div class="learning-object-title">${escapeHtml(title)}</div>
        <div class="learning-object-meta">${escapeHtml(desc)}</div>
      </div>
    </article>
  `
}

function renderLearningDetail(type: string, item: any): string {
  if (!item) {
    return renderLearningNoSelection()
  }
  const rows = buildLearningDetailRows(type, item)
  return `
    <div class="learning-detail-header">
      <span>${escapeHtml(t('learning.detail'))}</span>
      <strong>${escapeHtml(getLearningDetailTitle(type, item))}</strong>
    </div>
    <div class="learning-detail-grid">
      ${rows.map(([label, value]) => `
        <div class="learning-detail-row">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>
      `).join('')}
    </div>
    ${renderLearningJsonBlock(item)}
  `
}

function buildLearningDetailRows(type: string, item: any): Array<[string, string]> {
  if (type === 'agent') {
    return [
      [t('learning.status'), item.status ?? ''],
      [t('learning.mode'), item.mode ?? ''],
      [t('learning.routingPolicy'), item.routingPolicy ?? ''],
      [t('learning.capabilities'), [...(item.capabilities ?? []), ...(item.ownCapabilities ?? [])].join(' / ') || t('common.none')],
      [t('learning.createdAt'), formatTimestamp(item.createdAt)],
      [t('learning.updatedAt'), formatTimestamp(item.updatedAt)],
    ]
  }
  if (type === 'candidate') {
    return [
      [t('learning.kind'), item.kind ?? ''],
      [t('learning.status'), item.status ?? ''],
      [t('learning.confidence'), formatConfidence(item.confidence)],
      [t('learning.risk'), item.risk ?? ''],
      [t('learning.expectedBenefit'), item.expectedBenefit ?? ''],
      [t('learning.evidence'), (item.evidence ?? []).join(' / ') || t('common.none')],
    ]
  }
  if (type === 'asset') {
    return [
      [t('learning.kind'), item.kind ?? ''],
      [t('learning.status'), item.status ?? ''],
      [t('learning.scope'), item.scope ?? ''],
      [t('learning.confidence'), formatConfidence(item.confidence)],
      [t('learning.createdAt'), formatTimestamp(item.createdAt)],
      [t('learning.updatedAt'), formatTimestamp(item.updatedAt)],
    ]
  }
  return [
    [t('learning.kind'), type],
    [t('learning.createdAt'), formatTimestamp(getLearningTime(item))],
  ]
}

function renderLearningNoSelection(): string {
  return `
    <div class="learning-no-selection">
      <span>${escapeHtml(t('learning.detail'))}</span>
      <p>${escapeHtml(t('learning.noSelection'))}</p>
    </div>
  `
}

function renderLearningJsonBlock(item: any): string {
  return `<pre class="learning-json">${escapeHtml(JSON.stringify(item, null, 2))}</pre>`
}

function renderLearningEmpty(): string {
  return `<div class="config-empty">${escapeHtml(t('learning.emptyHint'))}</div>`
}

function syncLearningDetailPane(type: LearningDetailType, id: string): void {
  if (!lastLearningOverview) return

  learningOverview
    .querySelectorAll<HTMLElement>('[data-learning-detail-type][data-learning-detail-id]')
    .forEach(item => {
      item.classList.toggle(
        'selected',
        item.dataset.learningDetailType === type && item.dataset.learningDetailId === id
      )
    })

  const pane = learningOverview.querySelector<HTMLElement>('[data-learning-detail-pane]')
  const detailItem = findLearningDetailItem(lastLearningOverview, type, id)
  if (pane) {
    pane.innerHTML = renderLearningDetail(type, detailItem)
  }
}

function attachLearningAppHandlers(): void {
  learningOverview.querySelectorAll<HTMLButtonElement>('[data-learning-view-jump]').forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.learningViewJump as LearningView | undefined
      if (view) {
        setLearningView(view)
      }
    })
  })

  learningOverview.querySelectorAll<HTMLElement>('[data-learning-detail-type][data-learning-detail-id]').forEach(item => {
    item.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button')) {
        return
      }
      const type = item.dataset.learningDetailType as LearningDetailType | undefined
      const id = item.dataset.learningDetailId
      if (!type || !id) {
        return
      }
      activeLearningDetail = { type, id }
      syncLearningDetailPane(type, id)
    })
  })

  learningOverview.querySelectorAll<HTMLButtonElement>('[data-learning-deploy]').forEach(button => {
    button.addEventListener('click', async () => {
      const candidateId = button.dataset.learningDeploy
      const kind = button.dataset.learningKind
      if (!candidateId) return
      button.disabled = true
      const scope = kind === 'agent' ? 'agent' : 'task'
      const response = await window.electronAPI.deployLearningCandidate({ candidateId, scope, status: 'draft' })
      if (!response.success) {
        showNotice(formatErrorText('Deploy failed', response.error))
      }
      await refreshLearningSection()
    })
  })

  learningOverview.querySelectorAll<HTMLButtonElement>('[data-asset-status]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.assetStatus
      const status = button.dataset.status as 'draft' | 'active' | 'disabled' | 'archived' | undefined
      if (!id || !status) return
      button.disabled = true
      const response = await window.electronAPI.setLearningAssetStatus(id, status)
      if (!response.success) {
        showNotice(formatErrorText('Update failed', response.error))
      }
      await refreshLearningSection()
    })
  })

  learningOverview.querySelectorAll<HTMLButtonElement>('[data-asset-rollback]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.assetRollback
      if (!id) return
      button.disabled = true
      const response = await window.electronAPI.rollbackLearningAsset(id, 'Rolled back from Learning Center')
      if (!response.success) {
        showNotice(formatErrorText('Rollback failed', response.error))
      }
      await refreshLearningSection()
    })
  })

  learningOverview.querySelectorAll<HTMLButtonElement>('[data-agent-status]').forEach(button => {
    button.addEventListener('click', async () => {
      const id = button.dataset.agentStatus
      const status = button.dataset.status as 'draft' | 'active' | 'disabled' | undefined
      if (!id || !status) return
      button.disabled = true
      const response = await window.electronAPI.setRuntimeAgentStatus(id, status)
      if (!response.success) {
        showNotice(formatErrorText('Update failed', response.error))
      }
      await refreshLearningSection()
    })
  })
}

function setLearningView(view: LearningView): void {
  activeLearningView = view
  activeLearningDetail = null
  if (lastLearningOverview) {
    renderLearningOverview(lastLearningOverview)
  } else {
    void refreshLearningSection()
  }
}

function findLearningDetailItem(result: LearningOverviewData, type: string, id?: string): any {
  if (!id) {
    return null
  }
  const sources: Record<string, any[]> = {
    agent: result.agents ?? [],
    candidate: result.candidates ?? [],
    asset: result.assets ?? [],
    event: result.events ?? [],
    reflection: result.reflections ?? [],
    decision: result.automationDecisions ?? [],
    rollback: result.rollbacks ?? [],
  }
  return (sources[type] ?? []).find(item => String(item.id ?? `${type}-${getLearningTime(item)}`) === id) ?? null
}

function getLearningDetailTitle(type: string, item: any): string {
  if (type === 'agent') {
    return item.name ?? item.id ?? type
  }
  if (type === 'candidate') {
    return item.reason ?? item.id ?? type
  }
  if (type === 'asset') {
    return item.scope ?? item.id ?? type
  }
  return item.name ?? item.summary ?? item.action ?? item.id ?? type
}

function getLearningTime(item: any): number {
  const value = item?.createdAt ?? item?.updatedAt ?? item?.timestamp ?? 0
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function formatConfidence(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : t('common.none')
}

function formatTimestamp(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toLocaleString()
    : ''
}

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
    case 'chat':
      void chatPanelController.open()
      break
    case 'capture-orb':
      void captureOrbToClipboard()
      break
    case 'clear-history':
      clearHistory()
      break
  }

  contextMenu.classList.remove('visible')
})

function formatTelemetryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '--'
  }
  const mib = bytes / 1024 / 1024
  if (mib >= 1024) {
    return `${(mib / 1024).toFixed(1)}G`
  }
  return `${mib.toFixed(1)}M`
}

function formatTelemetryPercent(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '--'
  }
  return `${Math.round(value)}%`
}

function getConnectionTelemetry(telemetry: SystemTelemetry): { wifi: string; cellular: string } {
  if (!navigator.onLine || telemetry.activeNetworkInterfaces === 0) {
    return { wifi: 'OFF', cellular: '--' }
  }

  const connection = (navigator as any).connection
  const downlink = typeof connection?.downlink === 'number'
    ? `${connection.downlink.toFixed(connection.downlink >= 10 ? 0 : 1)}M`
    : '--'

  return {
    wifi: telemetry.activeNetworkInterfaces > 1 ? `${telemetry.activeNetworkInterfaces} NET` : 'ON',
    cellular: downlink,
  }
}

async function refreshSystemTelemetry(): Promise<void> {
  try {
    const telemetry = await window.electronAPI.getSystemTelemetry()
    if (!telemetry.success) {
      throw new Error(telemetry.error ?? 'telemetry unavailable')
    }
    const connection = getConnectionTelemetry(telemetry)
    telemetryCpu.textContent = formatTelemetryPercent(telemetry.cpuPercent)
    telemetryCpu.title = `Memory: ${formatTelemetryBytes(telemetry.memoryBytes)}`
    telemetryWifi.textContent = connection.wifi
    telemetryNetwork.textContent = connection.cellular
    telemetryProxy.textContent = telemetry.proxyActive ? '已启用' : '未启用'
    telemetryProxy.title = telemetry.activeProxyUrl ? `Proxy: ${telemetry.activeProxyUrl}` : ''
    telemetryNetworkIcon.classList.toggle('proxy-active', telemetry.proxyActive)
  } catch {
    telemetryCpu.textContent = '--'
    telemetryCpu.title = ''
    telemetryWifi.textContent = '--'
    telemetryNetwork.textContent = 'UNKNOWN'
    telemetryProxy.textContent = '--'
    telemetryProxy.title = ''
    telemetryNetworkIcon.classList.remove('proxy-active')
  }
}

function startSystemTelemetry(): void {
  if (telemetryRefreshTimer !== undefined) {
    window.clearInterval(telemetryRefreshTimer)
  }
  void refreshSystemTelemetry()
  telemetryRefreshTimer = window.setInterval(() => {
    void refreshSystemTelemetry()
  }, 1000)
}

function stopSystemTelemetry(): void {
  if (telemetryRefreshTimer === undefined) {
    return
  }
  window.clearInterval(telemetryRefreshTimer)
  telemetryRefreshTimer = undefined
}

async function loadAppVersion(): Promise<void> {
  try {
    currentAppVersion = await window.electronAPI.getAppVersion()
    aboutVersion.textContent = `v${currentAppVersion}`
  } catch (error) {
    console.warn('[Update] Failed to read app version:', error)
    aboutVersion.textContent = 'v--'
  }
  renderAppUpdateState()
}

function renderAppUpdateState(): void {
  if (!appUpdateButton) {
    return
  }

  const shouldShowUpdateButton = Boolean(
    lastAppUpdateResult?.success && lastAppUpdateResult.updateAvailable
  )

  appUpdateButton.hidden = !shouldShowUpdateButton
  appUpdateButton.disabled = false
  let state = 'idle'
  let label = t('updates.idleTitle')
  let buttonText = currentLanguage === 'zh-CN' ? '更新' : 'update'

  if (appUpdateChecking) {
    state = 'checking'
    label = t('updates.checking')
    buttonText = currentLanguage === 'zh-CN' ? '更新' : 'update'
  } else if (!lastAppUpdateResult) {
    state = 'idle'
    label = t('updates.idleTitle')
    buttonText = currentLanguage === 'zh-CN' ? '更新' : 'update'
  } else if (!lastAppUpdateResult.success) {
    state = 'error'
    label = t('updates.failedTitle')
    buttonText = currentLanguage === 'zh-CN' ? '更新' : 'update'
  } else if (lastAppUpdateResult.updateAvailable && lastAppUpdateResult.latestVersion) {
    state = 'available'
    label = tf('updates.availableTitle', { latest: lastAppUpdateResult.latestVersion })
    buttonText = currentLanguage === 'zh-CN' ? '更新' : 'update'
  } else {
    state = 'latest'
    label = t('updates.latestTitle')
    buttonText = currentLanguage === 'zh-CN' ? '更新' : 'update'
  }

  appUpdateButton.dataset.state = state
  appUpdateButton.title = label
  appUpdateButton.setAttribute('aria-label', label)
  appUpdateLabel.textContent = buttonText
}

async function checkAppUpdates(force = false, notify = false): Promise<void> {
  if (appUpdateChecking) {
    return
  }

  appUpdateChecking = true
  renderAppUpdateState()
  try {
    lastAppUpdateResult = await window.electronAPI.checkForUpdates({ force })
  } catch (error: any) {
    lastAppUpdateResult = {
      success: false,
      error: error?.message || String(error),
      currentVersion: currentAppVersion || '--',
      updateAvailable: false,
      checkedAt: Date.now(),
    }
  } finally {
    appUpdateChecking = false
    renderAppUpdateState()
  }

  if (!notify || !lastAppUpdateResult) {
    return
  }
  if (!lastAppUpdateResult.success) {
    showPanelNotice(tf('updates.failedDesc', {
      error: lastAppUpdateResult.error || t('common.failed'),
    }), 'error')
  } else if (lastAppUpdateResult.updateAvailable && lastAppUpdateResult.latestVersion) {
    showPanelNotice(tf('updates.availableTitle', {
      latest: lastAppUpdateResult.latestVersion,
    }))
  } else {
    showPanelNotice(t('updates.latestTitle'))
  }
}

appUpdateButton.addEventListener('click', () => {
  void window.electronAPI.openReleasePage(lastAppUpdateResult?.releaseUrl)
})

// Open settings panel
function switchSettingsSection(section: string): void {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'))
  document.querySelector(`.nav-item[data-section="${cssEscape(section)}"]`)?.classList.add('active')
  document.querySelectorAll('.settings-section').forEach(sec => sec.classList.remove('active'))
  document.getElementById(`section-${section}`)?.classList.add('active')
  updateLogsStreaming()

  if (section === 'memory') {
    void refreshMemorySection()
  }
  if (section === 'learning') {
    void refreshLearningSection()
  }
  if (section === 'system' || section === 'models') {
    void loadSystemConfig()
  }
  if (section === 'plugins') {
    void loadPluginsSection()
  }
  if (section === 'logs') {
    void loadLogsSection()
  }
}

async function openSettings(section?: string): Promise<void> {
  if (settingsCloseAnimationTimer !== undefined) {
    window.clearTimeout(settingsCloseAnimationTimer)
    settingsCloseAnimationTimer = undefined
  }

  document.body.classList.add('window-mode-changing')
  orbAnimationPaused = true
  stopOrbAnimation()
  let windowHiddenForResize = false
  try {
    await window.electronAPI.setWindowOpacity(0.01)
    windowHiddenForResize = true
    await window.electronAPI.setCompactWindowMode(false).catch((error) => {
      console.warn('[Window] Failed to enter settings window mode:', error)
    })
    document.body.classList.remove('settings-closing')
    document.body.classList.add('settings-open')
    document.body.classList.remove('chat-open')
    chatPanel.classList.remove('visible')
    chatPanel.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('window-mode-changing')
    startSystemTelemetry()
    settingsPanel.classList.remove('warping-out')
    settingsPanel.classList.add('visible', 'warping-in')
    window.setTimeout(() => {
      settingsPanel.classList.remove('warping-in')
    }, 380)
    mainView.setAttribute('aria-hidden', 'true')
    await waitForNextPaint()
  } finally {
    if (windowHiddenForResize) {
      await window.electronAPI.setWindowOpacity(1).catch((error) => {
        console.warn('[Window] Failed to restore window opacity:', error)
      })
    }
  }
  window.requestAnimationFrame(() => ensureLiquidGlassSurfaceActive(true))
  void refreshSetupReadiness()
  void checkAppUpdates(false, false)

  if (section) {
    switchSettingsSection(section)
  } else if (isMemorySectionActive()) {
    void refreshMemorySection()
  } else if (isLogsSectionActive()) {
    updateLogsStreaming()
    void loadLogsSection()
  } else {
    updateLogsStreaming()
  }
  if (!section && (isSettingsSectionActive('system') || isSettingsSectionActive('models'))) {
    void loadSystemConfig()
  }
}

const chatPanelController = initializeChatPanel({
  panel: chatPanel,
  closeButton: chatClose,
  composeForm: chatComposeForm,
  composeInput: chatComposeInput,
  messageList: chatMessageList,
  mainView,
  settingsPanel,
  getLanguage: () => currentLanguage,
  setLanguage: async (language) => {
    setLanguage(language)
    languageSelect.value = language
    await window.electronAPI.updateSettings({ language })
  },
  t,
  escapeHtml,
  waitForNextPaint,
  enterFullWindowMode: () => window.electronAPI.setChatWindowMode(true).catch((error) => {
    console.warn('[Window] Failed to enter chat window mode:', error)
  }),
  restoreCompactWindowMode: async () => {
    if (document.body.classList.contains('task-active')) {
      await window.electronAPI.setTaskWindowMode(true)
    } else {
      await window.electronAPI.setCompactWindowMode(true)
    }
  },
  pausePresence: () => {
    orbAnimationPaused = true
    stopOrbAnimation()
  },
  resumePresence: () => {
    orbAnimationPaused = false
    startOrbAnimation()
  },
})
refreshChatLanguage = () => chatPanelController.refreshLanguage()

initializeOrbEntryMenu({
  trigger: orbSettingsBtn,
  menu: orbEntryMenu,
  onOpenSystem: () => {
    void openSettings('system')
  },
  onOpenChat: () => {
    void chatPanelController.open()
  },
})

// Close settings panel
function closeSettings() {
  window.electronAPI.setLogsStreaming(false)
  stopSystemTelemetry()
  ensureLiquidGlassSurfaceActive(false)
  hidePanelNotice()
  document.body.classList.add('settings-closing')
  settingsPanel.classList.remove('warping-in')
  settingsPanel.classList.add('warping-out')

  if (settingsCloseAnimationTimer !== undefined) {
    window.clearTimeout(settingsCloseAnimationTimer)
  }

  settingsCloseAnimationTimer = window.setTimeout(() => {
    void finishCloseSettings()
  }, 260)
}

async function finishCloseSettings(): Promise<void> {
  document.body.classList.add('window-mode-changing')
  try {
    if (document.body.classList.contains('task-active')) {
      await window.electronAPI.setTaskWindowMode(true)
    } else {
      await window.electronAPI.setCompactWindowMode(true)
    }
  } catch (error) {
    console.warn('[Window] Failed to leave settings window mode:', error)
  } finally {
    orbAnimationPaused = false
    document.body.classList.remove('settings-open', 'settings-closing', 'window-mode-changing')
    settingsPanel.classList.remove('visible', 'warping-out')
    mainView.removeAttribute('aria-hidden')
    startOrbAnimation()
    settingsCloseAnimationTimer = undefined
  }
}

function handleSettingsClose(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  closeSettings()
}

settingsClose.addEventListener('pointerdown', handleSettingsClose)
settingsClose.addEventListener('click', handleSettingsClose)

window.electronAPI.onAppMenuCommand((message) => {
  if (message.command === 'open-settings') {
    void openSettings(message.payload?.section)
  }
})

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

document.querySelectorAll<HTMLButtonElement>('.log-filter').forEach(button => {
  button.addEventListener('click', () => {
    activeLogLevel = (button.dataset.logLevel as AppLogLevel | 'all') || 'all'
    document.querySelectorAll('.log-filter').forEach(item => item.classList.remove('active'))
    button.classList.add('active')
    renderLogs()
  })
})

clearLogsBtn.addEventListener('click', async () => {
  await window.electronAPI.clearLogs()
  logEntries = []
  renderLogs()
})

learningNav.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-learning-view]')
  const view = button?.dataset.learningView as LearningView | undefined
  if (view) {
    setLearningView(view)
  }
})

learningReflectBtn.addEventListener('click', async () => {
  learningReflectBtn.disabled = true
  try {
    const response = await window.electronAPI.reflectRecentLearning()
    if (!response.success) {
      showNotice(`Reflect failed: ${response.error ?? 'unknown error'}`)
    }
    await refreshLearningSection()
  } finally {
    learningReflectBtn.disabled = false
  }
})

window.electronAPI.onLogEntry((entry) => {
  logEntries.push(entry)
  if (logEntries.length > 1200) {
    logEntries = logEntries.slice(-1200)
  }
  if (isLogsSectionActive()) {
    appendVisibleLogs([entry])
  }
})

window.electronAPI.onLogBatch((entries) => {
  logEntries.push(...entries)
  if (logEntries.length > 1200) {
    logEntries = logEntries.slice(-1200)
  }
  if (isLogsSectionActive()) {
    appendVisibleLogs(entries)
  }
})

window.electronAPI.onLogsCleared(() => {
  logEntries = []
  if (isLogsSectionActive()) {
    renderLogs()
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
  showPanelNotice(settings.voiceOutputEnabled ? t('voice.outputEnabled') : t('voice.outputDisabled'))
})

personalitySelect.addEventListener('change', async () => {
  const selected = personalitySelect.value
  const result = await window.electronAPI.setPersonality(selected)
  if (!result.success) {
    showPanelError('Failed to switch personality', result.error)
    return
  }

  await loadSettings()
  showPanelNotice(tf('personality.switched', { name: personalitySelect.selectedOptions[0]?.textContent ?? selected }))
})

async function loadPluginsSection(force = false): Promise<void> {
  if (!force && pluginsListLoaded) {
    renderPluginsSection(cachedPlugins, cachedPluginMarketplace)
    return
  }
  if (pluginsListLoadPromise) {
    return pluginsListLoadPromise
  }

  pluginsList.innerHTML = `<div class="profile-loading">${escapeHtml(t('common.loading'))}</div>`

  pluginsListLoadPromise = Promise.all([
    window.electronAPI.listPlugins(),
    window.electronAPI.listPluginMarketplace(),
  ])
    .then(([pluginsResult, marketplaceResult]) => {
      if (!pluginsResult.success) {
        pluginsList.innerHTML = `<div class="profile-loading">${escapeHtml(t('plugins.loadFailed'))}: ${escapeHtml(pluginsResult.error ?? 'unknown error')}</div>`
        return
      }

      pluginsListLoaded = true
      cachedPluginMarketplace = marketplaceResult.success ? marketplaceResult.plugins : []
      pluginMarketplaceError = marketplaceResult.success ? '' : (marketplaceResult.error ?? 'unknown error')
      pluginMarketplaceSource = marketplaceResult.source ?? ''
      pluginMarketplaceCached = marketplaceResult.cached === true
      pluginMarketplaceFetchedAt = marketplaceResult.fetchedAt
      renderPluginsSection(pluginsResult.plugins, cachedPluginMarketplace)
    })
    .finally(() => {
      pluginsListLoadPromise = null
    })
  return pluginsListLoadPromise
}

function renderPluginsSection(plugins: PluginInfo[], marketplace = cachedPluginMarketplace): void {
  cachedPlugins = plugins
  cachedPluginMarketplace = marketplace
  activePluginDetail = null

  pluginsList.innerHTML = `
    ${renderPluginPageTabs()}
    <div class="plugin-page-panel">
      ${activePluginPage === 'marketplace'
        ? renderPluginMarketplace(marketplace)
        : renderInstalledPluginsPage(plugins)}
    </div>
  `
}

function renderPluginPageTabs(): string {
  return `
    <div class="plugin-page-tabs" role="tablist" aria-label="${escapeHtml(t('plugins.title'))}">
      <button class="plugin-page-tab ${activePluginPage === 'local' ? 'active' : ''}" type="button" role="tab" aria-selected="${activePluginPage === 'local'}" data-plugin-page="local">
        <span>${escapeHtml(t('plugins.installed'))}</span>
        <strong>${escapeHtml(String(cachedPlugins.length))}</strong>
      </button>
      <button class="plugin-page-tab ${activePluginPage === 'marketplace' ? 'active' : ''}" type="button" role="tab" aria-selected="${activePluginPage === 'marketplace'}" data-plugin-page="marketplace">
        <span>${escapeHtml(t('plugins.marketplace'))}</span>
        <strong>${escapeHtml(String(cachedPluginMarketplace.length))}</strong>
      </button>
    </div>
  `
}

function renderInstalledPluginsPage(plugins: PluginInfo[]): string {
  return `
    <div class="plugin-section-heading">
      <span>${escapeHtml(t('plugins.installed'))}</span>
      <span>${escapeHtml(String(plugins.length))}</span>
    </div>
    ${plugins.length ? plugins.map(renderPluginListCard).join('') : `<div class="profile-loading">${escapeHtml(t('plugins.empty'))}</div>`}
  `
}

function renderPluginMarketplace(marketplace: PluginMarketplaceItem[]): string {
  const query = pluginMarketplaceQuery.trim().toLowerCase()
  const filtered = query
    ? marketplace.filter(item => getPluginMarketplaceSearchText(item).includes(query))
    : marketplace
  const sourceLabel = pluginMarketplaceSource
    ? pluginMarketplaceSource.replace(/^https?:\/\//, '')
    : 'github.com/HappyFox001/Noema-Plugin'
  const syncText = pluginMarketplaceFetchedAt
      ? tf(pluginMarketplaceCached ? 'plugins.marketplaceCached' : 'plugins.marketplaceFetched', {
        time: formatTimestamp(pluginMarketplaceFetchedAt),
      })
    : ''

  return `
    <div class="plugin-marketplace-panel">
      <div class="plugin-marketplace-header">
        <div>
          <div class="plugin-section-title">${escapeHtml(t('plugins.marketplace'))}</div>
          <div class="plugin-marketplace-source">${escapeHtml(t('plugins.marketplaceSource'))}: ${escapeHtml(sourceLabel)}</div>
          ${syncText ? `<div class="plugin-marketplace-source">${escapeHtml(syncText)}</div>` : ''}
        </div>
        <div class="plugin-marketplace-actions">
          <button class="plugin-admin-button secondary plugin-marketplace-source-btn" type="button" data-plugin-marketplace-refresh="true" ${pluginMarketplaceRefreshing ? 'disabled' : ''}>${escapeHtml(pluginMarketplaceRefreshing ? t('plugins.refreshing') : t('plugins.refresh'))}</button>
          <button class="plugin-admin-button secondary plugin-marketplace-source-btn" type="button" data-plugin-marketplace-source="${escapeHtml(pluginMarketplaceSource)}">${escapeHtml(t('plugins.viewSource'))}</button>
        </div>
      </div>
      <input class="plugin-marketplace-search" type="search" value="${escapeHtml(pluginMarketplaceQuery)}" placeholder="${escapeHtml(t('plugins.marketplaceSearch'))}" data-plugin-marketplace-search="true" />
      ${pluginMarketplaceError ? `<div class="plugin-marketplace-error">${escapeHtml(t('plugins.marketplaceUnavailable'))}: ${escapeHtml(pluginMarketplaceError)}</div>` : ''}
      <div class="plugin-marketplace-grid">
        ${filtered.length ? filtered.map(renderPluginMarketplaceCard).join('') : `<div class="plugin-marketplace-empty">${escapeHtml(t('plugins.marketplaceEmpty'))}</div>`}
      </div>
    </div>
  `
}

function renderPluginMarketplaceCard(item: PluginMarketplaceItem): string {
  const displayName = pluginMarketplaceText(item, 'name', item.name)
  const displayDescription = pluginMarketplaceText(item, 'description', item.description ?? '')
  const statusText = item.enabled
    ? t('plugins.enabledStatus')
    : item.installed
      ? t('plugins.installedStatus')
      : t('plugins.availableStatus')
  const installing = installingMarketplacePluginId === item.id
  return `
    <div class="plugin-marketplace-card">
      <div class="plugin-marketplace-card-top">
        <div class="plugin-info">
          <div class="plugin-title-row">
            <span class="plugin-name">${escapeHtml(displayName)}</span>
            ${item.version ? `<span class="plugin-version">v${escapeHtml(item.version)}</span>` : ''}
          </div>
          <div class="plugin-id">${escapeHtml(item.id)}</div>
        </div>
        <span class="plugin-marketplace-status ${item.enabled ? 'enabled' : item.installed ? 'installed' : ''}">${escapeHtml(statusText)}</span>
      </div>
      ${displayDescription ? `<div class="plugin-description">${escapeHtml(displayDescription)}</div>` : ''}
      ${item.tags.length ? `<div class="plugin-marketplace-tags">${item.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <div class="plugin-marketplace-card-actions">
        ${item.installed
          ? ''
          : `<button class="plugin-admin-button plugin-marketplace-card-btn" type="button" data-plugin-marketplace-install="${escapeHtml(item.id)}" ${installing ? 'disabled' : ''}>${escapeHtml(installing ? t('plugins.installing') : t('plugins.install'))}</button>`}
        <button class="plugin-admin-button secondary plugin-marketplace-card-btn" type="button" data-plugin-marketplace-source="${escapeHtml(item.sourceUrl)}">${escapeHtml(t('plugins.viewSource'))}</button>
      </div>
    </div>
  `
}

function getPluginMarketplaceSearchText(item: PluginMarketplaceItem): string {
  return [
    item.id,
    item.name,
    item.version,
    item.description,
    pluginMarketplaceText(item, 'name', ''),
    pluginMarketplaceText(item, 'description', ''),
    item.path,
    ...item.tags,
  ].filter(Boolean).join(' ').toLowerCase()
}

function pluginMarketplaceText(
  item: PluginMarketplaceItem,
  key: 'name' | 'description',
  fallback: string
): string {
  return item.i18n?.[currentLanguage]?.[key]
    ?? fallback
}

async function refreshPluginMarketplace(): Promise<void> {
  if (pluginMarketplaceRefreshing) {
    return
  }

  pluginMarketplaceRefreshing = true
  pluginMarketplaceError = ''
  renderPluginsSection(cachedPlugins, cachedPluginMarketplace)
  try {
    const result = await window.electronAPI.listPluginMarketplace({ refresh: true })
    if (!result.success) {
      throw new Error(result.error || 'unknown error')
    }

    cachedPluginMarketplace = result.plugins
    pluginMarketplaceSource = result.source ?? pluginMarketplaceSource
    pluginMarketplaceCached = result.cached === true
    pluginMarketplaceFetchedAt = result.fetchedAt
    pluginMarketplaceError = ''
  } catch (error: any) {
    pluginMarketplaceError = getErrorText(error)
    showPanelNotice(tf('plugins.marketplaceRefreshFailed', { error: pluginMarketplaceError }), 'error')
  } finally {
    pluginMarketplaceRefreshing = false
    renderPluginsSection(cachedPlugins, cachedPluginMarketplace)
  }
}

async function uninstallPlugin(pluginId: string): Promise<void> {
  const plugin = cachedPlugins.find(item => item.id === pluginId)
  if (!plugin) {
    return
  }

  const confirmed = await showConfirmDialog({
    title: t('plugins.uninstallTitle'),
    message: tf('plugins.uninstallConfirm', {
      name: pluginText(plugin, 'name', plugin.name),
    }),
    detail: plugin.pluginDir,
    confirmText: t('plugins.uninstall'),
    tone: 'danger',
  })
  if (!confirmed) {
    return
  }

  const result = await window.electronAPI.uninstallPlugin(pluginId)
  if (!result.success) {
    showPanelNotice(tf('plugins.uninstallFailed', { error: result.error ?? 'unknown error' }), 'error')
    return
  }

  const settings = await window.electronAPI.getSettings()
  const nextPlugins = { ...(settings.plugins ?? {}) }
  delete nextPlugins[pluginId]
  const nextPluginConfigs = { ...(settings.pluginConfigs ?? {}) }
  delete nextPluginConfigs[pluginId]
  await window.electronAPI.updateSettings({
    plugins: nextPlugins,
    pluginConfigs: nextPluginConfigs,
  })

  pluginsListLoaded = false
  activePluginDetail = null
  showPanelNotice(t('plugins.uninstalled'))
  await loadPluginsSection(true)
  await loadPluginUISurfaces()
}

async function installPluginFromMarketplace(pluginId: string): Promise<void> {
  if (installingMarketplacePluginId) {
    return
  }

  installingMarketplacePluginId = pluginId
  renderPluginsSection(cachedPlugins, cachedPluginMarketplace)
  try {
    const result = await window.electronAPI.installPluginFromMarketplace(pluginId)
    if (!result.success) {
      throw new Error(result.error || 'unknown error')
    }

    const settings = await window.electronAPI.getSettings()
    await window.electronAPI.updateSettings({
      plugins: {
        ...(settings.plugins ?? {}),
        [pluginId]: true,
      },
    })

    pluginsListLoaded = false
    showPanelNotice(t('plugins.installedNotice'))
    await loadPluginsSection(true)
    await refreshPluginMarketplace()
    await loadPluginUISurfaces()
  } catch (error: any) {
    showPanelNotice(tf('plugins.installFailed', { error: getErrorText(error) }), 'error')
  } finally {
    installingMarketplacePluginId = ''
    renderPluginsSection(cachedPlugins, cachedPluginMarketplace)
  }
}

function renderPluginListCard(plugin: PluginInfo): string {
  return `
    <div class="plugin-card plugin-card-list" data-plugin-id="${escapeHtml(plugin.id)}">
      <div class="plugin-card-main">
        <div class="plugin-info">
          <div class="plugin-title-row">
            <span class="plugin-name">${escapeHtml(pluginText(plugin, 'name', plugin.name))}</span>
            ${plugin.version ? `<span class="plugin-version">v${escapeHtml(plugin.version)}</span>` : ''}
          </div>
          <div class="plugin-id">${escapeHtml(plugin.id)}</div>
          ${plugin.description ? `<div class="plugin-description">${escapeHtml(pluginText(plugin, 'description', plugin.description))}</div>` : ''}
        </div>
        <label class="settings-toggle plugin-toggle">
          <input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin-toggle="${escapeHtml(plugin.id)}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
      <div class="plugin-card-footer">
        <span>${plugin.configSchema.length ? escapeHtml(tf('plugins.configCount', { count: plugin.configSchema.length })) : escapeHtml(t('plugins.noConfig'))}</span>
        ${plugin.uiSurfaces.length ? `<span>${escapeHtml(tf('plugins.uiHookCount', { count: plugin.uiSurfaces.length }))}</span>` : ''}
        <span class="plugin-enter">${escapeHtml(t('common.manage'))}</span>
      </div>
    </div>
  `
}

function syncPluginListCard(pluginId: string): void {
  const plugin = cachedPlugins.find(item => item.id === pluginId)
  if (!plugin) return
  replaceKeyedElement(
    pluginsList,
    `.plugin-card-list[data-plugin-id="${cssEscape(pluginId)}"]`,
    renderPluginListCard(plugin),
    { insertMissing: false }
  )
}

function renderPluginDetail(plugin: PluginInfo, page: 'main' | 'advanced' = 'main'): void {
  activePluginDetail = { pluginId: plugin.id, page }
  const isAdvancedPage = page === 'advanced'
  pluginsList.innerHTML = `
    ${renderPluginDetailHeader(plugin, page)}
    <div class="plugin-card plugin-detail-card" data-plugin-id="${escapeHtml(plugin.id)}">
      ${isAdvancedPage ? '' : renderPluginDetailSummary(plugin)}
      <div class="plugin-config-panel" data-plugin-config-panel="${escapeHtml(plugin.id)}">
        ${renderPluginConfigFields(plugin, page)}
      </div>
    </div>
    ${isAdvancedPage ? '' : renderPluginAdminContainer(plugin)}
    ${isAdvancedPage ? '' : renderPluginDangerZone(plugin)}
  `

  if (!isAdvancedPage) {
    loadPluginAdminPanel(plugin)
  } else {
    void hydrateLive2dCapabilities(plugin, page)
  }
}

function renderPluginDetailHeader(plugin: PluginInfo, page: 'main' | 'advanced'): string {
  const pluginName = pluginText(plugin, 'name', plugin.name)
  const pageTitle = pluginPageTitle(plugin, page)
  return `
    <div class="plugin-detail-header">
      <button class="plugin-back-btn" type="button">${escapeHtml(t('common.back'))}</button>
      <div class="plugin-detail-title">
        <span class="plugin-name">${escapeHtml(page === 'advanced' ? `${pluginName} / ${pageTitle}` : pluginName)}</span>
        ${plugin.version ? `<span class="plugin-version">v${escapeHtml(plugin.version)}</span>` : ''}
      </div>
    </div>
  `
}

function renderPluginDetailSummary(plugin: PluginInfo): string {
  return `
    <div class="plugin-card-main">
      <div class="plugin-info">
        <div class="plugin-id">${escapeHtml(plugin.id)}</div>
        ${plugin.description ? `<div class="plugin-description plugin-detail-description">${escapeHtml(pluginText(plugin, 'description', plugin.description))}</div>` : ''}
        ${plugin.uiSurfaces.length ? `<div class="plugin-permissions">${plugin.uiSurfaces.map(surface => `<span>UI: ${escapeHtml(surface.slot)} / ${escapeHtml(surface.mode)}</span>`).join('')}</div>` : ''}
        ${plugin.permissions.length ? `<div class="plugin-permissions">${plugin.permissions.map(permission => `<span>${escapeHtml(permission)}</span>`).join('')}</div>` : ''}
      </div>
      <label class="settings-toggle plugin-toggle">
        <input type="checkbox" ${plugin.enabled ? 'checked' : ''} data-plugin-toggle="${escapeHtml(plugin.id)}" />
        <span class="toggle-slider"></span>
      </label>
    </div>
  `
}

function syncPluginDetailConfig(plugin: PluginInfo, page: 'main' | 'advanced' = activePluginDetail?.page ?? 'main'): void {
  const detailCard = pluginsList.querySelector<HTMLElement>('.plugin-detail-card')
  if (detailCard?.dataset.pluginId !== plugin.id) return
  const panel = detailCard.querySelector<HTMLElement>('[data-plugin-config-panel]')
  if (panel) {
    panel.innerHTML = renderPluginConfigFields(plugin, page)
  }
}

function renderPluginAdminContainer(plugin: PluginInfo): string {
  if (plugin.id !== 'mcp-manager' && plugin.id !== 'skills-manager' && !plugin.adminSchema) {
    return ''
  }

  return `
    <div class="plugin-card plugin-admin-card" data-plugin-admin="${escapeHtml(plugin.id)}">
      <div class="plugin-admin-loading">${escapeHtml(t('plugins.adminLoading'))}</div>
    </div>
  `
}

function renderPluginDangerZone(plugin: PluginInfo): string {
  return `
    <div class="plugin-card plugin-danger-card" data-plugin-danger="${escapeHtml(plugin.id)}">
      <div class="plugin-danger-copy">
        <div class="plugin-admin-title">${escapeHtml(t('plugins.dangerZone'))}</div>
        <div class="plugin-admin-subtitle">${escapeHtml(t('plugins.uninstallDesc'))}</div>
      </div>
      <button class="plugin-admin-button danger" type="button" data-plugin-uninstall="${escapeHtml(plugin.id)}">${escapeHtml(t('plugins.uninstall'))}</button>
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
    container.innerHTML = `<div class="plugin-admin-loading">${escapeHtml(t('plugins.adminLoadFailed'))}: ${escapeHtml(result.error ?? 'unknown error')}</div>`
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
    container.innerHTML = `<div class="plugin-admin-empty">${escapeHtml(t('plugins.noAdminPanel'))}</div>`
    return
  }

  const actions = schema.actions ?? []
  container.innerHTML = `
    <div class="plugin-admin-header">
      <div>
        <div class="plugin-admin-title">${escapeHtml(schema.title || t('plugins.adminTitle'))}</div>
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
    ` : `<div class="plugin-admin-empty">${escapeHtml(t('plugins.noAdminActions'))}</div>`}
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
      showPanelError('Plugin action failed', result.error)
    }
    return null
  }
  if (!options.silent) {
    showPanelNotice(t('plugins.actionDone'))
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
        <div class="plugin-admin-title">${escapeHtml(t('plugins.mcpTitle'))}</div>
        <div class="plugin-admin-subtitle">${escapeHtml(t('plugins.mcpSubtitle'))}</div>
      </div>
    </div>
    <div class="plugin-admin-form">
      <input class="plugin-config-input" data-mcp-field="id" placeholder="${escapeHtml(t('plugins.mcpIdPlaceholder'))}" />
      <input class="plugin-config-input" data-mcp-field="name" placeholder="${escapeHtml(t('plugins.mcpNamePlaceholder'))}" />
      <input class="plugin-config-input plugin-admin-wide-input" data-mcp-field="url" placeholder="https://example.com/mcp" />
      <textarea class="plugin-config-input plugin-config-textarea" data-mcp-field="headers" rows="3" placeholder='${escapeHtml(t('plugins.mcpHeadersPlaceholder'))}'></textarea>
      <button class="plugin-admin-button" type="button" data-mcp-action="add">${escapeHtml(t('plugins.mcpAdd'))}</button>
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
          <button class="plugin-admin-button secondary" type="button" data-mcp-action="test">${escapeHtml(t('plugins.test'))}</button>
          <button class="plugin-admin-button danger" type="button" data-mcp-action="remove">${escapeHtml(t('common.delete'))}</button>
        </div>
      `).join('') : `<div class="plugin-admin-empty">${escapeHtml(t('plugins.mcpEmpty'))}</div>`}
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
        showPanelNotice('Headers must be valid JSON', 'error')
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
  const originalText = button.textContent || t('plugins.test')
  button.disabled = true
  button.textContent = t('plugins.testing')
  button.classList.remove('danger')
  button.classList.add('testing')

  const result = await window.electronAPI.pluginAdminAction(plugin.id, 'testServer', { serverId })
  button.classList.remove('testing')

  if (!result.success) {
    button.textContent = t('plugins.testFailed')
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
        <div class="plugin-admin-title">${escapeHtml(t('plugins.skillsTitle'))}</div>
        <div class="plugin-admin-subtitle">${escapeHtml(t('plugins.skillsSubtitle'))}</div>
      </div>
    </div>
    <div class="plugin-admin-form">
      <input class="plugin-config-input plugin-admin-wide-input" data-skill-field="githubUrl" placeholder="${escapeHtml(t('plugins.skillsGithubPlaceholder'))}" />
      <button class="plugin-admin-button" type="button" data-skill-action="add-github">${escapeHtml(t('plugins.skillsAddGithub'))}</button>
      <input class="plugin-config-input plugin-admin-wide-input" data-skill-field="localPath" placeholder="${escapeHtml(t('plugins.skillsLocalPlaceholder'))}" />
      <button class="plugin-admin-button secondary" type="button" data-skill-action="add-local">${escapeHtml(t('plugins.skillsAddLocal'))}</button>
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
          ${source.type === 'github' ? `<button class="plugin-admin-button secondary" type="button" data-skill-action="rescan">${escapeHtml(t('plugins.rescan'))}</button>` : ''}
          <button class="plugin-admin-button danger" type="button" data-skill-action="remove">${escapeHtml(t('common.delete'))}</button>
          <div class="plugin-admin-source-skills" hidden>
            ${renderSourceSkills(skillsForSource(skills, source))}
          </div>
        </div>
      `).join('') : `<div class="plugin-admin-empty">${escapeHtml(t('plugins.skillsEmpty'))}</div>`}
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
    return `<div class="plugin-admin-empty">${escapeHtml(t('plugins.skillsNoneInSource'))}</div>`
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

async function updatePluginEnabled(input: HTMLInputElement): Promise<void> {
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
    syncPluginListCard(pluginId)
    await loadPluginUISurfaces()
    showPanelNotice(input.checked ? t('plugins.enabled') : t('plugins.disabled'))
  } catch (error: any) {
    input.checked = !input.checked
    showPanelError('Plugin update failed', error)
  } finally {
    input.disabled = false
  }
}

async function updatePluginConfigInput(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
): Promise<void> {
  const pluginId = input.dataset.pluginId
  const key = input.dataset.pluginConfig
  const type = input.dataset.pluginType
  if (!pluginId || !key || !type) return

  const optimisticValue = readPluginConfigValue(input, type)
  input.disabled = true
  try {
    await applyPluginConfigPatch(pluginId, getPluginConfigPatch(pluginId, key, optimisticValue))
    const plugin = cachedPlugins.find(item => item.id === pluginId)
    if (plugin) {
      syncPluginDetailConfig(plugin)
    }
    syncPluginListCard(pluginId)
    showPanelNotice(t('plugins.configUpdated'))
  } catch (error: any) {
    showPanelError('Failed to save plugin settings', error)
  } finally {
    input.disabled = false
  }
}

function stepPluginNumberInput(button: HTMLButtonElement): void {
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
}

async function selectPluginConfigPath(button: HTMLButtonElement): Promise<void> {
  const pluginId = button.dataset.pluginId
  const key = button.dataset.pluginConfig
  if (!pluginId || !key) return

  const input = pluginsList.querySelector<HTMLInputElement>(
    `input[data-plugin-id="${cssEscape(pluginId)}"][data-plugin-config="${cssEscape(key)}"]`
  )
  const plugin = cachedPlugins.find(item => item.id === pluginId)
  const field = plugin?.configSchema.find(item => item.key === key)
  if (!input || !plugin || (field?.type !== 'file' && field?.type !== 'directory')) return

  button.disabled = true
  try {
    const result = await window.electronAPI.selectPluginConfigPath({
      pluginId,
      mode: field.type,
      title: field.label
        ? tf('plugins.chooseField', { label: pluginConfigText(plugin, field, 'label', field.label) })
        : (field.type === 'directory' ? t('plugins.chooseDirectory') : t('plugins.chooseFile')),
      defaultPath: await getPluginPathDefault(plugin, field),
      filters: field.type === 'file' ? field.filters : undefined,
      resolveFileExtensions: field.type === 'directory' ? field.resolveFileExtensions : undefined,
      resolveRecursive: field.type === 'directory' ? field.resolveRecursive : undefined,
    })
    if (result.canceled) {
      return
    }
    if (!result.success) {
      throw new Error(result.error || 'Path selection failed')
    }
    const selectedValue = field.type === 'directory' ? result.directoryPath : result.fileUrl
    if (!selectedValue) {
      throw new Error(field.type === 'directory' ? 'Directory selection failed' : 'File selection failed')
    }
    const configPatch: Record<string, unknown> = { [key]: selectedValue }
    if (field.type === 'directory' && field.targetKey && result.resolvedFileUrl) {
      configPatch[field.targetKey] = result.resolvedFileUrl
      const targetInput = pluginsList.querySelector<HTMLInputElement>(
        `input[data-plugin-id="${cssEscape(pluginId)}"][data-plugin-config="${cssEscape(field.targetKey)}"]`
      )
      if (targetInput) {
        targetInput.value = result.resolvedFileUrl
      }
    }
    if (field.type === 'directory' && field.targetKey && field.resolveFileExtensions?.length && !result.resolvedFileUrl) {
      throw new Error(tf('plugins.missingResolvedFile', { extensions: field.resolveFileExtensions.join(', ') }))
    }
    input.value = selectedValue
    await applyPluginConfigPatch(pluginId, configPatch)
    await updatePluginPathHistory(pluginId, key, field.type, selectedValue)
    syncPluginDetailConfig(plugin)
    syncPluginListCard(pluginId)
    showPanelNotice(t('plugins.pathUpdated'))
  } catch (error: any) {
    showPanelError('Path selection failed', error)
  } finally {
    button.disabled = false
  }
}

function bindPluginsListEvents(): void {
  pluginsList.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    if (target.closest('.plugin-toggle')) {
      event.stopPropagation()
      return
    }

    const pageButton = target.closest<HTMLButtonElement>('[data-plugin-page]')
    if (pageButton?.dataset.pluginPage === 'local' || pageButton?.dataset.pluginPage === 'marketplace') {
      activePluginPage = pageButton.dataset.pluginPage
      renderPluginsSection(cachedPlugins, cachedPluginMarketplace)
      return
    }

    const marketplaceRefreshButton = target.closest<HTMLButtonElement>('[data-plugin-marketplace-refresh]')
    if (marketplaceRefreshButton) {
      event.stopPropagation()
      void refreshPluginMarketplace()
      return
    }

    const marketplaceInstallButton = target.closest<HTMLButtonElement>('[data-plugin-marketplace-install]')
    if (marketplaceInstallButton?.dataset.pluginMarketplaceInstall) {
      event.stopPropagation()
      void installPluginFromMarketplace(marketplaceInstallButton.dataset.pluginMarketplaceInstall)
      return
    }

    const marketplaceSourceButton = target.closest<HTMLButtonElement>('[data-plugin-marketplace-source]')
    if (marketplaceSourceButton) {
      event.stopPropagation()
      void window.electronAPI.openPluginMarketplaceSource(marketplaceSourceButton.dataset.pluginMarketplaceSource)
      return
    }

    const uninstallButton = target.closest<HTMLButtonElement>('[data-plugin-uninstall]')
    if (uninstallButton?.dataset.pluginUninstall) {
      event.stopPropagation()
      void uninstallPlugin(uninstallButton.dataset.pluginUninstall)
      return
    }

    const backButton = target.closest<HTMLButtonElement>('.plugin-back-btn')
    if (backButton) {
      if (activePluginDetail?.page === 'advanced') {
        const plugin = cachedPlugins.find(item => item.id === activePluginDetail?.pluginId)
        if (plugin) {
          renderPluginDetail(plugin, 'main')
        }
      } else {
        renderPluginsSection(cachedPlugins)
      }
      return
    }

    const configPageButton = target.closest<HTMLButtonElement>('[data-plugin-config-page]')
    if (configPageButton?.dataset.pluginConfigPage === 'advanced' && activePluginDetail) {
      const plugin = cachedPlugins.find(item => item.id === activePluginDetail?.pluginId)
      if (plugin) {
        renderPluginDetail(plugin, 'advanced')
      }
      return
    }

    const stepButton = target.closest<HTMLButtonElement>('.plugin-number-step')
    if (stepButton) {
      stepPluginNumberInput(stepButton)
      return
    }

    const pathButton = target.closest<HTMLButtonElement>('[data-plugin-path-select]')
    if (pathButton) {
      void selectPluginConfigPath(pathButton)
      return
    }

    const card = target.closest<HTMLElement>('.plugin-card-list')
    const pluginId = card?.dataset.pluginId
    const plugin = cachedPlugins.find(item => item.id === pluginId)
    if (plugin) {
      renderPluginDetail(plugin)
    }
  })

  pluginsList.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null
    if (!input) return

    if (input instanceof HTMLInputElement && input.dataset.pluginToggle) {
      event.stopPropagation()
      void updatePluginEnabled(input)
      return
    }

    if (input.matches('input[data-plugin-config], select[data-plugin-config], textarea[data-plugin-config]')) {
      void updatePluginConfigInput(input)
    }
  })

  pluginsList.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement | null
    if (!input?.matches('[data-plugin-marketplace-search]')) {
      return
    }

    pluginMarketplaceQuery = input.value
    renderPluginsSection(cachedPlugins, cachedPluginMarketplace)
    const searchInput = pluginsList.querySelector<HTMLInputElement>('[data-plugin-marketplace-search]')
    searchInput?.focus()
    searchInput?.setSelectionRange(pluginMarketplaceQuery.length, pluginMarketplaceQuery.length)
  })
}

function getPluginConfigPatch(pluginId: string, key: string, value: unknown): Record<string, unknown> {
  return { [key]: value }
}

function getPluginPathHistoryKey(pluginId: string, key: string): string {
  return `${pluginId}:${key}`
}

async function getPluginPathDefault(
  plugin: PluginInfo,
  field: Extract<PluginConfigField, { type: 'file' | 'directory' }>
): Promise<string | undefined> {
  const settings = await window.electronAPI.getSettings()
  const history = settings.pluginPathHistory?.[getPluginPathHistoryKey(plugin.id, field.key)]
  return history?.lastPath || history?.recentPaths?.[0] || field.defaultPath
}

async function updatePluginPathHistory(
  pluginId: string,
  key: string,
  mode: 'file' | 'directory',
  selectedPath: string
): Promise<void> {
  const settings = await window.electronAPI.getSettings()
  const historyKey = getPluginPathHistoryKey(pluginId, key)
  const existing = settings.pluginPathHistory?.[historyKey]
  const recentPaths = [selectedPath, ...(existing?.recentPaths ?? []).filter(path => path !== selectedPath)].slice(0, 5)
  await window.electronAPI.updateSettings({
    pluginPathHistory: {
      ...(settings.pluginPathHistory ?? {}),
      [historyKey]: {
        mode,
        lastPath: selectedPath,
        recentPaths,
      },
    },
  })
}

function getLive2dCapabilitiesCacheKey(plugin: PluginInfo): string {
  return `${plugin.id}:${String(plugin.config.modelUrl ?? '')}`
}

async function hydrateLive2dCapabilities(plugin: PluginInfo, page: 'main' | 'advanced'): Promise<void> {
  if (plugin.id !== 'live2d-avatar') {
    return
  }
  const cacheKey = getLive2dCapabilitiesCacheKey(plugin)
  if (live2dCapabilitiesCache.has(cacheKey)) {
    return
  }

  const result = await window.electronAPI.readLive2dModelCapabilities({
    pluginDir: plugin.pluginDir,
    modelUrl: String(plugin.config.modelUrl ?? ''),
  })
  if (!result.success) {
    live2dCapabilitiesCache.set(cacheKey, {
      motionGroups: [],
      expressions: [],
      lipSyncParameters: [],
      error: result.error ?? 'unknown error',
    })
    const currentCard = pluginsList.querySelector<HTMLElement>('.plugin-detail-card')
    if (currentCard?.dataset.pluginId === plugin.id) {
      syncPluginDetailConfig(plugin, page)
    }
    return
  }

  live2dCapabilitiesCache.set(cacheKey, {
    motionGroups: result.motionGroups ?? [],
    expressions: result.expressions ?? [],
    lipSyncParameters: result.lipSyncParameters ?? [],
  })
  const currentCard = pluginsList.querySelector<HTMLElement>('.plugin-detail-card')
  if (currentCard?.dataset.pluginId === plugin.id) {
    syncPluginDetailConfig(plugin, page)
  }
}

async function applyPluginConfigPatch(pluginId: string, configPatch: Record<string, unknown>): Promise<void> {
  const target = cachedPlugins.find(item => item.id === pluginId)
  const previousConfig = target ? { ...target.config } : null

  if (pluginId === 'live2d-avatar' && ('modelUrl' in configPatch || 'modelDir' in configPatch)) {
    for (const key of live2dCapabilitiesCache.keys()) {
      if (key.startsWith(`${pluginId}:`)) {
        live2dCapabilitiesCache.delete(key)
      }
    }
  }

  if (target) {
    target.config = {
      ...target.config,
      ...configPatch,
    }
  }

  try {
    const settings = await window.electronAPI.getSettings()
    const currentPluginConfig = settings.pluginConfigs?.[pluginId] ?? {}
    const nextPluginConfigs = {
      ...(settings.pluginConfigs ?? {}),
      [pluginId]: {
        ...currentPluginConfig,
        ...configPatch,
      },
    }
    await window.electronAPI.updateSettings({ pluginConfigs: nextPluginConfigs })
    if (target) {
      target.config = nextPluginConfigs[pluginId]
    }
    await loadPluginUISurfaces()
  } catch (error) {
    if (target && previousConfig) {
      target.config = previousConfig
    }
    throw error
  }
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}

function replaceKeyedElement(
  container: HTMLElement,
  selector: string,
  html: string,
  options: { insertMissing?: boolean } = {}
): void {
  const existing = container.querySelector<HTMLElement>(selector)
  if (existing) {
    existing.outerHTML = html
    return
  }
  if (options.insertMissing === false) {
    return
  }
  container.insertAdjacentHTML('beforeend', html)
}

function pluginText(plugin: PluginInfo, key: string, fallback: string): string {
  return plugin.i18n?.[currentLanguage]?.[key]
    ?? plugin.i18n?.['zh-CN']?.[key]
    ?? fallback
}

function pluginConfigText(
  plugin: PluginInfo,
  field: PluginConfigField,
  part: 'label' | 'description' | 'buttonLabel',
  fallback: string
): string {
  return pluginText(plugin, `config.${field.key}.${part}`, fallback)
}

function pluginConfigOptionText(
  plugin: PluginInfo,
  field: Extract<PluginConfigField, { type: 'select' }>,
  option: { label: string; value: string }
): string {
  return pluginText(plugin, `config.${field.key}.options.${option.value}`, option.label)
}

function pluginPageTitle(plugin: PluginInfo, page: 'main' | 'advanced'): string {
  return page === 'advanced'
    ? pluginText(plugin, 'pages.advanced.title', t('plugins.advancedModelParams'))
    : pluginText(plugin, 'name', plugin.name)
}

function pluginPageDescription(plugin: PluginInfo, page: 'main' | 'advanced'): string {
  return page === 'advanced'
    ? pluginText(plugin, 'pages.advanced.description', t('plugins.advancedModelParamsDesc'))
    : pluginText(plugin, 'description', plugin.description ?? '')
}

function renderPluginsForCurrentLanguage(): void {
  if (!document.getElementById('section-plugins')?.classList.contains('active') || cachedPlugins.length === 0) {
    return
  }

  if (activePluginDetail) {
    const plugin = cachedPlugins.find(item => item.id === activePluginDetail?.pluginId)
    if (plugin) {
      renderPluginDetail(plugin, activePluginDetail.page)
      return
    }
  }
  renderPluginsSection(cachedPlugins)
}

function renderPluginConfigFields(plugin: PluginInfo, page: 'main' | 'advanced' = 'main'): string {
  if (!plugin.configSchema.length) {
    return ''
  }
  const primaryFields = plugin.configSchema.filter(field => !field.advanced)
  const advancedFields = plugin.configSchema.filter(field => field.advanced)
  const visibleFields = page === 'advanced' ? advancedFields : primaryFields

  return `
    <div class="plugin-config-fields">
      ${renderPluginCapabilitySummary(plugin, page)}
      ${visibleFields.map(field => renderPluginConfigField(plugin, field)).join('')}
      ${page === 'main' && advancedFields.length ? `
        <button class="plugin-config-page-button" type="button" data-plugin-config-page="advanced">
          <span>
            <strong>${escapeHtml(pluginPageTitle(plugin, 'advanced'))}</strong>
            <small>${escapeHtml(pluginPageDescription(plugin, 'advanced'))}</small>
          </span>
          <span class="plugin-config-page-arrow">›</span>
        </button>
      ` : ''}
    </div>
  `
}

function renderPluginCapabilitySummary(plugin: PluginInfo, page: 'main' | 'advanced'): string {
  if (plugin.id !== 'live2d-avatar' || page !== 'advanced') {
    return ''
  }
  const capabilities = live2dCapabilitiesCache.get(getLive2dCapabilitiesCacheKey(plugin))
  if (!capabilities) {
    return `<div class="plugin-capability-summary muted">${escapeHtml(t('plugins.live2dCapabilitiesLoading'))}</div>`
  }
  if (capabilities.error) {
    return `<div class="plugin-capability-summary muted">${escapeHtml(t('plugins.live2dCapabilitiesUnavailable'))}: ${escapeHtml(capabilities.error)}</div>`
  }
  return `
    <div class="plugin-capability-summary">
      <div class="plugin-capability-title">${escapeHtml(t('plugins.live2dCapabilitiesTitle'))}</div>
      <div class="plugin-capability-grid">
        ${renderCapabilityMetric(t('plugins.live2dMotionGroups'), capabilities.motionGroups)}
        ${renderCapabilityMetric(t('plugins.live2dExpressions'), capabilities.expressions)}
        ${renderCapabilityMetric(t('plugins.live2dLipSyncParams'), capabilities.lipSyncParameters)}
      </div>
    </div>
  `
}

function renderCapabilityMetric(label: string, values: string[]): string {
  const preview = values.slice(0, 4).join(' / ')
  return `
    <div class="plugin-capability-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${values.length}</strong>
      ${preview ? `<small>${escapeHtml(preview)}</small>` : ''}
    </div>
  `
}

function getTaskModelTransport(model: LLMModelConfig): NonNullable<LLMModelConfig['transport']> {
  if (model.transport === 'codex_local' || model.transport === 'claude_code_local') {
    return model.transport
  }
  return getLLMProviderCatalogEntry(model.provider).transport ?? 'openai_compatible'
}

function getTaskTransportLogo(transport: NonNullable<LLMModelConfig['transport']>): ModelLogo {
  if (transport === 'codex_local') {
    return { src: codexLogoUrl, alt: 'Codex', tone: 'light' }
  }
  if (transport === 'claude_code_local') {
    return { src: claudeCodeLogoUrl, alt: 'Claude Code' }
  }
  return { src: newAPIIconUrl, alt: 'New API' }
}

function getTaskModelLogo(model: LLMModelConfig): ModelLogo {
  const transport = getTaskModelTransport(model)
  return transport === 'openai_compatible'
    ? getLLMProviderLogo(model.provider, model)
    : getTaskTransportLogo(transport)
}

function getTaskTransportLabel(transport: NonNullable<LLMModelConfig['transport']>): string {
  if (transport === 'codex_local') return 'Codex'
  if (transport === 'claude_code_local') return 'Claude Code'
  return 'API'
}

function renderTaskTransportControl(model: LLMModelConfig): string {
  const transport = getTaskModelTransport(model)
  return renderProviderControl('task-transport', transport, getTaskTransportLabel(transport), getTaskModelLogo(model))
}

function renderPluginConfigField(plugin: PluginInfo, field: PluginConfigField): string {
  const rawValue = plugin.config[field.key] ?? field.default
  const fieldLabel = pluginConfigText(plugin, field, 'label', field.label ?? field.key)
  const label = escapeHtml(fieldLabel)
  const desc = field.description
    ? `<div class="plugin-config-desc">${escapeHtml(pluginConfigText(plugin, field, 'description', field.description))}</div>`
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
          <button class="plugin-number-step" type="button" data-step-dir="up" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" tabindex="-1" title="${escapeHtml(t('common.increase'))}"></button>
          <button class="plugin-number-step" type="button" data-step-dir="down" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}" tabindex="-1" title="${escapeHtml(t('common.decrease'))}"></button>
        </div>
      </div>
    `
  } else if (isLive2dMotionField(plugin, field)) {
    const selectedValue = String(rawValue ?? '')
    const motionOptions = getLive2dMotionOptions(plugin, selectedValue)
    if (motionOptions.length > 0) {
      control = `
        <select class="plugin-config-input" ${commonAttrs}>
          ${motionOptions.map(option => `
            <option value="${escapeHtml(option)}" ${option === selectedValue ? 'selected' : ''}>${escapeHtml(option)}</option>
          `).join('')}
        </select>
      `
    } else {
      control = `<input class="plugin-config-input" type="text" value="${escapeHtml(String(rawValue ?? ''))}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs} />`
    }
  } else if (field.type === 'select') {
    control = `
      <select class="plugin-config-input" ${commonAttrs}>
        ${field.options.map(option => `
          <option value="${escapeHtml(option.value)}" ${option.value === rawValue ? 'selected' : ''}>${escapeHtml(pluginConfigOptionText(plugin, field, option))}</option>
        `).join('')}
      </select>
    `
  } else if (field.type === 'file' || field.type === 'directory') {
    control = `
      <div class="plugin-file-control">
        <input class="plugin-config-input plugin-file-input" type="text" value="${escapeHtml(String(rawValue ?? ''))}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs} />
        <button class="plugin-admin-button secondary plugin-file-button" type="button" data-plugin-path-select="true" data-plugin-id="${escapeHtml(plugin.id)}" data-plugin-config="${escapeHtml(field.key)}">${escapeHtml(pluginConfigText(plugin, field, 'buttonLabel', field.buttonLabel ?? (field.type === 'directory' ? t('plugins.chooseDirectory') : t('plugins.choose'))))}</button>
      </div>
    `
  } else if (field.type === 'string' && field.multiline) {
    control = `<textarea class="plugin-config-input plugin-config-textarea" rows="${field.rows ?? 5}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs}>${escapeHtml(String(rawValue ?? ''))}</textarea>`
  } else {
    control = `<input class="plugin-config-input" type="text" value="${escapeHtml(String(rawValue ?? ''))}" placeholder="${escapeHtml(field.placeholder ?? '')}" ${commonAttrs} />`
  }

  return `
    <div class="plugin-config-row ${field.type === 'string' && field.multiline ? 'plugin-config-row-multiline' : ''} ${field.type === 'file' || field.type === 'directory' ? 'plugin-config-row-path' : ''}">
      <div class="plugin-config-meta">
        <div class="plugin-config-label">${label}</div>
        ${desc}
      </div>
      ${control}
    </div>
  `
}

function isLive2dMotionField(plugin: PluginInfo, field: PluginConfigField): boolean {
  return plugin.id === 'live2d-avatar'
    && field.type === 'string'
    && ['idleMotion', 'listeningMotion', 'thinkingMotion', 'speakingMotion', 'taskMotion', 'errorMotion'].includes(field.key)
}

function getLive2dMotionOptions(plugin: PluginInfo, currentValue: string): string[] {
  const capabilities = live2dCapabilitiesCache.get(getLive2dCapabilitiesCacheKey(plugin))
  const groups = capabilities?.motionGroups ?? []
  if (!groups.length) {
    return []
  }
  return currentValue && !groups.includes(currentValue)
    ? [currentValue, ...groups]
    : groups
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
    showPanelError('Failed to add role', result.error)
    return
  }

  await loadPersonalities()
  personalitySelect.value = result.item.id
  const setResult = await window.electronAPI.setPersonality(result.item.id)
  if (!setResult.success) {
    showPanelError('Failed to switch personality', setResult.error)
    return
  }

  showPanelNotice(tf('personality.addedAndSwitched', { name: result.item.name }))
})

// ========== Section Clear Buttons ==========

// Clear profile button
const clearProfileBtn = document.getElementById('clear-profile-btn')
clearProfileBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: t('memory.confirm.clearProfile.title'),
    message: t('memory.confirm.clearProfile.message'),
    detail: t('memory.confirm.clearProfile.detail'),
    confirmText: t('common.clear'),
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearProfile()
    if (!result.success) {
      throw new Error(result.error)
    }
    showPanelNotice(t('memory.profileCleared'))
    await loadUserProfile()
  } catch (error: any) {
    console.error('Clear profile error:', error)
  }
})

// Clear memories button
const clearMemoriesBtn = document.getElementById('clear-memories-btn')
clearMemoriesBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: t('memory.confirm.clearImportant.title'),
    message: t('memory.confirm.clearImportant.message'),
    detail: t('memory.confirm.clearImportant.detail'),
    confirmText: t('common.clear'),
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearImportantMemories()
    if (!result.success) {
      throw new Error(result.error)
    }
    showPanelNotice(t('memory.importantCleared'))
    await loadImportantMemories()
  } catch (error: any) {
    console.error('Clear memories error:', error)
  }
})

// Clear summaries button
const clearSummariesBtn = document.getElementById('clear-summaries-btn')
clearSummariesBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: t('memory.confirm.clearSummaries.title'),
    message: t('memory.confirm.clearSummaries.message'),
    detail: t('memory.confirm.clearSummaries.detail'),
    confirmText: t('common.clear'),
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearConversationSummaries()
    if (!result.success) {
      throw new Error(result.error)
    }
    showPanelNotice(t('memory.summariesCleared'))
    await loadConversationSummaries()
  } catch (error: any) {
    console.error('Clear summaries error:', error)
  }
})

// Clear conversations button
const clearConversationsBtn = document.getElementById('clear-conversations-btn')
clearConversationsBtn?.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: t('memory.confirm.clearConversations.title'),
    message: t('memory.confirm.clearConversations.message'),
    detail: t('memory.confirm.clearConversations.detail'),
    confirmText: t('common.clear'),
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearWorkingMemory()
    if (!result.success) {
      throw new Error(result.error)
    }
    clearTextDisplay()
    showPanelNotice(t('memory.conversationsCleared'))
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
    title: t('memory.confirm.resetAll.title'),
    message: t('memory.confirm.resetAll.message'),
    detail: t('memory.confirm.resetAll.detail'),
    confirmText: t('memory.resetAll'),
    tone: 'danger',
  })
  if (!confirmed) return

  try {
    const result = await window.electronAPI.clearHistory()
    if (!result.success) {
      throw new Error(result.error)
    }
    clearTextDisplay()
    showPanelNotice(t('memory.allReset'))
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
const backMemoryOverviewBtn = document.getElementById('back-memory-overview-btn') as HTMLButtonElement | null
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
  const loading = t('common.loading')
  const loadingHtml = `<div class="profile-loading"><span class="loading-spinner"></span>${escapeHtml(loading)}</div>`
  profileCount.textContent = loading
  importantMemoriesCount.textContent = loading
  summariesCount.textContent = loading
  conversationsCount.textContent = loading
  accountInputsCount.textContent = loading
  accountInputsPageCount.textContent = loading
  profileContent.innerHTML = loadingHtml
  importantMemoriesContent.innerHTML = loadingHtml
  summariesContent.innerHTML = loadingHtml
  conversationsContent.innerHTML = loadingHtml
  accountInputsContent.innerHTML = loadingHtml
}

async function loadUserProfile(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      throw new Error(result.error || t('memory.loadFailed'))
    }

    currentProfile = result.profile
    renderProfile(result.profile)
  } catch (error) {
    console.error('Failed to load profile:', error)
    profileCount.textContent = tf('common.records', { count: 0 })
    profileContent.innerHTML = `<div class="profile-error">${escapeHtml(t('memory.loadFailed'))}</div>`
  }
}

function renderProfile(profile: UserProfile): void {
  const { basic, personality, interests } = profile

  const labelMap: Record<string, string> = {
    nickname: t('memory.field.nickname'),
    name: t('memory.field.name'),
    age: t('memory.field.age'),
    gender: t('memory.field.gender'),
    location: t('memory.field.location'),
    occupation: t('memory.field.occupation'),
    currentMood: t('memory.field.currentMood'),
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
  profileCount.textContent = tf('common.records', { count: profileItemCount })

  if (fields.length === 0 && tags.length === 0) {
    profileContent.innerHTML = `<div class="profile-empty">${escapeHtml(t('memory.profileEmpty'))}</div>`
    return
  }

  let html = '<div class="profile-fields">'
  fields.forEach(f => {
    html += `
      <div class="profile-field" data-profile-field="${escapeHtml(f.key)}">
        <span class="field-label">${escapeHtml(f.label)}</span>
        <span class="field-value">${escapeHtml(f.value)}</span>
        <button class="delete-icon-btn" data-field="${escapeHtml(f.key)}" title="${escapeHtml(t('common.delete'))}"></button>
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
        title: t('memory.confirm.deleteProfile.title'),
        message: tf('memory.confirm.deleteProfile.message', { name: labelMap[field] || field }),
        detail: t('memory.confirm.deleteProfile.detail'),
        confirmText: t('common.delete'),
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
    showPanelNotice(t('common.deleted'))
  } catch (error: any) {
    console.error('Failed to delete profile field:', error)
    showPanelNotice('Delete failed', 'error')
  }
}

async function loadImportantMemories(): Promise<void> {
  try {
    const result = await window.electronAPI.getUserProfile()
    if (!result.success || !result.profile) {
      throw new Error(result.error || t('memory.loadFailed'))
    }

    const memories = result.profile.importantMemories || {}
    renderImportantMemories(memories)
  } catch (error) {
    console.error('Failed to load memories:', error)
    importantMemoriesCount.textContent = tf('common.records', { count: 0 })
    importantMemoriesContent.innerHTML = `<div class="profile-error">${escapeHtml(t('memory.loadFailed'))}</div>`
  }
}

function renderImportantMemories(memories: Record<string, string>): void {
  const entries = Object.entries(memories)
  importantMemoriesCount.textContent = tf('common.records', { count: entries.length })

  if (entries.length === 0) {
    importantMemoriesContent.innerHTML = `<div class="profile-empty">${escapeHtml(t('memory.importantEmpty'))}</div>`
    return
  }

  let html = '<div class="memories-list">'
  entries.forEach(([key, value]) => {
    html += `
      <div class="memory-item" data-memory-key="${escapeHtml(key)}">
        <div class="memory-content">
          <span class="memory-key">${escapeHtml(key)}</span>
          <span class="memory-value">${escapeHtml(value)}</span>
        </div>
        <button class="delete-icon-btn" data-key="${escapeHtml(key)}" title="${escapeHtml(t('common.delete'))}"></button>
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
        title: t('memory.confirm.deleteImportant.title'),
        message: tf('memory.confirm.deleteImportant.message', { name: key }),
        detail: t('memory.confirm.deleteImportant.detail'),
        confirmText: t('common.delete'),
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
    showPanelNotice(t('memory.memoryDeleted'))
  } catch (error: any) {
    console.error('Failed to delete memory:', error)
    showPanelNotice('Delete failed', 'error')
  }
}

async function loadConversationSummaries(): Promise<void> {
  try {
    const result = await window.electronAPI.getConversationSummaries()
    if (!result.success || !result.summaries) {
      throw new Error(result.error || t('memory.loadFailed'))
    }

    summariesCount.textContent = tf('common.records', { count: result.summaries.length })
    renderSummaries(result.summaries)
  } catch (error) {
    console.error('Failed to load summaries:', error)
    summariesContent.innerHTML = `<div class="profile-error">${escapeHtml(t('memory.loadFailed'))}</div>`
  }
}

function renderSummaries(summaries: Array<{
  id: string
  timestamp: number
  summary: string
  keyTopics: string[]
}>): void {
  if (summaries.length === 0) {
    summariesContent.innerHTML = `<div class="profile-empty">${escapeHtml(t('memory.summaryEmpty'))}</div>`
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
      <div class="summary-item" data-summary-id="${escapeHtml(s.id)}">
        <div class="summary-header">
          <span class="summary-date">${date}</span>
          <button class="delete-icon-btn" data-id="${escapeHtml(s.id)}" title="${escapeHtml(t('common.delete'))}"></button>
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
        title: t('memory.confirm.deleteSummary.title'),
        message: t('memory.confirm.deleteSummary.message'),
        detail: t('memory.confirm.deleteSummary.detail'),
        confirmText: t('common.delete'),
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
    showPanelNotice(t('common.deleted'))
  } catch (error: any) {
    console.error('Failed to delete summary:', error)
    showPanelNotice('Delete failed', 'error')
  }
}

async function loadWorkingMemory(): Promise<void> {
  try {
    const result = await window.electronAPI.getWorkingMemory()
    if (!result.success || !result.memory) {
      throw new Error(result.error || t('memory.loadFailed'))
    }

    const turns = result.memory.recentTurns || []
    conversationsCount.textContent = tf('common.records', { count: turns.length })
    renderConversations(turns)
  } catch (error) {
    console.error('Failed to load working memory:', error)
    conversationsContent.innerHTML = `<div class="profile-error">${escapeHtml(t('memory.loadFailed'))}</div>`
  }
}

function renderConversations(turns: Array<{
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp?: number
}>): void {
  if (turns.length === 0) {
    conversationsContent.innerHTML = `<div class="profile-empty">${escapeHtml(t('memory.conversationEmpty'))}</div>`
    return
  }

  let html = '<div class="conversations-list">'
  turns.slice(-20).forEach(turn => {
    const roleLabel = turn.role === 'user' ? t('memory.userRole') : 'EVA'
    const roleClass = turn.role === 'user' ? 'user' : 'assistant'
    html += `
      <div class="conversation-item ${roleClass}" data-conversation-id="${escapeHtml(turn.id)}">
        <span class="conversation-role">${roleLabel}</span>
        <span class="conversation-content">${escapeHtml(turn.content)}</span>
        <button class="delete-icon-btn" data-id="${escapeHtml(turn.id)}" title="${escapeHtml(t('common.delete'))}"></button>
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
        title: t('memory.confirm.deleteConversation.title'),
        message: t('memory.confirm.deleteConversation.message'),
        detail: t('memory.confirm.deleteConversation.detail'),
        confirmText: t('common.delete'),
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
    showPanelNotice(t('common.deleted'))
  } catch (error: any) {
    console.error('Failed to delete conversation turn:', error)
    showPanelNotice('Delete failed', 'error')
  }
}

async function loadAccountInputs(): Promise<void> {
  try {
    const result = await window.electronAPI.listAccountInputs()
    if (!result.success || !result.inputs) {
      throw new Error(result.error || t('memory.loadFailed'))
    }

    currentAccountInputs = result.inputs
    accountInputsCount.textContent = tf('common.records', { count: result.inputs.length })
    accountInputsPageCount.textContent = tf('common.records', { count: result.inputs.length })
    renderAccountInputs(result.inputs)
  } catch (error) {
    console.error('Failed to load account inputs:', error)
    accountInputsCount.textContent = tf('common.records', { count: 0 })
    accountInputsPageCount.textContent = tf('common.records', { count: 0 })
    accountInputsContent.innerHTML = `<div class="profile-error">${escapeHtml(t('memory.loadFailed'))}</div>`
  }
}

function renderAccountInputs(inputs: AccountInput[]): void {
  if (inputs.length === 0) {
    accountInputsContent.innerHTML = `<div class="profile-empty">${escapeHtml(t('memory.accountEmpty'))}</div>`
    return
  }

  let html = '<div class="account-input-list">'
  const groups = groupAccountInputs(inputs)
  groups.forEach(group => {
    html += `
      <div class="account-input-group" data-account-group="${escapeHtml(group.key)}">
        <div class="account-input-group-title">
          <span>${escapeHtml(group.label)}</span>
          <span>${escapeHtml(tf('common.items', { count: group.items.length }))}</span>
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
        <div class="account-input-item" data-account-key="${escapeHtml(input.key)}">
          <div class="account-input-main">
            <div class="account-input-title">
              <span>${escapeHtml(input.itemLabel || input.label || input.key)}</span>
              <span class="account-input-sensitivity">${escapeHtml(formatInputSensitivity(input.sensitivity))}</span>
            </div>
            <div class="account-input-key">${escapeHtml(input.key)}</div>
            <div class="account-input-value" data-key="${escapeHtml(input.key)}">${escapeHtml(maskAccountValue(input.value))}</div>
            <div class="account-input-meta">${escapeHtml(tf('common.updatedAt', { time: updatedAt }))} · ${escapeHtml(input.scope || 'global')}</div>
          </div>
          <div class="account-input-actions">
            <button class="memory-add-btn account-input-toggle" data-key="${escapeHtml(input.key)}" type="button">${escapeHtml(t('common.show'))}</button>
            <button class="delete-icon-btn visible" data-key="${escapeHtml(input.key)}" title="${escapeHtml(t('common.delete'))}"></button>
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
      const revealing = btn.textContent === t('common.show')
      if (valueEl) {
        valueEl.textContent = revealing ? input.value : maskAccountValue(input.value)
      }
      btn.textContent = revealing ? t('common.hide') : t('common.show')
    })
  })

  accountInputsContent.querySelectorAll<HTMLButtonElement>('.delete-icon-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key
      if (!key) {
        return
      }
      const confirmed = await showConfirmDialog({
        title: t('memory.confirm.deleteAccount.title'),
        message: tf('memory.confirm.deleteAccount.message', { name: key }),
        detail: t('memory.confirm.deleteAccount.detail'),
        confirmText: t('common.delete'),
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
    return t('common.empty')
  }
  if (value.length <= 4) {
    return '••••'
  }
  return `${value.slice(0, 2)}${'•'.repeat(Math.min(12, Math.max(4, value.length - 4)))}${value.slice(-2)}`
}

function formatInputSensitivity(sensitivity: string): string {
  switch (sensitivity) {
    case 'secret':
      return t('memory.sensitivitySecret')
    case 'verification':
      return t('memory.sensitivityVerification')
    default:
      return t('memory.sensitivityNormal')
  }
}

async function deleteAccountInput(key: string): Promise<void> {
  try {
    const result = await window.electronAPI.deleteAccountInput(key)
    if (!result.success) {
      throw new Error(result.error)
    }
    await loadAccountInputs()
    showPanelNotice(t('memory.accountDeleted'))
  } catch (error: any) {
    console.error('Failed to delete account input:', error)
    showPanelNotice('Delete failed', 'error')
  }
}

openAccountInputsBtn.addEventListener('click', () => {
  switchMemoryPage('accounts')
})

backMemoryOverviewBtn?.addEventListener('click', () => {
  switchMemoryPage('overview')
})

clearAccountInputsBtn.addEventListener('click', async () => {
  const confirmed = await showConfirmDialog({
    title: t('memory.confirm.clearAccount.title'),
    message: t('memory.confirm.clearAccount.message'),
    detail: t('memory.confirm.clearAccount.detail'),
    confirmText: t('common.clear'),
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
    showPanelNotice(t('memory.accountCleared'))
  } catch (error: any) {
    console.error('Failed to clear account inputs:', error)
    showPanelNotice('Clear failed', 'error')
  }
})

function escapeHtml(str: string): string {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ========== System Config Section ==========

const proxyInput = document.getElementById('proxy-input') as HTMLInputElement
const modelsOverviewPage = document.getElementById('models-overview-page') as HTMLElement
const modelsManagerPage = document.getElementById('models-manager-page') as HTMLElement
const modelOverviewList = document.getElementById('model-overview-list')!
const modelManagerTitle = document.getElementById('model-manager-title')!
const modelManagerSubtitle = document.getElementById('model-manager-subtitle')!
const backModelOverviewBtn = document.getElementById('back-model-overview-btn') as HTMLButtonElement | null
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
const configResetSection = document.getElementById('config-reset-section') as HTMLElement
const resetSystemBtn = document.getElementById('reset-system-btn') as HTMLButtonElement

let currentSystemConfig: SystemConfig | null = null
let lastLocalModels: LocalModelStatus[] = []
let activeModelManagerKind: ModelManagerKind | null = null
let systemConfigLoadPromise: Promise<void> | null = null
let systemConfigRendered = false

async function revealDevOnlyControls(): Promise<void> {
  try {
    configResetSection.hidden = !await window.electronAPI.isDevMode()
  } catch {
    configResetSection.hidden = true
  }
}

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
      label: t('system.dialogueModel'),
      message: t('system.completeDialogueModel'),
    })
  }

  const activeTask = system.taskModels.find(model => model.id === system.activeTaskId) || system.taskModels[0]
  const activeTaskTransport = activeTask ? getTaskModelTransport(activeTask) : 'openai_compatible'
  const taskReady = activeTaskTransport === 'openai_compatible'
    ? Boolean(activeTask?.modelName?.trim() && activeTask?.apiKey?.trim() && activeTask?.baseUrl?.trim())
    : true
  if (!taskReady) {
    issues.push({
      kind: 'task',
      label: t('system.taskModel'),
      message: t('system.completeTaskModel'),
    })
  }

  const activeTTS = system.ttsModels.find(model => model.id === system.activeTTSId) || system.ttsModels[0]
  const needsTTSVoice = getTTSProviderCatalogEntry(activeTTS?.provider).requiresVoiceId
  if (!activeTTS?.modelName?.trim() || !activeTTS?.apiKey?.trim() || (needsTTSVoice && !activeTTS?.voiceId?.trim())) {
    issues.push({
      kind: 'tts',
      label: 'TTS',
      message: needsTTSVoice ? t('system.completeTtsModel') : t('system.completeTtsModelNoVoice'),
    })
  }

  const activeASR = system.asrModels.find(model => model.id === system.activeASRId) || system.asrModels[0]
  if (!activeASR?.modelName?.trim() || !activeASR?.apiKey?.trim()) {
    issues.push({
      kind: 'asr',
      label: 'ASR',
      message: t('system.completeAsrModel'),
    })
  }

  try {
    const result = await window.electronAPI.getLocalModelStatus()
    if (!result.success) {
      throw new Error(result.error || t('system.checkFailed'))
    }
    const missingModels = result.models.filter(model => !model.exists)
    if (missingModels.length > 0) {
      issues.push({
        kind: 'models',
        label: t('system.localModels'),
        message: tf('system.downloadMissingLocal', { models: missingModels.map(model => model.name).join(' / ') }),
      })
    }
  } catch {
    issues.push({
      kind: 'models',
      label: t('system.localModels'),
      message: t('system.checkLocalModels'),
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
      <span class="setup-guidance-title">${escapeHtml(t('system.startupNeedsConfig'))}</span>
      <span class="setup-guidance-count">${escapeHtml(tf('common.items', { count: readiness.issues.length }))}</span>
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
      if (kind === 'llm' || kind === 'task' || kind === 'tts' || kind === 'asr' || kind === 'models') {
        openModelManager(kind)
        return
      }
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

  showPanelNotice(`${readiness.issues.length} required setting${readiness.issues.length === 1 ? '' : 's'} need attention`, 'error')
  openSettings('models')
  return false
}

async function loadSystemConfig(force = false): Promise<void> {
  const shouldRender = document.body.classList.contains('settings-open') &&
    (isSettingsSectionActive('system') || isSettingsSectionActive('models'))
  if (!force && currentSystemConfig && (!shouldRender || systemConfigRendered)) {
    return
  }
  if (!force && currentSystemConfig && shouldRender && !systemConfigRendered) {
    renderSystemConfig()
    systemConfigRendered = true
    void loadLocalModelStatus()
    return
  }
  if (systemConfigLoadPromise) {
    return systemConfigLoadPromise
  }

  systemConfigLoadPromise = window.electronAPI.getSettings()
    .then((settings) => {
      currentSystemConfig = settings.system
      if (shouldRender) {
        renderSystemConfig()
        systemConfigRendered = true
        void loadLocalModelStatus()
      }
    })
    .finally(() => {
      systemConfigLoadPromise = null
    })
  return systemConfigLoadPromise
}

function renderSystemConfig(): void {
  if (!currentSystemConfig) return

  proxyInput.value = currentSystemConfig.proxy

  renderModelOverview()
  renderLLMModels()
  renderTaskModels()
  renderTaskRuntimeSettings()
  renderTTSModels()
  renderASRModels()
  renderModelManagerPage()
}

function getActiveModelSummary(kind: ModelManagerKind): {
  kind: ModelManagerKind
  title: string
  modelName: string
  provider: string
  baseUrl: string
  apiKey: string
  voiceId?: string
  language?: string
  count: number
  ready: boolean
  missing: string[]
  logo?: ModelLogo
} {
  if (kind === 'models') {
    const missingModels = lastLocalModels.filter(model => !model.exists)
    const installedCount = lastLocalModels.filter(model => model.exists).length
    const modelNames = lastLocalModels.length > 0
      ? lastLocalModels.map(model => model.name).join(' / ')
      : 'Silero VAD / Smart Turn v3.2'
    return {
      kind,
      title: t('system.localModels'),
      modelName: modelNames,
      provider: 'Local ONNX',
      baseUrl: '',
      apiKey: '',
      count: lastLocalModels.length || 2,
      ready: lastLocalModels.length > 0 && missingModels.length === 0,
      missing: lastLocalModels.length > 0 ? missingModels.map(model => model.name) : [t('system.statusCheck')],
      language: lastLocalModels.length > 0 ? tf('system.installedRatio', { installed: installedCount, total: lastLocalModels.length }) : t('system.checking'),
    }
  }

  if (!currentSystemConfig) {
    return {
      kind,
      title: '',
      modelName: '',
      provider: '',
      baseUrl: '',
      apiKey: '',
      count: 0,
      ready: false,
      missing: [t('system.config')],
    }
  }

  if (kind === 'llm') {
    const model = currentSystemConfig.llmModels.find(item => item.id === currentSystemConfig!.activeLLMId) || currentSystemConfig.llmModels[0]
    const missing = [
      !model?.modelName?.trim() ? t('system.modelName') : '',
      !model?.apiKey?.trim() ? 'API Key' : '',
      !model?.baseUrl?.trim() ? 'Base URL' : '',
    ].filter(Boolean)
    return {
      kind,
      title: t('system.dialogueModel'),
      modelName: model?.modelName || t('system.notConfigured'),
      provider: 'OpenAI-compatible',
      baseUrl: model?.baseUrl || '',
      apiKey: model?.apiKey || '',
      count: currentSystemConfig.llmModels.length,
      ready: missing.length === 0,
      missing,
      logo: model ? getLLMModelLogo(model) : undefined,
    }
  }

  if (kind === 'task') {
    const model = currentSystemConfig.taskModels.find(item => item.id === currentSystemConfig!.activeTaskId) || currentSystemConfig.taskModels[0]
    const transport = model ? getTaskModelTransport(model) : 'openai_compatible'
    const missing = transport === 'openai_compatible'
      ? [
          !model?.modelName?.trim() ? t('system.modelName') : '',
          !model?.apiKey?.trim() ? 'API Key' : '',
          !model?.baseUrl?.trim() ? 'Base URL' : '',
        ].filter(Boolean)
      : []
    return {
      kind,
      title: t('system.taskModel'),
      modelName: transport === 'openai_compatible'
        ? model?.modelName || t('system.notConfigured')
        : 'CLI default',
      provider: getTaskTransportLabel(transport),
      baseUrl: transport === 'openai_compatible' ? model?.baseUrl || '' : '',
      apiKey: transport === 'openai_compatible' ? model?.apiKey || '' : '',
      count: currentSystemConfig.taskModels.length,
      ready: missing.length === 0,
      missing,
      logo: model ? getTaskModelLogo(model) : undefined,
    }
  }

  if (kind === 'tts') {
    const model = currentSystemConfig.ttsModels.find(item => item.id === currentSystemConfig!.activeTTSId) || currentSystemConfig.ttsModels[0]
    const provider = getTTSProviderCatalogEntry(model?.provider)
    const missing = [
      !model?.modelName?.trim() ? t('system.modelName') : '',
      !model?.apiKey?.trim() ? 'API Key' : '',
      provider.requiresVoiceId && !model?.voiceId?.trim() ? 'Voice ID' : '',
    ].filter(Boolean)
    return {
      kind,
      title: t('system.tts'),
      modelName: model?.modelName || t('system.notConfigured'),
      provider: provider.label,
      baseUrl: model?.baseUrl || provider.defaultBaseUrl,
      apiKey: model?.apiKey || '',
      voiceId: model?.voiceId || '',
      language: model?.language || provider.defaultLanguage,
      count: currentSystemConfig.ttsModels.length,
      ready: missing.length === 0,
      missing,
      logo: model ? getTTSProviderLogo(model.provider) : undefined,
    }
  }

  const model = currentSystemConfig.asrModels.find(item => item.id === currentSystemConfig!.activeASRId) || currentSystemConfig.asrModels[0]
  const provider = getASRProviderCatalogEntry(model?.provider)
  const missing = [
    !model?.modelName?.trim() ? t('system.modelName') : '',
    !model?.apiKey?.trim() ? 'API Key' : '',
  ].filter(Boolean)
  return {
    kind,
    title: t('system.asr'),
    modelName: model?.modelName || t('system.notConfigured'),
    provider: provider.label,
    baseUrl: model?.baseUrl || provider.defaultBaseUrl,
    apiKey: model?.apiKey || '',
    language: model?.language || provider.defaultLanguage,
    count: currentSystemConfig.asrModels.length,
    ready: missing.length === 0,
    missing,
    logo: model ? getASRProviderLogo(model.provider) : undefined,
  }
}

function renderModelOverview(): void {
  if (!currentSystemConfig) {
    return
  }

  const summaries = (['llm', 'task', 'tts', 'asr', 'models'] as ModelManagerKind[]).map(getActiveModelSummary)
  modelOverviewList.innerHTML = summaries.map(renderModelOverviewCard).join('')
}

function renderModelOverviewCard(summary: ReturnType<typeof getActiveModelSummary>): string {
  return `
    <button class="model-overview-card ${summary.ready ? 'ready' : 'missing'}" type="button" data-model-kind="${summary.kind}">
      ${summary.logo ? renderModelLogo(summary.logo, 'overview') : '<span class="model-overview-mark"></span>'}
      <span class="model-overview-main">
        <span class="model-overview-topline">
          <span class="model-overview-title">${escapeHtml(summary.title)}</span>
          <span class="model-overview-count">${escapeHtml(tf('system.configCount', { count: summary.count }))}</span>
        </span>
        <span class="model-overview-model">${escapeHtml(summary.modelName)}</span>
        <span class="model-overview-meta">
          <span>${escapeHtml(summary.provider)}</span>
          ${summary.baseUrl ? `<span>${escapeHtml(summary.baseUrl)}</span>` : ''}
          ${summary.language ? `<span>${escapeHtml(summary.language)}</span>` : ''}
        </span>
        <span class="model-overview-status">${escapeHtml(summary.ready ? t('system.ready') : tf('system.missingPrefix', { items: summary.missing.join(' / ') }))}</span>
      </span>
      <span class="model-overview-action">${escapeHtml(t('system.manage'))}</span>
    </button>
  `
}

function syncModelOverviewCard(kind: ModelManagerKind): void {
  if (!currentSystemConfig) return

  const summary = getActiveModelSummary(kind)
  replaceKeyedElement(
    modelOverviewList,
    `.model-overview-card[data-model-kind="${cssEscape(kind)}"]`,
    renderModelOverviewCard(summary)
  )
}

function openModelManager(kind: ModelManagerKind): void {
  activeModelManagerKind = kind
  renderModelManagerPage()
  modelsOverviewPage.classList.remove('active')
  modelsManagerPage.classList.add('active')
}

function closeModelManager(): void {
  activeModelManagerKind = null
  modelsManagerPage.classList.remove('active')
  modelsOverviewPage.classList.add('active')
  renderModelOverview()
}

function renderModelManagerPage(): void {
  const kind = activeModelManagerKind
  document.querySelectorAll<HTMLElement>('.model-manager-section').forEach(section => {
    section.classList.toggle('active', Boolean(kind && section.dataset.modelManager === kind))
  })

  if (!kind) {
    modelManagerTitle.textContent = t('system.modelManager')
    modelManagerSubtitle.textContent = t('system.modelManagerDesc')
    return
  }

  const summary = getActiveModelSummary(kind)
  modelManagerTitle.textContent = summary.title
  modelManagerSubtitle.textContent = summary.ready
    ? tf('system.currentUsing', { model: summary.modelName })
    : tf('system.needComplete', { items: summary.missing.join(' / ') })
}

async function loadLocalModelStatus(): Promise<void> {
  localModelsList.innerHTML = `<div class="profile-loading"><span class="loading-spinner"></span>${escapeHtml(t('system.checking'))}</div>`
  downloadLocalModelsBtn.disabled = true

  try {
    const result = await window.electronAPI.getLocalModelStatus()
    if (!result.success) {
      throw new Error(result.error || t('system.localModelStatusFailed'))
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
  renderModelOverview()
  renderModelManagerPage()

  localModelsList.innerHTML = models.map(model => `
    <div class="config-model-card local-model-card ${model.exists ? 'active' : 'missing'}" data-local-model="${escapeHtml(model.filename)}">
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

function getModelListElement(kind: ModelListKind): HTMLElement {
  if (kind === 'llm') return llmModelsList
  if (kind === 'task') return taskModelsList
  if (kind === 'tts') return ttsModelsList
  return asrModelsList
}

function getModelListEmptyText(kind: ModelListKind): string {
  if (kind === 'llm') return t('system.noLlm')
  if (kind === 'task') return t('system.noTask')
  if (kind === 'tts') return t('system.noTts')
  return t('system.noAsr')
}

function getModelListItems(kind: ModelListKind): Array<LLMModelConfig | TTSModelConfig | ASRModelConfig> {
  if (!currentSystemConfig) return []
  if (kind === 'llm') return currentSystemConfig.llmModels
  if (kind === 'task') return currentSystemConfig.taskModels
  if (kind === 'tts') return currentSystemConfig.ttsModels
  return currentSystemConfig.asrModels
}

function getModelListItem(kind: ModelListKind, id: string): LLMModelConfig | TTSModelConfig | ASRModelConfig | undefined {
  return getModelListItems(kind).find(model => model.id === id)
}

function renderModelList(kind: ModelListKind): void {
  if (!currentSystemConfig) return

  const list = getModelListElement(kind)
  const models = getModelListItems(kind)
  if (models.length === 0) {
    list.innerHTML = `<div class="config-empty">${escapeHtml(getModelListEmptyText(kind))}</div>`
    return
  }

  list.innerHTML = models.map(model => renderModelCard(kind, model)).join('')
}

function syncModelCard(kind: ModelListKind, id: string): void {
  const list = getModelListElement(kind)
  const card = list.querySelector<HTMLElement>(`.config-model-card[data-id="${cssEscape(id)}"]`)
  const model = getModelListItem(kind, id)
  if (!model) {
    card?.remove()
    if (getModelListItems(kind).length === 0) {
      renderModelList(kind)
    }
    return
  }

  replaceKeyedElement(list, `.config-model-card[data-id="${cssEscape(id)}"]`, renderModelCard(kind, model))
}

function syncModelCards(kind: ModelListKind, ids: string[] = getModelListItems(kind).map(model => model.id)): void {
  if (getModelListItems(kind).length === 0) {
    renderModelList(kind)
    return
  }

  Array.from(new Set(ids)).forEach(id => syncModelCard(kind, id))
}

function renderModelCard(kind: ModelListKind, model: LLMModelConfig | TTSModelConfig | ASRModelConfig): string {
  if (!currentSystemConfig) return ''

  if (kind === 'llm') {
    const item = model as LLMModelConfig
    const models = currentSystemConfig.llmModels
    const providerEntry = getLLMProviderCatalogEntry(item.provider)
    return `
    <div class="config-model-card ${item.id === currentSystemConfig.activeLLMId ? 'active' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          ${renderLLMProviderControl(item)}
          <input type="text" value="${escapeHtml(item.modelName)}" data-field="modelName" placeholder="${escapeHtml(providerEntry.defaultModel || 'model-name')}" />
          ${item.id === currentSystemConfig.activeLLMId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${item.id !== currentSystemConfig.activeLLMId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          ${renderLLMProviderControl(item)}
        </div>
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(item.apiKey)}" data-field="apiKey" placeholder="${escapeHtml(providerEntry.defaultApiKeyPlaceholder)}" />
        </div>
        <div class="config-field">
          <span class="config-field-label">Base URL</span>
          <input type="text" class="config-field-input" value="${escapeHtml(item.baseUrl)}" data-field="baseUrl" placeholder="https://api.openai.com/v1" />
        </div>
      </div>
    </div>
  `
  }

  if (kind === 'task') {
    const item = model as LLMModelConfig
    const models = currentSystemConfig.taskModels
    const transport = getTaskModelTransport(item)
    const isCli = transport !== 'openai_compatible'
    const providerEntry = getLLMProviderCatalogEntry(item.provider)
    const taskFields = isCli
      ? ''
      : `
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(item.apiKey)}" data-field="apiKey" placeholder="${escapeHtml(providerEntry.defaultApiKeyPlaceholder)}" />
        </div>
        <div class="config-field">
          <span class="config-field-label">Base URL</span>
          <input type="text" class="config-field-input" value="${escapeHtml(item.baseUrl)}" data-field="baseUrl" placeholder="https://generativelanguage.googleapis.com/v1beta/openai" />
        </div>
      `
    return `
    <div class="config-model-card ${item.id === currentSystemConfig.activeTaskId ? 'active' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          ${renderTaskProviderControl(item)}
          ${isCli
            ? '<span class="config-model-cli-default">CLI default</span>'
            : `<input type="text" value="${escapeHtml(item.modelName)}" data-field="modelName" placeholder="${escapeHtml(providerEntry.defaultModel || 'model-name')}" />`
          }
          ${item.id === currentSystemConfig.activeTaskId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${item.id !== currentSystemConfig.activeTaskId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          ${renderTaskProviderControl(item)}
        </div>
        ${taskFields}
      </div>
    </div>
  `
  }

  if (kind === 'tts') {
    const item = model as TTSModelConfig
    const models = currentSystemConfig.ttsModels
    const providerEntry = getTTSProviderCatalogEntry(item.provider)
    const fields = [
      shouldShowTTSField(item.provider, 'apiKey') ? `
        <div class="config-field">
          <span class="config-field-label">API Key</span>
          <input type="text" class="config-field-input masked" value="${escapeHtml(item.apiKey)}" data-field="apiKey" placeholder="API Key" />
        </div>
      ` : '',
      shouldShowTTSField(item.provider, 'baseUrl') ? `
        <div class="config-field">
          <span class="config-field-label">Base URL</span>
          <input type="text" class="config-field-input" value="${escapeHtml(item.baseUrl || '')}" data-field="baseUrl" placeholder="${escapeHtml(providerEntry.defaultBaseUrl || 'Leave blank for default')}" />
        </div>
      ` : '',
      shouldShowTTSField(item.provider, 'voiceId') ? `
        <div class="config-field">
          <span class="config-field-label">Voice ID</span>
          <input type="text" class="config-field-input" value="${escapeHtml(item.voiceId || '')}" data-field="voiceId" placeholder="${escapeHtml(getTTSProviderCatalogEntry(item.provider).defaultVoiceId || t('system.voiceIdPlaceholder'))}" />
        </div>
      ` : '',
      shouldShowTTSField(item.provider, 'language') ? `
        <div class="config-field">
          <span class="config-field-label">Language</span>
          <input type="text" class="config-field-input" value="${escapeHtml(item.language || '')}" data-field="language" placeholder="${escapeHtml(t('system.languagePlaceholderOptional'))}" />
        </div>
      ` : '',
    ].join('')
    return `
    <div class="config-model-card ${item.id === currentSystemConfig.activeTTSId ? 'active' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          ${renderTTSProviderControl(item.provider)}
          <input type="text" value="${escapeHtml(item.modelName)}" data-field="modelName" placeholder="s2-pro" />
          ${item.id === currentSystemConfig.activeTTSId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${item.id !== currentSystemConfig.activeTTSId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          ${renderTTSProviderControl(item.provider)}
        </div>
        ${fields}
      </div>
    </div>
  `
  }

  const item = model as ASRModelConfig
  const models = currentSystemConfig.asrModels
  const providerEntry = getASRProviderCatalogEntry(item.provider)
  const fields = [
    shouldShowASRField(item.provider, 'apiKey') ? `
      <div class="config-field">
        <span class="config-field-label">API Key</span>
        <input type="text" class="config-field-input masked" value="${escapeHtml(item.apiKey)}" data-field="apiKey" placeholder="API Key" />
      </div>
    ` : '',
    shouldShowASRField(item.provider, 'baseUrl') ? `
      <div class="config-field">
        <span class="config-field-label">Base URL</span>
        <input type="text" class="config-field-input" value="${escapeHtml(item.baseUrl || '')}" data-field="baseUrl" placeholder="${escapeHtml(providerEntry.defaultBaseUrl || 'Leave blank for default')}" />
      </div>
    ` : '',
    shouldShowASRField(item.provider, 'language') ? `
      <div class="config-field">
        <span class="config-field-label">Language</span>
        <input type="text" class="config-field-input" value="${escapeHtml(item.language || '')}" data-field="language" placeholder="zh / en" />
      </div>
    ` : '',
  ].join('')
  return `
    <div class="config-model-card ${item.id === currentSystemConfig.activeASRId ? 'active' : ''}" data-id="${escapeHtml(item.id)}">
      <div class="config-model-header">
        <div class="config-model-name">
          ${renderASRProviderControl(item.provider)}
          <input type="text" value="${escapeHtml(item.modelName)}" data-field="modelName" placeholder="realtime" />
          ${item.id === currentSystemConfig.activeASRId ? `<span class="config-model-active-badge">${escapeHtml(t('common.active'))}</span>` : ''}
        </div>
        <div class="config-model-actions">
          ${renderApiTestButton()}
          ${item.id !== currentSystemConfig.activeASRId ? `<button class="config-model-btn config-activate-btn" data-action="activate">${escapeHtml(t('common.activate'))}</button>` : ''}
          ${models.length > 1 ? `<button class="config-model-btn config-delete-btn" data-action="delete">${escapeHtml(t('common.delete'))}</button>` : ''}
        </div>
      </div>
      <div class="config-model-fields">
        <div class="config-field">
          <span class="config-field-label">Provider</span>
          ${renderASRProviderControl(item.provider)}
        </div>
        ${fields}
      </div>
    </div>
  `
}

function renderLLMModels(): void {
  renderModelList('llm')
}

function renderTaskModels(): void {
  renderModelList('task')
}

function renderTaskRuntimeSettings(): void {
  if (!currentSystemConfig) return
  const config = currentSystemConfig.taskRuntime
  taskMaxTurnsInput.value = String(config.maxTurns)
  taskContextWindowInput.value = String(config.modelContextWindow)
  taskCompactAfterInput.value = String(config.autoCompactTokenLimit)
  taskKeepRecentInput.value = String(config.keepRecentTurns)
}

function renderModelLogo(logo: ModelLogo, className = ''): string {
  return `<img class="config-model-logo ${logo.tone === 'light' ? 'light' : 'color'} ${className}" src="${escapeHtml(logo.src)}" alt="${escapeHtml(logo.alt)}" />`
}

function getLLMModelLogo(model: Pick<LLMModelConfig, 'modelName' | 'baseUrl'>): ModelLogo {
  const text = `${model.modelName || ''} ${model.baseUrl || ''}`.toLowerCase()
  if (text.includes('gemini') || text.includes('generativelanguage.googleapis.com') || text.includes('google')) {
    return { src: geminiIconUrl, alt: 'Gemini' }
  }
  if (text.includes('claude') || text.includes('anthropic')) {
    return { src: claudeIconUrl, alt: 'Claude' }
  }
  if (text.includes('deepseek')) {
    return { src: deepseekIconUrl, alt: 'DeepSeek' }
  }
  if (text.includes('qwen') || text.includes('dashscope') || text.includes('alibaba')) {
    return { src: qwenIconUrl, alt: 'Qwen' }
  }
  return { src: openAIIconUrl, alt: 'OpenAI', tone: 'light' }
}

function getLLMProviderLogo(provider: LLMProviderType | undefined, model?: Pick<LLMModelConfig, 'modelName' | 'baseUrl'>): ModelLogo {
  switch (provider) {
    case 'gemini':
      return { src: geminiIconUrl, alt: 'Gemini' }
    case 'claude':
      return { src: claudeIconUrl, alt: 'Claude' }
    case 'deepseek':
      return { src: deepseekIconUrl, alt: 'DeepSeek' }
    case 'qwen':
      return { src: qwenIconUrl, alt: 'Qwen' }
    case 'groq':
      return { src: groqIconUrl, alt: 'Groq', tone: 'light' }
    case 'azure-openai':
      return { src: azureAIIconUrl, alt: 'Azure OpenAI' }
    case 'ollama':
      return { src: ollamaIconUrl, alt: 'Ollama', tone: 'light' }
    case 'openai-compatible':
      return { src: newAPIIconUrl, alt: 'New API' }
    case 'openai':
      return { src: openAIIconUrl, alt: getLLMProviderCatalogEntry(provider).label, tone: 'light' }
    default:
      return model ? getLLMModelLogo(model) : { src: openAIIconUrl, alt: 'OpenAI', tone: 'light' }
  }
}

function getTTSProviderLogo(provider: TTSProviderType): ModelLogo {
  switch (provider) {
    case 'fish':
      return { src: fishAudioIconUrl, alt: 'Fish Audio', tone: 'light' }
    case 'elevenlabs':
      return { src: elevenLabsIconUrl, alt: 'ElevenLabs', tone: 'light' }
    default:
      return { src: fishAudioIconUrl, alt: getTTSProviderCatalogEntry(provider).label, tone: 'light' }
  }
}

/*
 * Hidden TTS-provider logo mappings kept for future re-enablement.
 * They are not reachable while TTS_PROVIDER_CATALOG is limited to Fish Audio and ElevenLabs.
 *
 * openai -> openAIIconUrl, OpenAI
 * openai-compatible -> newAPIIconUrl, OpenAI-compatible TTS
 * groq -> groqIconUrl, Groq
 * gemini -> geminiIconUrl, Gemini
 * google-cloud -> googleCloudIconUrl, Google Cloud
 * azure-openai / azure-speech -> azureAIIconUrl, Azure
 * minimax -> minimaxIconUrl, MiniMax
 */

function getASRProviderLogo(provider: ASRProviderType): ModelLogo {
  switch (provider) {
    case 'fish':
      return { src: fishAudioIconUrl, alt: 'Fish Audio', tone: 'light' }
    case 'elevenlabs':
      return { src: elevenLabsIconUrl, alt: 'ElevenLabs', tone: 'light' }
    case 'qwen':
      return { src: qwenIconUrl, alt: 'Qwen' }
    case 'groq':
      return { src: groqIconUrl, alt: 'Groq', tone: 'light' }
    case 'assemblyai':
      return { src: assemblyAIIconUrl, alt: 'AssemblyAI' }
    case 'google-cloud':
      return { src: googleCloudIconUrl, alt: 'Google Cloud' }
    case 'azure-openai':
    case 'azure-speech':
      return { src: azureAIIconUrl, alt: getASRProviderCatalogEntry(provider).label }
    case 'openai-compatible':
      return { src: newAPIIconUrl, alt: getASRProviderCatalogEntry(provider).label }
    case 'openai':
    default:
      return { src: openAIIconUrl, alt: getASRProviderCatalogEntry(provider).label, tone: 'light' }
  }
}

const TTS_PROVIDERS = TTS_PROVIDER_CATALOG
const LLM_PROVIDERS = LLM_PROVIDER_CATALOG
const TASK_MODEL_TRANSPORTS: Array<{ value: NonNullable<LLMModelConfig['transport']>; label: string }> = [
  { value: 'openai_compatible', label: 'API' },
  { value: 'codex_local', label: 'Codex' },
  { value: 'claude_code_local', label: 'Claude Code' },
]
const TASK_PROVIDER_OPTIONS = [
  ...LLM_PROVIDERS,
]

function getLLMProviderLabel(provider: LLMProviderType | undefined): string {
  return getLLMProviderCatalogEntry(provider).label
}

function getTTSProviderLabel(provider: TTSProviderType): string {
  return TTS_PROVIDERS.find(p => p.value === provider)?.label || provider
}

function renderProviderControl(kind: 'llm' | 'task-llm' | 'task-provider' | 'tts' | 'asr' | 'task-transport', value: string, label: string, logo?: ModelLogo): string {
  const field = kind === 'task-transport' ? 'transport' : 'provider'
  return `
    <span class="config-provider-control">
      <input type="hidden" data-field="${field}" value="${escapeHtml(value)}" />
      <button class="config-provider-trigger ${logo ? 'has-logo' : 'no-logo'}" type="button" data-provider-kind="${kind}" data-provider-value="${escapeHtml(value)}" aria-haspopup="listbox" aria-expanded="false">
        ${logo ? renderModelLogo(logo, 'provider') : ''}
        <span class="config-provider-trigger-label">${escapeHtml(label)}</span>
        <span class="config-provider-trigger-arrow"></span>
      </button>
    </span>
  `
}

function renderLLMProviderControl(model: LLMModelConfig, kind: 'llm' | 'task-llm' = 'llm'): string {
  const provider = getLLMProviderCatalogEntry(model.provider).value
  return renderProviderControl(kind, provider, getLLMProviderLabel(provider), getLLMProviderLogo(provider, model))
}

function renderTaskProviderControl(model: LLMModelConfig): string {
  const transport = getTaskModelTransport(model)
  if (transport !== 'openai_compatible') {
    return renderProviderControl('task-provider', transport, getTaskTransportLabel(transport), getTaskTransportLogo(transport))
  }

  const provider = getLLMProviderCatalogEntry(model.provider).value
  return renderProviderControl('task-provider', provider, getLLMProviderLabel(provider), getLLMProviderLogo(provider, model))
}

function renderTTSProviderControl(provider: TTSProviderType): string {
  return renderProviderControl('tts', provider, getTTSProviderLabel(provider), getTTSProviderLogo(provider))
}

function shouldShowTTSField(provider: TTSProviderType, field: keyof TTSModelConfig): boolean {
  switch (provider) {
    case 'fish':
      return field === 'apiKey' || field === 'voiceId'
    case 'elevenlabs':
      return field === 'apiKey' || field === 'baseUrl' || field === 'voiceId' || field === 'language'
    default:
      return false
  }
}

function shouldShowASRField(provider: ASRProviderType, field: keyof ASRModelConfig): boolean {
  switch (provider) {
    case 'qwen':
      return field === 'apiKey' || field === 'baseUrl' || field === 'language'
    case 'openai':
    case 'groq':
      return field === 'apiKey' || field === 'baseUrl' || field === 'language'
    default:
      return true
  }
}

function renderTTSModels(): void {
  renderModelList('tts')
}

const ASR_PROVIDERS = ASR_PROVIDER_CATALOG

function getASRProviderLabel(provider: ASRProviderType): string {
  return ASR_PROVIDERS.find(p => p.value === provider)?.label || provider
}

function renderASRProviderControl(provider: ASRProviderType): string {
  return renderProviderControl('asr', provider, getASRProviderLabel(provider), getASRProviderLogo(provider))
}

function renderASRModels(): void {
  renderModelList('asr')
}

function renderApiTestButton(): string {
  return `<button class="config-model-btn config-test-btn" data-action="test" title="${escapeHtml(t('system.apiTestTitle'))}">${escapeHtml(t('plugins.test'))}</button>`
}

function readCardModel<T extends Record<string, any>>(card: Element, model: T): T {
  const draft = { ...model }
  card.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-field]').forEach(input => {
    draft[input.dataset.field as keyof T] = input.value as T[keyof T]
  })
  return draft
}

function closeProviderMenu(): void {
  document.getElementById('config-provider-floating-menu')?.remove()
  document.querySelectorAll<HTMLButtonElement>('.config-provider-trigger[aria-expanded="true"]').forEach(button => {
    button.setAttribute('aria-expanded', 'false')
  })
}

function openProviderMenu(button: HTMLButtonElement, id: string): void {
  const kind = button.dataset.providerKind as 'llm' | 'task-llm' | 'task-provider' | 'tts' | 'asr' | 'task-transport' | undefined
  if (!kind) return

  const providers = kind === 'llm' || kind === 'task-llm'
    ? LLM_PROVIDERS
    : kind === 'task-provider'
      ? TASK_PROVIDER_OPTIONS
    : kind === 'tts'
    ? TTS_PROVIDERS
    : kind === 'asr'
      ? ASR_PROVIDERS
      : TASK_MODEL_TRANSPORTS
  const taskModel = kind === 'task-transport'
    ? currentSystemConfig?.taskModels.find(model => model.id === id)
    : undefined
  const currentValue = button.dataset.providerValue || ''
  closeProviderMenu()
  button.setAttribute('aria-expanded', 'true')

  const rect = button.getBoundingClientRect()
  const menuWidth = Math.max(168, rect.width)
  const optionHeight = 32
  const menu = document.createElement('div')
  menu.id = 'config-provider-floating-menu'
  menu.className = 'config-provider-floating-menu'
  menu.setAttribute('role', 'listbox')
  menu.style.minWidth = `${menuWidth}px`
  menu.style.left = `${Math.min(rect.left, window.innerWidth - menuWidth - 12)}px`
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - providers.length * optionHeight - 14)}px`
  menu.innerHTML = providers.map(provider => {
    const implemented = 'implemented' in provider ? provider.implemented : true
    const logo = kind === 'llm' || kind === 'task-llm'
      ? getLLMProviderLogo(provider.value as LLMProviderType)
      : kind === 'task-provider'
        ? provider.value === 'codex_local' || provider.value === 'claude_code_local'
          ? getTaskTransportLogo(provider.value as NonNullable<LLMModelConfig['transport']>)
          : getLLMProviderLogo(provider.value as LLMProviderType)
      : kind === 'tts'
      ? getTTSProviderLogo(provider.value as TTSProviderType)
      : kind === 'asr'
        ? getASRProviderLogo(provider.value as ASRProviderType)
        : getTaskTransportLogo(provider.value as NonNullable<LLMModelConfig['transport']>)
    return `
    <button class="config-provider-option ${provider.value === currentValue ? 'selected' : ''} ${implemented ? '' : 'disabled'}" type="button" role="option" aria-selected="${provider.value === currentValue ? 'true' : 'false'}" data-provider-value="${escapeHtml(provider.value)}" ${implemented ? '' : 'disabled'}>
      <span class="config-provider-option-check">${provider.value === currentValue ? '✓' : ''}</span>
      ${logo ? renderModelLogo(logo, 'provider-option') : ''}
      <span class="config-provider-option-label">${escapeHtml(provider.label)}${implemented ? '' : ' · TODO'}</span>
    </button>
  `
  }).join('')

  menu.querySelectorAll<HTMLButtonElement>('.config-provider-option').forEach(option => {
    option.addEventListener('click', async () => {
      const provider = option.dataset.providerValue
      if (!provider || provider === currentValue) {
        closeProviderMenu()
        return
      }
      closeProviderMenu()
      if (kind === 'llm') {
        await updateLLMProvider(id, provider as LLMProviderType)
      } else if (kind === 'task-provider') {
        if (provider === 'codex_local' || provider === 'claude_code_local') {
          await updateTaskTransport(id, provider as NonNullable<LLMModelConfig['transport']>)
        } else {
          await updateTaskProvider(id, provider as LLMProviderType)
        }
      } else if (kind === 'task-llm') {
        await updateTaskProvider(id, provider as LLMProviderType)
      } else if (kind === 'tts') {
        await updateTTSProvider(id, provider as TTSProviderType)
      } else if (kind === 'asr') {
        await updateASRProvider(id, provider as ASRProviderType)
      } else {
        await updateTaskTransport(id, provider as NonNullable<LLMModelConfig['transport']>)
      }
    })
  })

  document.body.appendChild(menu)
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
    showPanelNotice('Model configuration is missing', 'error')
    return
  }

  const originalText = button.textContent || t('plugins.test')
  button.disabled = true
  button.textContent = t('system.testing')
  button.classList.remove('success', 'danger')
  button.classList.add('testing')

  try {
    const result = await window.electronAPI.testApiModel(kind, readCardModel(card, model))
    if (!result.success) {
      throw new Error(result.error || t('system.connectionFailed'))
    }
    button.textContent = t('common.ready')
    button.classList.remove('testing')
    button.classList.add('success')
    showPanelNotice(result.message || t('system.apiOk'))
  } catch (error: any) {
    button.textContent = t('common.failed')
    button.classList.remove('testing')
    button.classList.add('danger')
    showPanelError('API test failed', error)
  } finally {
    window.setTimeout(() => {
      button.disabled = false
      button.textContent = originalText
      button.classList.remove('success', 'danger', 'testing')
    }, 1600)
  }
}

type ModelListKind = 'llm' | 'task' | 'tts' | 'asr'

function getModelListKind(list: HTMLElement): ModelListKind | null {
  if (list === llmModelsList) return 'llm'
  if (list === taskModelsList) return 'task'
  if (list === ttsModelsList) return 'tts'
  if (list === asrModelsList) return 'asr'
  return null
}

function bindModelListEvents(list: HTMLElement): void {
  list.addEventListener('change', (event) => {
    const input = (event.target as HTMLElement | null)?.closest<HTMLInputElement | HTMLSelectElement>(
      'input[data-field], select[data-field]'
    )
    const card = input?.closest<HTMLElement>('.config-model-card')
    const kind = getModelListKind(list)
    const id = card?.dataset.id
    const field = input?.dataset.field
    if (!input || !card || !kind || !id || !field || field === 'provider' || field === 'transport') {
      return
    }

    const value = input.value
    if (kind === 'llm') {
      void updateLLMModel(id, { [field]: value })
    } else if (kind === 'task') {
      void updateTaskModel(id, { [field]: value })
    } else if (kind === 'tts') {
      void updateTTSModel(id, { [field]: value })
    } else {
      void updateASRModel(id, { [field]: value })
    }
  })

  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null
    const card = target?.closest<HTMLElement>('.config-model-card')
    const kind = getModelListKind(list)
    const id = card?.dataset.id
    if (!target || !card || !kind || !id) {
      return
    }

    const providerButton = target.closest<HTMLButtonElement>('.config-provider-trigger')
    if (providerButton) {
      event.stopPropagation()
      openProviderMenu(providerButton, id)
      return
    }

    const actionButton = target.closest<HTMLButtonElement>('button[data-action]')
    const action = actionButton?.dataset.action
    if (!actionButton || !action) {
      return
    }

    if (action === 'test') {
      void testApiModel(kind, id, card, actionButton)
      return
    }

    if (kind === 'llm') {
      if (action === 'activate') void activateLLMModel(id)
      if (action === 'delete') void deleteLLMModel(id)
    } else if (kind === 'task') {
      if (action === 'activate') void activateTaskModel(id)
      if (action === 'delete') void deleteTaskModel(id)
    } else if (kind === 'tts') {
      if (action === 'activate') void activateTTSModel(id)
      if (action === 'delete') void deleteTTSModel(id)
    } else {
      if (action === 'activate') void activateASRModel(id)
      if (action === 'delete') void deleteASRModel(id)
    }
  })
}

async function saveSystemConfig(): Promise<void> {
  if (!currentSystemConfig) return
  await window.electronAPI.updateSettings({ system: currentSystemConfig })
  renderModelOverview()
  renderModelManagerPage()
  await refreshSetupReadiness()
}

async function saveSystemConfigForModel(kind: ModelManagerKind): Promise<void> {
  if (!currentSystemConfig) return
  await window.electronAPI.updateSettings({ system: currentSystemConfig })
  syncModelOverviewCard(kind)
  renderModelManagerPage()
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
    adapterId: currentSystemConfig.taskRuntime.adapterId || 'task_runtime',
    maxTurns,
    modelContextWindow,
    autoCompactTokenLimit,
    keepRecentTurns,
    cwd: currentSystemConfig.taskRuntime.cwd || '',
    timeoutMs: currentSystemConfig.taskRuntime.timeoutMs || 1800000,
    command: currentSystemConfig.taskRuntime.command || '',
    model: currentSystemConfig.taskRuntime.model || '',
    extraArgs: currentSystemConfig.taskRuntime.extraArgs || []
  }
  renderTaskRuntimeSettings()
  await saveSystemConfig()
}

async function updateLLMModel(id: string, updates: Partial<LLMModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.llmModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfigForModel('llm')
    syncModelCard('llm', id)
  }
}

async function updateLLMProvider(id: string, provider: LLMProviderType): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.llmModels.find(m => m.id === id)
  if (!model) return

  const providerEntry = getLLMProviderCatalogEntry(provider)
  const providerChanged = model.provider !== provider
  model.provider = provider
  if (providerChanged) {
    model.modelName = providerEntry.defaultModel
    model.baseUrl = providerEntry.defaultBaseUrl
  } else {
    model.modelName ||= providerEntry.defaultModel
    model.baseUrl ||= providerEntry.defaultBaseUrl
  }
  await saveSystemConfigForModel('llm')
  syncModelCard('llm', id)
}

async function activateLLMModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  const previousId = currentSystemConfig.activeLLMId
  currentSystemConfig.activeLLMId = id
  await saveSystemConfigForModel('llm')
  syncModelCards('llm', [previousId, id])
}

async function deleteLLMModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.llmModels.length <= 1) return
  const previousIds = currentSystemConfig.llmModels.map(model => model.id)
  currentSystemConfig.llmModels = currentSystemConfig.llmModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeLLMId === id && currentSystemConfig.llmModels.length > 0) {
    currentSystemConfig.activeLLMId = currentSystemConfig.llmModels[0].id
  }
  await saveSystemConfigForModel('llm')
  syncModelCard('llm', id)
  syncModelCards('llm', previousIds.filter(item => item !== id))
}

async function addLLMModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: LLMModelConfig = {
    id: generateId(),
    provider: 'openai-compatible',
    modelName: getLLMProviderCatalogEntry('openai-compatible').defaultModel,
    apiKey: '',
    baseUrl: getLLMProviderCatalogEntry('openai-compatible').defaultBaseUrl
  }
  currentSystemConfig.llmModels.push(newModel)
  await saveSystemConfigForModel('llm')
  syncModelCards('llm')
}

async function updateTaskModel(id: string, updates: Partial<LLMModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.taskModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfigForModel('task')
    syncModelCard('task', id)
  }
}

async function updateTaskTransport(id: string, transport: NonNullable<LLMModelConfig['transport']>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.taskModels.find(m => m.id === id)
  if (!model) return

  const transportChanged = getTaskModelTransport(model) !== transport
  model.transport = transport
  if (transportChanged && (transport === 'codex_local' || transport === 'claude_code_local')) {
    model.provider = transport === 'claude_code_local' ? 'claude-code' : 'codex'
    model.modelName = ''
    model.apiKey = ''
    model.baseUrl = ''
  }
  if (transportChanged && transport === 'openai_compatible') {
    if (getLLMProviderCatalogEntry(model.provider).transport) {
      model.provider = 'gemini'
    }
    const providerEntry = getLLMProviderCatalogEntry(model.provider || 'gemini')
    model.modelName ||= providerEntry.defaultModel || 'gemini-3.1-pro-preview'
    model.baseUrl ||= providerEntry.defaultBaseUrl
  }
  await saveSystemConfigForModel('task')
  syncModelCard('task', id)
}

async function updateTaskProvider(id: string, provider: LLMProviderType): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.taskModels.find(m => m.id === id)
  if (!model) return

  const providerEntry = getLLMProviderCatalogEntry(provider)
  const providerChanged = model.provider !== provider
  model.provider = provider
  model.transport = providerEntry.transport ?? 'openai_compatible'
  if (model.transport === 'codex_local' || model.transport === 'claude_code_local') {
    model.modelName = ''
    model.apiKey = ''
    model.baseUrl = ''
    await saveSystemConfigForModel('task')
    syncModelCard('task', id)
    return
  }
  if (providerChanged) {
    model.modelName = providerEntry.defaultModel
    model.baseUrl = providerEntry.defaultBaseUrl
  } else {
    model.modelName ||= providerEntry.defaultModel
    model.baseUrl ||= providerEntry.defaultBaseUrl
  }
  await saveSystemConfigForModel('task')
  syncModelCard('task', id)
}

async function activateTaskModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  const previousId = currentSystemConfig.activeTaskId
  currentSystemConfig.activeTaskId = id
  await saveSystemConfigForModel('task')
  syncModelCards('task', [previousId, id])
}

async function deleteTaskModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.taskModels.length <= 1) return
  const previousIds = currentSystemConfig.taskModels.map(model => model.id)
  currentSystemConfig.taskModels = currentSystemConfig.taskModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeTaskId === id && currentSystemConfig.taskModels.length > 0) {
    currentSystemConfig.activeTaskId = currentSystemConfig.taskModels[0].id
  }
  await saveSystemConfigForModel('task')
  syncModelCard('task', id)
  syncModelCards('task', previousIds.filter(item => item !== id))
}

async function addTaskModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: LLMModelConfig = {
    id: generateId(),
    provider: 'gemini',
    transport: 'openai_compatible',
    modelName: getLLMProviderCatalogEntry('gemini').defaultModel,
    apiKey: '',
    baseUrl: getLLMProviderCatalogEntry('gemini').defaultBaseUrl
  }
  currentSystemConfig.taskModels.push(newModel)
  await saveSystemConfigForModel('task')
  syncModelCards('task')
}

async function updateTTSModel(id: string, updates: Partial<TTSModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.ttsModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfigForModel('tts')
    syncModelCard('tts', id)
  }
}

async function updateTTSProvider(id: string, provider: TTSProviderType): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.ttsModels.find(m => m.id === id)
  if (!model) return

  const providerEntry = getTTSProviderCatalogEntry(provider)
  const providerChanged = model.provider !== provider
  model.provider = provider
  if (providerChanged) {
    model.modelName = providerEntry.defaultModel
    model.baseUrl = providerEntry.defaultBaseUrl
    model.voiceId = providerEntry.defaultVoiceId || ''
    model.language = providerEntry.defaultLanguage
    model.sampleRate = providerEntry.sampleRate
  } else {
    model.modelName ||= providerEntry.defaultModel
    model.baseUrl ||= providerEntry.defaultBaseUrl
    model.voiceId ||= providerEntry.defaultVoiceId || ''
    model.language ||= providerEntry.defaultLanguage
    model.sampleRate ||= providerEntry.sampleRate
  }
  model.format ||= 'pcm'
  await saveSystemConfigForModel('tts')
  syncModelCard('tts', id)
}

async function activateTTSModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  const previousId = currentSystemConfig.activeTTSId
  currentSystemConfig.activeTTSId = id
  await saveSystemConfigForModel('tts')
  syncModelCards('tts', [previousId, id])
}

async function deleteTTSModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.ttsModels.length <= 1) return
  const previousIds = currentSystemConfig.ttsModels.map(model => model.id)
  currentSystemConfig.ttsModels = currentSystemConfig.ttsModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeTTSId === id && currentSystemConfig.ttsModels.length > 0) {
    currentSystemConfig.activeTTSId = currentSystemConfig.ttsModels[0].id
  }
  await saveSystemConfigForModel('tts')
  syncModelCard('tts', id)
  syncModelCards('tts', previousIds.filter(item => item !== id))
}

async function addTTSModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: TTSModelConfig = {
    id: generateId(),
    provider: 'fish',
    modelName: getTTSProviderCatalogEntry('fish').defaultModel,
    apiKey: '',
    voiceId: getTTSProviderCatalogEntry('fish').defaultVoiceId || '',
    baseUrl: getTTSProviderCatalogEntry('fish').defaultBaseUrl,
    language: getTTSProviderCatalogEntry('fish').defaultLanguage,
    format: 'pcm',
    sampleRate: getTTSProviderCatalogEntry('fish').sampleRate
  }
  currentSystemConfig.ttsModels.push(newModel)
  await saveSystemConfigForModel('tts')
  syncModelCards('tts')
}

async function updateASRModel(id: string, updates: Partial<ASRModelConfig>): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.asrModels.find(m => m.id === id)
  if (model) {
    Object.assign(model, updates)
    await saveSystemConfigForModel('asr')
    syncModelCard('asr', id)
  }
}

async function updateASRProvider(id: string, provider: ASRProviderType): Promise<void> {
  if (!currentSystemConfig) return
  const model = currentSystemConfig.asrModels.find(m => m.id === id)
  if (!model) return

  const providerEntry = getASRProviderCatalogEntry(provider)
  const providerChanged = model.provider !== provider
  model.provider = provider
  if (providerChanged) {
    model.modelName = providerEntry.defaultModel
    model.baseUrl = providerEntry.defaultBaseUrl
    model.language = providerEntry.defaultLanguage
    model.sampleRate = providerEntry.sampleRate
  } else {
    model.modelName ||= providerEntry.defaultModel
    model.baseUrl ||= providerEntry.defaultBaseUrl
    model.language ||= providerEntry.defaultLanguage
    model.sampleRate ||= providerEntry.sampleRate
  }
  await saveSystemConfigForModel('asr')
  syncModelCard('asr', id)
}

async function activateASRModel(id: string): Promise<void> {
  if (!currentSystemConfig) return
  const previousId = currentSystemConfig.activeASRId
  currentSystemConfig.activeASRId = id
  await saveSystemConfigForModel('asr')
  syncModelCards('asr', [previousId, id])
}

async function deleteASRModel(id: string): Promise<void> {
  if (!currentSystemConfig || currentSystemConfig.asrModels.length <= 1) return
  const previousIds = currentSystemConfig.asrModels.map(model => model.id)
  currentSystemConfig.asrModels = currentSystemConfig.asrModels.filter(m => m.id !== id)
  if (currentSystemConfig.activeASRId === id && currentSystemConfig.asrModels.length > 0) {
    currentSystemConfig.activeASRId = currentSystemConfig.asrModels[0].id
  }
  await saveSystemConfigForModel('asr')
  syncModelCard('asr', id)
  syncModelCards('asr', previousIds.filter(item => item !== id))
}

async function addASRModel(): Promise<void> {
  if (!currentSystemConfig) return
  const newModel: ASRModelConfig = {
    id: generateId(),
    provider: 'qwen',
    modelName: getASRProviderCatalogEntry('qwen').defaultModel,
    apiKey: '',
    baseUrl: getASRProviderCatalogEntry('qwen').defaultBaseUrl,
    language: getASRProviderCatalogEntry('qwen').defaultLanguage,
    sampleRate: getASRProviderCatalogEntry('qwen').sampleRate
  }
  currentSystemConfig.asrModels.push(newModel)
  await saveSystemConfigForModel('asr')
  syncModelCards('asr')
}

// Proxy input handler
proxyInput.addEventListener('change', async () => {
  if (!currentSystemConfig) return
  currentSystemConfig.proxy = proxyInput.value.trim()
  await saveSystemConfig()
})

// Add button handlers
backModelOverviewBtn?.addEventListener('click', closeModelManager)
modelOverviewList.addEventListener('click', (event) => {
  const card = (event.target as HTMLElement | null)?.closest<HTMLElement>('.model-overview-card')
  const kind = card?.dataset.modelKind as ModelManagerKind | undefined
  if (kind) {
    openModelManager(kind)
  }
})
addLLMBtn.addEventListener('click', () => void addLLMModel())
addTaskBtn.addEventListener('click', () => void addTaskModel())
;[
  llmModelsList,
  taskModelsList,
  ttsModelsList,
  asrModelsList
].forEach(bindModelListEvents)
bindPluginsListEvents()
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
      throw new Error(result.error || t('system.checkFailed'))
    }
    renderLocalModels(result.models)
    showPanelNotice(t('system.localModelReady'))
    await refreshSetupReadiness()
  } catch (error: any) {
    showPanelError('Model download failed', error)
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
      await loadSystemConfig(true)
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

document.addEventListener('click', (event) => {
  const target = event.target as Element | null
  if (!target?.closest('#config-provider-floating-menu') && !target?.closest('.config-provider-trigger')) {
    closeProviderMenu()
  }
  if (!target?.closest('#orb-style-floating-menu') && !target?.closest('#orb-style-trigger')) {
    closeOrbStyleMenu()
  }
  if (!target?.closest('#appearance-theme-floating-menu') && !target?.closest('#appearance-theme-trigger')) {
    closeAppearanceThemeMenu()
  }
})

window.addEventListener('online', () => {
  if (document.body.classList.contains('settings-open')) {
    void refreshSystemTelemetry()
  }
})

window.addEventListener('offline', () => {
  if (document.body.classList.contains('settings-open')) {
    void refreshSystemTelemetry()
  }
})

window.addEventListener('resize', () => {
  closeProviderMenu()
  closeOrbStyleMenu()
  closeAppearanceThemeMenu()
})
window.addEventListener('scroll', () => {
  closeProviderMenu()
  closeOrbStyleMenu()
  closeAppearanceThemeMenu()
}, true)

async function initializeApp(): Promise<void> {
  try {
    await revealDevOnlyControls()
    await loadAppVersion()
    await loadSettings()
    await loadPersonalities()
    await loadSystemConfig()
    await loadPluginUISurfaces()
    await refreshSetupReadiness()
    updateConversationButton()
    console.log('Noema Renderer initialized')
  } catch (error) {
    console.error('Failed to initialize app:', error)
  }
}

void initializeApp()
