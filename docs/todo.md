# Chat 重构 Todo

目标：将 chat 页面中可复用、可测试、与 UI 无关的运行时语义下沉到 SDK；`apps/desktop` 只保留 Electron/浏览器必须承担的能力和渲染交互。

## 1. SDK Chat Runtime 边界

- [x] 在 `packages/sdk` 中定义 chat runtime 服务边界，例如 `ChatRuntime` / `ConversationRuntime`。
- [x] 定义稳定的 chat 请求类型：`conversationId`、`input`、`attachments`、`language`、`stream`、`runtimeOptions`。
- [x] 定义稳定的 chat 事件协议：`message.started`、`message.delta`、`message.completed`、`scene.updated`、`summary.created`、`artifact.created`、`error`。
- [x] 将 `ChatSession` 从单轮模型调用扩展为可管理 conversation turn 的运行时能力，或在其上层新增 runtime。
- [x] 将 chat 错误归一化放入 SDK，desktop 只展示错误消息。

## 2. Conversation 组装下沉

- [ ] 将用户输入、历史消息、附件、角色信息、语言和偏好组装逻辑从 `apps/desktop/src/renderer/surfaces/chat-panel.ts` 移入 SDK。
- [ ] 将 character context 构建策略放入 SDK，包括 `displayName`、`description`、`story`、`background`、`firstMessage`、`tags`。
- [ ] 将 scene state 序列化和 prompt 注入规则放入 SDK。
- [x] 将 narrative summaries 的选择和注入规则放入 SDK。
- [x] 将附件 normalization 放入 SDK，包括图片 data URL、多模态 message parts、视频附件描述。
- [ ] 保留 renderer 中的附件选择 UI，但不要在 renderer 中决定附件如何进入模型 prompt。

## 3. 会话状态与摘要策略

- [x] 在 SDK 中定义 conversation state 类型，包括 messages、scene state、summaries、artifacts。
- [x] 将 `summarizeConversationOverflow` 的触发条件移入 SDK。
- [x] 将历史压缩 prompt 和摘要保留策略移入 SDK。
- [ ] 将 summary limit、short-term turns 等配置变成 SDK runtime options。
- [x] 将 scene update markup 解析移入 SDK，renderer 只接收 `scene.updated` patch。
- [x] 将 scene state merge 规则移入 SDK，renderer 只渲染合并后的状态。

## 4. 流式输出与渲染边界

- [x] 由 SDK 决定是否支持/执行流式输出，desktop 只透传 stream preference。
- [ ] 将 stream delta、最终消息、场景更新、摘要生成、artifact 生成统一成 SDK events。
- [ ] 保留 renderer 的逐字 reveal / animation，但输入必须来自 SDK event。
- [ ] 删除 renderer 中对 raw model reply 的业务解析。
- [ ] 确保非流式路径和流式路径产出同一组最终事件和 conversation state。

## 5. 模型配置与 provider 执行

- [ ] 保持 settings/env 加载在 desktop，但转换成 SDK config 后由 SDK 统一执行。
- [x] 将 chat model selection 的运行时解析放入 SDK，例如 active API、model name、provider、base URL。
- [x] 评估 `chat:listModels` 是否应迁入 SDK model service。
- [ ] 将 provider-specific request cleanup、proxy、reasoning defaults 保持在 SDK provider 层。
- [ ] 避免 renderer 直接理解 provider runtime 差异。

## 6. 生图模型与 Artifact

- [ ] 将 image model 请求构建和 provider 调用统一放在 SDK。
- [ ] 将生图结果标准化为 SDK artifact。
- [x] 将 character workflow 中的 image artifact 生成逻辑从 desktop handler 移入 SDK。
- [x] 定义 image model capability 和 LLM model capability 的统一 resolver。
- [ ] renderer 只展示 artifact，不直接处理生图执行细节。

## 7. Character Workflow 下沉

- [x] 将 `createDesktopCharacterAgentTools` 中的 agent 工具定义迁移到 SDK。
- [x] 将 `runCharacterAgentLLMTool`、模型查找、候选包生成、质量门、repair、export package 放入 SDK。
- [x] desktop handler 只负责接收 workflow snapshot、调用 SDK、返回 run events/artifacts。
- [ ] 将 workflow run 状态设计为 SDK event stream，便于 renderer 实时展示。
- [ ] 保持 Electron 特有能力以 adapter 形式注入，而不是写进 SDK 核心。

## 8. Desktop Main 瘦身

- [ ] 将 `apps/desktop/src/main/chat-ipc-handlers.ts` 改成薄 IPC adapter。
- [ ] 保留 `selectMedia`、`requestCameraPermission` 等 Electron 必须逻辑在 main 层。
- [ ] 保留 chat history 的本地存储路径 wiring，但评估是否通过 SDK storage adapter 执行。
- [x] 让 IPC handler 调用 SDK runtime，而不是自己拼 prompt、跑 agent 工具。
- [x] 统一 `sendChatMessage` 和 `streamChatMessage` 的后端处理路径。

## 9. Renderer 简化

- [ ] 将 `queueAssistantReply` 简化为创建用户 UI 状态、调用 IPC、订阅事件、渲染结果。
- [x] 删除 renderer 中的 conversation context message 构建。
- [x] 删除 renderer 中的 scene update markup 解析和合并。
- [ ] 删除 renderer 中的摘要触发和摘要 prompt。
- [ ] 保留 renderer 的 DOM 渲染、输入框、附件选择按钮、toast、面板状态、动画。
- [ ] 让 renderer 使用 SDK 返回的 conversation snapshot 刷新本地 UI。

## 10. Verification

- [x] 为 SDK chat runtime 添加单元测试：prompt assembly、attachments、character context、summary selection、scene merge。
- [x] 为 SDK stream event 协议添加测试，确保流式/非流式最终状态一致。
- [ ] 为 character workflow SDK 迁移添加测试，覆盖 LLM tool、image artifact、quality gate。
- [ ] 修改 SDK 后运行 `pnpm --filter @her-text/sdk build`。
- [ ] 修改 desktop runtime 后运行 `pnpm --filter @her-text/desktop build`。
- [ ] 对改动过的 `.mjs` runtime plugin 文件运行 `node --check`。
