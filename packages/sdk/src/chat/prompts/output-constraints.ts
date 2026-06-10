/**
 * Modular output constraints for the standalone text chat runtime.
 */
export interface ChatOutputConstraint {
  id: string
  title: string
  prompt: string
}

export const NOEMA_CHAT_MARKUP_OUTPUT_CONSTRAINT: ChatOutputConstraint = {
  id: 'noema-chat-markup',
  title: 'Noema chat markup',
  prompt: [
    '<output_constraints id="noema-chat-markup">',
    'Return every assistant reply using the Noema chat markup protocol.',
    'The root must be <noema_chat>. Put user-visible natural language inside <reply>.',
    '',
    'Supported semantic tags:',
    '- <reply>Plain conversational content. This is the default container.</reply>',
    '- <section title="">Use for a named group of related explanation.</section>',
    '- <card tone="info|success|warning|danger" title="">Use for compact callouts, caveats, or important notes.</card>',
    '- <code lang="">Use only for source code, commands, or structured snippets.</code>',
    '',
    'Rules:',
    '- Use only the supported tags above.',
    '- Do not output arbitrary HTML, Markdown fences, inline style attributes, class names, scripts, or unsupported tags.',
    '- Do not expose hidden reasoning. Keep private reasoning out of the markup.',
    '- Prefer one concise <reply> for normal answers. Add section/card/code only when it improves readability.',
    '- Keep tags well-formed. Escape literal <, >, and & inside text as XML entities.',
    '',
    'Example:',
    '<noema_chat><reply>Short answer.</reply></noema_chat>',
    '</output_constraints>',
  ].join('\n'),
}

export function buildChatOutputConstraintPrompt(constraints: ChatOutputConstraint[] = [NOEMA_CHAT_MARKUP_OUTPUT_CONSTRAINT]): string {
  return constraints
    .map((constraint) => constraint.prompt.trim())
    .filter(Boolean)
    .join('\n\n')
}
