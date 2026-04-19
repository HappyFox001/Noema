# @her-text/sdk

Her-Text 核心 SDK - 基于 Codex agent 架构的情感化 AI 伴侣系统

## 核心特性

### 1. Agent 工作流生命周期

参考 Codex `/core/src/agent/control.rs`，实现完整的 agent 生命周期管理：

- **状态管理**: PendingInit → Running → Completed/Errored
- **工具执行**: 顺序/并行执行，钩子系统，超时控制
- **注册表**: Agent 实例管理，昵称生成，资源限制

### 2. Context 管理

参考 Codex `/core/src/context_manager/history.rs`：

- **截断策略**: Token/轮次限制，保留系统消息
- **规范化**: 移除图像，确保消息交替
- **Token 追踪**: 实时估算，历史版本控制

### 3. Prompt 构建

参考 Codex `/core/src/session/turn.rs build_prompt`：

- **多层次构建**: Base Instructions + Personality + Emotion + Memory
- **动态工具**: 运行时工具注册/卸载
- **输出格式**: JSON Schema 约束

### 4. Memory 自动总结

参考 Codex `/core/src/memory_trace.rs`：

- **三层记忆**: 工作记忆 → 长期记忆 → 语义知识
- **自动巩固**: LLM 批量总结，重要性评分，遗忘机制
- **向量检索**: 时间衰减，重要性加权

### 5. Tool 调用机制

参考 Codex `/core/src/tools/registry.rs`：

- **钩子系统**: pre/post/onError 钩子
- **并行执行**: Promise.all 并发调用
- **Diff 消费**: 流式参数更新（TODO）

## 快速开始

### 安装

```bash
pnpm add @her-text/sdk @her-text/types @her-text/core
```

### 基础用法

```typescript
import { HerTextSDK } from '@her-text/sdk'

// 1. 初始化 SDK
const sdk = await HerTextSDK.initialize({
  llm: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-3-5-sonnet-20241022'
  },
  memory: {
    vectorDB: 'chroma',
    storageDir: './data/memory'
  },
  personality: {
    traits: {
      openness: 0.8,
      conscientiousness: 0.7,
      extraversion: 0.6,
      agreeableness: 0.9,
      neuroticism: 0.4
    },
    character: {
      name: 'Luna',
      background: '一个温柔善良、充满好奇心的 AI 伴侣',
      values: ['真诚', '同理心', '成长'],
      speakingStyle: '温和自然，偶尔带点俏皮'
    },
    relationship: {
      type: 'companion',
      intimacy: 0.5,
      trust: 0.7
    }
  }
})

// 2. 发送消息
const response = await sdk.chat({
  text: '今天心情不太好',
  timestamp: Date.now()
})

console.log(response.text)         // AI 回复
console.log(response.emotion)      // 当前情感状态
console.log(response.shouldSpeak)  // 是否应该语音播放
```

### 流式对话

```typescript
for await (const chunk of sdk.chatStream({
  text: '给我讲个故事',
  timestamp: Date.now()
})) {
  process.stdout.write(chunk)
}
```

### 注册工具

```typescript
// 注册自定义工具
sdk.agent.registerTool({
  name: 'get_weather',
  description: '获取指定城市的天气',
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称'
      }
    },
    required: ['city']
  },
  execute: async (params) => {
    // 实际调用天气 API
    return { temperature: 22, condition: '晴朗' }
  }
})
```

### Context 管理

```typescript
// 设置截断策略
sdk.dialogue.setTruncationPolicy({
  maxTokens: 4096,
  maxTurns: 30,
  preserveRecentTurns: 5
})

// 获取统计信息
const stats = sdk.getStats()
console.log(`对话轮次: ${stats.turns}`)
console.log(`Token 使用: ${stats.tokens}`)

// 清空历史
sdk.clearHistory()
```

### Memory 操作

```typescript
// 手动检索记忆
const memories = await sdk.memory.retrieve('上次聊天的内容', {
  topK: 3
})

// 触发记忆巩固
await sdk.memory.consolidate()

// 获取语义记忆
const semantic = sdk.memory.getSemanticMemory()
console.log(semantic.userProfile.preferences)
```

### Emotion 状态

```typescript
// 获取当前情感
const emotion = sdk.emotion.getState()
console.log(`心境: ${emotion.mood}`)
console.log(`愉悦度: ${emotion.pleasure}`)

// 手动设置情感
sdk.emotion.setState({
  pleasure: 0.5,
  arousal: 0.3,
  mood: 'happy'
})
```

## 高级用法

### 完整的 Turn 生命周期

```typescript
const response = await sdk.chat(input)

// 生命周期阶段：
// Phase 1: 准备 - 情感分析 + 记忆检索 + 记录用户消息
// Phase 2: Prompt - 构建系统提示词 + 工具规范
// Phase 3: LLM - 调用模型
// Phase 4: 工具 - 执行工具调用（如果有）
// Phase 5: 响应 - 情感调整 + 记录助手消息
// Phase 6: 记忆 - 更新记忆系统
// Phase 7: 返回 - 返回最终响应
```

### 并行工具执行

```typescript
sdk.agent.setGlobalHooks({
  preToolUse: async (call) => {
    console.log(`准备执行工具: ${call.name}`)
  },
  postToolUse: async (call, result) => {
    console.log(`工具执行完成: ${call.name}`, result)
  },
  onError: async (call, error) => {
    console.error(`工具执行失败: ${call.name}`, error)
  }
})

// 并行执行多个工具
const results = await sdk.agent.executeParallel(toolCalls, {
  parallel: true,
  timeout: 5000
})
```

### 自定义 Prompt

```typescript
import { PromptBuilder } from '@her-text/sdk'

const prompt = PromptBuilder.build(
  contextHistory,
  {
    tools: sdk.agent.getTools(),
    personality: sdk.personality.getPersonality(),
    emotion: sdk.emotion.getState(),
    baseInstructions: {
      system: '自定义系统提示词',
      developer: '开发者指令'
    },
    relevantMemories: [],
    parallelToolCalls: true
  }
)

console.log(prompt.system)    // 完整系统提示
console.log(prompt.messages)  // 消息列表
console.log(prompt.tools)     // 工具规范
```

### Agent 注册表

```typescript
// 创建 Agent 实例
const agent = new AgentInstance('agent-1', {
  agentRole: 'explorer',
  agentNickname: sdk.registry.generateNickname('explorer')
})

// 注册到注册表
sdk.registry.register(agent)

// 查询
const allAgents = sdk.registry.getAll()
const explorers = sdk.registry.getByRole('explorer')

// 等待完成
const result = await agent.waitForCompletion(30000)
```

## 架构设计

```
HerTextSDK
├── EmotionEngine (情感引擎)
│   ├── PAD 情感模型
│   ├── 情绪衰减机制
│   └── 情感-响应映射
├── MemoryEngine (记忆引擎)
│   ├── 工作记忆 (短期)
│   ├── 长期记忆 (向量检索)
│   ├── 语义记忆 (知识库)
│   └── 自动巩固 (LLM 总结)
├── PersonalityEngine (人格引擎)
│   ├── Big Five 特质
│   ├── 角色设定
│   └── Prompt 生成
├── AgentCore (Agent 核心)
│   ├── 工具注册
│   ├── 并行执行
│   └── 钩子系统
├── ContextManager (上下文管理)
│   ├── 历史记录
│   ├── 截断策略
│   └── Token 追踪
├── PromptBuilder (Prompt 构建)
│   ├── 多层次组合
│   ├── 动态工具
│   └── 格式化输出
└── DialogueOrchestrator (对话编排)
    ├── Turn 生命周期
    ├── 流式处理
    └── 错误恢复
```

## 与 Codex 的对应关系

| Her-Text 模块 | Codex 参考文件 | 核心功能 |
|--------------|---------------|---------|
| `AgentCore` | `/core/src/agent/control.rs` | Agent 生命周期、工具执行 |
| `AgentRegistry` | `/core/src/agent/registry.rs` | 实例管理、资源限制 |
| `ContextManager` | `/core/src/context_manager/history.rs` | 历史管理、截断策略 |
| `PromptBuilder` | `/core/src/session/turn.rs` | Prompt 构建、工具规范 |
| `MemoryEngine` | `/core/src/memory_trace.rs` | 记忆总结、巩固机制 |
| `AgentCore.execute` | `/core/src/tools/registry.rs` | 工具调用、钩子系统 |

## TODO

- [ ] 向量数据库集成 (ChromaDB/LanceDB)
- [ ] 工具 Diff 消费机制
- [ ] Multi-agent 协调 (Mailbox)
- [ ] Agent 角色系统
- [ ] 持久化存储
- [ ] 度量和分析

## License

MIT
