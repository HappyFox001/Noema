/**
 * Shared host capability context for internal runtime jobs.
 */
import type { LLMProvider } from '@her-text/core'
import type { AgentCore } from '../agent/index.js'
import type { AgentSocietyRuntime } from '../agent-society/index.js'
import type { ContextManager } from '../context/index.js'
import type {
  LearningAssetStore,
  PersonaContinuityPolicy,
  ReflectionEngine,
} from '../learning/index.js'
import type { MemoryEngine } from '../memory/index.js'
import type { PersonalityEngine } from '../personality/index.js'
import type { RuntimeEventBus } from './events.js'
import type { RuntimeJobManager } from './jobs.js'
import type { LongRunRuntime } from './long-run-runtime.js'
import type { WorkStateStore } from './work-store.js'

export interface RuntimeCapabilityContext {
  llm: LLMProvider
  taskLLM: LLMProvider
  agentCore: AgentCore
  memory: MemoryEngine
  personality: PersonalityEngine
  conversationContext?: ContextManager
  runtimeEvents: RuntimeEventBus
  runtimeJobs: RuntimeJobManager
  workState: WorkStateStore
  longRuns?: LongRunRuntime
  learning: LearningAssetStore
  reflection: ReflectionEngine
  personaContinuity: PersonaContinuityPolicy
  agentSociety?: AgentSocietyRuntime
}
