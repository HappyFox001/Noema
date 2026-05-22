import { readFile } from 'fs/promises'
import { parse } from 'yaml'
import type { Personality } from '../personality/index.js'

export async function loadPersonalityFromFile(filePath: string): Promise<Personality> {
  try {
    const yamlContent = await readFile(filePath, 'utf-8')
    const config = parse(yamlContent)

    return validatePersonality(config)
  } catch (error: any) {
    throw new Error(`Failed to load personality from ${filePath}: ${error.message}`)
  }
}

function validatePersonality(config: any): Personality {
  if (!config.character?.name) {
    throw new Error('Personality config missing character.name')
  }

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

  const char = config.character

  return {
    character: {
      name: char.name,
      chineseName: char.chineseName,
      englishAlias: char.englishAlias,
      ageAtPreservation: char.ageAtPreservation,
      gender: char.gender,
      birthday: char.birthday,
      hometown: char.hometown,
      formerOccupation: char.formerOccupation,
      currentState: char.currentState,
      appearanceImpression: char.appearanceImpression,
      personalityTraits: char.personalityTraits || [],
      background: char.background || '',
      coreMemories: char.coreMemories || [],
      values: char.values || [],
      worldview: char.worldview,
      speakingStyle: char.speakingStyle || '',
      behaviorRules: char.behaviorRules || [],
      likes: char.likes || [],
      dislikes: char.dislikes || []
    },
    relationship: {
      type: relationshipType || 'companion',
      intimacy: config.relationship?.intimacy ?? 0.5,
      trust: config.relationship?.trust ?? 0.5,
      dynamic: config.relationship?.dynamic
    }
  }
}
