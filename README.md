# Her-Text

> 一个有情感和独立人格的桌面端 Agent 伴侣

## 项目结构

```
her-text/
├── packages/              # 共享包
│   ├── types/            # TypeScript 类型定义
│   ├── core/             # 核心功能（LLM 调用等）
│   └── sdk/              # Her-Text SDK（情感、记忆、人格、Agent）
├── apps/                 # 应用
│   └── desktop/          # Tauri 桌面应用
├── package.json          # Monorepo 根配置
├── pnpm-workspace.yaml   # pnpm workspace 配置
└── turbo.json            # Turbo 构建配置
```

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
# 开发所有包
pnpm dev

# 只开发桌面应用
cd apps/desktop
pnpm tauri:dev
```

### 构建

```bash
# 构建所有包
pnpm build

# 构建桌面应用
cd apps/desktop
pnpm tauri:build
```

## 技术栈

### Monorepo 工具
- **pnpm**: 包管理器
- **Turbo**: 构建系统

### SDK (packages/sdk)
- **TypeScript**: 类型安全
- **Anthropic SDK / OpenAI SDK**: LLM 调用
- **向量数据库**: ChromaDB / LanceDB（待集成）

### 桌面应用 (apps/desktop)
- **Tauri**: 桌面框架（Rust + WebView）
- **Vite**: 前端构建工具
- **Framer Motion**: 动画库

## 开发路线

- [x] Monorepo 基础架构
- [x] 类型系统（@her-text/types）
- [x] 核心功能（@her-text/core）
- [x] SDK 骨架（情感、记忆、人格、Agent）
- [x] Tauri 应用初始化
- [ ] 情感系统完善（LLM 情感分析）
- [ ] 记忆系统完善（向量数据库集成）
- [ ] 小球 UI 实现
- [ ] 语音交互（VAD + ASR + TTS）
- [ ] 主动性机制

详见 [her-text设计.md](./her-text设计.md)

## License

MIT
