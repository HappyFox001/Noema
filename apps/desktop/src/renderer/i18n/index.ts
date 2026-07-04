/**
 * Renderer translation catalog entrypoint.
 */
import { enUSMessages } from './locales/en-US'
import { zhCNMessages } from './locales/zh-CN'
import type { LanguageCode, TranslationCatalog } from './types'

export type { LanguageCode, TranslationCatalog, TranslationMessages } from './types'

export const TRANSLATIONS = {
  'zh-CN': zhCNMessages,
  'en-US': enUSMessages,
} satisfies TranslationCatalog

export function translateMessage(language: LanguageCode, key: string): string {
  return TRANSLATIONS[language][key] ?? TRANSLATIONS['zh-CN'][key] ?? key
}
