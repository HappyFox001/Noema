export function parseInlineSkills(value) {
  if (Array.isArray(value)) {
    return normalizeInlineSkills(value)
  }

  const text = String(value || '').trim()
  if (!text) {
    return []
  }

  try {
    const parsed = JSON.parse(text)
    return normalizeInlineSkills(Array.isArray(parsed) ? parsed : [])
  } catch (error) {
    console.warn('[SkillsManager] Invalid extraSkillsJson:', error)
    return []
  }
}

function normalizeInlineSkills(skills) {
  return skills
    .filter(skill => skill && typeof skill === 'object')
    .map((skill, index) => ({
      id: sanitizeSkillId(skill.id || `inline-${index + 1}`),
      name: String(skill.name || skill.id || `Inline Skill ${index + 1}`),
      description: String(skill.description || ''),
      content: String(skill.content || ''),
      source: 'inline',
    }))
    .filter(skill => skill.content)
}

export function sanitizeSkillId(value) {
  return String(value || 'skill')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'skill'
}

export function clampInteger(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.max(min, Math.min(max, Math.round(value)))
}

export function extractFrontMatter(markdown) {
  const text = String(markdown || '')
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/)
  if (!match) {
    return {}
  }

  const result = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) {
      continue
    }
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    if (key) {
      result[key] = value
    }
  }
  return result
}
