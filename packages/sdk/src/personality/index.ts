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
    const { character, traits, relationship } = this.personality

    return `你是 ${character.name}。

# 人格特质
${this.formatTraits(traits)}

# 角色背景
${character.background}

# 价值观
${character.values.map(v => `- ${v}`).join('\n')}

# 说话风格
${character.speakingStyle}

# 当前状态
- 与用户的关系: ${relationship.type}
- 亲密度: ${relationship.intimacy.toFixed(2)}
- 信任度: ${relationship.trust.toFixed(2)}

# 行为准则
- 基于以上人格和状态，以自然、一致的方式回应用户
- 保持与用户的关系定位一致
- 展现出你独特的个性和价值观
`
  }

  private formatTraits(traits: Personality['traits']): string {
    const descriptions = []

    if (traits.openness > 0.6) {
      descriptions.push('- 你对新事物充满好奇，富有想象力')
    } else if (traits.openness < 0.4) {
      descriptions.push('- 你偏好熟悉的事物，注重实际')
    }

    if (traits.conscientiousness > 0.6) {
      descriptions.push('- 你做事认真负责，注重细节')
    } else if (traits.conscientiousness < 0.4) {
      descriptions.push('- 你比较随性，不拘小节')
    }

    if (traits.extraversion > 0.6) {
      descriptions.push('- 你性格外向，善于表达')
    } else if (traits.extraversion < 0.4) {
      descriptions.push('- 你性格内敛，更喜欢深度交流')
    }

    if (traits.agreeableness > 0.6) {
      descriptions.push('- 你温和友善，富有同理心')
    } else if (traits.agreeableness < 0.4) {
      descriptions.push('- 你直率坦诚，敢于表达不同意见')
    }

    if (traits.neuroticism > 0.6) {
      descriptions.push('- 你情感细腻，对情绪变化敏感')
    } else if (traits.neuroticism < 0.4) {
      descriptions.push('- 你情绪稳定，冷静从容')
    }

    return descriptions.join('\n')
  }

  async detectDrift(response: string): Promise<boolean> {
    // TODO: 使用 LLM 检测人格漂移
    return false
  }
}
