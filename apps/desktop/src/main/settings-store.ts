import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { mkdir, readFile, writeFile } from 'fs/promises'

export interface AppSettings {
  voiceInputEnabled: boolean
  voiceOutputEnabled: boolean
  volume: number
  selectedPersonality: string
  externalRolePaths: string[]
}

const DEFAULT_SETTINGS: AppSettings = {
  voiceInputEnabled: true,
  voiceOutputEnabled: true,
  volume: 70,
  selectedPersonality: 'role:eva',
  externalRolePaths: []
}

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_SETTINGS }
  private filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), 'settings.json')
  }

  async initialize(): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true })

    if (!existsSync(this.filePath)) {
      await this.persist()
      return
    }

    try {
      const raw = await readFile(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppSettings>
      this.settings = {
        ...DEFAULT_SETTINGS,
        ...parsed,
        externalRolePaths: Array.isArray(parsed.externalRolePaths) ? parsed.externalRolePaths : [],
        volume: clampVolume(parsed.volume ?? DEFAULT_SETTINGS.volume)
      }
    } catch (error) {
      console.warn('[SettingsStore] Failed to load settings, using defaults:', error)
      this.settings = { ...DEFAULT_SETTINGS }
      await this.persist()
    }
  }

  getSettings(): AppSettings {
    return { ...this.settings }
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.settings = {
      ...this.settings,
      ...partial,
      volume: clampVolume(partial.volume ?? this.settings.volume)
    }
    await this.persist()
    return this.getSettings()
  }

  private async persist(): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8')
  }
}

function clampVolume(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}
