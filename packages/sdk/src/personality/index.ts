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
  constructor(private characterProfile: CharacterProfile) {}

  getPersonality(): Personality {
    return characterProfileToPersonality(this.characterProfile)
  }

  getCharacterProfile(): CharacterProfile {
    return this.characterProfile
  }
}
