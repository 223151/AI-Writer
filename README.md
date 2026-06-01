# AI 小说写作软件

一款 Windows 桌面 AI 小说写作工具，基于 Electron + React + TypeScript 构建，DeepSeek API 驱动 AI 辅助长篇小说创作。

当前版本：**v1.4.0**

## 核心功能

- **🎨 风格库**：导入小说 → AI 一次性分析写作风格（含长短段配比）→ 逐字段分段编辑 → 生成时套用
- **🔬 拆文库**：导入爆款小说 → AI 一次性拆解（概述/黄金三章/逐章摘要/聚合分析/文风分析/爽点/硬伤）→ 逐段编辑 → 生成时参考
- **✍️ 写作工作台**：三栏布局（章节目录 + 正文编辑 + 大纲/细纲/校对）
  - 🌊 流式逐章生成：打字机效果，可随时中断
  - 📑 卷纲逐卷生成：每次生成一卷，基于前一卷上下文自然衔接
  - 📝 逐章细纲：基于卷纲和上一章细纲逐章生成
  - 📏 段落配比：风格库分析长短段比例，AI 参考配比生成
  - 🧹 去 AI 味：本地 50+ 禁用词扫描 + AI 改写
- **🃏 设定库**：左侧栏独立模块，导入小说 → AI 提取角色/世界观/规则/关系 → 逐字段编辑 → 大纲生成时自动参考
- **📋 事实簿**：工作台右侧设定面板，5 类事实（角色/设定/规则/关系/事件）+ 硬/软规则 → 生成时自动注入，不可违反
- **🪝 伏笔面板**：三栏看板（未回收/已回收/全部），状态管理、优先级标记、回收率统计、删除功能
- **⏱ 时间线面板**：竖线时间线、6 种事件类型、角色/类型筛选、时间冲突检测、删除功能
- **📝 记录官**：每章生成后自动提取摘要/人物/伏笔，下一章自动引用
- **🔍 智能校对**：AI 逐章检查一致性 → 分章问题卡片 → 一键复制修改提示 → 自动 find-replace 修改
- **⚙ 多模型**：DeepSeek / OpenAI / Claude / 通义千问，设置页面配置
- **📥 导出**：TXT / Word / Markdown

## 更新日志

### v1.4.0

| 功能 | 说明 |
|------|------|
| 📋 设定库 | 左侧栏独立模块，导入小说 → AI 提取角色/世界观/规则/关系 → 手动编辑 → 大纲生成时自动参考 |
| 📖 事实簿 | 替代角色/世界卡片，5 类事实（角色/设定/规则/关系/事件）+ 硬/软规则，生成时自动注入不可违反 |
| 🪝 伏笔面板 | 三栏看板式管理（未回收/已回收/全部），状态切换、优先级色标、回收率统计、删除功能 |
| ⏱ 时间线面板 | 竖线时间线视图，6 种事件类型，角色/类型筛选，时间冲突自动检测，删除功能 |
| 📐 大纲优化 | 7 部分结构化输出（分卷规划/字数规划/情绪弧线/伏笔地图/人物弧线/主题线/分章框架） |
| 📑 卷纲优化 | 17 字段综合卷纲（节奏设计/伏笔操作/人物里程碑/冲突节点/承上启下），上下文增强（事实簿+伏笔状态+前卷实际结果） |
| 🔧 伏笔/时间线删除 | 两个面板均支持删除单条记录 |
| 🔧 GBK 编码修复 | TXT 文件自动检测 GBK 编码，解决导入乱码和 400 错误 |
| 🔧 PDF→MD | 拆文库和风格库导入格式从 PDF 改为 Markdown |

### v1.2.0

| 功能 | 说明 |
|------|------|
| 🤖 卡片自动生成 | 从大纲+拆文库一键生成角色和世界设定 |
| 📖 卡片从章节提取 | 从选定章节正文提取角色和设定 |
| 🤖 AI 补全卡片 | 新建角色/设定时输入名称，AI 读取大纲自动填写 |
| ⏹ 中断生成 | 大纲/卷纲/细纲/正文/校对/卡片 全部支持取消 |
| 🗑 删除 Token 监控 | 移除不准确的 Token 统计 UI |
| 🔧 大量修复 | JSON 解析、表单不填充、白屏、递归 bug 等 |

### v1.1.0

| 功能 | 说明 |
|------|------|
| 🌊 流式输出 | 正文生成逐字打字机效果 |
| 🤖 多模型 | DeepSeek / OpenAI / Claude / 通义千问 |
| 🃏 角色世界卡片 | 结构化角色/世界设定，自动注入生成上下文 |
| 📝 记录官 | 每章自动摘要/人物/伏笔提取 |
| 🔍 校对增强 | 逐章问题卡片 + 复制修改提示 + 自动修改 |
| 📏 段落配比 | 风格库分析长短段比例 |
| 📋 MD 导出 | 新增 Markdown 导出 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 状态管理 | Zustand |
| 数据库 | SQLite (sql.js) |
| AI API | DeepSeek (兼容 OpenAI SDK) / 多模型 |
| 文档处理 | mammoth.js / pdf-parse / docx |
| 构建 | Vite + esbuild + electron-builder |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

如果 Electron 二进制下载失败（国内常见问题）：

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

### 2. 配置 API Key

启动应用后，进入「设置」页面，选择模型供应商并输入 API Key。

- DeepSeek：[platform.deepseek.com](https://platform.deepseek.com)
- OpenAI：[platform.openai.com](https://platform.openai.com)
- Claude：[console.anthropic.com](https://console.anthropic.com)
- 通义千问：[dashscope.aliyun.com](https://dashscope.aliyun.com)

### 3. 启动开发模式

```bash
npm run dev
```

### 4. 打包 Windows

```bash
npm run package
```

打包输出在 `release/`，包含 `AI小说写作.exe` 便携版。

---

## AI 生成逻辑

### 层级依赖

```
大纲 → 卷纲 → 逐章细纲 → 正文
  ↑       ↑        ↑        ↑
  └─── 风格库 + 拆文库 + 角色/世界卡片 ───┘
```

每一层级读取上一级输出，叠加风格库、拆文库、卡片等参考信息。正文生成额外读取上一章结尾和记录官摘要。

### 📐 大纲

| 项目 | 内容 |
|------|------|
| **触发** | 工具栏「🤖 大纲」→ 选择参考 → 输入提示 → 确定 |
| **System** | 7 部分结构化：分卷规划、字数规划、情绪弧线、伏笔地图、人物弧线总览、主题线与核心冲突、分章框架 |
| **输入** | 书名 + 作者想法 + 风格上下文 + 拆文参考 + 设定库参考 |
| **输出** | Markdown → `outlines` 表 → 自动提取事实簿 |

### 📑 卷纲（逐卷生成）

| 项目 | 内容 |
|------|------|
| **触发** | 卷纲面板「生成下一卷」→ 每次生成一卷 |
| **System** | 17 字段综合卷纲：节奏设计、伏笔操作（新埋/回收/推进）、人物弧线里程碑、关键冲突节点、承上启下 |
| **输入** | 大纲 + 前一卷卷纲 + 风格 + 拆文 + 事实簿硬规则 + 伏笔注册表状态 + 记录官前卷摘要 |
| **输出** | 单个 JSON 对象 → 追加到 volumes 列表 |

### 📝 细纲（逐章生成）

| 项目 | 内容 |
|------|------|
| **触发** | 细纲面板中点击某章「生成」 |
| **System** | 首章黄金开篇 / 卷首章新卷氛围 / 普通章基于上一章连贯 |
| **输入** | 大纲 + 所在卷上下文 + 上一章细纲 + 风格 + 拆文 |
| **输出** | JSON `{chapter_number, title, function, summary, characters, key_events, emotional_goal, estimated_words, ending_type}` |

### ✍️ 正文（流式）

| 项目 | 内容 |
|------|------|
| **触发** | 工具栏「🤖 生成本章」→ 选择参考 → 输入提示 → 确定 |
| **System** | 段落节奏(参考配比)、对话规范、去AI味(50+禁用词)、13种钩子、爽点公式 |
| **输入** | 大纲摘要 + 章细纲全部字段 + 上一章结尾(300字) + 记录官前章摘要 + 卷上下文 + 拆文(1500字) + 风格 + 卡片 + 作者提示 |
| **输出** | 流式打字机效果 → `chapters` 表 → 自动生成记录官摘要 |

### 🔍 校对 + 自动修改

| 项目 | 内容 |
|------|------|
| **触发** | 校对 Tab → 「执行校对」 |
| **System** | 6维检查：人物一致性/情节连贯/时间线/伏笔/AI味/设定一致 |
| **输出** | JSON `{overall_report, chapter_fixes: [{chapter_number, severity, issues, fix_prompt}]}` |
| **自动修改** | 点击某章「自动修改」→ AI 生成 find-replace 对 → 精确匹配替换 → 预览 → 确认保存 |

---

## 项目结构

```
novel-ai-writer/
├── electron/              # Electron 主进程
│   ├── main.ts            # 窗口 + IPC + AI 流式调用 + AbortController
│   ├── preload.ts         # contextBridge API 桥接
│   └── database.ts        # SQLite 封装 (11表)
├── src/                   # React 渲染进程
│   ├── components/
│   │   ├── layout/        # AppLayout + Sidebar
│   │   ├── writing/       # Workspace + CanonFactPanel + ForeshadowingPanel + TimelinePanel + DeslopPanel
│   │   ├── library/        # LibraryList + LibraryDetail
│   │   ├── disassembly/    # DisassemblyList + DisassemblyDetail
│   │   ├── setting/        # SettingList + SettingDetail (设定库)
│   │   ├── project/        # ProjectList (项目管理)
│   │   ├── settings/       # SettingsPage (多模型配置)
│   │   └── common/         # Toast / Modal / InlineEdit
│   ├── services/
│   │   ├── generator.ts      # 生成 Prompt (大纲/卷纲/细纲/正文/校对/自动修改)
│   │   ├── disassembler.ts   # 拆文 Prompt + smart sampling + sanitize
│   │   ├── extractor.ts      # 风格提取 + 段落配比分析
│   │   ├── deslop.ts         # 去 AI 味检测 + 改写
│   │   └── export.ts         # TXT / DOCX / Markdown 导出
│   ├── store/             # Zustand 状态管理
│   └── types/             # TypeScript 类型定义
├── resources/icon.png     # 应用图标
└── package.json
```

## License

MIT
