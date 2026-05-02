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
    this.skillsRoot = options.skillsRoot
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

  async addSkill(skill) {
    const id = sanitizeSkillId(skill.id)
    const dir = join(this.skillsRoot, id)
    await mkdir(dir, { recursive: true })

    const content = normalizeSkillContent({
      id,
      name: skill.name,
      description: skill.description,
      content: String(skill.content || ''),
    })
    const path = join(dir, 'SKILL.md')
    await writeFile(path, content, 'utf8')
    return { success: true, id, path }
  }

  async loadSkills() {
    const fileSkills = await this.loadFileSkills()
    const sourceSkills = await this.loadSourceSkills()
    return [...fileSkills, ...sourceSkills, ...this.inlineSkills]
  }

  async loadFileSkills() {
    if (!existsSync(this.skillsRoot)) {
      return []
    }

    const entries = await readdir(this.skillsRoot, { withFileTypes: true })
    const skills = []
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      const id = sanitizeSkillId(entry.name)
      const path = join(this.skillsRoot, entry.name, 'SKILL.md')
      if (!existsSync(path)) {
        continue
      }
      const content = await readFile(path, 'utf8')
      const frontMatter = extractFrontMatter(content)
      skills.push({
        id,
        name: frontMatter.name || id,
        description: frontMatter.description || firstParagraph(content),
        content,
        source: 'file',
        path,
      })
    }
    return skills
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

function normalizeSkillContent(skill) {
  const content = String(skill.content || '').trim()
  if (content.startsWith('---')) {
    return `${content}\n`
  }

  return [
    '---',
    `name: ${skill.name || skill.id}`,
    `description: ${skill.description || ''}`,
    '---',
    '',
    content,
    '',
  ].join('\n')
}
