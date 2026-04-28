import type { Personality } from '@her-text/types'

export class PersonalityEngine {
  constructor(private personality: Personality) {}

  getPersonality(): Personality {
    return { ...this.personality }
  }
}
