# AI 小说写作软件

一款 Windows 桌面 AI 小说写作工具，基于 Electron + React + TypeScript 构建，DeepSeek API 驱动 AI 辅助长篇小说创作。

当前版本：**v1.3.0**

## 核心功能

- **🎨 风格库**：导入小说 → AI 一次性分析写作风格（含长短段配比）→ 逐字段分段编辑 → 生成时套用
- **🔬 拆文库**：导入爆款小说 → AI 一次性拆解（概述/黄金三章/逐章摘要/聚合分析/文风分析/爽点/硬伤）→ 逐段编辑 → 生成时参考
- **✍️ 写作工作台**：三栏布局（章节目录 + 正文编辑 + 大纲/细纲/校对）
  - 🌊 流式逐章生成：打字机效果，可随时中断
  - 📑 卷纲逐卷生成：每次生成一卷，基于前一卷上下文自然衔接
  - 📝 逐章细纲：基于卷纲和上一章细纲逐章生成
  - 📏 段落配比：风格库分析长短段比例，AI 参考配比生成
  - 🧹 去 AI 味：本地 50+ 禁用词扫描 + AI 改写
- **🃏 角色/世界卡片**：从大纲/拆文库/章节 AI 自动生成 + 手动创建编辑 + AI 补全，生成时自动注入上下文
- **📝 记录官**：每章生成后自动提取摘要/人物/伏笔，下一章自动引用
- **🔍 智能校对**：AI 逐章检查一致性 → 分章问题卡片 → 一键复制修改提示 → 自动 find-replace 修改
- **⚙ 多模型**：DeepSeek / OpenAI / Claude / 通义千问，设置页面配置
- **📥 导出**：TXT / Word / Markdown

## 更新日志

### v1.3.0

| 功能 | 说明 |
|------|------|
| 📑 卷纲逐卷生成 | 每次只生成一卷，基于前一卷上下文自然衔接，起承转合完整 |
| 🔬 拆文库重构 | 智能采样（50000字）→ 单次 AI 调用 → 所有维度一次性输出 → 分段独立编辑 |
| 🎨 风格库重构 | 智能采样 → 单次 AI 调用 → 长段/短段配比分析 |
| 🎨 风格库重新提取 | 详情页增加重新提取按钮，可切换源文本重新分析 |
| ⏹ 全局中断 | 大纲/卷纲/细纲/正文/校对/卡片/拆文/风格提取 全部支持一键取消 |
| 🔧 取消提示统一 | 所有组件取消时显示"已取消生成"，不再误报"生成失败" |
| 🗑 批量删除 | 角色和世界卡片支持一键清空 |
| 📋 MD 导出 | 新增 Markdown 导出 |
| 🔧 JSON 容错 | 四级 JSON 恢复（去尾逗号→去控制字符→修字符串值→正则兜底），解决 AI 返回格式异常 |
| 🔧 大量修复 | 白屏/递归 bug/表单不填充/流式双份生成/cancel 多次点击 等 |

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
| **System** | 四幕剧结构、情绪弧线、5类钩子交替、人物弧线、核心冲突层次 |
| **输入** | 书名 + 作者想法 + 风格上下文 + 拆文参考 + 角色/世界卡片 |
| **输出** | Markdown → `outlines` 表 |

### 📑 卷纲（逐卷生成）

| 项目 | 内容 |
|------|------|
| **触发** | 卷纲面板「生成下一卷」→ 每次生成一卷 |
| **System** | 每卷 8-15 章、起承转合小弧线、detailed_summary(300-500字)、角色弧线、情感曲线、伏笔 |
| **输入** | 大纲 + 前一卷卷纲(含细纲) + 风格 + 拆文 + 卡片 + 全书估计章数 |
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
│   │   ├── writing/       # Workspace(核心写作) + CardPanel + DeslopPanel
│   │   ├── library/       # LibraryList + LibraryDetail
│   │   ├── disassembly/   # DisassemblyList + DisassemblyDetail
│   │   ├── project/       # ProjectList (项目管理)
│   │   ├── settings/      # SettingsPage (多模型配置)
│   │   └── common/        # Toast / Modal / InlineEdit / ReferenceSelector / GenConfigModal
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
