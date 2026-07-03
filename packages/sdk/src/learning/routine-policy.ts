/**
 * Applies learned routines as expression strategy only.
 */
import type { LearningAsset, RoutinePolicy } from './types.js'

export interface RoutinePolicySelection {
  routines: Array<LearningAsset & { content: RoutinePolicy }>
  promptAddition: string
}

export function selectExpressionRoutines(
  assets: Array<LearningAsset & { content: RoutinePolicy }>,
  scope: RoutinePolicy['scope']
): RoutinePolicySelection {
  const routines = assets
    .filter(asset => asset.status === 'active')
    .filter(asset => asset.content.scope === scope)
    .filter(asset => isAllowedExpressionRoutine(asset.content))
    .slice(0, 5)

  return {
    routines,
    promptAddition: renderRoutinePromptAddition(routines),
  }
}

export function isAllowedExpressionRoutine(policy: RoutinePolicy): boolean {
  const text = `${policy.condition}\n${policy.behavior}`.toLowerCase()
  const blockedPatterns = [
    /temperature/,
    /max tokens?/,
    /reasoning/,
    /model name/,
    /vad/,
    /endpointing/,
    /tts/,
    /voice id/,
    /volume/,
    /speakingstyle/,
    /character profile/,
    /intimacy/,
    /trust/,
    /tool permission/,
    /plugin/,
    /agent permission/,
    /模型参数/,
    /人格配置/,
    /音色/,
    /音量/,
    /语速/,
    /工具权限/,
    /插件/,
  ]
  return !blockedPatterns.some(pattern => pattern.test(text))
}

export function renderRoutinePromptAddition(
  routines: Array<LearningAsset & { content: RoutinePolicy }>
): string {
  if (routines.length === 0) {
    return ''
  }

  return [
    'Learned expression routines for this turn:',
    ...routines.map((asset, index) => [
      `${index + 1}. Condition: ${asset.content.condition}`,
      `   Behavior: ${asset.content.behavior}`,
      '   Boundary: Apply only as response style/channel strategy. Do not change model, persona, audio, tool, plugin, or agent permissions.',
    ].join('\n')),
  ].join('\n')
}
