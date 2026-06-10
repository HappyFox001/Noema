/**
 * Modular output constraints for the standalone text chat runtime.
 */
export interface ChatOutputConstraint {
  id: string
  title: string
  prompt: string
}

export const ROLEPLAY_CHAT_MARKUP_OUTPUT_CONSTRAINT: ChatOutputConstraint = {
  id: 'roleplay-chat-markup',
  title: 'Roleplay chat markup',
  prompt: [
    '<output_constraints id="roleplay-chat-markup">',
    'Return every assistant reply using the roleplay chat markup protocol.',
    'The root must be <chat>. Normal story progression, narration, atmosphere, and scene description should be plain untagged prose inside <chat>.',
    'Only wrap direct character dialogue. Everything else should remain plain novel prose.',
    '',
    'Supported semantic tags:',
    '- <role_chat>Words spoken or messaged by a character. Do not include quotation marks inside this tag; the renderer adds them.</role_chat>',
    '',
    'Rules:',
    '- Use only the supported tags above.',
    '- Do not output arbitrary HTML, Markdown fences, inline style attributes, class names, scripts, or unsupported tags.',
    '- Do not output hidden reasoning or chain-of-thought.',
    '- For normal roleplay, prefer: <chat>plain narration and story progress<role_chat>spoken words</role_chat>more narration</chat>.',
    '- Do not wrap ordinary narration in a tag. The renderer treats untagged prose inside <chat> as the main story text.',
    '- Write like a novel: all non-dialogue content is narration. Character speech is the only part wrapped as dialogue.',
    '- Do not use speaker-name prefixes. If the speaker needs to be clear, make it clear in the surrounding prose.',
    '- Do not write visible labels such as "内心:", "动作:", "场景:", "思考:", "Action:", or "Scene:".',
    '- Every reply should make the situation move forward: a new detail, reaction, choice pressure, event, consequence, or emotional turn.',
    '- Keep tags well-formed. Escape literal <, >, and & inside text as XML entities.',
    '',
    'Example:',
    '<chat>She looks away for half a second, the silence carrying more than she wants to admit.<role_chat>I missed you more than I expected.</role_chat>The words leave her softer than she intended.</chat>',
    '</output_constraints>',
  ].join('\n'),
}

export function buildChatOutputConstraintPrompt(constraints: ChatOutputConstraint[] = [ROLEPLAY_CHAT_MARKUP_OUTPUT_CONSTRAINT]): string {
  return constraints
    .map((constraint) => constraint.prompt.trim())
    .filter(Boolean)
    .join('\n\n')
}
