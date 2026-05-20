/**
 * Defines Her-Text work focus and input policies for non-CLI interaction.
 */
import type { FeedbackTiming } from './boundaries.js'
import type { WorkSignalKind, WorkSignalSeverity, WorkState, WorkThread } from './work-state.js'

export type UserInputSurface =
  | 'text'
  | 'voice'
  | 'manual_tts_stop'
  | 'app_close'
  | 'system_sleep'
  | 'system_resume'

export type WorkInputDefaultAction =
  | 'route_to_focused_thread'
  | 'preserve_work_and_route_interaction'
  | 'pause_active_work'
  | 'snapshot_and_restore_later'
  | 'resume_recoverable_work'

export interface WorkInputPolicy {
  surface: UserInputSurface
  defaultAction: WorkInputDefaultAction
  cancelsWorkByDefault: boolean
  preservesOutputOnlyInterruption: boolean
  reason: string
}

export type WorkThreadBucket = 'foreground' | 'paused' | 'background' | 'abandoned'

export interface WorkThreadFocusDecision {
  targetThreadId?: string
  bucket: WorkThreadBucket
  reason: string
}

export interface WorkFeedbackRule {
  signalKind: WorkSignalKind
  severity: WorkSignalSeverity
  timing: FeedbackTiming
  askUser: boolean
  reason: string
}

export const WORK_INPUT_POLICIES: WorkInputPolicy[] = [
  {
    surface: 'text',
    defaultAction: 'route_to_focused_thread',
    cancelsWorkByDefault: false,
    preservesOutputOnlyInterruption: false,
    reason: 'Typed input usually carries durable intent and should modify or focus work before starting over.',
  },
  {
    surface: 'voice',
    defaultAction: 'preserve_work_and_route_interaction',
    cancelsWorkByDefault: false,
    preservesOutputOnlyInterruption: true,
    reason: 'Speech is often conversational or output control, so it must not cancel work without an explicit work intent.',
  },
  {
    surface: 'manual_tts_stop',
    defaultAction: 'preserve_work_and_route_interaction',
    cancelsWorkByDefault: false,
    preservesOutputOnlyInterruption: true,
    reason: 'Stopping playback controls output only.',
  },
  {
    surface: 'app_close',
    defaultAction: 'snapshot_and_restore_later',
    cancelsWorkByDefault: false,
    preservesOutputOnlyInterruption: false,
    reason: 'Closing the app should persist recoverable work rather than discard it.',
  },
  {
    surface: 'system_sleep',
    defaultAction: 'pause_active_work',
    cancelsWorkByDefault: false,
    preservesOutputOnlyInterruption: false,
    reason: 'Sleep interrupts runtime resources, so active work should pause with a snapshot.',
  },
  {
    surface: 'system_resume',
    defaultAction: 'resume_recoverable_work',
    cancelsWorkByDefault: false,
    preservesOutputOnlyInterruption: false,
    reason: 'Resume should prefer recoverable paused or failed work before starting a new thread.',
  },
]

export const WORK_FEEDBACK_RULES: WorkFeedbackRule[] = [
  { signalKind: 'progress', severity: 'ambient', timing: 'display_only', askUser: false, reason: 'Progress can be visible without interrupting speech.' },
  { signalKind: 'blocked', severity: 'speak', timing: 'after_user_pause', askUser: true, reason: 'Blocked work needs user help at a natural pause.' },
  { signalKind: 'needs_user', severity: 'speak', timing: 'after_current_output', askUser: true, reason: 'Explicit user input requests should be spoken after current output.' },
  { signalKind: 'risk', severity: 'interrupt', timing: 'interrupt_output', askUser: true, reason: 'Risk can justify interrupting output for confirmation.' },
  { signalKind: 'completed', severity: 'speak', timing: 'after_current_output', askUser: false, reason: 'Completion should be expressed by the emotional layer.' },
  { signalKind: 'failed', severity: 'speak', timing: 'after_current_output', askUser: false, reason: 'Failure should be summarized without losing recovery facts.' },
]

export function getWorkInputPolicy(surface: UserInputSurface): WorkInputPolicy {
  return WORK_INPUT_POLICIES.find(policy => policy.surface === surface) ?? WORK_INPUT_POLICIES[0]
}

export function chooseFocusedWorkThread(state: WorkState, surface: UserInputSurface): WorkThreadFocusDecision {
  const policy = getWorkInputPolicy(surface)
  const focused = findThread(state, state.focusedThreadId)
  if (focused && focused.status === 'active') {
    return { targetThreadId: focused.id, bucket: 'foreground', reason: policy.reason }
  }
  const active = state.activeThreads.find(thread => thread.status === 'active')
  if (active) {
    return { targetThreadId: active.id, bucket: 'foreground', reason: 'Active foreground work receives the next durable input.' }
  }
  const recoverable = [...state.pausedThreads, ...state.activeThreads]
    .find(thread => thread.status === 'paused' || thread.status === 'waiting_user' || thread.status === 'recoverable_failed')
  if (recoverable) {
    return { targetThreadId: recoverable.id, bucket: 'paused', reason: 'Recoverable work is preferred when no foreground thread exists.' }
  }
  const abandoned = state.abandonedThreads[0]
  return {
    targetThreadId: abandoned?.id,
    bucket: abandoned ? 'abandoned' : 'foreground',
    reason: abandoned ? 'Only abandoned work is available.' : 'No existing work thread is available.',
  }
}

export function classifyWorkThread(thread: WorkThread, focusedThreadId?: string): WorkThreadBucket {
  if (thread.status === 'abandoned' || thread.status === 'cancelled') {
    return 'abandoned'
  }
  if (thread.id === focusedThreadId && thread.status === 'active') {
    return 'foreground'
  }
  if (thread.status === 'active') {
    return 'background'
  }
  return 'paused'
}

export function getWorkFeedbackRule(signalKind: WorkSignalKind, severity: WorkSignalSeverity): WorkFeedbackRule {
  return WORK_FEEDBACK_RULES.find(rule => rule.signalKind === signalKind && rule.severity === severity)
    ?? WORK_FEEDBACK_RULES.find(rule => rule.signalKind === signalKind)
    ?? { signalKind, severity, timing: 'display_only', askUser: false, reason: 'Default to non-interruptive display feedback.' }
}

function findThread(state: WorkState, id?: string): WorkThread | undefined {
  if (!id) {
    return undefined
  }
  return [
    ...state.activeThreads,
    ...state.pausedThreads,
    ...state.abandonedThreads,
    ...state.completedThreads,
  ].find(thread => thread.id === id)
}
