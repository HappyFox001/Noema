const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
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

  stopSpeechStream: () =>
    ipcRenderer.invoke('speech:stream:stop'),

  getMicrophonePermissionStatus: () =>
    ipcRenderer.invoke('permissions:getMicrophoneStatus'),

  requestMicrophonePermission: () =>
    ipcRenderer.invoke('permissions:requestMicrophone'),

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

  listAccountInputs: () =>
    ipcRenderer.invoke('memory:listAccountInputs'),

  deleteAccountInput: (key) =>
    ipcRenderer.invoke('memory:deleteAccountInput', key),

  clearAccountInputs: () =>
    ipcRenderer.invoke('memory:clearAccountInputs'),

  getPersonality: () =>
    ipcRenderer.invoke('sdk:getPersonality'),

  getStats: () =>
    ipcRenderer.invoke('sdk:getStats'),

  getSettings: () =>
    ipcRenderer.invoke('settings:get'),

  updateSettings: (partial) =>
    ipcRenderer.invoke('settings:update', partial),

  isDevMode: () =>
    ipcRenderer.invoke('app:isDevMode'),

  resetSystemConfigFromEnv: () =>
    ipcRenderer.invoke('settings:resetSystemFromEnv'),

  getLocalModelStatus: () =>
    ipcRenderer.invoke('models:localStatus'),

  downloadMissingLocalModels: () =>
    ipcRenderer.invoke('models:downloadMissing'),

  testApiModel: (kind, model) =>
    ipcRenderer.invoke('models:testApi', kind, model),

  listPlugins: () =>
    ipcRenderer.invoke('plugins:list'),

  pluginAdminAction: (pluginId, action, payload) =>
    ipcRenderer.invoke('plugins:adminAction', pluginId, action, payload),

  listPersonalities: () =>
    ipcRenderer.invoke('personality:list'),

  setPersonality: (name) =>
    ipcRenderer.invoke('personality:set', name),

  addPersonalityFile: () =>
    ipcRenderer.invoke('personality:addFile'),

  submitInteractiveInput: (requestId, response) =>
    ipcRenderer.invoke(`interactive-input:response:${requestId}`, response),

  onTTSAudio: (callback) => {
    ipcRenderer.on('tts:audio', (_, { contextId, data }) => {
      callback(new Uint8Array(data), contextId)
    })
  },

  onTTSConnected: (callback) => {
    ipcRenderer.on('tts:connected', (_, contextId) => callback(contextId))
  },

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

  onSpeechReconnecting: (callback) => {
    ipcRenderer.on('speech:reconnecting', callback)
  },

  onSpeechReconnected: (callback) => {
    ipcRenderer.on('speech:reconnected', callback)
  },

  onSpeechConnectionFailed: (callback) => {
    ipcRenderer.on('speech:connectionFailed', callback)
  },

  onInterruption: (callback) => {
    ipcRenderer.on('speech:interruption', (_, turnId) => callback(turnId))
  },

  onTurnStart: (callback) => {
    ipcRenderer.on('turn:start', (_, turnId) => callback(turnId))
  },

  onInteractiveInputRequest: (callback) => {
    ipcRenderer.on('interactive-input:request', (_, request) => callback(request))
  },

  onPlaybackWaitRequest: (callback) => {
    ipcRenderer.on('playback:waitRequest', (_, requestId) => callback(requestId))
  },

  notifyPlaybackComplete: (requestId) => {
    ipcRenderer.send('playback:complete', requestId)
  },

  notifyFirstAudioPlay: () => {
    ipcRenderer.send('latency:firstAudioPlay')
  },

  notifyAudioScheduled: (metrics) => {
    ipcRenderer.send('latency:audioScheduled', metrics)
  },

  onLatencyData: (callback) => {
    ipcRenderer.on('latency:data', (_, data) => callback(data))
  },

  moveWindow: (deltaX, deltaY) => {
    ipcRenderer.send('window:move', deltaX, deltaY)
  },

  setCompactWindowMode: (compact) => {
    ipcRenderer.send('window:set-compact-mode', compact)
  },

  setTaskWindowMode: (active) => {
    ipcRenderer.send('window:set-task-mode', active)
  },
})
