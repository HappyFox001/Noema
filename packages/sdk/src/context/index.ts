import type { ConversationTurn } from '@her-text/types'

export interface ResponseItem {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  timestamp: number
  toolCalls?: any[]
  toolResults?: any[]
}

export interface TokenUsageInfo {
  inputTokens: number
  outputTokens: number
  totalTokens: number
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

/**
 * Context Manager - 管理对话历史和上下文截断
 * 参考 codex /core/src/context_manager/history.rs
 */
export class ContextManager {
  private items: ResponseItem[] = []
  private historyVersion: number = 0
  private tokenInfo: TokenUsageInfo = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  }

  /**
   * 记录新项目（应用截断策略）
   */
  recordItems(items: ResponseItem[], policy?: TruncationPolicy): void {
    this.items.push(...items)
    this.historyVersion++

    if (policy) {
      this.applyTruncation(policy)
    }
  }

  /**
   * 获取用于 prompt 的历史（应用规范化）
   */
  forPrompt(inputModalities: InputModality[] = [{ type: 'text' }]): ResponseItem[] {
    // 规范化：
    // 1. 移除纯图像内容（如果不支持）
    // 2. 清理空的工具调用对
    // 3. 确保交替的用户/助手消息

    const normalized = this.items.filter(item => {
      // 如果不支持图像，跳过图像内容
      const supportsImages = inputModalities.some(m => m.type === 'image')
      if (!supportsImages && this.containsImages(item)) {
        return false
      }
      return true
    })

    return this.ensureAlternating(normalized)
  }

  /**
   * 估算 token 数量（简单估算：1 token ≈ 4 字符）
   */
  estimateTokenCount(): number {
    let total = 0
    for (const item of this.items) {
      total += Math.ceil(item.content.length / 4)
    }
    return total
  }

  /**
   * 移除首项（长文本优化）
   */
  removeFirstItem(): void {
    if (this.items.length > 0) {
      this.items.shift()
      this.historyVersion++
    }
  }

  /**
   * 移除末项（错误恢复）
   */
  removeLastItem(): boolean {
    if (this.items.length > 0) {
      this.items.pop()
      this.historyVersion++
      return true
    }
    return false
  }

  /**
   * 获取所有项目
   */
  getItems(): ResponseItem[] {
    return [...this.items]
  }

  /**
   * 获取历史版本号
   */
  getHistoryVersion(): number {
    return this.historyVersion
  }

  /**
   * 更新 token 使用信息
   */
  updateTokenInfo(info: Partial<TokenUsageInfo>): void {
    this.tokenInfo = {
      ...this.tokenInfo,
      ...info
    }
  }

  /**
   * 获取 token 使用信息
   */
  getTokenInfo(): TokenUsageInfo {
    return { ...this.tokenInfo }
  }

  /**
   * 清空历史
   */
  clear(): void {
    this.items = []
    this.historyVersion++
  }

  // ========== 私有方法 ==========

  private applyTruncation(policy: TruncationPolicy): void {
    // 1. 按 token 数截断
    if (policy.maxTokens) {
      while (this.estimateTokenCount() > policy.maxTokens && this.items.length > 0) {
        // 保留系统消息
        if (policy.preserveSystemMessages && this.items[0].role === 'system') {
          // 移除第二项
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

    // 2. 按轮次数截断
    if (policy.maxTurns && this.items.length > policy.maxTurns) {
      const preserveCount = policy.preserveRecentTurns || 0
      const removeCount = this.items.length - policy.maxTurns

      // 从中间移除（保留最近的）
      const startIndex = policy.preserveSystemMessages ? 1 : 0
      this.items.splice(startIndex, removeCount)
      this.historyVersion++
    }
  }

  private containsImages(item: ResponseItem): boolean {
    // TODO: 实现图像检测逻辑
    return false
  }

  private ensureAlternating(items: ResponseItem[]): ResponseItem[] {
    // 确保用户和助手消息交替
    const result: ResponseItem[] = []
    let lastRole: string | null = null

    for (const item of items) {
      if (item.role === 'system' || item.role === 'tool') {
        result.push(item)
        continue
      }

      // 跳过连续的相同角色
      if (item.role === lastRole) {
        continue
      }

      result.push(item)
      lastRole = item.role
    }

    return result
  }
}
