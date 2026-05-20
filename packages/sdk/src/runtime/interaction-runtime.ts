/**
 * Deterministic interaction routing between emotional output and durable work.
 */
import type { FeedbackDecision } from './boundaries.js'
import type {
  InteractionIntent,
  InteractionResolveInput,
  InteractionResolveResult,
  UserInterruptionKind,
  WorkFeedbackInput,
} from './interaction.js'

const SPEECH_STOP_PATTERNS = [
  /^(停|停一下|别说了|先别说|闭嘴|stop)$/i,
  /(停止|打断).*(说话|语音|播报)/,
]

const SPEECH_MUTE_PATTERNS = [
  /(静音|别出声|先别语音|不要语音)/,
]

const SPEECH_REPEAT_PATTERNS = [
  /(再说一遍|重复一下|刚才说什么)/,
]

const WORK_STATUS_PATTERNS = [
  /(做到哪|进展|状态|现在.*怎么样|刚才.*到哪)/,
]

const WORK_RESUME_PATTERNS = [
  /(继续|接着).*(刚才|上个|之前|那个)/,
  /继续$/,
]

const WORK_PAUSE_PATTERNS = [
  /(先暂停|暂停一下|等一下再做|先别做)/,
]

const WORK_CANCEL_PATTERNS = [
  /(取消|别做了|不用做了|放弃).*(任务|这个|刚才|之前)?/,
]

const WORK_CORRECTION_PATTERNS = [
  /(不对|错了|路径错|方向错|应该是|改成|换成)/,
]

const WORK_NEW_PATTERNS = [
  /(帮我|给我|去|打开|创建|修改|修复|查一下|看一下|运行|执行|写一个|做一个)/,
]

export class InteractionRuntime {
  resolve(input: InteractionResolveInput): InteractionResolveResult {
    const text = input.userInput.trim()
    const intents: InteractionIntent[] = []
    const focusedThreadId = input.workState.focusedThreadId
    const hasActiveWork = input.workState.activeThreads.length > 0

    if (matchesAny(text, SPEECH_STOP_PATTERNS)) {
      return {
        interruptionKind: 'speech_stop',
        intents: [{
          kind: 'speech.stop',
          reason: 'User requested speech output to stop.',
        }],
      }
    }

    if (matchesAny(text, SPEECH_MUTE_PATTERNS)) {
      intents.push({
        kind: 'speech.mute',
        reason: 'User requested voice output to be muted.',
      })
    }

    if (matchesAny(text, SPEECH_REPEAT_PATTERNS)) {
      intents.push({
        kind: 'speech.repeat',
        reason: 'User asked to repeat the last spoken output.',
      })
    }

    if (matchesAny(text, WORK_CANCEL_PATTERNS) && hasActiveWork) {
      intents.push({
        kind: 'work.cancel',
        targetThreadId: focusedThreadId,
        reason: 'User explicitly cancelled current work.',
      })
      return {
        interruptionKind: 'cancel_work',
        intents,
      }
    }

    if (matchesAny(text, WORK_PAUSE_PATTERNS) && matchesAny(text, WORK_NEW_PATTERNS) && hasActiveWork) {
      intents.push({
        kind: 'work.pause',
        targetThreadId: focusedThreadId,
        reason: 'User asked to pause current work before starting another task.',
      })
      intents.push({
        kind: 'work.queue_new',
        workDescription: input.emotionalTurn?.intentHints?.[0] || text,
        reason: 'User requested new work while pausing the current thread.',
      })
      return {
        interruptionKind: 'new_work',
        intents,
      }
    }

    if (matchesAny(text, WORK_PAUSE_PATTERNS) && hasActiveWork) {
      intents.push({
        kind: 'work.pause',
        targetThreadId: focusedThreadId,
        reason: 'User asked to pause current work without deleting its state.',
      })
      return {
        interruptionKind: 'pause_work',
        intents,
      }
    }

    if (matchesAny(text, WORK_RESUME_PATTERNS)) {
      intents.push({
        kind: 'work.resume',
        targetThreadId: focusedThreadId,
        reason: 'User asked to continue prior work.',
      })
      return {
        interruptionKind: 'none',
        intents,
      }
    }

    if (matchesAny(text, WORK_STATUS_PATTERNS) && hasActiveWork) {
      intents.push({
        kind: 'work.status',
        targetThreadId: focusedThreadId,
        reason: 'User asked for current work status.',
      })
      return {
        interruptionKind: 'question',
        intents,
      }
    }

    if (matchesAny(text, WORK_CORRECTION_PATTERNS) && hasActiveWork) {
      intents.push({
        kind: 'work.modify',
        targetThreadId: focusedThreadId,
        modification: text,
        reason: 'User corrected or constrained the current work.',
      })
      return {
        interruptionKind: 'correction',
        intents,
      }
    }

    if (matchesAny(text, WORK_NEW_PATTERNS)) {
      intents.push({
        kind: hasActiveWork ? 'work.queue_new' : 'work.start',
        workDescription: input.emotionalTurn?.intentHints?.[0] || text,
        reason: hasActiveWork
          ? 'User requested new work while another thread is active.'
          : 'User requested new work.',
      })
      return {
        interruptionKind: hasActiveWork ? 'new_work' : 'none',
        intents,
      }
    }

    if (intents.length === 0) {
      intents.push({
        kind: 'chat',
        reason: 'No work or speech control intent was detected.',
      })
    }

    return {
      interruptionKind: 'none',
      intents,
    }
  }

  decideFeedback(input: WorkFeedbackInput): FeedbackDecision {
    if (input.signal.severity === 'silent') {
      return {
        timing: 'silent',
        reason: 'Work signal is silent.',
      }
    }

    if (input.signal.severity === 'interrupt') {
      return {
        timing: 'interrupt_output',
        reason: 'Work signal is urgent enough to interrupt current output.',
      }
    }

    if (input.outputState.speaking) {
      return {
        timing: input.signal.severity === 'speak' ? 'after_current_output' : 'display_only',
        reason: 'Avoid overlapping speech with the current output.',
      }
    }

    if (input.signal.severity === 'speak') {
      return {
        timing: 'speak_now',
        reason: 'Important work signal can be spoken immediately.',
      }
    }

    return {
      timing: 'display_only',
      reason: 'Ambient work signal should update UI without speech.',
    }
  }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text))
}
