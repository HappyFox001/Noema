describe('chat conversation runtime helpers', () => {
  let chat
  let conversationRuntime
  let requestRuntime

  beforeAll(async () => {
    chat = await import('../dist/chat/index.js')
    conversationRuntime = await import('../dist/chat/conversation-runtime.js')
    requestRuntime = await import('../dist/chat/request-runtime.js')
  })

  test('assembles prompt messages with character context and images', () => {
    const session = new chat.ChatSession({
      llm: {
        chat: async () => ({ content: '' }),
        streamChat: async function *() {},
      },
    })

    const messages = session.createPromptMessages({
      input: '看图回应',
      language: 'zh-CN',
      character: {
        id: 'role-1',
        displayName: '陈千语',
        sceneState: { location: '书房' },
        narrativeSummaries: [{ startMessageIndex: 1, endMessageIndex: 4, text: '旧摘要' }],
      },
      attachments: [{
        kind: 'image',
        name: 'scene.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,abc',
      }],
    })

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('<character>')
    expect(messages[0].content).toContain('<display_name>陈千语</display_name>')
    expect(messages[0].content).toContain('<scene_state>')
    expect(messages[0].content).toContain('<narrative_summaries>')
    expect(messages[1].content).toEqual([
      { type: 'text', text: '看图回应' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
    ])
  })

  test('selects overflow summary batch and builds localized summary prompt', () => {
    const conversation = {
      messages: [
        message('m1', 'user', '第一条'),
        message('m2', 'assistant', '第二条'),
        message('m3', 'user', '第三条'),
        message('m4', 'assistant', '第四条'),
      ],
      summaries: [],
    }

    const batch = conversationRuntime.selectChatSummaryBatch(conversation, {
      language: 'zh-CN',
      shortTermMessageLimit: 2,
      batchMessageCount: 2,
      summaryLimit: 4,
    })

    expect(batch).toMatchObject({
      startMessageIndex: 1,
      endMessageIndex: 2,
    })
    expect(batch.transcript).toContain('#1 用户: 第一条')
    expect(batch.transcript).toContain('#2 角色: 第二条')
    expect(conversationRuntime.buildChatSummaryPrompt(batch, 'zh-CN')).toContain('请把下面这段历史对话压缩')
  })

  test('builds context messages without draft or pending messages', () => {
    const conversation = {
      messages: [
        message('m1', 'user', 'old'),
        message('m2', 'assistant', 'kept'),
        { ...message('draft', 'assistant', 'draft'), state: 'thinking' },
        message('m3', 'user', 'latest'),
      ],
    }

    const messages = conversationRuntime.buildChatConversationContextMessages(conversation, {
      draftMessageId: 'draft',
      language: 'en-US',
      shortTermMessageLimit: 2,
    })

    expect(messages).toEqual([
      { role: 'user', content: 'old' },
      { role: 'assistant', content: 'kept' },
    ])
  })

  test('extracts and merges scene updates into localized state', () => {
    const parsed = conversationRuntime.extractChatSceneUpdate('hello<scene_update>{"location":"书房"}</scene_update>')
    expect(parsed.text).toBe('hello')
    expect(parsed.update).toEqual({ location: '书房' })

    const merged = conversationRuntime.mergeChatSceneState({
      location: { 'zh-CN': '旧地点', 'en-US': 'Old place' },
    }, parsed.update, 'zh-CN')

    expect(merged.location).toEqual({ 'zh-CN': '书房', 'en-US': 'Old place' })
  })

  test('normalizes attachments and chat request options', () => {
    const request = requestRuntime.normalizeConfiguredChatTurnRequest({
      input: ' hello ',
      attachments: [
        { kind: 'image', name: '', mimeType: '', dataUrl: 'data:image/png;base64,abc' },
        { kind: 'video', name: 'clip', mimeType: '', dataUrl: undefined },
      ],
      options: {
        temperature: 9,
        top_p: -1,
        max_tokens: 99.6,
      },
    })

    expect(request.input).toBe('hello')
    expect(request.attachments).toEqual([
      {
        kind: 'image',
        name: 'attachment',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,abc',
        size: undefined,
      },
    ])
    expect(request.options).toEqual({
      temperature: 2,
      top_p: 0,
      max_tokens: 100,
    })
  })

  test('normalizes stable chat runtime turn request metadata', () => {
    const request = requestRuntime.normalizeChatRuntimeTurnRequest({
      conversationId: ' conversation-1 ',
      input: ' hi ',
      stream: true,
      runtimeOptions: {
        revealSpeed: 'fast',
        ignored: undefined,
      },
    })

    expect(request).toMatchObject({
      conversationId: 'conversation-1',
      input: 'hi',
      stream: true,
      runtimeOptions: {
        revealSpeed: 'fast',
      },
    })
    expect(Object.prototype.hasOwnProperty.call(request.runtimeOptions, 'ignored')).toBe(false)
  })

  test('normalizes chat runtime errors to display messages', () => {
    expect(requestRuntime.normalizeChatRuntimeError(new Error(' failed '))).toBe('failed')
    expect(requestRuntime.normalizeChatRuntimeError({ message: ' provider down ' })).toBe('provider down')
    expect(requestRuntime.normalizeChatRuntimeError(' offline ')).toBe('offline')
  })

  test('emits matching final content for streaming and non-streaming chat events', async () => {
    const session = new chat.ChatSession({
      llm: {
        chat: async () => ({ content: 'hello world' }),
        streamChat: async function *() {
          yield 'hello'
          yield ' '
          yield 'world'
        },
      },
    })
    const request = { input: 'hi' }

    const sendEvents = await requestRuntime.sendChatTurnEvents(session, request)
    const streamEvents = []
    for await (const event of requestRuntime.streamChatTurnEvents(session, request)) {
      streamEvents.push(event)
    }

    expect(sendEvents).toEqual([
      { type: 'message.started' },
      { type: 'message.completed', content: 'hello world' },
    ])
    expect(streamEvents).toEqual([
      { type: 'message.started' },
      { type: 'message.delta', delta: 'hello' },
      { type: 'message.delta', delta: ' ' },
      { type: 'message.delta', delta: 'world' },
      { type: 'message.completed', content: 'hello world' },
    ])
    expect(finalContent(streamEvents)).toBe(finalContent(sendEvents))
  })
})

function message(id, role, text) {
  return {
    id,
    role,
    text: {
      'zh-CN': text,
      'en-US': text,
    },
  }
}

function finalContent(events) {
  const event = events.find((item) => item.type === 'message.completed')
  return event && event.content
}
