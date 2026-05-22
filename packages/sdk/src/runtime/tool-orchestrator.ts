/**
 * Executes routed work tools behind explicit policy and failure boundaries.
 */
import type { Tool } from '../tools/types.js'
import type { RuntimeEventBus } from './events.js'
import { ToolRouter, type RoutedToolCall, type RoutedToolKind, type WorkToolCall } from './tool-router.js'

export type ToolPolicyDecision = 'allow' | 'deny'

export interface ToolPolicyResult {
  decision: ToolPolicyDecision
  reason?: string
}

export interface ToolExecutionPolicies {
  approve?: (call: RoutedToolCall) => Promise<ToolPolicyResult> | ToolPolicyResult
  sandbox?: (call: RoutedToolCall) => Promise<ToolPolicyResult> | ToolPolicyResult
  network?: (call: RoutedToolCall) => Promise<ToolPolicyResult> | ToolPolicyResult
  retry?: ToolRetryPolicy
}

export interface ToolRetryPolicy {
  attempts: number
  retryableKinds?: RoutedToolKind[]
}

export interface ToolExecutionContext {
  threadId: string
  taskId: string
  taskDescription: string
  stepId?: string
  signal?: AbortSignal
}

export interface ToolExecutionResult {
  call: RoutedToolCall
  success: boolean
  result?: unknown
  error?: NormalizedToolFailure
  attempts: number
  startedAt: number
  completedAt: number
}

export interface NormalizedToolFailure {
  kind: 'unknown_tool' | 'invalid_arguments' | 'policy_denied' | 'cancelled' | 'execution_failed'
  message: string
  retryable: boolean
  cause?: unknown
}

export interface ToolOrchestratorOptions {
  events: RuntimeEventBus
  tools?: Tool[]
  router?: ToolRouter
  policies?: ToolExecutionPolicies
  defaultTimeoutMs?: number
}

export class ToolOrchestrator {
  private tools = new Map<string, Tool>()
  private router: ToolRouter

  constructor(private options: ToolOrchestratorOptions) {
    this.router = options.router ?? new ToolRouter(options.tools ?? [])
    this.setTools(options.tools ?? [])
  }

  setTools(tools: Tool[]): void {
    this.tools.clear()
    for (const tool of tools) {
      this.tools.set(tool.name, tool)
    }
    if (!this.options.router) {
      this.router.setTools(tools)
    }
  }

  getToolRouter(): ToolRouter {
    return this.router
  }

  async executeCalls(calls: WorkToolCall[], context: ToolExecutionContext): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = []
    for (const call of calls) {
      results.push(await this.executeCall(call, context))
    }
    return results
  }

  async executeCall(call: WorkToolCall, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const routedCall = this.router.route(call)
    const startedAt = Date.now()
    this.emitToolStarted(routedCall, context)

    const finish = (success: boolean, attempts: number, result?: unknown, error?: NormalizedToolFailure): ToolExecutionResult => {
      const completedAt = Date.now()
      if (success) {
        this.options.events.emit({
          name: 'task.tool.completed',
          threadId: context.threadId,
          taskId: context.taskId,
          payload: {
            toolName: routedCall.name,
            callId: routedCall.id,
            taskDescription: context.taskDescription,
            success: true,
            summary: summarizeToolResult(result),
          },
        })
      } else {
        this.options.events.emit({
          name: 'task.tool.failed',
          threadId: context.threadId,
          taskId: context.taskId,
          payload: {
            toolName: routedCall.name,
            callId: routedCall.id,
            taskDescription: context.taskDescription,
            error: error?.message ?? 'Tool execution failed',
          },
        })
      }
      return { call: routedCall, success, result, error, attempts, startedAt, completedAt }
    }

    if (context.signal?.aborted) {
      return finish(false, 0, undefined, createFailure('cancelled', 'Tool call was cancelled before execution', false))
    }

    const policyFailure = await this.evaluatePolicies(routedCall)
    if (policyFailure) {
      return finish(false, 0, undefined, policyFailure)
    }

    const tool = this.tools.get(routedCall.name)
    if (!tool) {
      return finish(false, 0, undefined, createFailure('unknown_tool', `Unknown tool: ${routedCall.name}`, false))
    }

    const parsedArgs = parseToolArguments(routedCall.arguments)
    if (!parsedArgs.ok) {
      return finish(false, 0, undefined, parsedArgs.failure)
    }

    const maxAttempts = Math.max(1, this.options.policies?.retry?.attempts ?? 1)
    let lastFailure: NormalizedToolFailure | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (context.signal?.aborted) {
        return finish(false, attempt - 1, undefined, createFailure('cancelled', 'Tool call was cancelled', false))
      }
      try {
        const result = await executeToolWithTimeout(
          tool,
          withRuntimeContext(parsedArgs.value, this.options.events, context),
          tool.timeoutMs ?? this.options.defaultTimeoutMs
        )
        if (isFailedToolResult(result)) {
          const failure = createFailure(
            'execution_failed',
            extractToolResultError(result),
            false,
            result
          )
          return finish(false, attempt, result, failure)
        }
        return finish(true, attempt, result)
      } catch (error) {
        lastFailure = normalizeExecutionFailure(error, routedCall, this.options.policies?.retry?.retryableKinds)
        if (attempt >= maxAttempts || !lastFailure.retryable) {
          return finish(false, attempt, undefined, lastFailure)
        }
      }
    }

    return finish(false, maxAttempts, undefined, lastFailure ?? createFailure('execution_failed', 'Tool execution failed', false))
  }

  private emitToolStarted(call: RoutedToolCall, context: ToolExecutionContext): void {
    this.options.events.emit({
      name: 'task.tool.started',
      threadId: context.threadId,
      taskId: context.taskId,
      payload: {
        toolName: call.name,
        callId: call.id,
        taskDescription: context.taskDescription,
        stepId: context.stepId,
      },
    })
  }

  private async evaluatePolicies(call: RoutedToolCall): Promise<NormalizedToolFailure | undefined> {
    const policies = this.options.policies
    const checks = [policies?.approve, policies?.sandbox, policies?.network]
    for (const check of checks) {
      const result = await check?.(call)
      if (result?.decision === 'deny') {
        return createFailure('policy_denied', result.reason ?? `Tool call denied: ${call.name}`, false)
      }
    }
    return undefined
  }
}

function withRuntimeContext(
  args: Record<string, unknown>,
  events: RuntimeEventBus,
  context: ToolExecutionContext
): Record<string, unknown> {
  return {
    ...args,
    __runtime: {
      events,
      context,
    },
  }
}

async function executeToolWithTimeout(
  tool: Tool,
  args: Record<string, unknown>,
  timeoutMs?: number
): Promise<unknown> {
  if (!timeoutMs || timeoutMs <= 0) {
    return tool.execute(args)
  }

  return Promise.race([
    tool.execute(args),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Tool execution timeout')), timeoutMs)
    )
  ])
}

function isFailedToolResult(result: unknown): boolean {
  return Boolean(
    result &&
    typeof result === 'object' &&
    'success' in result &&
    (result as { success?: unknown }).success === false
  )
}

function extractToolResultError(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return 'Tool execution failed'
  }
  const error = (result as { error?: unknown }).error
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return 'Tool execution failed'
}

function parseToolArguments(raw: string): { ok: true, value: Record<string, unknown> } | { ok: false, failure: NormalizedToolFailure } {
  try {
    const parsed = raw.trim() ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, failure: createFailure('invalid_arguments', 'Tool arguments must be a JSON object', false) }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch (error) {
    return { ok: false, failure: createFailure('invalid_arguments', 'Tool arguments are not valid JSON', false, error) }
  }
}

function normalizeExecutionFailure(error: unknown, call: RoutedToolCall, retryableKinds?: RoutedToolKind[]): NormalizedToolFailure {
  const message = error instanceof Error ? error.message : String(error)
  const retryable = new Set<RoutedToolKind>(retryableKinds ?? ['browser', 'desktop', 'mcp'])
  return createFailure('execution_failed', message || `Tool failed: ${call.name}`, retryable.has(call.spec?.kind ?? 'custom'), error)
}

function createFailure(kind: NormalizedToolFailure['kind'], message: string, retryable: boolean, cause?: unknown): NormalizedToolFailure {
  return { kind, message, retryable, cause }
}

function summarizeToolResult(result: unknown): string | undefined {
  if (result === undefined || result === null) {
    return undefined
  }
  if (typeof result === 'string') {
    return result.slice(0, 240)
  }
  try {
    return JSON.stringify(result).slice(0, 240)
  } catch {
    return String(result).slice(0, 240)
  }
}
