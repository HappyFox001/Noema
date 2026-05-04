/**
 * Skills manager plugin.
 *
 * Manages external skill sources and contributes selected SKILL.md content
 * through the generic task-context injection hook.
 */
import { resolve } from 'path'
import { SkillsManager } from './src/skills-manager.mjs'
import { clampInteger, parseInlineSkills } from './src/utils.mjs'

export default function plugin(ctx) {
  const config = ctx.config || {}
  const manager = new SkillsManager({
    dataDir: ctx.dataDir || ctx.pluginDir,
    inlineSkills: parseInlineSkills(config.extraSkillsJson),
    maxSkillChars: clampInteger(Number(config.maxSkillChars ?? 12000), 1000, 50000),
  })

  return {
    id: 'skills-manager',
    name: 'Skills Manager',
    getAdminState() {
      return manager.getAdminState()
    },
    handleAdminAction(action, payload) {
      if (action === 'addGithubSource') {
        return manager.addGithubSource(payload || {})
      }
      if (action === 'addLocalSource') {
        return manager.addLocalSource(payload || {})
      }
      if (action === 'removeSource') {
        return manager.removeSource(String(payload?.sourceId || ''))
      }
      if (action === 'setSourceEnabled') {
        return manager.setSourceEnabled(String(payload?.sourceId || ''), payload?.enabled)
      }
      if (action === 'rescanGithubSource') {
        return manager.rescanGithubSource(String(payload?.sourceId || ''))
      }
      throw new Error(`Unknown Skills admin action: ${action}`)
    },
    resolveTaskContext(context) {
      return manager.resolveTaskContext(context)
    },
    registerTools() {
      return [
        {
          name: 'skills_list',
          description: 'List available task skills with id, name, description, and source. Use this before reading a skill.',
          safety: 'read',
          timeoutMs: 30000,
          parameters: { type: 'object', properties: {}, required: [] },
          execute: async () => manager.listSkills(),
        },
        {
          name: 'skills_search',
          description: 'Search available skills by query. Returns matching skills and short snippets.',
          safety: 'read',
          timeoutMs: 30000,
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query.' },
            },
            required: ['query'],
          },
          execute: async ({ query }) => manager.searchSkills(query),
        },
        {
          name: 'skills_read',
          description: 'Read a skill by id. The returned markdown should guide how the task model performs the current task.',
          safety: 'read',
          timeoutMs: 30000,
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Skill id from skills_list or skills_search.' },
            },
            required: ['id'],
          },
          execute: async ({ id }) => manager.readSkill(id),
        },
      ]
    },
  }
}
