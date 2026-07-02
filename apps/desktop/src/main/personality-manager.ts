/**
 * Manages the active character profile for companion and voice runtime.
 */
import { watch } from 'chokidar'
import type { Personality } from '@noema/sdk'
import { characterProfileToPersonality, type CharacterProfile } from '@noema/sdk/character-profile'
import {
  CHAT_ROLE_REF_PREFIX,
  FILE_REF_PREFIX,
  getChatRoleResourceDir,
  listChatRoleResourceItems,
  loadCharacterProfileRef,
  loadChatRoleResourceById,
  type CharacterProfileListItem,
} from './chat-role-resource-store.js'

export const DEFAULT_CHARACTER_PROFILE_ID = 'chen-qianyu'
export const DEFAULT_CHARACTER_PROFILE_REF = `${CHAT_ROLE_REF_PREFIX}${DEFAULT_CHARACTER_PROFILE_ID}`

export type RoleListItem = CharacterProfileListItem

export class PersonalityManager {
  private currentProfile: CharacterProfile | null = null
  private watcher: any = null

  async initialize(): Promise<void> {
    this.currentProfile = await loadChatRoleResourceById(DEFAULT_CHARACTER_PROFILE_ID)
    this.startWatching()
  }

  async loadPersonality(name: string): Promise<Personality> {
    return characterProfileToPersonality(await this.loadPersonalityProfile(name))
  }

  async loadPersonalityProfile(name: string): Promise<CharacterProfile> {
    return await loadChatRoleResourceById(name)
  }

  async loadPersonalityRef(ref: string): Promise<Personality> {
    return characterProfileToPersonality(await this.loadPersonalityProfileRef(ref))
  }

  async loadPersonalityProfileRef(ref: string): Promise<CharacterProfile> {
    return await loadCharacterProfileRef(normalizeCharacterProfileRef(ref))
  }

  async listPersonalities(): Promise<string[]> {
    const items = await listChatRoleResourceItems()
    return items
      .filter((item) => item.source === 'chat')
      .map((item) => item.id.slice(CHAT_ROLE_REF_PREFIX.length))
  }

  async listRoleItems(externalPaths: string[] = []): Promise<RoleListItem[]> {
    return await listChatRoleResourceItems(externalPaths)
  }

  getCurrentPersonality(): Personality {
    return characterProfileToPersonality(this.getCurrentCharacterProfile())
  }

  getCurrentCharacterProfile(): CharacterProfile {
    if (!this.currentProfile) {
      throw new Error('Character profile not loaded')
    }
    return this.currentProfile
  }

  async setCurrentPersonality(ref: string): Promise<Personality> {
    this.currentProfile = await this.loadPersonalityProfileRef(ref)
    return characterProfileToPersonality(this.currentProfile)
  }

  async validateRoleFile(filePath: string): Promise<CharacterProfile> {
    return await loadCharacterProfileRef(`${FILE_REF_PREFIX}${filePath}`)
  }

  getPersonalitiesDir(): string {
    return getChatRoleResourceDir()
  }

  private startWatching(): void {
    this.watcher = watch(getChatRoleResourceDir(), {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: true,
    })

    this.watcher.on('change', async () => {
      const current = this.currentProfile
      if (!current?.source || current.source.kind !== 'chat-role') {
        return
      }
      try {
        this.currentProfile = await loadChatRoleResourceById(current.id)
        console.log('[PersonalityManager] Character profile reloaded successfully')
      } catch (error: any) {
        console.error('[PersonalityManager] Failed to reload character profile:', error)
      }
    })
  }

  async shutdown(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
    }
  }
}

function normalizeCharacterProfileRef(ref: string): string {
  if (ref.startsWith(CHAT_ROLE_REF_PREFIX) || ref.startsWith(FILE_REF_PREFIX)) {
    return ref
  }
  return DEFAULT_CHARACTER_PROFILE_REF
}
