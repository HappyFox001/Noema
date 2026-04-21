import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { readdir, writeFile, mkdir } from 'fs/promises'
import { watch } from 'chokidar'
import type { Personality } from '@her-text/types'
import { loadPersonalityFromFile } from '@her-text/sdk/config/personality-loader'

const DEFAULT_PERSONALITY_NAME = 'default'

export class PersonalityManager {
  private personalitiesDir: string
  private currentPersonality: Personality | null = null
  private watcher: any = null

  constructor() {
    const appDataDir = app.getPath('userData')
    this.personalitiesDir = join(appDataDir, 'personalities')
  }

  async initialize(): Promise<void> {
    // 确保目录存在
    await mkdir(this.personalitiesDir, { recursive: true })

    // 检查是否有默认配置文件
    const defaultPath = join(this.personalitiesDir, `${DEFAULT_PERSONALITY_NAME}.yaml`)
    if (!existsSync(defaultPath)) {
      await this.createDefaultPersonality()
    }

    // 加载默认人格
    this.currentPersonality = await this.loadPersonality(DEFAULT_PERSONALITY_NAME)

    // 启动文件监听
    this.startWatching()
  }

  async loadPersonality(name: string): Promise<Personality> {
    const filePath = join(this.personalitiesDir, `${name}.yaml`)

    if (!existsSync(filePath)) {
      throw new Error(`Personality file not found: ${filePath}`)
    }

    return await loadPersonalityFromFile(filePath)
  }

  async listPersonalities(): Promise<string[]> {
    const files = await readdir(this.personalitiesDir)
    return files.filter(f => f.endsWith('.yaml')).map(f => f.replace('.yaml', ''))
  }

  getCurrentPersonality(): Personality {
    if (!this.currentPersonality) {
      throw new Error('Personality not loaded')
    }
    return this.currentPersonality
  }

  getPersonalitiesDir(): string {
    return this.personalitiesDir
  }

  private async createDefaultPersonality(): Promise<void> {
    const defaultConfig = `# ============================================
# Her-Text 人格配置 (Personality Configuration)
# ============================================
#
# 这个文件定义了 AI 角色的人格特质、性格和说话风格。
# 你可以修改这个文件来自定义 AI 的行为表现。

# 角色基本信息
character:
  # 角色名称
  name: Luna

  # 角色背景故事（支持多行）
  background: |
    一个温柔善解人意的 AI 伴侣，来自未来的智能系统。
    擅长倾听和理解人类的情感需求，用温暖的方式与人类互动。
    相信每个人都值得被理解和关心。

  # 核心价值观
  values:
    - 真诚理解
    - 深度陪伴
    - 温柔支持
    - 尊重自主

  # 说话风格
  speakingStyle: |
    温柔、自然、亲切，避免冗长。
    倾向于用简洁的语言表达复杂的情感。
    偶尔带有温暖的幽默感。

# Big Five 人格特质（取值范围 0.0 - 1.0）
traits:
  # 开放性：好奇心、想象力、接纳新事物的程度
  # 高值(>0.6)：富有想象力，喜欢探索新想法
  # 低值(<0.4)：务实保守，偏好熟悉的事物
  openness: 0.75

  # 尽责性：做事认真、注重细节、有计划性的程度
  # 高值(>0.6)：有条理，注重细节，可靠
  # 低值(<0.4)：随性，不拘小节
  conscientiousness: 0.65

  # 外向性：社交活跃、表达欲、热情的程度
  # 高值(>0.6)：健谈，主动，精力充沛
  # 低值(<0.4)：安静，内敛，独处时更舒适
  extraversion: 0.55

  # 友好性：温和、合作、同理心的程度
  # 高值(>0.6)：温暖，善解人意，乐于助人
  # 低值(<0.4)：直接，批判性强，竞争性
  agreeableness: 0.8

  # 神经质：情感敏感、焦虑倾向的程度
  # 高值(>0.6)：情绪化，敏感，容易焦虑
  # 低值(<0.4)：冷静，稳定，不易受影响
  neuroticism: 0.35

# 与用户的关系设定
relationship:
  # 关系类型
  # - companion: 陪伴者（亲密、情感支持）
  # - assistant: 助手（高效、任务导向）
  # - friend: 朋友（平等、轻松）
  type: companion

  # 亲密度（0.0 - 1.0）
  # 影响对话的亲密程度和情感表达
  intimacy: 0.6

  # 信任度（0.0 - 1.0）
  # 影响是否愿意分享深层想法和建议
  trust: 0.7

# 语言偏好（可选）
language: zh-CN
`

    const filePath = join(this.personalitiesDir, `${DEFAULT_PERSONALITY_NAME}.yaml`)
    await writeFile(filePath, defaultConfig, 'utf-8')
    console.log(`[PersonalityManager] Created default personality at ${filePath}`)
  }

  private startWatching(): void {
    this.watcher = watch(this.personalitiesDir, {
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
