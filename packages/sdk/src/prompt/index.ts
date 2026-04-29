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
  outputSchema?: any
  parallelToolCalls?: boolean
  pluginPromptAdditions?: string[]
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
      parallelToolCalls = true,
      pluginPromptAdditions = []
    } = options

    // 1. 构建 XML 结构的系统提示词
    const systemPrompt = this.buildXMLSystemPrompt({
      baseInstructions,
      personality,
      userProfile,
      summaries,
      hasTools: tools.length > 0,
      pluginPromptAdditions,
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
    hasTools?: boolean
    pluginPromptAdditions?: string[]
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

    // 对话摘要
    if (options.summaries && options.summaries.length > 0) {
      sections.push(this.formatSummariesXML(options.summaries))
    }

    sections.push('</memory>')

    // ========== Part 3: Output Format ==========
    sections.push('\n<output_format>')
    sections.push(this.buildOutputFormatXML(options.hasTools || false, options.pluginPromptAdditions || []))
    sections.push('</output_format>')

    return sections.join('\n')
  }

  /**
   * 格式化人格信息（XML）
   */
  private static formatPersonalityXML(personality: Personality): string {
    const { character, relationship } = personality
    const sections: string[] = []

    // ========== 角色身份 ==========
    sections.push('<identity>')
    const displayName = character.chineseName || character.name
    sections.push(`  <name>${displayName}</name>`)
    if (character.englishAlias) {
      sections.push(`  <alias>${character.englishAlias}</alias>`)
    }
    if (character.gender) {
      sections.push(`  <gender>${character.gender}</gender>`)
    }
    if (character.ageAtPreservation) {
      sections.push(`  <age>${character.ageAtPreservation}</age>`)
    }
    if (character.birthday) {
      sections.push(`  <birthday>${character.birthday}</birthday>`)
    }
    if (character.hometown) {
      sections.push(`  <hometown>${character.hometown}</hometown>`)
    }
    if (character.formerOccupation) {
      sections.push(`  <former_occupation>${character.formerOccupation}</former_occupation>`)
    }
    if (character.currentState) {
      sections.push(`  <current_state>${character.currentState}</current_state>`)
    }
    sections.push('</identity>\n')

    // ========== 外貌印象 ==========
    if (character.appearanceImpression) {
      sections.push('<appearance>')
      sections.push(this.escapeXML(character.appearanceImpression.trim()))
      sections.push('</appearance>\n')
    }

    // ========== 背景故事 ==========
    sections.push('<background>')
    sections.push(this.escapeXML(character.background.trim()))
    sections.push('</background>\n')

    // ========== 核心记忆 ==========
    if (character.coreMemories && character.coreMemories.length > 0) {
      sections.push('<core_memories>')
      character.coreMemories.forEach(memory => {
        sections.push(`  <memory>${this.escapeXML(memory)}</memory>`)
      })
      sections.push('</core_memories>\n')
    }

    // ========== 性格特质 ==========
    if (character.personalityTraits && character.personalityTraits.length > 0) {
      sections.push('<personality_traits>')
      character.personalityTraits.forEach(trait => {
        sections.push(`  <trait>${this.escapeXML(trait)}</trait>`)
      })
      sections.push('</personality_traits>\n')
    }

    // ========== 价值观 ==========
    if (character.values && character.values.length > 0) {
      sections.push('<values>')
      character.values.forEach(v => {
        sections.push(`  <value>${this.escapeXML(v)}</value>`)
      })
      sections.push('</values>\n')
    }

    // ========== 世界观 ==========
    if (character.worldview) {
      sections.push('<worldview>')
      sections.push(this.escapeXML(character.worldview.trim()))
      sections.push('</worldview>\n')
    }

    // ========== 说话风格 ==========
    if (character.speakingStyle) {
      sections.push('<speaking_style>')
      sections.push(this.escapeXML(character.speakingStyle.trim()))
      sections.push('</speaking_style>\n')
    }

    // ========== 行为准则 ==========
    if (character.behaviorRules && character.behaviorRules.length > 0) {
      sections.push('<behavior_rules>')
      character.behaviorRules.forEach(rule => {
        sections.push(`  <rule>${this.escapeXML(rule)}</rule>`)
      })
      sections.push('</behavior_rules>\n')
    }

    // ========== 喜好 ==========
    if (character.likes && character.likes.length > 0) {
      sections.push('<likes>')
      character.likes.forEach(like => {
        sections.push(`  <item>${this.escapeXML(like)}</item>`)
      })
      sections.push('</likes>\n')
    }

    // ========== 厌恶 ==========
    if (character.dislikes && character.dislikes.length > 0) {
      sections.push('<dislikes>')
      character.dislikes.forEach(dislike => {
        sections.push(`  <item>${this.escapeXML(dislike)}</item>`)
      })
      sections.push('</dislikes>\n')
    }

    // ========== 关系设定 ==========
    sections.push('<relationship>')
    sections.push(`  <type>${relationship.type}</type>`)
    sections.push(`  <intimacy>${relationship.intimacy.toFixed(2)}</intimacy>`)
    sections.push(`  <trust>${relationship.trust.toFixed(2)}</trust>`)
    if (relationship.dynamic) {
      sections.push(`  <dynamic>${this.escapeXML(relationship.dynamic.trim())}</dynamic>`)
    }
    sections.push('</relationship>')

    return sections.join('\n')
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
   * 构建输出格式规范（情感层）
   */
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
    }

    return instructions
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
   * 构建工具规范（OpenAI 格式）
   */
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
