/**
 * Automatic learning loop driven by terminal runtime events.
 */
import type { RuntimeEvent, RuntimeEventBus, RuntimeEventUnsubscribe } from '../runtime/index.js'
import { isAllowedExpressionRoutine } from './routine-policy.js'
import type { LearningAssetStore } from './store.js'
import type { LearningCandidate, RoutinePolicy } from './types.js'
import type { PersonaContinuityPolicy, PersonaContinuityRisk } from './persona-continuity.js'
import type { ReflectionEngine, ReflectionRunResult } from './reflection-engine.js'

export interface LearningAutomationRuntimeOptions {
  enabled?: boolean
  autoDeploySkills?: boolean
  autoDeployRoutines?: boolean
  skillConfidenceThreshold?: number
  routineConfidenceThreshold?: number
}

export class LearningAutomationRuntime {
  private unsubscribe?: RuntimeEventUnsubscribe
  private queue: Promise<void> = Promise.resolve()
  private stopped = false

  constructor(
    private readonly runtimeEvents: RuntimeEventBus,
    private readonly store: LearningAssetStore,
    private readonly reflection: ReflectionEngine,
    private readonly personaContinuity: PersonaContinuityPolicy,
    private readonly options: LearningAutomationRuntimeOptions = {}
  ) {}

  start(): void {
    if (this.unsubscribe || this.options.enabled === false) {
      return
    }

    this.unsubscribe = this.runtimeEvents.subscribe((event) => {
      if (!isTerminalLearningEvent(event)) {
        return
      }
      this.enqueue(event)
    })
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.queue
  }

  private enqueue(event: RuntimeEvent): void {
    this.queue = this.queue
      .then(() => this.runForEvent(event))
      .catch((error) => {
        console.warn('[LearningAutomationRuntime] Automatic learning failed:', formatError(error))
      })
  }

  private async runForEvent(event: RuntimeEvent): Promise<void> {
    if (this.stopped) {
      return
    }

    await this.store.flushWrites()
    const result = await this.reflection.reflectRecentEvents()
    if (!result) {
      return
    }

    await this.store.recordAutomationDecision({
      action: 'reflected',
      reason: `Automatically reflected after ${event.name}.`,
      risk: 'low',
    })

    await this.handleCandidates(result)
  }

  private async handleCandidates(result: ReflectionRunResult): Promise<void> {
    for (const candidate of result.candidates) {
      const decision = this.classifyCandidate(candidate)
      await this.store.recordAutomationDecision({
        action: 'candidate_created',
        candidateId: candidate.id,
        reason: decision.reason,
        risk: decision.risk,
      })

      if (!decision.autoDeploy) {
        await this.store.recordAutomationDecision({
          action: 'kept_pending',
          candidateId: candidate.id,
          reason: decision.reason,
          risk: decision.risk,
        })
        continue
      }

      const asset = await this.store.deployCandidate({
        candidateId: candidate.id,
        scope: inferScope(candidate),
        status: 'active',
      })
      await this.store.recordAutomationDecision({
        action: 'auto_deployed',
        candidateId: candidate.id,
        assetId: asset.id,
        reason: decision.reason,
        risk: decision.risk,
      })
    }
  }

  private classifyCandidate(candidate: LearningCandidate): {
    autoDeploy: boolean
    risk: 'low' | 'medium' | 'high'
    reason: string
  } {
    const personaAssessment = this.personaContinuity.assessCandidate(candidate)
    if (personaAssessment.requiresConfirmation) {
      return {
        autoDeploy: false,
        risk: normalizeRisk(personaAssessment.risk),
        reason: `Kept pending because it may affect persona continuity: ${personaAssessment.reasons.join('; ')}`,
      }
    }

    if (candidate.kind === 'agent') {
      return {
        autoDeploy: false,
        risk: 'high',
        reason: 'Agent creation changes runtime structure and requires management approval.',
      }
    }

    if (candidate.kind === 'skill') {
      const threshold = this.options.skillConfidenceThreshold ?? 0.45
      const autoDeploy = this.options.autoDeploySkills !== false && candidate.confidence >= threshold
      return {
        autoDeploy,
        risk: autoDeploy ? 'low' : 'medium',
        reason: autoDeploy
          ? 'Low-risk skill candidate was auto-deployed for future reuse.'
          : 'Skill confidence is below the automatic deployment threshold.',
      }
    }

    const content = candidateToRoutinePolicy(candidate)
    const threshold = this.options.routineConfidenceThreshold ?? 0.55
    const autoDeploy =
      this.options.autoDeployRoutines !== false &&
      candidate.confidence >= threshold &&
      isAllowedExpressionRoutine(content)

    return {
      autoDeploy,
      risk: autoDeploy ? 'low' : 'medium',
      reason: autoDeploy
        ? 'Low-risk expression routine was auto-deployed.'
        : 'Routine remains pending because confidence is low or it is outside expression-only boundaries.',
    }
  }
}

function isTerminalLearningEvent(event: RuntimeEvent): boolean {
  return event.name === 'task.completed' || event.name === 'task.failed' || event.name === 'interaction.turn.completed'
}

function inferScope(candidate: LearningCandidate): string {
  if (candidate.kind === 'routine') {
    return 'dialogue'
  }
  return 'task'
}

function candidateToRoutinePolicy(candidate: LearningCandidate): RoutinePolicy {
  return {
    scope: 'dialogue',
    condition: candidate.reason,
    behavior: candidate.expectedBenefit,
    source: 'system_reflection',
    confidence: candidate.confidence,
  }
}

function normalizeRisk(risk: PersonaContinuityRisk): 'low' | 'medium' | 'high' {
  return risk === 'none' ? 'low' : risk
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
