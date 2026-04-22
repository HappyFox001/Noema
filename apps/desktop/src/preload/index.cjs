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

  // 新增 SDK 功能
  getMemory: () =>
    ipcRenderer.invoke('sdk:getMemory'),

  getPersonality: () =>
    ipcRenderer.invoke('sdk:getPersonality'),

  getStats: () =>
    ipcRenderer.invoke('sdk:getStats'),

  // 事件监听
  onTTSAudio: (callback) => {
    ipcRenderer.on('tts:audio', (_, data) => callback(new Uint8Array(data)))
  },

  onTTSConnected: (callback) => {
    ipcRenderer.on('tts:connected', callback)
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

  // 窗口控制
  moveWindow: (deltaX, deltaY) => {
    ipcRenderer.send('window:move', deltaX, deltaY)
  },

  getWindowPosition: () => {
    return ipcRenderer.invoke('window:get-position')
  },
})
