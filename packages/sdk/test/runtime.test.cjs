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

  test('speech stop while output is speaking leaves active work untouched', async () => {
    const { InteractionRuntime } = await import('../dist/runtime/index.js')
    const runtime = new InteractionRuntime()
    const workState = {
      activeThreads: [{ id: 'thread-active', goal: 'keep running', status: 'active', priority: 1, createdAt: 1, updatedAt: 1, userIntentHistory: [], emotionalTurnHistory: [], observations: [], artifacts: [], decisions: [], failures: [], nextActions: [] }],
      pausedThreads: [],
      abandonedThreads: [],
      completedThreads: [],
      focusedThreadId: 'thread-active',
      updatedAt: Date.now(),
    }

    const result = runtime.resolve({
      userInput: '停一下',
      timestamp: Date.now(),
      workState,
      outputState: { speaking: true, muted: false },
    })

    expect(result.intents.map(intent => intent.kind)).toEqual(['speech.stop'])
    expect(workState.activeThreads).toHaveLength(1)
    expect(workState.activeThreads[0].status).toBe('active')
  })

  test('user correction is routed as a work modification instead of a new task', async () => {
    const { InteractionRuntime } = await import('../dist/runtime/index.js')
    const runtime = new InteractionRuntime()
    const result = runtime.resolve({
      userInput: '刚才那个路径错了，改成 packages/sdk',
      timestamp: Date.now(),
      workState: {
        activeThreads: [{ id: 'thread-correction', goal: 'fix task', status: 'active', priority: 1, createdAt: 1, updatedAt: 1, userIntentHistory: [], emotionalTurnHistory: [], observations: [], artifacts: [], decisions: [], failures: [], nextActions: [] }],
        pausedThreads: [],
        abandonedThreads: [],
        completedThreads: [],
        focusedThreadId: 'thread-correction',
        updatedAt: Date.now(),
      },
      outputState: { speaking: false, muted: false },
    })

    expect(result.interruptionKind).toBe('correction')
    expect(result.intents).toEqual([
      expect.objectContaining({
        kind: 'work.modify',
        targetThreadId: 'thread-correction',
        modification: '刚才那个路径错了，改成 packages/sdk',
      }),
    ])
  })

  test('switching tasks pauses current work and preserves the new work request', async () => {
    const { InteractionRuntime } = await import('../dist/runtime/index.js')
    const runtime = new InteractionRuntime()
    const result = runtime.resolve({
      userInput: '先别做这个，帮我看另一个问题',
      timestamp: Date.now(),
      workState: {
        activeThreads: [{ id: 'thread-current', goal: 'current task', status: 'active', priority: 1, createdAt: 1, updatedAt: 1, userIntentHistory: [], emotionalTurnHistory: [], observations: [], artifacts: [], decisions: [], failures: [], nextActions: [] }],
        pausedThreads: [],
        abandonedThreads: [],
        completedThreads: [],
        focusedThreadId: 'thread-current',
        updatedAt: Date.now(),
      },
      outputState: { speaking: false, muted: false },
    })

    expect(result.interruptionKind).toBe('new_work')
    expect(result.intents).toEqual([
      expect.objectContaining({ kind: 'work.pause', targetThreadId: 'thread-current' }),
      expect.objectContaining({ kind: 'work.queue_new', workDescription: '先别做这个，帮我看另一个问题' }),
    ])
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

  test('switching work preserves the old thread and can focus it again after restart', async () => {
    const { WorkStateStore } = await import('../dist/runtime/index.js')
    const storageDir = await mkdtemp(join(tmpdir(), 'her-text-work-switch-'))
    try {
      const firstStore = new WorkStateStore(storageDir)
      await firstStore.initialize()
      const oldThread = await firstStore.createThread('Fix SDK task', { id: 'thread-old', now: 3000 })
      await firstStore.recordNextAction(oldThread.id, {
        id: 'next-old',
        title: 'Run SDK build',
        reason: 'resume original task',
        createdAt: 3100,
      })
      await firstStore.pauseThread(oldThread.id, 'user switched to another task', 3200)
      const newThread = await firstStore.createThread('Inspect desktop task', { id: 'thread-new', now: 3300 })
      await firstStore.focusThread(newThread.id, 3400)
      await firstStore.flush()

      const secondStore = new WorkStateStore(storageDir)
      await secondStore.initialize()
      expect(secondStore.getSnapshot().pausedThreads.map(item => item.id)).toContain(oldThread.id)
      expect(secondStore.getSnapshot().focusedThreadId).toBe(newThread.id)

      const resumed = await secondStore.resumeThread(oldThread.id, 'continue previous task', 3500)
      expect(resumed.status).toBe('active')
      expect(resumed.nextActions.at(-1).title).toBe('Run SDK build')
      expect(secondStore.getSnapshot().focusedThreadId).toBe(oldThread.id)
      await secondStore.flush()
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  test('failure records preserve avoid-next-time guidance across restart', async () => {
    const { WorkStateStore } = await import('../dist/runtime/index.js')
    const storageDir = await mkdtemp(join(tmpdir(), 'her-text-work-failure-'))
    try {
      const firstStore = new WorkStateStore(storageDir)
      await firstStore.initialize()
      const thread = await firstStore.createThread('Recover failed task', { id: 'thread-failure', now: 4000 })
      await firstStore.recordFailure(thread.id, {
        id: 'failure-avoid',
        message: 'test command failed',
        evidence: ['exit code 1', 'stderr: missing file'],
        attemptedRoute: 'ran stale command',
        avoidNextTime: 'Check the file exists before rerunning the same command.',
        createdAt: 4100,
      })
      await firstStore.recordNextAction(thread.id, {
        id: 'next-after-failure',
        title: 'Validate file path before retry',
        reason: 'avoid repeating the failed route',
        createdAt: 4200,
      })
      await firstStore.flush()

      const secondStore = new WorkStateStore(storageDir)
      await secondStore.initialize()
      const restored = secondStore.getThread(thread.id)
      expect(restored.status).toBe('recoverable_failed')
      expect(restored.failures.at(-1).avoidNextTime).toContain('Check the file exists')
      expect(restored.nextActions.at(-1).title).toBe('Validate file path before retry')
      await secondStore.flush()
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  test('user modification is persisted as work intent and next action', async () => {
    const { WorkStateStore } = await import('../dist/runtime/index.js')
    const storageDir = await mkdtemp(join(tmpdir(), 'her-text-work-modify-'))
    try {
      const firstStore = new WorkStateStore(storageDir)
      await firstStore.initialize()
      const thread = await firstStore.createThread('Update constrained task', { id: 'thread-modify', now: 5000 })
      await firstStore.recordModification(thread.id, '刚才那个路径错了，改成 packages/sdk', 'user corrected task scope', 5100)
      await firstStore.flush()

      const secondStore = new WorkStateStore(storageDir)
      await secondStore.initialize()
      const restored = secondStore.getThread(thread.id)
      expect(restored.userIntentHistory.at(-1)).toEqual({
        input: '刚才那个路径错了，改成 packages/sdk',
        intent: 'work.modify',
        createdAt: 5100,
      })
      expect(restored.nextActions.at(-1)).toEqual(expect.objectContaining({
        title: 'Apply latest user correction',
        reason: 'user corrected task scope',
      }))
      expect(restored.resumeSummary).toContain('packages/sdk')
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

  test('tool failure and task cancellation produce distinct event chains', async () => {
    const { CancellationModel, RuntimeEventBus, ToolOrchestrator } = await import('../dist/runtime/index.js')
    const events = new RuntimeEventBus()
    const seen = []
    events.subscribe(event => seen.push(event.name))
    const orchestrator = new ToolOrchestrator({
      events,
      tools: [createTool({
        name: 'failing_tool',
        description: 'Always fails',
        execute: async () => {
          throw new Error('tool failed')
        },
      })],
    })

    await orchestrator.executeCall(
      { id: 'call-fail', name: 'failing_tool', arguments: '{}' },
      { threadId: 'thread-fail', taskId: 'task-fail', taskDescription: 'fail through tool' },
    )

    const cancellation = new CancellationModel({ events })
    cancellation.createAbortSignal('task-cancel')
    cancellation.cancelTask('task-cancel', 'user cancelled', 'thread-cancel')

    expect(seen).toEqual([
      'task.tool.started',
      'task.tool.failed',
      'task.cancellation.recorded',
    ])
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
