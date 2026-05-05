/**
 * Coordinate helpers for screenshot-based desktop control.
 */

export function detectPngSize(buffer) {
  if (
    buffer.length < 24 ||
    buffer[0] !== 0x89 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x4e ||
    buffer[3] !== 0x47
  ) {
    return null
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

export function createCoordinateMapper(displayInfo, screenshotSize) {
  const screenWidth = positiveNumber(displayInfo?.screenWidth) ?? screenshotSize.width
  const screenHeight = positiveNumber(displayInfo?.screenHeight) ?? screenshotSize.height
  const screenX = finiteNumber(displayInfo?.screenX) ?? 0
  const screenY = finiteNumber(displayInfo?.screenY) ?? 0
  const scaleX = screenshotSize.width / screenWidth
  const scaleY = screenshotSize.height / screenHeight

  return {
    coordinate_space: 'screenshot',
    screenshot: {
      x: 0,
      y: 0,
      width: screenshotSize.width,
      height: screenshotSize.height,
    },
    screen: {
      x: screenX,
      y: screenY,
      width: screenWidth,
      height: screenHeight,
    },
    scale: {
      x: scaleX,
      y: scaleY,
    },
    displays: Array.isArray(displayInfo?.displays) && displayInfo.displays.length > 0
      ? displayInfo.displays
      : [{
          id: 'primary',
          x: screenX,
          y: screenY,
          width: screenWidth,
          height: screenHeight,
          pixelWidth: screenshotSize.width,
          pixelHeight: screenshotSize.height,
          scaleX,
          scaleY,
        }],
  }
}

export function mapPoint(point, mapper, coordinateSpace = 'screenshot') {
  const x = finiteNumber(point.x)
  const y = finiteNumber(point.y)
  if (x === undefined || y === undefined) {
    throw new Error('x and y must be finite numbers')
  }

  const space = normalizeCoordinateSpace(coordinateSpace)
  if (space === 'screen') {
    return {
      x: Math.round(x),
      y: Math.round(y),
      coordinateSpace: space,
    }
  }

  if (space === 'normalized') {
    return {
      x: Math.round(mapper.screen.x + x * mapper.screen.width),
      y: Math.round(mapper.screen.y + y * mapper.screen.height),
      coordinateSpace: space,
    }
  }

  return {
    x: Math.round(mapper.screen.x + x / mapper.scale.x),
    y: Math.round(mapper.screen.y + y / mapper.scale.y),
    coordinateSpace: space,
  }
}

export function normalizeCoordinateSpace(value) {
  const normalized = String(value || 'screenshot').toLowerCase()
  if (normalized === 'screen' || normalized === 'screenshot' || normalized === 'normalized') {
    return normalized
  }
  throw new Error(`Unsupported coordinateSpace: ${value}`)
}

export function coordinateMetadata(mapper) {
  return {
    coordinate_space: mapper.coordinate_space,
    image_width: mapper.screenshot.width,
    image_height: mapper.screenshot.height,
    screen_x: mapper.screen.x,
    screen_y: mapper.screen.y,
    screen_width: mapper.screen.width,
    screen_height: mapper.screen.height,
    scale_x: mapper.scale.x,
    scale_y: mapper.scale.y,
    displays: mapper.displays,
  }
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function positiveNumber(value) {
  const number = finiteNumber(value)
  return number && number > 0 ? number : undefined
}
