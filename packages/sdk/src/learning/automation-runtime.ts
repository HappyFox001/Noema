/**
 * Automatic learning loop driven by terminal runtime events.
 */
import type {
  RuntimeEvent,
  RuntimeCapabilityContext,
  RuntimeEventUnsubscribe,
  RuntimeJobUnregister,
} from '../runtime/index.js'
import { isAllowedExpressionRoutine } from './routine-policy.js'
import type { LearningCandidate, RoutinePolicy } from './types.js'
import type { PersonaContinuityRisk } from './persona-continuity.js'
import type { ReflectionRunResult } from './reflection-engine.js'

export interface LearningAutomationRuntimeOptions {
  enabled?: boolean
  autoDeploySkills?: boolean
  autoDeployRoutines?: boolean
  skillConfidenceThreshold?: number
  routineConfidenceThreshold?: number
}

export class LearningAutomationRuntime {
  private unsubscribe?: RuntimeEventUnsubscribe
  private unregisterJob?: RuntimeJobUnregister
  private stopped = false

  constructor(
    private readonly runtime: RuntimeCapabilityContext,
    private readonly options: LearningAutomationRuntimeOptions = {}
  ) {}

  start(): void {
    if (this.unsubscribe || this.options.enabled === false) {
      return
    }

    this.unregisterJob = this.runtime.runtimeJobs.register<{ event: RuntimeEvent }, void>(
      'learning.reflect',
      async ({ event }, context) => {
        if (context.signal.aborted) {
          return
        }
        await this.runForEvent(event)
      }
    )

    this.unsubscribe = this.runtime.runtimeEvents.subscribe((event) => {
      if (!isTerminalLearningEvent(event)) {
        return
      }
      this.runtime.runtimeJobs.submit('learning.reflect', { event })
    })
  }

  async shutdown(): Promise<void> {
    this.stopped = true
    this.unsubscribe?.()
    this.unsubscribe = undefined
    await this.runtime.runtimeJobs.waitForIdle()
    this.unregisterJob?.()
    this.unregisterJob = undefined
  }

  private async runForEvent(event: RuntimeEvent): Promise<void> {
    if (this.stopped) {
      return
    }

    await this.runtime.learning.flushWrites()
    const result = await this.runtime.reflection.reflectRecentEvents()
    if (!result) {
      return
    }

    await this.runtime.learning.recordAutomationDecision({
      action: 'reflected',
      reason: `Automatically reflected after ${event.name}.`,
      risk: 'low',
    })

    await this.handleCandidates(result)
    await this.suggestHardAgentPromotionWhenStable()
  }

  private async handleCandidates(result: ReflectionRunResult): Promise<void> {
    for (const candidate of result.candidates) {
      const decision = this.classifyCandidate(candidate)
      await this.runtime.learning.recordAutomationDecision({
        action: 'candidate_created',
        candidateId: candidate.id,
        reason: decision.reason,
        risk: decision.risk,
      })

      if (!decision.autoDeploy) {
        if (candidate.kind === 'agent') {
          await this.suggestSoftAgentWhenRepeated(candidate)
        }
        await this.runtime.learning.recordAutomationDecision({
          action: 'kept_pending',
          candidateId: candidate.id,
          reason: decision.reason,
          risk: decision.risk,
        })
        continue
      }

      const asset = await this.runtime.learning.deployCandidate({
        candidateId: candidate.id,
        scope: inferScope(candidate),
        status: 'active',
      })
      await this.runtime.learning.recordAutomationDecision({
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
    const personaAssessment = this.runtime.personaContinuity.assessCandidate(candidate)
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

  private async suggestSoftAgentWhenRepeated(candidate: LearningCandidate): Promise<void> {
    if (!this.runtime.agentSociety) {
      return
    }

    const candidates = await this.runtime.learning.listCandidates(undefined, 100)
    const related = candidates.filter(item =>
      item.kind === 'agent' &&
      item.id !== candidate.id &&
      item.status !== 'rejected' &&
      hasRoutingOverlap(item.reason, candidate.reason)
    )
    if (related.length < 1) {
      return
    }

    const suggestedAgentId = `suggested-${candidate.id}`
    const existingAgents = await this.runtime.agentSociety.listAgents()
    if (existingAgents.some(agent => agent.id === suggestedAgentId)) {
      return
    }

    const job = this.runtime.runtimeJobs.submit('agent.createSoft', {
      id: suggestedAgentId,
      name: buildAgentName(candidate),
      purpose: candidate.reason,
      instructions: [
        'Handle this repeated task class as a specialized runtime agent.',
        `Reason: ${candidate.reason}`,
        `Expected benefit: ${candidate.expectedBenefit}`,
        `Risk to watch: ${candidate.risk}`,
        'Return concise facts, a result summary, and any uncertainty that should be routed back to the main agent.',
      ].join('\n'),
      capabilities: ['specialized-task-routing'],
      inheritedCapabilities: ['tools', 'memory'],
      routingPolicy: candidate.reason,
      status: 'draft',
    })
    const completedJob = await this.runtime.runtimeJobs.waitForJob<{ id: string }>(job.id)
    const createdAgentId = completedJob.status === 'completed' ? completedJob.result?.id : undefined
    await this.runtime.learning.recordAutomationDecision({
      action: 'kept_pending',
      candidateId: candidate.id,
      ...(createdAgentId ? { assetId: createdAgentId } : {}),
      reason: 'Repeated structural need produced a draft soft agent suggestion. Activation remains manual.',
      risk: 'high',
    })
  }

  private async suggestHardAgentPromotionWhenStable(): Promise<void> {
    if (!this.runtime.agentSociety) {
      return
    }

    const decisions = await this.runtime.learning.listAutomationDecisions(100)
    const agents = await this.runtime.agentSociety.listAgents('active')
    for (const agent of agents) {
      if (agent.mode !== 'soft') {
        continue
      }
      if (decisions.some(decision =>
        decision.assetId === agent.id &&
        /hard agent promotion/i.test(decision.reason)
      )) {
        continue
      }

      const usage = await this.runtime.agentSociety.listAgentUsage(agent.id, 8)
      const successes = usage.filter(item => item.outcome === 'success').length
      const failures = usage.filter(item => item.outcome === 'failure').length
      const isStable = usage.length >= 5 && successes >= 4
      const needsOwnCapabilities = failures >= 2 && usage.some(item =>
        /missing|unsupported|capability|permission|权限|能力/.test(item.summary)
      )
      if (!isStable && !needsOwnCapabilities) {
        continue
      }

      const reason = isStable
        ? 'Hard agent promotion suggested because this soft agent is stable across recent routed tasks.'
        : 'Hard agent promotion suggested because this soft agent appears to need own capabilities.'
      await this.runtime.runtimeJobs.waitForJob(this.runtime.runtimeJobs.submit('agent.promoteHard', {
        agentId: agent.id,
        reason,
      }).id)
      await this.runtime.learning.recordAutomationDecision({
        action: 'kept_pending',
        assetId: agent.id,
        reason,
        risk: 'high',
      })
    }
  }
}

function isTerminalLearningEvent(event: RuntimeEvent): boolean {
  return event.name === 'task.completed' || event.name === 'task.failed' || event.name === 'emotional.turn.completed'
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

function hasRoutingOverlap(left: string, right: string): boolean {
  const leftTokens = tokenize(left)
  const rightTokens = tokenize(right)
  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1
    }
  }
  return overlap >= 2
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/u)
      .map(token => token.trim())
      .filter(token => token.length >= 2)
  )
}

function buildAgentName(candidate: LearningCandidate): string {
  const words = Array.from(tokenize(candidate.reason)).slice(0, 4)
  const label = words.length > 0 ? words.join('-') : candidate.kind
  return `Suggested ${label} agent`
}
