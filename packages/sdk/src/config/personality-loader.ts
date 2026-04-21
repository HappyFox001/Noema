import { readFile } from 'fs/promises'
import { parse } from 'yaml'
import type { Personality } from '@her-text/types'

export async function loadPersonalityFromFile(filePath: string): Promise<Personality> {
  try {
    const yamlContent = await readFile(filePath, 'utf-8')
    const config = parse(yamlContent)

    // 验证和规范化
    return validatePersonality(config)
  } catch (error: any) {
    throw new Error(`Failed to load personality from ${filePath}: ${error.message}`)
  }
}

function validatePersonality(config: any): Personality {
  // 验证必需字段
  if (!config.character?.name) {
    throw new Error('Personality config missing character.name')
  }

  // 验证特质值在 0-1 范围内
  const traits = config.traits || {}
  for (const [key, value] of Object.entries(traits)) {
    if (typeof value !== 'number' || value < 0 || value > 1) {
      throw new Error(`Invalid trait value for ${key}: ${value} (must be 0-1)`)
    }
  }

  // 验证关系类型
  const relationshipType = config.relationship?.type
  if (
    relationshipType &&
    relationshipType !== 'companion' &&
    relationshipType !== 'assistant' &&
    relationshipType !== 'friend'
  ) {
    throw new Error(
      `Invalid relationship type: ${relationshipType} (must be companion, assistant, or friend)`
    )
  }

  // 构建完整的 Personality 对象
  return {
    traits: {
      openness: traits.openness ?? 0.5,
      conscientiousness: traits.conscientiousness ?? 0.5,
      extraversion: traits.extraversion ?? 0.5,
      agreeableness: traits.agreeableness ?? 0.5,
      neuroticism: traits.neuroticism ?? 0.5
    },
    character: {
      name: config.character.name,
      background: config.character.background || '',
      values: config.character.values || [],
      speakingStyle: config.character.speakingStyle || ''
    },
    relationship: {
      type: relationshipType || 'companion',
      intimacy: config.relationship?.intimacy ?? 0.5,
      trust: config.relationship?.trust ?? 0.5
    }
  }
}
