/**
 * Built-in local tool for applying structured file patches.
 */
import type { Tool } from '@her-text/types'
import { deleteFile, readTextFile, resolveToolPath, writeTextFile } from './local-node-ops.js'
import { createTool } from './local-tool-factory.js'

interface PatchSection {
  type: 'add' | 'delete' | 'update'
  file: string
  content?: string
  hunks?: PatchHunk[]
}

interface PatchHunk {
  oldText: string
  newText: string
}

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
    execute: async ({ patch }) => applyToolPatch(String(patch || '')),
  })
}

async function applyToolPatch(patch: string): Promise<{ success: true; result: { changes: Array<Record<string, any>> } }> {
  const sections = parsePatch(patch)
  const changes: Array<Record<string, any>> = []

  for (const section of sections) {
    if (section.type === 'add') {
      const filePath = resolveToolPath(section.file)
      await writeTextFile(filePath, section.content ?? '')
      changes.push({ type: 'add', file_path: filePath })
      continue
    }

    if (section.type === 'delete') {
      const filePath = resolveToolPath(section.file)
      await deleteFile(filePath)
      changes.push({ type: 'delete', file_path: filePath })
      continue
    }

    const filePath = resolveToolPath(section.file)
    let content = (await readTextFile(filePath)).content
    for (const hunk of section.hunks ?? []) {
      if (!hunk.oldText) {
        throw new Error(`Update hunk for ${section.file} has no removable/context text`)
      }
      const count = content.split(hunk.oldText).length - 1
      if (count === 0) {
        throw new Error(`Patch hunk did not match ${section.file}`)
      }
      if (count > 1) {
        throw new Error(`Patch hunk matched multiple locations in ${section.file}`)
      }
      content = content.replace(hunk.oldText, hunk.newText)
    }
    await writeTextFile(filePath, content)
    changes.push({ type: 'update', file_path: filePath, hunks: section.hunks?.length ?? 0 })
  }

  return {
    success: true,
    result: {
      changes,
    },
  }
}

function parsePatch(patch: string): PatchSection[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  if (lines[0] !== '*** Begin Patch') {
    throw new Error('Patch must start with "*** Begin Patch"')
  }
  if (lines[lines.length - 1] === '') {
    lines.pop()
  }
  if (lines[lines.length - 1] !== '*** End Patch') {
    throw new Error('Patch must end with "*** End Patch"')
  }

  const sections: PatchSection[] = []
  let index = 1
  while (index < lines.length - 1) {
    const line = lines[index]
    if (line.startsWith('*** Add File: ')) {
      const file = line.slice('*** Add File: '.length).trim()
      index += 1
      const contentLines: string[] = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) {
          throw new Error(`Add File lines must start with + for ${file}`)
        }
        contentLines.push(lines[index].slice(1))
        index += 1
      }
      sections.push({ type: 'add', file, content: contentLines.join('\n') + '\n' })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      sections.push({ type: 'delete', file: line.slice('*** Delete File: '.length).trim() })
      index += 1
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const file = line.slice('*** Update File: '.length).trim()
      index += 1
      const hunks: PatchHunk[] = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (lines[index].startsWith('@@')) {
          index += 1
          const hunkLines: string[] = []
          while (index < lines.length - 1 && !lines[index].startsWith('@@') && !lines[index].startsWith('*** ')) {
            hunkLines.push(lines[index])
            index += 1
          }
          hunks.push(parseHunk(hunkLines))
          continue
        }
        index += 1
      }
      if (hunks.length === 0) {
        throw new Error(`Update File requires at least one @@ hunk for ${file}`)
      }
      sections.push({ type: 'update', file, hunks })
      continue
    }

    throw new Error(`Unknown patch directive: ${line}`)
  }

  return sections
}

function parseHunk(lines: string[]): PatchHunk {
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const line of lines) {
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1))
      newLines.push(line.slice(1))
    } else if (line.startsWith('-')) {
      oldLines.push(line.slice(1))
    } else if (line.startsWith('+')) {
      newLines.push(line.slice(1))
    } else if (line === '') {
      oldLines.push('')
      newLines.push('')
    } else {
      throw new Error(`Invalid hunk line: ${line}`)
    }
  }
  return {
    oldText: oldLines.join('\n') + '\n',
    newText: newLines.join('\n') + '\n',
  }
}
