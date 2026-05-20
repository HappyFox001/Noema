const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

describe('runtime interaction routing', () => {
  test('speech stop does not become work cancellation', async () => {
    const { InteractionRuntime } = await import('../dist/runtime/index.js')
    const runtime = new InteractionRuntime()
    const result = runtime.resolve({
      userInput: '停一下',
      timestamp: Date.now(),
      workState: {
        activeThreads: [{ id: 'thread-1', goal: 'task', status: 'active', priority: 1, createdAt: 1, updatedAt: 1, userIntentHistory: [], emotionalTurnHistory: [], observations: [], artifacts: [], decisions: [], failures: [], nextActions: [] }],
        pausedThreads: [],
        abandonedThreads: [],
        completedThreads: [],
        focusedThreadId: 'thread-1',
        updatedAt: Date.now(),
      },
      outputState: { speaking: true, muted: false },
    })

    expect(result.interruptionKind).toBe('speech_stop')
    expect(result.intents).toEqual([{ kind: 'speech.stop', reason: 'User requested speech output to stop.' }])
  })
})

describe('tool router', () => {
  test('separates visible and deferred tools while preserving capability metadata', async () => {
    const { ToolRouter } = await import('../dist/runtime/index.js')
    const router = new ToolRouter([
      createTool({ name: 'exec_command', description: 'Run shell commands', safety: 'write' }),
      createTool({ name: 'browser_open', description: 'Open browser', pluginId: 'browser', safety: 'read' }),
      createTool({ name: 'computer_observe', description: 'Observe desktop', pluginId: 'computer-use', safety: 'read' }),
      createTool({ name: 'mcp_call_tool', description: 'Call remote tool', pluginId: 'mcp-manager', safety: 'external' }),
      createTool({ name: 'skills_read', description: 'Read skill', pluginId: 'skills-manager', safety: 'read' }),
      createTool({ name: 'tool_search', description: 'Discover tools', deferLoading: true, safety: 'safe' }),
    ])

    expect(router.listModelVisibleTools().map(tool => tool.name)).toEqual(['exec_command', 'browser_open', 'computer_observe', 'mcp_call_tool', 'skills_read'])
    expect(router.listDiscoverableTools().map(tool => tool.name)).toEqual(['tool_search'])
    expect(router.find('exec_command').kind).toBe('shell')
    expect(router.find('browser_open').kind).toBe('browser')
    expect(router.find('computer_observe').kind).toBe('desktop')
    expect(router.find('mcp_call_tool').kind).toBe('mcp')
    expect(router.find('skills_read').kind).toBe('skill')
    expect(router.find('browser_open').supportsParallel).toBe(true)
    expect(router.find('exec_command').supportsParallel).toBe(false)
  })
})

describe('long run runtime', () => {
  test('records keep and discard iterations with auditable artifacts', async () => {
    const { LongRunRuntime } = await import('../dist/runtime/index.js')
    const artifactRoot = await mkdtemp(join(tmpdir(), 'her-text-long-run-'))
    try {
      const runtime = new LongRunRuntime()
      let run = await runtime.createRun({
        goal: 'Reduce errors',
        scope: ['packages/sdk'],
        metric: 'error_count',
        direction: 'minimize',
        verify: 'count errors',
        guard: 'build',
        stopCondition: 'zero errors',
        rollbackPolicy: 'checkpoint_only',
        artifactRoot,
        baseline: { metricValue: 10, measuredAt: Date.now(), command: 'baseline' },
      })

      run = await runtime.runIteration(run, {
        hypothesis: 'remove one error',
        applyFocusedChange: async () => ({ id: 'checkpoint-1', description: 'changed file' }),
        verify: async () => ({ metricValue: 9, measuredAt: Date.now(), command: 'verify' }),
        guard: async () => ({ passed: true }),
      })

      run = await runtime.runIteration(run, {
        hypothesis: 'bad direction',
        applyFocusedChange: async () => ({ id: 'checkpoint-2', description: 'changed file' }),
        verify: async () => ({ metricValue: 11, measuredAt: Date.now(), command: 'verify' }),
        guard: async () => ({ passed: true }),
      })

      expect(run.iterations.map(iteration => iteration.decision)).toEqual(['keep', 'discard'])
      const results = await readFile(join(run.artifactDir, 'results.tsv'), 'utf8')
      expect(results).toContain('checkpoint-1')
      expect(results).toContain('checkpoint-2')
      const resumed = await runtime.resumeRun(run.artifactDir)
      expect(resumed.iterations).toHaveLength(2)
    } finally {
      await rm(artifactRoot, { recursive: true, force: true })
    }
  })
})

describe('work state persistence', () => {
  test('persists recoverable thread facts across store instances', async () => {
    const { WorkStateStore } = await import('../dist/runtime/index.js')
    const storageDir = await mkdtemp(join(tmpdir(), 'her-text-work-state-'))
    try {
      const firstStore = new WorkStateStore(storageDir)
      await firstStore.initialize()
      const thread = await firstStore.createThread('Fix persisted task', { id: 'thread-persisted', now: 1000 })
      await firstStore.recordFailure(thread.id, {
        id: 'failure-1',
        message: 'build failed',
        evidence: ['tsc error'],
        createdAt: 1100,
      })
      await firstStore.flush()

      const secondStore = new WorkStateStore(storageDir)
      await secondStore.initialize()
      const restored = secondStore.getThread(thread.id)

      expect(restored.status).toBe('recoverable_failed')
      expect(restored.failures).toHaveLength(1)
      expect(secondStore.getSnapshot().activeThreads.map(item => item.id)).toContain(thread.id)
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  test('resumes paused work thread from persisted state', async () => {
    const { WorkStateStore } = await import('../dist/runtime/index.js')
    const storageDir = await mkdtemp(join(tmpdir(), 'her-text-work-resume-'))
    try {
      const firstStore = new WorkStateStore(storageDir)
      await firstStore.initialize()
      const thread = await firstStore.createThread('Resume durable task', { id: 'thread-resume', now: 2000 })
      await firstStore.recordNextAction(thread.id, {
        id: 'next-1',
        title: 'Continue from saved step',
        reason: 'resume test',
        createdAt: 2100,
      })
      await firstStore.pauseThread(thread.id, 'user switched tasks', 2200)
      await firstStore.flush()

      const secondStore = new WorkStateStore(storageDir)
      await secondStore.initialize()
      expect(secondStore.getSnapshot().pausedThreads.map(item => item.id)).toContain(thread.id)

      const resumed = await secondStore.resumeThread(thread.id, 'user returned', 2300)
      expect(resumed.status).toBe('active')
      expect(resumed.nextActions.at(-1).title).toBe('Continue from saved step')
      expect(secondStore.getSnapshot().focusedThreadId).toBe(thread.id)
      await secondStore.flush()
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})

describe('task interruption semantics', () => {
  test('task cancellation aborts task signal and preserves background command facts', async () => {
    const { CancellationModel, RuntimeEventBus } = await import('../dist/runtime/index.js')
    const events = new RuntimeEventBus()
    const seen = []
    events.subscribe(event => seen.push(event))
    const model = new CancellationModel({ events })
    const signal = model.createAbortSignal('task-1')
    model.recordBackgroundCommand('cmd-1', 'pnpm build')

    const record = model.cancelTask('task-1', 'user cancelled', 'thread-1')

    expect(signal.aborted).toBe(true)
    expect(record.kind).toBe('task_cancel')
    expect(record.backgroundCommands).toEqual([
      expect.objectContaining({ sessionId: 'cmd-1', command: 'pnpm build', status: 'running' }),
    ])
    expect(seen.at(-1).name).toBe('task.cancellation.recorded')
  })
})

describe('tool orchestrator', () => {
  test('normalizes policy failures and emits tool events', async () => {
    const { RuntimeEventBus, ToolOrchestrator } = await import('../dist/runtime/index.js')
    const events = new RuntimeEventBus()
    const seen = []
    events.subscribe(event => seen.push(event.name))
    const orchestrator = new ToolOrchestrator({
      events,
      tools: [createTool({ name: 'safe_tool', description: 'Safe tool' })],
      policies: {
        approve: () => ({ decision: 'deny', reason: 'approval required' }),
      },
    })

    const result = await orchestrator.executeCall(
      { id: 'call-1', name: 'safe_tool', arguments: '{}' },
      { threadId: 'thread-1', taskId: 'task-1', taskDescription: 'run tool' },
    )

    expect(result.success).toBe(false)
    expect(result.error.kind).toBe('policy_denied')
    expect(result.error.message).toBe('approval required')
    expect(seen).toEqual(['task.tool.started', 'task.tool.failed'])
  })
})

describe('work context manager', () => {
  test('compacts old context, truncates tool output, and reinjects summaries', async () => {
    const { WorkContextManager } = await import('../dist/runtime/index.js')
    const context = new WorkContextManager({ maxToolOutputChars: 80 })
    context.addItem({ role: 'user', content: 'first instruction' })
    context.addItem({ role: 'assistant', content: 'first response' })
    context.addToolResult('view_image', 'call-image', {
      text: 'abcdefghijklmnopqrstuvwxyz',
      imageUrl: 'data:image/png;base64,abc',
      mimeType: 'image/png',
    })

    const modelItemsWithoutImages = context.forModel()
    expect(modelItemsWithoutImages.at(-1).images).toBeUndefined()
    expect(context.forModel({ includeImages: true }).at(-1).images).toHaveLength(1)
    expect(context.forModel({ includeImages: true }).at(-1).content).toContain('[image url omitted]')
    expect(context.forModel({ includeImages: true }).at(-1).content).toContain('[truncated')

    const compaction = context.compactPreTurn(1)
    expect(compaction.phase).toBe('pre_turn')
    expect(context.forModel()).toHaveLength(1)

    const reinjected = context.reinject(compaction.id)
    expect(reinjected.role).toBe('system')
    expect(reinjected.content).toContain('Recovered task context')
  })
})

function createTool(fields) {
  return {
    pluginId: undefined,
    deferLoading: false,
    searchKeywords: [],
    safety: 'safe',
    requiresApproval: false,
    timeoutMs: 1000,
    parameters: { type: 'object', properties: {} },
    execute: async () => ({}),
    ...fields,
  }
}
