/**
 * Task-layer admission policy for relating new work signals to durable work.
 */
import type { LLMProvider } from '@her-text/core'
import type { WorkState, WorkThread } from '../runtime/work-state.js'

export type TaskAdmissionAction = 'start_new' | 'revise_active' | 'replace_active' | 'queue_new'

export interface TaskAdmissionDecision {
  action: TaskAdmissionAction
  taskDescription: string
  targetThreadId?: string
  reason: string
}

export interface TaskAdmissionInput {
  originalUserInput: string
  emotionalReply: string
  incomingTaskDescription: string
  workState?: WorkState
  signal?: AbortSignal
}

export class TaskAdmissionController {
  constructor(private readonly llm: LLMProvider) {}

  async resolve(input: TaskAdmissionInput): Promise<TaskAdmissionDecision> {
    const activeThreads = input.workState?.activeThreads ?? []
    if (!input.workState || activeThreads.length === 0) {
      return {
        action: 'start_new',
        taskDescription: input.incomingTaskDescription,
        reason: 'No active work thread exists.',
      }
    }

    const focusedThreadId = input.workState.focusedThreadId ?? activeThreads[0]?.id
    const threadSummaries = [
      ...activeThreads,
      ...input.workState.pausedThreads,
    ].slice(0, 6).map(summarizeThread)

    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: [
            'You are the task-layer admission controller for a durable work runtime.',
            'Your job is to decide the lifecycle relationship between a new task signal and existing work.',
            'Do not perform the task. Do not produce user-facing prose. Do not rely on keyword rules.',
            'Use the semantic relationship between the new signal and the saved work state.',
            'Return exactly one JSON object with keys: action, targetThreadId, taskDescription, reason.',
            '',
            'Action protocol:',
            '- start_new: the signal introduces independent work that can begin now.',
            '- revise_active: the signal changes the objective, constraints, inputs, or interpretation of a related thread without requiring cancellation of already useful progress.',
            '- replace_active: the signal makes the active execution path obsolete enough that the running job should be stopped and superseded by a revised objective.',
            '- queue_new: the signal is independent work but should wait behind current active work.',
            '',
            'The taskDescription must be an executable task-layer objective that includes the relationship to prior work when targetThreadId is set.',
            'For related work, describe the desired state transition and require the executor to inspect saved progress and observable artifacts before acting.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            originalUserInput: input.originalUserInput,
            emotionalReply: input.emotionalReply,
            incomingTaskDescription: input.incomingTaskDescription,
            focusedThreadId,
            workThreads: threadSummaries,
          }, null, 2),
        },
      ], {
        response_format: { type: 'json_object' },
        max_tokens: 700,
        signal: input.signal,
      })

      return this.normalizeDecision(response.content, input.incomingTaskDescription, focusedThreadId, activeThreads)
    } catch (error) {
      console.warn('[TaskAdmission] Falling back to active-thread revision:', (error as Error).message)
      const target = activeThreads.find(thread => thread.id === focusedThreadId) ?? activeThreads[0]
      return {
        action: 'revise_active',
        ...(target ? { targetThreadId: target.id } : {}),
        taskDescription: buildRelatedTaskDescription(
          target,
          input.incomingTaskDescription,
          'Task admission model was unavailable.'
        ),
        reason: 'Fallback: preserve active work and route the new signal through the related work thread.',
      }
    }
  }

  private normalizeDecision(
    content: string,
    fallbackTaskDescription: string,
    fallbackThreadId: string | undefined,
    activeThreads: WorkThread[]
  ): TaskAdmissionDecision {
    let parsed: any
    try {
      parsed = JSON.parse(content)
    } catch {
      const match = content.match(/\{[\s\S]*\}/)
      parsed = match ? JSON.parse(match[0]) : {}
    }

    const allowed = new Set<TaskAdmissionAction>(['start_new', 'revise_active', 'replace_active', 'queue_new'])
    const action = allowed.has(parsed?.action) ? parsed.action as TaskAdmissionAction : 'start_new'
    const needsTarget = action === 'revise_active' || action === 'replace_active'
    const targetThreadId = typeof parsed?.targetThreadId === 'string' && parsed.targetThreadId.trim()
      ? parsed.targetThreadId.trim()
      : needsTarget
        ? fallbackThreadId
        : undefined
    const rawDescription = typeof parsed?.taskDescription === 'string' && parsed.taskDescription.trim()
      ? parsed.taskDescription.trim()
      : fallbackTaskDescription
    const reason = typeof parsed?.reason === 'string' && parsed.reason.trim()
      ? parsed.reason.trim()
      : 'Task admission decision.'
    const targetThread = targetThreadId
      ? activeThreads.find(thread => thread.id === targetThreadId)
      : undefined

    return {
      action,
      ...(targetThreadId ? { targetThreadId } : {}),
      taskDescription: needsTarget
        ? buildRelatedTaskDescription(targetThread, rawDescription, reason)
        : rawDescription,
      reason,
    }
  }
}

function summarizeThread(thread: WorkThread): Record<string, unknown> {
  return {
    id: thread.id,
    goal: thread.goal,
    status: thread.status,
    resumeSummary: thread.resumeSummary,
    currentStep: thread.currentStep?.title,
    nextActions: thread.nextActions.slice(-3).map(action => action.title),
    artifacts: thread.artifacts.slice(-5),
    failures: thread.failures.slice(-2).map(failure => failure.message),
  }
}

function buildRelatedTaskDescription(
  thread: WorkThread | undefined,
  incomingTaskDescription: string,
  reason: string
): string {
  if (!thread) {
    return incomingTaskDescription
  }

  return [
    `Resolve the new user intent in relation to existing work thread "${thread.goal}".`,
    `New intent: ${incomingTaskDescription}`,
    `Admission reason: ${reason}`,
    'Before taking action, inspect the saved work state and any observable artifacts. Reuse, transform, supersede, or continue prior progress according to the semantic goal instead of duplicating work by default.',
  ].join('\n')
}
