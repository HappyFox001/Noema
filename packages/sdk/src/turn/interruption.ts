/**
 * 打断管理器
 * 移植自 Pipecat 的 InterruptionFrame 处理逻辑
 *
 * 打断（Interruption）是指用户在机器人说话时开始说话的情况。
 * 当检测到打断时，需要：
 * 1. 停止当前 TTS 播放
 * 2. 清空待播放的音频队列
 * 3. 取消正在进行的 LLM 请求
 * 4. 重置相关状态
 */

import { InterruptionHandler } from './types.js'

/**
 * 打断管理器
 *
 * 管理所有需要响应打断的处理器，当打断发生时并行触发所有处理器。
 *
 * 使用示例：
 * ```typescript
 * const manager = new InterruptionManager()
 *
 * // 注册 TTS 处理器
 * manager.register({
 *   async onInterruption() {
 *     await tts.stop()
 *     tts.clearQueue()
 *   }
 * })
 *
 * // 注册 LLM 处理器
 * manager.register({
 *   async onInterruption() {
 *     abortController.abort()
 *   }
 * })
 *
 * // 触发打断
 * await manager.triggerInterruption()
 * ```
 */
export class InterruptionManager {
  private handlers: Set<InterruptionHandler> = new Set()
  private _isInterrupted = false

  /**
   * 注册打断处理器
   * @param handler - 打断处理器
   */
  register(handler: InterruptionHandler): void {
    this.handlers.add(handler)
  }

  /**
   * 注销打断处理器
   * @param handler - 要注销的处理器
   */
  unregister(handler: InterruptionHandler): void {
    this.handlers.delete(handler)
  }

  /**
   * 清除所有处理器
   */
  clear(): void {
    this.handlers.clear()
  }

  /**
   * 触发打断
   * 并行调用所有注册的处理器
   */
  async triggerInterruption(): Promise<void> {
    if (this._isInterrupted) {
      // 已经在处理打断中，避免重复触发
      return
    }

    this._isInterrupted = true

    const handlers = Array.from(this.handlers)

    if (handlers.length === 0) {
      this._isInterrupted = false
      return
    }

    try {
      // 并行触发所有处理器，捕获错误但不中断其他处理器
      const results = await Promise.allSettled(
        handlers.map((handler) => handler.onInterruption())
      )

      // 记录任何失败的处理器
      for (let i = 0; i < results.length; i++) {
        const result = results[i]
        if (result.status === 'rejected') {
          console.error(
            `Interruption handler failed:`,
            result.reason
          )
        }
      }
    } finally {
      this._isInterrupted = false
    }
  }

  /**
   * 重置打断状态
   * 在新的轮次开始时调用
   */
  reset(): void {
    this._isInterrupted = false
  }

  /**
   * 是否正在处理打断
   */
  get isInterrupted(): boolean {
    return this._isInterrupted
  }

}
