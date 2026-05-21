/**
 * Ordered response-side frame pipeline.
 *
 * This covers the middle of the voice path that used to be callback-wired:
 * LLM text deltas -> sentence aggregation -> TTS text input.
 */

import { FramePipeline, type Frame, type FrameProcessor } from './frame-pipeline.js'
import type { TTSProvider } from './providers.js'
import type { InterruptionReason } from '../turn/types.js'
import type { ExpressionFrame, PluginRuntimeContext } from '../plugins/index.js'

export type ResponseFrame = Frame & (
  | { type: 'phase_start'; phase: 'reply' | 'task_progress' | 'task_result' }
  | { type: 'phase_end'; phase: 'reply' | 'task_progress' | 'task_result' }
  | { type: 'display_text_delta'; text: string }
  | { type: 'task_start'; taskDescription: string }
  | {
      type: 'task_end'
      result: { success: boolean; summary: string; error?: string }
    }
  | { type: 'llm_text_delta'; text: string }
  | { type: 'llm_text_end' }
  | { type: 'tts_text'; text: string }
  | { type: 'response_interruption'; reason: InterruptionReason }
  | { type: 'user_text'; text: string; turnId: number }
)

export type ResponseFrameProcessor = FrameProcessor<ResponseFrame>

export class ResponseFramePipeline extends FramePipeline<ResponseFrame> {}

export interface SentenceAggregatorOptions {
  minChunkChars?: number
  maxChunkChars?: number
  emit: (text: string) => void
}

export class SentenceAggregatorProcessor implements ResponseFrameProcessor {
  private buffer = ''
  private readonly minChunkChars: number
  private readonly maxChunkChars: number
  private readonly emit: (text: string) => void
  private readonly sentenceBoundaryRegex = /[。！？.!?〜]["'"'」』）)\]】〕]*\s*/
  private readonly sentenceEndingChars = /[。！？.!?〜]/g
  private readonly clauseBoundaryChars = /[，、,；：;:・ー]/g

  constructor(options: SentenceAggregatorOptions) {
    this.minChunkChars = options.minChunkChars ?? 10
    this.maxChunkChars = options.maxChunkChars ?? 30
    this.emit = options.emit
  }

  async processFrame(frame: ResponseFrame): Promise<void> {
    if (frame.type === 'response_interruption') {
      this.buffer = ''
      return
    }

    if (frame.type === 'llm_text_delta') {
      this.buffer += frame.text
      await this.flushAvailableChunks()
      return
    }

    if (frame.type === 'llm_text_end') {
      await this.flushRemaining()
    }
  }

  private async flushAvailableChunks(): Promise<void> {
    while (true) {
      const boundaryIndex = this.findBoundaryIndex(this.buffer)
      if (boundaryIndex === -1) {
        break
      }

      const candidate = this.buffer.slice(0, boundaryIndex).trim()
      this.buffer = this.buffer.slice(boundaryIndex)
      if (candidate) {
        this.emit(candidate)
      }
    }

    if (countSpokenChars(this.buffer.trim()) >= this.maxChunkChars) {
      const splitIndex = this.findForcedBoundaryIndex(this.buffer)
      const candidate = this.buffer.slice(0, splitIndex).trim()
      this.buffer = this.buffer.slice(splitIndex)
      if (candidate) {
        this.emit(candidate)
      }
    }
  }

  private async flushRemaining(): Promise<void> {
    const candidate = this.buffer.trim()
    this.buffer = ''
    if (candidate) {
      this.emit(candidate)
    }
  }

  private findBoundaryIndex(text: string): number {
    const trimmed = text.trimStart()
    const leadingOffset = text.length - trimmed.length
    if (!trimmed) {
      return -1
    }

    const sentenceBoundary = trimmed.search(this.sentenceBoundaryRegex)
    if (sentenceBoundary === -1) {
      return -1
    }

    const prefix = trimmed.slice(0, sentenceBoundary)
    if (countSpokenChars(prefix.trim()) < this.minChunkChars) {
      return -1
    }

    const matchRegex = new RegExp('^' + this.sentenceBoundaryRegex.source)
    const matched = trimmed.slice(sentenceBoundary).match(matchRegex)
    if (!matched) {
      return -1
    }

    const boundaryIndex = leadingOffset + sentenceBoundary + matched[0].length
    const candidate = text.slice(0, boundaryIndex).trim()
    if (countSpokenChars(candidate) > this.maxChunkChars) {
      return this.findForcedBoundaryIndex(text)
    }

    return boundaryIndex
  }

  private findForcedBoundaryIndex(text: string): number {
    const trimmed = text.trimStart()
    const leadingOffset = text.length - trimmed.length
    if (!trimmed) {
      return text.length
    }

    const limited = sliceBySpokenChars(trimmed, this.maxChunkChars)
    const sentenceMatches = [...limited.matchAll(this.sentenceEndingChars)]
      .filter(match => !isInsideSquareTag(trimmed, match.index ?? 0))
    if (sentenceMatches.length > 0) {
      const lastMatch = sentenceMatches[sentenceMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    const clauseMatches = [...limited.matchAll(this.clauseBoundaryChars)]
      .filter(match => !isInsideSquareTag(trimmed, match.index ?? 0))
    if (clauseMatches.length > 0) {
      const lastMatch = clauseMatches[clauseMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    const tagCloseIndex = findSquareTagCloseAfter(trimmed, limited.length - 1)
    if (tagCloseIndex !== -1) {
      return leadingOffset + tagCloseIndex + 1
    }

    return leadingOffset + limited.length
  }
}

export type ResponseTTSService = Pick<TTSProvider, 'startStreaming' | 'pushText' | 'finishStreaming' | 'close'>

export interface ResponseTTSProcessorOptions {
  isCancelled: () => boolean
  isEnabled: () => boolean
  getService: () => ResponseTTSService | null
  sanitizeText?: (text: string) => string
  transformTTSInput?: (text: string) => string
  toDisplayText?: (ttsText: string) => string
  onFirstText?: () => void
  onText?: (ttsText: string, displayText: string) => void
  onError?: (error: Error) => void
  waitForPlayback?: (phase: 'reply' | 'task_progress' | 'task_result') => Promise<void>
  log?: (message: string) => void
}

export class ResponseTTSProcessor implements ResponseFrameProcessor {
  private firstText = true
  private buffer = ''
  private readonly minChunkChars = 10
  private readonly maxChunkChars = 30
  private readonly sentenceBoundaryRegex = /[。！？.!?〜]["'"'」』）)\]】〕]*\s*/
  private readonly sentenceEndingChars = /[。！？.!?〜]/g
  private readonly clauseBoundaryChars = /[，、,；：;:・ー]/g

  constructor(private readonly options: ResponseTTSProcessorOptions) {}

  async processFrame(frame: ResponseFrame, context: { signal: AbortSignal }): Promise<void> {
    if (frame.type === 'response_interruption') {
      this.firstText = true
      this.buffer = ''
      return
    }

    if (this.options.isCancelled() || context.signal.aborted) {
      return
    }

    if (frame.type === 'phase_start') {
      await this.startStreaming(context.signal)
      return
    }

    if (frame.type === 'tts_text') {
      await this.pushText(frame.text, context.signal)
      return
    }

    if (frame.type === 'llm_text_delta') {
      this.buffer += frame.text
      await this.flushAvailableChunks(context.signal)
      return
    }

    if (frame.type === 'llm_text_end') {
      await this.flushRemaining(context.signal)
      return
    }

    if (frame.type === 'phase_end') {
      await this.finishStreaming(frame.phase, context.signal)
    }
  }

  private async startStreaming(signal: AbortSignal): Promise<void> {
    const service = this.options.getService()
    if (!this.options.isEnabled() || !service || signal.aborted) {
      return
    }

    try {
      await service.startStreaming()
    } catch (error: any) {
      this.options.log?.(`[TTS] Failed to start streaming: ${error.message}`)
      this.options.onError?.(error)
      await service.close().catch(() => undefined)
    }
  }

  private async pushText(text: string, signal: AbortSignal): Promise<void> {
    const service = this.options.getService()
    if (!this.options.isEnabled() || !service || signal.aborted) {
      return
    }

    const sanitizedText = this.options.sanitizeText?.(text) ?? text.trim()
    const ttsText = this.options.transformTTSInput?.(sanitizedText) ?? sanitizedText
    if (!ttsText) {
      return
    }

    try {
      if (this.firstText) {
        this.firstText = false
        this.options.onFirstText?.()
      }

      const displayText = this.options.toDisplayText?.(ttsText) ?? ttsText
      this.options.onText?.(ttsText, displayText)
      await service.pushText(ttsText)
    } catch (error: any) {
      this.options.log?.(`[TTS] Failed to push text frame: ${error.message}`)
      this.options.onError?.(error)
    }
  }

  private async finishStreaming(
    phase: 'reply' | 'task_progress' | 'task_result',
    signal: AbortSignal
  ): Promise<void> {
    const service = this.options.getService()
    if (!this.options.isEnabled() || !service || signal.aborted) {
      return
    }

    try {
      await service.finishStreaming()
    } catch (error: any) {
      this.options.log?.(`[TTS] Failed to finish streaming: ${error.message}`)
      this.options.onError?.(error)
      return
    }

    if (signal.aborted || this.options.isCancelled()) {
      return
    }

    await this.options.waitForPlayback?.(phase)
  }

  private async flushAvailableChunks(signal: AbortSignal): Promise<void> {
    while (true) {
      const boundaryIndex = this.findBoundaryIndex(this.buffer)
      if (boundaryIndex === -1) {
        break
      }

      const candidate = this.buffer.slice(0, boundaryIndex).trim()
      if (this.hasUnclosedTTSCue(candidate)) {
        break
      }

      this.buffer = this.buffer.slice(boundaryIndex)
      if (candidate) {
        await this.pushText(candidate, signal)
      }
    }

    if (countSpokenChars(this.buffer.trim()) >= this.maxChunkChars) {
      const splitIndex = this.findForcedBoundaryIndex(this.buffer)
      const candidate = this.buffer.slice(0, splitIndex).trim()
      if (this.hasUnclosedTTSCue(candidate)) {
        return
      }

      this.buffer = this.buffer.slice(splitIndex)
      if (candidate) {
        await this.pushText(candidate, signal)
      }
    }
  }

  private async flushRemaining(signal: AbortSignal): Promise<void> {
    const candidate = this.buffer.trim()
    this.buffer = ''
    if (candidate) {
      await this.pushText(candidate, signal)
    }
  }

  private findBoundaryIndex(text: string): number {
    const trimmed = text.trimStart()
    const leadingOffset = text.length - trimmed.length
    if (!trimmed) {
      return -1
    }

    const sentenceBoundary = trimmed.search(this.sentenceBoundaryRegex)
    if (sentenceBoundary === -1) {
      return -1
    }

    const prefix = trimmed.slice(0, sentenceBoundary)
    if (countSpokenChars(prefix.trim()) < this.minChunkChars) {
      return -1
    }

    const matchRegex = new RegExp('^' + this.sentenceBoundaryRegex.source)
    const matched = trimmed.slice(sentenceBoundary).match(matchRegex)
    if (!matched) {
      return -1
    }

    const boundaryIndex = leadingOffset + sentenceBoundary + matched[0].length
    const candidate = text.slice(0, boundaryIndex).trim()
    if (countSpokenChars(candidate) > this.maxChunkChars) {
      return this.findForcedBoundaryIndex(text)
    }

    return boundaryIndex
  }

  private findForcedBoundaryIndex(text: string): number {
    const trimmed = text.trimStart()
    const leadingOffset = text.length - trimmed.length
    if (!trimmed) {
      return text.length
    }

    const limited = sliceBySpokenChars(trimmed, this.maxChunkChars)
    const sentenceMatches = [...limited.matchAll(this.sentenceEndingChars)]
      .filter(match => !isInsideSquareTag(trimmed, match.index ?? 0))
    if (sentenceMatches.length > 0) {
      const lastMatch = sentenceMatches[sentenceMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    const clauseMatches = [...limited.matchAll(this.clauseBoundaryChars)]
      .filter(match => !isInsideSquareTag(trimmed, match.index ?? 0))
    if (clauseMatches.length > 0) {
      const lastMatch = clauseMatches[clauseMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    const tagCloseIndex = findSquareTagCloseAfter(trimmed, limited.length - 1)
    if (tagCloseIndex !== -1) {
      return leadingOffset + tagCloseIndex + 1
    }

    return leadingOffset + limited.length
  }

  private hasUnclosedTTSCue(text: string): boolean {
    return getOpenSquareTagClose(text, text.length - 1) !== null
  }
}

function isInsideSquareTag(text: string, index: number): boolean {
  return getOpenSquareTagClose(text, index) !== null
}

function countSpokenChars(text: string): number {
  let count = 0
  let expectedClose: string | null = null

  for (const char of Array.from(text)) {
    if (!expectedClose && char === '[') {
      expectedClose = ']'
      continue
    }
    if (!expectedClose && char === '【') {
      expectedClose = '】'
      continue
    }
    if (!expectedClose && char === '［') {
      expectedClose = '］'
      continue
    }
    if (expectedClose) {
      if (char === expectedClose) {
        expectedClose = null
      }
      continue
    }

    if (char.trim()) {
      count += 1
    }
  }

  return count
}

function sliceBySpokenChars(text: string, maxSpokenChars: number): string {
  let spokenChars = 0
  let expectedClose: string | null = null
  let endIndex = 0

  for (const char of Array.from(text)) {
    endIndex += char.length

    if (!expectedClose && char === '[') {
      expectedClose = ']'
      continue
    }
    if (!expectedClose && char === '【') {
      expectedClose = '】'
      continue
    }
    if (!expectedClose && char === '［') {
      expectedClose = '］'
      continue
    }
    if (expectedClose) {
      if (char === expectedClose) {
        expectedClose = null
      }
      continue
    }

    if (char.trim()) {
      spokenChars += 1
    }
    if (spokenChars >= maxSpokenChars) {
      return text.slice(0, endIndex)
    }
  }

  return text.slice(0, Math.max(endIndex, text.length))
}

function findSquareTagCloseAfter(text: string, index: number): number {
  const close = getOpenSquareTagClose(text, index)
  if (!close) {
    return -1
  }

  return text.indexOf(close, index + 1)
}

function getOpenSquareTagClose(text: string, index: number): string | null {
  let expectedClose: string | null = null
  for (let i = 0; i <= index && i < text.length; i += 1) {
    const char = text[i]
    if (char === '[') {
      expectedClose = ']'
      continue
    }
    if (char === '【') {
      expectedClose = '】'
      continue
    }
    if (char === '［') {
      expectedClose = '］'
      continue
    }
    if (expectedClose && char === expectedClose) {
      expectedClose = null
    }
  }

  return expectedClose
}

export interface ResponseDisplayProcessorOptions {
  isCancelled: () => boolean
  startPhase: (phase: 'reply' | 'task_progress' | 'task_result') => void
  endPhase: (phase: 'reply' | 'task_progress' | 'task_result') => Promise<void> | void
  pushTextDelta: (text: string) => void
  startTask: (taskDescription: string) => void
  endTask: (result: { success: boolean; summary: string; error?: string }) => void
}

export class ResponseDisplayProcessor implements ResponseFrameProcessor {
  constructor(private readonly options: ResponseDisplayProcessorOptions) {}

  async processFrame(frame: ResponseFrame, context: { signal: AbortSignal }): Promise<void> {
    if (this.options.isCancelled() || context.signal.aborted) {
      return
    }

    switch (frame.type) {
      case 'phase_start':
        this.options.startPhase(frame.phase)
        return
      case 'phase_end':
        await this.options.endPhase(frame.phase)
        return
      case 'display_text_delta':
        this.options.pushTextDelta(frame.text)
        return
      case 'task_start':
        this.options.startTask(frame.taskDescription)
        return
      case 'task_end':
        this.options.endTask(frame.result)
        return
    }
  }
}

export interface LLMStreamBridgeOptions {
  queueFrame: (frame: ResponseFrame) => Promise<void> | void
  isCancelled: () => boolean
  shouldUseTTS: () => boolean
  onFirstToken?: () => void
  log?: (message: string) => void
}

export class LLMStreamBridgeProcessor {
  private firstToken = true

  constructor(private readonly options: LLMStreamBridgeOptions) {}

  async onPhaseStart(phase: 'reply' | 'task_progress' | 'task_result'): Promise<void> {
    if (this.options.isCancelled()) {
      this.options.log?.(`[Turn] Phase start skipped - turn cancelled`)
      return
    }

    await this.options.queueFrame({
      type: 'phase_start',
      kind: 'control',
      phase,
      timestamp: Date.now(),
    })
  }

  async onTextDelta(delta: string): Promise<void> {
    if (!delta || this.options.isCancelled()) {
      return
    }

    if (this.firstToken) {
      this.firstToken = false
      this.options.onFirstToken?.()
    }

    await this.options.queueFrame({
      type: this.options.shouldUseTTS() ? 'llm_text_delta' : 'display_text_delta',
      kind: 'data',
      text: delta,
      timestamp: Date.now(),
    })
  }

  async onPhaseEnd(phase: 'reply' | 'task_progress' | 'task_result'): Promise<void> {
    if (this.options.isCancelled()) {
      this.options.log?.(`[Turn] Phase end skipped - turn cancelled`)
      return
    }

    await this.options.queueFrame({
      type: 'llm_text_end',
      kind: 'control',
      timestamp: Date.now(),
    })
    await this.options.queueFrame({
      type: 'phase_end',
      kind: 'control',
      phase,
      timestamp: Date.now(),
    })
  }

  async onTaskStart(taskDescription: string): Promise<void> {
    if (this.options.isCancelled()) {
      return
    }

    await this.options.queueFrame({
      type: 'task_start',
      kind: 'control',
      taskDescription,
      timestamp: Date.now(),
    })
  }

  async onTaskEnd(result: { success: boolean; summary: string; error?: string }): Promise<void> {
    if (this.options.isCancelled()) {
      return
    }

    await this.options.queueFrame({
      type: 'task_end',
      kind: 'control',
      result,
      timestamp: Date.now(),
    })
  }
}

export interface LLMChatStreamService {
  chatStream(
    input: { text: string; timestamp: number },
    options: {
      signal?: AbortSignal
      isCancelled?: () => boolean
      preserveUserInputOnAbort?: boolean
      getInterruptedAssistantText?: () => string | undefined
      pluginContext?: PluginRuntimeContext
      onPhaseStart?: (phase: 'reply' | 'task_progress' | 'task_result') => Promise<void> | void
      onDisplayChunk?: (
        phase: 'reply' | 'task_progress' | 'task_result',
        delta: string,
        fullText: string
      ) => Promise<void> | void
      onPhaseEnd?: (
        phase: 'reply' | 'task_progress' | 'task_result',
        fullText: string
      ) => Promise<void> | void
      onTaskStart?: (taskDescription: string) => Promise<void> | void
      onTaskEnd?: (result: { success: boolean; summary: string; error?: string }) => Promise<void> | void
      onExpression?: (frame: ExpressionFrame) => Promise<void> | void
    }
  ): AsyncGenerator<string>
}

export interface LLMResponseProcessorOptions {
  service: LLMChatStreamService
  bridge: LLMStreamBridgeProcessor
  signal?: AbortSignal
  isCancelled?: () => boolean
  preserveUserInputOnAbort?: boolean
  getInterruptedAssistantText?: () => string | undefined
  pluginContext?: PluginRuntimeContext
  queueFrame?: (frame: ResponseFrame) => Promise<void> | void
  waitForIdle?: () => Promise<void>
  onComplete?: (result: { text: string; error?: Error }) => void
  onTaskStart?: (taskDescription: string) => Promise<void> | void
  onTaskEnd?: (result: { success: boolean; summary: string; error?: string }) => Promise<void> | void
  onExpression?: (frame: ExpressionFrame) => Promise<void> | void
  log?: (message: string) => void
}

export class LLMResponseProcessor implements ResponseFrameProcessor {
  constructor(private readonly options: LLMResponseProcessorOptions) {}

  async processFrame(frame: ResponseFrame, context: { signal: AbortSignal }): Promise<void> {
    if (frame.type === 'response_interruption') {
      await this.emitInterruption(frame.reason)
      return
    }

    if (frame.type !== 'user_text' || context.signal.aborted) {
      return
    }

    try {
      const text = await this.processUserText(frame.text)
      this.options.onComplete?.({ text })
    } catch (error: any) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      this.options.onComplete?.({ text: '', error: normalizedError })
      throw normalizedError
    }
  }

  async processUserText(text: string): Promise<string> {
    if (this.options.signal?.aborted) {
      await this.emitInterruption('manual')
      return ''
    }

    let signalAbortHandler: (() => void) | null = null
    if (this.options.signal) {
      signalAbortHandler = () => {
        void this.emitInterruption('manual')
      }
      this.options.signal.addEventListener('abort', signalAbortHandler, { once: true })
    }

    const responseStream = this.options.service.chatStream(
      {
        text,
        timestamp: Date.now(),
      },
      {
        signal: this.options.signal,
        isCancelled: this.options.isCancelled,
        preserveUserInputOnAbort: this.options.preserveUserInputOnAbort,
        getInterruptedAssistantText: this.options.getInterruptedAssistantText,
        pluginContext: this.options.pluginContext,
        onPhaseStart: async (phase) => {
          await this.options.bridge.onPhaseStart(phase)
        },
        onDisplayChunk: async (_, delta) => {
          await this.options.bridge.onTextDelta(delta)
        },
        onPhaseEnd: async (phase) => {
          this.options.log?.(`[Conversation] Phase "${phase}" ending...`)
          await this.options.bridge.onPhaseEnd(phase)
          await this.options.waitForIdle?.()
        },
        onTaskStart: async (taskDescription) => {
          await this.options.onTaskStart?.(taskDescription)
          await this.options.bridge.onTaskStart(taskDescription)
        },
        onTaskEnd: async (result) => {
          await this.options.onTaskEnd?.(result)
          await this.options.bridge.onTaskEnd(result)
        },
        onExpression: async (frame) => {
          await this.options.onExpression?.(frame)
        },
      }
    )

    let fullResponse = ''
    try {
      for await (const chunk of responseStream) {
        fullResponse += chunk
      }
    } finally {
      if (this.options.signal && signalAbortHandler) {
        this.options.signal.removeEventListener('abort', signalAbortHandler)
      }
    }

    return fullResponse
  }

  private async emitInterruption(reason: InterruptionReason): Promise<void> {
    await this.options.queueFrame?.({
      type: 'response_interruption',
      kind: 'system',
      reason,
      timestamp: Date.now(),
    })
  }
}
