/**
 * Ordered response-side frame pipeline.
 *
 * This covers the middle of the voice path that used to be callback-wired:
 * LLM text deltas -> sentence aggregation -> TTS text input.
 */

import { FramePipeline, type Frame, type FrameProcessor } from './frame-pipeline.js'

export type ResponseFrame = Frame & (
  | { type: 'phase_start'; phase: 'reply' | 'task_result' }
  | { type: 'phase_end'; phase: 'reply' | 'task_result' }
  | { type: 'display_text_delta'; text: string }
  | { type: 'task_start'; taskDescription: string }
  | {
      type: 'task_end'
      result: { success: boolean; summary: string; error?: string }
    }
  | { type: 'llm_text_delta'; text: string }
  | { type: 'llm_text_end' }
  | { type: 'tts_text'; text: string }
  | { type: 'response_interruption' }
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

    if (this.buffer.trim().length >= this.maxChunkChars) {
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
    if (prefix.trim().length < this.minChunkChars) {
      return -1
    }

    const matchRegex = new RegExp('^' + this.sentenceBoundaryRegex.source)
    const matched = trimmed.slice(sentenceBoundary).match(matchRegex)
    if (!matched) {
      return -1
    }

    const boundaryIndex = leadingOffset + sentenceBoundary + matched[0].length
    const candidate = text.slice(0, boundaryIndex).trim()
    if (candidate.length > this.maxChunkChars) {
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

    const limited = Array.from(trimmed).slice(0, this.maxChunkChars).join('')
    const sentenceMatches = [...limited.matchAll(this.sentenceEndingChars)]
    if (sentenceMatches.length > 0) {
      const lastMatch = sentenceMatches[sentenceMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    const clauseMatches = [...limited.matchAll(this.clauseBoundaryChars)]
    if (clauseMatches.length > 0) {
      const lastMatch = clauseMatches[clauseMatches.length - 1]
      const matchIndex = lastMatch.index ?? limited.length - 1
      return leadingOffset + matchIndex + lastMatch[0].length
    }

    return leadingOffset + limited.length
  }
}
