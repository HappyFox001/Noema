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
import { wrapTaskLLMWithRuntimeTransport } from './session/cli-task-llm.js'
import {
  RuntimeEventBus,
  RuntimeJobManager,
  InteractionRuntime,
  LongRunRuntime,
  type InteractionResolveResult,
  type OutputStateSnapshot,
  type RuntimeCapabilityContext,
  type RuntimeEventHandler,
  type WorkThread,
  WorkStateStore,
} from './runtime/index.js'

export interface HerTextSDKInitializeOptions {
  plugins?: SDKPlugin[]
  selfLearningEnabled?: boolean
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
  public interaction: InteractionRuntime
  public workState: WorkStateStore
  public longRuns: LongRunRuntime
  public runtime: RuntimeCapabilityContext
  public learning: LearningAssetStore
  public reflection: ReflectionEngine
  public personaContinuity: PersonaContinuityPolicy
  public learningAutomation: LearningAutomationRuntime
  public agentSociety: AgentSocietyRuntime
  private dialogue: DialogueOrchestrator
  private llm: LLMProvider
  private taskLLm: LLMProvider
  private selfLearningEnabled: boolean

  private constructor(config: SDKConfig, options: HerTextSDKInitializeOptions = {}) {
    this.selfLearningEnabled = options.selfLearningEnabled !== false
    this.llm = createLLMProvider(config.llm, { defaultReasoningMode: 'minimal-or-none' })
    this.taskLLm = wrapTaskLLMWithRuntimeTransport(
      createLLMProvider(config.taskLLM ?? config.llm),
      config.taskRuntime
    )

    this.memory = new MemoryEngine(config.memory, this.llm)
    this.personality = new PersonalityEngine(config.personality)
    this.agent = new AgentCore()
    this.runtimeEvents = new RuntimeEventBus()
    this.runtimeJobs = new RuntimeJobManager(this.runtimeEvents)
    this.interaction = new InteractionRuntime()
    this.workState = new WorkStateStore(config.memory.storageDir)
    this.longRuns = new LongRunRuntime()
    this.learning = new LearningAssetStore(config.memory.storageDir)
    this.reflection = new ReflectionEngine(this.learning)
    this.personaContinuity = new PersonaContinuityPolicy()
    this.agentSociety = new AgentSocietyRuntime({
      storageDir: config.memory.storageDir,
      agentCore: this.agent,
      memory: this.memory,
      runtimeEvents: this.runtimeEvents,
      runtimeJobs: this.runtimeJobs,
    })
    this.runtime = {
      llm: this.llm,
      taskLLM: this.taskLLm,
      agentCore: this.agent,
      memory: this.memory,
      personality: this.personality,
      runtimeEvents: this.runtimeEvents,
      runtimeJobs: this.runtimeJobs,
      workState: this.workState,
      longRuns: this.longRuns,
      learning: this.learning,
      reflection: this.reflection,
      personaContinuity: this.personaContinuity,
      agentSociety: this.selfLearningEnabled ? this.agentSociety : undefined,
    }
    this.learningAutomation = new LearningAutomationRuntime(
      this.runtime,
      options.learningAutomation
    )
    if (options.onRuntimeEvent) {
      this.runtimeEvents.subscribe(options.onRuntimeEvent)
    }
    if (this.selfLearningEnabled) {
      this.runtimeEvents.subscribe((event) => {
        this.learning.recordRuntimeEvent(event)
      })
    }

    this.dialogue = new DialogueOrchestrator(
      this.llm,
      this.taskLLm,
      this.memory,
      this.personality,
      this.agent,
      config.memory.storageDir,
      {
        runtimeEvents: this.runtimeEvents,
        runtimeJobs: this.runtimeJobs,
        workState: this.workState,
        learning: this.selfLearningEnabled ? this.learning : undefined,
        agentSociety: this.selfLearningEnabled ? this.agentSociety : undefined,
        taskRuntime: config.taskRuntime,
        onTaskUserInputRequest: options.onTaskUserInputRequest,
        onTaskRunStateChanged: options.onTaskRunStateChanged,
        onTaskPlanUpdated: options.onTaskPlanUpdated,
        onTaskStepUpdated: options.onTaskStepUpdated
      },
      options.plugins ?? []
    )
    this.runtime.conversationContext = this.dialogue.getContext()
  }

  static async initialize(
    config: SDKConfig,
    options: HerTextSDKInitializeOptions = {}
  ): Promise<HerTextSDK> {
    const sdk = new HerTextSDK(config, options)
    await sdk.memory.initialize()
    await sdk.workState.initialize()
    if (sdk.selfLearningEnabled) {
      await sdk.learning.initialize()
      await sdk.agentSociety.initialize()
    }
    await sdk.dialogue.initialize()
    if (sdk.selfLearningEnabled) {
      sdk.learningAutomation.start()
    }
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

  async resumeWorkThread(threadId?: string, reason?: string): Promise<WorkThread | null> {
    return this.dialogue.resumeWorkThread(threadId, reason)
  }

  resolveInteraction(
    input: UserInput,
    outputState: OutputStateSnapshot
  ): InteractionResolveResult {
    this.runtimeEvents.emit({
      name: 'interaction.input.received',
      payload: {
        userInput: input.text,
        inputTimestamp: input.timestamp,
        source: 'text',
      },
    })
    const result = this.interaction.resolve({
      userInput: input.text,
      workState: this.workState.getSnapshot(),
      outputState,
      timestamp: input.timestamp,
    })
    this.runtimeEvents.emit({
      name: 'interaction.intent.resolved',
      payload: {
        userInput: input.text,
        intents: result.intents,
        interruptionKind: result.interruptionKind,
      },
    })
    for (const intent of result.intents) {
      if (intent.kind === 'speech.stop') {
        this.runtimeEvents.emit({
          name: 'interaction.speech.stop_requested',
          payload: { reason: intent.reason },
        })
      } else if (intent.kind === 'speech.mute' || intent.kind === 'speech.unmute') {
        this.runtimeEvents.emit({
          name: 'interaction.speech.mute_requested',
          payload: {
            muted: intent.kind === 'speech.mute',
            reason: intent.reason,
          },
        })
      } else if (intent.kind === 'work.modify') {
        this.runtimeEvents.emit({
          name: 'interaction.work.modify_requested',
          threadId: intent.targetThreadId,
          payload: {
            targetThreadId: intent.targetThreadId,
            modification: intent.modification || input.text,
            reason: intent.reason,
          },
        })
      } else if (intent.kind === 'work.status') {
        this.runtimeEvents.emit({
          name: 'interaction.work.status_requested',
          threadId: intent.targetThreadId,
          payload: {
            targetThreadId: intent.targetThreadId,
            reason: intent.reason,
          },
        })
      } else if (intent.kind === 'work.resume') {
        this.runtimeEvents.emit({
          name: 'interaction.work.resume_requested',
          threadId: intent.targetThreadId,
          payload: {
            targetThreadId: intent.targetThreadId,
            reason: intent.reason,
          },
        })
      } else if (intent.kind === 'work.cancel') {
        this.runtimeEvents.emit({
          name: 'interaction.work.cancel_requested',
          threadId: intent.targetThreadId,
          payload: {
            targetThreadId: intent.targetThreadId,
            reason: intent.reason,
          },
        })
      }
    }
    return result
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
    await this.workState.flush()
    await this.dialogue.shutdown()
    await this.learningAutomation.shutdown()
    await this.runtimeJobs.waitForIdle()
    await this.memory.shutdown()
    if (this.selfLearningEnabled) {
      await this.learning.shutdown()
      await this.agentSociety.shutdown()
    }
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
export * from './session/cli-task-llm.js'
export * from './session/runtime-adapter.js'
export * from './session/task-plan.js'
export * from './session/execution-state.js'
export * from './vad/index.js'
export * from './turn/index.js'
export * from './plugins/index.js'
export * from './runtime/index.js'
export * from './learning/index.js'
export * from './agent-society/index.js'
export * from './work-surface/index.js'
