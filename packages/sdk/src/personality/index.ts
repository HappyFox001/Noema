import type { CharacterProfile } from '../character-profile/index.js'
import { characterProfileToPersonality } from '../character-profile/index.js'

export interface Personality {
  character: {
    name: string
    chineseName?: string
    englishAlias?: string
    ageAtPreservation?: number
    gender?: string
    birthday?: string
    hometown?: string
    formerOccupation?: string
    currentState?: string
    appearanceImpression?: string
    personalityTraits?: string[]
    background: string
    coreMemories?: string[]
    values: string[]
    worldview?: string
    speakingStyle: string
    behaviorRules?: string[]
    likes?: string[]
    dislikes?: string[]
  }

  relationship: {
    type: 'companion' | 'assistant' | 'friend'
    intimacy: number
    trust: number
    dynamic?: string
  }
}

export class PersonalityEngine {
  constructor(private characterProfile: CharacterProfile | null) {}

  getPersonality(): Personality {
    return characterProfileToPersonality(this.requireCharacterProfile())
  }

  getCharacterProfile(): CharacterProfile {
    return this.requireCharacterProfile()
  }

  hasCharacterProfile(): boolean {
    return Boolean(this.characterProfile)
  }

  private requireCharacterProfile(): CharacterProfile {
    if (!this.characterProfile) {
      throw new Error('Character profile is not selected')
    }
    return this.characterProfile
  }
}
