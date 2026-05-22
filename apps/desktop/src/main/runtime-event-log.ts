/**
 * Formats SDK runtime events into concise desktop main-process log lines.
 */
export function logTaskRuntimeEvent(event: any): void {
  const payload = event.payload ?? {}
  const taskId = typeof event.taskId === 'string' ? ` ${event.taskId}` : ''
  const task = typeof payload.taskDescription === 'string' ? payload.taskDescription : undefined
  const taskPrefix = task ? ` · ${truncateLogText(task, 80)}` : ''

  switch (event.name) {
    case 'task.started':
      console.log(`[Task] Started${taskId}${taskPrefix}`)
      break
    case 'task.run_state.changed':
      console.log(`[Task] State${taskId}: ${payload.state}${taskPrefix}`)
      break
    case 'task.plan.updated': {
      const plan = payload.plan
      const steps = Array.isArray(plan?.steps) ? plan.steps : []
      const counts = summarizeTaskSteps(steps)
      console.log(
        `[Task] Plan${taskId}: ${truncateLogText(String(plan?.title || task || 'Task'), 80)} ` +
        `(${steps.length} steps, ${counts})`
      )
      break
    }
    case 'task.step.updated': {
      const step = payload.step
      console.log(
        `[Task] Step${taskId}: ${step?.status || 'unknown'} · ` +
        `${truncateLogText(String(step?.title || step?.description || 'Untitled step'), 100)}` +
        `${step?.error ? ` · error=${truncateLogText(String(step.error), 100)}` : ''}`
      )
      break
    }
    case 'task.turn.started':
      console.log(
        `[Task] Turn${taskId}: #${payload.turnIndex ?? '?'} started` +
        `${payload.stepTitle ? ` · ${truncateLogText(String(payload.stepTitle), 80)}` : ''}`
      )
      break
    case 'task.turn.completed':
      console.log(
        `[Task] Turn${taskId}: #${payload.turnIndex ?? '?'} completed=${Boolean(payload.completed)} ` +
        `tools=${payload.toolCalls ?? 0}`
      )
      break
    case 'task.tool.started':
      console.log(`[Task] Tool${taskId}: ${payload.toolName || 'unknown'} started`)
      break
    case 'task.tool.completed':
      console.log(
        `[Task] Tool${taskId}: ${payload.toolName || 'unknown'} completed ` +
        `success=${Boolean(payload.success)}` +
        `${payload.summary ? ` · ${truncateLogText(String(payload.summary), 120)}` : ''}`
      )
      break
    case 'task.tool.failed':
      console.log(
        `[Task] Tool${taskId}: ${payload.toolName || 'unknown'} failed · ` +
        `${truncateLogText(String(payload.error || ''), 120)}`
      )
      break
    case 'task.command.started':
      console.log(`[Task] Command: ${formatCommandLog(payload)} started${payload.cwd ? ` · cwd=${payload.cwd}` : ''}`)
      break
    case 'task.command.completed':
      console.log(
        `[Task] Command: ${formatCommandLog(payload)} completed ` +
        `exit=${payload.exitCode ?? payload.signal ?? payload.status ?? 'unknown'}` +
        `${payload.error ? ` · ${truncateLogText(String(payload.error), 120)}` : ''}`
      )
      break
    case 'task.context.compacted':
      console.log(`[Task] Context compacted: ${payload.reason || 'compact'}${taskPrefix}`)
      break
    case 'task.pending_input.added':
      console.log(`[Task] Waiting for input: ${truncateLogText(String(payload.label || payload.inputKind || 'input'), 100)}`)
      break
    case 'task.completed':
      console.log(
        `[Task] Completed${taskId}: iterations=${payload.iterations ?? 0} tools=${payload.toolCalls ?? 0} ` +
        `executor=${payload.executor || 'unknown'} · ${truncateLogText(String(payload.finalMessage || ''), 160)}`
      )
      break
    case 'task.failed':
      console.log(
        `[Task] Failed${taskId}: iterations=${payload.iterations ?? 0} tools=${payload.toolCalls ?? 0} ` +
        `executor=${payload.executor || 'unknown'} · ${truncateLogText(String(payload.error || payload.finalMessage || ''), 160)}`
      )
      break
  }
}

function summarizeTaskSteps(steps: any[]): string {
  const counts = new Map<string, number>()
  for (const step of steps) {
    const status = typeof step?.status === 'string' ? step.status : 'unknown'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([status, count]) => `${status}=${count}`)
    .join(', ') || 'no status'
}

function formatCommandLog(payload: any): string {
  const command = String(payload.command || '')
  const args = Array.isArray(payload.args) ? payload.args.map(String) : []
  return truncateLogText([command, ...args].filter(Boolean).join(' '), 180) || '(unknown command)'
}

function truncateLogText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}
