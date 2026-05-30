# AI 小说写作软件

一款 Windows 桌面 AI 小说写作工具，基于 Electron + React + TypeScript 构建，支持 DeepSeek / OpenAI / Claude / 通义千问等多模型驱动 AI 辅助长篇小说创作。

当前版本：**v1.1.0**

## 核心功能

- **🎨 风格库**：导入小说 → AI 分析写作风格（含长短段配比）→ 逐字段编辑 → 生成时套用
- **🔬 拆文库**：深度拆解爆款小说（6 阶段管线：概要→黄金三章→逐章摘要→聚合分析→文风→汇总报告）
- **✍️ 写作工作台**：三栏布局（章节目录 + 正文编辑 + 大纲/细纲/校对）
  - 情绪驱动选题：先定情绪目标 → 匹配题材 → 设计故事
  - 卷纲 + 逐章细纲：按卷组织，每章独立生成
  - 🌊 流式逐章生成：层级依赖（大纲→卷纲→章细纲→上一章正文+角色卡片+记录官摘要），打字机效果
  - 段落配比：风格库分析长短段比例，AI 生成时参考配比避免全短段
  - 去 AI 味：本地扫描 + AI 改写
- **🃏 角色/世界卡片**：角色性格/背景/关系 + 世界地点/势力/规则，生成时自动注入上下文
- **📝 记录官**：每章自动提取摘要/人物/伏笔，下一章自动引用
- **🔍 智能校对**：AI 逐章检查一致性 → 分章问题卡片 → 一键复制修改提示 → 自动修改（find-replace 精确替换）
- **📊 Token 监控**：侧边栏实时统计 + 缓存命中显示 + 每次 AI 调用弹出用量和费用
- **🤖 多模型支持**：DeepSeek / OpenAI / Claude / 通义千问，设置页面一键切换
- **📥 导出**：TXT / Word / Markdown

## v1.1.0 更新内容

| 功能 | 说明 |
|------|------|
| 🌊 流式输出 | 正文生成逐字打字机效果 |
| 🤖 多模型 | DeepSeek / OpenAI / Claude / 通义千问 |
| 🃏 角色世界卡片 | 结构化角色/世界设定，自动注入生成上下文 |
| 📝 记录官 | 每章自动摘要/人物/伏笔提取 |
| 🔍 校对增强 | 逐章问题卡片 + 复制修改提示 + 自动 find-replace 修改 |
| 📊 Token 增强 | 缓存命中追踪 + 每次调用弹出用量通知 |
| 📏 段落配比 | 风格库分析长短段比例，AI 参考配比生成长短交错的段落 |
| 📋 MD 导出 | 新增 Markdown 导出，移除 PDF |
| 🎛️ 设置重构 | 卡片式 UI，多供应商独立配置 |
| 🔧 大量修复 | 版本号/返回按钮/编辑器字体/radio→checkbox/Token 准确计数等 |

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

如果 Electron 二进制下载失败（国内常见问题），手动下载：

```bash
# 设置国内镜像加速 npm 包下载
npm config set registry https://registry.npmmirror.com

# 安装依赖
npm install

# Electron 二进制需从 GitHub 下载，失败则手动下载解压
curl -L -o /tmp/electron.zip "https://github.com/electron/electron/releases/download/v28.3.3/electron-v28.3.3-win32-x64.zip"
rm -rf node_modules/electron/dist
unzip /tmp/electron.zip -d node_modules/electron/dist/
printf "electron.exe" > node_modules/electron/path.txt
```

### 2. 配置 API Key

启动应用后，进入「设置」页面，选择模型供应商并输入 API Key。

获取 Key：
- DeepSeek：[platform.deepseek.com](https://platform.deepseek.com)
- OpenAI：[platform.openai.com](https://platform.openai.com)
- Claude：[console.anthropic.com](https://console.anthropic.com)
- 通义千问：[dashscope.aliyun.com](https://dashscope.aliyun.com)

### 3. 启动开发模式

```bash
npm run dev
```

### 4. 打包

```bash
npm run build && npx electron-builder --win --dir
```

打包输出在 `release/win-unpacked/`，运行 `AI小说写作.exe`。

## 项目结构

```
novel-ai-writer/
├── electron/           # Electron 主进程
│   ├── main.ts         # 窗口 + IPC + AI 流式调用 + Token 追踪
│   ├── preload.ts      # 安全 API 桥接
│   └── database.ts     # SQLite 封装 (11表)
├── src/                # React 渲染进程
│   ├── components/     # UI 组件
│   │   ├── layout/     # 布局（侧边栏含 Token 监控）
│   │   ├── writing/    # 写作工作台（核心）+ 校对 + 去AI味
│   │   ├── library/    # 风格库管理
│   │   ├── disassembly/# 拆文库管理
│   │   ├── project/    # 项目管理
│   │   ├── settings/   # 设置（多模型配置）
│   │   └── common/     # 通用组件
│   ├── services/       # 业务逻辑
│   │   ├── generator.ts   # 生成 + 校对 + 自动修改 Prompt
│   │   ├── disassembler.ts# 拆文 6 阶段 Prompt
│   │   ├── extractor.ts   # 风格提取（含段落配比）
│   │   ├── deslop.ts      # 去 AI 味检测 + 改写
│   │   └── export.ts      # TXT/DOCX/Markdown 导出
│   ├── store/          # Zustand 状态
│   └── types/          # TypeScript 类型
├── docs/               # 设计文档
├── scripts/            # 构建脚本
└── resources/icon.png  # 应用图标
```

## License

MIT
