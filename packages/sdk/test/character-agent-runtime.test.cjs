describe('character resource super agent runtime', () => {
  test('compiles a workflow graph into agent-owned run context', async () => {
    const {
      compileCharacterAgentRunContext,
      createStandardCharacterWorkflow,
    } = await import('../dist/character-workflow/index.js')

    const workflow = createStandardCharacterWorkflow({
      now: 1000,
      llmApiId: 'llm-api',
      llmModelName: 'role-writer',
      imageApiId: 'image-api',
      imageModelName: 'portrait-model',
    })
    const context = compileCharacterAgentRunContext(workflow, { runId: 'run-1', now: 1000 })

    expect(context.runId).toBe('run-1')
    expect(context.goal.prompt).toContain('校园恋爱')
    expect(context.capabilities.llmModels[0]).toEqual(expect.objectContaining({
      apiId: 'llm-api',
      modelName: 'role-writer',
      modelRef: 'llm-api::role-writer',
      kind: 'llm',
    }))
    expect(context.capabilities.imageModels[0]).toEqual(expect.objectContaining({
      apiId: 'image-api',
      modelName: 'portrait-model',
      kind: 'image',
    }))
    expect(context.graph.relations.map(relation => relation.kind)).toContain('enables')
    expect(context.requestedAssets[0].requested).toContain('role-card')
  })

  test('routes tools as agent-readable results instead of runtime verdicts', async () => {
    const {
      compileCharacterAgentRunContext,
      createCharacterAgentToolRuntime,
      createStandardCharacterWorkflow,
    } = await import('../dist/character-workflow/index.js')

    const workflow = createStandardCharacterWorkflow({ now: 1000 })
    const context = compileCharacterAgentRunContext(workflow, { runId: 'tool-run', now: 1000 })
    const runtime = createCharacterAgentToolRuntime()
    const state = {
      runId: 'tool-run',
      phase: 'inspect',
      context,
      taskUnderstanding: '',
      activePlan: { id: 'plan', title: 'Plan', strategy: 'test', steps: [] },
      candidatePacks: [],
      critiqueHistory: [],
      toolCalls: [],
      artifacts: [],
      unresolvedQuestions: [],
      events: [],
    }

    const missing = await runtime.call('missing_tool', {}, {
      callId: 'call-1',
      phase: 'inspect',
      context,
      state,
    })
    expect(missing).toEqual(expect.objectContaining({
      callId: 'call-1',
      ok: false,
    }))

    runtime.register({
      name: 'custom_review',
      description: 'Returns a custom review result.',
      kind: 'quality',
      execute: ({ callId }) => ({
        callId,
        ok: true,
        summary: 'reviewed',
        data: { score: 0.9 },
      }),
    })

    const reviewed = await runtime.call('custom_review', {}, {
      callId: 'call-2',
      phase: 'inspect',
      context,
      state,
    })
    expect(reviewed).toEqual(expect.objectContaining({
      callId: 'call-2',
      ok: true,
      summary: 'reviewed',
    }))
  })

  test('runs the default super agent loop and writes export artifacts', async () => {
    const {
      createCharacterSuperAgent,
      createInMemoryCharacterArtifactStore,
      createStandardCharacterWorkflow,
    } = await import('../dist/character-workflow/index.js')

    const events = []
    const artifactStore = createInMemoryCharacterArtifactStore()
    const agent = createCharacterSuperAgent({
      createRunId: () => 'agent-run',
      now: () => 2000,
      artifacts: artifactStore,
      onEvent: event => events.push(event),
    })

    const state = await agent.run(createStandardCharacterWorkflow({ now: 1000 }))

    expect(state.phase).toBe('completed')
    expect(state.finalReport).toEqual(expect.objectContaining({
      exportedArtifactId: 'agent-run:export-package',
    }))
    expect(artifactStore.read('agent-run:export-package')).toEqual(expect.objectContaining({
      kind: 'export-package',
      version: 1,
    }))
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining([
      'run.started',
      'agent.plan.created',
      'artifact.created',
      'tool.call.completed',
      'run.completed',
    ]))
  })

  test('loads workflow snapshots and resolves model capabilities through model resolver', async () => {
    const {
      compileCharacterAgentRunContext,
      createStandardCharacterWorkflow,
      createStaticCharacterAgentModelResolver,
      loadCharacterAgentWorkflowSnapshot,
      resolveCharacterAgentModelCapabilities,
    } = await import('../dist/character-workflow/index.js')

    const workflow = createStandardCharacterWorkflow({
      now: 1000,
      llmApiId: 'llm-api',
      llmModelName: 'role-writer',
      imageApiId: 'image-api',
      imageModelName: 'portrait-model',
    })
    const snapshot = loadCharacterAgentWorkflowSnapshot(workflow)
    expect(snapshot.issues).toEqual([])

    const context = compileCharacterAgentRunContext(snapshot.workflow, { runId: 'resolver-run', now: 1000 })
    const resolver = createStaticCharacterAgentModelResolver([
      { apiId: 'llm-api', modelName: 'role-writer', modelRef: 'llm-api::role-writer', kind: 'llm', provider: 'openai-compatible' },
      { apiId: 'image-api', modelName: 'portrait-model', modelRef: 'image-api::portrait-model', kind: 'image', provider: 'comfyui' },
    ])

    const resolved = await resolveCharacterAgentModelCapabilities(context, resolver)
    expect(resolved.issues).toEqual([])
    expect(resolved.llmModels[0]).toEqual(expect.objectContaining({
      provider: 'openai-compatible',
      modelRef: 'llm-api::role-writer',
    }))
    expect(resolved.imageModels[0]).toEqual(expect.objectContaining({
      provider: 'comfyui',
      modelRef: 'image-api::portrait-model',
    }))
  })
})
