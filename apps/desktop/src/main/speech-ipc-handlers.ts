/**
 * IPC handlers for speech transcription, streaming ASR, and microphone permissions.
 */
import { shell, systemPreferences, type IpcMain } from 'electron'
import { createSTTProvider } from '@her-text/sdk'
import type { ASRModelConfig } from './settings-store.js'
import { NodeRealtimeWebSocketTransport } from './qwen-websocket-transport.js'
import { ReconnectingWebSocketTransport } from './reconnecting-websocket-transport.js'

type InterruptionReason = 'vad_start' | 'transcript_start' | 'manual' | 'provider_switch'

type StreamingASRSessionLike = {
  start(callbacks: {
    onTranscript: (text: string) => void
    onUserText: (text: string) => Promise<void>
    onStateChange: (state: unknown) => void
    onSpeechStart: () => void
    onInterruption: (reason: InterruptionReason) => void
  }): Promise<void>
  append(samples: number[] | Int16Array): Promise<void>
  stop(): Promise<void>
}

export function registerSpeechIpcHandlers(
  ipcMain: IpcMain,
  options: {
    getASRConfig(): ASRModelConfig | null
    normalizeASRModelName(modelName?: string): string
    getStreamingSession(): StreamingASRSessionLike | null
    createStreamingSession(): StreamingASRSessionLike
    setStreamingSession(session: StreamingASRSessionLike): void
    sendToRenderer(channel: string, ...args: unknown[]): void
    runVoiceConversationTurn(text: string): Promise<void>
    isTaskRunActive(): boolean
    interruptCurrentOutputOnly(options: { closeTTS?: boolean; reason?: InterruptionReason }): Promise<void>
    cancelCurrentTurn(options: { closeTTS?: boolean; reason?: InterruptionReason }): Promise<void>
  }
): void {
  ipcMain.handle('speech:transcribe', async (_, samples: number[]) => {
    try {
      const asrConfig = options.getASRConfig()
      const apiKey = asrConfig?.apiKey?.trim()
      if (!apiKey) {
        throw new Error('QWEN_API_KEY is not configured. Please set it in Settings > System > ASR.')
      }

      const baseTransport = new NodeRealtimeWebSocketTransport()
      const transport = new ReconnectingWebSocketTransport(baseTransport, {
        maxRetries: 3,
        initialRetryDelayMs: 500,
      })
      const asr = createSTTProvider({
        kind: 'qwen-realtime',
        config: {
          apiKey,
          model: options.normalizeASRModelName(asrConfig?.modelName),
          sampleRate: 16000,
          language: 'zh',
        },
        transport,
      })

      try {
        const text = await asr.transcribe(Int16Array.from(samples))
        return { success: true, text }
      } finally {
        await asr.close().catch(() => undefined)
      }
    } catch (error: any) {
      console.error('[Speech] Transcription failed:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('speech:stream:start', async () => {
    try {
      let streamingASRSession = options.getStreamingSession()
      if (!streamingASRSession) {
        streamingASRSession = options.createStreamingSession()
        options.setStreamingSession(streamingASRSession)
      }

      await streamingASRSession.start({
        onTranscript: (text) => {
          options.sendToRenderer('speech:transcript', text)
        },
        onUserText: async (text) => {
          await options.runVoiceConversationTurn(text)
        },
        onStateChange: (state) => {
          options.sendToRenderer('speech:state', state)
        },
        onSpeechStart: () => {
          options.sendToRenderer('speech:user-speaking')
        },
        onInterruption: (reason) => {
          const hasActiveTask = options.isTaskRunActive()
          console.log(`[Speech] Interruption detected, ${hasActiveTask ? 'stopping output only' : 'cancelling turn'}, reason=${reason}`)

          void (hasActiveTask
            ? options.interruptCurrentOutputOnly({ closeTTS: true, reason })
            : options.cancelCurrentTurn({ closeTTS: true, reason }))
        },
      })

      return { success: true }
    } catch (error: any) {
      console.error('[Speech] Failed to start streaming:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.on('speech:stream:append', (_, samples: number[] | Int16Array) => {
    const streamingASRSession = options.getStreamingSession()
    if (!streamingASRSession) {
      console.error('[Speech] Failed to append streaming audio: ASR stream is not started')
      return
    }

    void streamingASRSession.append(samples).catch((error: any) => {
      if (error?.message === 'WebSocket connection aborted' ||
          error?.message === 'Qwen STT WebSocket closed') {
        return
      }
      console.error('[Speech] Failed to append streaming audio:', error)
    })
  })

  ipcMain.handle('speech:stream:stop', async () => {
    try {
      await options.getStreamingSession()?.stop()
      return { success: true }
    } catch (error: any) {
      console.error('[Speech] Failed to stop streaming:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('permissions:getMicrophoneStatus', async () => {
    if (process.platform !== 'darwin') {
      return { success: true, status: 'granted' }
    }

    try {
      return {
        success: true,
        status: systemPreferences.getMediaAccessStatus('microphone'),
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('permissions:requestMicrophone', async () => {
    if (process.platform !== 'darwin') {
      return { success: true, granted: true }
    }

    try {
      const currentStatus = systemPreferences.getMediaAccessStatus('microphone')
      if (currentStatus === 'granted') {
        return { success: true, granted: true, status: currentStatus }
      }

      if (currentStatus === 'denied' || currentStatus === 'restricted') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
        return { success: true, granted: false, status: currentStatus, openedSettings: true }
      }

      const granted = await systemPreferences.askForMediaAccess('microphone')
      return {
        success: true,
        granted,
        status: systemPreferences.getMediaAccessStatus('microphone'),
      }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })
}
