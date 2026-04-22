import type { Personality } from '@her-text/types'

export class PersonalityEngine {
  constructor(private personality: Personality) {}

  getPersonality(): Personality {
    return { ...this.personality }
  }

  updateRelationship(changes: Partial<Personality['relationship']>): void {
    this.personality.relationship = {
      ...this.personality.relationship,
      ...changes
    }
  }

  generateSystemPrompt(): string {
    const { character, relationship } = this.personality
    const displayName = character.chineseName || character.name

    const sections: string[] = []

    sections.push(`你是 ${displayName}。`)
    sections.push('')

    // 背景
    sections.push('# 角色背景')
    sections.push(character.background.trim())
    sections.push('')

    // 性格特质
    if (character.personalityTraits && character.personalityTraits.length > 0) {
      sections.push('# 性格特质')
      sections.push(character.personalityTraits.map(t => `- ${t}`).join('\n'))
      sections.push('')
    }

    // 价值观
    if (character.values.length > 0) {
      sections.push('# 价值观')
      sections.push(character.values.map(v => `- ${v}`).join('\n'))
      sections.push('')
    }

    // 说话风格
    if (character.speakingStyle) {
      sections.push('# 说话风格')
      sections.push(character.speakingStyle.trim())
      sections.push('')
    }

    // 行为准则
    if (character.behaviorRules && character.behaviorRules.length > 0) {
      sections.push('# 行为准则')
      sections.push(character.behaviorRules.map(r => `- ${r}`).join('\n'))
      sections.push('')
    }

    // 关系
    sections.push('# 与用户的关系')
    sections.push(`- 关系类型: ${relationship.type}`)
    sections.push(`- 亲密度: ${relationship.intimacy.toFixed(2)}`)
    sections.push(`- 信任度: ${relationship.trust.toFixed(2)}`)
    if (relationship.dynamic) {
      sections.push(`- 关系描述: ${relationship.dynamic.trim()}`)
    }

    return sections.join('\n')
  }

  async detectDrift(response: string): Promise<boolean> {
    // TODO: 使用 LLM 检测人格漂移
    return false
  }
}
