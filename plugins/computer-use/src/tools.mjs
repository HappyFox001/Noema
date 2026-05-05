/**
 * Tool definitions for native computer use.
 */
export function createComputerUseTools(controller, options) {
  const timeoutMs = options.timeoutMs
  const coordinateSpaceProperty = {
    type: 'string',
    description: 'Coordinate space for x/y values. Defaults to screenshot pixels from the latest computer_observe result.',
    enum: ['screenshot', 'screen', 'normalized'],
  }
  const observeAfter = (execute, observeOptions) => async (params) => {
    const action = await execute(params)
    if (!options.autoObserve) {
      return action
    }

    const shouldObserve = typeof observeOptions?.when === 'function'
      ? observeOptions.when(action, params)
      : true
    if (!shouldObserve) {
      return action
    }

    return {
      action,
      observation: await controller.observe(),
    }
  }

  return [
    tool('computer_observe', 'Take a screenshot of the local desktop. Use this before coordinate-based actions and after uncertain UI changes.', 'read', timeoutMs, {
      includeImage: {
        type: 'boolean',
        description: 'Whether to include the screenshot payload. Defaults to true.',
      },
    }, [], ({ includeImage = true }) => controller.observe({ includeImage })),

    tool('computer_click', 'Click a point on the local desktop. By default, x/y are screenshot pixel coordinates from the latest computer_observe result.', 'computer', timeoutMs, {
      x: { type: 'number', description: 'X coordinate.' },
      y: { type: 'number', description: 'Y coordinate.' },
      coordinateSpace: coordinateSpaceProperty,
      button: { type: 'string', description: 'Mouse button.', enum: ['left', 'right', 'middle'] },
      clickCount: { type: 'number', description: 'Number of clicks. Defaults to 1.' },
    }, ['x', 'y'], observeAfter(({ x, y, coordinateSpace = 'screenshot', button = 'left', clickCount = 1 }) => controller.click(x, y, button, clickCount, coordinateSpace))),

    tool('computer_move', 'Move the local mouse cursor to a point on the desktop. By default, x/y are screenshot pixel coordinates from the latest computer_observe result.', 'computer', timeoutMs, {
      x: { type: 'number', description: 'X coordinate.' },
      y: { type: 'number', description: 'Y coordinate.' },
      coordinateSpace: coordinateSpaceProperty,
    }, ['x', 'y'], observeAfter(({ x, y, coordinateSpace = 'screenshot' }) => controller.move(x, y, coordinateSpace), { when: () => false })),

    tool('computer_drag', 'Drag from one desktop point to another. By default, coordinates are screenshot pixels from the latest computer_observe result.', 'computer', timeoutMs, {
      startX: { type: 'number', description: 'Starting X coordinate.' },
      startY: { type: 'number', description: 'Starting Y coordinate.' },
      endX: { type: 'number', description: 'Ending X coordinate.' },
      endY: { type: 'number', description: 'Ending Y coordinate.' },
      coordinateSpace: coordinateSpaceProperty,
      durationMs: { type: 'number', description: 'Drag duration in milliseconds. Defaults to 500.' },
      button: { type: 'string', description: 'Mouse button.', enum: ['left', 'right', 'middle'] },
    }, ['startX', 'startY', 'endX', 'endY'], observeAfter(({ startX, startY, endX, endY, coordinateSpace = 'screenshot', durationMs = 500, button = 'left' }) => (
      controller.drag(startX, startY, endX, endY, durationMs, button, coordinateSpace)
    ))),

    tool('computer_type', 'Type text into the currently focused local desktop control.', 'computer', timeoutMs, {
      text: { type: 'string', description: 'Text to type.' },
    }, ['text'], observeAfter(({ text }) => controller.typeText(text))),

    tool('computer_key', 'Press a key or keyboard shortcut on the local desktop, such as Enter, Escape, Tab, Command+L, Command+Space, or Shift+Command+4.', 'computer', timeoutMs, {
      keys: { type: 'string', description: 'Key or shortcut. Join modifiers with +, for example Command+L.' },
    }, ['keys'], observeAfter(({ keys }) => controller.pressKeys(keys))),

    tool('computer_scroll', 'Scroll at the current cursor location or a specific coordinate.', 'computer', timeoutMs, {
      direction: { type: 'string', description: 'Scroll direction.', enum: ['up', 'down', 'left', 'right'] },
      amount: { type: 'number', description: 'Scroll amount in wheel units. Defaults to 5.' },
      x: { type: 'number', description: 'Optional X coordinate to move to before scrolling.' },
      y: { type: 'number', description: 'Optional Y coordinate to move to before scrolling.' },
      coordinateSpace: coordinateSpaceProperty,
    }, ['direction'], observeAfter(({ direction, amount = 5, x, y, coordinateSpace = 'screenshot' }) => controller.scroll(direction, amount, x, y, coordinateSpace))),

    tool('computer_wait', 'Wait for local desktop UI changes to settle, then optionally observe the screen.', 'safe', timeoutMs, {
      ms: { type: 'number', description: 'Milliseconds to wait. Defaults to 1000.' },
      observe: { type: 'boolean', description: 'Whether to return a screenshot after waiting. Defaults to true.' },
    }, [], async ({ ms = 1000, observe = true }) => {
      const action = await controller.wait(ms)
      if (!observe) {
        return action
      }
      return {
        action,
        observation: await controller.observe(),
      }
    }),
  ]
}

function tool(name, description, safety, timeoutMs, properties, required, execute) {
  return {
    name,
    description,
    safety,
    timeoutMs,
    parameters: {
      type: 'object',
      properties,
      required,
    },
    execute,
  }
}
