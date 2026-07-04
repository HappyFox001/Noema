/**
 * Shared renderer translation catalog types.
 */
export type LanguageCode = 'zh-CN' | 'en-US'
export type TranslationMessages = Record<string, string>
export type TranslationCatalog = Record<LanguageCode, TranslationMessages>
