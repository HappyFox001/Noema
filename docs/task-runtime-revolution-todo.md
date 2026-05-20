# Task Runtime Revolution TODO

目标：把 Her-Text 的任务能力从“对话中顺手执行工具”升级为“可长期工作、可被语言打断、可恢复、可验证、可自主取舍的强任务系统”。

这不是对现有 `TaskRuntime` 的小修小补。新的任务系统必须按三层形态重建：

- 情感层：负责关系、语气、自然语言、TTS/display/expression 输出。当前 TTS 输出路径整体保留，不做大改。
- 任务层：负责事实、工作状态、工具执行、上下文、验证、恢复、并行和长程问题解决能力。目标是复制 Codex 的核心执行能力。
- 情感任务交互层：负责两层之间的事件、时机、任务状态投递、用户语言打断语义、任务继续/暂停/放弃判断。

## 非目标

- 不以兼容旧任务插件 hook 为目标。
- 不把旧 `TaskRuntime` 包一层然后宣称完成。
- 不把任务状态写成普通聊天摘要后交给模型猜。
- 不让情感层伪造任务事实、完成状态、失败原因或验证结果。
- 不默认把语音打断等同于任务取消。

## 设计原则

- 打断输出不等于打断任务。
- 新对话 turn 不等于新任务生命周期。
- 任务失败不等于工作现场消失。
- 任务取消不等于工作记忆删除。
- 情感层负责表达，任务层负责事实，交互层负责时机和语义路由。
- 长程任务必须有可机械验证的进展记录，否则不能算强任务能力。
- 每一次执行、失败、取消、打断都必须留下可恢复的结构化现场。
- 可以参考甚至代码级别借鉴 Codex 的实现思路，但 Her-Text 新增文件名、目录名、模块名、类名、类型名、事件名、工具名和 public API 都不能出现 `codex` 字样。

## 参考对象

- Codex core：`other/codex/codex-rs/core`
  - 重点参考 Session / Task / Turn 分层。
  - 重点参考 tool router / tool orchestrator / sandbox / approval / cancellation / compaction / event queue。
  - 目标是复制核心问题解决能力，不是复制 CLI 形态。
  - 命名必须 Her-Text 化。参考对象可以叫 Codex，但实现里的文件和类型不能叫 `Codex*`、`*Codex*` 或包含 `codex`。
- codex-autoresearch：`other/codex-autoresearch`
  - 重点参考 goal / metric / verify / guard / keep-discard / rollback / results log / resume / pivot。
  - 作为任务层之上的长程执行层，不直接塞进情感层。

## Phase 0: 架构边界冻结

- [x] 写出新的 runtime 边界文档：`EmotionalRuntime`、`WorkRuntime`、`InteractionRuntime`、`OutputRuntime` 的职责和禁止事项。
- [x] 定义三层之间只通过结构化事件通信，不允许互相直接调用内部状态。
- [x] 明确当前 `DialogueOrchestrator` 中哪些职责要迁出：任务 admission、任务执行等待、任务进度话术触发、任务结果二次调用。
- [x] 明确当前 TTS 路径保留边界：`ResponseFramePipeline`、TTS provider、Fish S2 text transform、display transform 不做大规模替换。
- [x] 定义旧任务系统的废弃计划，避免长期双轨维护。
- [x] 定义命名约束：实现中禁用 `codex` 字样，统一使用 Her-Text 自己的 `Work*`、`Task*`、`Tool*`、`Runtime*`、`LongRun*` 命名。

验收：

- [x] 有一份可评审的架构文档。
- [x] 每个 runtime 的输入、输出、状态所有权明确。
- [x] 能用文档解释“用户打断语音但任务继续”的完整事件流。
- [x] 架构文档列出禁止命名示例和推荐替代命名。

## Phase 1: 统一事件模型

- [x] 扩展 `RuntimeEvent`，覆盖情感层、任务层和交互层的完整事件。
- [x] 新增 interaction events：
  - [x] `interaction.input.received`
  - [x] `interaction.intent.resolved`
  - [x] `interaction.speech.stop_requested`
  - [x] `interaction.speech.mute_requested`
  - [x] `interaction.work.modify_requested`
  - [x] `interaction.work.status_requested`
  - [x] `interaction.work.resume_requested`
  - [x] `interaction.work.cancel_requested`
- [x] 新增 work events：
  - [x] `work.thread.created`
  - [x] `work.thread.focused`
  - [x] `work.thread.paused`
  - [x] `work.thread.resumed`
  - [x] `work.thread.abandoned`
  - [x] `work.state.snapshot`
  - [x] `work.signal.emitted`
  - [x] `work.artifact.created`
  - [x] `work.decision.recorded`
  - [x] `work.failure.recorded`
- [x] 新增 task execution events：
  - [x] `task.turn.started`
  - [x] `task.turn.completed`
  - [x] `task.tool.started`
  - [x] `task.tool.completed`
  - [x] `task.tool.failed`
  - [x] `task.context.compacted`
  - [x] `task.pending_input.added`
- [x] 保证所有事件都有 `correlationId`、`threadId`、`taskId` 或 `goalId` 的可追踪关系。
- [ ] Desktop UI 和 work surface 从事件派生状态，不再依赖零散 callback。

验收：

- [ ] 单个用户输入到任务执行完成的事件流可重放。
- [ ] 用户打断 TTS 时只产生 speech/output 事件，不会隐式取消任务。
- [ ] 任务失败和任务取消能生成不同事件链。

## Phase 2: 情感层保留与收束

- [ ] 把情感层定义为 `EmotionalRuntime`。
- [ ] 情感层输入包含：
  - [ ] 用户原始输入。
  - [ ] 当前对话上下文。
  - [ ] 人设和记忆。
  - [ ] 交互层给出的 work facts / work signals。
- [ ] 情感层输出包含：
  - [ ] 可见 reply。
  - [ ] emotion tag。
  - [ ] intent hints。
  - [ ] 对任务层可见的 emotional turn record。
- [ ] 保留现有 TTS frame 路径。
- [ ] 保留 Fish S2 emotion cue 的 text transform 机制。
- [ ] 保留 sticker / Live2D 这类 expression hook，但输入改为统一 emotional output event。
- [ ] 移除情感层直接等待任务完成的职责。

验收：

- [ ] 普通聊天、TTS、表情表现不明显退化。
- [ ] 情感层可以先回复“我来处理”，但任务是否开始由交互层/任务层决定。
- [ ] 情感层输出会被任务层作为结构化 interaction record 持久化。

## Phase 3: 情感任务交互层

- [x] 新增 `InteractionRuntime`。
- [x] 输入：
  - [x] 用户原始输入。
  - [x] 情感层输入理解。
  - [x] 情感层实际输出。
  - [x] 当前 WorkState。
  - [x] 当前 OutputState。
- [x] 输出结构化 intent：
  - [x] `chat`
  - [x] `speech.stop`
  - [x] `speech.mute`
  - [x] `speech.repeat`
  - [x] `work.start`
  - [x] `work.resume`
  - [x] `work.pause`
  - [x] `work.modify`
  - [x] `work.status`
  - [x] `work.cancel`
  - [x] `work.queue_new`
  - [ ] `work.start_parallel`
- [x] 支持用户语言打断分类：
  - [x] 只停止说话。
  - [x] 插话追问。
  - [x] 补充约束。
  - [x] 修正任务方向。
  - [x] 暂停任务。
  - [x] 取消任务。
  - [x] 开启新任务但保留旧任务现场。
- [x] 定义 `FeedbackPolicy`，控制任务层信息何时给到情感层：
  - [x] 静默 UI 更新。
  - [x] 当前 TTS 结束后说。
  - [ ] 用户停顿后说。
  - [x] 立即打断输出。
  - [x] 只记录不表达。
- [x] 交互层负责判断一个 work signal 是否值得打扰用户。

验收：

- [x] “停一下”只停止语音，不取消任务。
- [ ] “先别做这个，帮我看另一个”会暂停/保存旧任务并启动新任务。
- [ ] “继续刚才那个”会恢复旧 work thread。
- [ ] “刚才那个路径错了”会修改当前任务现场，而不是新开一个无上下文任务。

## Phase 4: WorkState 和 WorkMemory

- [x] 新增持久化 `WorkState`。
- [x] 新增 `WorkThread` 数据模型：
  - [x] `id`
  - [x] `goal`
  - [x] `status`
  - [x] `priority`
  - [x] `createdAt`
  - [x] `updatedAt`
  - [x] `lastFocusedAt`
  - [x] `userIntentHistory`
  - [x] `emotionalTurnHistory`
  - [x] `plan`
  - [x] `executionState`
  - [x] `observations`
  - [x] `artifacts`
  - [x] `decisions`
  - [x] `failures`
  - [x] `nextActions`
  - [x] `resumeSummary`
  - [x] `abandonReason`
- [x] 每次任务状态变化后写入 snapshot。
- [x] 每次任务失败后写入 `WorkFailure`，包含原因、证据、尝试过的路线、下一次应避免什么。
- [x] 每次关键判断后写入 `WorkDecision`，包含事实依据和替代方案。
- [x] 每次产物生成后写入 `WorkArtifact`，包含路径、类型、来源 step、验证状态。
- [ ] 支持 task interruption snapshot：
  - [x] 当前 step。
  - [x] 已完成 steps。
  - [x] 未完成 steps。
  - [ ] 活跃命令/session。
  - [ ] 文件改动。
  - [ ] 最近工具输出。
  - [x] 可恢复 prompt。
- [x] 启动时恢复最近的 active/paused/recoverable work threads。

验收：

- [x] App 重启后能看到未完成 work thread。
- [ ] 被打断任务能从结构化 snapshot 恢复，而不是从聊天摘要重猜。
- [x] 新任务可以检索最近失败，避免重复同一错误路线。

## Phase 5: Codex 能力克隆任务层

目标：任务层核心执行能力对齐 Codex，而不是继续沿用简单 tool loop。

- [x] 新增 Codex-style `WorkSession`，但实现文件和类型不出现 `codex` 字样。
- [x] 新增 `WorkTask`，一个 session 同时最多一个 foreground task，但可有 paused/background threads。
- [x] 新增 `WorkTurn`：
  - [x] 一次模型采样。
  - [x] 执行模型请求的工具。
  - [x] 工具结果进入下一轮。
  - [x] 无 follow-up 时 turn 完成。
- [x] 新增 `ToolRouter`：
  - [x] 统一解析 function tool、freeform tool、MCP tool、browser tool、desktop tool、shell tool。
  - [x] 支持 discoverable/deferred tools。
  - [x] 支持工具能力 metadata。
  - [x] 支持工具是否允许并行。
- [x] 新增 `ToolOrchestrator`：
  - [x] 审批策略。
  - [x] 沙箱策略。
  - [x] 网络策略。
  - [x] 重试策略。
  - [x] 失败归一化。
  - [x] 工具取消响应。
- [ ] 新增 `CommandRuntime`：
  - [ ] PTY。
  - [x] 非 PTY。
  - [x] 长命令 session。
  - [x] stdout/stderr 增量事件。
  - [x] 超时。
  - [x] kill/interrupt。
  - [x] cwd/env 管理。
- [ ] 新增 `PatchRuntime`：
  - [ ] 结构化 apply patch。
  - [ ] patch 失败后可恢复上下文。
  - [ ] changed files tracking。
- [ ] 新增 `ContextManager`：
  - [ ] 记录完整 model-visible history。
  - [ ] 支持工具输出截断。
  - [ ] 支持图片/视觉结果归一化。
  - [ ] 支持 pre-turn compaction。
  - [ ] 支持 mid-turn compaction。
  - [ ] 支持 context reinjection。
- [ ] 新增 `CancellationModel`：
  - [ ] output cancellation。
  - [ ] user interruption。
  - [ ] task pause。
  - [ ] task cancel。
  - [ ] tool abort。
  - [ ] background command still running 的事实记录。
- [ ] 新增 `TurnEventStream`，替代隐式 callback。
- [ ] 增加命名检查，确保新增任务层源码路径和导出类型不包含 `codex`。

验收：

- [ ] 能完成多轮代码修改任务：读文件、编辑、运行测试、修复、再验证。
- [ ] 工具失败后不会简单终止，而是把错误作为下一轮输入继续推理。
- [ ] 上下文过长时能自动压缩并继续任务。
- [ ] 用户插话不会破坏任务执行现场。
- [ ] 长命令可后台运行、轮询、取消，并被 work snapshot 记录。
- [ ] `rg -n "codex|Codex" packages/sdk/src apps/desktop/src plugins` 不命中新任务层新增命名；只允许文档、注释中的参考说明或已有第三方路径。

## Phase 6: Codex 差异适配

Her-Text 不是 CLI，所以不能盲目复制 Codex 的交互语义。

- [ ] 定义 Codex 和 Her-Text 的差异清单：
  - [ ] Codex 新 user turn 通常替换/中断当前任务。
  - [ ] Her-Text 新语音输入默认是交互事件，不默认取消任务。
  - [ ] Codex 主要面向代码仓库。
  - [ ] Her-Text 同时有桌面、浏览器、语音、Live2D、长期陪伴和后台工作。
- [ ] 给每类用户输入定义默认策略：
  - [ ] 文本输入。
  - [ ] 语音输入。
  - [ ] 手动停止 TTS。
  - [ ] App 关闭。
  - [ ] 系统睡眠/恢复。
- [ ] 支持多个 work thread：
  - [ ] foreground thread。
  - [ ] paused thread。
  - [ ] background thread。
  - [ ] abandoned thread。
- [ ] 定义工作焦点规则：当前用户的话默认指向哪个 thread。
- [ ] 定义任务层如何请求情感层帮忙问用户。
- [ ] 定义任务层如何把风险/阻塞/完成交给情感层表达。

验收：

- [ ] 用户可以边聊天边让任务后台继续。
- [ ] 用户可以临时换任务，再回来继续旧任务。
- [ ] 系统不会因为一次语音打断误删任务现场。

## Phase 7: 长程执行层

基于任务层新增 `LongRunRuntime`，参考 `codex-autoresearch`。

- [ ] 新增 `GoalRun` 模型：
  - [ ] `goal`
  - [ ] `scope`
  - [ ] `metric`
  - [ ] `direction`
  - [ ] `verify`
  - [ ] `guard`
  - [ ] `iterations`
  - [ ] `stopCondition`
  - [ ] `rollbackPolicy`
  - [ ] `status`
- [ ] 新增长程执行 artifacts：
  - [ ] `results.tsv` 或 SQLite equivalent。
  - [ ] `state.json` 或 SQLite equivalent。
  - [ ] `lessons`.
  - [ ] `runtime.log`.
- [ ] 实现 baseline：
  - [ ] 启动前必须先测量 baseline。
  - [ ] baseline 成功后才能初始化 run artifacts。
- [ ] 实现 iteration loop：
  - [ ] 选择一个 hypothesis。
  - [ ] 做一个聚焦变更。
  - [ ] 生成 trial commit 或等效 checkpoint。
  - [ ] 运行 verify。
  - [ ] 运行 guard。
  - [ ] keep/discard。
  - [ ] 记录结果。
  - [ ] 继续下一轮。
- [ ] 实现 rollback：
  - [ ] dedicated branch/worktree 可 destructive rollback。
  - [ ] 普通工作区默认非破坏性 revert。
  - [ ] 永不回滚用户无关改动。
- [ ] 实现 stuck escalation：
  - [ ] 3 次连续失败 refine。
  - [ ] 5 次连续失败 pivot。
  - [ ] 多次 pivot 后可 web search 或停为 needs_human。
- [ ] 实现 resume：
  - [ ] App 重启。
  - [ ] context compaction。
  - [ ] 用户回来问状态。
  - [ ] background run 继续。
- [ ] 触发形式暂不固定，但必须支持：
  - [ ] 用户显式要求“持续优化/跑到通过/今晚自己跑”。
  - [ ] 任务层判断某任务适合转成长程 run 后请求用户确认。

验收：

- [ ] 能跑一个真实代码指标优化任务，例如减少 TypeScript errors、修复 failing tests、提升 coverage。
- [ ] 每次 iteration 都有可审计记录。
- [ ] 失败实验不会污染最终工作区。
- [ ] 中断后能从记录继续。

## Phase 8: UI 和输出整合

- [ ] 默认任务面板改为 WorkThread 视角。
- [ ] 显示 active / paused / waiting / recoverable_failed / completed threads。
- [ ] 显示当前 thread 的 plan、current step、last observation、next action。
- [ ] 显示长程 run 的 metric、baseline、best result、iteration count。
- [ ] 支持用户从 UI 手动：
  - [ ] pause。
  - [ ] resume。
  - [ ] abandon。
  - [ ] focus。
  - [ ] view details。
- [ ] OutputRuntime 从 work signals 接收状态，而不是从 task callback 拼状态。
- [ ] 情感层只在 FeedbackPolicy 允许时说任务进度。

验收：

- [ ] 用户不用看日志也能知道任务在做什么。
- [ ] 用户能看到哪些任务被暂停、可恢复或已放弃。
- [ ] 长程任务的进展和验证结果可视化。

## Phase 9: 迁移旧系统

- [ ] 保留旧 `TaskRuntime` 作为 legacy adapter，只用于过渡。
- [ ] 新任务默认走 `WorkRuntime`。
- [ ] 迁移现有工具注册到新 `ToolRouter`。
- [ ] 迁移 browser-use。
- [ ] 迁移 computer-use。
- [ ] 迁移 MCP manager。
- [ ] 迁移 skills manager。
- [ ] 移除 `DialogueOrchestrator` 对 task result 的同步等待依赖。
- [ ] 移除旧 task lifecycle callback 对 Desktop UI 的硬依赖。
- [ ] 更新 README 和架构图。

验收：

- [ ] 普通聊天路径不退化。
- [ ] 旧短任务能通过新任务层完成。
- [ ] 新长任务能在不阻塞情感层的情况下持续执行。

## Phase 10: 测试与真实验收场景

- [ ] 单元测试：
  - [ ] intent routing。
  - [ ] work state persistence。
  - [ ] task interruption semantics。
  - [ ] work thread resume。
  - [ ] tool router。
  - [ ] tool orchestrator。
  - [ ] context compaction。
  - [ ] long-run keep/discard。
- [ ] 集成测试：
  - [ ] 用户停止 TTS，任务继续。
  - [ ] 用户插话补充约束，任务吸收并继续。
  - [ ] 用户切换任务后恢复旧任务。
  - [ ] 任务失败后下一次避免重复失败路径。
  - [ ] App 重启后恢复 paused work thread。
  - [ ] 长程 run 中断后恢复。
- [ ] 真实验收任务：
  - [ ] 修改 Her-Text 一个 SDK bug 并跑 `pnpm --filter @her-text/sdk build`。
  - [ ] 修改 Desktop runtime 并跑 `pnpm --filter @her-text/desktop build`。
  - [ ] 修复一批 TypeScript errors，直到 verify 通过。
  - [ ] 跑一个长程优化目标，至少 3 次 iteration，有 keep 和 discard 记录。

验收：

- [ ] 所有核心路径有自动化测试。
- [ ] 至少一个真实长程任务从开始、打断、恢复到完成全链路通过。
- [ ] 文档、事件流、持久化状态和 UI 表现一致。

## 第一批落地顺序

优先级不是从最酷的功能开始，而是先解决结构性错误。

1. [ ] 写三层 runtime 边界文档。
2. [ ] 扩展 RuntimeEvent 为统一事件协议。
3. [ ] 实现 WorkState / WorkThread 持久化。
4. [ ] 实现 InteractionRuntime 的打断语义分类。
5. [x] 让新用户输入不再默认 abort 任务。
6. [ ] 让旧 TaskRuntime 每次状态变化写入 WorkThread snapshot。
7. [ ] 实现 “继续刚才任务” 的真实恢复。
8. [ ] 再开始替换 Codex-style WorkSession / WorkTurn / ToolRouter。
9. [ ] 最后叠加 LongRunRuntime。

## 完成定义

这个 TODO 完成时，Her-Text 应该具备以下能力：

- [ ] 它能一边自然聊天一边持续工作。
- [ ] 它能被用户语言打断，但不丢任务现场。
- [ ] 它能恢复之前没做完的任务。
- [ ] 它能知道上次失败在哪里，并避免重复同一失败路线。
- [ ] 它能像 Codex 一样读代码、改代码、运行命令、验证、继续修。
- [ ] 它能像 autoresearch 一样围绕指标长期迭代、保留有效结果、丢弃无效结果。
- [ ] 它的情感层、任务层、交互层是解耦的，任何一层都能独立演进。
