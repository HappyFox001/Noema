/**
 * Local CLI transports for task model responses.
 */
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { LLMProvider } from '../llm/index.js'
import type { TaskRuntimeConfig } from './task.js'

export function wrapTaskLLMWithRuntimeTransport(
  baseLLM: LLMProvider,
  config: TaskRuntimeConfig = {}
): LLMProvider {
  const transport = normalizeTransport(config.llmTransport)
  if (!transport) {
    return baseLLM
  }

  return createCliTaskLLM({
    transport,
    model: stringValue(config.model),
    timeoutMs: positiveNumber(config.timeoutMs, 30 * 60 * 1000),
  })
}

function createCliTaskLLM(options: {
  transport: 'codex_local' | 'claude_code_local'
  model: string
  timeoutMs: number
}): LLMProvider {
  return {
    async chat(messages, requestOptions = {}) {
      const prompt = buildApiPrompt(messages, requestOptions)
      const run = await runCliModel({
        transport: options.transport,
        model: options.model,
        prompt,
        timeoutMs: options.timeoutMs,
        signal: requestOptions.signal,
      })
      const rawText = parseCliText(options.transport, run.stdout) || run.stdout.trim()
      if (run.exitCode !== 0 || run.timedOut || run.aborted) {
        const detail = run.timedOut ? `timed out after ${options.timeoutMs}ms` : run.stderr.trim() || rawText
        throw new Error(`${transportLabel(options.transport)} model call failed: ${detail}`)
      }
      return parseModelEnvelope(rawText, requestOptions)
    },
    async *streamChat(messages, requestOptions = {}) {
      const response = await this.chat(messages, requestOptions)
      if (response.content) {
        yield response.content
      }
    },
  }
}

function buildApiPrompt(messages: unknown, options: Record<string, any>): string {
  const tools = Array.isArray(options.tools) ? options.tools : []
  const wantsJson = options.response_format?.type === 'json_object'
  return [
    'You are acting only as a chat-completions model transport for noema.',
    'Do not execute shell commands, do not read files, do not edit files, and do not use any CLI-native tools.',
    'The host runtime owns planning, tool execution, approvals, memory, and lifecycle state.',
    'Your job is only to return the next assistant message or function tool calls from the provided messages.',
    '',
    'Return exactly one JSON object and no markdown.',
    'Schema:',
    '{"content":"assistant text","tool_calls":[{"id":"call_unique_id","type":"function","function":{"name":"tool_name","arguments":"{\\"key\\":\\"value\\"}"}}]}',
    'Use an empty string for content when only calling tools.',
    tools.length
      ? 'When tools are available, step completion, failure, skipping, or replanning must be expressed by calling the appropriate tool. Do not replace a required tool call with plain assistant text.'
      : 'Use an empty tool_calls array when no tool call is available.',
    wantsJson ? 'The caller requested JSON content. Put the requested JSON object as a string in the content field.' : '',
    tools.length ? 'Only call tools listed in Available tools.' : 'No tools are available; return final assistant content only.',
    '',
    '# Messages',
    JSON.stringify(messages, null, 2),
    tools.length ? `\n# Available tools\n${JSON.stringify(tools, null, 2)}` : '',
  ].filter(Boolean).join('\n')
}

function runCliModel(input: {
  transport: 'codex_local' | 'claude_code_local'
  model: string
  prompt: string
  timeoutMs: number
  signal?: AbortSignal
}) {
  const command = input.transport === 'claude_code_local' ? 'claude' : 'codex'
  const args = input.transport === 'claude_code_local'
    ? buildClaudeArgs(input.model)
    : buildCodexArgs(input.model)
  return runProcess({
    command,
    args,
    stdin: input.prompt,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  })
}

function buildCodexArgs(model: string): string[] {
  const args = [
    'exec',
    '--json',
    '--disable',
    'plugins',
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
  ]
  if (model) args.push('--model', model)
  args.push('-')
  return args
}

function buildClaudeArgs(model: string): string[] {
  const args = [
    '--print',
    '-',
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--tools',
    '',
  ]
  if (model) args.push('--model', model)
  return args
}

function runProcess(input: {
  command: string
  args: string[]
  stdin: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  aborted: boolean
}> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(input.command, input.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })
    const finish = (result: {
      exitCode: number | null
      signal: NodeJS.Signals | null
      timedOut: boolean
      aborted: boolean
    }) => {
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
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
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

function parseCliText(transport: 'codex_local' | 'claude_code_local', stdout: string): string {
  return transport === 'claude_code_local'
    ? parseClaudeOutput(stdout)
    : parseCodexOutput(stdout)
}

function parseCodexOutput(stdout: string): string {
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
      // Keep robust fallback for non-JSON diagnostics.
    }
  }
  return summary
}

function parseClaudeOutput(stdout: string): string {
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
  return summary
}

function parseModelEnvelope(rawText: string, options: Record<string, any>) {
  const text = stripCodeFence(rawText.trim())
  const parsed = parseJsonObject(text)
  const expectsToolEnvelope = Array.isArray(options.tools) && options.tools.length > 0
  if (!parsed) {
    if (expectsToolEnvelope) {
      throw new Error(`Local CLI model returned invalid task tool envelope: ${previewText(rawText)}`)
    }
    return { content: rawText, toolCalls: [], finishReason: null }
  }

  if (!('content' in parsed) && !('tool_calls' in parsed) && !('toolCalls' in parsed)) {
    if (expectsToolEnvelope) {
      throw new Error(`Local CLI model returned JSON without content/tool_calls envelope: ${previewText(rawText)}`)
    }
    return {
      content: options.response_format?.type === 'json_object' ? JSON.stringify(parsed) : rawText,
      toolCalls: [],
      finishReason: null,
    }
  }

  return {
    content: typeof parsed.content === 'string' ? parsed.content : '',
    toolCalls: normalizeToolCalls(parsed.tool_calls ?? parsed.toolCalls),
    finishReason: null,
  }
}

function normalizeToolCalls(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((call) => {
    if (!call || typeof call !== 'object') return []
    const record = call as Record<string, any>
    const fn = record.function && typeof record.function === 'object' ? record.function : record
    const name = typeof fn.name === 'string' ? fn.name : ''
    if (!name) return []
    const args = typeof fn.arguments === 'string'
      ? fn.arguments
      : JSON.stringify(fn.arguments ?? {})
    return [{
      id: typeof record.id === 'string' && record.id ? record.id : `call_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      type: 'function',
      function: { name, arguments: args },
    }]
  })
}

function stripCodeFence(value: string): string {
  const match = value.match(/^```(?:json)?\s*([\s\S]*?)```$/i)
  return match ? match[1].trim() : value
}

function parseJsonObject(value: string): Record<string, any> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    const match = value.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      const parsed = JSON.parse(match[0])
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }
}

function previewText(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 500 ? `${compact.slice(0, 500)}...` : compact || '(empty)'
}

function normalizeTransport(value: unknown): 'codex_local' | 'claude_code_local' | null {
  return value === 'codex_local' || value === 'claude_code_local' ? value : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function positiveNumber(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback
}

function transportLabel(transport: 'codex_local' | 'claude_code_local'): string {
  return transport === 'claude_code_local' ? 'Claude Code' : 'Codex'
}
