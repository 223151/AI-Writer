import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import DeslopPanel from './DeslopPanel'
import VolumePanel from './VolumePanel'
import ReviewPanel from './ReviewPanel'
import { getEffectivePatterns, saveCustomBannedPatterns } from '../../services/deslop'
import type { ParagraphScore } from '../../services/deslop'
import ForeshadowingPanel from './ForeshadowingPanel'
import TimelinePanel from './TimelinePanel'
import CanonFactPanel from './CanonFactPanel'

import {
  PREPARE_SYSTEM, PREPARE_USER,
  OUTLINE_SYSTEM, OUTLINE_USER,
  OUTLINE_NORMALIZE_SYSTEM, OUTLINE_NORMALIZE_USER,
  CONTINUE_SYSTEM, CONTINUE_USER,
  IDEA_SYSTEM, IDEA_USER,
  GOLDEN_THREE_SYSTEM, GOLDEN_THREE_USER,
  REVERSE_OUTLINE_SYSTEM, REVERSE_OUTLINE_USER,
  VOLUME_OUTLINE_SYSTEM, VOLUME_OUTLINE_USER,
  DETAIL_OUTLINE_SYSTEM, DETAIL_OUTLINE_USER,
  CHAPTER_SYSTEM, CHAPTER_USER,
  CONTEXT_UPDATE_SYSTEM, CONTEXT_UPDATE_USER,
  CHAPTER_SUMMARY_SYSTEM, CHAPTER_SUMMARY_USER,
  EVENT_EXTRACTION_SYSTEM, EVENT_EXTRACTION_USER,
  NARRATIVE_STATE_REPORT_SYSTEM, NARRATIVE_STATE_REPORT_USER,
  CANON_EXTRACTION_SYSTEM, CANON_EXTRACTION_USER,
  buildMinimalContext, buildStateContext,
  AUTO_FIX_SYSTEM, AUTO_FIX_USER,
} from '../../services/generator'
import {
  checkChapter, applyStatePatches, calcInfoLoss, buildRewritePrompt,
  takeSnapshot, diffSnapshot, buildStatePatchFromEvents, getCalibrationStats,
  computeStateDrift, selectMode, modeTvDelta, modeDecayRate, modeDriftBonus,
  DEFAULT_REWRITE_LIMIT,
  type Violation, type CheckResult, type StatePatch,
  type NormalizedLeakScore, type EventExtractionResult,
} from '../../services/checker'
import type { NovelProject, Chapter, StyleLibrary, SettingLibrary, PersonalityProject } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'

// ===== 类型 =====
interface Volume {
  volume_number: number; title: string; summary: string
  chapter_range: [number, number]; theme: string
  key_events: string[]
  detailed_summary?: string
  character_arcs?: string
  key_events_str?: string
  emotional_curve?: string
  foreshadowing?: string
  foreshadowing_planted?: string[]
  foreshadowing_recovered?: string[]
  word_count_target?: number
  connection_prev?: string
  connection_next?: string
  pacing_design?: string
  emotional_cadence?: string
  foreshadowing_plant?: string[]
  foreshadowing_payoff?: string[]
  foreshadowing_advance?: string
  character_milestones?: { character: string; start_state: string; end_state: string; key_event: string }[]
  conflict_nodes?: { description: string; chapter_segment: string; escalation_type: string }[]
  nodes?: { name: string; chapter_segment: string; task: string; pacing: string; content: string; disasm_ref?: string; setting_ref?: string }[]
  cool_density?: string
  golden_five?: string
  timeline_context?: { current_day: number; days_covered: number }
  outline_version?: number
  version?: number
}
interface ChapterPlan {
  chapter_number: number; title: string
  summary?: string; characters?: string[]; key_events?: string[]
  estimated_words: number; emotional_goal?: string
  function?: string; ending_type?: string
  core_event?: string; plot_beats?: string[]
  emotional_arc?: string
  opening_hook?: { type: string; detail: string }
  closing_hook?: { type: string; impact: string }
  cool_moment?: string; status?: string
  forbidden?: string[]; scene_count?: number
  max_info_reveal?: string; emotion_cap?: string
  allowed_reveal?: { world: number; plot: number; character: number }
  volume_version?: number
  plan_version?: number
}

interface ChapterFix {
  chapter_number: number
  severity: string
  issues: string[]
  fix_prompt: string
}

// ===== 构建引用上下文 =====
function parseJson(v: string, fallback: any) { try { return JSON.parse(v) } catch { return fallback } }

/** 构建拆文库上下文（大纲/卷纲用） */
function buildDisassemblyContext(
  primaryDissId: number | null, auxDissIds: number[],
  disassemblies: DisassemblyProject[]
) {
  const ids = [primaryDissId, ...auxDissIds].filter(Boolean) as number[]
  const diss = disassemblies.filter(d => ids.includes(d.id))
  if (!diss.length) return ''
  return diss.map(d => {
    const r = JSON.parse(d.stage_results || '{}')
    return `【${d.id === primaryDissId ? '主参考' : '辅参考'}】${d.name}\n${(r.result || r.stage0 || '').slice(0, 1000)}`
  }).join('\n\n---\n\n')
}

/** 构建设定库上下文（大纲/卷纲用） */
function buildSettingContext(
  primaryId: number | null, auxIds: number[],
  settingLibraries: SettingLibrary[]
) {
  const ids = [primaryId, ...auxIds].filter(Boolean) as number[]
  const libs = settingLibraries.filter(l => ids.includes(l.id))
  if (!libs.length) return ''
  return libs.map(l => {
    const d = l.setting_data || {}
    const chars = (d as any).characters || []
    const worlds = (d as any).worlds || []
    const rules = (d as any).rules || []
    const prefix = l.id === primaryId ? '【主设定】' : '【辅设定】'
    let ctx = `${prefix}《${l.name}》`
    if (chars.length) {
      ctx += `\n角色(${chars.length}个)：`
      ctx += chars.map((c: any) => {
        const parts = [c.name]
        if (c.info) parts.push(`身份：${c.info}`)
        if (c.abilities) parts.push(`能力：${c.abilities}`)
        if (c.role) parts.push(`定位：${c.role}`)
        return parts.join('，')
      }).join('；')
    }
    if (worlds.length) {
      ctx += `\n世界观(${worlds.length}个)：`
      ctx += worlds.map((w: any) => {
        const parts = [w.name]
        if (w.description) parts.push(w.description)
        if (w.category) parts.push(`类别：${w.category}`)
        return parts.join('：')
      }).join('；')
    }
    if (rules.length) {
      ctx += `\n规则(${rules.length}个)：`
      ctx += rules.map((r: any) => `${r.name}：${r.description || ''}`).join('；')
    }
    return ctx
  }).join('\n\n')
}

/** 构建风格库上下文（正文用） — v3 丰富约束 */
/** 从长文本中提取条目列表（按句号/换行/分号拆分，取前N条） */
function extractItems(text: string | undefined, maxItems: number): string[] {
  if (!text || text.length < 5) return []
  const items = text.split(/[。；\n]+/).map(s => s.trim()).filter(s => s.length > 3)
  return items.slice(0, maxItems)
}

function buildStyleContext(
  primaryStyleId: number | null, auxStyleIds: number[],
  styleLibraries: StyleLibrary[]
) {
  const ids = [primaryStyleId, ...auxStyleIds].filter(Boolean) as number[]
  const styles = styleLibraries.filter(l => ids.includes(l.id))
  if (!styles.length) return ''
  return styles.map((s) => {
    const p = s.style_profile as any
    const n = p?.narrative; const rh = p?.sentence_rhythm
    const pg = p?.paragraph; const l = p?.language; const a = p?.atmosphere
    const prefix = `【🎨 风格约束——${s.id === primaryStyleId ? '主' : '辅'}】${s.name}`
    const hard: string[] = []; const soft: string[] = []; const style: string[] = []

    // ── 🔴 硬约束 ≤7条 ──
    if (n?.perspective) hard.push(`- 使用「${n.perspective}」。禁止切换视角。`)
    if (n?.pov_rules) hard.push(`- ${n.pov_rules}`)
    if (pg?.forbidden) hard.push(`- 禁止：${pg.forbidden}`)
    if (l?.forbidden_words) {
      const words = l.forbidden_words.split(/[,，、\s]+/).filter((w: string) => w.length > 1)
      if (words.length > 0) hard.push(`- 禁用词汇（出现即违规）：${words.slice(0, 20).join('、')}`)
    }

    // ── 🟡 软约束 ≤12条 ──
    if (rh && typeof rh === 'object') {
      if (rh.short_max) soft.push(`- 短句≤${rh.short_max}字`)
      if (rh.long_min) soft.push(`- 长句≥${rh.long_min}字`)
      if (rh.density) soft.push(`- 句式密度：${rh.density}`)
      if (rh.exception) soft.push(`- 例外：${rh.exception}`)
    } else if (typeof rh === 'string' && rh.length > 2) {
      soft.push(`- 句式：${rh}`)
    } else {
      const ws = p?.writing_style
      if (ws?.sentence_characteristics) soft.push(`- 句式：${ws.sentence_characteristics}`)
    }
    if (l?.vocab_level) soft.push(`- 词汇层级：${l.vocab_level}`)
    if (l?.dialogue_vs_narrative) soft.push(`- 叙事vs对话：${l.dialogue_vs_narrative}`)
    if (a?.emotion_scale) soft.push(`- 情绪跨度：${a.emotion_scale}`)
    if (a?.level_triggers) soft.push(`- 升档触发：${a.level_triggers}`)
    if (a?.must_downgrade) soft.push(`- 必须降档场景：${a.must_downgrade}`)
    if (pg?.habit) soft.push(`- 段落习惯：${pg.habit}`)
    if (pg?.by_scene_type) soft.push(`- 场景段落：${pg.by_scene_type}`)

    // ── 🔵 风格漂移 ≤15条 ──
    if (n?.narrator_intrusion) style.push(`- 叙事者行为：${n.narrator_intrusion}`)
    if (a?.tone) style.push(`- 氛围：${a.tone}`)
    else if (a?.primary) style.push(`- 氛围：${a.primary}`)
    // v2/旧格式回退
    if (!hard.length && !soft.length) {
      const ws = p?.writing_style; const lf = p?.language_features
      if (ws?.narrative_perspective) hard.push(`- 使用「${ws.narrative_perspective}」`)
      if (ws?.pace) soft.push(`- 节奏：${ws.pace}`)
      if (lf?.vocabulary_preference) soft.push(`- 词汇：${lf.vocabulary_preference}`)
      if (ws?.paragraph_ratio) soft.push(`- 段落：${ws.paragraph_ratio}`)
    }

    const sections: string[] = [prefix]
    if (hard.length) sections.push(`🔴 必须遵守（${Math.min(hard.length, 7)}条）：\n${hard.slice(0, 7).join('\n')}`)
    if (soft.length) sections.push(`🟡 优先遵守（${Math.min(soft.length, 12)}条）：\n${soft.slice(0, 12).join('\n')}`)
    if (style.length) sections.push(`🔵 风格漂移（${Math.min(style.length, 15)}条）：\n${style.slice(0, 15).join('\n')}`)
    return sections.join('\n\n')
  }).join('\n')
}

/** 构建人格库上下文（正文用） — 约束式输出，分三层 */
function buildPersonalityContext(
  primaryId: number | null, auxIds: number[],
  personalityProjects: PersonalityProject[]
) {
  const ids = [primaryId, ...auxIds].filter(Boolean) as number[]
  const projects = personalityProjects.filter(p => ids.includes(p.id))
  if (!projects.length) return ''
  return projects.map(p => {
    const d = p.personality_data || {} as any
    const prefix = `【🧠 人格约束——${p.id === primaryId ? '主' : '辅'}】${p.name}`
    const soft: string[] = []; const style: string[] = []

    // ── 🟡 软约束（意象+修辞+对话+风景是硬材料池） ──
    const imgs = extractItems(d.private_imagery, 8)
    if (imgs.length) soft.push(`- 私人意象（只能用以下，禁止训练数据套路意象）：\n${imgs.map(i => `  · ${i}`).join('\n')}`)
    const quirks = extractItems(d.emotional_quirks, 5)
    if (quirks.length) soft.push(`- 情绪怪癖（极端情绪下只能这样反应）：\n${quirks.map(q => `  · ${q}`).join('\n')}`)
    const rhetorics = extractItems(d.private_rhetoric, 5)
    if (rhetorics.length) soft.push(`- 私人修辞（比喻必须从以下生长）：\n${rhetorics.map(r => `  · ${r}`).join('\n')}`)
    const dialogue = extractItems(d.dialogue_fingerprint, 6)
    if (dialogue.length) soft.push(`- 对话指纹（角色说话方式只能从以下模式中取——情绪表达方式、说多少藏多少、角色声音差异）：\n${dialogue.map(dl => `  · ${dl}`).join('\n')}`)
    const scenery = extractItems(d.scenery_fingerprint, 5)
    if (scenery.length) soft.push(`- 风景指纹（景物描写的频率、切入方式、如何通过景写情）：\n${scenery.map(sc => `  · ${sc}`).join('\n')}`)

    // ── 🔵 风格漂移 ──
    const rhythm = extractItems(d.rhythm_fingerprint, 5)
    if (rhythm.length) style.push(`- 节奏指纹：\n${rhythm.map(r => `  · ${r}`).join('\n')}`)
    const nonsense = extractItems(d.nonsense_style, 4)
    if (nonsense.length) style.push(`- 废话风格（允许的叙事者行为）：\n${nonsense.map(n => `  · ${n}`).join('\n')}`)
    const narration = extractItems(d.narrative_distance, 4)
    if (narration.length) style.push(`- 叙事距离（叙述者离角色多近、是否点评、视角切换）：\n${narration.map(nr => `  · ${nr}`).join('\n')}`)
    const infoRelease = extractItems(d.info_release, 4)
    if (infoRelease.length) style.push(`- 信息释放（关键信息通过什么载体、分批还是一次性、伏笔模式）：\n${infoRelease.map(ir => `  · ${ir}`).join('\n')}`)

    const sections: string[] = [prefix]
    if (soft.length) sections.push(`🟡 优先遵守（${soft.length}条）：\n${soft.join('\n')}`)
    if (style.length) sections.push(`🔵 风格漂移（${style.length}条）：\n${style.join('\n')}`)
    return sections.join('\n\n')
  }).join('\n')
}

/** 卷纲高级字段 — 可折叠展示 */
export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // 核心数据
  const [project, setProject] = useState<NovelProject | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [prepareContent, setPrepareContent] = useState('')
  const [outlineContent, setOutlineContent] = useState('')
  const [outlineVersion, setOutlineVersion] = useState(1)
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [chapterPlans, setChapterPlans] = useState<ChapterPlan[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [plotSummary, setPlotSummary] = useState('')

  // UI 状态
  const [selectedChapter, setSelectedChapter] = useState<number>(1)
  const [editingContent, setEditingContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genTarget, setGenTarget] = useState('')
  const [budgetInfo, setBudgetInfo] = useState<{ charTokens?: number; totalChars?: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [rightTab, setRightTab] = useState<'outline' | 'volumes' | 'settings' | 'review' | 'foreshadowing' | 'timeline'>('outline')
  const [expandedVolume, setExpandedVolume] = useState<number | null>(null)
  // ── 叙事控制台 v2 state ──
  const [lastCheckResult, setLastCheckResult] = useState<CheckResult | null>(null)
  const [lastEventData, setLastEventData] = useState<EventExtractionResult | null>(null)
  const [lastLeakScore, setLastLeakScore] = useState<NormalizedLeakScore | null>(null)
  const [calibrationStats, setCalibrationStats] = useState<{ chapters: number; mean: number; std: number } | null>(null)
  const [narrativeReport, setNarrativeReport] = useState<{
    narrative_state: string; pacing: string; characters: string; risk: string
    suggested_actions: { text: string; target_chapter: number | null; executable: false }[]
  } | null>(null)
  const [narrativeReportLoading, setNarrativeReportLoading] = useState(false)
  const [fixingChapter, setFixingChapter] = useState<number | null>(null)
  const [fullscreenEdit, setFullscreenEdit] = useState<{ title: string; content: string; onSave: (c: string) => void } | null>(null)
  const [fixPreview, setFixPreview] = useState<{ chapterNum: number; original: string; modified: string; skipped: string[] } | null>(null)
  const [showMarks, setShowMarks] = useState(false)
  const [markData, setMarkData] = useState<{ scores: ParagraphScore[]; selected: Set<number> } | null>(null)
  // 选中文字 → 一键禁用
  const [banSelection, setBanSelection] = useState<{ text: string; x: number; y: number } | null>(null)
  const [banFormOpen, setBanFormOpen] = useState(false)
  // 版本历史
  const [historyModal, setHistoryModal] = useState<{ type: string; key: string; currentContent: string; onRestore?: (c: string) => void } | null>(null)
  const [historyList, setHistoryList] = useState<any[]>([])
  // 灵感脑洞
  const [ideaInput, setIdeaInput] = useState('')
  const [ideaData, setIdeaData] = useState<any>(null)
  const [ideaLoading, setIdeaLoading] = useState(false)

  /** 灵感脑洞生成 */
  const handleGenerateIdea = async () => {
    if (!ideaInput.trim()) { showToast('error', '请输入灵感描述'); return }
    setIdeaLoading(true)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: IDEA_SYSTEM },
        { role: 'user', content: IDEA_USER(ideaInput) },
      ], '灵感脑洞')
      if (cancelledRef.current) return
      const jm = reply.match(/\{[\s\S]*\}/)
      if (jm) { setIdeaData(JSON.parse(jm[0])); showToast('success', '灵感脑洞已生成') }
      else showToast('error', 'AI 返回格式异常')
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '生成失败：' + (e.message || '未知'))
    } finally { setIdeaLoading(false) }
  }

  /** 黄金三章生成 */
  const [goldenLoading, setGoldenLoading] = useState(false)
  const handleGenerateGoldenThree = async () => {
    if (!ideaData) return
    setGoldenLoading(true)
    cancelledRef.current = false
    try {
      const { styleContext, personalityContext } = await getRefs()
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: GOLDEN_THREE_SYSTEM },
        { role: 'user', content: GOLDEN_THREE_USER(ideaData, styleContext, personalityContext) },
      ], '黄金三章')
      if (cancelledRef.current) return
      const parts = reply.split(/===\s*第\d+章\s*===/).filter(Boolean)
      for (let i = 0; i < Math.min(parts.length, 3); i++) {
        const content = parts[i].trim()
        if (content) {
          await saveChapter(i + 1, ideaData.hook?.slice(0, 20) || '黄金三章', content)
        }
      }
      await window.electronAPI.settings.set(`golden_three_${id}`, 'done')
      showToast('success', '黄金三章已生成')
      await loadAll()
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '黄金三章失败：' + (e.message || '未知'))
    } finally { setGoldenLoading(false) }
  }

  /** 从黄金三章出大纲 */
  const handleReverseOutline = async () => {
    const ch1 = chapters.find(c => c.chapter_number === 1)
    const ch2 = chapters.find(c => c.chapter_number === 2)
    const ch3 = chapters.find(c => c.chapter_number === 3)
    if (!ch1 || !ch2 || !ch3) { showToast('error', '请先生成黄金三章'); return }
    setGenerating(true)
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: REVERSE_OUTLINE_SYSTEM },
        { role: 'user', content: REVERSE_OUTLINE_USER(ideaData || {}, [ch1.content, ch2.content, ch3.content]) },
      ], '反向大纲')
      await saveOutline(reply)
      showToast('success', '大纲已从黄金三章提取')
    } catch (e: any) { showToast('error', '提取失败：' + (e.message || '未知')) }
    finally { setGenerating(false) }
  }

  // 引用 — 大纲/卷纲用：拆文库 + 设定库
  const [primaryDissId, setPrimaryDissId] = useState<number | null>(null)
  const [auxDissIds, setAuxDissIds] = useState<number[]>([])
  const [primarySettingLibId, setPrimarySettingLibId] = useState<number | null>(null)
  const [auxSettingLibIds, setAuxSettingLibIds] = useState<number[]>([])
  // 引用 — 正文用：风格库 + 人格库
  const [primaryStyleId, setPrimaryStyleId] = useState<number | null>(null)
  const [auxStyleIds, setAuxStyleIds] = useState<number[]>([])
  const [primaryPersonalityId, setPrimaryPersonalityId] = useState<number | null>(null)
  const [auxPersonalityIds, setAuxPersonalityIds] = useState<number[]>([])
  // 库数据
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [disassemblies, setDisassemblies] = useState<DisassemblyProject[]>([])
  const [settingLibraries, setSettingLibraries] = useState<SettingLibrary[]>([])
  const [personalityProjects, setPersonalityProjects] = useState<PersonalityProject[]>([])

  const [canonRefresh, setCanonRefresh] = useState(0)

  // 流式生成
  const [streamingText, setStreamingText] = useState('')
  const cancelledRef = useRef(false)
  const generatingRef = useRef(false)
  const reviewingRef = useRef(false)
  const narrativeReportLoadingRef = useRef(false)

  // 同步 ref
  useEffect(() => { generatingRef.current = generating }, [generating])
  useEffect(() => { narrativeReportLoadingRef.current = narrativeReportLoading }, [narrativeReportLoading])
  const cancelStreamRef = useRef<(() => void) | null>(null)

  const handleCancel = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
  }

  // 导出
  const [showExport, setShowExport] = useState(false)

  // ========== 加载 ==========
  const loadAll = useCallback(async () => {
    try {
      if (!window.electronAPI) { setLoaded(true); return }
      const proj = await window.electronAPI.db.get('SELECT * FROM novel_projects WHERE id = ?', [Number(id)])
      if (!proj) { showToast('error', '项目不存在'); navigate('/'); return }
      setProject(proj)

      const prep = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`prepare_${id}`])
      if (prep) setPrepareContent(prep.value)

      const outl = await window.electronAPI.db.get('SELECT content, version FROM outlines WHERE project_id = ?', [Number(id)])
      if (outl) { setOutlineContent(outl.content); setOutlineVersion(outl.version || 1) }

      // 加载卷纲
      const volRow = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`volumes_${id}`])
      if (volRow) { try { setVolumes(JSON.parse(volRow.value)) } catch {} }

      // 加载细纲
      const det = await window.electronAPI.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
      if (det) setChapterPlans(JSON.parse(det.chapters))

      const chRows = await window.electronAPI.db.query('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_number', [Number(id)])
      setChapters(chRows)

      const ctx = await window.electronAPI.db.get('SELECT * FROM context_state WHERE project_id = ?', [Number(id)])
      if (ctx) setPlotSummary(ctx.plot_summary || '')

      if (proj.primary_style_id) setPrimaryStyleId(proj.primary_style_id)
      try { setAuxStyleIds(JSON.parse(proj.auxiliary_style_ids || '[]')) } catch {}
      const libs = await window.electronAPI.db.query('SELECT * FROM style_libraries ORDER BY created_at DESC')
      setStyleLibraries(libs.map((l: any) => ({ ...l, style_profile: typeof l.style_profile === 'string' ? JSON.parse(l.style_profile) : l.style_profile })))
      const diss = await window.electronAPI.db.query('SELECT * FROM disassembly_projects ORDER BY updated_at DESC')
      setDisassemblies(diss)
      const setLibs = await window.electronAPI.db.query('SELECT * FROM setting_libraries ORDER BY created_at DESC')
      setSettingLibraries(setLibs.map((l: any) => ({ ...l, setting_data: typeof l.setting_data === 'string' ? JSON.parse(l.setting_data || '{}') : (l.setting_data || {}) })))
      const pers = await window.electronAPI.db.query('SELECT * FROM personality_projects ORDER BY updated_at DESC')
      setPersonalityProjects(pers.map((p: any) => ({ ...p, personality_data: typeof p.personality_data === 'string' ? JSON.parse(p.personality_data || '{}') : (p.personality_data || {}) })))

      // 恢复上次章节
      const lastCh = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`workspace_ch_${id}`])
      if (lastCh) setSelectedChapter(Number(lastCh.value))

      // 加载当前章节内容
      const curCh = chRows.find((c: Chapter) => c.chapter_number === (lastCh ? Number(lastCh.value) : 1))
      if (curCh) setEditingContent(curCh.content || '')
    } catch { showToast('error', '加载失败') }
    setLoaded(true)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  // 离开工作台时自动取消正在运行的生成（不弹toast，由catch处理）
  useEffect(() => {
    return () => {
      if (generatingRef.current || narrativeReportLoadingRef.current) {
        cancelledRef.current = true
        window.electronAPI?.cancelAi()
      }
    }
  }, [])

  // 切换章节
  const switchChapter = async (num: number) => {
    setSelectedChapter(num)
    const ch = chapters.find(c => c.chapter_number === num)
    setEditingContent(ch?.content || '')
    if (window.electronAPI) {
      await window.electronAPI.settings.set(`workspace_ch_${id}`, String(num))
    }
  }

  // ========== 保存 ==========
  const saveChapter = async (num: number, title: string, content: string) => {
    if (!window.electronAPI) return
    const ex = chapters.find(c => c.chapter_number === num)
    if (ex?.content && ex.content.trim()) await saveVersion('chapter', String(num), ex.content)
    ex
      ? await window.electronAPI.db.run("UPDATE chapters SET title=?, content=?, word_count=?, status='edited', updated_at=datetime('now','localtime') WHERE id=?", [title, content, content.length, ex.id])
      : await window.electronAPI.db.run("INSERT INTO chapters (project_id, chapter_number, title, content, word_count, status) VALUES (?,?,?,?,?,'generated')", [Number(id), num, title, content, content.length])
    // 更新本地 state，不重载整个项目（避免 setEditingContent 被 loadAll 覆盖）
    setChapters(prev => {
      const updated = prev.find(c => c.chapter_number === num)
      if (updated) return prev.map(c => c.chapter_number === num ? { ...c, content, title, word_count: content.length } : c)
      return [...prev, { id: ex?.id || 0, project_id: Number(id), chapter_number: num, title, content, word_count: content.length, status: 'generated', created_at: '', updated_at: '' } as Chapter]
    })
  }

  const saveOutline = async (content: string) => {
    if (!window.electronAPI) return
    if (outlineContent.trim()) await saveVersion('outline', 'outline', outlineContent)
    const ex = await window.electronAPI.db.get('SELECT id FROM outlines WHERE project_id=?', [Number(id)])
    const newVersion = outlineVersion + 1
    ex
      ? await window.electronAPI.db.run("UPDATE outlines SET content=?, version=?, updated_at=datetime('now','localtime') WHERE project_id=?", [content, newVersion, Number(id)])
      : await window.electronAPI.db.run('INSERT INTO outlines (project_id,content,version) VALUES (?,?,?)', [Number(id), content, 1])
    setOutlineContent(content)
    setOutlineVersion(newVersion)
    showToast('success', `大纲已保存 (v${newVersion})`)
  }

  const saveVolumes = async (vols: Volume[]) => {
    if (!window.electronAPI) return
    await window.electronAPI.settings.set(`volumes_${id}`, JSON.stringify(vols))
    setVolumes(vols)
  }

  const saveChapterPlans = async (plans: ChapterPlan[]) => {
    if (!window.electronAPI) return
    const ex = await window.electronAPI.db.get('SELECT id FROM detailed_outlines WHERE project_id=?', [Number(id)])
    ex
      ? await window.electronAPI.db.run("UPDATE detailed_outlines SET chapters=?, updated_at=datetime('now','localtime') WHERE project_id=?", [JSON.stringify(plans), Number(id)])
      : await window.electronAPI.db.run('INSERT INTO detailed_outlines (project_id,chapters) VALUES (?,?)', [Number(id), JSON.stringify(plans)])
    setChapterPlans(plans)
  }

  /** 卷纲字段编辑 */
  const updateVolume = (volNum: number, field: string, value: string) => {
    const updated = volumes.map(v => v.volume_number === volNum ? { ...v, [field]: value, version: (v.version || 1) + 1 } : v)
    saveVolumes(updated)
  }

  /** 细纲字段编辑 */
  const updateChapterPlan = (chapNum: number, field: string, value: any) => {
    const updated = chapterPlans.map(p => p.chapter_number === chapNum ? { ...p, [field]: value, plan_version: (p.plan_version || 1) + 1 } : p)
    saveChapterPlans(updated)
  }

  const updateContext = async (chapNum: number, newContent: string) => {
    try {
      if (!window.electronAPI) return
      const ctx = await window.electronAPI.db.get('SELECT * FROM context_state WHERE project_id = ?', [Number(id)])
      const prevCharState = ctx?.character_state || '{}'
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: CONTEXT_UPDATE_SYSTEM },
        { role: 'user', content: CONTEXT_UPDATE_USER(prevCharState, plotSummary, newContent) },
      ], '上下文更新')
      const jm = reply.match(/\{[\s\S]*\}/)
      if (jm) {
        const p = JSON.parse(jm[0])
        const ncs = JSON.stringify(p.character_state || {})
        const nps = p.plot_summary || ''
        ctx
          ? await window.electronAPI.db.run("UPDATE context_state SET character_state=?, plot_summary=?, last_chapter=?, updated_at=datetime('now','localtime') WHERE project_id=?", [ncs, nps, chapNum, Number(id)])
          : await window.electronAPI.db.run('INSERT INTO context_state (project_id, character_state, plot_summary, last_chapter) VALUES (?,?,?,?)', [Number(id), ncs, nps, chapNum])
        setPlotSummary(nps)
      }
    } catch {}
  }

  // ========== 生成逻辑（层级依赖） ==========

  const getRefs = async () => {
    // 大纲/卷纲用：拆文库 + 设定库
    const disassemblyContext = buildDisassemblyContext(primaryDissId, auxDissIds, disassemblies)
    const settingLibContext = buildSettingContext(primarySettingLibId, auxSettingLibIds, settingLibraries)
    // 正文用：风格库 + 人格库
    const styleContext = buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries)
    const personalityContext = buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)
    // 从 canon_facts 读取硬规则
    let cardContext = ''
    try {
      const facts = await window.electronAPI!.db.query(
        "SELECT fact_category, fact_key, fact_value, details FROM canon_facts WHERE project_id = ? AND is_hard_rule = 1",
        [Number(id)]
      )
      if (facts.length > 0) {
        const chars = facts.filter((f: any) => f.fact_category === 'character')
        const settings = facts.filter((f: any) => f.fact_category === 'setting')
        const rules = facts.filter((f: any) => f.fact_category === 'rule')
        if (chars.length) cardContext += '【角色】\n' + chars.map((f: any) => `- ${f.fact_key}: ${f.fact_value}`).join('\n') + '\n'
        if (settings.length) cardContext += '【世界设定】\n' + settings.map((f: any) => `- ${f.fact_key}: ${f.fact_value}`).join('\n') + '\n'
        if (rules.length) cardContext += '【规则】\n' + rules.map((f: any) => `- ${f.fact_key}: ${f.fact_value}`).join('\n') + '\n'
      }
    } catch {}
    return { disassemblyContext, settingLibContext, styleContext, personalityContext, cardContext }
  }

  /** 弹出生成配置后生成 */
  const startGenWithConfig = (title: string, desc: string, callback: (config: any) => Promise<void>) => {
    showToast('info', '弹出选择窗口...')
    setGenConfig({ open: true, title, desc, onConfirm: async (c) => { setGenConfig(prev => ({ ...prev, open: false })); await callback(c) } })
  }

  /** 生成大纲 — 读：准备+风格+拆文 */
  // 生成面板显示状态
  const [showGenPanel, setShowGenPanel] = useState<'outline' | 'chapter' | 'volumes' | null>(null)
  const [genHint, setGenHint] = useState('')

  const genOutline = async (config?: any, hint?: string) => {
    if (!project || !window.electronAPI) return
    setShowGenPanel(null); setGenHint('')
    setGenerating(true); setGenTarget('大纲')
    try {
      const { disassemblyContext, settingLibContext } = config
        ? { disassemblyContext: buildDisassemblyContext(config.primaryDissId, config.auxDissIds, disassemblies),
            settingLibContext: buildSettingContext(config.primarySettingLibId, config.auxSettingLibIds, settingLibraries) }
        : await getRefs()
      const outlinePersonality = buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)
      let userPrompt = OUTLINE_USER(project.title, project.description, prepareContent, '', disassemblyContext, settingLibContext || undefined, outlinePersonality || undefined)
        + (hint ? `\n\n【作者额外提示】\n${hint}\n\n请根据以上提示调整大纲。` : '')
      cancelledRef.current = false
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: OUTLINE_SYSTEM },
        { role: 'user', content: userPrompt },
      ], '大纲生成')
      if (cancelledRef.current) return
      await saveOutline(reply)
      showToast('success', '大纲已生成')
      // 后台自动提取事实簿
      ;(async () => {
        try {
          const fm = [
            { role: 'system' as const, content: CANON_EXTRACTION_SYSTEM },
            { role: 'user' as const, content: CANON_EXTRACTION_USER(reply) },
          ]
          const cr = await window.electronAPI!.aiChat(fm, '事实簿提取')
          const clean = cr.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
          const jm = clean.match(/\[[\s\S]*\]/)
          if (jm) {
            const arr = JSON.parse(jm[0])
            await window.electronAPI!.db.run('DELETE FROM canon_facts WHERE project_id = ? AND source = ?', [Number(id), '大纲'])
            for (const f of arr) {
              const rl = f.fact_category === 'character' ? 50 : f.fact_category === 'event' ? 60 : f.fact_category === 'relationship' ? 40 : 30
              await window.electronAPI!.db.run(
                `INSERT INTO canon_facts (project_id,fact_category,fact_key,fact_value,is_hard_rule,source,established_chapter,revealed_level) VALUES (?,?,?,?,?,?,0,${rl})`,
                [Number(id), f.fact_category, f.fact_key, f.fact_value, f.is_hard_rule ? 1 : 0, '大纲']
              )
            }
          }
        } catch {}
      })()
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消生成')
      else showToast('error', '大纲生成失败：' + (e.message || '未知'))
    }
    finally { setGenerating(false); setGenTarget('') }
  }

  // 确认生成（使用当前选择的引用）
  const confirmGen = () => {
    if (showGenPanel === 'outline') genOutline({ primaryDissId, auxDissIds, primarySettingLibId, auxSettingLibIds }, genHint)
    else if (showGenPanel === 'volumes') genSingleVolume()
    else if (showGenPanel === 'chapter') genChapter(selectedChapter, { primaryStyleId, auxStyleIds, primaryPersonalityId, auxPersonalityIds }, genHint)
  }

  /** 生成单卷卷纲 — 读：大纲+前卷+风格+拆文 */
  const genSingleVolume = async () => {
    if (!outlineContent) { showToast('error', '请先生成大纲'); return }
    if (!window.electronAPI) return
    const total = chapterPlans.length || 40
    const nextVolNum = volumes.length + 1
    setGenerating(true)
    try {
      const { disassemblyContext, settingLibContext, cardContext } = await getRefs()
      let enrichedOutline = outlineContent
      if (disassemblyContext) enrichedOutline += '\n\n【📚 拆文库学习】\n' + disassemblyContext
      if (settingLibContext) enrichedOutline += '\n\n【📋 设定库参考】\n' + settingLibContext
      if (cardContext) enrichedOutline += '\n\n【📖 角色与世界设定】\n' + cardContext.slice(0, 1500)

      // 前一卷的上下文
      let prevVolContext = '', prevChapterPlansStr = ''
      const prevVol = volumes.length > 0 ? volumes[volumes.length - 1] : null
      if (prevVol) {
        prevVolContext = `第${prevVol.volume_number}卷《${prevVol.title}》\n主题：${prevVol.theme}\n${prevVol.detailed_summary || prevVol.summary}`
        const prevPlans = chapterPlans.filter(p => p.chapter_number >= prevVol.chapter_range[0] && p.chapter_number <= prevVol.chapter_range[1])
        if (prevPlans.length) {
          prevChapterPlansStr = prevPlans.map(p => `第${p.chapter_number}章 ${p.title}: ${p.summary}`).join('\n')
        }
      }

      // 查询1: 事实簿硬规则
      let canonFactsContext = ''
      try {
        const hardFacts = await window.electronAPI!.db.query(
          "SELECT fact_category, fact_key, fact_value FROM canon_facts WHERE project_id = ? AND is_hard_rule = 1",
          [Number(id)]
        )
        if (hardFacts.length > 0) {
          canonFactsContext = hardFacts.map((f: any) =>
            `- [${f.fact_category}] ${f.fact_key}: ${f.fact_value}`
          ).join('\n')
        }
      } catch { /* canon_facts 表可能为空 */ }

      // 查询2: 伏笔注册表状态
      let foreshadowingStatus = ''
      try {
        const fsItems = await window.electronAPI!.db.query(
          `SELECT foreshadow_id, description, status, priority, planted_chapter, target_chapter
           FROM foreshadowing_registry
           WHERE project_id = ? AND status IN ('pending','active')
           ORDER BY priority DESC, target_chapter ASC`,
          [Number(id)]
        )
        if (fsItems.length > 0) {
          const statusLabels: Record<string, string> = { pending: '待埋', active: '已埋' }
          const statusLines = fsItems.map((f: any) =>
            `- [${statusLabels[f.status] || f.status}|${f.priority}] ${f.foreshadow_id}: ${f.description} (目标第${f.target_chapter || '?'}章)`
          )
          foreshadowingStatus = `共 ${fsItems.length} 个活跃伏笔：\n${statusLines.join('\n')}`
        }
      } catch { /* foreshadowing_registry 表可能为空 */ }

      // 查询3: 前卷各章实际执行结果（来自记录官摘要）
      let prevVolOutcomes = ''
      if (prevVol) {
        try {
          const prevSummaries = await window.electronAPI!.db.query(
            `SELECT chapter_number, summary, key_events FROM chapter_summaries
             WHERE project_id = ? AND chapter_number >= ? AND chapter_number <= ?
             ORDER BY chapter_number`,
            [Number(id), prevVol.chapter_range[0], prevVol.chapter_range[1]]
          )
          if (prevSummaries.length > 0) {
            prevVolOutcomes = prevSummaries.map((s: any) => {
              const events = typeof s.key_events === 'string' ? JSON.parse(s.key_events || '[]') : (s.key_events || [])
              return `第${s.chapter_number}章: ${s.summary || '(无摘要)'} | 关键事件: ${Array.isArray(events) ? events.join('、') : events}`
            }).join('\n')
          }
        } catch { /* chapter_summaries 可能尚无数据 */ }
      }

      // 查询4: 时间线当前位置
      let timelineContext: { current_day: number } | undefined
      try {
        const dayRow = await window.electronAPI!.db.get(
          "SELECT MAX(absolute_day) as max_day FROM story_timeline WHERE project_id = ?",
          [Number(id)]
        )
        if (dayRow && dayRow.max_day != null) {
          timelineContext = { current_day: dayRow.max_day }
        }
      } catch { /* story_timeline 可能为空 */ }

      cancelledRef.current = false
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: VOLUME_OUTLINE_SYSTEM },
        { role: 'user', content: VOLUME_OUTLINE_USER(
          enrichedOutline, total, nextVolNum, prevVolContext, prevChapterPlansStr,
          canonFactsContext, foreshadowingStatus, prevVolOutcomes, timelineContext
        ) },
      ], '卷纲生成')
      if (cancelledRef.current) return

      // 去掉 markdown 代码块标记
      let text = reply
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/^[\s\n]*json[\s\n]*/i, '')
        .trim()
      // 从第一个 { 到最后一个 } 提取
      const firstBrace = text.indexOf('{')
      const lastBrace = text.lastIndexOf('}')
      let jsonStr = ''
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonStr = text.slice(firstBrace, lastBrace + 1)
      } else {
        // 尝试数组
        const firstBracket = text.indexOf('[')
        const lastBracket = text.lastIndexOf(']')
        if (firstBracket >= 0 && lastBracket > firstBracket) {
          jsonStr = text.slice(firstBracket, lastBracket + 1)
        }
      }
      if (!jsonStr) {
        console.error('VOLUME PARSE FAILED. Text length:', reply.length, 'Preview:', reply.slice(0, 300))
        showToast('error', `卷纲格式异常（返回${reply.length}字符，无JSON）。请重试。`)
        return
      }
      let vol: any
      try { vol = JSON.parse(jsonStr) } catch {
        try { vol = JSON.parse(jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/[\x00-\x1f]/g, ' ')) } catch {}
      }
      if (!vol) { showToast('error', '卷纲格式异常，请重试'); return }
      const newVol: Volume = {
        volume_number: nextVolNum,
        title: vol.title || `第${nextVolNum}卷`,
        summary: vol.detailed_summary || vol.summary || '',
        chapter_range: vol.chapter_range || [prevVol ? prevVol.chapter_range[1] + 1 : 1, prevVol ? prevVol.chapter_range[1] + 10 : 10],
        theme: vol.theme || '',
        key_events: [],
        detailed_summary: vol.detailed_summary || vol.summary,
        character_arcs: vol.character_arcs,
        key_events_str: vol.key_events_str,
        emotional_curve: vol.emotional_curve,
        foreshadowing: vol.foreshadowing,
        // v1.7.0 卷纲优化新增字段
        word_count_target: vol.word_count_target,
        connection_prev: vol.connection_prev,
        connection_next: vol.connection_next,
        pacing_design: vol.pacing_design,
        emotional_cadence: vol.emotional_cadence,
        foreshadowing_plant: vol.foreshadowing_plant,
        foreshadowing_payoff: vol.foreshadowing_payoff,
        foreshadowing_advance: vol.foreshadowing_advance,
        character_milestones: vol.character_milestones,
        conflict_nodes: vol.conflict_nodes,
        nodes: vol.nodes,
        cool_density: vol.cool_density,
        golden_five: vol.golden_five,
        timeline_context: vol.timeline_context,
        outline_version: outlineVersion,
        version: 1,
      }
      const newVols = [...volumes, newVol]
      await saveVolumes(newVols)

      // 后台自动提取卷纲中的新设定到 canon_facts
      ;(async () => {
        try {
          const volText = JSON.stringify(newVol)
          const fm = [
            { role: 'system' as const, content: '从卷纲JSON中提取所有角色名和世界观设定名。只输出JSON数组：[{"fact_key":"名称","fact_category":"character|setting","fact_value":"描述"}]。不要任何其他文字。' },
            { role: 'user' as const, content: volText },
          ]
          const cr = await window.electronAPI!.aiChat(fm, '卷纲事实提取')
          const jm2 = cr.match(/\[[\s\S]*\]/)
          if (jm2) {
            const arr = JSON.parse(jm2[0])
            for (const f of arr) {
              if (!f.fact_key) continue
              const cat = f.fact_category || 'character'
              const rl = cat === 'character' ? 50 : 30
              await window.electronAPI!.db.run(
                `INSERT OR IGNORE INTO canon_facts (project_id,fact_category,fact_key,fact_value,is_hard_rule,source,established_chapter,revealed_level) VALUES (?,?,?,?,?,?,0,${rl})`,
                [Number(id), cat, f.fact_key, (f.fact_value || '').slice(0, 200), 0, '卷纲生成']
              )
            }
          }
        } catch { /* non-blocking */ }
      })()

      // 将卷纲规划的伏笔写入 foreshadowing_registry
      if (vol.foreshadowing_plant && vol.foreshadowing_plant.length > 0) {
        try {
          for (let fi = 0; fi < vol.foreshadowing_plant.length; fi++) {
            const fDesc = typeof vol.foreshadowing_plant[fi] === 'string'
              ? vol.foreshadowing_plant[fi]
              : vol.foreshadowing_plant[fi]?.desc || vol.foreshadowing_plant[fi]?.description || String(vol.foreshadowing_plant[fi])
            const fId = `V${nextVolNum}-${fi + 1}`
            await window.electronAPI!.db.run(
              `INSERT OR IGNORE INTO foreshadowing_registry (project_id, foreshadow_id, description, status, priority, planted_chapter, target_chapter)
               VALUES (?, ?, ?, 'pending', 'normal', ?, ?)`,
              [Number(id), fId, fDesc, vol.chapter_range?.[0] || null, vol.chapter_range?.[1] || null]
            )
          }
        } catch { /* 伏笔入库失败不阻塞 */ }
      }

      showToast('success', `第${nextVolNum}卷《${newVol.title}》已生成`)
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消生成')
      else showToast('error', '卷纲生成失败：' + (e.message || '未知'))
    } finally { setGenerating(false) }
  }

  /** 生成某一章的细纲 — 读：大纲+所在卷纲+上一章细纲(如有)+风格+拆文 */
  const genSingleChapterPlan = async (chapNum: number) => {
    if (!outlineContent) { showToast('error', '请先生成大纲'); return }
    if (!window.electronAPI) return
    const vol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
    if (!vol) { showToast('error', `第${chapNum}章不属于任何卷，请先调整卷纲`); return }

    setGenerating(true)
    cancelledRef.current = false
    try {
      const { styleContext, disassemblyContext } = await getRefs()
      const isFirstChapterInBook = chapNum === 1
      const isFirstChapterInVol = chapNum === vol.chapter_range[0]

      // 上一章细纲 + 上一章正文结尾（非全书第一章时读取）
      const prevPlan = isFirstChapterInBook ? null : chapterPlans.find(p => p.chapter_number === chapNum - 1)
      const prevChapter = isFirstChapterInBook ? null : chapters.find(c => c.chapter_number === chapNum - 1)

      const volContext = `【所在卷】第${vol.volume_number}卷《${vol.title}》
概要：${vol.summary} | 主题：${vol.theme}
章节范围：第${vol.chapter_range[0]}-${vol.chapter_range[1]}章`

      // 找到章节所在的节点，注入节点级约束
      let nodeContext = ''
      const volNodes = (vol as any).nodes || []
      if (volNodes.length > 0) {
        const curNode = volNodes.find((n: any) => {
          const seg = n.chapter_segment || ''
          const m = seg.match(/第?(\d+)[-–—至到]第?(\d+)/)
          if (m) return chapNum >= parseInt(m[1]) && chapNum <= parseInt(m[2])
          return false
        })
        if (curNode) {
          nodeContext = `\n【当前节点：${curNode.name}（${curNode.chapter_segment}）】
节点任务：${curNode.task}
节点内容：${curNode.content || '（无）'}
节奏：${curNode.pacing || '中'}`
          if (curNode.node_forbidden) nodeContext += `\n⛔ 节点禁区：${curNode.node_forbidden}`
          if (curNode.emotion_limit) nodeContext += `\n💕 感情限制：${curNode.emotion_limit}`
          if (curNode.info_quota) nodeContext += `\n🔐 信息配额：${curNode.info_quota}`
        }
      }

      const prevContentExcerpt = prevChapter?.content
        ? `\n【上一章正文结尾（${prevChapter.content.length}字）】\n${prevChapter.content.slice(-400)}\n（确保本章起点和上章结尾衔接）`
        : ''

      // 上一章的情节点序列用于因果衔接
      const prevBeatsContext = prevPlan?.plot_beats?.length
        ? `\n【上一章情节点序列（最后3条）】\n${prevPlan.plot_beats.slice(-3).map((b, i) => `${prevPlan.plot_beats!.length - 3 + i + 1}. ${b}`).join('\n')}`
        : prevPlan?.key_events?.length
          ? `\n【上一章关键事件】${prevPlan.key_events.join('；')}`
          : ''

      const prevContext = isFirstChapterInBook
        ? '（全书第一章，无前章）'
        : isFirstChapterInVol
          ? `（本卷第一章，请基于大纲和卷纲直接设计开篇，不需要依赖前一章细纲）${prevContentExcerpt}`
          : prevPlan
            ? `【上一章】第${prevPlan.chapter_number}章 ${prevPlan.title}${prevBeatsContext}${prevContentExcerpt}`
            : `（上一章细纲尚未生成，请基于大纲和卷纲独立设计本章）${prevContentExcerpt}`

      const promptParts = [
        outlineContent.slice(0, 3000),
        volContext,
        nodeContext,
        prevContext,
        styleContext ? '【风格】\n' + styleContext : '',
        disassemblyContext ? '【拆文】\n' + disassemblyContext.slice(0, 1000) : '',
      ].filter(Boolean)

      const chapterTypeHint = isFirstChapterInBook
        ? '这是全书第一章（黄金首章），需要：强力钩子+快速建立主角+展示核心冲突。'
        : isFirstChapterInVol
          ? '这是新一卷的开篇章节，需要：新卷氛围建立+承上启下的过渡+保持读者期待。'
          : '请基于上一章情节点序列的结尾，连贯设计本章的情节点，确保因果衔接。'

      const reply = await window.electronAPI.aiChat([
        {
          role: 'system',
          content: `你是章节细纲规划师。只规划第 ${chapNum} 章。${chapterTypeHint}

## 情节点序列（plot_beats）是核心
输出 8-15 条情节点，每条是一个具体的、可被 AI 直接写出来的动作或事件。
- 因果关系链：上一条触发下一条，不跳跃
- 具体：写"凌瑶在旧代码堆中找到一扇代码门——凌寒山写的"，不写"两人找到了入口"
- 时序明确：情节点按时间顺序排列

## 钩子设计
- opening_hook：如何在前100字抓住读者。type: 倒计时式|悬念式|动作式|对话式|场景反转式
- closing_hook：如何让读者想翻下一章。type: 空间转换式|信息揭秘式|情绪悬念式|动作中断式。impact: 强|中|弱

## 情绪弧线（emotional_arc）
情绪在章节内的变化轨迹。格式：起始情绪→中间转折→章尾情绪（如"紧张→刺激→敬畏"）

## 约束与禁区（这是最重要的字段）
- **forbidden**：本章绝对禁止出现的剧情内容（3-5条）。告诉AI"只能写到这里，不能碰这些"。格式："禁止：XXX在本章被揭露/确认/出现"
- **scene_count**：本章场景数（2-4个）
- **max_info_reveal**：本章允许推进的最大信息量（如"世界观公开度从15%→20%，禁止超过25%"）
- **emotion_cap**：感情线数值上限（如"阶段2/10，本章最多到2.5，禁止肢体接触/表白"）

## 输出 JSON 对象
{ "chapter_number": ${chapNum}, "title": "标题5-15字", "core_event": "核心事件一句话", "plot_beats": ["情节点", ...], "emotional_arc": "情绪A→情绪B→情绪C", "opening_hook": {"type":"倒计时式","detail":"..."}, "closing_hook": {"type":"空间转换式","impact":"强"}, "forbidden": ["禁止揭露XX","禁止引入XX"], "scene_count": 3, "max_info_reveal": "世界观公开度从15%→20%", "emotion_cap": "感情阶段2/10，本章最多到2.5", "estimated_words": 3000 }
输出严格的JSON对象，不要数组，不要markdown代码块。`
        },
        { role: 'user', content: promptParts.join('\n\n') + `\n\n请输出第 ${chapNum} 章的细纲JSON对象。` },
      ], `细纲-第${chapNum}章`)

      if (cancelledRef.current) return
      let newPlan: ChapterPlan
      try {
        const jm = reply.match(/\{[\s\S]*\}/)
        newPlan = JSON.parse(jm ? jm[0] : reply)
      } catch {
        newPlan = {
          chapter_number: chapNum,
          title: `第${chapNum}章`,
          core_event: reply.slice(0, 100),
          plot_beats: [],
          emotional_arc: '',
          estimated_words: 3000,
        }
      }
      newPlan.chapter_number = chapNum
      newPlan.volume_version = (volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1]) || {} as any).version || 1
      newPlan.plan_version = 1

      // 从 DB 读取最新细纲（避免循环中闭包 state 过期导致覆盖）
      let latestPlans: ChapterPlan[] = chapterPlans
      try {
        const dbRow = await window.electronAPI!.db.get('SELECT chapters FROM detailed_outlines WHERE project_id=?', [Number(id)])
        if (dbRow?.chapters) { const parsed = JSON.parse(dbRow.chapters); if (Array.isArray(parsed)) latestPlans = parsed }
      } catch {}
      const merged = latestPlans.filter(p => p.chapter_number !== chapNum)
      merged.push(newPlan)
      merged.sort((a, b) => a.chapter_number - b.chapter_number)
      await saveChapterPlans(merged)
      showToast('success', `第${chapNum}章细纲已生成：${newPlan.title}`)
    } catch (e: any) {
      if (cancelledRef.current) { showToast('info', '已取消生成'); throw e }
      else showToast('error', `第${chapNum}章细纲生成失败：${e.message || '未知错误'}`)
    } finally {
      setGenerating(false)
    }
  }

  /** 生成某一章正文 — 流式输出 + 卡片上下文 + 自动摘要 */
  const genChapter = async (chapNum: number, config?: any, hint?: string) => {
    if (!project || !window.electronAPI) return
    const plan = chapterPlans.find(p => p.chapter_number === chapNum)
    if (!plan) { showToast('error', '该章尚无细纲，请先生成对应卷的细纲'); return }

    setShowGenPanel(null); setGenHint('')
    setGenerating(true); setGenTarget(`第${chapNum}章`)
    setStreamingText('')

    try {
      const { styleContext, personalityContext } = config
        ? { styleContext: buildStyleContext(config.primaryStyleId, config.auxStyleIds, styleLibraries),
            personalityContext: buildPersonalityContext(config.primaryPersonalityId, config.auxPersonalityIds, personalityProjects) }
        : (await getRefs())

      // 找所在卷
      const vol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
      const volContext = vol ? `【所在卷】第${vol.volume_number}卷《${vol.title}》\n概要：${vol.summary}\n主题：${vol.theme}` : ''

      // 上一章
      const prevCh = chapters.find(c => c.chapter_number === chapNum - 1)
      const prevExcerpt = prevCh?.content?.slice(-800) || ''

      // 前一章摘要（记录官）
      let prevSummaryContext = ''
      try {
        const prevSummary = await window.electronAPI.db.get('SELECT summary FROM chapter_summaries WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum - 1])
        if (prevSummary?.summary) prevSummaryContext = `\n\n【前一章摘要（记录官）】\n${prevSummary.summary}`
      } catch {}

      // 事实簿（硬规则注入）
      let canonFactsContext = ''
      let infoPermissionContext = ''
      try {
        const hardFacts = await window.electronAPI.db.query(
          'SELECT fact_category, fact_key, fact_value FROM canon_facts WHERE project_id = ? AND is_hard_rule = 1',
          [Number(id)]
        )
        if (hardFacts.length > 0) {
          canonFactsContext = hardFacts.map((f: any) =>
            `- [${f.fact_category}] ${f.fact_key}: ${f.fact_value}`
          ).join('\n')
        }
        // 公开度分级注入
        const allFactsWithLevel = await window.electronAPI.db.query(
          'SELECT fact_key, fact_value, fact_category, revealed_level, dependencies FROM canon_facts WHERE project_id = ? AND revealed_level < 100',
          [Number(id)]
        )
        if (allFactsWithLevel.length > 0) {
          const forbidden: string[] = []   // revealed_level = 0 的完全禁止
          const limited: string[] = []     // revealed_level < 50 的部分限制
          for (const f of allFactsWithLevel) {
            const lv = f.revealed_level || 0
            const deps = (() => { try { return JSON.parse(f.dependencies || '[]') } catch { return [] } })()
            if (lv === 0) {
              forbidden.push(`禁止揭示：${f.fact_key}（${f.fact_value}）`)
            } else if (lv < 50) {
              limited.push(`${f.fact_key}（公开度${lv}%，可适度推进但禁止完全揭示）`)
            }
          }
          if (forbidden.length + limited.length > 0) {
            infoPermissionContext = '【🔐 信息权限——以下设定尚未公开或仅部分公开】\n'
            if (forbidden.length) infoPermissionContext += '⛔ 完全未公开（本章禁止揭示）：\n' + forbidden.map(s => `  ${s}`).join('\n') + '\n'
            if (limited.length) infoPermissionContext += '⚠️ 部分公开（可推进但禁止完全揭示）：\n' + limited.map(s => `  ${s}`).join('\n')
          }
        }
      } catch {}

      // 从 canon_facts 读取设定（供一致性检查和上下文注入共用）
      let allFacts: any[] = []
      try {
        allFacts = await window.electronAPI!.db.query(
          'SELECT fact_category, fact_key, fact_value, details FROM canon_facts WHERE project_id = ?',
          [Number(id)]
        )
      } catch {}

      // 生成前一致性检查清单
      let consistencyChecklist = ''
      let timelineCheck = ''; let stateContext = ''; let stateDrift = 0.03
      let narrativeMode: ReturnType<typeof selectMode> = 'stable'
      try {
        const checklist: string[] = []
        const urgentFS = await window.electronAPI.db.query(
          `SELECT foreshadow_id, description, target_chapter FROM foreshadowing_registry
           WHERE project_id = ? AND status = 'active' AND target_chapter <= ?`,
          [Number(id), chapNum + 3]
        )
        if (urgentFS.length > 0) {
          checklist.push('【🪝 伏笔预警 — 近期需回收】')
          urgentFS.forEach((f: any) => checklist.push(`- ${f.foreshadow_id}: ${f.description} (目标第${f.target_chapter}章)`))
        }
        const summaryRows = await window.electronAPI.db.query(
          `SELECT characters_appeared FROM chapter_summaries WHERE project_id = ? AND chapter_number >= ? ORDER BY chapter_number DESC`,
          [Number(id), Math.max(1, chapNum - 10)]
        )
        if (summaryRows.length > 0) {
          const mainChars = allFacts.filter((f: any) => f.fact_category === 'character').map((f: any) => {
            let d: any = {}
            try { d = JSON.parse(f.details || '{}') } catch {}
            return { name: f.fact_key, role_type: d.role_type || 'support' }
          }).filter((c: any) => c.role_type === 'main')
          for (const mc of mainChars) {
            let lastApp = 0
            for (const sr of summaryRows) {
              const appeared: string[] = typeof sr.characters_appeared === 'string'
                ? JSON.parse(sr.characters_appeared || '[]') : (sr.characters_appeared || [])
              if (appeared.includes(mc.name)) { lastApp = chapNum; break }
            }
            if (lastApp > 0 && chapNum - lastApp >= 10) {
              checklist.push(`⚠ 主角「${mc.name}」已缺席 ${chapNum - lastApp} 章`)
            }
          }
        }
        // 时间线上下文 + 叙事状态聚合
        let dayRow: any = null
        try {
          dayRow = await window.electronAPI.db.get(
            "SELECT MAX(absolute_day) as cur_day, timeline_id FROM story_timeline WHERE project_id = ? GROUP BY timeline_id ORDER BY timeline_id",
            [Number(id)]
          )
          if (dayRow) {
            timelineCheck = `【⏱ 时间线上下文】当前主线第${dayRow.cur_day || 0}天。如果本章包含闪回/并行时间线，切换时用明确的时间标记（如"三年前""同一时刻，XX城"），闪回段不超过500字。`
          }
          // 叙事状态聚合
          const rlRows = await window.electronAPI.db.query(
            "SELECT fact_key, revealed_level FROM canon_facts WHERE project_id = ? AND revealed_level IS NOT NULL",
            [Number(id)]
          )
          const vol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
          const es = (vol as any)?.emotion_stage
          const currentDay = parseInt(dayRow?.cur_day || '0')
          // v2.3: 冲突 + 漂移数据
          let activeConflicts = 0; let speculativeCount = 0; let avgStability = 0.5
          let conflictItems: any[] = []
          try {
            conflictItems = await window.electronAPI!.db.query(
              "SELECT * FROM conflict_facts WHERE project_id = ? AND resolution_status IN ('unresolved','permanent')",
              [Number(id)]
            )
            activeConflicts = conflictItems.length
            const allFacts = await window.electronAPI!.db.query(
              "SELECT details FROM canon_facts WHERE project_id = ? AND details IS NOT NULL AND details != ''",
              [Number(id)]
            )
            let tvSum = 0; let tvCount = 0
            for (const f of allFacts) {
              let d: any = {}
              try { d = JSON.parse(f.details || '{}') } catch {}
              if (typeof d.truth_value === 'number') { tvSum += d.truth_value; tvCount++ }
              if (d.truth_value < 0.4) speculativeCount++
            }
            avgStability = tvCount > 0 ? tvSum / tvCount : 0.5
          } catch { /* advisory */ }
          stateDrift = computeStateDrift(activeConflicts, speculativeCount, avgStability)

          // v2.5: 叙事模式选择
          const curVol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
          const totalInVol = curVol ? curVol.chapter_range[1] - curVol.chapter_range[0] + 1 : 1
          const chapterInVol = curVol ? chapNum - curVol.chapter_range[0] + 1 : 1
          narrativeMode = selectMode(chapterInVol, totalInVol, activeConflicts, stateDrift)
          const effectiveDrift = stateDrift + modeDriftBonus(narrativeMode)

          stateContext = buildStateContext(
            rlRows, es, currentDay,
            plan.allowed_reveal, plan.emotion_cap,
            conflictItems.map((c: any) => ({ a: c.fact_a_text, b: c.fact_b_text, type: c.conflict_type, status: c.resolution_status })),
            effectiveDrift, speculativeCount, avgStability,
            narrativeMode,
          )
        } catch {}

        if (checklist.length > 0) {
          consistencyChecklist = '⚠️ 生成前一致性检查清单（请逐条确认本章不违反）：\n' + checklist.join('\n')
          consistencyChecklist = '⚠️ 生成前一致性检查清单（请逐条确认本章不违反）：\n' + checklist.join('\n')
        }
        if (timelineCheck) consistencyChecklist = (consistencyChecklist ? consistencyChecklist + '\n\n' : '') + timelineCheck
      } catch {}

      const planAny = plan as any
      let userPrompt = (stateContext ? stateContext + '\n\n' : '') + CHAPTER_USER(
        project.title, prepareContent.slice(0, 500), chapNum, plan.title,
        plan.summary || '', plan.characters || [], plan.key_events || [], plan.estimated_words || 3000,
        planAny.emotional_goal || planAny.emotional_arc || '', planAny.function || '', planAny.ending_type || '自然收尾',
        styleContext, plotSummary, prevExcerpt,
        (volContext + '\n\n' + prevSummaryContext),
        canonFactsContext, personalityContext,
        plan.plot_beats, plan.emotional_arc, plan.cool_moment,
        plan.forbidden, plan.scene_count, plan.max_info_reveal, plan.emotion_cap
      ) + (hint ? '\n\n【作者额外提示】\n' + hint : '')
        + (consistencyChecklist ? '\n\n' + consistencyChecklist : '')

      // 注入智能上下文（按热度分级）
      try {
        const recentText = chapters.slice(-3).map(c => c.content).join('\n').slice(-3000)
        const allChars = allFacts.filter((f: any) => f.fact_category === 'character').map((f: any) => {
          let d: any = {}
          try { d = JSON.parse(f.details || '{}') } catch {}
          return { name: f.fact_key, role_type: d.role_type || 'support', personality: f.fact_value, status_tracking: d.status_tracking || {}, abilities: d.abilities || '' }
        })
        const allWorlds = allFacts.filter((f: any) => f.fact_category === 'setting' || f.fact_category === 'rule').map((f: any) => {
          let d: any = {}
          try { d = JSON.parse(f.details || '{}') } catch {}
          return { name: f.fact_key, description: f.fact_value, is_global: d.is_global ? 1 : 0, trigger_keywords: d.trigger_keywords || '' }
        })
        const { charContext: mcChar, worldContext: mcWorld, tokenEstimate: mcTokens } = buildMinimalContext(
          chapNum, plan.characters || [], allChars, allWorlds, recentText
        )
        let ctxParts: string[] = []
        if (mcChar) ctxParts.push(`【👤 角色上下文】\n${mcChar}`)
        if (mcWorld) ctxParts.push(`【🌍 世界设定】\n${mcWorld}`)
        if (ctxParts.length > 0) {
          userPrompt += `\n\n${ctxParts.join('\n\n')}`
        }
        setBudgetInfo({ charTokens: mcTokens, totalChars: userPrompt.length })
      } catch {}

      // 使用流式 API
      let fullText = ''
      cancelledRef.current = false
      const cleanup = window.electronAPI.onStreamChunk((data) => {
        if (data.error) {
          cancelledRef.current = true
          setGenerating(false); setStreamingText(''); setGenTarget('')
          return
        }
        if (!data.done && data.chunk) {
          fullText += data.chunk
          setStreamingText(fullText)
        }
      })

      const reply = await window.electronAPI.aiChatStream([
        { role: 'system', content: CHAPTER_SYSTEM },
        { role: 'user', content: userPrompt },
      ], '章节生成')

      cleanup()

      if (cancelledRef.current) {
        showToast('info', '已取消生成')
        return
      }

      const finalText = reply || fullText
      setEditingContent(finalText)
      setStreamingText('')
      setGenerating(false)
      setGenTarget('')
      await saveChapter(chapNum, plan.title, finalText)
      await updateContext(chapNum, finalText)
      showToast('success', `第${chapNum}章生成完成`)

      // ── v2.2 记录官 + 事件提取器 + Checker(含语义泄露评分) + 语义快照重写 + State 统一写入 ──
      ;(async () => {
        const pid = Number(id)
        const currentChapterText = finalText
        try {
          // 1. 并行调用：记录官（人类可读摘要+伏笔+ai_concerns）+ 事件提取器（结构化事件）
          const [summaryReply, eventReply] = await Promise.all([
            window.electronAPI!.aiChat([
              { role: 'system', content: CHAPTER_SUMMARY_SYSTEM },
              { role: 'user', content: CHAPTER_SUMMARY_USER(chapNum, plan.title, currentChapterText, outlineContent) },
            ], '章节摘要'),
            window.electronAPI!.aiChat([
              { role: 'system', content: EVENT_EXTRACTION_SYSTEM },
              { role: 'user', content: EVENT_EXTRACTION_USER(chapNum, plan.title, currentChapterText, outlineContent, plan.characters || []) },
            ], '事件提取'),
          ])

          let s: any = null
          const sjm = summaryReply.match(/\{[\s\S]*\}/)
          if (sjm) s = JSON.parse(sjm[0])

          let extractedEvents: any = null
          const ejm = eventReply.match(/\{[\s\S]*\}/)
          if (ejm) extractedEvents = JSON.parse(ejm[0])

          // 2. 获取时间线历史和 facts（供 checker 和 snapshot 使用）
          let timelineHistory: any[] = []
          let allFacts: any[] = []
          let currentAbsoluteDay: number | null = null
          try {
            const [th, af, dayRow] = await Promise.all([
              window.electronAPI!.db.query('SELECT * FROM story_timeline WHERE project_id = ? ORDER BY absolute_day ASC', [pid]),
              window.electronAPI!.db.query('SELECT * FROM canon_facts WHERE project_id = ?', [pid]),
              window.electronAPI!.db.get('SELECT MAX(absolute_day) as d FROM story_timeline WHERE project_id = ?', [pid]),
            ])
            timelineHistory = th; allFacts = af
            currentAbsoluteDay = dayRow?.d || null
          } catch { /* advisory */ }

          // 3. Checker（① deterministic + ② structural + ③ semantic leak scorer, projectId for calibration）
          const checkResult = checkChapter(
            currentChapterText, plan, allFacts, timelineHistory,
            currentAbsoluteDay, pid,
            undefined, undefined, stateDrift, narrativeMode,
          )

          // 4. 收集 AI concerns（记录官的 ai_concerns + leak score elevated）
          if (s?.ai_concerns && Array.isArray(s.ai_concerns) && s.ai_concerns.length > 0) {
            checkResult.concerns = [...checkResult.concerns, ...s.ai_concerns]
          }

          // 4.5. 存储 checker/event 数据到 state（供 ReviewPanel 控制台消费）
          setLastCheckResult(checkResult)
          if (checkResult.leakScore) setLastLeakScore(checkResult.leakScore)
          if (extractedEvents?.events) setLastEventData(extractedEvents as EventExtractionResult)
          setCalibrationStats(getCalibrationStats(pid))

          // 5. 构建角色名列表（供语义快照使用）
          const charNames = allFacts
            .filter((f: any) => f.fact_category === 'character')
            .map((f: any) => f.fact_key)

          // 6. Rewrite Loop（熔断 + 语义 diff）
          let activeText = currentChapterText
          let rewriteCount = 0
          const { maxRetries, entropyLimit } = DEFAULT_REWRITE_LIMIT

          // 建立语义快照（首次 rewrite 前）
          let snapshot = takeSnapshot(activeText, chapNum, charNames)

          while (checkResult.hardViolationCount > 0 && rewriteCount <= maxRetries) {
            if (cancelledRef.current) break

            if (rewriteCount >= maxRetries) {
              const marks = checkResult.violations
                .filter(v => v.source !== 'ai_suggestion')
                .map(v => `<!-- ⚠ 约束未解决：${v.type} — ${v.detail} -->`)
                .join('\n')
              activeText = marks + '\n' + activeText
              showToast('info', `约束重写${maxRetries}次仍未解决，已标记违规段落供人工处理`)
              break
            }

            showToast('info', `硬约束违规 ${checkResult.hardViolationCount} 处，自动重写 (${rewriteCount + 1}/${maxRetries})...`)

            try {
              const rewritePrompt = buildRewritePrompt(activeText, checkResult.violations, snapshot)
              const rewriteMsg = [
                { role: 'system' as const, content: '你是小说修改助手。按指令精准修改文本，只改违规部分。' },
                { role: 'user' as const, content: `原文：\n${activeText.slice(0, 6000)}\n\n${rewritePrompt}` },
              ]
              const rewritten = await window.electronAPI!.aiChat(rewriteMsg, '违规重写')

              if (!rewritten || cancelledRef.current) break

              // AI 返回与原文相同——跳过无效重写
              if (rewritten.trim() === activeText.trim()) {
                showToast('info', 'AI 重写未修改文本，跳过')
                break
              }

              // 语义 diff：检测重写是否改变了不该变的段落
              const diff = diffSnapshot(snapshot, rewritten, charNames)
              if (!diff.isStable || diff.semanticChangeRatio > 0.35) {
                const marks = checkResult.violations
                  .filter(v => v.source !== 'ai_suggestion')
                  .map(v => `<!-- ⚠ 约束未解决：${v.type} — ${v.detail} -->`)
                  .join('\n')
                activeText = marks + '\n' + activeText
                showToast('info', `重写语义漂移过大（${Math.round(diff.semanticChangeRatio * 100)}%），保留原文并标记`)
                break
              }

              // 传统 infoLoss 检查（与语义 diff 互补）
              const infoLoss = calcInfoLoss(activeText, rewritten)
              if (infoLoss > entropyLimit) {
                const marks = checkResult.violations
                  .filter(v => v.source !== 'ai_suggestion')
                  .map(v => `<!-- ⚠ 约束未解决：${v.type} — ${v.detail} -->`)
                  .join('\n')
                activeText = marks + '\n' + activeText
                showToast('info', `重写信息损失 ${Math.round(infoLoss * 100)}% 超限，保留原文并标记`)
                break
              }

              // 重写后复查
              const reCheck = checkChapter(
                rewritten, plan, allFacts, timelineHistory,
                currentAbsoluteDay, pid,
                undefined, undefined, stateDrift, narrativeMode,
              )
              if (reCheck.hardViolationCount === 0) {
                activeText = rewritten
                snapshot = takeSnapshot(rewritten, chapNum, charNames) // 更新快照
                setEditingContent(rewritten)
                await saveChapter(chapNum, plan.title, rewritten)
                showToast('success', '违规已修复，已保存重写版本')
                break
              }

              activeText = rewritten
              snapshot = takeSnapshot(rewritten, chapNum, charNames)
              checkResult.violations = reCheck.violations
              checkResult.hardViolationCount = reCheck.hardViolationCount
              if (reCheck.leakScore) checkResult.leakScore = reCheck.leakScore
              rewriteCount++
            } catch {
              showToast('info', '重写调用失败，保留原文')
              break
            }
          }

          if (rewriteCount > 0 && checkResult.hardViolationCount === 0) {
            setEditingContent(activeText)
            await saveChapter(chapNum, plan.title, activeText)
          }

          // 7. 从事件提取器 + 记录官伏笔数据构建 StatePatch（事件驱动，非 LLM 总结驱动）
          try {
            const planted: any[] = Array.isArray(s?.foreshadowing_planted) ? s.foreshadowing_planted : []
            const recovered: any[] = Array.isArray(s?.foreshadowing_recovered) ? s.foreshadowing_recovered : []

            const foreshadowingPlanted = planted.map((item: any, fi: number) => ({
              id: typeof item === 'string' ? `F${String(chapNum).padStart(3, '0')}-${fi + 1}` : (item.id || `F${String(chapNum).padStart(3, '0')}-${fi + 1}`),
              desc: typeof item === 'string' ? item : (item.desc || item.description || ''),
            })).filter((p: any) => p.desc)

            const foreshadowingRecovered = recovered.map((item: any) => ({
              id: typeof item === 'string' ? null : (item.id || null),
              desc: typeof item === 'string' ? item : (item.desc || item.description || ''),
            })).filter((p: any) => p.desc || p.id)

            // 如果事件提取器成功，从事件构建 StatePatch；否则回退到旧 buildPatch
            const events = extractedEvents?.events || []
            const patch = events.length > 0
              ? buildStatePatchFromEvents(events, chapNum, foreshadowingPlanted, foreshadowingRecovered, checkResult.concerns)
              : (() => {
                // 回退：从记录官数据手动构建
                const absDay = (s as any)?.absolute_day || null
                const keyEvents: string[] = Array.isArray(s?.key_events) ? s.key_events : []
                const timeLabels: string[] = Array.isArray(s?.time_labels) ? s.time_labels : []
                return {
                  summary: {
                    chapter_number: chapNum, summary: s?.summary || '',
                    characters_appeared: Array.isArray(s?.characters_appeared) ? s.characters_appeared : [],
                    locations: Array.isArray(s?.locations) ? s.locations : [],
                    key_events: keyEvents, time_labels: timeLabels, absolute_day: absDay,
                    foreshadowing_planted: foreshadowingPlanted, foreshadowing_recovered: foreshadowingRecovered,
                    character_changes: s?.character_changes || {}, world_changes: s?.world_changes || {},
                    relationship_changes: Array.isArray(s?.relationship_changes) ? s.relationship_changes : [],
                  },
                  foreshadowing_new: foreshadowingPlanted.filter((f: any) => f.desc).map((f: any) => ({ foreshadow_id: f.id!, description: f.desc, chapter_number: chapNum })),
                  foreshadowing_done: foreshadowingRecovered.filter((f: any) => f.id).map((f: any) => ({ foreshadow_id: f.id!, chapter_number: chapNum })),
                  timeline_events: keyEvents.map((ev: string, ei: number) => ({
                    chapter_number: chapNum, event_order: ei, event_description: ev,
                    time_label: timeLabels[0] || '', absolute_day: absDay,
                    location: Array.isArray(s?.locations) ? s.locations[0] || '' : '',
                    characters_involved: JSON.stringify(Array.isArray(s?.characters_appeared) ? s.characters_appeared : []),
                    is_major: ei === 0 ? 1 : 0,
                  })),
                  character_arcs: Object.entries(s?.character_changes || {}).map(([cn, d]) => ({ character_name: cn, chapter_number: chapNum, change_type: 'development', change_description: String(d) })),
                  relationship_changes: (Array.isArray(s?.relationship_changes) ? s.relationship_changes : []).filter((rc: any) => rc.char_a && rc.char_b && rc.change).map((rc: any) => ({ char_a: rc.char_a, char_b: rc.char_b, chapter_number: chapNum, relation_type: rc.type || 'ally', change_description: rc.change })),
                }
              })()

            // 模糊匹配兜底回收伏笔
            const recDescItems = recovered.filter((item: any) => {
              const desc = typeof item === 'string' ? item : (item.desc || item.description || '')
              return desc && !(typeof item === 'object' && item.id)
            })
            for (const recItem of recDescItems) {
              const recDesc = typeof recItem === 'string' ? recItem : (recItem.desc || recItem.description || '')
              if (recDesc) {
                try {
                  await window.electronAPI!.db.run(
                    `UPDATE foreshadowing_registry SET status='done',resolved_chapter=?,updated_at=datetime('now','localtime') WHERE project_id=? AND description LIKE ? AND status!='done'`,
                    [chapNum, pid, `%${recDesc.slice(0, 30)}%`]
                  )
                } catch { /* best effort */ }
              }
            }
            await applyStatePatches(window.electronAPI!.db, pid, patch)
          } catch (e: any) {
            console.error('State write failed:', e?.message || e)
          }

          // 7.5. P5: 自动回流新设定到 canon_facts（连续影响力模型 + 冲突检测）
          try {
            const charChanges: Record<string, string> = s?.character_changes || {}
            const worldChanges: Record<string, string> = s?.world_changes || {}
            const allEntries: { key: string; value: string; category: string }[] = [
              ...Object.entries(charChanges).map(([k, v]) => ({ key: k, value: v, category: 'character' })),
              ...Object.entries(worldChanges).map(([k, v]) => ({ key: k, value: v, category: 'setting' })),
            ]
            for (const entry of allEntries) {
              if (!entry.key || !entry.value) continue
              let occCount = 0
              try {
                const prevRows = await window.electronAPI!.db.query(
                  `SELECT summary FROM chapter_summaries WHERE project_id = ? AND chapter_number < ? ORDER BY chapter_number DESC LIMIT 10`,
                  [pid, chapNum]
                )
                for (const row of prevRows) { if ((row.summary || '').includes(entry.key)) occCount++ }
              } catch { /* advisory */ }
              const shouldAdmit = (entry.category === 'character' && occCount >= 2) || (entry.category === 'setting' && occCount >= 1)
              if (!shouldAdmit) continue

              // Check for existing — if exists, update tv/stability; if new, insert
              const existing = await window.electronAPI!.db.get(
                `SELECT id, details FROM canon_facts WHERE project_id = ? AND fact_key = ? AND fact_category = ?`,
                [pid, entry.key, entry.category]
              )
              if (existing) {
                let d: any = {}
                try { d = JSON.parse(existing.details || '{}') } catch {}
                if (d.non_collapse) continue  // 🟣 非收敛事实 — 永不自动更新
                const oldTv = typeof d.truth_value === 'number' ? d.truth_value : 0.5
                const maxTv = oldTv >= 0.8 ? 1.0 : oldTv >= 0.4 ? 0.9 : 0.6  // 🔒 收敛上限
                const tvDelta = modeTvDelta(narrativeMode)
                d.truth_value = Math.min(maxTv, Math.max(0.1, oldTv + tvDelta))
                d.stability = Math.min(1.0, (d.stability || 0.5) + 0.1)
                // v2.5: 公开度随 truth_value 联动——被确认的事实自动公开
                const newTv = d.truth_value
                const currentRl = existing.revealed_level || 0
                // tv 映射到 rl：tv=0.3→rl≈20, tv=0.6→rl≈50, tv=0.9→rl≈90
                const targetRl = Math.round(newTv * 100)
                const newRl = Math.max(currentRl, Math.min(100, Math.round((currentRl + targetRl) / 2)))
                // 仅当目标更高时才更新
                if (newRl > currentRl) {
                  await window.electronAPI!.db.run(
                    `UPDATE canon_facts SET revealed_level = ? WHERE id = ?`, [newRl, existing.id]
                  )
                }
                d.conflict_weight = Math.max(0, (d.conflict_weight || 0) - 0.05)
                await window.electronAPI!.db.run(
                  `UPDATE canon_facts SET details = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
                  [JSON.stringify(d), existing.id]
                )
              } else {
                // New speculative entry
                const confidence = occCount >= 3 ? 'high' : 'medium'
                const details = JSON.stringify({ truth_value: 0.3, stability: 0.1, conflict_weight: 0, confidence, source_type: 'auto_extracted' })
                await window.electronAPI!.db.run(
                  `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, source, is_hard_rule, revealed_level, confidence, source_type, details)
                   VALUES (?,?,?,?,'auto_extracted',0,${entry.category === 'character' ? 50 : 30},?,?,?)`,
                  [pid, entry.category, entry.key, String(entry.value).slice(0, 200), confidence, 'auto_extracted', details]
                )
              }

              // 🟣 冲突检测：新事实是否与已有 soft/hard 事实语义矛盾
              if (occCount <= 2) {
                try {
                  const conflictingFacts = await window.electronAPI!.db.query(
                    `SELECT id, fact_key, fact_value, details FROM canon_facts WHERE project_id = ? AND fact_category = ? AND id != ? AND (details LIKE '%"truth_value":0.%' AND CAST(json_extract(details, '$.truth_value') AS REAL) >= 0.4) LIMIT 5`,
                    [pid, entry.category, existing?.id || 0]
                  )
                  for (const cf of conflictingFacts) {
                    let cd: any = {}
                    try { cd = JSON.parse(cf.details || '{}') } catch {}
                    // Simple overlap check: shared keywords in fact_value
                    const cfWords = new Set((cf.fact_value || '').split(/[，。、\s]+/))
                    const entryWords = entry.value.split(/[，。、\s]+/)
                    const overlap = entryWords.filter(w => cfWords.has(w) && w.length >= 2)
                    if (overlap.length >= 2 && entryWords.some(w => w.includes('不') || w.includes('没') || w.includes('未') || w.includes('假'))) {
                      // Potential contradiction — record it
                      await window.electronAPI!.db.run(
                        `INSERT OR IGNORE INTO conflict_facts (project_id, fact_a_id, fact_b_id, fact_a_text, fact_b_text, conflict_type, resolution_status, detected_chapter)
                         VALUES (?,?,?,?,?,'ambiguity','unresolved',?)`,
                        [pid, cf.id, existing?.id || null, `${cf.fact_key}: ${cf.fact_value.slice(0, 100)}`, `${entry.key}: ${entry.value.slice(0, 100)}`, chapNum]
                      )
                      // Update conflict_weight on the existing fact
                      cd.conflict_weight = Math.min(1.0, (cd.conflict_weight || 0) + 0.1)
                      await window.electronAPI!.db.run(
                        `UPDATE canon_facts SET details = ? WHERE id = ?`,
                        [JSON.stringify(cd), cf.id]
                      )
                      break // one conflict per entry is enough
                    }
                  }
                } catch { /* conflict detection is best-effort */ }
              }
            }

            // v2.5: 衰减未提及的事实（叙事遗忘曲线）
            try {
              const mentionedKeys = new Set(allEntries.map(e => e.key))
              const allFacts = await window.electronAPI!.db.query(
                "SELECT id, fact_key, details FROM canon_facts WHERE project_id = ? AND details IS NOT NULL AND details != ''",
                [pid]
              )
              const decayRate = modeDecayRate(narrativeMode)
              for (const f of allFacts) {
                if (mentionedKeys.has(f.fact_key)) continue  // 本章提到了，不衰减
                let d: any = {}
                try { d = JSON.parse(f.details || '{}') } catch { continue }
                if (d.non_collapse) continue  // 🟣 非收敛事实永不衰减
                const oldTv = typeof d.truth_value === 'number' ? d.truth_value : 0.5
                const isHard = oldTv >= 0.8
                const effectiveDecay = isHard ? decayRate * 0.33 : decayRate  // hard_canon 衰减1/3
                d.truth_value = Math.max(0.1, oldTv - effectiveDecay)
                d.stability = Math.max(0.05, (d.stability || 0.5) - decayRate * 0.67)
                await window.electronAPI!.db.run(
                  "UPDATE canon_facts SET details = ?, updated_at = datetime('now','localtime') WHERE id = ?",
                  [JSON.stringify(d), f.id]
                )
              }
            } catch { /* decay is best-effort */ }
          } catch { /* auto-feedback is non-blocking */ }

          // 8. AI concerns + leak score 提示
          if (checkResult.concerns && checkResult.concerns.length > 0) {
            const concernSummary = checkResult.concerns
              .slice(0, 3)
              .map((c: any) => `⚠ ${c.type}: ${c.detail}`)
              .join('\n')
            if (concernSummary) showToast('info', `叙事建议（仅供参考）：\n${concernSummary}`)
          }
          if (checkResult.leakScore && checkResult.leakScore.threshold !== 'safe') {
            showToast('info', `语义泄露评分：${checkResult.leakScore.raw} (z=${checkResult.leakScore.z}, ${checkResult.leakScore.threshold})`)
          }
        } catch { /* 摘要/检查流程失败不阻塞正文保存 */ }
      })()
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '生成失败：' + e.message)
    }
    finally { setGenerating(false); setGenTarget(''); setStreamingText('') }
  }

  const handleSave = async () => {
    setSaving(true)
    const plan = chapterPlans.find(p => p.chapter_number === selectedChapter)
    await saveChapter(selectedChapter, plan?.title || `第${selectedChapter}章`, editingContent)
    setSaving(false)
    showToast('success', '已保存')
  }

  // 删除章节（包括正文和细纲）
  const deleteChapter = async (chapNum: number) => {
    const ch = chapters.find(c => c.chapter_number === chapNum)
    const plan = chapterPlans.find(p => p.chapter_number === chapNum)
    const label = ch ? `第 ${chapNum} 章「${ch.title}」` : plan ? `第 ${chapNum} 章细纲「${plan.title}」` : `第 ${chapNum} 章`
    if (!window.confirm(`确定删除${label}吗？此操作不可恢复。`)) return
    try {
      if (window.electronAPI) {
        if (ch) {
          await window.electronAPI.db.run('DELETE FROM chapters WHERE id = ?', [ch.id])
          // 清理关联数据
          await window.electronAPI.db.run('DELETE FROM chapter_summaries WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum])
          await window.electronAPI.db.run('DELETE FROM story_timeline WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum])
          await window.electronAPI.db.run('DELETE FROM character_arc_log WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum])
          await window.electronAPI.db.run('DELETE FROM relationship_timeline WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum])
        }
        const newPlans = chapterPlans.filter(p => p.chapter_number !== chapNum)
        await saveChapterPlans(newPlans)
        await loadAll()
        showToast('success', `${label}已删除`)
        if (selectedChapter === chapNum) {
          setEditingContent('')
          if (newPlans.length > 0) switchChapter(newPlans[0].chapter_number)
        }
      }
    } catch { showToast('error', '删除失败') }
  }

  // 新建章节（加到末尾）
  const addChapter = async () => {
    const maxNum = chapterPlans.length > 0 ? Math.max(...chapterPlans.map(p => p.chapter_number)) : 0
    const newPlan: ChapterPlan = {
      chapter_number: maxNum + 1,
      title: `第${maxNum + 1}章`,
      summary: '',
      characters: [],
      key_events: [],
      estimated_words: 3000,
      emotional_goal: '',
      function: '📖 展开',
      ending_type: '自然收尾',
    }
    const newPlans = [...chapterPlans, newPlan].sort((a, b) => a.chapter_number - b.chapter_number)
    // 重新编号
    const renumbered = newPlans.map((p, i) => ({ ...p, chapter_number: i + 1 }))
    await saveChapterPlans(renumbered)
    await loadAll()
    showToast('success', `已添加：第${maxNum + 1}章`)
  }

  // 删除卷
  const deleteVolume = async (volNum: number) => {
    const vol = volumes.find(v => v.volume_number === volNum)
    if (!vol) return
    if (!window.confirm(`确定删除「${vol.title}」吗？卷内章节细纲不会被删除。`)) return
    const newVols = volumes.filter(v => v.volume_number !== volNum).map((v, i) => ({ ...v, volume_number: i + 1 }))
    await saveVolumes(newVols)
    showToast('success', `已删除「${vol.title}」`)
  }

  // 新建卷
  const addVolume = async () => {
    const maxNum = volumes.length > 0 ? Math.max(...volumes.map(v => v.volume_number)) : 0
    const lastVol = volumes.find(v => v.volume_number === maxNum)
    const start = lastVol ? lastVol.chapter_range[1] + 1 : 1
    const end = start + 7
    const newVol: Volume = {
      volume_number: maxNum + 1,
      title: `第${maxNum + 1}卷`,
      summary: '',
      chapter_range: [start, end],
      theme: '',
      key_events: [],
    }
    const newVols = [...volumes, newVol]
    await saveVolumes(newVols)
    showToast('success', `已添加：第${maxNum + 1}卷`)
  }

  // 拖拽移动章节到指定卷
  const moveChapterToVolume = (chapNum: number, targetVolNum: number) => {
    const newVols = volumes.map(v => ({ ...v }))
    // 从原卷移出：调整原卷的 chapter_range
    const oldVol = newVols.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
    const targetVol = newVols.find(v => v.volume_number === targetVolNum)
    if (!targetVol || !oldVol) return

    if (oldVol.volume_number === targetVolNum) return // 同卷不移动

    // 缩小原卷范围
    if (oldVol.chapter_range[0] === chapNum) oldVol.chapter_range[0]++
    else if (oldVol.chapter_range[1] === chapNum) oldVol.chapter_range[1]--
    else {
      // 章节在中间，拆分为两个卷（简化：只调整范围）
      // 这里简单处理：从原卷移除，放到目标卷末尾
    }

    // 扩大目标卷范围
    targetVol.chapter_range[1] = Math.max(targetVol.chapter_range[1], chapNum)
    targetVol.chapter_range[0] = Math.min(targetVol.chapter_range[0], chapNum)

    // 重排序所有卷的 chapter_range
    const sorted = newVols.sort((a, b) => a.chapter_range[0] - b.chapter_range[0])
    sorted.forEach((v, i) => {
      v.volume_number = i + 1
    })

    saveVolumes(sorted)
    showToast('success', `第${chapNum}章已移至第${targetVolNum}卷`)
    loadAll()
  }

  // 拖拽状态
  const [dragChapter, setDragChapter] = useState<number | null>(null)

  // 全屏查看大纲/细纲
  const [fullView, setFullView] = useState<{ title: string; content: string } | null>(null)

  // 生成配置弹窗
  const [genConfig, setGenConfig] = useState<{
    open: boolean; title: string; desc: string; onConfirm: (c: any) => void
  }>({ open: false, title: '', desc: '', onConfirm: () => {} })

  // 重命名
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const startRename = () => { setRenameText(project?.title || ''); setRenaming(true) }
  const confirmRename = async () => {
    if (!renameText.trim() || !project || !window.electronAPI) { setRenaming(false); return }
    await window.electronAPI.db.run('UPDATE novel_projects SET title=?, updated_at=datetime("now","localtime") WHERE id=?', [renameText.trim(), project.id])
    setProject({ ...project, title: renameText.trim() })
    setRenaming(false)
    showToast('success', '书名已更新')
  }

  // 面板宽度 — 从本地记忆恢复
  const [leftWidth, setLeftWidth] = useState(() => {
    try { return parseInt(localStorage.getItem('workspace_leftWidth') || '') || 192 } catch { return 192 }
  })
  const [rightWidth, setRightWidth] = useState(() => {
    try { return parseInt(localStorage.getItem('workspace_rightWidth') || '') || 334 } catch { return 334 }
  })
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [showFuncBar, setShowFuncBar] = useState(false)

  // 面板宽度变化时持久化
  useEffect(() => { localStorage.setItem('workspace_leftWidth', String(leftWidth)) }, [leftWidth])
  useEffect(() => { localStorage.setItem('workspace_rightWidth', String(rightWidth)) }, [rightWidth])

  // ========== 叙事控制台 ==========
  const handleNarrativeReport = async () => {
    if (!window.electronAPI) return
    setNarrativeReportLoading(true)
    setNarrativeReport(null)
    cancelledRef.current = false
    try {
      // Gather data for the report
      const lcr = lastCheckResult
      const lls = lastLeakScore
      const led = lastEventData
      const cal = calibrationStats

      // Event stats string
      const eventTypeCounts: Record<string, number> = {}
      if (led) for (const e of led.events) { eventTypeCounts[e.event_type] = (eventTypeCounts[e.event_type] || 0) + 1 }
      const eventStats = led
        ? Object.entries(eventTypeCounts).map(([t, c]) => `${t}:${c}`).join(' ')
        : '暂无事件数据'

      const revealEst = led?.reveal_estimates
        ? `world+${led.reveal_estimates.world}% plot+${led.reveal_estimates.plot}% character+${led.reveal_estimates.character}%`
        : '暂无'

      // Foreshadowing counts
      let activeFS = 0, resolvedFS = 0
      try {
        const fsRows = await window.electronAPI.db.query(
          "SELECT status FROM foreshadowing_registry WHERE project_id = ?", [Number(id)]
        )
        for (const r of fsRows) { if (r.status === 'active') activeFS++; else if (r.status === 'done') resolvedFS++ }
      } catch { /* advisory */ }

      // Recent summaries
      let recentSummaries = '暂无'
      try {
        const sumRows = await window.electronAPI.db.query(
          "SELECT chapter_number, summary FROM chapter_summaries WHERE project_id = ? ORDER BY chapter_number DESC LIMIT 5",
          [Number(id)]
        )
        if (sumRows.length > 0) {
          recentSummaries = sumRows.map((r: any) => `第${r.chapter_number}章: ${(r.summary || '').slice(0, 100)}`).join('\n')
        }
      } catch { /* advisory */ }

      // Current day
      let curDay = 0
      try {
        const dr = await window.electronAPI!.db.get(
          "SELECT MAX(absolute_day) as cur_day FROM story_timeline WHERE project_id = ?", [Number(id)]
        )
        curDay = dr?.cur_day || 0
      } catch { /* advisory */ }

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: NARRATIVE_STATE_REPORT_SYSTEM },
        {
          role: 'user', content: NARRATIVE_STATE_REPORT_USER(
            lcr?.hardViolationCount || 0,
            lls?.z || 0, lls?.raw || 0, lls?.threshold || 'unknown',
            cal?.chapters || 0, cal?.mean || 0, cal?.std || 0,
            eventStats, revealEst, curDay,
            activeFS, resolvedFS,
            recentSummaries,
          )
        },
      ], '叙事报告')

      const jm = reply.match(/\{[\s\S]*\}/)
      if (jm) {
        const parsed = JSON.parse(jm[0])
        setNarrativeReport({
          narrative_state: parsed.narrative_state || '',
          pacing: parsed.pacing || '',
          characters: parsed.characters || '',
          risk: parsed.risk || '',
          suggested_actions: (parsed.suggested_actions || []).map((a: any) => ({
            text: a.text || '', target_chapter: a.target_chapter || null, executable: false as const,
          })),
        })
      }
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消')
      else showToast('error', '报告生成失败：' + (e.message || '未知'))
    }
    finally { setNarrativeReportLoading(false) }
  }

  /** 将建议文本注入到额外提示框 */
  const handleInjectHint = (text: string) => {
    setGenHint(prev => prev ? `${prev}\n[建议] ${text}` : `[建议] ${text}`)
    showToast('success', '建议已注入到额外提示框')
  }

  /** 大纲标准化 */
  const [normalizing, setNormalizing] = useState(false)
  const handleNormalizeOutline = async () => {
    if (!fullscreenEdit || !fullscreenEdit.content.trim()) return
    setNormalizing(true)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: OUTLINE_NORMALIZE_SYSTEM },
        { role: 'user', content: OUTLINE_NORMALIZE_USER(fullscreenEdit.content) },
      ], '大纲标准化')
      if (cancelledRef.current) return
      if (reply) {
        setFullscreenEdit({ ...fullscreenEdit, content: reply })
        showToast('success', '大纲已标准化')
      }
    } catch (e: any) {
      if (cancelledRef.current) return
      showToast('error', '标准化失败：' + (e.message || '未知错误'))
    } finally {
      setNormalizing(false)
    }
  }
  const cancelNormalize = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
    setNormalizing(false)
    showToast('info', '已取消标准化')
  }

  /** 保存版本历史 */
  const saveVersion = async (type: string, key: string, content: string) => {
    if (!window.electronAPI || !content.trim()) return
    try {
      const last = await window.electronAPI.db.get(
        'SELECT MAX(version) as v FROM version_history WHERE project_id = ? AND content_type = ? AND content_key = ?',
        [Number(id), type, key]
      )
      const nextV = (last?.v || 0) + 1
      await window.electronAPI.db.run(
        'INSERT INTO version_history (project_id, content_type, content_key, version, content) VALUES (?,?,?,?,?)',
        [Number(id), type, key, nextV, content]
      )
    } catch { /* best effort */ }
  }

  const loadHistory = async (type: string, key: string) => {
    if (!window.electronAPI) return
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM version_history WHERE project_id = ? AND content_type = ? AND content_key = ? ORDER BY version DESC LIMIT 20',
        [Number(id), type, key]
      )
      setHistoryList(rows || [])
    } catch { setHistoryList([]) }
  }

  const cancelOperation = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
    setContinuing(false); setIdeaLoading(false); setGoldenLoading(false)
    showToast('info', '已取消')
  }

  /** 续写 */
  const [continuing, setContinuing] = useState(false)
  const handleContinue = async () => {
    if (!editingContent.trim() || !selectedChapter) return
    setContinuing(true)
    cancelledRef.current = false
    const plan = chapterPlans.find(p => p.chapter_number === selectedChapter)
    try {
      const { styleContext, personalityContext } = await getRefs()
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: CONTINUE_SYSTEM },
        { role: 'user', content: CONTINUE_USER(
          editingContent, plan?.plot_beats, (plan as any)?.emotional_arc,
          styleContext, personalityContext
        ) },
      ], '续写')
      if (cancelledRef.current) return
      const newContent = editingContent + '\n\n' + (reply || '')
      setEditingContent(newContent)
      const planTitle = plan?.title || `第${selectedChapter}章`
      await saveChapter(selectedChapter, planTitle, newContent)
      showToast('success', '续写完成')
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '续写失败：' + (e.message || '未知错误'))
    } finally { setContinuing(false) }
  }

  /** 编辑器选中文字 → 弹出禁用按钮（鼠标） */
  const handleTextSelect = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    checkSelection(ta, e.clientX, e.clientY)
  }

  /** 键盘选中（Shift+方向键等） */
  const handleKeySelect = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta' && !e.key.startsWith('Arrow')) return
    const ta = e.currentTarget
    const rect = ta.getBoundingClientRect()
    checkSelection(ta, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  const checkSelection = (ta: HTMLTextAreaElement, x: number, y: number) => {
    // 延迟一帧，等浏览器更新 selection
    setTimeout(() => {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      if (start === end) { setBanSelection(null); return }
      const selected = ta.value.slice(start, end).trim()
      if (selected.length < 2 || selected.length > 40) { setBanSelection(null); return }
      setBanSelection({ text: selected, x, y })
    }, 0)
  }

  /** 确认添加选中文字为禁用词 */
  const handleConfirmBan = (level: number) => {
    if (!banSelection) return
    const existing = getEffectivePatterns()
    // 检查是否已存在
    if (existing.some(p => p.pattern === banSelection.text)) {
      showToast('info', `"${banSelection.text}" 已在禁用词列表中`)
      setBanSelection(null)
      return
    }
    const next = [...existing, { pattern: banSelection.text, replacement: '', category: '自定义', level, enabled: true }]
    saveCustomBannedPatterns(next)
    showToast('success', `已添加禁用词：${banSelection.text}（L${level}）`)
    setBanSelection(null)
    setBanFormOpen(false)
  }

  /** 自动修改单章 */
  const autoFixChapter = async (chNum: number, issues: string[], fixPrompt: string) => {
    if (!window.electronAPI) return
    const chapter = chapters.find(c => c.chapter_number === chNum)
    if (!chapter?.content) { showToast('error', '该章无内容'); return }
    setFixingChapter(chNum)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: AUTO_FIX_SYSTEM },
        { role: 'user', content: AUTO_FIX_USER(chNum, chapter.content, issues, fixPrompt) },
      ], '自动修改')
      // 去除 markdown 代码块
      let jsonStr = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = jsonStr.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI 返回格式异常，请重试'); return }
      const { fixes }: { fixes: { find: string; replace: string }[] } = JSON.parse(jm[0])
      let modified = chapter.content
      const skipped: string[] = []
      for (const f of fixes) {
        if (f.find === 'SKIP' || !f.find.trim()) { skipped.push(f.replace); continue }
        // 精确匹配：查找并替换（只替换第一个匹配）
        const idx = modified.indexOf(f.find)
        if (idx === -1) { skipped.push(`未找到匹配文本: "${f.find.slice(0, 50)}..."`); continue }
        // 确认唯一匹配
        const secondIdx = modified.indexOf(f.find, idx + 1)
        if (secondIdx !== -1) { skipped.push(`匹配不唯一: "${f.find.slice(0, 30)}..."`); continue }
        modified = modified.slice(0, idx) + f.replace + modified.slice(idx + f.find.length)
      }
      setFixPreview({ chapterNum: chNum, original: chapter.content, modified, skipped })
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消修改')
      else showToast('error', '自动修改失败：' + (e.message || '未知'))
    }
    finally { setFixingChapter(null) }
  }

  const applyFixPreview = async () => {
    if (!fixPreview || !window.electronAPI) return
    try {
      const chapter = chapters.find(c => c.chapter_number === fixPreview.chapterNum)
      if (!chapter) return
      await window.electronAPI.db.run(
        "UPDATE chapters SET content=?, word_count=?, status='edited', updated_at=datetime('now','localtime') WHERE id=?",
        [fixPreview.modified, fixPreview.modified.length, chapter.id]
      )
      setChapters(prev => prev.map(c =>
        c.chapter_number === fixPreview.chapterNum ? { ...c, content: fixPreview.modified, word_count: fixPreview.modified.length } : c
      ))
      if (selectedChapter === fixPreview.chapterNum) setEditingContent(fixPreview.modified)
      showToast('success', `第${fixPreview.chapterNum}章 已修改`)
      setFixPreview(null)
    } catch (e: any) { showToast('error', '保存失败') }
  }

  // ========== 导出 ==========
  const handleExport = async (format: 'txt' | 'docx' | 'md') => {
    if (chapters.length === 0) { showToast('error', '无已生成章节'); return }
    setShowExport(false)
    const t = project?.title || '未命名'
    try {
      if (format === 'txt') {
        const { exportToTxt } = await import('../../services/export')
        const text = exportToTxt(t, chapters)
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.txt`, filters: [{ name: 'TXT', extensions: ['txt'] }] })
        if (r) { await window.electronAPI.writeFile(r.filePath, text); showToast('success', '已导出') }
      } else if (format === 'docx') {
        const { exportToDocx } = await import('../../services/export')
        const blob = await exportToDocx(t, chapters)
        const ab = await blob.arrayBuffer(); const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)))
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.docx`, filters: [{ name: 'Word', extensions: ['docx'] }] })
        if (r) { await window.electronAPI.writeBuffer(r.filePath, b64); showToast('success', '已导出') }
      } else {
        const { exportToMd } = await import('../../services/export')
        const md = exportToMd(t, chapters)
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
        if (r) { await window.electronAPI.writeFile(r.filePath, md); showToast('success', '已导出') }
      }
    } catch (e: any) { showToast('error', '导出失败') }
  }

  // 面板拖拽
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  const handleDividerMouseDown = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(side)
    const startX = e.clientX
    const startW = side === 'left' ? leftWidth : rightWidth
    const onMove = (ev: MouseEvent) => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
      const newW = Math.max(140, Math.min(400, startW + delta))
      if (side === 'left') setLeftWidth(newW); else setRightWidth(newW)
    }
    const onUp = () => { setDragging(null); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ========== 渲染 ==========
  const chDone = (n: number): boolean => {
    const ch = chapters.find(c => c.chapter_number === n)
    return !!(ch && (ch.status === 'generated' || ch.status === 'edited'))
  }

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (!project) return null

  return (
    <div className="flex h-full">
      {/* ===== 左栏：章节目录 ===== */}
      <aside className="shrink-0 bg-bg-secondary/50 flex flex-col" style={{ width: leftCollapsed ? 36 : leftWidth }}>
        <div className="px-2 py-2.5 border-b border-border bg-bg-secondary flex items-center gap-1">
          {!leftCollapsed && <button onClick={() => navigate('/')} className="text-xs text-text-secondary hover:text-primary">← 返回</button>}
          {!leftCollapsed && renaming ? (
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onBlur={confirmRename}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenaming(false) }}
              className="w-full mt-0.5 text-sm font-medium px-1 py-0.5 border border-primary rounded"
            />
          ) : (
            !leftCollapsed ? <h2 onClick={startRename} className="text-sm font-medium text-text-main mt-0.5 truncate cursor-pointer hover:text-primary" title="点击改名">
              {project.title}
            </h2> : null
          )}
          <button onClick={() => setLeftCollapsed(!leftCollapsed)}
            className="text-xs text-text-placeholder hover:text-text-main shrink-0 w-5 h-5 flex items-center justify-center ml-auto"
            title={leftCollapsed ? '展开目录' : '折叠目录'}
          >{leftCollapsed ? '▶' : '◀'}</button>
        </div>
        {!leftCollapsed && <>
          <div className="flex-1 overflow-auto py-1">
          {/* 新建章按钮 */}
          <button
            onClick={addChapter}
            className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-1.5 border-b border-border mb-1"
          >
            <span>＋</span>
            <span>新建章</span>
          </button>

          {chapterPlans.length === 0 ? (
            <p className="text-xs text-text-placeholder text-center py-8">暂无细纲</p>
          ) : (
            chapterPlans.map(p => (
              <div key={p.chapter_number} className="group flex items-center">
                <button
                  onClick={() => switchChapter(p.chapter_number)}
                  className={`flex-1 text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors
                    ${selectedChapter === p.chapter_number ? 'bg-primary-light text-primary font-medium' : 'text-text-secondary hover:bg-bg-secondary'}
                  `}
                >
                  <span className={chDone(p.chapter_number) ? 'text-success' : 'text-text-placeholder'}>
                    {chDone(p.chapter_number) ? '●' : '○'}
                  </span>
                  <span className="truncate">{p.chapter_number}. {p.title}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteChapter(p.chapter_number) }}
                  className="px-1.5 text-xs text-text-placeholder hover:text-danger transition-colors shrink-0"
                  title="删除"
                >
                  🗑
                </button>
              </div>
            ))
          )}
          </div>
          <div className="px-3 py-2 border-t border-border text-xs text-text-placeholder flex justify-between">
            <span>{chapters.filter(c => c.status !== 'draft').length}/{chapterPlans.length} 章已写</span>
            <button onClick={addChapter} className="hover:text-primary">＋</button>
          </div>
        </>}
      </aside>

      {/* 左-中分隔线 */}
      <div
        onMouseDown={handleDividerMouseDown('left')}
        className={`w-1 cursor-col-resize shrink-0 transition-colors ${dragging === 'left' ? 'bg-primary' : 'bg-border hover:bg-primary/50'}`}
      />

      {/* ===== 中栏：编辑器 ===== */}
      <main className="flex-1 flex flex-col min-w-0 bg-bg-secondary">
        <div className="sticky top-0 z-10 bg-white border-b border-border px-4 py-2 flex items-center justify-between shrink-0">
          <span className="text-sm font-medium text-text-main">
            第 {selectedChapter} 章 · {chapterPlans.find(p => p.chapter_number === selectedChapter)?.title || '未命名'}
          </span>
          <div className="flex gap-1.5">
            {generating ? (
              <div className="flex items-center gap-1.5">
                <span className="px-3 py-1.5 text-xs text-warning flex items-center gap-1">
                  <div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> {genTarget || '生成中...'}
                </span>
                <button onClick={() => handleCancel()} className="px-2 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消</button>
              </div>
            ) : (
              <button onClick={() => setShowGenPanel(showGenPanel === 'chapter' ? null : 'chapter')}
                className="px-3 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
                {editingContent ? '🔄 重新生成' : '🤖 生成本章'}
              </button>
            )}
            {editingContent && (
              <>
                <button onClick={() => { loadHistory('chapter', String(selectedChapter)); setHistoryModal({ type: 'chapter', key: String(selectedChapter), currentContent: editingContent }) }}
                  className="px-3 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">
                  📜
                </button>
                {continuing ? (
                  <button onClick={cancelOperation}
                    className="px-3 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
                    ⏹ 取消
                  </button>
                ) : (
                  <button onClick={handleContinue} disabled={generating}
                    className="px-3 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary disabled:opacity-50">
                    ✏️ 续写
                  </button>
                )}
              </>
            )}
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light disabled:opacity-50">
              {saving ? '...' : '💾'}
            </button>
            <div className="relative">
              <button onClick={() => setShowExport(!showExport)}
                className="px-2.5 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">📥</button>
              {showExport && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-card border shadow-lg z-20 w-28">
                  {(['txt','docx','md'] as const).map(f => (
                    <button key={f} onClick={() => handleExport(f)}
                      className="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-secondary first:rounded-t-card last:rounded-b-card">
                      {f==='txt'?'📄 TXT':f==='docx'?'📝 Word':'📋 MD'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 细纲提示 — 默认折叠 */}
        {(() => {
          const plan = chapterPlans.find(p => p.chapter_number === selectedChapter) as any
          if (!plan) return null
          return (
            <div className="px-4 pt-2">
              <div className="bg-primary-light/10 rounded border border-primary/10 text-xs">
                <button onClick={() => setShowFuncBar(!showFuncBar)}
                  className="w-full px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:text-text-main">
                  <span className="truncate">第{selectedChapter}章 · {plan.core_event || plan.summary || '—'}</span>
                  <span className="text-text-placeholder shrink-0 text-xxs">{showFuncBar ? '▲' : '▼'}</span>
                </button>
                {showFuncBar && (
                  <div className="px-3 pb-1.5 space-y-1.5 border-t border-primary/10 pt-1.5">
                    {plan.core_event && <div className="text-text-main">{plan.core_event}</div>}
                    {plan.emotional_arc && <div><span className="text-text-placeholder">情绪弧线：</span>{plan.emotional_arc}</div>}
                    {plan.plot_beats && plan.plot_beats.length > 0 ? (
                      <div>
                        <span className="text-text-placeholder">情节点（{plan.plot_beats.length}）：</span>
                        <div className="mt-0.5 space-y-0.5 max-h-32 overflow-auto">
                          {plan.plot_beats.map((b: string, i: number) => <div key={i} className="text-text-secondary">{i + 1}. {b}</div>)}
                        </div>
                      </div>
                    ) : (
                      <>
                        {plan.estimated_words > 0 && <span><span className="text-text-placeholder">字数：</span>{plan.estimated_words}字</span>}
                        {plan.summary && <span className="truncate"><span className="text-text-placeholder">概要：</span>{plan.summary}</span>}
                      </>
                    )}
                    {plan.cool_moment && <div><span className="text-text-placeholder">爽点：</span>{plan.cool_moment}</div>}
                    {plan.opening_hook && <div><span className="text-text-placeholder">章首钩子：</span>{plan.opening_hook.type} · {plan.opening_hook.detail}</div>}
                    {plan.closing_hook && <div><span className="text-text-placeholder">章尾钩子：</span>{plan.closing_hook.type}（期待度：{plan.closing_hook.impact}）</div>}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* 生成选择面板 */}
        {showGenPanel && (
          <div className="mx-4 mt-2 bg-white rounded-card border border-primary/30 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-main">
                🤖 生成{showGenPanel === 'outline' ? '大纲' : showGenPanel === 'volumes' ? '卷纲' : '章节'} — 选择参考
              </span>
              <button onClick={() => setShowGenPanel(null)} className="text-text-placeholder hover:text-text-main">✕</button>
            </div>
            <div className="flex gap-4">
              {showGenPanel === 'outline' || showGenPanel === 'volumes' ? (
                <>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">📚 拆文库</h4>
                    {disassemblies.filter(d => d.current_stage >= 1).length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                      disassemblies.filter(d => d.current_stage >= 1).map(d => {
                        const isPrimary = primaryDissId === d.id
                        return (
                        <div key={d.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxDissIds(prev => prev.filter(x => x !== d.id))
                              setPrimaryDissId(isPrimary ? null : d.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{d.name}</span>
                          <input type="checkbox" checked={auxDissIds.includes(d.id)}
                            onChange={() => {
                              if (isPrimary) setPrimaryDissId(null)
                              setAuxDissIds(prev => prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">📋 设定库</h4>
                    {settingLibraries.length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                      settingLibraries.map(lib => {
                        const isPrimary = primarySettingLibId === lib.id
                        return (
                        <div key={lib.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxSettingLibIds(prev => prev.filter(x => x !== lib.id))
                              setPrimarySettingLibId(isPrimary ? null : lib.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{lib.name}</span>
                          <input type="checkbox" checked={auxSettingLibIds.includes(lib.id)}
                            onChange={() => {
                              if (isPrimary) setPrimarySettingLibId(null)
                              setAuxSettingLibIds(prev => prev.includes(lib.id) ? prev.filter(x => x !== lib.id) : [...prev, lib.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">🎨 风格库</h4>
                    {styleLibraries.length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                      styleLibraries.map(lib => {
                        const isPrimary = primaryStyleId === lib.id
                        return (
                        <div key={lib.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxStyleIds(prev => prev.filter(x => x !== lib.id))
                              setPrimaryStyleId(isPrimary ? null : lib.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{lib.name}</span>
                          <input type="checkbox" checked={auxStyleIds.includes(lib.id)}
                            onChange={() => {
                              if (isPrimary) setPrimaryStyleId(null)
                              setAuxStyleIds(prev => prev.includes(lib.id) ? prev.filter(x => x !== lib.id) : [...prev, lib.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">🧠 人格库</h4>
                    {personalityProjects.filter(p => !!((p.personality_data as any)?.private_imagery || (p.personality_data as any)?.emotional_quirks)).length === 0 ? <p className="text-xs text-text-placeholder">暂无可用的</p> :
                      personalityProjects.filter(p => !!((p.personality_data as any)?.private_imagery || (p.personality_data as any)?.emotional_quirks)).map(p => {
                        const isPrimary = primaryPersonalityId === p.id
                        return (
                        <div key={p.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxPersonalityIds(prev => prev.filter(x => x !== p.id))
                              setPrimaryPersonalityId(isPrimary ? null : p.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{p.name}</span>
                          <input type="checkbox" checked={auxPersonalityIds.includes(p.id)}
                            onChange={() => {
                              if (isPrimary) setPrimaryPersonalityId(null)
                              setAuxPersonalityIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                </>
              )}
            </div>
            <div>
              <textarea
                value={genHint}
                onChange={(e) => setGenHint(e.target.value)}
                placeholder="💡 额外提示（可选）..."
                rows={2}
                className="w-full px-3 py-1.5 text-xs border border-border-input rounded-btn resize-none focus:outline-none focus:border-primary placeholder:text-text-placeholder"
              />
            </div>
            {budgetInfo && showGenPanel === 'chapter' && (
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span>📊 上下文预算:</span>
                <span>角色 ~{budgetInfo.charTokens || 0} tokens</span>
                <span>· 总计 ~{Math.ceil((budgetInfo.totalChars || 0) * 0.4)} tokens</span>
                {(budgetInfo.totalChars || 0) * 0.4 > 5000 ? (
                  <span className="text-danger">⚠ 偏高</span>
                ) : (
                  <span className="text-green-600">✅ 适中</span>
                )}
              </div>
            )}
            {generating ? (
              <div className="flex gap-2">
                <span className="px-4 py-2 text-xs text-warning flex items-center gap-1"><div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 生成中...</span>
                <button onClick={() => handleCancel()} className="px-4 py-2 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消生成</button>
              </div>
            ) : (
              <button onClick={confirmGen} className="px-4 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
                🤖 确定生成
              </button>
            )}
          </div>
        )}

        {/* 去AI味 */}
        {editingContent && (
          <div className="px-4 pt-2">
            <DeslopPanel
              content={editingContent}
              onApply={(c) => {
                setEditingContent(c)
                const plan = chapterPlans.find(p => p.chapter_number === selectedChapter)
                saveChapter(selectedChapter, plan?.title || `第${selectedChapter}章`, c)
              }}
              styleContext={buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries)}
              personalityContext={buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)}
              onMarksChange={(scores, selected) => setMarkData({ scores, selected })}
            />
          </div>
        )}

        {/* 编辑器 */}
        <div className="flex-1 min-h-0 overflow-auto py-6 px-8">
          <div className="max-w-[860px] mx-auto h-full">
          {(streamingText || generating) && genTarget === `第${selectedChapter}章` ? (
            <div className="w-full h-full shadow-card rounded-card overflow-auto flex flex-col">
              <div className="sticky top-0 z-10 flex items-center gap-2 px-6 py-3 bg-white/80 backdrop-blur border-b border-border">
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-text-secondary">AI 正在写作中...</span>
                <button onClick={() => handleCancel()} className="ml-auto px-2 py-0.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消</button>
              </div>
              <pre className="text-base text-text-main whitespace-pre-wrap leading-relaxed font-sans flex-1 min-h-0 overflow-auto p-8">
                {streamingText || '...'}
              </pre>
            </div>
          ) : showMarks && markData ? (
            /* 标记视图 */
            <div className="w-full h-full min-h-[400px] overflow-auto rounded-card bg-white shadow-card">
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-2 bg-bg-secondary border-b border-border">
                <span className="text-xs text-text-secondary">
                  🔍 标记视图 — {markData.scores.filter(s => s.score > 0).length} 段有问题，{markData.selected.size} 段已选
                </span>
                <button onClick={() => setShowMarks(false)}
                  className="px-2 py-1 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light">
                  ✏️ 返回编辑
                </button>
              </div>
              <div className="px-10 py-8 text-base leading-relaxed whitespace-pre-wrap font-sans">
                {(() => {
                  const paragraphs = editingContent.split(/\n\n+/)
                  return paragraphs.map((para, i) => {
                    const scoreItem = markData.scores.find(s => s.index === i)
                    const isSelected = markData.selected.has(i)
                    const hasIssue = scoreItem && scoreItem.score > 0

                    let bgClass = ''
                    let badge = ''
                    if (isSelected && hasIssue) {
                      bgClass = 'bg-warning/10 border-l-2 border-warning pl-3 -ml-3 rounded-r'
                      badge = `⭐${scoreItem!.score}`
                    } else if (hasIssue && !isSelected) {
                      bgClass = 'bg-gray-50 opacity-50'
                    }

                    return (
                      <p key={i} className={`mb-2 ${bgClass}`}>
                        {badge && <span className="text-xxs text-warning mr-1.5">{badge}</span>}
                        {para || ' '}
                      </p>
                    )
                  })
                })()}
              </div>
            </div>
          ) : (
            <>
              {markData && (
                <div className="flex justify-end mb-1.5">
                  <button onClick={() => setShowMarks(true)}
                    className="px-2 py-1 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary hover:border-primary hover:text-primary transition-colors">
                    🔍 标记段落
                  </button>
                </div>
              )}
              <textarea
                value={editingContent}
                onChange={(e) => setEditingContent(e.target.value)}
                onMouseUp={handleTextSelect}
                onKeyUp={handleKeySelect}
                className="w-full h-full min-h-[400px] px-10 py-8 text-base leading-relaxed
                  focus:outline-none focus:shadow-glow rounded-card resize-none
                  bg-white shadow-card placeholder:text-text-placeholder"
                placeholder="在左侧目录选择章节，点击「生成本章」开始..."
              />
              {/* 选中文字 → 浮动禁用按钮 */}
              {banSelection && !banFormOpen && (
                <div className="fixed z-50" style={{ left: banSelection.x - 60, top: banSelection.y - 40 }}>
                  <button
                    onClick={() => setBanFormOpen(true)}
                    className="px-2 py-1 text-xs bg-danger text-white rounded shadow-lg hover:bg-danger/80 whitespace-nowrap">
                    🚫 禁用此表达
                  </button>
                </div>
              )}
              {banSelection && banFormOpen && (
                <div className="fixed z-50 bg-white border border-border rounded-card shadow-lg p-3" style={{ left: banSelection.x - 100, top: banSelection.y - 50 }}>
                  <p className="text-xs text-text-main mb-2 truncate max-w-[220px]">添加禁用词："{banSelection.text}"</p>
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-xs text-text-secondary mr-1">毒级：</span>
                    {[1, 2, 3, 4, 5].map(l => (
                      <button key={l}
                        onClick={() => handleConfirmBan(l)}
                        className={`px-1.5 py-0.5 rounded text-xxs font-medium ${
                          l >= 4 ? 'bg-red-100 text-red-700 hover:bg-red-200' :
                          l >= 3 ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' :
                          'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        L{l}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setBanSelection(null); setBanFormOpen(false) }}
                    className="text-xs text-text-placeholder hover:text-text-secondary">取消</button>
                </div>
              )}
            </>
          )}
          </div>
        </div>
      </main>

      {/* 中-右分隔线 */}
      <div
        onMouseDown={handleDividerMouseDown('right')}
        className={`w-1 cursor-col-resize shrink-0 transition-colors ${dragging === 'right' ? 'bg-primary' : 'bg-border hover:bg-primary/50'}`}
      />

      {/* ===== 右栏：工具面板 ===== */}
      <aside className="shrink-0 bg-bg-secondary/50 flex flex-col min-h-0" style={{ width: rightCollapsed ? 36 : rightWidth }}>
        {/* Tab 切换 */}
        <div className="flex border-b border-border shrink-0 items-center">
          <button onClick={() => setRightCollapsed(!rightCollapsed)}
            className="text-xs text-text-placeholder hover:text-text-main shrink-0 w-6 h-6 flex items-center justify-center"
            title={rightCollapsed ? '展开面板' : '折叠面板'}
          >{rightCollapsed ? '◀' : '▶'}</button>
          {!rightCollapsed && (['outline', 'volumes', 'settings', 'foreshadowing', 'timeline', 'review'] as const).map(tab => (
            <button key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 py-1 text-xs tracking-wide transition-colors text-center whitespace-nowrap
                ${rightTab === tab ? 'text-primary font-semibold' : 'text-text-secondary hover:text-text-main font-normal'}
              `}>
              <span className="relative inline-block pb-1">
                {{ outline: '大纲', volumes: '细纲', settings: '设定',
                   foreshadowing: '伏笔', timeline: '时间线', review: '校对' }[tab]}
                {rightTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </span>
            </button>
          ))}
        </div>

        {!rightCollapsed && <div className="flex-1 overflow-auto">
          {/* 大纲 Tab */}
          {rightTab === 'outline' && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-main">故事大纲</span>
                <div className="flex gap-2 items-center">
                  <button onClick={() => { loadHistory('outline', 'outline'); setHistoryModal({ type: 'outline', key: 'outline', currentContent: outlineContent }) }}
                    className="text-xs text-text-secondary hover:underline">历史</button>
                  <button onClick={() => setFullscreenEdit({ title: '编辑大纲', content: outlineContent, onSave: (c: string) => { saveOutline(c) } })}
                    className="text-xs text-primary hover:underline">编辑</button>
                  {outlineContent && (
                    <button onClick={() => setFullView({ title: '故事大纲', content: outlineContent })}
                      className="text-xs text-text-secondary hover:underline">查看</button>
                  )}
                  <button onClick={() => setShowGenPanel(showGenPanel === 'outline' ? null : 'outline')} disabled={generating}
                    className="text-xs text-primary hover:underline disabled:opacity-50">🔄 重新生成</button>
                </div>
              </div>
              {outlineContent ? (
                <pre className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed px-1">
                  {outlineContent}
                </pre>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <p className="text-xs text-text-placeholder">尚无大纲</p>
                  <button onClick={() => setShowGenPanel(showGenPanel === 'outline' ? null : 'outline')} disabled={generating}
                    className="px-3 py-1 text-xs bg-primary text-white rounded-btn">🤖 直接生成大纲</button>
                  {/* 灵感脑洞 → 黄金三章 → 大纲 流程 */}
                  <div className="border-t border-border pt-3 mt-3">
                    <p className="text-xs text-text-secondary mb-2">💡 或者从灵感开始</p>
                    <textarea value={ideaInput} onChange={e => setIdeaInput(e.target.value)}
                      placeholder="输入一句话灵感，如：一个能看见死亡倒计时的程序员…"
                      className="w-full text-xs border border-border-input rounded p-2 resize-none h-16 mb-2"
                    />
                    {ideaLoading ? (
                      <button onClick={cancelOperation}
                        className="px-3 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
                        ⏹ 取消
                      </button>
                    ) : (
                      <button onClick={handleGenerateIdea} disabled={!ideaInput.trim()}
                        className="px-3 py-1 text-xs bg-primary text-white rounded-btn disabled:opacity-50">
                        💡 生成脑洞
                      </button>
                    )}
                    {ideaData && (
                      <div className="mt-2 p-2 bg-bg-secondary rounded text-xs text-left space-y-1">
                        <p><b>核心梗：</b>{ideaData.hook}</p>
                        <p><b>题材：</b>{ideaData.genre} · <b>基调：</b>{ideaData.tone}</p>
                        <p><b>主角：</b>{ideaData.prototype}</p>
                        <div className="flex gap-2 mt-2">
                          {goldenLoading ? (
                            <button onClick={cancelOperation}
                              className="px-2 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
                              ⏹ 取消
                            </button>
                          ) : (
                            <button onClick={handleGenerateGoldenThree}
                              className="px-2 py-1 text-xs bg-success text-white rounded-btn disabled:opacity-50">
                              📖 生成黄金三章
                            </button>
                          )}
                          {chapters.filter(c => c.chapter_number <= 3).length >= 3 && (
                            <button onClick={handleReverseOutline} disabled={generating}
                              className="px-2 py-1 text-xs border border-primary text-primary rounded-btn disabled:opacity-50">
                              📋 从三章出大纲
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 细纲 Tab */}
          {rightTab === 'volumes' && (
            <VolumePanel
              volumes={volumes} chapterPlans={chapterPlans}
              expandedVolume={expandedVolume} setExpandedVolume={setExpandedVolume}
              generating={generating} outlineContent={outlineContent}
              outlineVersion={outlineVersion}
              showGenPanel={showGenPanel} setShowGenPanel={setShowGenPanel}
              dragChapter={dragChapter} setDragChapter={setDragChapter}
              selectedChapter={selectedChapter}
              addVolume={addVolume} deleteVolume={deleteVolume}
              moveChapterToVolume={moveChapterToVolume}
              genSingleChapterPlan={genSingleChapterPlan}
              setFullView={setFullView} chDone={chDone}
              onUpdateVolume={updateVolume}
              onUpdateChapterPlan={updateChapterPlan}
              onFullscreenEdit={(title, content, onSave) => setFullscreenEdit({ title, content, onSave })}
            />
          )}

          {/* 设定 Tab（统一管理角色/世界/规则等） */}
          {rightTab === 'settings' && (
            <CanonFactPanel
              projectId={Number(id)}
              outlineContent={outlineContent}
              chapters={chapters.map(c => ({ chapter_number: c.chapter_number, title: c.title, content: c.content }))}
              key={canonRefresh}
            />
          )}

          {/* 伏笔 Tab */}
          {rightTab === 'foreshadowing' && (
            <ForeshadowingPanel projectId={Number(id)} chapters={chapters.map(c => ({ chapter_number: c.chapter_number, title: c.title }))} />
          )}

          {/* 时间线 Tab */}
          {rightTab === 'timeline' && (
            <TimelinePanel projectId={Number(id)} chapters={chapters.map(c => ({ chapter_number: c.chapter_number, title: c.title }))} volumes={volumes} />
          )}

          {/* 叙事控制台 Tab */}
          {rightTab === 'review' && (
            <ReviewPanel
              lastCheckResult={lastCheckResult}
              lastLeakScore={lastLeakScore}
              lastEventData={lastEventData}
              calibrationStats={calibrationStats}
              narrativeReport={narrativeReport}
              narrativeReportLoading={narrativeReportLoading}
              onGenerateReport={handleNarrativeReport}
              onCancel={handleCancel}
              chapters={chapters}
              foreshadowingItems={[]}
              currentChapter={selectedChapter}
              fixingChapter={fixingChapter}
              autoFixChapter={autoFixChapter}
              onInjectHint={handleInjectHint}
            />
          )}

          {/* 自动修改预览弹窗 */}
          {fixPreview && (
            <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setFixPreview(null)}>
              <div className="bg-white rounded-card shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
                  <h3 className="text-sm font-medium">第{fixPreview.chapterNum}章 — 修改预览</h3>
                  <button onClick={() => setFixPreview(null)} className="text-text-placeholder hover:text-text-main">✕</button>
                </div>
                <div className="p-4 overflow-auto flex-1 space-y-3">
                  <div className="text-xs text-text-secondary">
                    <p className="font-medium mb-1">📝 修改后内容（红字为改动部分示意，请对照确认）</p>
                    <pre className="text-xs text-text-main whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto bg-bg-secondary p-3 rounded">
                      {fixPreview.modified}
                    </pre>
                  </div>
                  {fixPreview.skipped.length > 0 && (
                    <div className="text-xs text-warning">
                      <p className="font-medium">⚠️ 以下问题未能自动修改（需手动处理）：</p>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {fixPreview.skipped.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 border-t border-border flex gap-2 justify-end shrink-0">
                  <button onClick={() => setFixPreview(null)} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary">取消</button>
                  <button onClick={applyFixPreview} className="px-3 py-1.5 text-xs bg-primary text-white rounded-btn">✅ 确认修改并保存</button>
                </div>
              </div>
            </div>
          )}
        </div>
        }
      </aside>

      {/* 生成配置弹窗 */}
      {genConfig.open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setGenConfig(prev => ({ ...prev, open: false }))}>
          <div className="bg-white rounded-card shadow-xl max-w-md w-full mx-4 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
              <h2 className="text-lg">{genConfig.title}</h2>
              <button onClick={() => setGenConfig(prev => ({ ...prev, open: false }))} className="text-text-placeholder hover:text-text-main text-lg">✕</button>
            </div>
            <div className="px-5 py-3 space-y-3 overflow-auto flex-1">
              <p className="text-xs text-text-secondary">{genConfig.desc}</p>
              <div>
                <h4 className="text-xs font-medium text-text-main mb-1.5">🎨 风格库</h4>
                {styleLibraries.length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                  styleLibraries.map(lib => (
                    <label key={lib.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <input type="radio" name="cfgPrimary" checked={primaryStyleId === lib.id}
                        onChange={() => setPrimaryStyleId(primaryStyleId === lib.id ? null : lib.id)} className="accent-primary" />
                      <span className="flex-1">{lib.name}</span>
                      <input type="checkbox" checked={auxStyleIds.includes(lib.id)}
                        onChange={() => setAuxStyleIds(prev => prev.includes(lib.id) ? prev.filter(x => x !== lib.id) : [...prev, lib.id])}
                        disabled={primaryStyleId === lib.id} className="accent-primary" />
                      <span className="text-text-placeholder w-10">辅</span>
                    </label>
                  ))}
              </div>
              <div>
                <h4 className="text-xs font-medium text-text-main mb-1.5">📚 拆文库</h4>
                {disassemblies.filter(d => d.current_stage >= 1).length === 0 ? <p className="text-xs text-text-placeholder">暂无已拆解</p> :
                  disassemblies.filter(d => d.current_stage >= 1).map(d => (
                    <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <input type="checkbox" checked={auxDissIds.includes(d.id)}
                        onChange={() => setAuxDissIds(prev => prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id])} className="accent-primary" />
                      <span>{d.name}</span>
                    </label>
                  ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">
              <button onClick={() => setGenConfig(prev => ({ ...prev, open: false }))}
                className="px-4 py-2 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary">取消</button>
              <button onClick={() => {
                const c = { primaryStyleId, auxStyleIds, primaryPersonalityId, auxPersonalityIds }
                setGenConfig(prev => ({ ...prev, open: false }))
                genConfig.onConfirm(c)
              }} className="px-4 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">🤖 确定生成</button>
            </div>
          </div>
        </div>
      )}

      {/* 全屏编辑弹窗 */}
      {fullscreenEdit && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col" onClick={() => {}}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <span className="text-sm font-medium text-text-main">✏️ {fullscreenEdit.title}</span>
            <div className="flex gap-2">
              {normalizing ? (
                <button onClick={cancelNormalize}
                  className="px-4 py-2 border border-danger text-danger rounded-btn text-sm hover:bg-danger/10">
                  ⏹ 取消标准化
                </button>
              ) : (
                <button onClick={handleNormalizeOutline}
                  className="px-4 py-2 border border-primary text-primary rounded-btn text-sm hover:bg-primary-light">
                  🔧 标准化
                </button>
              )}
              <button onClick={() => { fullscreenEdit.onSave(fullscreenEdit.content); setFullscreenEdit(null) }}
                className="px-4 py-2 bg-primary text-white rounded-btn text-sm hover:bg-primary-hover">💾 保存并关闭</button>
              <button onClick={() => { if (normalizing) cancelNormalize(); setFullscreenEdit(null) }}
                className="px-4 py-2 border border-border-input text-text-secondary rounded-btn text-sm hover:bg-bg-secondary">取消</button>
            </div>
          </div>
          <textarea
            value={fullscreenEdit.content}
            onChange={e => setFullscreenEdit({ ...fullscreenEdit, content: e.target.value })}
            className="flex-1 w-full px-8 py-4 text-sm leading-relaxed resize-none focus:outline-none font-mono"
            spellCheck={false}
          />
        </div>
      )}

      {/* 全屏查看弹窗 */}
      {fullView && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setFullView(null)}>
          <div className="bg-white rounded-card shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-lg text-text-main">{fullView.title}</h2>
              <button onClick={() => setFullView(null)} className="w-8 h-8 flex items-center justify-center rounded-btn hover:bg-bg-secondary text-text-secondary">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-5 min-h-0">
              <pre className="text-base text-text-main whitespace-pre-wrap leading-relaxed font-sans">{fullView.content}</pre>
            </div>
            <div className="px-5 py-3 border-t border-border text-right">
              <button onClick={() => setFullView(null)} className="px-4 py-2 bg-primary text-white rounded-btn text-base hover:bg-primary-hover">关闭</button>
            </div>
          </div>
        </div>
      )}
      {/* 版本历史弹窗 */}
      {historyModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setHistoryModal(null)}>
          <div className="bg-white rounded-card shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-lg text-text-main">📜 历史版本</h2>
              <button onClick={() => setHistoryModal(null)} className="w-8 h-8 flex items-center justify-center rounded-btn hover:bg-bg-secondary text-text-secondary">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-2 min-h-0">
              {historyList.length === 0 && <p className="text-sm text-text-placeholder text-center py-8">暂无历史版本</p>}
              {historyList.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded bg-bg-secondary/50 hover:bg-bg-secondary">
                  <span className="text-xs text-text-secondary font-mono shrink-0">v{h.version}</span>
                  <span className="text-xs text-text-placeholder shrink-0">{h.created_at?.replace('T', ' ').slice(0, 16) || ''}</span>
                  <span className="text-xs text-text-main truncate flex-1">{h.content?.slice(0, 50) || ''}…</span>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setFullView({ title: `v${h.version} — ${h.created_at?.slice(0, 10) || ''}`, content: h.content }); setHistoryModal(null) }}
                      className="text-xs text-primary hover:underline">查看</button>
                    <button onClick={() => {
                      if (historyModal.type === 'outline') { saveOutline(h.content) }
                      else if (historyModal.type === 'chapter') { setEditingContent(h.content); saveChapter(Number(historyModal.key), '', h.content) }
                      else { historyModal.currentContent && historyModal.onRestore?.(h.content) }
                      setHistoryModal(null)
                      showToast('success', `已恢复 v${h.version}`)
                    }} className="text-xs text-danger hover:underline">恢复</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
