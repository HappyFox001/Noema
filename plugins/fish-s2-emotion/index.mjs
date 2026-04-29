const FISH_S2_EMOTION_CUES = [
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
]

export default function createPlugin() {
  return {
    id: 'fish-s2-emotion',
    name: 'Fish Audio S2 Emotion Enhancer',
    extendPrompt(context) {
      if (!isFishS2Runtime(context.runtime)) {
        return undefined
      }

      return [
        'Fish Audio S2 语音情绪规则：',
        `- 当前回复会直接送入 Fish Audio S2-Pro TTS，允许在 <reply> 文本中使用这些方括号语音标记：${FISH_S2_EMOTION_CUES.map(cue => `[${cue}]`).join(' ')}`,
        '- 这些标记只用于控制语音情绪、语气、停顿或拟声，不是给用户看的内容',
        '- 每次回复最多使用 1-2 个语音标记；非常短的回复可以不用',
        '- 标记要自然地放在句首或需要变化的位置，例如：[sigh] 没事，我听着呢。[pause] 你慢慢说。',
        '- 不要创造白名单以外的新标记，不要连续堆叠多个标记',
        '- 不要为了情绪标记而改变原本该说的话，先保证回复自然',
      ].join('\n')
    },
    transformText(text, context) {
      if (!isFishS2Runtime(context.runtime)) {
        return text
      }

      if (context.target === 'tts_input') {
        return text
      }

      return stripFishS2EmotionCues(text)
    },
  }
}

function stripFishS2EmotionCues(text) {
  return text
    .replace(/\[[a-zA-Z][a-zA-Z\s-]{0,40}\]\s*/g, '')
    .replace(/\s+([。！？!?，、；：,.])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function isFishS2Runtime(runtime) {
  if (runtime.tts?.provider !== 'fish-audio') {
    return false
  }

  return (runtime.tts.model || 's2-pro').toLowerCase().startsWith('s2')
}
