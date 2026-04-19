/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_PROVIDER: 'anthropic' | 'openai'
  readonly VITE_LLM_API_KEY: string
  readonly VITE_LLM_MODEL: string
  readonly VITE_QWEN_API_KEY: string
  readonly VITE_FISH_API_KEY: string
  readonly VITE_FISH_VOICE_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
