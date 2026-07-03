import type { Tool } from '../tools/types.js'
import type { CharacterProfile } from '../character-profile/index.js'
import { formatChatCharacterContext } from '../chat/index.js'
import { buildChatCharacterContext } from '../chat/conversation-runtime.js'
import {
  createRuntimeAwareness,
  formatAwarenessBlock,
  formatConversationLinePrefix,
  formatMessageTime,
  type RuntimeAwarenessSnapshot,
} from '../awareness/index.js'
import type { ResponseItem } from '../context/index.js'
import type { UserProfile, ConversationSummary } from '../memory/index.js'

export interface BaseInstructions {
  system: string
}

export interface PromptBuildOptions {
  tools?: Tool[]
  characterProfile?: CharacterProfile
  baseInstructions?: BaseInstructions
  userProfile?: UserProfile
  summaries?: ConversationSummary[]
  outputSchema?: any
  parallelToolCalls?: boolean
  pluginPromptAdditions?: string[]
  separateCurrentUserInput?: boolean
  awareness?: RuntimeAwarenessSnapshot
}


export class PromptBuilder {
  private static RECENT_CONVERSATION_LIMIT = 20
  private static DISTANT_CONVERSATION_END = 50

  
  static build(
    history: ResponseItem[],
    options: PromptBuildOptions = {}
  ): {
    system: string
    messages: any[]
    tools?: any[]
  } {
    const {
      tools = [],
      characterProfile,
      baseInstructions,
      userProfile,
      summaries = [],
      parallelToolCalls = true,
      pluginPromptAdditions = [],
      separateCurrentUserInput = true,
      awareness = createRuntimeAwareness()
    } = options

    const systemPrompt = this.buildXMLSystemPrompt({
      baseInstructions,
      characterProfile,
      userProfile,
      summaries,
      hasTools: tools.length > 0,
      pluginPromptAdditions,
      awareness,
    })

    const { historyMessages, currentUserMessages } = separateCurrentUserInput
      ? this.splitCurrentUserInput(history)
      : { historyMessages: history, currentUserMessages: [] }
    const messages = this.buildMessages(historyMessages, awareness)
    if (currentUserMessages.length > 0) {
      messages.push({
        role: 'user',
        content: this.formatCurrentUserInputXML(currentUserMessages, awareness),
      })
    }

    const toolSpecs = tools.length > 0
      ? this.buildToolSpecs(tools, parallelToolCalls)
      : undefined

    return {
      system: systemPrompt,
      messages,
      tools: toolSpecs
    }
  }

  
  private static buildXMLSystemPrompt(options: {
    baseInstructions?: BaseInstructions
    characterProfile?: CharacterProfile
    userProfile?: UserProfile
    summaries?: ConversationSummary[]
    hasTools?: boolean
    pluginPromptAdditions?: string[]
    awareness: RuntimeAwarenessSnapshot
  }): string {
    const sections: string[] = []

    // ========== Part 1: System Prompt ==========
    sections.push('<system_prompt>')

    if (options.characterProfile) {
      sections.push(formatChatCharacterContext(buildChatCharacterContext(options.characterProfile, {
        language: 'zh-CN',
        sceneImmersion: true,
        sceneState: options.characterProfile.scene,
      })))
    } else if (options.baseInstructions?.system) {
      sections.push(`<role>\n${options.baseInstructions.system}\n</role>`)
    }

    sections.push('</system_prompt>')

    // ========== Part 2: Memory ==========
    sections.push('\n<memory>')

    if (options.userProfile) {
      sections.push(this.formatUserProfileXML(options.userProfile))
    }

    if (options.summaries && options.summaries.length > 0) {
      sections.push(this.formatSummariesXML(options.summaries, options.awareness))
    }

    sections.push('</memory>')

    sections.push('\n<runtime_context>')
    sections.push(formatAwarenessBlock(options.awareness))
    sections.push('</runtime_context>')

    // ========== Part 4: Output Format ==========
    sections.push('\n<output_format>')
    sections.push(this.buildOutputFormatXML(options.hasTools || false, options.pluginPromptAdditions || []))
    sections.push('</output_format>')

    return sections.join('\n')
  }

  
  private static formatUserProfileXML(profile: UserProfile): string {
    const lines: string[] = ['<user_profile>']

    if (Object.keys(profile.basic).length > 0) {
      lines.push('基本信息:')
      Object.entries(profile.basic).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          const formattedValue = Array.isArray(value) ? value.join(', ') : value
          lines.push(`- ${key}: ${this.escapeXML(String(formattedValue))}`)
        }
      })
    }

    if (profile.importantMemories.size > 0) {
      lines.push('重要记忆:')
      profile.importantMemories.forEach((value, key) => {
        lines.push(`- ${key}: ${this.escapeXML(value)}`)
      })
    }

    lines.push('</user_profile>')
    return lines.join('\n')
  }

  
  private static formatSummariesXML(
    summaries: ConversationSummary[],
    awareness?: RuntimeAwarenessSnapshot
  ): string {
    const lines: string[] = ['<conversation_summaries>']

    summaries.forEach((summary) => {
      const time = awareness ? formatMessageTime(summary.timestamp, awareness) : ''
      const prefix = time ? `[${time}] ` : ''
      const topics = summary.keyTopics.length > 0 ? ` 主题: ${summary.keyTopics.join(', ')}` : ''
      lines.push(`- ${this.escapeXML(`${prefix}${summary.summary}${topics}`)}`)
    })

    lines.push('</conversation_summaries>')
    return lines.join('\n')
  }

  
  private static buildOutputFormatXML(
    hasTools: boolean,
    pluginPromptAdditions: string[]
  ): string {
    let instructions = '请按以下 XML 结构输出你的回复：\n\n'

    instructions += '<response>\n'
    instructions += '  <reply>你的情感回复内容</reply>\n'

    if (hasTools) {
      instructions += '  <task>\n'
      instructions += '    <has_task>true 或 false</has_task>\n'
      instructions += '    <description>如果有任务，描述具体要做什么</description>\n'
      instructions += '  </task>\n'
    }

    instructions += '</response>\n\n'

    instructions += '规则：\n'
    instructions += '- <reply> 是你作为 AI 伴侣的自然回复，要有情感、温暖\n'
    instructions += '- 保持回复简洁自然，使用口语化表达\n'

    if (pluginPromptAdditions.length > 0) {
      instructions += '\n插件扩展规则：\n'
      pluginPromptAdditions.forEach((addition, index) => {
        instructions += `<plugin_rule id="${index + 1}">\n${addition}\n</plugin_rule>\n`
      })
    }

    if (hasTools) {
      instructions += '- 当用户请求执行操作（创建文件、搜索、运行命令等）时，<has_task> 设为 true\n'
      instructions += '- <description> 用简洁的语言描述任务目标，如"在桌面创建名为 test.md 的空文件"\n'
      instructions += '- 纯聊天对话时 <has_task> 设为 false，无需 <description>\n'
      instructions += '- 不要在 reply 中写代码或命令，任务会自动执行\n'
      instructions += '- 当 <has_task> 为 true 时，reply 只能自然承接任务，例如"我来弄，等我一下"，不能声称已经完成\n'
      instructions += '- 任务执行前禁止说"打开好了"、"创建好了"、"发好了"、"已经完成"、"搞定了"等结果性表达\n'
    }

    return instructions
  }

  
  private static buildMessages(history: ResponseItem[], awareness: RuntimeAwarenessSnapshot): any[] {
    const messages: any[] = []

    const totalMessages = history.length
    const recentStart = Math.max(0, totalMessages - this.RECENT_CONVERSATION_LIMIT)

    const distantMessages = history.slice(
      Math.max(0, totalMessages - this.DISTANT_CONVERSATION_END),
      recentStart
    )
    const recentMessages = history.slice(recentStart)

    if (distantMessages.length > 0) {
      const distantXML = this.formatDistantConversationsXML(distantMessages, awareness)
      messages.push({
        role: 'user',
        content: distantXML
      })
    }

    const recentXML = this.formatRecentConversationsXML(recentMessages, awareness)
    messages.push({
      role: 'user',
      content: recentXML
    })

    return messages
  }

  
  private static splitCurrentUserInput(history: ResponseItem[]): {
    historyMessages: ResponseItem[]
    currentUserMessages: ResponseItem[]
  } {
    let lastAssistantIndex = -1

    for (let index = history.length - 1; index >= 0; index--) {
      if (history[index].role === 'assistant') {
        lastAssistantIndex = index
        break
      }
    }

    const currentStart = lastAssistantIndex + 1
    const currentUserMessages = history
      .slice(currentStart)
      .filter((item) => item.role === 'user')

    if (currentUserMessages.length === 0) {
      return {
        historyMessages: history,
        currentUserMessages: [],
      }
    }

    return {
      historyMessages: history.slice(0, currentStart),
      currentUserMessages,
    }
  }

  
  private static formatCurrentUserInputXML(
    messages: ResponseItem[],
    awareness: RuntimeAwarenessSnapshot
  ): string {
    return [
      '<current_user_input>',
      ...messages.map(item => `${formatConversationLinePrefix(item, awareness)} ${this.escapeXML(item.content)}`),
      '</current_user_input>'
    ].join('\n')
  }

  
  private static formatDistantConversationsXML(
    messages: ResponseItem[],
    awareness: RuntimeAwarenessSnapshot
  ): string {
    return [
      '<conversation_history type="distant">',
      ...messages.map(item => `${formatConversationLinePrefix(item, awareness)} ${this.escapeXML(item.content)}`),
      '</conversation_history>'
    ].join('\n')
  }

  
  private static formatRecentConversationsXML(
    messages: ResponseItem[],
    awareness: RuntimeAwarenessSnapshot
  ): string {
    const lines: string[] = ['<conversation_history type="recent">']

    messages.forEach(item => {
      const parts = [`${formatConversationLinePrefix(item, awareness)} ${this.escapeXML(item.content)}`]
      if (item.toolCalls && item.toolCalls.length > 0) {
        parts.push(`工具调用: ${item.toolCalls.map(call => `${call.name}(${JSON.stringify(call.arguments)})`).join(', ')}`)
      }
      if (item.toolResults && item.toolResults.length > 0) {
        parts.push(`工具结果: ${JSON.stringify(item.toolResults)}`)
      }
      lines.push(parts.join('\n  '))
    })

    lines.push('</conversation_history>')
    return lines.join('\n')
  }

  
  private static buildToolSpecs(tools: Tool[], _parallelCalls: boolean): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }))
  }

  
  private static escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
