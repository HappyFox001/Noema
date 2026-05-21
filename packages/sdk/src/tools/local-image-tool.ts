/**
 * Built-in local tool for attaching image files to work turns.
 */
import type { Tool } from '@her-text/types'
import { readImageFile } from './local-node-ops.js'
import { createTool } from './local-tool-factory.js'

export function createImageTools(): Tool[] {
  return [createViewImageTool()]
}

function createViewImageTool(): Tool {
  return createTool({
    name: 'view_image',
    description: 'Attach a local image file to the next model turn for visual inspection. Use before making visual claims or editing UI/image assets from a screenshot.',
    safety: 'read',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Local image file path.',
        },
        detail: {
          type: 'string',
          enum: ['auto', 'original'],
          description: 'Optional detail preference. original requests full-resolution interpretation when supported.',
        },
      },
      required: ['path'],
    },
    execute: async ({ path, detail = 'auto' }) => {
      const image = await readImageFile(path)
      return {
        success: true,
        result: {
          type: 'image',
          path: image.path,
          mime_type: image.mimeType,
          image_base64: image.base64,
          width: image.width,
          height: image.height,
          bytes: image.bytes,
          note: detail === 'original' ? 'Original-detail local image attachment.' : 'Local image attachment.',
        },
      }
    },
  })
}
