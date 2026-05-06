/**
 * Local CLI task runtime adapters.
 *
 * Runs Codex or Claude Code as fresh one-shot task backends.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'

export default function plugin(ctx) {
  return {
    id: 'task-runtime-cli',
    name: 'CLI Task Runtimes',
    registerTaskRuntimes() {
      return [
        createCliRuntimeAdapter({
          id: 'codex_local',
          label: 'Codex CLI',
          defaultCommand: 'codex',
          buildArgs: ({ model, extraArgs }) => {
            const args = ['exec', '--json', '--disable', 'plugins']
            if (model) args.push('--model', model)
            args.push(...extraArgs, '-')
            return args
          },
          parseOutput: parseCodexOutput,
        }),
        createCliRuntimeAdapter({
          id: 'claude_code_local',
          label: 'Claude Code CLI',
          defaultCommand: 'claude',
          buildArgs: ({ model, extraArgs }) => {
            const args = ['--print', '-', '--output-format', 'stream-json', '--verbose']
            if (model) args.push('--model', model)
            args.push(...extraArgs)
            return args
          },
          parseOutput: parseClaudeOutput,
        }),
      ]
    },
  }
}

function createCliRuntimeAdapter(options) {
  return {
    id: options.id,
    label: options.label,
    async canHandle(request) {
      return request.config.adapterId === options.id
    },
    async run(request, hooks) {
      const startedAt = Date.now()
      const step = {
        id: 'external-cli-run',
        title: `Run ${options.label}`,
        description: `Execute the task through ${options.label} in a fresh local CLI session.`,
        status: 'running',
        startedAt,
      }
      const plan = {
        id: randomUUID(),
        title: request.taskDescription.slice(0, 80) || options.label,
        summary: `Delegated to ${options.label}.`,
        steps: [step],
        createdAt: startedAt,
        updatedAt: startedAt,
      }

      hooks.onStatusChanged?.('running')
      hooks.onRunStateChanged?.('planning')
      hooks.onPlanUpdated?.(plan)
      hooks.onRunStateChanged?.('step_running')
      hooks.onStepUpdated?.(step, plan)

      const command = String(request.config.command || options.defaultCommand)
      const cwd = String(request.config.cwd || process.cwd())
      const model = String(request.config.model || '')
      const extraArgs = Array.isArray(request.config.extraArgs) ? request.config.extraArgs : []
      const timeoutMs = Number.isFinite(Number(request.config.timeoutMs))
        ? Number(request.config.timeoutMs)
        : 30 * 60 * 1000
      const env = normalizeEnv(request.config.env)
      const prompt = buildPrompt(request)

      if (!existsSync(cwd)) {
        const error = `Working directory does not exist: ${cwd}`
        const failed = finishStep(step, plan, 'failed', error)
        hooks.onStepUpdated?.(failed.step, failed.plan)
        hooks.onRunStateChanged?.('failed')
        hooks.onStatusChanged?.('errored')
        return {
          success: false,
          iterations: 1,
          toolCalls: 0,
          finalMessage: error,
          plan: failed.plan,
          error,
        }
      }

      hooks.onLog?.({ stream: 'system', text: `Starting ${command} ${options.buildArgs({ model, extraArgs }).join(' ')}\n` })
      const run = await runProcess({
        command,
        args: options.buildArgs({ model, extraArgs }),
        cwd,
        env: { ...process.env, ...env },
        stdin: prompt,
        timeoutMs,
        signal: request.signal,
        onLog: hooks.onLog,
      })
      const parsed = options.parseOutput(run.stdout)
      const summary = extractStructuredSummary(parsed.summary) || parsed.summary || extractStructuredSummary(run.stdout) || run.stdout.trim().slice(-4000)
      const success = run.exitCode === 0 && !run.timedOut && !run.aborted
      const finalText = summary || (success ? `${options.label} completed.` : `${options.label} failed.`)
      const completed = finishStep(
        step,
        plan,
        success ? 'completed' : 'failed',
        finalText,
      )
      hooks.onStepUpdated?.(completed.step, completed.plan)
      hooks.onRunStateChanged?.(success ? 'completed' : 'failed')
      hooks.onStatusChanged?.(success ? 'completed' : 'errored')
      hooks.onTurnCompleted?.({
        turnIndex: 1,
        assistantMessage: finalText,
        toolCalls: [],
        toolResults: [{
          adapterId: options.id,
          command,
          cwd,
          exitCode: run.exitCode,
          signal: run.signal,
          timedOut: run.timedOut,
          aborted: run.aborted,
          stderr: run.stderr.trim().slice(-4000),
        }],
        completed: success,
        stepId: step.id,
        stepTitle: step.title,
        promptMessageCount: 1,
      })

      return {
        success,
        iterations: 1,
        toolCalls: 0,
        finalMessage: finalText,
        plan: completed.plan,
        ...(success ? {} : { error: run.timedOut ? `Timed out after ${timeoutMs}ms` : run.stderr.trim() || finalText }),
      }
    },
  }
}

function buildPrompt(request) {
  const contextItems = request.taskContextItems
    .map(item => [
      `## Context: ${item.name}`,
      item.path ? `Path: ${item.path}` : '',
      item.content,
    ].filter(Boolean).join('\n'))
    .join('\n\n')
  const summaries = request.memoryContext.summaries
    .slice(-5)
    .map(item => `- ${item.summary || item.content || JSON.stringify(item)}`)
    .join('\n')

  return [
    'You are the task runtime for her-text. Execute exactly one local development task.',
    'This is a fresh one-shot session. Do not assume prior CLI session context.',
    'Use the current working directory as the project root unless the task says otherwise.',
    'Read relevant files before editing. Keep changes scoped. Run relevant verification when practical.',
    '',
    'At the end, include a final JSON object fenced as ```json with this shape:',
    '{"success":true,"summary":"...","changedFiles":[],"commandsRun":[],"notes":"","error":null}',
    '',
    '# Task',
    request.taskDescription,
    '',
    '# Original User Input',
    request.originalUserInput,
    summaries ? `\n# Recent Memory Summaries\n${summaries}` : '',
    contextItems ? `\n# Injected Task Context\n${contextItems}` : '',
  ].filter(Boolean).join('\n')
}

function runProcess(input) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: input.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      input.signal?.removeEventListener('abort', abort)
      resolve({ stdout, stderr, ...result })
    }
    const abort = () => {
      child.kill('SIGTERM')
      finish({ exitCode: null, signal: 'SIGTERM', timedOut: false, aborted: true })
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ exitCode: null, signal: 'SIGTERM', timedOut: true, aborted: false })
    }, input.timeoutMs)

    input.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', chunk => {
      const text = String(chunk)
      stdout += text
      input.onLog?.({ stream: 'stdout', text })
    })
    child.stderr.on('data', chunk => {
      const text = String(chunk)
      stderr += text
      input.onLog?.({ stream: 'stderr', text })
    })
    child.on('error', error => {
      stderr += error.message
      finish({ exitCode: null, signal: null, timedOut: false, aborted: false })
    })
    child.on('close', (exitCode, signal) => {
      finish({ exitCode, signal, timedOut: false, aborted: false })
    })
    child.stdin.end(input.stdin)
  })
}

function finishStep(step, plan, status, result) {
  const nextStep = {
    ...step,
    status,
    ...(status === 'failed' ? { error: result } : { result }),
    completedAt: Date.now(),
  }
  const nextPlan = {
    ...plan,
    steps: [nextStep],
    updatedAt: Date.now(),
  }
  return { step: nextStep, plan: nextPlan }
}

function parseCodexOutput(stdout) {
  let summary = ''
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      const item = event.item || event.msg?.item
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        summary = item.text
      }
    } catch {
      // Codex JSONL can include non-JSON diagnostics from older builds.
    }
  }
  return { summary }
}

function parseClaudeOutput(stdout) {
  let summary = ''
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === 'result' && typeof event.result === 'string') {
        summary = event.result
      } else if (typeof event.result === 'string') {
        summary = event.result
      }
    } catch {
      // Claude stream-json should be JSONL, but keep robust fallback.
    }
  }
  return { summary }
}

function extractStructuredSummary(text) {
  const match = text.match(/```json\s*([\s\S]*?)```/i)
  if (!match) return ''
  try {
    const parsed = JSON.parse(match[1])
    return typeof parsed.summary === 'string' ? parsed.summary : ''
  } catch {
    return ''
  }
}

function normalizeEnv(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry) => typeof entry[1] === 'string')
  )
}
