/**
 * 拆文库服务 v2
 * 智能采样 + 单次 AI 调用，适合处理百万字级小说
 *
 * 策略：
 * 1. 本地智能采样（开头+结尾+每隔N章抽关键段）
 * 2. 单次 AI 调用返回完整结构化分析
 * 3. 采样总长度控制在 50000 字符以内，确保低 token 消耗
 */

/**
 * 清理文本中的危险控制字符和非法转义序列
 * 移除所有 \x 和 \u 序列（这些在通过 API JSON 传输时会出错）
 */
function sanitizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // 移除控制字符
    .replace(/\\x[0-9a-fA-F]{0,2}/g, '')               // 移除所有 \x 序列（完整或不完整）
    .replace(/\\u[0-9a-fA-F]{0,4}/g, '')               // 移除所有 \u 序列
    .replace(/\0/g, '')                                  // 空字符
}

/**
 * 从全文智能采样，提取代表性片段
 * @param text 完整原文
 * @returns 采样后的文本（≤50000字）
 */
export function sampleText(text: string): string {
  const MAX_LENGTH = 50000
  const clean = sanitizeText(text)
  if (clean.length <= MAX_LENGTH) return clean

  const parts: string[] = []

  // 1. 开头 4000 字（黄金三章核心区域）
  parts.push('=== 开篇（黄金三章） ===')
  parts.push(clean.slice(0, 4000))

  // 2. 结尾 2000 字
  parts.push('\n\n=== 结尾 ===')
  parts.push(clean.slice(-2000))

  // 3. 中间均匀采样
  const remaining = MAX_LENGTH - parts.join('\n').length - 200
  const mid = clean.slice(4000, -2000)
  const sampleCount = Math.min(40, Math.floor(remaining / 600))
  const step = Math.floor(mid.length / sampleCount)

  parts.push(`\n\n=== 中间章节采样（共 ${sampleCount} 个片段） ===`)
  for (let i = 0; i < sampleCount; i++) {
    const start = i * step
    const snippet = sanitizeText(mid.slice(start, start + 500))
    if (snippet.trim()) {
      parts.push(`\n[片段 ${i + 1}]\n${snippet}`)
    }
  }

  return parts.join('\n').slice(0, MAX_LENGTH)
}

/**
 * 估算章节数（本地扫描，不用AI）
 */
export function estimateChapters(text: string): number {
  // 匹配 "第X章" "Chapter X" 等模式
  const cnMatch = text.match(/第[一二三四五六七八九十百千0-9]+章/g)
  if (cnMatch && cnMatch.length > 5) return cnMatch.length

  // 匹配 "### Chapter" 或换行+数字+标题的模式
  const lines = text.split('\n')
  let count = 0
  for (const line of lines) {
    if (/^\s*(第[一二三四五六七八九十百千0-9]+[章回节]|Chapter\s+\d+|^\d+[\.\、]\s+\S)/i.test(line)) {
      count++
    }
  }
  return count > 5 ? count : Math.ceil(text.length / 4000) // fallback: ~4000字/章
}

// ==================== 单次拆文 Prompt ====================

export const DISASSEMBLE_SYSTEM = `你是专业网文拆解分析师。你需要根据提供的全文智能采样，一次性完成全部拆解分析。

## 分析要求

### 1. 概要（summary）
- 书名和作者（如果能识别）
- 200字以内的全书概要
- 总章节数和字数估算

### 2. 黄金三章分析（golden3）
- 开篇钩子类型和效果
- 主角人设建立方式
- 核心冲突引入
- 爽点设计

### 3. 章节结构（chapter_structure）
- 故事分为几个大阶段（幕/卷）
- 每个阶段的关键事件

### 4. 角色分析（characters）
- 核心角色列表（主角、反派、盟友），每人50-100字描述
- 角色之间的关系

### 5. 剧情分析（plot）
- 主线和支线
- 关键转折点
- 伏笔设计

### 6. 世界观分析（world）
- 时代/世界背景
- 力量体系/特殊设定
- 重要地点和势力

### 7. 文风分析（style）
- 句式特点（短句/长句比例）
- 段落配比（短段/中段/长段比例）
- 对话占比
- 情绪表达方式
- 3-5个代表性段落原文引用

### 8. 五维评分 + 套路提炼（report）
- 开篇吸引力(1-10)、人设立体度(1-10)、爽点密度(1-10)、节奏控制(1-10)、世界观完整度(1-10)
- 3-5个可复用的写作套路

## 输出格式
必须使用以下 Markdown 格式输出（每个 ## 二级标题代表一个分析维度），不要用JSON：

## 概要
（书名、作者、200字概要、章节数）

## 黄金三章分析
（开篇钩子、人设建立、冲突引入、爽点设计）

## 角色分析
（核心角色列表、性格特征、关系网络）

## 剧情分析
（主线支线、关键转折点、伏笔设计）

## 世界观分析
（时代背景、力量体系、重要地点势力）

## 文风分析
（句式特点、段落配比、对话占比、情绪表达、代表性段落原文引用）

## 评分与套路
（五维评分 + 3-5个可复用套路）

控制总输出在 3000 字以内，每个维度尽量精简。`

export const DISASSEMBLE_USER = (sampledText: string, totalChapters: number, totalChars: number) =>
  `【全文采样数据】
原文总字数：约 ${totalChars.toLocaleString()} 字
预估章节数：${totalChapters} 章
采样策略：开头4000字 + 结尾2000字 + 全书均匀40段采样

【采样内容】
${sampledText}

请从采样中提取完整拆解分析，严格按照 System Prompt 中的 7 个 ## 二级标题输出 Markdown 格式。
如果某个维度信息不足，可标注"从采样中无法确定"。核心分析必须基于采样内容给出。`

// 保留旧版 stage 函数供兼容
export const STAGE0_SYSTEM = ''
export const STAGE1_SYSTEM = ''
export const STAGE2_SYSTEM = ''
export const STAGE3_CHARACTER_SYSTEM = ''
export const STAGE3_PLOT_SYSTEM = ''
export const STAGE3_WORLD_SYSTEM = ''
export const STAGE4_SYSTEM = ''
export const STAGE5_SYSTEM = ''
export function stage0User(t: string) { return '' }
export function stage2User(t: string) { return '' }
export function stage4User(t: string) { return '' }
