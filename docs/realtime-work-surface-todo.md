# Realtime Work Surface To Do

这份清单用于把 Realtime Work Surface 从设计推进到可落地实现。原则是默认关闭、旁路接入、先验证体验，再逐步下沉到 SDK，不破坏现有 Her-Text 内核。

## Phase 0：设计冻结和范围确认

- [x] 确认实验功能名称：`Realtime Work Surface`、`Work Surface` 或中文名。
- [x] 确认默认关闭策略：新安装、升级、开发模式下都默认关闭。
- [x] 确认进入条件：
  - [x] 用户显式说“打开工作页面/用工作台模式”。
  - [x] 设置开启后复杂任务自动进入。
  - [x] 只对 task intent 生效，不接管普通聊天。
- [x] 确认退出条件：
  - [x] 用户关闭工作页面。
  - [x] 任务完成后保留只读结果页。
  - [x] 任务取消后进入 cancelled 状态。
- [x] 确认第一版只实现内置组件，不支持模型生成 HTML。
- [x] 确认第一版不做插件自定义组件市场。
- [x] 确认第一版不修改 `TaskRuntime` 主循环。

## Phase 1：类型和协议定义

- [x] 定义 `WorkSurfaceFrame` 类型。
- [x] 定义 `SurfaceCreateFrame`。
- [x] 定义 `SurfacePatchFrame`。
- [x] 定义 `SurfaceFocusFrame`。
- [x] 定义 `SurfaceMessageFrame`。
- [x] 定义 `SurfaceRequestInputFrame`。
- [x] 定义 `SurfaceCloseFrame`。
- [x] 定义 `UIPatch` 操作：
  - [x] `add`
  - [x] `replace`
  - [x] `update`
  - [x] `remove`
  - [x] `bind`
- [x] 定义 `RuntimeBinding`：
  - [x] `task`
  - [x] `task_step`
  - [x] `tool_result`
  - [x] `file`
  - [x] `memory`
  - [x] `custom`
- [x] 定义 `SurfaceUserEvent`：
  - [x] `surface.select`
  - [x] `surface.action`
  - [x] `surface.voice`
  - [x] `surface.input_submitted`
- [x] 定义组件 schema：
  - [x] `MarkdownBlock`
  - [x] `TaskPlanView`
  - [x] `DataTable`
  - [x] `ChartView`
  - [x] `ArtifactGrid`
  - [x] `FormPanel`
  - [x] `ActionBar`
  - [x] `TimelineView`
  - [x] `InspectorPanel`
  - [x] `StatusStrip`
- [x] 定义 frame 校验规则。
- [x] 定义 schema 版本字段，例如 `schemaVersion: 1`。
- [x] 明确未知 frame、未知 component、未知 patch 的降级行为。

## Phase 2：设置和功能开关

- [x] 在 settings 类型中增加实验开关：
  - [x] `experimental.workSurfaceEnabled`
- [x] 在 settings store 增加默认值 `false`。
- [x] 在设置 UI 中增加开关。
- [x] 开关文案明确说明这是实验能力。
- [x] 关闭开关时不注册 UI tools。
- [x] 关闭开关时 renderer 不显示 WorkSurfaceView。
- [x] 关闭开关时不向 task model 注入 UI 协议提示。
- [x] 切换开关后确认是否需要重启 SDK 或刷新插件。
- [x] 增加日志，标记 work surface 是否启用。

## Phase 3：Desktop 旁路控制器

- [x] 新增 `WorkSurfaceController`。
- [x] 控制器维护 surface state。
- [x] 控制器接收 `WorkSurfaceFrame`。
- [x] 控制器校验 frame。
- [x] 控制器应用 patch。
- [x] 控制器维护 component id 索引。
- [x] 控制器维护 runtime binding 索引。
- [x] 控制器节流高频 patch。
- [x] 控制器向 renderer 发送 surface snapshot。
- [x] 控制器向 renderer 发送增量 frame。
- [x] 控制器处理 renderer 回传的 `SurfaceUserEvent`。
- [x] 控制器失败时只记录错误，不中断任务 runtime。
- [x] 控制器提供 reset/close API。
- [x] 控制器支持按 taskId 查询 active surface。

## Phase 4：IPC 通道

- [x] Main -> Renderer：
  - [x] `workSurface:created`
  - [x] `workSurface:frame`
  - [x] `workSurface:snapshot`
  - [x] `workSurface:closed`
  - [x] `workSurface:error`
- [x] Renderer -> Main：
  - [x] `workSurface:event`
  - [x] `workSurface:ready`
  - [x] `workSurface:requestSnapshot`
- [x] 在 preload 暴露受控 API。
- [x] API 不暴露任意 DOM 或任意 eval 能力。
- [x] 增加事件 payload 基本校验。
- [x] 确认 IPC 命名与现有 `conversation:*`、`plugins:*` 风格一致。

## Phase 5：Renderer WorkSurfaceView

- [x] 新增 `work-surface` renderer 模块。
- [x] 新增 WorkSurfaceView 容器。
- [x] 实现 surface 创建和销毁。
- [x] 实现 layout 渲染。
- [x] 实现 component registry。
- [x] 实现 patch 应用。
- [x] 实现 selected state。
- [x] 实现 focus state。
- [x] 实现 loading state。
- [x] 实现 empty state。
- [x] 实现 error state。
- [x] 实现任务完成后的只读状态。
- [x] 接入现有 task panel 显示区域。
- [x] 开关关闭时保持当前 UI 不变。
- [x] 支持窄窗口布局。
- [x] 支持高 DPI 和窗口缩放。

## Phase 6：内置组件实现

- [x] `StatusStrip`
  - [x] 显示任务状态。
  - [x] 显示当前 step。
  - [x] 显示等待用户/失败/完成状态。
- [x] `TaskPlanView`
  - [x] 渲染 plan title。
  - [x] 渲染 step 列表。
  - [x] 展示 step 状态。
  - [x] 支持当前 step 高亮。
  - [x] 支持 step 错误信息。
- [x] `MarkdownBlock`
  - [x] 支持安全 markdown 渲染。
  - [x] 禁止 raw HTML。
  - [x] 支持代码块。
- [x] `DataTable`
  - [x] 渲染列。
  - [x] 渲染行。
  - [x] 支持单选/多选。
  - [x] 支持排序。
  - [x] 支持简单过滤。
  - [x] 支持行级 action。
  - [x] 大数据分页或截断。
- [x] `ArtifactGrid`
  - [x] 文件卡片。
  - [x] 图片预览。
  - [x] 网页截图预览。
  - [x] 打开文件 action。
- [x] `FormPanel`
  - [x] 文本输入。
  - [x] textarea。
  - [x] select。
  - [x] checkbox。
  - [x] password/secret。
  - [x] submit/cancel。
- [x] `ActionBar`
  - [x] 主操作。
  - [x] 次级操作。
  - [x] danger 操作。
  - [x] disabled/loading 状态。
- [x] `ChartView`
  - [x] bar。
  - [x] line。
  - [x] pie。
  - [x] scatter。
  - [x] 空数据状态。
- [x] `TimelineView`
  - [x] 任务事件列表。
  - [x] 工具调用摘要。
  - [x] 错误/重试标记。
- [x] `InspectorPanel`
  - [x] 展示当前选中对象属性。
  - [x] 展示绑定来源。
  - [x] 展示可用操作。

## Phase 7：视觉风格

- [x] 定义 work surface CSS tokens。
- [x] 和现有控制面板颜色变量对齐。
- [x] 实现深色玻璃质感面板。
- [x] 实现细线边框和低强度微光。
- [x] 实现状态条动效。
- [x] 实现选中态。
- [x] 实现 focus ring。
- [x] 实现 loading skeleton。
- [x] 控制强调色数量不超过 2 个。
- [x] 避免大面积彩色渐变。
- [x] 避免营销页式大卡片。
- [x] 避免 UI 元素互相遮挡。
- [x] 检查小窗口下文本不溢出。
- [x] 检查英文、中文混排。

## Phase 8：Task Event 自动映射

- [x] 任务开始时创建默认 surface。
- [x] `task.started` 映射到 StatusStrip。
- [x] `task.plan.created` 映射到 TaskPlanView。
- [x] `task.plan.updated` 更新 TaskPlanView。
- [x] `task.step.started` 高亮当前 step。
- [x] `task.step.completed` 标记 step 完成。
- [x] `task.step.failed` 标记 step 失败。
- [x] `task.waiting_user` 显示 FormPanel 或 request input。
- [x] `task.completed` 显示最终状态。
- [x] `task.failed` 显示错误状态。
- [x] 高频 step 更新合并。
- [x] 事件缺字段时降级显示。

## Phase 9：Work Surface Plugin

- [x] 新增 `plugins/work-surface/plugin.json`。
- [x] 插件默认启用条件受 settings 控制。
- [x] 插件注册 UI tools。
- [x] 插件扩展 task prompt，说明 UI 工具使用方式。
- [x] 插件提供 tool strategy hint。
- [x] 插件不直接修改 task runtime。
- [x] 插件 shutdown 时清理 pending state。
- [x] 插件 `.mjs` 运行 `node --check`。

## Phase 10：Agent UI Tools

- [x] `ui_create_surface`
  - [x] 创建 surface。
  - [x] 设置 title/mode/layout。
  - [x] 返回 surfaceId。
- [x] `ui_show_markdown`
  - [x] 添加或更新 markdown block。
  - [x] 支持 targetId。
- [x] `ui_show_table`
  - [x] 添加或更新 DataTable。
  - [x] 支持 columns/rows。
  - [x] 支持 row bindings。
- [x] `ui_show_artifacts`
  - [x] 展示文件和图片 artifact。
  - [x] 只传引用，不内联大文件。
- [x] `ui_request_action`
  - [x] 展示操作按钮。
  - [x] 支持 payload schema。
- [x] `ui_request_input`
  - [x] 展示 FormPanel。
  - [x] 对接 `TaskUserInputRequest`。
- [x] `ui_update_component`
  - [x] 更新已有组件 props。
  - [x] 校验 targetId。
- [x] `ui_focus`
  - [x] 聚焦某个组件或对象。
- [x] 每个工具返回结构化执行结果。
- [x] 工具失败时给出可恢复错误。

## Phase 11：Tool Result 自动渲染

- [x] 定义 `resultToComponent()`。
- [x] 文件列表结果转 DataTable 或 ArtifactGrid。
- [x] 搜索结果转 DataTable。
- [x] 图片路径转 ArtifactGrid。
- [x] JSON 数组转 DataTable。
- [x] 数值序列转 ChartView。
- [x] markdown/text 转 MarkdownBlock。
- [x] 未识别结果转折叠 JSON block。
- [x] 大对象截断并提供展开 action。
- [x] 转换器不能改变原始 tool result。

## Phase 12：Click & Speak

- [x] Renderer 支持点击选择组件。
- [x] Renderer 支持表格行选择。
- [x] Renderer 支持 artifact 选择。
- [x] Renderer 维护 selected bindings。
- [x] 语音输入时附带 selected bindings。
- [x] 文本输入时附带 selected bindings。
- [x] Main 将 `surface.voice` 转为 task continuation context。
- [x] Prompt 中明确告诉 agent 用户当前选择的对象。
- [x] 无选择时保持现有语音输入行为。
- [x] 多选时提供清晰上下文摘要。

## Phase 13：Action 和 Form 回流

- [x] Action 点击回传 `surface.action`。
- [x] Form 提交回传 `surface.input_submitted`。
- [x] Main 校验 actionId 是否来自当前 surface。
- [x] Main 校验 payload 是否符合 schema。
- [x] Action 可触发：
  - [x] 继续任务。
  - [x] 修改任务。
  - [x] 取消任务。
  - [x] 打开文件。
  - [x] 重新运行某一步。
- [x] 高风险 action 需要确认。
- [x] Secret input 不写入普通日志。

## Phase 14：任务继续执行机制

- [x] 定义 surface event 如何进入现有 task runtime。
- [x] 第一版可以作为新的 user input 进入 DialogueOrchestrator。
- [x] 后续支持 task continuation，而不是启动全新任务。
- [x] 明确 active task 不存在时的行为。
- [x] 明确任务已完成时 action 的行为。
- [x] 明确任务失败后是否允许 retry。
- [x] 避免和 `RuntimeJobManager` concurrency 规则冲突。

## Phase 15：持久化和恢复

- [x] 定义 `WorkSurfaceSnapshot`。
- [x] 第一版只内存保存。
- [x] 第二版关联 taskId 保存 snapshot。
- [x] 保存 layout。
- [x] 保存 components。
- [x] 保存 bindings。
- [x] 保存 selectedIds。
- [x] 不保存 secret input。
- [x] 不保存 renderer 私有 DOM 状态。
- [x] 任务恢复时恢复只读 surface。
- [x] 历史任务可以打开 surface snapshot。

## Phase 16：错误处理

- [x] Frame schema 校验失败时记录 warning。
- [x] 单个 component 渲染失败时显示组件错误卡。
- [x] Renderer 崩溃不影响 task runtime。
- [x] Plugin tool 失败不影响非 UI 工具。
- [x] Surface close 不取消任务，除非用户明确取消。
- [x] Task cancel 时关闭或冻结 surface。
- [x] IPC payload 异常时丢弃并记录。
- [x] Markdown sanitize 失败时显示纯文本。

## Phase 17：测试和验证

- [ ] TypeScript 构建：
  - [ ] `pnpm --filter @her-text/sdk build`
  - [ ] `pnpm --filter @her-text/desktop build`
- [x] 插件语法检查：
  - [x] `node --check plugins/work-surface/index.mjs`
- [ ] 手动测试关闭开关。
- [ ] 手动测试开启开关但普通聊天不受影响。
- [ ] 手动测试任务自动创建 surface。
- [ ] 手动测试 plan/step 实时更新。
- [ ] 手动测试 UI tools 添加 markdown/table/action。
- [ ] 手动测试点击选择后语音携带绑定。
- [ ] 手动测试 action 回流。
- [ ] 手动测试 renderer 错误不影响任务。
- [ ] 手动测试窗口缩放。
- [ ] 手动测试暗色视觉一致性。

## Phase 18：文档

- [x] 更新 `docs/realtime-work-surface-design.md`。
- [x] 增加用户侧说明：如何开启实验功能。
- [x] 增加开发者说明：如何新增内置组件。
- [x] 增加 UI tool 使用规范。
- [x] 增加安全边界说明。
- [x] 增加已知限制。
- [x] 增加示例任务：
  - [x] 网页调研结果工作页。
  - [x] 文件整理工作页。
  - [x] 数据分析工作页。
  - [x] 多候选方案选择工作页。

## Phase 19：第一版验收

- [ ] 关闭开关时，现有功能无行为变化。
- [ ] 开启开关后，复杂任务能打开工作页面。
- [ ] 工作页面展示计划、状态、结果和可操作按钮。
- [ ] Agent 可以通过 UI tools 推送至少三类组件。
- [ ] 用户可以点选对象并继续用语音表达意图。
- [ ] UI 风格和现有控制面板一致，有未来科技感但不过度彩色。
- [ ] 任意 UI frame 错误不会导致任务失败。
- [ ] 构建通过。
- [ ] 插件语法检查通过。

## Phase 20：后续增强

- [ ] 支持多个 surface。
- [ ] 支持 surface tabs。
- [ ] 支持拖拽布局。
- [ ] 支持更强 chart spec。
- [ ] 支持 artifact diff。
- [ ] 支持任务 replay。
- [ ] 支持插件贡献受控组件。
- [ ] 支持 work surface memory summary。
- [ ] 支持跨任务搜索 work surface 历史。
- [ ] 支持导出工作页为报告。
