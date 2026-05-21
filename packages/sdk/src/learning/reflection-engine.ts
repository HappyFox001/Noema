/**
 * Deterministic reflection engine for early self-learning candidates.
 */
import type {
  CreateLearningCandidateInput,
  CreateReflectionInput,
  LearningCandidate,
  LearningEventRecord,
  ReflectionRecord,
} from './types.js'
import type { LearningAssetStore } from './store.js'

export interface ReflectionEngineOptions {
  recentEventLimit?: number
}

export interface ReflectionRunResult {
  reflection: ReflectionRecord
  candidates: LearningCandidate[]
}

export class ReflectionEngine {
  constructor(
    private store: LearningAssetStore,
    private options: ReflectionEngineOptions = {}
  ) {}

  async reflectRecentEvents(): Promise<ReflectionRunResult | null> {
    const events = await this.store.listEvents(this.options.recentEventLimit ?? 200)
    const relevantEvents = selectLatestInteractionOrTaskEvents(events)
    if (relevantEvents.length === 0) {
      return null
    }

    const sourceEventIds = relevantEvents.map(event => event.id)
    const existingReflections = await this.store.listReflections(20)
    if (existingReflections.some(reflection => sameStringSet(reflection.sourceEventIds, sourceEventIds))) {
      return null
    }

    const reflectionInput = buildReflectionInput(relevantEvents)
    const reflection = await this.store.createReflection(reflectionInput)
    const candidateInputs = buildCandidateInputs(relevantEvents, reflection)
    const candidates: LearningCandidate[] = []
    for (const input of candidateInputs) {
      candidates.push(await this.store.createCandidate(input))
    }

    return { reflection, candidates }
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const values = new Set(left)
  return right.every(value => values.has(value))
}

function selectLatestInteractionOrTaskEvents(events: LearningEventRecord[]): LearningEventRecord[] {
  const latestTaskTerminal = [...events]
    .reverse()
    .find(event => event.name === 'task.completed' || event.name === 'task.failed')

  if (latestTaskTerminal?.taskId) {
    return events.filter(event => event.taskId === latestTaskTerminal.taskId)
  }

  const latestTurnTerminal = [...events]
    .reverse()
    .find(event => event.name === 'emotional.turn.completed' || event.name === 'emotional.turn.aborted')

  if (latestTurnTerminal?.turnId) {
    return events.filter(event => event.turnId === latestTurnTerminal.turnId)
  }

  return []
}

function buildReflectionInput(events: LearningEventRecord[]): CreateReflectionInput {
  const taskFailed = events.find(event => event.name === 'task.failed')
  const taskCompleted = events.find(event => event.name === 'task.completed')
  const planUpdatedCount = events.filter(event => event.name === 'task.plan.updated').length
  const stepUpdatedCount = events.filter(event => event.name === 'task.step.updated').length
  const taskDescription = getStringPayload(taskFailed ?? taskCompleted, 'taskDescription')
  const summaryParts = [
    taskDescription ? `Task: ${taskDescription}` : 'Interaction reflected.',
    taskFailed ? 'Task failed.' : taskCompleted ? 'Task completed.' : 'No terminal task event.',
    `Observed ${events.length} runtime events.`,
  ]

  const failures = taskFailed
    ? [getStringPayload(taskFailed, 'error') || getStringPayload(taskFailed, 'finalMessage') || 'Task failed without a structured error.']
    : []

  const inefficiencies = planUpdatedCount > 3 || stepUpdatedCount > 8
    ? ['Task required many plan or step updates; check whether a reusable workflow or specialized agent would reduce repeated reasoning.']
    : []

  const reusablePatterns = taskCompleted
    ? ['Successful task execution can be reviewed for reusable workflow steps.']
    : []

  const structuralNeeds = taskFailed
    ? ['Failure may indicate missing task strategy, missing verification, or a need for a specialized agent if this repeats.']
    : []

  return {
    sourceEventIds: events.map(event => event.id),
    summary: summaryParts.join(' '),
    failures,
    inefficiencies,
    reusablePatterns,
    structuralNeeds,
  }
}

function buildCandidateInputs(
  events: LearningEventRecord[],
  reflection: ReflectionRecord
): CreateLearningCandidateInput[] {
  const taskFailed = events.find(event => event.name === 'task.failed')
  const taskCompleted = events.find(event => event.name === 'task.completed')
  const intent = events.find(event => event.name === 'emotional.task_signal.detected')
  const hasTask = getBooleanPayload(intent, 'hasTask')
  const candidates: CreateLearningCandidateInput[] = []

  if (taskCompleted && hasTask) {
    candidates.push({
      kind: 'skill',
      sourceEventIds: reflection.sourceEventIds,
      reason: 'A task completed successfully and may contain reusable workflow steps.',
      evidence: [reflection.summary, ...reflection.reusablePatterns],
      expectedBenefit: 'Reuse the successful workflow in future similar tasks.',
      risk: 'The workflow may be too task-specific without human review.',
      confidence: 0.45,
    })
  }

  if (taskFailed) {
    candidates.push({
      kind: 'routine',
      sourceEventIds: reflection.sourceEventIds,
      reason: 'A task failed and should produce an interaction or execution policy improvement candidate.',
      evidence: [reflection.summary, ...reflection.failures],
      expectedBenefit: 'Reduce repeated failure by adapting task strategy or asking for clarification earlier.',
      risk: 'The failure may be transient and not worth changing future behavior.',
      confidence: 0.4,
    })
  }

  if (reflection.structuralNeeds.length > 0) {
    candidates.push({
      kind: 'agent',
      sourceEventIds: reflection.sourceEventIds,
      reason: 'Reflection detected a possible structural need beyond a simple workflow.',
      evidence: [reflection.summary, ...reflection.structuralNeeds],
      expectedBenefit: 'A specialized agent may improve repeated handling of this task class.',
      risk: 'Creating an agent too early can fragment the runtime without enough evidence.',
      confidence: 0.25,
    })
  }

  return candidates
}

function getStringPayload(event: LearningEventRecord | undefined, key: string): string | undefined {
  if (!event || !event.payload || typeof event.payload !== 'object') {
    return undefined
  }
  const value = (event.payload as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function getBooleanPayload(event: LearningEventRecord | undefined, key: string): boolean {
  if (!event || !event.payload || typeof event.payload !== 'object') {
    return false
  }
  return (event.payload as Record<string, unknown>)[key] === true
}
