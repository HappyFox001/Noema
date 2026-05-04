import type { SDKConfig, UserInput, AgentResponse } from '@her-text/types'
import { MemoryEngine } from './memory/index.js'
import { PersonalityEngine } from './personality/index.js'
import { AgentCore } from './agent/index.js'
import { DialogueOrchestrator } from './dialogue/index.js'
import { ContextManager } from './context/index.js'
import { createLLMProvider, type LLMProvider } from '@her-text/core'
import type { PluginRuntimeContext, SDKPlugin, TextTransformTarget } from './plugins/index.js'
import type { TaskRuntimeHooks } from './session/task.js'

export interface HerTextSDKInitializeOptions {
  plugins?: SDKPlugin[]
  onTaskUserInputRequest?: TaskRuntimeHooks['onUserInputRequest']
  onTaskPlanUpdated?: TaskRuntimeHooks['onPlanUpdated']
  onTaskStepUpdated?: TaskRuntimeHooks['onStepUpdated']
}


export class HerTextSDK {
  public memory: MemoryEngine
  public personality: PersonalityEngine
  public agent: AgentCore
  private dialogue: DialogueOrchestrator
  private llm: LLMProvider
  private taskLLm: LLMProvider

  private constructor(config: SDKConfig, options: HerTextSDKInitializeOptions = {}) {
    this.llm = createLLMProvider(config.llm)
    this.taskLLm = createLLMProvider(config.taskLLM ?? config.llm)

    this.memory = new MemoryEngine(config.memory, this.llm)
    this.personality = new PersonalityEngine(config.personality)
    this.agent = new AgentCore()

    this.dialogue = new DialogueOrchestrator(
      this.llm,
      this.taskLLm,
      this.memory,
      this.personality,
      this.agent,
      config.memory.storageDir,
      {
        taskRuntime: config.taskRuntime,
        onTaskUserInputRequest: options.onTaskUserInputRequest,
        onTaskPlanUpdated: options.onTaskPlanUpdated,
        onTaskStepUpdated: options.onTaskStepUpdated
      },
      options.plugins ?? []
    )
  }

  static async initialize(
    config: SDKConfig,
    options: HerTextSDKInitializeOptions = {}
  ): Promise<HerTextSDK> {
    const sdk = new HerTextSDK(config, options)
    await sdk.memory.initialize()
    await sdk.dialogue.initialize()
    return sdk
  }

  
  async chat(input: UserInput): Promise<AgentResponse> {
    const chunks: string[] = []
    for await (const chunk of this.dialogue.processUserInputStream(input)) {
      chunks.push(chunk)
    }

    return {
      text: chunks.join(''),
      shouldSpeak: true
    }
  }

  
  async *chatStream(
    input: UserInput,
    options?: import('./dialogue/index.js').StreamOptions
  ): AsyncGenerator<string> {
    yield* this.dialogue.processUserInputStream(input, options)
  }

  
  getContext(): ContextManager {
    return this.dialogue.getContext()
  }

  
  getStats() {
    return this.dialogue.getStats()
  }

  transformText(
    target: TextTransformTarget,
    text: string,
    runtime?: PluginRuntimeContext
  ): string {
    return this.dialogue.transformText(target, text, runtime)
  }

  
  clearHistory(): void {
    this.dialogue.clearHistory()
  }

  
  getLLM(): LLMProvider {
    return this.llm
  }

  getTaskLLM(): LLMProvider {
    return this.taskLLm
  }

  
  async shutdown(): Promise<void> {
    await this.dialogue.shutdown()
    await this.memory.shutdown()
  }
}

export * from './memory/index.js'
export * from './personality/index.js'
export * from './agent/index.js'
export * from './dialogue/index.js'
export * from './context/index.js'
export * from './prompt/index.js'
export * from './tools/index.js'
export * from './audio/index.js'
export * from './session/session.js'
export * from './session/task.js'
export * from './session/task-plan.js'
export * from './vad/index.js'
export * from './turn/index.js'
export * from './plugins/index.js'
