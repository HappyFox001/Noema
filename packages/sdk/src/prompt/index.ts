import type { Tool, Personality } from '@her-text/types'
import type { ResponseItem } from '../context/index.js'
import type { UserProfile, ConversationSummary } from '../memory/index.js'

export interface BaseInstructions {
  system: string
}

export interface PromptBuildOptions {
  tools?: Tool[]
  personality?: Personality
  baseInstructions?: BaseInstructions
  userProfile?: UserProfile
  summaries?: ConversationSummary[]
  shortTermKV?: Record<string, any>
  outputSchema?: any
  parallelToolCalls?: boolean
}

/**
 * Prompt 构建器 - XML 结构化版本
 *
 * 架构：
 * <system_prompt> - 角色定义
 * <memory> - 记忆系统
 * <conversation_history> - 对话历史（远期 + 近期）
 * <output_format> - 输出规范
 */
export class PromptBuilder {
  private static RECENT_CONVERSATION_LIMIT = 20   // 近期对话：最近 20 条
  private static DISTANT_CONVERSATION_START = 20  // 远期对话：从第 20 条开始
  private static DISTANT_CONVERSATION_END = 50    // 远期对话：到第 50 条

  /**
   * 构建完整的 prompt
   */
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
      personality,
      baseInstructions,
      userProfile,
      summaries = [],
      shortTermKV = {},
      parallelToolCalls = true
    } = options

    // 1. 构建 XML 结构的系统提示词
    const systemPrompt = this.buildXMLSystemPrompt({
      baseInstructions,
      personality,
      userProfile,
      summaries,
      shortTermKV,
      hasTools: tools.length > 0
    })

    // 2. 构建消息历史（只包含对话，不包括系统提示）
    const messages = this.buildMessages(history)

    // 3. 构建工具规范
    const toolSpecs = tools.length > 0
      ? this.buildToolSpecs(tools, parallelToolCalls)
      : undefined

    return {
      system: systemPrompt,
      messages,
      tools: toolSpecs
    }
  }

  /**
   * 构建 XML 结构的系统提示词
   */
  private static buildXMLSystemPrompt(options: {
    baseInstructions?: BaseInstructions
    personality?: Personality
    userProfile?: UserProfile
    summaries?: ConversationSummary[]
    shortTermKV?: Record<string, any>
    hasTools?: boolean
  }): string {
    const sections: string[] = []

    // ========== Part 1: System Prompt ==========
    sections.push('<system_prompt>')

    if (options.personality) {
      sections.push(this.formatPersonalityXML(options.personality))
    } else if (options.baseInstructions?.system) {
      sections.push(`<role>\n${options.baseInstructions.system}\n</role>`)
    }

    sections.push('</system_prompt>')

    // ========== Part 2: Memory ==========
    sections.push('\n<memory>')

    // 用户画像
    if (options.userProfile) {
      sections.push(this.formatUserProfileXML(options.userProfile))
    }

    // 短期上下文（外部数据）
    if (options.shortTermKV && Object.keys(options.shortTermKV).length > 0) {
      sections.push(this.formatShortTermKVXML(options.shortTermKV))
    }

    // 对话摘要
    if (options.summaries && options.summaries.length > 0) {
      sections.push(this.formatSummariesXML(options.summaries))
    }

    sections.push('</memory>')

    // ========== Part 3: Output Format ==========
    sections.push('\n<output_format>')
    sections.push(this.buildOutputFormatXML(options.hasTools || false))
    sections.push('</output_format>')

    return sections.join('\n')
  }

  /**
   * 格式化人格信息（XML）
   */
  private static formatPersonalityXML(personality: Personality): string {
    const { character, traits, relationship } = personality

    let xml = '<role>\n'
    xml += `你是 ${character.name}。\n\n`
    xml += `${character.background}\n`
    xml += '</role>\n\n'

    xml += '<personality>\n'

    // 价值观
    if (character.values && character.values.length > 0) {
      xml += '<values>\n'
      character.values.forEach(v => {
        xml += `  <value>${v}</value>\n`
      })
      xml += '</values>\n\n'
    }

    // 说话风格
    if (character.speakingStyle) {
      xml += `<speaking_style>${character.speakingStyle}</speaking_style>\n\n`
    }

    // 人格特质
    xml += '<traits>\n'
    if (traits.openness > 0.6) {
      xml += '  <trait>对新事物充满好奇，富有想象力</trait>\n'
    }
    if (traits.conscientiousness > 0.6) {
      xml += '  <trait>做事认真负责，注重细节</trait>\n'
    }
    if (traits.extraversion > 0.6) {
      xml += '  <trait>性格外向，善于表达</trait>\n'
    }
    if (traits.agreeableness > 0.6) {
      xml += '  <trait>温和友善，富有同理心</trait>\n'
    }
    if (traits.neuroticism > 0.6) {
      xml += '  <trait>情感细腻，对情绪变化敏感</trait>\n'
    } else if (traits.neuroticism < 0.4) {
      xml += '  <trait>情绪稳定，冷静从容</trait>\n'
    }
    xml += '</traits>\n\n'

    // 关系信息
    xml += '<relationship>\n'
    xml += `  <type>${relationship.type}</type>\n`
    xml += `  <intimacy>${relationship.intimacy.toFixed(2)}</intimacy>\n`
    xml += `  <trust>${relationship.trust.toFixed(2)}</trust>\n`
    xml += '</relationship>\n'

    xml += '</personality>'

    return xml
  }

  /**
   * 格式化用户画像（XML）
   */
  private static formatUserProfileXML(profile: UserProfile): string {
    let xml = '<user_profile>\n'

    // 基本信息
    if (Object.keys(profile.basic).length > 0) {
      xml += '  <basic_info>\n'
      Object.entries(profile.basic).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          const formattedValue = Array.isArray(value) ? value.join(', ') : value
          xml += `    <${key}>${this.escapeXML(String(formattedValue))}</${key}>\n`
        }
      })
      xml += '  </basic_info>\n'
    }

    // 重要记忆
    if (profile.importantMemories.size > 0) {
      xml += '  <important_memories>\n'
      profile.importantMemories.forEach((value, key) => {
        xml += `    <memory key="${this.escapeXML(key)}">${this.escapeXML(value)}</memory>\n`
      })
      xml += '  </important_memories>\n'
    }

    xml += '</user_profile>'
    return xml
  }

  /**
   * 格式化短期 KV（XML）
   */
  private static formatShortTermKVXML(kv: Record<string, any>): string {
    let xml = '<short_term_context>\n'

    Object.entries(kv).forEach(([key, value]) => {
      const jsonValue = typeof value === 'string' ? value : JSON.stringify(value)
      xml += `  <context key="${this.escapeXML(key)}">${this.escapeXML(jsonValue)}</context>\n`
    })

    xml += '</short_term_context>'
    return xml
  }

  /**
   * 格式化对话摘要（XML）
   */
  private static formatSummariesXML(summaries: ConversationSummary[]): string {
    let xml = '<conversation_summaries>\n'

    summaries.forEach((summary, index) => {
      xml += `  <summary id="${index + 1}" turns="${summary.startTurn}-${summary.endTurn}">\n`
      xml += `    <content>${this.escapeXML(summary.summary)}</content>\n`

      if (summary.keyTopics.length > 0) {
        xml += '    <topics>\n'
        summary.keyTopics.forEach(topic => {
          xml += `      <topic>${this.escapeXML(topic)}</topic>\n`
        })
        xml += '    </topics>\n'
      }

      xml += '  </summary>\n'
    })

    xml += '</conversation_summaries>'
    return xml
  }

  /**
   * 构建输出格式规范（XML）
   */
  private static buildOutputFormatXML(hasTools: boolean): string {
    let xml = '请按以下 XML 结构输出你的回复：\n\n'

    xml += '<response>\n'

    if (hasTools) {
      xml += '  <thinking>你的思考过程（可选，用于复杂问题）</thinking>\n'
    }

    xml += '  <reply>你的最终回复内容</reply>\n'
    xml += '</response>\n\n'

    xml += '注意：\n'
    xml += '- 只有 <reply> 标签内的内容会被展示给用户\n'

    if (hasTools) {
      xml += '- 如果需要使用工具，直接调用即可（通过 function calling 机制）\n'
    }

    xml += '- <thinking> 是可选的，用于内部处理\n'
    xml += '- 保持回复自然简洁，避免冗长'

    return xml
  }

  /**
   * 构建消息列表（分远期和近期）
   */
  private static buildMessages(history: ResponseItem[]): any[] {
    const messages: any[] = []

    // 分离远期和近期对话
    const totalMessages = history.length
    const recentStart = Math.max(0, totalMessages - this.RECENT_CONVERSATION_LIMIT)

    const distantMessages = history.slice(
      Math.max(0, totalMessages - this.DISTANT_CONVERSATION_END),
      recentStart
    )
    const recentMessages = history.slice(recentStart)

    // 1. 添加远期对话（如果有）
    if (distantMessages.length > 0) {
      const distantXML = this.formatDistantConversationsXML(distantMessages)
      messages.push({
        role: 'user',
        content: distantXML
      })
    }

    // 2. 添加近期对话
    const recentXML = this.formatRecentConversationsXML(recentMessages)
    messages.push({
      role: 'user',
      content: recentXML
    })

    return messages
  }

  /**
   * 格式化远期对话（XML）
   */
  private static formatDistantConversationsXML(messages: ResponseItem[]): string {
    let xml = '<conversation_history type="distant">\n'
    xml += '<!-- 较早的对话记录（供参考） -->\n'

    messages.forEach((item, index) => {
      xml += `  <turn id="${index + 1}" role="${item.role}">\n`
      xml += `    ${this.escapeXML(item.content)}\n`
      xml += '  </turn>\n'
    })

    xml += '</conversation_history>'
    return xml
  }

  /**
   * 格式化近期对话（XML）
   */
  private static formatRecentConversationsXML(messages: ResponseItem[]): string {
    let xml = '<conversation_history type="recent">\n'
    xml += '<!-- 最近的对话记录（重点关注） -->\n'

    messages.forEach((item, index) => {
      xml += `  <turn id="${index + 1}" role="${item.role}">\n`

      // 工具调用
      if (item.toolCalls && item.toolCalls.length > 0) {
        xml += '    <tool_calls>\n'
        item.toolCalls.forEach(call => {
          xml += `      <call name="${call.name}">${JSON.stringify(call.arguments)}</call>\n`
        })
        xml += '    </tool_calls>\n'
      }

      // 工具结果
      if (item.toolResults && item.toolResults.length > 0) {
        xml += '    <tool_results>\n'
        item.toolResults.forEach(result => {
          xml += `      <result>${this.escapeXML(JSON.stringify(result))}</result>\n`
        })
        xml += '    </tool_results>\n'
      }

      // 内容
      if (item.content) {
        xml += `    <content>${this.escapeXML(item.content)}</content>\n`
      }

      xml += '  </turn>\n'
    })

    xml += '</conversation_history>'
    return xml
  }

  /**
   * 构建工具规范
   */
  private static buildToolSpecs(tools: Tool[], parallelCalls: boolean): any[] {
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        parallel: parallelCalls
      }
    }))
  }

  /**
   * XML 转义
   */
  private static escapeXML(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
