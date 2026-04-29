export type TTSEmotionProfile = 'fish-s2'

export const FISH_S2_EMOTION_CUES = [
  'whisper',
  'laugh',
  'emphasis',
  'sigh',
  'gasp',
  'pause',
  'angry',
  'excited',
  'sad',
  'surprised',
  'inhale',
  'exhale',
] as const

export function stripTTSEmotionCues(text: string, profile?: TTSEmotionProfile): string {
  if (profile !== 'fish-s2') {
    return text
  }

  return text
    .replace(/\[[a-zA-Z][a-zA-Z\s-]{0,40}\]\s*/g, '')
    .replace(/\s+([。！？!?，、；：,.])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
