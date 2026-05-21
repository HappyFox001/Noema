/**
 * Defines timing policy for work signals that may become emotional feedback.
 */
import type { FeedbackTiming } from './boundaries.js'
import type { WorkSignalKind, WorkSignalSeverity } from './work-state.js'

export interface WorkFeedbackRule {
  signalKind: WorkSignalKind
  severity: WorkSignalSeverity
  timing: FeedbackTiming
  askUser: boolean
  reason: string
}

export const WORK_FEEDBACK_RULES: WorkFeedbackRule[] = [
  { signalKind: 'progress', severity: 'ambient', timing: 'after_current_output', askUser: false, reason: 'Progress can be spoken at a natural gap without interrupting speech.' },
  { signalKind: 'blocked', severity: 'speak', timing: 'after_user_pause', askUser: true, reason: 'Blocked work needs user help at a natural pause.' },
  { signalKind: 'needs_user', severity: 'speak', timing: 'after_current_output', askUser: true, reason: 'Explicit user input requests should be spoken after current output.' },
  { signalKind: 'risk', severity: 'interrupt', timing: 'after_current_output', askUser: true, reason: 'Risk should be surfaced at the next natural output gap.' },
  { signalKind: 'completed', severity: 'speak', timing: 'after_current_output', askUser: false, reason: 'Completion should be expressed by the emotional layer.' },
  { signalKind: 'failed', severity: 'speak', timing: 'after_current_output', askUser: false, reason: 'Failure should be summarized without losing recovery facts.' },
]

export function getWorkFeedbackRule(signalKind: WorkSignalKind, severity: WorkSignalSeverity): WorkFeedbackRule {
  return WORK_FEEDBACK_RULES.find(rule => rule.signalKind === signalKind && rule.severity === severity)
    ?? WORK_FEEDBACK_RULES.find(rule => rule.signalKind === signalKind)
    ?? { signalKind, severity, timing: 'display_only', askUser: false, reason: 'Default to non-interruptive display feedback.' }
}
