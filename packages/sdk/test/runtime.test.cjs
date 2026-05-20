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
      createTool({ name: 'tool_search', description: 'Discover tools', deferLoading: true, safety: 'safe' }),
    ])

    expect(router.listModelVisibleTools().map(tool => tool.name)).toEqual(['exec_command', 'browser_open'])
    expect(router.listDiscoverableTools().map(tool => tool.name)).toEqual(['tool_search'])
    expect(router.find('exec_command').kind).toBe('shell')
    expect(router.find('browser_open').kind).toBe('browser')
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
