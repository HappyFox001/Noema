import type { SDKConfig, UserInput, AgentResponse } from '@her-text/types'
import { MemoryEngine } from './memory/index.js'
import { PersonalityEngine } from './personality/index.js'
import { AgentCore } from './agent/index.js'
import { DialogueOrchestrator } from './dialogue/index.js'
import { ContextManager } from './context/index.js'
import { AgentSocietyRuntime } from './agent-society/index.js'
import {
  LearningAssetStore,
  LearningAutomationRuntime,
  PersonaContinuityPolicy,
  ReflectionEngine,
  type LearningAutomationRuntimeOptions,
} from './learning/index.js'
import { createLLMProvider, type LLMProvider } from '@her-text/core'
import type { PluginRuntimeContext, SDKPlugin, TextTransformTarget } from './plugins/index.js'
import type { TaskRuntimeHooks } from './session/task.js'
import { RuntimeEventBus, RuntimeJobManager, type RuntimeEventHandler } from './runtime/index.js'

export interface HerTextSDKInitializeOptions {
  plugins?: SDKPlugin[]
  onRuntimeEvent?: RuntimeEventHandler
  onTaskUserInputRequest?: TaskRuntimeHooks['onUserInputRequest']
  onTaskRunStateChanged?: TaskRuntimeHooks['onRunStateChanged']
  onTaskPlanUpdated?: TaskRuntimeHooks['onPlanUpdated']
  onTaskStepUpdated?: TaskRuntimeHooks['onStepUpdated']
  learningAutomation?: LearningAutomationRuntimeOptions
}


export class HerTextSDK {
  public memory: MemoryEngine
  public personality: PersonalityEngine
  public agent: AgentCore
  public runtimeEvents: RuntimeEventBus
  public runtimeJobs: RuntimeJobManager
  public learning: LearningAssetStore
  public reflection: ReflectionEngine
  public personaContinuity: PersonaContinuityPolicy
  public learningAutomation: LearningAutomationRuntime
  public agentSociety: AgentSocietyRuntime
  private dialogue: DialogueOrchestrator
  private llm: LLMProvider
  private taskLLm: LLMProvider

  private constructor(config: SDKConfig, options: HerTextSDKInitializeOptions = {}) {
    this.llm = createLLMProvider(config.llm, { defaultReasoningMode: 'minimal-or-none' })
    this.taskLLm = createLLMProvider(config.taskLLM ?? config.llm)

    this.memory = new MemoryEngine(config.memory, this.llm)
    this.personality = new PersonalityEngine(config.personality)
    this.agent = new AgentCore()
    this.runtimeEvents = new RuntimeEventBus()
    this.runtimeJobs = new RuntimeJobManager(this.runtimeEvents)
    this.learning = new LearningAssetStore(config.memory.storageDir)
    this.reflection = new ReflectionEngine(this.learning)
    this.personaContinuity = new PersonaContinuityPolicy()
    this.agentSociety = new AgentSocietyRuntime({
      storageDir: config.memory.storageDir,
      agentCore: this.agent,
      memory: this.memory,
      runtimeEvents: this.runtimeEvents,
    })
    this.learningAutomation = new LearningAutomationRuntime(
      this.runtimeEvents,
      this.runtimeJobs,
      this.learning,
      this.reflection,
      this.personaContinuity,
      this.agentSociety,
      options.learningAutomation
    )
    if (options.onRuntimeEvent) {
      this.runtimeEvents.subscribe(options.onRuntimeEvent)
    }
    this.runtimeEvents.subscribe((event) => {
      this.learning.recordRuntimeEvent(event)
    })

    this.dialogue = new DialogueOrchestrator(
      this.llm,
      this.taskLLm,
      this.memory,
      this.personality,
      this.agent,
      config.memory.storageDir,
      {
        runtimeEvents: this.runtimeEvents,
        learning: this.learning,
        agentSociety: this.agentSociety,
        taskRuntime: config.taskRuntime,
        onTaskUserInputRequest: options.onTaskUserInputRequest,
        onTaskRunStateChanged: options.onTaskRunStateChanged,
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
    await sdk.learning.initialize()
    await sdk.agentSociety.initialize()
    await sdk.dialogue.initialize()
    sdk.learningAutomation.start()
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
    await this.learningAutomation.shutdown()
    await this.runtimeJobs.waitForIdle()
    await this.memory.shutdown()
    await this.learning.shutdown()
    await this.agentSociety.shutdown()
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
export * from './session/runtime-adapter.js'
export * from './session/task-plan.js'
export * from './session/execution-state.js'
export * from './vad/index.js'
export * from './turn/index.js'
export * from './plugins/index.js'
export * from './runtime/index.js'
export * from './learning/index.js'
export * from './agent-society/index.js'
