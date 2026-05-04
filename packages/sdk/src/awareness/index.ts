/**
 * Runtime awareness snapshot and prompt formatting.
 */
import type { ResponseItem } from '../context/index.js'

export interface RuntimeAwarenessEnvironment {
  platform: string
  arch: string
  locale?: string
}

export interface RuntimeAwarenessSnapshot {
  now: number
  timezone: string
  locale: string
  environment: RuntimeAwarenessEnvironment
}

export interface RuntimeAwarenessOptions {
  now?: number
  timezone?: string
  locale?: string
  environment?: Partial<RuntimeAwarenessEnvironment>
}

export function createRuntimeAwareness(options: RuntimeAwarenessOptions = {}): RuntimeAwarenessSnapshot {
  const locale = options.locale || Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN'
  const timezone = options.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  return {
    now: options.now ?? Date.now(),
    timezone,
    locale,
    environment: {
      platform: options.environment?.platform || getRuntimePlatform(),
      arch: options.environment?.arch || getRuntimeArch(),
      locale: options.environment?.locale || locale,
    }
  }
}

export function formatAwarenessBlock(snapshot: RuntimeAwarenessSnapshot): string {
  const dateParts = getDateParts(snapshot.now, snapshot)
  return [
    `当前时间: ${dateParts.date} ${dateParts.time} ${dateParts.weekday}`,
    `时区: ${snapshot.timezone}`,
    `Locale: ${snapshot.locale}`,
    `运行环境: ${snapshot.environment.platform} ${snapshot.environment.arch}`,
    '时间视角: 对话和记忆时间已尽量按当前时间转成今天/昨天/上周等相对表达。'
  ].join('\n')
}

export function formatMessageTime(timestamp: number | undefined, snapshot: RuntimeAwarenessSnapshot): string {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return ''
  }

  const nowDay = getLocalDayIndex(snapshot.now, snapshot.timezone)
  const itemDay = getLocalDayIndex(timestamp, snapshot.timezone)
  const dayDiff = nowDay - itemDay
  const parts = getDateParts(timestamp, snapshot)

  if (dayDiff === 0) {
    return `今天 ${parts.time}`
  }
  if (dayDiff === 1) {
    return `昨天 ${parts.time}`
  }
  if (dayDiff === 2) {
    return `前天 ${parts.time}`
  }
  if (dayDiff > 2 && dayDiff < 7) {
    return `${dayDiff} 天前 ${parts.time}`
  }
  if (dayDiff >= 7 && dayDiff < 14) {
    return `上周${parts.weekdayShort} ${parts.time}`
  }
  if (dayDiff >= 14 && dayDiff < 31) {
    return `${Math.floor(dayDiff / 7)} 周前`
  }

  return `${parts.date} ${parts.time}`
}

export function formatConversationLinePrefix(
  item: Pick<ResponseItem, 'role' | 'timestamp'>,
  snapshot: RuntimeAwarenessSnapshot
): string {
  const relativeTime = formatMessageTime(item.timestamp, snapshot)
  return relativeTime ? `[${relativeTime}] ${item.role}:` : `${item.role}:`
}

function getDateParts(timestamp: number, snapshot: RuntimeAwarenessSnapshot): {
  date: string
  time: string
  weekday: string
  weekdayShort: string
} {
  const date = new Date(timestamp)
  return {
    date: new Intl.DateTimeFormat(snapshot.locale, {
      timeZone: snapshot.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date),
    time: new Intl.DateTimeFormat(snapshot.locale, {
      timeZone: snapshot.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date),
    weekday: new Intl.DateTimeFormat(snapshot.locale, {
      timeZone: snapshot.timezone,
      weekday: 'long',
    }).format(date),
    weekdayShort: new Intl.DateTimeFormat(snapshot.locale, {
      timeZone: snapshot.timezone,
      weekday: 'short',
    }).format(date).replace(/^周/, ''),
  }
}

function getLocalDayIndex(timestamp: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp))
  const year = Number(parts.find(part => part.type === 'year')?.value)
  const month = Number(parts.find(part => part.type === 'month')?.value)
  const day = Number(parts.find(part => part.type === 'day')?.value)
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000)
}

function getRuntimePlatform(): string {
  return typeof process !== 'undefined' ? process.platform : 'browser'
}

function getRuntimeArch(): string {
  return typeof process !== 'undefined' ? process.arch : 'unknown'
}
