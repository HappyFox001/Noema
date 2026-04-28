const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // 对话相关
  initializeConversation: () =>
    ipcRenderer.invoke('conversation:initialize'),

  sendText: (text, enableTTS) =>
    ipcRenderer.invoke('conversation:sendText', text, enableTTS),

  stopTTS: () =>
    ipcRenderer.invoke('tts:stop'),

  clearHistory: () =>
    ipcRenderer.invoke('conversation:clearHistory'),

  clearProfile: () =>
    ipcRenderer.invoke('profile:clear'),

  startSpeechStream: () =>
    ipcRenderer.invoke('speech:stream:start'),

  appendSpeechStream: (samples) =>
    ipcRenderer.send('speech:stream:append', samples),

  commitSpeechStream: () =>
    ipcRenderer.invoke('speech:stream:commit'),

  stopSpeechStream: () =>
    ipcRenderer.invoke('speech:stream:stop'),

  getMicrophonePermissionStatus: () =>
    ipcRenderer.invoke('permissions:getMicrophoneStatus'),

  requestMicrophonePermission: () =>
    ipcRenderer.invoke('permissions:requestMicrophone'),

  // ========== 记忆管理 API ==========
  getUserProfile: () =>
    ipcRenderer.invoke('memory:getUserProfile'),

  updateUserProfile: (updates) =>
    ipcRenderer.invoke('memory:updateUserProfile', updates),

  addImportantMemory: (key, value) =>
    ipcRenderer.invoke('memory:addImportantMemory', key, value),

  deleteImportantMemory: (key) =>
    ipcRenderer.invoke('memory:deleteImportantMemory', key),

  getConversationSummaries: () =>
    ipcRenderer.invoke('memory:getConversationSummaries'),

  deleteConversationSummary: (id) =>
    ipcRenderer.invoke('memory:deleteConversationSummary', id),

  getWorkingMemory: () =>
    ipcRenderer.invoke('memory:getWorkingMemory'),

  deleteConversationTurn: (id) =>
    ipcRenderer.invoke('memory:deleteConversationTurn', id),

  deleteProfileField: (field) =>
    ipcRenderer.invoke('memory:deleteProfileField', field),

  clearImportantMemories: () =>
    ipcRenderer.invoke('memory:clearImportantMemories'),

  clearConversationSummaries: () =>
    ipcRenderer.invoke('memory:clearConversationSummaries'),

  clearWorkingMemory: () =>
    ipcRenderer.invoke('memory:clearWorkingMemory'),

  // SDK 功能
  getPersonality: () =>
    ipcRenderer.invoke('sdk:getPersonality'),

  getStats: () =>
    ipcRenderer.invoke('sdk:getStats'),

  getSettings: () =>
    ipcRenderer.invoke('settings:get'),

  updateSettings: (partial) =>
    ipcRenderer.invoke('settings:update', partial),

  resetSystemConfigFromEnv: () =>
    ipcRenderer.invoke('settings:resetSystemFromEnv'),

  listPersonalities: () =>
    ipcRenderer.invoke('personality:list'),

  setPersonality: (name) =>
    ipcRenderer.invoke('personality:set', name),

  addPersonalityFile: () =>
    ipcRenderer.invoke('personality:addFile'),

  // 事件监听
  // TTS 音频事件（带上下文 ID）
  onTTSAudio: (callback) => {
    ipcRenderer.on('tts:audio', (_, { contextId, data }) => {
      callback(new Uint8Array(data), contextId)
    })
  },

  onTTSConnected: (callback) => {
    ipcRenderer.on('tts:connected', (_, contextId) => callback(contextId))
  },

  // TTS 上下文管理
  onTTSContextStart: (callback) => {
    ipcRenderer.on('tts:contextStart', (_, contextId) => callback(contextId))
  },

  onTTSContextInvalidated: (callback) => {
    ipcRenderer.on('tts:contextInvalidated', (_, contextId) => callback(contextId))
  },

  onTTSClosed: (callback) => {
    ipcRenderer.on('tts:closed', callback)
  },

  onTTSError: (callback) => {
    ipcRenderer.on('tts:error', (_, error) => callback(error))
  },

  onConversationResponse: (callback) => {
    ipcRenderer.on('conversation:response', (_, text) => callback(text))
  },

  onConversationFrame: (callback) => {
    ipcRenderer.on('conversation:frame', (_, frame) => callback(frame))
  },

  // 语音识别事件 (VAD 在 Main Process 处理)
  onSpeechTranscript: (callback) => {
    ipcRenderer.on('speech:transcript', (_, text) => callback(text))
  },

  onSpeechState: (callback) => {
    ipcRenderer.on('speech:state', (_, state) => callback(state))
  },

  onSpeechError: (callback) => {
    ipcRenderer.on('speech:error', (_, error) => callback(error))
  },

  onUserSpeaking: (callback) => {
    ipcRenderer.on('speech:user-speaking', callback)
  },

  // WebSocket 重连事件
  onSpeechReconnecting: (callback) => {
    ipcRenderer.on('speech:reconnecting', callback)
  },

  onSpeechReconnected: (callback) => {
    ipcRenderer.on('speech:reconnected', callback)
  },

  onSpeechConnectionFailed: (callback) => {
    ipcRenderer.on('speech:connectionFailed', callback)
  },

  // 打断事件（用户在机器人说话时开始说话）
  onInterruption: (callback) => {
    ipcRenderer.on('speech:interruption', (_, turnId) => callback(turnId))
  },

  // 新轮次开始
  onTurnStart: (callback) => {
    ipcRenderer.on('turn:start', (_, turnId) => callback(turnId))
  },

  // 播放完成同步（用于 Phase 之间的音频同步）
  onPlaybackWaitRequest: (callback) => {
    ipcRenderer.on('playback:waitRequest', (_, requestId) => callback(requestId))
  },

  notifyPlaybackComplete: (requestId) => {
    ipcRenderer.send('playback:complete', requestId)
  },

  // 延迟追踪
  notifyFirstAudioPlay: () => {
    ipcRenderer.send('latency:firstAudioPlay')
  },

  onLatencyData: (callback) => {
    ipcRenderer.on('latency:data', (_, data) => callback(data))
  },

  // 窗口控制
  moveWindow: (deltaX, deltaY) => {
    ipcRenderer.send('window:move', deltaX, deltaY)
  },

  getWindowPosition: () => {
    return ipcRenderer.invoke('window:get-position')
  },
})
