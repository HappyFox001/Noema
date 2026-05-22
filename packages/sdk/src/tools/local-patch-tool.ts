/**
 * Built-in local tool for applying structured file patches.
 */
import type { Tool } from './types.js'
import { RuntimeEventBus, PatchRuntime, type ToolExecutionContext } from '../runtime/index.js'
import { createTool } from './local-tool-factory.js'

type ToolRuntimeContext = {
  events: RuntimeEventBus
  context: ToolExecutionContext
}

const fallbackEvents = new RuntimeEventBus(50)
const patchRuntimes = new WeakMap<RuntimeEventBus, PatchRuntime>()

export function createPatchTools(): Tool[] {
  return [createApplyPatchTool()]
}

function createApplyPatchTool(): Tool {
  return createTool({
    name: 'apply_patch',
    description: 'Apply a work-tool-style patch to local files after reading relevant context. If the patch fails, read the target area and retry with a smaller precise patch.',
    safety: 'write',
    parameters: {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description: 'The complete patch text.',
        },
      },
      required: ['patch'],
    },
    execute: async ({ patch, __runtime }) => {
      const runtime = getPatchRuntime(__runtime)
      const context = getRuntimeContext(__runtime)
      const result = await runtime.applyStructured({
        patch: String(patch || ''),
        cwd: process.cwd(),
        taskId: context.taskId,
        threadId: context.threadId,
      })
      return {
        success: result.success,
        result: {
          patch_id: result.id,
          changes: result.changedFiles.map(file_path => ({ type: 'change', file_path })),
          changed_files: result.changedFiles,
          stdout: result.stdout,
          stderr: result.stderr,
          ...(result.error ? { error: result.error } : {}),
        },
        ...(result.error ? { error: result.error.message } : {}),
      }
    },
  })
}

function getPatchRuntime(runtime: unknown): PatchRuntime {
  const events = getToolRuntime(runtime).events
  const existing = patchRuntimes.get(events)
  if (existing) {
    return existing
  }
  const next = new PatchRuntime({ events })
  patchRuntimes.set(events, next)
  return next
}

function getRuntimeContext(runtime: unknown): ToolExecutionContext {
  return getToolRuntime(runtime).context
}

function getToolRuntime(runtime: unknown): ToolRuntimeContext {
  if (
    runtime &&
    typeof runtime === 'object' &&
    (runtime as ToolRuntimeContext).events instanceof RuntimeEventBus &&
    (runtime as ToolRuntimeContext).context &&
    typeof (runtime as ToolRuntimeContext).context === 'object'
  ) {
    return runtime as ToolRuntimeContext
  }
  return {
    events: fallbackEvents,
    context: {
      taskId: 'local-patch',
      threadId: 'local-patch',
      taskDescription: 'Local patch',
    },
  }
}
