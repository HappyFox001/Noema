import { app } from 'electron'
import { join } from 'path'
import type { SDKConfig } from '@her-text/types'

let personalityManager: any = null

export function getStorageDir(): string {
  const appDataDir = app.getPath('userData')
  return join(appDataDir, 'her-text-data')
}

export async function initializePersonalityManager(): Promise<void> {
  const { PersonalityManager } = await import('./personality-manager.js')
  personalityManager = new PersonalityManager()
  await personalityManager.initialize()
}

export function getPersonalityManager(): any {
  if (!personalityManager) {
    throw new Error('PersonalityManager not initialized')
  }
  return personalityManager
}

export async function buildSDKConfig(): Promise<SDKConfig> {
  if (!personalityManager) {
    throw new Error(
      'PersonalityManager not initialized. Call initializePersonalityManager() first.'
    )
  }

  return {
    llm: {
      apiKey: process.env.LLM_API_KEY || '',
      model: process.env.LLM_MODEL || 'deepseek-chat',
      baseURL: process.env.LLM_BASE_URL || 'https://api.deepseek.com'
    },
    memory: {
      storageDir: getStorageDir()
    },
    personality: personalityManager.getCurrentPersonality()
  }
}
