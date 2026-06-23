#!/usr/bin/env node
/**
 * Checks the character resource graph frontend completion markers.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const doc = readFileSync(resolve(root, '角色生成前端.md'), 'utf8')
const page = readFileSync(resolve(root, 'apps/desktop/src/renderer/surfaces/chat-character-workflow-page.ts'), 'utf8')
const panel = readFileSync(resolve(root, 'apps/desktop/src/renderer/surfaces/chat-panel.ts'), 'utf8')

const uncheckedTodos = doc.split('\n').filter((line) => line.trim().startsWith('- [ ]')).length
const checks = {
  litegraph: page.includes("from 'litegraph.js'"),
  fuse: page.includes("from 'fuse.js'"),
  yjs: page.includes("from 'yjs'"),
  splitGrid: page.includes("from 'split-grid'"),
  floatingUi: page.includes("from '@floating-ui/dom'"),
  pragmaticDrag: page.includes("@atlaskit/pragmatic-drag-and-drop"),
  lucide: page.includes("from 'lucide'"),
  noFixedWorkflowImport: !panel.includes("@noema/sdk/character-workflow"),
  commandRegistry: panel.includes('executeCharacterResourceCommand'),
  buildCommandDocumented: doc.includes('pnpm --filter @noema/desktop build'),
}
const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)

console.log(JSON.stringify({
  uncheckedTodos,
  checks,
  failed,
}, null, 2))

if (failed.length > 0) {
  process.exit(1)
}
