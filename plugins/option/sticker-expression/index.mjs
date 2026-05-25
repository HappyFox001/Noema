import { existsSync } from 'fs'

const BASIC_EMOTION_TAGS = [
  'neutral',
  'happy',
  'laugh',
  'shy',
  'love',
  'surprised',
  'sad',
  'angry',
  'confused',
  'sleepy',
  'thinking',
  'curious',
  'bye',
]

const STICKERS = [
  { id: 'mygo_love', emotion: 'love', filename: 'Mygo表情包_Love.webp' },
  { id: 'mygo_shy', emotion: 'shy', filename: 'Mygo表情包_害羞.webp' },
  { id: 'mygo_interesting_woman', emotion: 'happy', filename: 'Mygo表情包_有趣的女人.webp' },
  { id: 'mygo_matcha_parfait', emotion: 'happy', filename: 'Mygo表情包_抹茶芭菲.webp' },
  { id: 'mygo_order', emotion: 'neutral', filename: 'Mygo表情包_请点单.webp' },
  { id: 'mygo_send_message', emotion: 'neutral', filename: 'Mygo表情包_发送消息.webp' },
  { id: 'mygo_no_way', emotion: 'surprised', filename: 'Mygo表情包_不会吧？.webp' },
  { id: 'mygo_ha', emotion: 'surprised', filename: 'Mygo表情包_哈？.webp' },
  { id: 'mygo_why', emotion: 'confused', filename: 'Mygo表情包_为什么！.webp' },
  { id: 'mygo_peek', emotion: 'curious', filename: 'Mygo表情包_探头.webp' },
  { id: 'mygo_let_me_see', emotion: 'curious', filename: 'Mygo表情包_让我看看.webp' },
  { id: 'mygo_writing', emotion: 'thinking', filename: 'Mygo表情包_创作中.webp' },
  { id: 'mygo_sleepy', emotion: 'sleepy', filename: 'Mygo表情包_刚睡醒.webp' },
  { id: 'mygo_cry', emotion: 'sad', filename: 'Mygo表情包_大哭.webp' },
  { id: 'mygo_melancholy', emotion: 'sad', filename: 'Mygo表情包_忧郁.webp' },
  { id: 'mygo_what_about_me', emotion: 'sad', filename: 'Mygo表情包_那我呢？.webp' },
  { id: 'mygo_angry', emotion: 'angry', filename: 'Mygo表情包_生气.webp' },
  { id: 'mygo_block', emotion: 'angry', filename: 'Mygo表情包_Block!.webp' },
  { id: 'mygo_no_fighting', emotion: 'angry', filename: 'Mygo表情包_不要吵架.webp' },
  { id: 'mygo_bye', emotion: 'bye', filename: 'Mygo表情包_溜了溜了.webp' },
]

export default function plugin(ctx) {
  const triggerProbability = clamp01(Number(ctx.config?.triggerProbability ?? 0.45))
  const durationMs = Number(ctx.config?.durationMs ?? 4000)
  let lastStickerId

  return {
    id: 'sticker-expression',
    name: 'Sticker Expression',
    extendPrompt() {
      return [
        '表情包情绪控制规则：',
        `- 在 <response> 中额外输出一个 <emotion> 标签，值只能是：${BASIC_EMOTION_TAGS.join(', ')}`,
        '- <emotion> 是唯一的表情包控制参数，只描述本次回复最合适的情绪',
        '- 普通平静回复使用 neutral；调侃/开心用 happy 或 laugh；害羞用 shy；喜欢/亲近用 love',
        '- 惊讶用 surprised；难过/安慰用 sad；轻微生气或拒绝用 angry；困惑用 confused',
        '- 困倦用 sleepy；思考/等待用 thinking；好奇/查看用 curious；告别用 bye',
        '- <emotion> 不是给用户看的文字，不要写进 <reply>',
      ].join('\n')
    },
    selectExpression(context) {
      const emotion = normalizeEmotion(context.emotionTag)
      if (!emotion || Math.random() > triggerProbability) {
        return undefined
      }

      const candidates = STICKERS
        .filter(sticker => sticker.emotion === emotion)
        .map(sticker => ({
          ...sticker,
          assetPath: ctx.resolveAsset(sticker.filename),
        }))
        .filter(sticker => existsSync(sticker.assetPath))

      if (candidates.length === 0) {
        return undefined
      }

      const available = candidates.length > 1
        ? candidates.filter(sticker => sticker.id !== lastStickerId)
        : candidates
      const sticker = available[Math.floor(Math.random() * available.length)]
      lastStickerId = sticker.id

      return {
        type: 'expression_show',
        id: sticker.id,
        emotion,
        assetPath: sticker.assetPath,
        durationMs,
        priority: 40,
      }
    },
  }
}

function normalizeEmotion(value) {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  return BASIC_EMOTION_TAGS.includes(normalized) ? normalized : undefined
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}
