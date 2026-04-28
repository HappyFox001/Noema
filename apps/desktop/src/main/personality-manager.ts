import { app } from 'electron'
import { basename, dirname, join } from 'path'
import { existsSync } from 'fs'
import { copyFile, readdir, mkdir } from 'fs/promises'
import { fileURLToPath } from 'url'
import { watch } from 'chokidar'
import type { Personality } from '@her-text/types'
import { loadPersonalityFromFile } from '@her-text/sdk/config/personality-loader'

const DEFAULT_PERSONALITY_NAME = 'eva'
const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const ROLE_REF_PREFIX = 'role:'
const FILE_REF_PREFIX = 'file:'

export interface RoleListItem {
  id: string
  name: string
  path: string
  source: 'role' | 'file'
}

export class PersonalityManager {
  private roleDir: string
  private currentPersonality: Personality | null = null
  private watcher: any = null

  constructor() {
    const appDataDir = app.getPath('userData')
    this.roleDir = join(appDataDir, 'role')
  }

  async initialize(): Promise<void> {
    // 确保目录存在
    await mkdir(this.roleDir, { recursive: true })

    // 检查是否有默认配置文件
    const defaultPath = join(this.roleDir, `${DEFAULT_PERSONALITY_NAME}.yaml`)
    if (!existsSync(defaultPath)) {
      await this.createDefaultPersonality()
    }

    // 加载默认人格
    this.currentPersonality = await this.loadPersonality(DEFAULT_PERSONALITY_NAME)

    // 启动文件监听
    this.startWatching()
  }

  async loadPersonality(name: string): Promise<Personality> {
    const filePath = join(this.roleDir, `${name}.yaml`)

    if (!existsSync(filePath)) {
      throw new Error(`Personality file not found: ${filePath}`)
    }

    return await loadPersonalityFromFile(filePath)
  }

  async loadPersonalityRef(ref: string): Promise<Personality> {
    if (ref.startsWith(FILE_REF_PREFIX)) {
      const filePath = ref.slice(FILE_REF_PREFIX.length)
      if (!existsSync(filePath)) {
        throw new Error(`Role file not found: ${filePath}`)
      }
      return await loadPersonalityFromFile(filePath)
    }

    if (!ref.startsWith(ROLE_REF_PREFIX)) {
      throw new Error(`Invalid role reference: ${ref}`)
    }

    const name = ref.slice(ROLE_REF_PREFIX.length)
    return await this.loadPersonality(name)
  }

  async listPersonalities(): Promise<string[]> {
    const files = await readdir(this.roleDir)
    return files.filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''))
  }

  async listRoleItems(externalPaths: string[] = []): Promise<RoleListItem[]> {
    const roleNames = await this.listPersonalities()
    const items: RoleListItem[] = roleNames.map((name) => ({
      id: `${ROLE_REF_PREFIX}${name}`,
      name,
      path: join(this.roleDir, `${name}.yaml`),
      source: 'role',
    }))

    for (const filePath of externalPaths) {
      if (!existsSync(filePath)) {
        continue
      }

      items.push({
        id: `${FILE_REF_PREFIX}${filePath}`,
        name: basename(filePath).replace(/\.ya?ml$/i, ''),
        path: filePath,
        source: 'file',
      })
    }

    return items
  }

  getCurrentPersonality(): Personality {
    if (!this.currentPersonality) {
      throw new Error('Personality not loaded')
    }
    return this.currentPersonality
  }

  async setCurrentPersonality(name: string): Promise<Personality> {
    this.currentPersonality = await this.loadPersonalityRef(name)
    return this.currentPersonality
  }

  async validateRoleFile(filePath: string): Promise<Personality> {
    if (!/\.ya?ml$/i.test(filePath)) {
      throw new Error('Role file must be a .yaml or .yml file')
    }

    return await loadPersonalityFromFile(filePath)
  }

  getPersonalitiesDir(): string {
    return this.roleDir
  }

  private async createDefaultPersonality(): Promise<void> {
    const filePath = join(this.roleDir, `${DEFAULT_PERSONALITY_NAME}.yaml`)
    const bundledPath = join(SOURCE_ROOT, 'role', `${DEFAULT_PERSONALITY_NAME}.yaml`)

    if (!existsSync(bundledPath)) {
      throw new Error(`Bundled role file not found: ${bundledPath}`)
    }

    await copyFile(bundledPath, filePath)
    console.log(`[PersonalityManager] Created default personality at ${filePath}`)
  }

  private startWatching(): void {
    this.watcher = watch(this.roleDir, {
      ignored: /(^|[\/\\])\../, // 忽略隐藏文件
      persistent: true
    })

    this.watcher.on('change', async (path: string) => {
      if (path.endsWith(`${DEFAULT_PERSONALITY_NAME}.yaml`)) {
        console.log(`[PersonalityManager] Detected change in ${path}, reloading...`)
        try {
          this.currentPersonality = await this.loadPersonality(DEFAULT_PERSONALITY_NAME)
          console.log('[PersonalityManager] Personality reloaded successfully')
          // TODO: 通知渲染进程人格已更新
        } catch (error: any) {
          console.error('[PersonalityManager] Failed to reload personality:', error)
        }
      }
    })
  }

  async shutdown(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
    }
  }
}
