# Realtime Work Surface 设计

Realtime Work Surface 是一个实验性分支能力：开启后，Her-Text 可以把任务输出实时转成可读、可操作、可继续推进的工作页面。它不是让模型直接生成 HTML，而是让 agent 通过受控 UI 协议创建和更新界面，由 Desktop 使用统一组件系统渲染。

这个能力必须默认关闭，并且不改变现有对话、语音、任务 runtime、插件工具的主流程。开启后只在明确进入 work surface 模式的任务中接管展示和交互。

## 目标

- 用户可以在界面中点选对象，再用语音或文字表达意图。
- Agent 输出不只是一段文本，而是实时变成表格、图表、表单、操作按钮、任务状态、文件卡片等工作界面。
- 工作页面可以继续承接用户交互，并把交互作为下一轮任务上下文。
- UI 风格保持 Her-Text 控制面板体系：克制、统一、低彩度、未来科技感、信息密度高。
- 所有 UI 能力有明确协议、状态和权限边界，不能让模型直接控制主 renderer DOM。

## 非目标

- 不让模型自由生成任意 HTML、CSS、JavaScript。
- 不引入第二套前端框架或独立应用壳。
- 不替换现有 task runtime、plugin runtime、memory、voice pipeline。
- 不让 UI 层成为事实来源；任务事实仍来自 runtime、tools、memory 和 execution state。
- 不在第一阶段实现插件任意自定义组件市场。

## 核心原则

### UI 是 runtime 状态，不是聊天装饰

Work surface 中的组件必须能追溯到 runtime 数据：

- 任务计划。
- 当前 step。
- 工具结果。
- 文件路径。
- 表格数据。
- 用户选择。
- 待确认操作。
- 错误和阻塞原因。

界面不是一张模型生成的截图，而是当前任务状态的可交互投影。

### Agent 编排 UI，Desktop 渲染 UI

Agent 只输出结构化 UI 指令：

- 创建 surface。
- 添加组件。
- 更新组件状态。
- 聚焦某个对象。
- 请求用户选择或确认。
- 绑定工具结果和 UI 对象。

Desktop 负责：

- 布局。
- 主题。
- 动效。
- 组件行为。
- 数据校验。
- 事件回传。
- 安全过滤。
- 状态持久化。

### 默认隔离，显式开启

新增设置：

```ts
experimental: {
  workSurfaceEnabled: boolean
}
```

关闭时：

- 不注册 work surface 工具。
- 不改变 task panel。
- 不向模型暴露 UI schema。
- 不影响现有对话和任务流程。

开启时：

- 仅对进入 work surface 模式的任务启用。
- 普通聊天仍走当前 display/TTS 路径。
- 任务 runtime 仍是执行主干，work surface 只是额外输出和交互通道。

## 总体架构

```text
User click / select / voice / text
        │
        ▼
Surface Event Normalizer
        │
        ▼
DialogueOrchestrator / TaskRuntime
        │
        ├── existing text / TTS / task events
        │
        ▼
WorkSurfaceController
        │
        ├── surface state
        ├── UI tool calls
        ├── runtime bindings
        └── validation
        │
        ▼
Renderer WorkSurfaceView
        │
        ├── built-in components
        ├── theme and layout
        └── user interaction events
```

新增模块建议：

```text
packages/sdk/src/work-surface/
  index.ts
  types.ts
  controller.ts
  bindings.ts
  result-renderers.ts

apps/desktop/src/renderer/work-surface/
  work-surface-view.ts
  components.ts
  theme.ts
```

第一阶段也可以先放在 Desktop 侧和一个 runtime plugin 中，等协议稳定后再下沉到 SDK。不要一开始把它做成 SDK 主干依赖。

## UI 协议

Work surface 使用结构化 frame 流。

```ts
type WorkSurfaceFrame =
  | SurfaceCreateFrame
  | SurfacePatchFrame
  | SurfaceFocusFrame
  | SurfaceMessageFrame
  | SurfaceRequestInputFrame
  | SurfaceCloseFrame

interface SurfaceCreateFrame {
  type: 'surface.create'
  surfaceId: string
  taskId?: string
  title: string
  mode: 'task' | 'analysis' | 'browser' | 'document' | 'custom'
  layout: LayoutNode
}

interface SurfacePatchFrame {
  type: 'surface.patch'
  surfaceId: string
  patches: UIPatch[]
}

interface SurfaceFocusFrame {
  type: 'surface.focus'
  surfaceId: string
  targetId: string
  reason?: string
}

interface SurfaceRequestInputFrame {
  type: 'surface.request_input'
  surfaceId: string
  requestId: string
  targetId?: string
  prompt: string
  input: SurfaceInputSpec
}
```

Patch 必须是受控操作：

```ts
type UIPatch =
  | { op: 'add'; parentId: string; component: ComponentNode }
  | { op: 'replace'; targetId: string; component: ComponentNode }
  | { op: 'update'; targetId: string; props: Record<string, unknown> }
  | { op: 'remove'; targetId: string }
  | { op: 'bind'; targetId: string; binding: RuntimeBinding }
```

不允许 patch 写入任意 DOM selector。所有 target 都必须是 component id。

## 组件系统

第一阶段只支持内置组件，不支持模型自定义组件代码。

```ts
type ComponentNode =
  | MarkdownBlock
  | TaskPlanView
  | DataTable
  | ChartView
  | ArtifactGrid
  | FormPanel
  | ActionBar
  | TimelineView
  | InspectorPanel
  | StatusStrip
```

### `TaskPlanView`

绑定 `TaskPlan`，展示计划、当前 step、完成/失败/阻塞状态。

自动来源：

- `task.plan.created`
- `task.step.started`
- `task.step.completed`
- `task.step.failed`
- `task.completed`

### `DataTable`

用于工具结果、搜索结果、文件列表、数据分析结果。

能力：

- 行选择。
- 排序。
- 简单过滤。
- 列类型：text、number、date、status、file、link。
- 行级 action。

用户点选行后，回传稳定对象 id，而不是行号。

### `ChartView`

用于可视化结构化数据。

第一阶段支持：

- line。
- bar。
- pie。
- scatter。

Chart 使用安全 chart spec，不接受任意脚本。

### `ArtifactGrid`

展示文件、图片、网页截图、导出的报告等 artifact。

每个 artifact 绑定来源：

- local path。
- tool call id。
- MIME type。
- createdAt。

### `FormPanel`

用于继续推进任务所需的用户输入。

## 当前实现入口

用户侧开启方式：

1. 打开设置面板。
2. 进入实验功能区域。
3. 开启 `Realtime Work Surface`。
4. 设置保存后 Desktop 会重建 SDK，使 `work-surface` runtime plugin 的 UI tools 和 prompt extension 与开关状态一致。

关闭开关时，Desktop 会清空当前 work surface controller，并向 renderer 发送关闭事件。普通聊天、语音输入、语音输出、任务 runtime 和非 UI 插件工具不依赖该开关。

## 开发者扩展内置组件

第一版组件由 `apps/desktop/src/renderer/work-surface.ts` 统一渲染。新增内置组件时按以下顺序修改：

1. 在 `packages/sdk/src/work-surface/types.ts` 增加受控 schema。
2. 在 `packages/sdk/src/work-surface/controller.ts` 保持 schema 校验和 patch 行为，不添加 DOM 概念。
3. 在 `apps/desktop/src/renderer/work-surface.ts` 增加 renderer 分支。
4. 在 `apps/desktop/src/renderer/styles.css` 增加与控制面板一致的样式。
5. 如需 agent 主动创建该组件，在 `plugins/work-surface/index.mjs` 增加 UI tool 或扩展现有 tool 参数。

组件必须只接收结构化数据。不要让模型传入 HTML、CSS、JavaScript、DOM selector 或任意 renderer callback。

## UI Tool 使用规范

Agent 使用 UI tools 时遵守这些规则：

- 先用 `ui_create_surface` 创建或复用 surface。
- 叙事摘要用 `ui_show_markdown`。
- 结构化列表、搜索结果、对比项和文件清单用 `ui_show_table`。
- 本地文件、图片、网页截图和报告用 `ui_show_artifacts`，只传路径和引用，不内联大文件。
- 需要用户推进任务时用 `ui_request_action` 或 `ui_request_input`。
- 组件局部状态变化用 `ui_update_component`，不要重建整个页面。
- 需要引导用户注意某个对象时用 `ui_focus`。
- 不能把 UI tool 的成功当成任务事实完成；任务事实仍以 runtime、tool result 和 task state 为准。

## 安全边界

- Renderer 不执行模型生成的 HTML、CSS 或 JavaScript。
- IPC 只暴露受控的 work surface API，不暴露任意 DOM 或 eval 能力。
- Main 校验 renderer event 的基础结构，并且 action 必须来自当前 snapshot。
- 高风险 action 和 danger action 需要用户确认。
- `open_file` 只通过系统 shell 打开本地路径，不把文件内容注入 prompt。
- Secret input 不写入普通日志，snapshot 持久化也不保存 renderer 私有 DOM 状态。
- Frame 或 component 渲染失败只显示错误卡，不中断任务 runtime。

## 已知限制

- 第一版仍是实验能力，默认关闭。
- Renderer 当前使用内置组件 registry，不支持第三方插件传入自定义前端代码。
- Chart renderer 是轻量 DOM 可视化，不替代完整图表库。
- Snapshot 持久化保留最近一批 surface，作为只读恢复和历史查看基础。
- Action 回流第一版通过现有对话/任务输入继续推进，不直接插入 TaskRuntime 内部执行栈。
- Work surface 不改变并发控制规则；没有 active task 时 action 会作为新的用户输入处理。

## 示例任务

网页调研结果工作页：

- `StatusStrip` 展示调研进度。
- `DataTable` 展示来源、标题、可信度和摘要。
- `ArtifactGrid` 展示截图或导出的报告。
- `ActionBar` 提供“继续深挖”“打开来源”“生成报告”。

文件整理工作页：

- `DataTable` 展示文件路径、类型、大小、建议动作。
- 行级 action 支持打开文件、标记保留、加入整理队列。
- `InspectorPanel` 展示当前选中文件的绑定和属性。

数据分析工作页：

- `MarkdownBlock` 展示结论和代码块。
- `DataTable` 展示原始或聚合数据。
- `ChartView` 展示 bar、line、pie 或 scatter 结果。
- `FormPanel` 请求用户选择下一步分析维度。

多候选方案选择工作页：

- `DataTable` 展示候选方案、风险、成本、收益。
- `ActionBar` 提供选择方案、修改约束、继续比较。
- Click & Speak 会把用户点选的候选方案绑定到下一轮语音或文字输入。

## 后续增强路线

- 多 surface 和 tabs：controller 已支持多 snapshot，renderer 可在此基础上扩展多 surface 切换。
- 拖拽布局：在受控 layout tree 上增加局部重排事件，仍不暴露 DOM selector。
- 更强 chart spec：补充轴、legend、series style 和 tooltip 字段。
- Artifact diff：给 artifact 增加 before/after 引用和 diff summary。
- Task replay：用 task snapshot、work surface snapshot 和 runtime event history 复盘任务。
- 插件贡献受控组件：插件只贡献 schema 和 renderer 注册声明，不提供任意脚本。
- Work surface memory summary：把关键选择、结果和 artifact 摘要写入 memory。
- 跨任务搜索历史：基于持久化 snapshot metadata 做检索。
- 导出报告：把当前 surface 转成 markdown/html/pdf 报告。

适合：

- 选择参数。
- 确认选项。
- 填验证码。
- 提交账号输入。
- 高风险操作确认。

敏感输入仍沿用现有 `TaskUserInputRequest` 语义，不在 renderer 私自持久化。

### `ActionBar`

展示可执行动作：

- 继续。
- 重新分析。
- 应用修改。
- 打开文件。
- 取消任务。
- 让我选择。

Action 不直接执行任意代码，只产生 `surface.action` 事件。

## Runtime Binding

Binding 把 UI 对象和 runtime 事实连接起来。

```ts
type RuntimeBinding =
  | { kind: 'task'; taskId: string }
  | { kind: 'task_step'; taskId: string; stepId: string }
  | { kind: 'tool_result'; taskId: string; toolCallId: string; path?: string }
  | { kind: 'file'; path: string; mimeType?: string }
  | { kind: 'memory'; memoryId: string }
  | { kind: 'custom'; source: string; id: string }
```

这解决两个问题：

- 用户点选对象时，agent 能知道对象背后的事实来源。
- 页面刷新或任务恢复时，可以从 runtime snapshot 重建 UI。

## 用户交互回流

Renderer 把用户行为转成结构化事件：

```ts
type SurfaceUserEvent =
  | {
      type: 'surface.select'
      surfaceId: string
      targetId: string
      selectedIds: string[]
      bindings: RuntimeBinding[]
    }
  | {
      type: 'surface.action'
      surfaceId: string
      actionId: string
      targetId?: string
      payload?: unknown
      bindings?: RuntimeBinding[]
    }
  | {
      type: 'surface.voice'
      surfaceId: string
      transcript: string
      selectedIds: string[]
      bindings: RuntimeBinding[]
    }
  | {
      type: 'surface.input_submitted'
      surfaceId: string
      requestId: string
      value: unknown
    }
```

Click & Speak 的关键是 `surface.voice`：

```json
{
  "type": "surface.voice",
  "surfaceId": "task-123",
  "transcript": "帮我深入分析这一项",
  "selectedIds": ["row-customer-42"],
  "bindings": [
    {
      "kind": "tool_result",
      "taskId": "task-123",
      "toolCallId": "tool-9"
    }
  ]
}
```

Dialogue/task 层拿到的不是孤立语音，而是“语音 + 当前 UI 选择 + runtime binding”。

## Agent UI Tools

Work surface 模式开启后，向 task model 暴露一组 UI 工具。

第一阶段：

- `ui_create_surface`
- `ui_show_markdown`
- `ui_show_table`
- `ui_show_artifacts`
- `ui_request_action`
- `ui_update_component`
- `ui_focus`

工具执行不改变任务事实，只向 `WorkSurfaceController` 提交 UI frame。

工具描述必须强调：

- 使用 UI 工具展示中间结果和可操作状态。
- 不要生成 HTML。
- 不要使用颜色表达事实。
- 不要把未验证结论当成结果。
- 需要用户选择时使用 form/action，而不是在文本里要求用户猜。

## 与现有流程的关系

### Dialogue

普通聊天不进入 work surface。

进入条件可以是：

- 用户显式说“打开工作页面/用工作台模式”。
- 设置开启后，任务 intent 满足复杂度阈值。
- 任务需要表格、文件、网页、图表、多个候选项。

### Task Runtime

TaskRuntime 不依赖 UI。

Work surface 只通过以下方式接入：

- 插件注册 UI tools。
- 订阅 task plan/step/runtime event。
- 把 tool result 转成可选 UI frame。
- 用户 action 作为 task continuation 输入。

### Task Panel

开启 work surface 后，默认 task panel 可以切换为 WorkSurfaceView。

关闭时，沿用当前 task panel。

### Voice / TTS

Work surface 模式下，语音更少、更短：

- UI 高频更新。
- 语音只播关键状态、阻塞、等待用户、最终总结。
- 用户指着 UI 说话时，语音 transcript 必须带上 selected bindings。

## 视觉风格

目标风格：沿用现有控制面板的克制基调，但增强未来科技感和沉浸感。

设计要求：

- 深色玻璃质感为主，避免五颜六色。
- 使用细线、微光、层级阴影、半透明面板、扫描式状态条。
- 主色保持低饱和，强调色最多 1 到 2 个。
- 信息密度高，偏工作台，不做营销页式大卡片。
- 组件边角克制，保持现有控制面板的理性风格。
- 动效用于表达状态变化，不做无意义装饰。
- 重要状态用文本、图标、结构表达，颜色只是辅助。

建议 token：

```css
--ws-bg: rgba(8, 12, 18, 0.86);
--ws-panel: rgba(18, 24, 32, 0.72);
--ws-panel-strong: rgba(24, 32, 42, 0.86);
--ws-border: rgba(170, 220, 255, 0.18);
--ws-border-strong: rgba(170, 220, 255, 0.34);
--ws-text: rgba(238, 246, 255, 0.94);
--ws-muted: rgba(180, 196, 214, 0.66);
--ws-accent: rgb(112, 211, 255);
--ws-accent-2: rgb(160, 132, 255);
--ws-danger: rgb(255, 112, 132);
--ws-success: rgb(98, 220, 170);
```

不要做：

- 彩虹渐变。
- 大面积紫蓝渐变。
- 每张卡片一个颜色。
- 营销式 hero。
- 纯装饰发光球。
- 模型自己决定颜色体系。

## 安全和稳定性

### 安全

- 不执行模型生成的 JavaScript。
- 不允许模型注入 raw HTML。
- Markdown 需要 sanitize。
- 文件链接必须经过现有文件权限和路径策略。
- Action 必须映射为已注册 runtime action。
- 高风险操作必须走确认组件。

### 稳定性

- UI frame 校验失败时，只丢弃该 frame，不中断任务。
- Work surface 崩溃时，任务 runtime 继续执行。
- 关闭实验开关后，不读取或恢复 work surface 状态。
- 保存 surface snapshot 时只保存 schema 和 bindings，不保存 renderer 私有状态。

### 性能

- 高频 step/tool event 应该合并。
- 表格大数据只传预览和分页数据。
- 图片和文件 artifact 只传引用，不内联大内容。
- Renderer patch 必须节流。

## 持久化

第一阶段可只内存保存。

第二阶段保存：

```ts
interface WorkSurfaceSnapshot {
  surfaceId: string
  taskId?: string
  title: string
  mode: string
  createdAt: number
  updatedAt: number
  layout: LayoutNode
  components: Record<string, ComponentNode>
  bindings: Record<string, RuntimeBinding[]>
  selectedIds: string[]
}
```

可以存到现有任务数据库旁边，或作为 task run 的附属 JSON。不要新建复杂数据库层，除非需要跨任务搜索。

## 分阶段实施

### Phase 0：设计和开关

- 增加设计文档。
- 增加设置项设计，不接 runtime。
- 明确 frame/schema 类型。

### Phase 1：只读工作页面

- Desktop 增加 WorkSurfaceView。
- 从 task plan/step event 自动渲染 `TaskPlanView`。
- 支持 markdown、artifact、status strip。
- 不给模型 UI tools。
- 不改变任务执行。

### Phase 2：Agent UI Tools

- 增加 `work-surface` runtime plugin。
- 注册 `ui_show_markdown`、`ui_show_table`、`ui_request_action`。
- Renderer 接收 frame 并 patch UI。
- Tool result 可以被手动展示成组件。

### Phase 3：Click & Speak

- Renderer 支持选择组件对象。
- 语音输入携带 selected bindings。
- Surface user event 进入 dialogue/task continuation。
- 支持 action/form 提交。

### Phase 4：持久化和恢复

- 保存 surface snapshot。
- 任务恢复时恢复 work surface。
- 支持从历史任务打开工作页面。

### Phase 5：插件化扩展

- 允许插件声明 preferred renderer。
- 允许插件贡献受控组件类型。
- 仍不允许插件 iframe 直接改主 renderer DOM。

## 第一版验收标准

- 关闭开关时，现有聊天、语音、任务、插件行为无变化。
- 开启开关并进入任务后，可以看到实时任务工作页面。
- Task plan 和 step 状态能自动更新。
- Agent 可以通过 UI tools 添加 markdown/table/action。
- 用户点击 action 后，事件能回到 main process。
- UI 风格与现有控制面板一致，低彩度、有科技感，不显得像普通网页。
- Work surface 失败不会导致任务 runtime 失败。

## 推荐实现边界

第一轮实现不要动 `TaskRuntime` 主循环。优先做成 Desktop + plugin 的旁路能力：

- Desktop 设置控制是否启用。
- 插件注册 UI tools。
- 插件或 main 订阅 runtime event。
- Renderer 新增 WorkSurfaceView。
- IPC 新增 surface frame/event 通道。

等协议稳定后，再考虑把 `work-surface` 类型和 controller 下沉到 SDK。这样可以保持项目内核稳定，同时验证这个方向是否真的提升任务体验。
