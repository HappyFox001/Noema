import { existsSync } from 'fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { basename, join } from 'path'
import { spawn } from 'child_process'
import { extractFrontMatter, sanitizeSkillId } from './utils.mjs'

export class SkillsManager {
  constructor(options) {
    this.dataDir = options.dataDir
    this.sourcesPath = join(this.dataDir, 'sources.json')
    this.installsDir = join(this.dataDir, 'installs')
    this.inlineSkills = options.inlineSkills
    this.maxSkillChars = options.maxSkillChars
  }

  async getAdminState() {
    const sources = await this.loadSources()
    const skills = await this.loadSkills()
    return {
      success: true,
      sources,
      skills: skills.map(skill => this.toSummary(skill)),
    }
  }

  async addGithubSource(input) {
    const url = String(input?.url || '').trim()
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+/.test(url)) {
      throw new Error('Only GitHub HTTPS URLs are supported for skills')
    }

    const id = sanitizeSkillId(input?.id || githubSourceId(url))
    const dir = join(this.installsDir, id)
    await mkdir(this.installsDir, { recursive: true })

    if (existsSync(dir)) {
      await run('git', ['-C', dir, 'pull', '--ff-only'])
    } else {
      await run('git', ['clone', '--depth', '1', url, dir])
    }

    const sources = await this.loadSources()
    await this.saveSources([
      ...sources.filter(source => source.id !== id),
      { id, type: 'github', url, path: dir, enabled: input?.enabled !== false },
    ])
    return { success: true, id, path: dir }
  }

  async addLocalSource(input) {
    const path = String(input?.path || '').trim()
    if (!path) {
      throw new Error('Local skills source requires a path')
    }
    if (!existsSync(path)) {
      throw new Error(`Local skills path not found: ${path}`)
    }

    const id = sanitizeSkillId(input?.id || basename(path))
    const sources = await this.loadSources()
    await this.saveSources([
      ...sources.filter(source => source.id !== id),
      { id, type: 'local', path, enabled: input?.enabled !== false },
    ])
    return { success: true, id, path }
  }

  async removeSource(id) {
    const sourceId = sanitizeSkillId(id)
    const sources = await this.loadSources()
    const source = sources.find(item => item.id === sourceId)
    await this.saveSources(sources.filter(item => item.id !== sourceId))
    if (source?.type === 'github' && source.path?.startsWith(this.installsDir)) {
      await rm(source.path, { recursive: true, force: true })
    }
    return { success: true, id: sourceId }
  }

  async setSourceEnabled(id, enabled) {
    const sourceId = sanitizeSkillId(id)
    const sources = await this.loadSources()
    await this.saveSources(sources.map(source => source.id === sourceId ? { ...source, enabled: Boolean(enabled) } : source))
    return { success: true, id: sourceId, enabled: Boolean(enabled) }
  }

  async rescanGithubSource(id) {
    const sourceId = sanitizeSkillId(id)
    const sources = await this.loadSources()
    const source = sources.find(item => item.id === sourceId)
    if (!source || source.type !== 'github') {
      throw new Error(`GitHub skills source not found: ${sourceId}`)
    }
    await run('git', ['-C', source.path, 'pull', '--ff-only'])
    return { success: true, id: sourceId }
  }

  async listSkills() {
    const skills = await this.loadSkills()
    return {
      success: true,
      skills: skills.map(skill => this.toSummary(skill)),
    }
  }

  async searchSkills(query) {
    const normalized = String(query || '').trim().toLowerCase()
    const skills = await this.loadSkills()
    const matches = skills
      .map(skill => ({
        skill,
        haystack: `${skill.id}\n${skill.name}\n${skill.description}\n${skill.content}`.toLowerCase(),
      }))
      .filter(item => !normalized || item.haystack.includes(normalized))
      .map(item => ({
        ...this.toSummary(item.skill),
        snippet: this.makeSnippet(item.skill.content, normalized),
      }))

    return { success: true, query, skills: matches }
  }

  async readSkill(id) {
    const skillId = sanitizeSkillId(id)
    const skills = await this.loadSkills()
    const skill = skills.find(item => item.id === skillId)
    if (!skill) {
      return { success: false, error: `Skill not found: ${skillId}` }
    }

    return {
      success: true,
      ...this.toSummary(skill),
      content: skill.content.slice(0, this.maxSkillChars),
      truncated: skill.content.length > this.maxSkillChars,
    }
  }

  async resolveTaskContext(input) {
    const maxItems = Math.max(0, Number(input?.maxItems ?? 1))
    if (maxItems === 0) {
      return []
    }

    const query = `${input?.userInput || ''}\n${input?.taskDescription || ''}`
    const skills = await this.loadSkills()
    const ranked = skills
      .map(skill => ({
        skill,
        match: scoreSkillForTask(skill, query),
      }))
      .filter(item => item.match.score > 0)
      .sort((a, b) => b.match.score - a.match.score)

    const selected = ranked
      .filter(item => item.match.explicit || item.match.score >= 8)
      .slice(0, maxItems)

    return selected.map(({ skill, match }) => ({
      id: skill.id,
      type: 'skill',
      name: skill.name,
      path: skill.path,
      content: skill.content.slice(0, this.maxSkillChars),
      reason: match.reason,
      score: match.score,
    }))
  }

  async loadSkills() {
    const sourceSkills = await this.loadSourceSkills()
    return [...sourceSkills, ...this.inlineSkills]
  }

  async loadSourceSkills() {
    const sources = await this.loadSources()
    const skills = []
    for (const source of sources.filter(item => item.enabled !== false)) {
      for (const skill of await loadSkillsFromRoot(source.path, this.maxSkillChars)) {
        skills.push({
          ...skill,
          source: source.type,
          sourceId: source.id,
        })
      }
    }
    return skills
  }

  async loadSources() {
    if (!existsSync(this.sourcesPath)) {
      return []
    }

    const parsed = JSON.parse(await readFile(this.sourcesPath, 'utf8'))
    return (Array.isArray(parsed.sources) ? parsed.sources : [])
      .filter(source => source && typeof source === 'object')
      .map(source => ({
        id: sanitizeSkillId(source.id),
        type: source.type === 'github' ? 'github' : 'local',
        url: source.url ? String(source.url) : undefined,
        path: String(source.path || ''),
        enabled: source.enabled !== false,
      }))
      .filter(source => source.id && source.path)
  }

  async saveSources(sources) {
    await mkdir(this.dataDir, { recursive: true })
    await writeFile(this.sourcesPath, JSON.stringify({ sources }, null, 2), 'utf8')
  }

  toSummary(skill) {
    return {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      ...(skill.path ? { path: skill.path } : {}),
    }
  }

  makeSnippet(content, query) {
    const text = String(content || '').replace(/\s+/g, ' ').trim()
    if (!query) {
      return text.slice(0, 260)
    }
    const index = text.toLowerCase().indexOf(query)
    if (index < 0) {
      return text.slice(0, 260)
    }
    return text.slice(Math.max(0, index - 120), index + query.length + 160)
  }
}

async function loadSkillsFromRoot(root, maxSkillChars) {
  if (!existsSync(root)) {
    return []
  }

  const paths = await findSkillFiles(root)
  const skills = []
  for (const path of paths) {
    const content = await readFile(path, 'utf8')
    const frontMatter = extractFrontMatter(content)
    const id = sanitizeSkillId(frontMatter.id || path.replace(root, '').replace(/SKILL\.md$/i, '').replace(/[\\/]+/g, '-'))
    skills.push({
      id,
      name: frontMatter.name || id,
      description: frontMatter.description || firstParagraph(content),
      content: content.slice(0, maxSkillChars),
      path,
    })
  }
  return skills
}

async function findSkillFiles(root) {
  const files = []
  async function walk(dir, depth = 0) {
    if (depth > 6) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue
      }
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path, depth + 1)
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        files.push(path)
      }
    }
  }
  await walk(root)
  return files
}

function githubSourceId(url) {
  return url
    .replace(/^https:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/[^\w.-]+/g, '-')
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} failed: ${stderr.trim()}`))
      }
    })
  })
}

function firstParagraph(content) {
  return String(content || '')
    .replace(/^---[\s\S]*?---\s*/m, '')
    .split(/\n\s*\n/)
    .map(part => part.replace(/^#+\s*/gm, '').trim())
    .find(Boolean)
    ?.slice(0, 220) || ''
}

function scoreSkillForTask(skill, query) {
  const normalizedQuery = normalizeText(query)
  const name = normalizeText(skill.name || skill.id)
  const id = normalizeText(skill.id)
  const description = normalizeText(skill.description)
  const haystack = `${name} ${id} ${description}`

  const explicitPatterns = [
    `$${skill.name}`,
    `$${skill.id}`,
    `skill:${skill.name}`,
    `skill:${skill.id}`,
    `使用 ${skill.name}`,
    `使用 ${skill.id}`,
    `用 ${skill.name}`,
    `用 ${skill.id}`,
  ].map(normalizeText)

  if (explicitPatterns.some(pattern => pattern && normalizedQuery.includes(pattern))) {
    return { score: 100, explicit: true, reason: 'explicit mention' }
  }

  let score = 0
  const queryTokens = tokenize(normalizedQuery)
  const skillTokens = Array.from(tokenize(haystack))
  const importantTokens = skillTokens.filter(token => token.length >= 4 || /[A-Z]/i.test(token))

  for (const token of unique(importantTokens)) {
    if (queryTokens.has(token)) {
      score += token === 'skill' ? 0 : 2
    } else if (token.length >= 5 && normalizedQuery.includes(token)) {
      score += 2
    }
  }

  for (const phrase of buildSkillPhrases(skill)) {
    if (phrase && normalizedQuery.includes(phrase)) {
      score += 5
    }
  }

  return {
    score,
    explicit: false,
    reason: score > 0 ? 'task matched skill metadata' : '',
  }
}

function buildSkillPhrases(skill) {
  const values = [skill.name, skill.id]
  return values
    .map(value => normalizeText(value).replace(/[-_.]+/g, ' ').trim())
    .filter(Boolean)
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function tokenize(value) {
  return new Set(String(value || '').toLowerCase().match(/[a-z0-9][a-z0-9._-]{1,}/g) || [])
}

function unique(values) {
  return Array.from(new Set(values))
}
