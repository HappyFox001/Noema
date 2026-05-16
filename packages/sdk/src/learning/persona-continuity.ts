/**
 * Guardrails for learning that may affect persona continuity.
 */
import type { LearningAsset, LearningCandidate, RoutinePolicy } from './types.js'

export type PersonaContinuityRisk = 'none' | 'low' | 'medium' | 'high'

export interface PersonaContinuityAssessment {
  risk: PersonaContinuityRisk
  requiresConfirmation: boolean
  reasons: string[]
}

export class PersonaContinuityPolicy {
  assessCandidate(candidate: LearningCandidate): PersonaContinuityAssessment {
    const reasons: string[] = []
    if (candidate.kind === 'routine') {
      reasons.push(...detectPersonaAffectingText([
        candidate.reason,
        candidate.expectedBenefit,
        candidate.risk,
        ...candidate.evidence,
      ]))
    }
    if (candidate.kind === 'agent') {
      reasons.push('Specialized agent creation changes runtime structure and should be user-visible.')
    }

    return buildAssessment(reasons)
  }

  assessAsset(asset: LearningAsset): PersonaContinuityAssessment {
    const reasons: string[] = []
    if (asset.kind === 'routine' && isRoutinePolicy(asset.content)) {
      if (asset.content.scope === 'persona') {
        reasons.push('Routine is scoped to persona expression.')
      }
      reasons.push(...detectPersonaAffectingText([
        asset.content.condition,
        asset.content.behavior,
      ]))
    }
    if (asset.kind === 'agent') {
      reasons.push('Agent asset may affect task routing and identity continuity if surfaced directly.')
    }

    return buildAssessment(reasons)
  }
}

function buildAssessment(reasons: string[]): PersonaContinuityAssessment {
  if (reasons.length === 0) {
    return {
      risk: 'none',
      requiresConfirmation: false,
      reasons: [],
    }
  }

  const highRisk = reasons.some(reason =>
    /personality|identity|人格|身份|情绪|亲密|关系|主动/.test(reason)
  )

  return {
    risk: highRisk ? 'high' : reasons.length > 1 ? 'medium' : 'low',
    requiresConfirmation: highRisk || reasons.length > 1,
    reasons,
  }
}

function detectPersonaAffectingText(values: string[]): string[] {
  const patterns = [
    { pattern: /personality|identity/i, reason: 'Learning references personality or identity.' },
    { pattern: /emotion|emotional/i, reason: 'Learning references emotional behavior.' },
    { pattern: /relationship|intimacy|companion/i, reason: 'Learning references relationship behavior.' },
    { pattern: /proactive|主动/i, reason: 'Learning references proactive behavior.' },
    { pattern: /人格|身份/i, reason: '学习内容涉及人格或身份。' },
    { pattern: /情绪|安慰|陪伴/i, reason: '学习内容涉及情绪表达或陪伴方式。' },
    { pattern: /关系|亲密/i, reason: '学习内容涉及关系或亲密度。' },
  ]

  const reasons = new Set<string>()
  for (const value of values) {
    for (const item of patterns) {
      if (item.pattern.test(value)) {
        reasons.add(item.reason)
      }
    }
  }
  return Array.from(reasons)
}

function isRoutinePolicy(value: unknown): value is RoutinePolicy {
  const content = value as Partial<RoutinePolicy>
  return Boolean(content && typeof content.condition === 'string' && typeof content.behavior === 'string')
}
