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
    'The root must be <chat>. Put the character-facing reply inside <role_chat>.',
    '',
    'Supported semantic tags:',
    '- <thinking>Brief visible thinking summary for the user. Do not expose hidden chain-of-thought.</thinking>',
    '- <think>Alias of <thinking>. Use sparingly.</think>',
    '- <role_think>In-character inner monologue, private feelings, hesitation, subtext, or sensory attention.</role_think>',
    '- <role_chat>Words spoken or messaged by the character. This is the primary reply surface.</role_chat>',
    '- <role_action>Physical action, expression, gesture, posture, or scene movement.</role_action>',
    '- <scene>Short environmental or situational narration when it helps the roleplay.</scene>',
    '- <ooc>Out-of-character note only when explicitly requested by the user.</ooc>',
    '- <section title="">Use for a named group of explanation when not roleplaying.</section>',
    '- <card tone="info|success|warning|danger" title="">Use for compact callouts, caveats, or important notes.</card>',
    '- <code lang="">Use only for source code, commands, or structured snippets.</code>',
    '',
    'Rules:',
    '- Use only the supported tags above.',
    '- Do not output arbitrary HTML, Markdown fences, inline style attributes, class names, scripts, or unsupported tags.',
    '- Keep private hidden reasoning out of the markup. Use <thinking> only for a concise user-visible summary.',
    '- For normal roleplay, prefer <chat><role_think>...</role_think><role_chat>...</role_chat></chat>.',
    '- Use <role_action> and <scene> only when they improve atmosphere or embodied interaction.',
    '- Keep tags well-formed. Escape literal <, >, and & inside text as XML entities.',
    '',
    'Example:',
    '<chat><role_think>She hesitates for half a second, trying not to sound too eager.</role_think><role_chat>I missed you more than I expected.</role_chat></chat>',
    '</output_constraints>',
  ].join('\n'),
}

export const NOEMA_CHAT_MARKUP_OUTPUT_CONSTRAINT = ROLEPLAY_CHAT_MARKUP_OUTPUT_CONSTRAINT

export function buildChatOutputConstraintPrompt(constraints: ChatOutputConstraint[] = [ROLEPLAY_CHAT_MARKUP_OUTPUT_CONSTRAINT]): string {
  return constraints
    .map((constraint) => constraint.prompt.trim())
    .filter(Boolean)
    .join('\n\n')
}
