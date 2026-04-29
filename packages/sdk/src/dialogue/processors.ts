import type { UserInput } from '@her-text/types'
import type { LLMProvider } from '@her-text/core'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { AgentCore } from '../agent/index.js'
import type { ContextManager, ResponseItem, TruncationPolicy } from '../context/index.js'
import { PromptBuilder } from '../prompt/index.js'
import { PROMPTS } from '../prompts.js'
import type { TaskSession } from '../session/session.js'
import type { StreamOptions } from './index.js'

export interface ParsedEmotionalResponse {
  reply: string
  hasTask: boolean
  taskDescription?: string
}

export interface DialogueTurnContext {
  memoryContext: Awaited<ReturnType<MemoryEngine['retrieve']>>
  personality: ReturnType<PersonalityEngine['getPersonality']>
  tools: ReturnType<AgentCore['getTools']>
  hasTools: boolean
}

export class LLMContextAggregator {
  constructor(
    private readonly memory: MemoryEngine,
    private readonly personality: PersonalityEngine,
    private readonly agent: AgentCore,
    private readonly context: ContextManager,
    private readonly truncationPolicy: TruncationPolicy
  ) {}

  async prepareUserTurn(input: UserInput, signal?: AbortSignal): Promise<DialogueTurnContext> {
    throwIfAborted(signal)
    const memoryContext = await this.memory.retrieve(input.text)
    throwIfAborted(signal)

    const userMessage: ResponseItem = {
      role: 'user',
      content: input.text,
      timestamp: input.timestamp,
    }
    this.context.recordItems([userMessage], this.truncationPolicy)

    const personality = this.personality.getPersonality()
    const tools = this.agent.getTools()

    return {
      memoryContext,
      personality,
      tools,
      hasTools: tools.length > 0,
    }
  }
}

export interface LLMProcessorRunOptions {
  turnContext: DialogueTurnContext
  streamOptions?: StreamOptions
  phase: 'reply' | 'task_result'
  detectTask: boolean
  additionalUserMessage?: string
  currentContext: ResponseItem[]
  baseInstructions: string
  pluginPromptAdditions?: string[]
}

export interface LLMProcessorRunResult {
  stream: AsyncGenerator<string>
  readonly reply: string
  readonly hasTask: boolean
  readonly taskDescription?: string
}

export class LLMProcessor {
  constructor(private readonly llm: LLMProvider) {}

  async runEmotionalLayer(options: LLMProcessorRunOptions): Promise<LLMProcessorRunResult> {
    const {
      turnContext,
      streamOptions,
      phase,
      detectTask,
      additionalUserMessage,
      currentContext,
      baseInstructions,
      pluginPromptAdditions,
    } = options

    const { system, messages } = PromptBuilder.build(
      currentContext,
      {
        tools: detectTask ? turnContext.tools : [],
        personality: turnContext.personality,
        baseInstructions: {
          system: baseInstructions,
        },
        userProfile: turnContext.memoryContext.userProfile,
        summaries: turnContext.memoryContext.summaries,
        pluginPromptAdditions,
      }
    )

    const fullMessages = [
      { role: 'system', content: system },
      ...messages,
    ]

    if (additionalUserMessage) {
      fullMessages.push({ role: 'user', content: additionalUserMessage })
    }

    console.log(`\n========== 🎭 情感层调用 (detectTask: ${detectTask}) ==========`)

    let fullResponse = ''
    let finalReply = ''
    let hasTask = false
    let taskDescription: string | undefined

    const streamGenerator = async function* (self: LLMProcessor): AsyncGenerator<string> {
      for await (const chunk of self.llm.streamChat(fullMessages, {
        max_tokens: 2048,
        signal: streamOptions?.signal,
      })) {
        throwIfAborted(streamOptions?.signal)
        fullResponse += chunk

        const replyStart = fullResponse.indexOf('<reply>')
        if (replyStart === -1) {
          continue
        }

        const contentStart = replyStart + '<reply>'.length
        const replyEnd = fullResponse.indexOf('</reply>', contentStart)
        const rawVisibleReply = replyEnd === -1
          ? fullResponse.slice(contentStart)
          : fullResponse.slice(contentStart, replyEnd)

        const visibleReply = stripTrailingXmlFragment(rawVisibleReply)
        const delta = visibleReply.slice(finalReply.length)
        if (!delta) {
          continue
        }

        finalReply = visibleReply
        await streamOptions?.onDisplayChunk?.(phase, delta, visibleReply)
        throwIfAborted(streamOptions?.signal)
        yield delta
      }

      const parsed = parseEmotionalResponse(fullResponse, detectTask)
      finalReply = parsed.reply
      hasTask = parsed.hasTask
      taskDescription = parsed.taskDescription

      console.log('解析结果:')
      console.log('  Reply:', parsed.reply.substring(0, 50) + (parsed.reply.length > 50 ? '...' : ''))
      console.log('  Has Task:', parsed.hasTask)
      console.log('  Task Description:', parsed.taskDescription || '(无)')
      console.log('==========================================\n')
    }

    const stream = streamGenerator(this)
    return {
      stream,
      get reply() { return finalReply },
      get hasTask() { return hasTask },
      get taskDescription() { return taskDescription },
    }
  }
}

export interface ToolProcessorResult {
  success: boolean
  summary: string
  error?: string
  contextResult: {
    task: string
    success: boolean
    summary: string
    error?: string
  }
}

export class ToolProcessor {
  constructor(private readonly taskSession: TaskSession) {}

  async processTask(taskDescription: string, originalUserInput: string): Promise<ToolProcessorResult> {
    const taskResult = await this.taskSession.runTask(taskDescription, originalUserInput)
    const contextResult = {
      task: taskDescription,
      success: taskResult.success,
      summary: taskResult.finalMessage,
      ...(taskResult.error ? { error: taskResult.error } : {}),
    }

    return {
      success: taskResult.success,
      summary: taskResult.finalMessage,
      ...(taskResult.error ? { error: taskResult.error } : {}),
      contextResult,
    }
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Interrupted', 'AbortError')
  }
}

function stripTrailingXmlFragment(text: string): string {
  return text.replace(/<[^>]*$/, '')
}

function parseEmotionalResponse(response: string, detectTask: boolean = true): ParsedEmotionalResponse {
  const result: ParsedEmotionalResponse = {
    reply: response,
    hasTask: false,
  }

  try {
    const replyMatch = response.match(/<reply>([\s\S]*?)<\/reply>/)
    if (replyMatch) {
      result.reply = replyMatch[1].trim()
    }

    if (detectTask) {
      const taskMatch = response.match(/<task>([\s\S]*?)<\/task>/)
      if (taskMatch) {
        const taskContent = taskMatch[1]
        const hasTaskMatch = taskContent.match(/<has_task>(true|false)<\/has_task>/)
        if (hasTaskMatch) {
          result.hasTask = hasTaskMatch[1] === 'true'
        }

        if (result.hasTask) {
          const descMatch = taskContent.match(/<description>([\s\S]*?)<\/description>/)
          if (descMatch) {
            result.taskDescription = descMatch[1].trim()
          }
        }
      }
    }
  } catch (error) {
    console.warn('Failed to parse emotional response:', error)
  }

  return result
}

export function buildBaseInstructions(): string {
  return PROMPTS.dialogue.basePersonality
}
