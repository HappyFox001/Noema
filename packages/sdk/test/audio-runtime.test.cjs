describe('response audio runtime', () => {
  test('preserves TTS frame path and text transform hook', async () => {
    const { ResponseFramePipeline, ResponseTTSProcessor } = await import('../dist/audio/response-frame-pipeline.js')
    const pushedText = []
    const observedText = []
    const service = {
      startStreaming: jest.fn(async () => undefined),
      pushText: jest.fn(async text => {
        pushedText.push(text)
      }),
      finishStreaming: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    }
    const pipeline = new ResponseFramePipeline([
      new ResponseTTSProcessor({
        isCancelled: () => false,
        isEnabled: () => true,
        getService: () => service,
        sanitizeText: text => text.trim(),
        transformTTSInput: text => `[emotion:happy]${text}`,
        toDisplayText: text => text.replace('[emotion:happy]', ''),
        onText: (ttsText, displayText) => observedText.push({ ttsText, displayText }),
      }),
    ])

    await pipeline.queueFrame({ type: 'phase_start', kind: 'control', phase: 'reply', timestamp: 1 })
    await pipeline.queueFrame({ type: 'tts_text', kind: 'data', text: ' hello ', timestamp: 2 })
    await pipeline.queueFrame({ type: 'phase_end', kind: 'control', phase: 'reply', timestamp: 3 })
    await pipeline.waitForIdle()

    expect(service.startStreaming).toHaveBeenCalledTimes(1)
    expect(service.finishStreaming).toHaveBeenCalledTimes(1)
    expect(pushedText).toEqual(['[emotion:happy]hello'])
    expect(observedText).toEqual([{ ttsText: '[emotion:happy]hello', displayText: 'hello' }])
  })

  test('preserves expression hook forwarding from chat stream', async () => {
    const { LLMResponseProcessor, LLMStreamBridgeProcessor } = await import('../dist/audio/response-frame-pipeline.js')
    const frames = []
    const expressions = []
    const service = {
      async *chatStream(_input, options) {
        await options.onExpression?.({ type: 'sticker', id: 'smile' })
        await options.onDisplayChunk?.('reply', 'hello', 'hello')
        yield 'hello'
      },
    }
    const bridge = new LLMStreamBridgeProcessor({
      queueFrame: frame => {
        frames.push(frame)
      },
      isCancelled: () => false,
      shouldUseTTS: () => false,
    })
    const processor = new LLMResponseProcessor({
      service,
      bridge,
      onExpression: frame => {
        expressions.push(frame)
      },
    })

    const text = await processor.processUserText('hi')

    expect(text).toBe('hello')
    expect(expressions).toEqual([{ type: 'sticker', id: 'smile' }])
    expect(frames.map(frame => frame.type)).toContain('display_text_delta')
  })
})
