import type { ConversationTurn } from '@her-text/types'

export interface ResponseItem {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolCalls?: any[]
  toolResults?: any[]
}

export interface TruncationPolicy {
  maxTokens?: number
  maxTurns?: number
  preserveSystemMessages?: boolean
  preserveRecentTurns?: number
}

export interface InputModality {
  type: 'text' | 'image' | 'audio'
}

export interface ContextCheckpoint {
  items: ResponseItem[]
  historyVersion: number
}


export class ContextManager {
  private items: ResponseItem[] = []
  private historyVersion: number = 0

  
  recordItems(items: ResponseItem[], policy?: TruncationPolicy): void {
    this.items.push(...items)
    this.historyVersion++

    if (policy) {
      this.applyTruncation(policy)
    }
  }

  
  forPrompt(inputModalities: InputModality[] = [{ type: 'text' }]): ResponseItem[] {

    const normalized = this.items.filter(item => {
      const supportsImages = inputModalities.some(m => m.type === 'image')
      if (!supportsImages && this.containsImages(item)) {
        return false
      }
      return true
    })

    return this.ensureAlternating(normalized)
  }

  
  estimateTokenCount(): number {
    let total = 0
    for (const item of this.items) {
      total += Math.ceil(item.content.length / 4)
    }
    return total
  }

  
  removeFirstItem(): void {
    if (this.items.length > 0) {
      this.items.shift()
      this.historyVersion++
    }
  }

  
  getItems(): ResponseItem[] {
    return [...this.items]
  }

  
  getHistoryVersion(): number {
    return this.historyVersion
  }

  
  createCheckpoint(): ContextCheckpoint {
    return {
      items: this.items.map(item => ({ ...item })),
      historyVersion: this.historyVersion,
    }
  }

  
  restoreCheckpoint(checkpoint: ContextCheckpoint): void {
    this.items = checkpoint.items.map(item => ({ ...item }))
    this.historyVersion = checkpoint.historyVersion + 1
  }

  
  clear(): void {
    this.items = []
    this.historyVersion++
  }


  private applyTruncation(policy: TruncationPolicy): void {
    if (policy.maxTokens) {
      while (this.estimateTokenCount() > policy.maxTokens && this.items.length > 0) {
        if (policy.preserveSystemMessages && this.items[0].role === 'system') {
          if (this.items.length > 1) {
            this.items.splice(1, 1)
          } else {
            break
          }
        } else {
          this.removeFirstItem()
        }
      }
    }

    if (policy.maxTurns && this.items.length > policy.maxTurns) {
      const preserveCount = policy.preserveRecentTurns || 0
      const removeCount = this.items.length - policy.maxTurns

      const startIndex = policy.preserveSystemMessages ? 1 : 0
      this.items.splice(startIndex, removeCount)
      this.historyVersion++
    }
  }

  private containsImages(item: ResponseItem): boolean {
    return false
  }

  private ensureAlternating(items: ResponseItem[]): ResponseItem[] {
    // OpenAI-compatible chat APIs allow consecutive messages with the same role.
    // Dropping them is unsafe for voice: rapid user turns or interruption turns
    // can legitimately create consecutive user messages.
    return items
  }
}
