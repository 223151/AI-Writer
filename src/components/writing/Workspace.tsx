import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import DeslopPanel from './DeslopPanel'
import ForeshadowingPanel from './ForeshadowingPanel'
import TimelinePanel from './TimelinePanel'
import CanonFactPanel from './CanonFactPanel'

import {
  PREPARE_SYSTEM, PREPARE_USER,
  OUTLINE_SYSTEM, OUTLINE_USER,
  VOLUME_OUTLINE_SYSTEM, VOLUME_OUTLINE_USER,
  DETAIL_OUTLINE_SYSTEM, DETAIL_OUTLINE_USER,
  CHAPTER_SYSTEM, CHAPTER_USER,
  CONTEXT_UPDATE_SYSTEM, CONTEXT_UPDATE_USER,
  CHAPTER_SUMMARY_SYSTEM, CHAPTER_SUMMARY_USER,
  CANON_EXTRACTION_SYSTEM, CANON_EXTRACTION_USER,
  buildMinimalContext,
  REVIEW_SYSTEM, REVIEW_USER, AUTO_FIX_SYSTEM, AUTO_FIX_USER,
} from '../../services/generator'
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
  // v1.6.0 卷纲优化新增字段
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
}
interface ChapterPlan {
  chapter_number: number; title: string; summary: string
  characters: string[]; key_events: string[]
  estimated_words: number; emotional_goal?: string
  function?: string; ending_type?: string
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
    if (chars.length) ctx += `\n角色(${chars.length}个)：${chars.map((c: any) => `${c.name}(${c.info || c.role || ''})`).join('、')}`
    if (worlds.length) ctx += `\n世界观(${worlds.length}个)：${worlds.map((w: any) => w.name).join('、')}`
    if (rules.length) ctx += `\n规则(${rules.length}个)：${rules.map((r: any) => `${r.name}:${r.description}`).join('；')}`
    return ctx
  }).join('\n\n')
}

/** 构建风格库上下文（正文用） */
function buildStyleContext(
  primaryStyleId: number | null, auxStyleIds: number[],
  styleLibraries: StyleLibrary[]
) {
  const ids = [primaryStyleId, ...auxStyleIds].filter(Boolean) as number[]
  const styles = styleLibraries.filter(l => ids.includes(l.id))
  if (!styles.length) return ''
  return styles.map((s) => {
    const p = s.style_profile
    return `${s.id === primaryStyleId ? '【主】' : '【辅】'}${s.name}：${p?.writing_style?.narrative_perspective || ''}，${p?.writing_style?.sentence_characteristics || ''}，${p?.atmosphere?.primary || ''}/${p?.atmosphere?.emotional_tone || ''}`
  }).join('\n')
}

/** 构建人格库上下文（正文用） */
function buildPersonalityContext(
  primaryId: number | null, auxIds: number[],
  personalityProjects: PersonalityProject[]
) {
  const ids = [primaryId, ...auxIds].filter(Boolean) as number[]
  const projects = personalityProjects.filter(p => ids.includes(p.id))
  if (!projects.length) return ''
  return projects.map(p => {
    const d = p.personality_data || {}
    return `${p.id === primaryId ? '【主】' : '【辅】'}${p.name}：情感${(d as any).emotional_intensity?.slice(0, 60) || ''}；冲突${(d as any).conflict_depth?.slice(0, 60) || ''}；人情${(d as any).human_warmth?.slice(0, 60) || ''}；语言${(d as any).linguistic_personality?.slice(0, 60) || ''}；读者${(d as any).reader_relationship?.slice(0, 60) || ''}`
  }).join('\n')
}

/** 卷纲高级字段 — 可折叠展示 */
function MoreFields({ vol }: { vol: Volume }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <button onClick={() => setShow(!show)}
        className="text-xs text-primary hover:underline">
        {show ? '▲ 收起详情' : '▼ 展开更多（节奏/伏笔/里程碑/冲突）'}
      </button>
      {show && (
        <div className="mt-2 space-y-2">
          {vol.word_count_target ? (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">📊 字数目标</p>
              <p className="text-xs text-text-secondary">{vol.word_count_target.toLocaleString()} 字</p>
            </div>
          ) : null}
          {vol.connection_prev && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">⬆️ 承上</p>
              <p className="text-xs text-text-secondary">{vol.connection_prev}</p>
            </div>
          )}
          {vol.connection_next && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">⬇️ 启下</p>
              <p className="text-xs text-text-secondary">{vol.connection_next}</p>
            </div>
          )}
          {vol.pacing_design && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">🎵 节奏设计</p>
              <p className="text-xs text-text-secondary whitespace-pre-wrap">{vol.pacing_design}</p>
            </div>
          )}
          {vol.emotional_cadence && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">🎭 情绪节奏</p>
              <p className="text-xs text-text-secondary">{vol.emotional_cadence}</p>
            </div>
          )}
          {vol.foreshadowing_plant?.length ? (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">🪝 本卷新埋伏笔</p>
              {vol.foreshadowing_plant.map((fp, i) => (
                <p key={i} className="text-xs text-text-secondary">• {fp}</p>
              ))}
            </div>
          ) : null}
          {vol.foreshadowing_payoff?.length ? (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">✅ 本卷回收伏笔</p>
              {vol.foreshadowing_payoff.map((fp, i) => (
                <p key={i} className="text-xs text-text-secondary">• {fp}</p>
              ))}
            </div>
          ) : null}
          {vol.foreshadowing_advance && (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">🔗 伏笔推进</p>
              <p className="text-xs text-text-secondary">{vol.foreshadowing_advance}</p>
            </div>
          )}
          {vol.foreshadowing && (
            <div className="text-xs text-text-secondary">
              <p>🪝 伏笔：{vol.foreshadowing}</p>
            </div>
          )}
          {(vol.foreshadowing_planted?.length || vol.foreshadowing_recovered?.length) ? (
            <div className="text-xs text-text-secondary">
              {vol.foreshadowing_planted?.length ? <p>🪝 新埋伏笔：{vol.foreshadowing_planted.join('、')}</p> : null}
              {vol.foreshadowing_recovered?.length ? <p>✅ 回收伏笔：{vol.foreshadowing_recovered.join('、')}</p> : null}
            </div>
          ) : null}
          {vol.character_milestones?.length ? (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">👤 人物里程碑</p>
              {vol.character_milestones.map((cm, i) => (
                <p key={i} className="text-xs text-text-secondary">
                  {cm.character}: {cm.start_state} → {cm.end_state}（{cm.key_event}）
                </p>
              ))}
            </div>
          ) : null}
          {vol.conflict_nodes?.length ? (
            <div>
              <p className="text-xs font-medium text-text-secondary mb-0.5">⚔️ 关键冲突节点</p>
              {vol.conflict_nodes.map((cn, i) => (
                <p key={i} className="text-xs text-text-secondary">
                  [{cn.chapter_segment}] {cn.description}（{cn.escalation_type}）
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // 核心数据
  const [project, setProject] = useState<NovelProject | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [prepareContent, setPrepareContent] = useState('')
  const [outlineContent, setOutlineContent] = useState('')
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
  const [reviewResult, setReviewResult] = useState<{ overall_report: string; chapter_fixes: ChapterFix[] } | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [fixingChapter, setFixingChapter] = useState<number | null>(null)
  const [fixPreview, setFixPreview] = useState<{ chapterNum: number; original: string; modified: string; skipped: string[] } | null>(null)
  const [editingFixPrompt, setEditingFixPrompt] = useState<number | null>(null)
  const [editFixPromptText, setEditFixPromptText] = useState('')

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

  // 同步 ref
  useEffect(() => { generatingRef.current = generating }, [generating])
  useEffect(() => { reviewingRef.current = reviewing }, [reviewing])
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

      const outl = await window.electronAPI.db.get('SELECT content FROM outlines WHERE project_id = ?', [Number(id)])
      if (outl) setOutlineContent(outl.content)

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
      if (generatingRef.current || reviewingRef.current) {
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
    ex
      ? await window.electronAPI.db.run("UPDATE chapters SET title=?, content=?, word_count=?, status='edited', updated_at=datetime('now','localtime') WHERE id=?", [title, content, content.length, ex.id])
      : await window.electronAPI.db.run("INSERT INTO chapters (project_id, chapter_number, title, content, word_count, status) VALUES (?,?,?,?,?,'generated')", [Number(id), num, title, content, content.length])
    await loadAll()
  }

  const saveOutline = async (content: string) => {
    if (!window.electronAPI) return
    const ex = await window.electronAPI.db.get('SELECT id FROM outlines WHERE project_id=?', [Number(id)])
    ex
      ? await window.electronAPI.db.run("UPDATE outlines SET content=?, updated_at=datetime('now','localtime') WHERE project_id=?", [content, Number(id)])
      : await window.electronAPI.db.run('INSERT INTO outlines (project_id,content) VALUES (?,?)', [Number(id), content])
    setOutlineContent(content)
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
      let userPrompt = OUTLINE_USER(project.title, project.description, prepareContent, '', disassemblyContext, settingLibContext || undefined)
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
              await window.electronAPI!.db.run(
                `INSERT INTO canon_facts (project_id,fact_category,fact_key,fact_value,is_hard_rule,source,established_chapter) VALUES (?,?,?,?,?,?,0)`,
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
           WHERE project_id = ? AND status IN ('planted','buried','planned')
           ORDER BY priority DESC, target_chapter ASC`,
          [Number(id)]
        )
        if (fsItems.length > 0) {
          const statusLabels: Record<string, string> = { planted: '已埋', buried: '已加固', planned: '计划中' }
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

      cancelledRef.current = false
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: VOLUME_OUTLINE_SYSTEM },
        { role: 'user', content: VOLUME_OUTLINE_USER(
          enrichedOutline, total, nextVolNum, prevVolContext, prevChapterPlansStr,
          canonFactsContext, foreshadowingStatus, prevVolOutcomes
        ) },
      ], '卷纲生成')
      if (cancelledRef.current) return

      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', '卷纲格式异常，请重试'); return }
      let vol: any
      try { vol = JSON.parse(jm[0]) } catch {
        try { vol = JSON.parse(jm[0].replace(/,\s*}/g, '}').replace(/[\x00-\x1f]/g, ' ')) } catch {}
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
        // v1.6.0 卷纲优化新增字段
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
      }
      const newVols = [...volumes, newVol]
      await saveVolumes(newVols)
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

      const prevContentExcerpt = prevChapter?.content
        ? `\n【上一章正文结尾（${prevChapter.content.length}字）】\n${prevChapter.content.slice(-400)}\n（请根据以上结尾内容，确保本章细纲的起点和上一章实际结尾衔接流畅）`
        : ''

      const prevContext = isFirstChapterInBook
        ? '（全书第一章，无前章）'
        : isFirstChapterInVol
          ? `（本卷第一章，请基于大纲和卷纲直接设计开篇，不需要依赖前一章细纲）${prevContentExcerpt}`
          : prevPlan
            ? `【上一章细纲】第${prevPlan.chapter_number}章 ${prevPlan.title}\n概要：${prevPlan.summary}\n人物：${prevPlan.characters.join('、')}\n事件：${prevPlan.key_events.join('、')}${prevContentExcerpt}`
            : `（上一章细纲尚未生成，请基于大纲和卷纲独立设计本章）${prevContentExcerpt}`

      const promptParts = [
        outlineContent.slice(0, 1500),
        volContext,
        prevContext,
        styleContext ? '【风格】\n' + styleContext : '',
        disassemblyContext ? '【拆文】\n' + disassemblyContext.slice(0, 1000) : '',
      ].filter(Boolean)

      const reply = await window.electronAPI.aiChat([
        {
          role: 'system',
          content: `你是章节细纲规划师。只规划第 ${chapNum} 章。${isFirstChapterInBook ? '这是全书第一章（黄金首章），需要：强力钩子+快速建立主角+展示核心冲突。' : isFirstChapterInVol ? '这是新一卷的开篇章节，需要：新卷氛围建立+承上启下的过渡+保持读者期待。' : '请基于上一章细纲连贯设计本章。'}一章的细纲包含字段：chapter_number(数字)、title(章节标题5-15字)、function(功能标签：🎣钩子/⚡爽点/📖展开/💡转折/🌿支线/🏗建立/🌊过渡)、summary(内容概要50-100字)、characters(出场人物数组)、key_events(关键事件数组2-4个)、emotional_goal(情绪目标简短描述)、estimated_words(预估字数数字)、ending_type(结尾类型：悬念/爽点释放/情感余味/自然过渡)。输出严格的JSON对象，不要数组，不要markdown代码块。`
        },
        { role: 'user', content: promptParts.join('\n\n') + `\n\n请输出第 ${chapNum} 章的细纲JSON对象。` },
      ], `细纲-第${chapNum}章`)

      if (cancelledRef.current) return
      // 尝试多种方式提取 JSON
      let newPlan: ChapterPlan
      try {
        const jm = reply.match(/\{[\s\S]*\}/)
        newPlan = JSON.parse(jm ? jm[0] : reply)
      } catch {
        // 如果AI没返回有效JSON，创建一个基础细纲
        newPlan = {
          chapter_number: chapNum,
          title: `第${chapNum}章`,
          summary: reply.slice(0, 200),
          characters: [],
          key_events: [],
          estimated_words: 3000,
          emotional_goal: '',
          function: '📖 展开',
          ending_type: '自然收尾',
        }
      }
      newPlan.chapter_number = chapNum

      const merged = chapterPlans.filter(p => p.chapter_number !== chapNum)
      merged.push(newPlan)
      merged.sort((a, b) => a.chapter_number - b.chapter_number)
      await saveChapterPlans(merged)
      showToast('success', `第${chapNum}章细纲已生成：${newPlan.title}`)
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消生成')
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
      const prevExcerpt = prevCh?.content?.slice(-300) || ''

      // 前一章摘要（记录官）
      let prevSummaryContext = ''
      try {
        const prevSummary = await window.electronAPI.db.get('SELECT summary FROM chapter_summaries WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum - 1])
        if (prevSummary?.summary) prevSummaryContext = `\n\n【前一章摘要（记录官）】\n${prevSummary.summary}`
      } catch {}

      // 事实簿（硬规则注入）
      let canonFactsContext = ''
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
      try {
        const checklist: string[] = []
        const urgentFS = await window.electronAPI.db.query(
          `SELECT foreshadow_id, description, target_chapter FROM foreshadowing_registry
           WHERE project_id = ? AND status IN ('planted','buried') AND target_chapter <= ?`,
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
        if (checklist.length > 0) {
          consistencyChecklist = '⚠️ 生成前一致性检查清单（请逐条确认本章不违反）：\n' + checklist.join('\n')
        }
      } catch {}

      const planAny = plan as any
      let userPrompt = CHAPTER_USER(
        project.title, prepareContent.slice(0, 500), chapNum, plan.title,
        plan.summary, plan.characters, plan.key_events, plan.estimated_words || 3000,
        planAny.emotional_goal || '', planAny.function || '', planAny.ending_type || '自然收尾',
        styleContext, plotSummary, prevExcerpt,
        (volContext + '\n\n' + prevSummaryContext),
        canonFactsContext, personalityContext
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
          chapNum, plan.characters, allChars, allWorlds, recentText
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

      // 自动生成章节摘要（记录官）— 后台静默，不阻塞 UI
      ;(async () => {
        try {
          const summaryReply = await window.electronAPI!.aiChat([
            { role: 'system', content: CHAPTER_SUMMARY_SYSTEM },
            { role: 'user', content: CHAPTER_SUMMARY_USER(chapNum, plan.title, finalText, outlineContent) },
          ], '章节摘要')
          const jm = summaryReply.match(/\{[\s\S]*\}/)
          if (jm) {
            const s = JSON.parse(jm[0])
            const prevSum = await window.electronAPI!.db.get('SELECT id FROM chapter_summaries WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum])
            const data = [
              s.summary || '', JSON.stringify(s.characters_appeared || []), JSON.stringify(s.locations || []),
              JSON.stringify(s.key_events || []), JSON.stringify(s.foreshadowing_planted || []),
              JSON.stringify(s.foreshadowing_recovered || []), JSON.stringify(s.character_changes || {}),
              JSON.stringify(s.world_changes || {}),
            ]
            if (prevSum) {
              await window.electronAPI!.db.run(
                `UPDATE chapter_summaries SET summary=?,characters_appeared=?,locations=?,key_events=?,foreshadowing_planted=?,foreshadowing_recovered=?,character_changes=?,world_changes=? WHERE project_id=? AND chapter_number=?`,
                [...data, Number(id), chapNum]
              )
            } else {
              await window.electronAPI!.db.run(
                `INSERT INTO chapter_summaries (project_id,chapter_number,summary,characters_appeared,locations,key_events,foreshadowing_planted,foreshadowing_recovered,character_changes,world_changes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
                [Number(id), chapNum, ...data]
              )
            }
            // 同步伏笔注册表
            const pid = Number(id)
            const planted: string[] = Array.isArray(s.foreshadowing_planted) ? s.foreshadowing_planted : []
            for (let fi = 0; fi < planted.length; fi++) {
              const nextId = `F${String(chapNum).padStart(3,'0')}-${fi+1}`
              await window.electronAPI!.db.run(
                `INSERT OR IGNORE INTO foreshadowing_registry (project_id,foreshadow_id,description,status,planted_chapter) VALUES (?,?,?,?,?)`,
                [pid, nextId, planted[fi], 'planted', chapNum]
              )
            }
            const recovered: string[] = Array.isArray(s.foreshadowing_recovered) ? s.foreshadowing_recovered : []
            for (const recDesc of recovered) {
              await window.electronAPI!.db.run(
                `UPDATE foreshadowing_registry SET status='resolved',resolved_chapter=?,updated_at=datetime('now','localtime') WHERE project_id=? AND description LIKE ? AND status!='resolved'`,
                [chapNum, pid, `%${recDesc.slice(0, 20)}%`]
              )
            }
            // 同步时间线
            const keyEvents: string[] = Array.isArray(s.key_events) ? s.key_events : []
            const timeLabels: string[] = Array.isArray(s.time_labels) ? s.time_labels : []
            for (let ei = 0; ei < keyEvents.length; ei++) {
              await window.electronAPI!.db.run(
                `INSERT INTO story_timeline (project_id,chapter_number,event_order,event_description,time_label,location,characters_involved,is_major) VALUES (?,?,?,?,?,?,?,?)`,
                [pid, chapNum, ei, keyEvents[ei], timeLabels[0] || '', Array.isArray(s.locations) ? s.locations[0] || '' : '', JSON.stringify(Array.isArray(s.characters_appeared) ? s.characters_appeared : []), ei === 0 ? 1 : 0]
              )
            }
            // 同步角色成长
            const charChanges: Record<string, string> = s.character_changes || {}
            for (const [cname, desc] of Object.entries(charChanges)) {
              await window.electronAPI!.db.run(
                `INSERT INTO character_arc_log (project_id,character_name,chapter_number,change_type,change_description,before_state) VALUES (?,?,?,'development',?,'')`,
                [pid, cname, chapNum, String(desc)]
              )
            }
            // 同步关系演变
            const relChanges: any[] = Array.isArray(s.relationship_changes) ? s.relationship_changes : []
            for (const rc of relChanges) {
              if (rc.char_a && rc.char_b && rc.change) {
                await window.electronAPI!.db.run(
                  `INSERT INTO relationship_timeline (project_id,char_a,char_b,chapter_number,relation_type,change_description) VALUES (?,?,?,?,?,?)`,
                  [pid, rc.char_a, rc.char_b, chapNum, rc.type || 'ally', rc.change]
                )
              }
            }
          }
        } catch { /* 摘要失败不阻塞 */ }
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

  // 面板宽度
  const [leftWidth, setLeftWidth] = useState(192)
  const [rightWidth, setRightWidth] = useState(334)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [showFuncBar, setShowFuncBar] = useState(false)

  // ========== 校对 ==========
  const handleReview = async () => {
    if (!window.electronAPI || chapters.length < 2) { showToast('error', '至少需要2章才能校对'); return }
    setReviewing(true)
    setReviewResult(null)
    cancelledRef.current = false
    try {
      const chapterContents = chapters.map(ch => ({
        num: ch.chapter_number, title: ch.title, content: ch.content,
      }))
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: REVIEW_SYSTEM },
        { role: 'user', content: REVIEW_USER(project?.title || '', outlineContent, chapterContents) },
      ], '校对检查')
      const cleanReply = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jsonMatch = cleanReply.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        setReviewResult({
          overall_report: parsed.overall_report || reply,
          chapter_fixes: (parsed.chapter_fixes || []).filter((f: any) => f.issues?.length > 0),
        })
      } else {
        setReviewResult({ overall_report: reply, chapter_fixes: [] })
      }
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消校对')
      else showToast('error', '校对失败：' + (e.message || '未知'))
    }
    finally { setReviewing(false) }
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
  const chDone = (n: number) => {
    const ch = chapters.find(c => c.chapter_number === n)
    return ch && (ch.status === 'generated' || ch.status === 'edited')
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
                  <span className="truncate">第{selectedChapter}章 · {plan.function || '—'}{plan.emotional_goal ? ' · ' + plan.emotional_goal : ''}</span>
                  <span className="text-text-placeholder shrink-0 text-[10px]">{showFuncBar ? '▲' : '▼'}</span>
                </button>
                {showFuncBar && (
                  <div className="px-3 pb-1.5 flex flex-wrap gap-x-3 border-t border-primary/10 pt-1.5">
                    <span><span className="text-text-placeholder">功能：</span>{plan.function || '—'}</span>
                    {plan.emotional_goal && <span><span className="text-text-placeholder">情绪：</span>{plan.emotional_goal}</span>}
                    <span className="truncate"><span className="text-text-placeholder">概要：</span>{plan.summary}</span>
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
                    {personalityProjects.filter(p => !!(p.personality_data as any)?.emotional_intensity).length === 0 ? <p className="text-xs text-text-placeholder">暂无可用的</p> :
                      personalityProjects.filter(p => !!(p.personality_data as any)?.emotional_intensity).map(p => {
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
            <DeslopPanel content={editingContent} onApply={(c) => { setEditingContent(c); handleSave() }} />
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
          ) : (
            <textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              className="w-full h-full min-h-[400px] px-10 py-8 text-base leading-relaxed
                focus:outline-none focus:shadow-glow rounded-card resize-none
                bg-white shadow-card placeholder:text-text-placeholder"
              placeholder="在左侧目录选择章节，点击「生成本章」开始..."
            />
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
      <aside className="shrink-0 bg-bg-secondary/50 flex flex-col" style={{ width: rightCollapsed ? 36 : rightWidth }}>
        {/* Tab 切换 */}
        <div className="flex border-b border-border shrink-0 items-center">
          <button onClick={() => setRightCollapsed(!rightCollapsed)}
            className="text-xs text-text-placeholder hover:text-text-main shrink-0 w-6 h-6 flex items-center justify-center"
            title={rightCollapsed ? '展开面板' : '折叠面板'}
          >{rightCollapsed ? '◀' : '▶'}</button>
          {!rightCollapsed && (['outline', 'volumes', 'settings', 'foreshadowing', 'timeline', 'review'] as const).map(tab => (
            <button key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 py-1.5 text-[11px] font-medium transition-colors text-center
                ${rightTab === tab ? 'text-primary border-b-2 border-primary' : 'text-text-secondary hover:text-text-main'}
              `}>
              {{ outline: '大纲', volumes: '细纲', settings: '设定',
                 foreshadowing: '伏笔', timeline: '时间线', review: '校对' }[tab]}
            </button>
          ))}
        </div>

        {!rightCollapsed && <div className="flex-1 overflow-auto">
          {/* 大纲 Tab */}
          {rightTab === 'outline' && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-main">故事大纲</span>
                <div className="flex gap-2">
                  {outlineContent && (
                    <button onClick={() => setFullView({ title: '故事大纲', content: outlineContent })}
                      className="text-xs text-primary hover:underline">📖 全屏查看</button>
                  )}
                  <button onClick={() => setShowGenPanel(showGenPanel === 'outline' ? null : 'outline')} disabled={generating}
                    className="text-xs text-primary hover:underline disabled:opacity-50">🔄 重新生成</button>
                </div>
              </div>
              {outlineContent ? (
                <pre className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed max-h-[calc(100vh-200px)] overflow-auto">
                  {outlineContent}
                </pre>
              ) : (
                <div className="text-center py-8">
                  <p className="text-xs text-text-placeholder mb-2">尚无大纲</p>
                  <button onClick={() => setShowGenPanel(showGenPanel === 'outline' ? null : 'outline')} disabled={generating}
                    className="px-3 py-1 text-xs bg-primary text-white rounded-btn">🤖 生成大纲</button>
                </div>
              )}
            </div>
          )}

          {/* 细纲 Tab */}
          {rightTab === 'volumes' && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-main">卷纲与细纲</span>
                <div className="flex gap-2">
                  <button onClick={addVolume}
                    className="text-xs text-primary hover:underline">＋新建卷</button>
                  <button onClick={() => setShowGenPanel(showGenPanel === 'volumes' ? null : 'volumes')} disabled={generating || !outlineContent}
                    className="text-xs text-primary hover:underline disabled:opacity-50">📐 生成下一卷</button>
                </div>
              </div>

              {volumes.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-text-placeholder mb-2">尚无卷纲</p>
                  <button onClick={() => setShowGenPanel(showGenPanel === 'volumes' ? null : 'volumes')} disabled={generating || !outlineContent}
                    className="px-3 py-1 text-xs bg-primary text-white rounded-btn disabled:opacity-50">🤖 生成下一卷</button>
                </div>
              ) : (
                <div className="space-y-2">
                  {volumes.map(vol => {
                    const isExpanded = expandedVolume === vol.volume_number
                    const volPlans = chapterPlans.filter(
                      p => p.chapter_number >= vol.chapter_range[0] && p.chapter_number <= vol.chapter_range[1]
                    )
                    return (
                      <div key={vol.volume_number}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => { if (dragChapter) { moveChapterToVolume(dragChapter, vol.volume_number); setDragChapter(null) } }}
                        className={`border border-border rounded-card overflow-hidden transition-colors
                          ${dragChapter ? 'border-primary/50 bg-primary-light/10' : ''}`}
                      >
                        <button
                          onClick={() => setExpandedVolume(isExpanded ? null : vol.volume_number)}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary transition-colors text-left"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-text-main truncate">{vol.title}</div>
                            <div className="text-xs text-text-placeholder">第{vol.chapter_range[0]}-{vol.chapter_range[1]}章 · {vol.theme}</div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); deleteVolume(vol.volume_number) }}
                              className="text-xs text-text-placeholder hover:text-danger" title="删除此卷">🗑</button>
                            <span className="text-xs text-text-placeholder">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="border-t border-border px-3 py-2 space-y-2">
                            {/* 核心信息：始终显示 */}
                            {vol.detailed_summary ? (
                              <div>
                                <p className="text-xs font-medium text-text-secondary mb-0.5">📖 剧情详述</p>
                                <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{vol.detailed_summary}</p>
                              </div>
                            ) : (
                              <p className="text-xs text-text-secondary">{vol.summary || vol.theme}</p>
                            )}
                            {((vol.key_events?.length || vol.key_events_str) && (
                              <div>
                                <p className="text-xs font-medium text-text-secondary mb-0.5">⚡ 关键事件</p>
                                <p className="text-xs text-text-secondary">
                                  {(vol.key_events_str || vol.key_events?.map((e: any) => typeof e === 'string' ? e : `${e.event}(${e.chapters})`).join('、'))}
                                </p>
                              </div>
                            ))}
                            {vol.character_arcs && (
                              <div>
                                <p className="text-xs font-medium text-text-secondary mb-0.5">👤 角色弧线</p>
                                <p className="text-xs text-text-secondary whitespace-pre-wrap">{vol.character_arcs}</p>
                              </div>
                            )}
                            {vol.emotional_curve && (
                              <div>
                                <p className="text-xs font-medium text-text-secondary mb-0.5">🎭 情感曲线</p>
                                <p className="text-xs text-text-secondary">{vol.emotional_curve}</p>
                              </div>
                            )}
                            {/* 展开更多：v1.4.0 高级字段 */}
                            {((vol.pacing_design || vol.emotional_cadence || vol.word_count_target || vol.connection_prev || vol.connection_next || vol.foreshadowing_plant?.length || vol.foreshadowing_payoff?.length || vol.foreshadowing_advance || vol.character_milestones?.length || vol.conflict_nodes?.length)) && (
                              <MoreFields vol={vol} />
                            )}
                            <div className="flex gap-1.5 flex-wrap">
                              <button
                                onClick={async () => {
                                  for (let c = vol.chapter_range[0]; c <= vol.chapter_range[1]; c++) {
                                    if (!chapterPlans.find(p => p.chapter_number === c)) {
                                      await genSingleChapterPlan(c)
                                    }
                                  }
                                }}
                                disabled={generating}
                                className="px-2 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50"
                              >🤖 一键生成全卷</button>
                              <button
                                onClick={() => setFullView({
                                  title: vol.title,
                                  content: [
                                    `# ${vol.title}`,
                                    `**主题**：${vol.theme}`,
                                    `**章节范围**：第${vol.chapter_range[0]}-${vol.chapter_range[1]}章`,
                                    vol.word_count_target ? `**字数目标**：${vol.word_count_target.toLocaleString()} 字` : '',
                                    vol.connection_prev ? `**承上**：${vol.connection_prev}` : '',
                                    vol.connection_next ? `**启下**：${vol.connection_next}` : '',
                                    '',
                                    `**剧情详述**：${vol.detailed_summary || vol.summary}`,
                                    vol.pacing_design ? `**节奏设计**：${vol.pacing_design}` : '',
                                    vol.emotional_cadence ? `**情绪节奏**：${vol.emotional_cadence}` : '',
                                    vol.character_arcs ? `**角色弧线**：${vol.character_arcs}` : '',
                                    vol.emotional_curve ? `**情感曲线**：${vol.emotional_curve}` : '',
                                    `**关键事件**：${vol.key_events.join('、')}`,
                                    '',
                                    vol.character_milestones?.length ? `**人物里程碑**：\n${vol.character_milestones.map(cm => `- ${cm.character}: ${cm.start_state} → ${cm.end_state} (${cm.key_event})`).join('\n')}` : '',
                                    vol.conflict_nodes?.length ? `**关键冲突节点**：\n${vol.conflict_nodes.map(cn => `- [${cn.chapter_segment}] ${cn.description} (${cn.escalation_type})`).join('\n')}` : '',
                                    vol.foreshadowing_plant?.length ? `**🪝 本卷新埋**：${vol.foreshadowing_plant.join('、')}` : '',
                                    vol.foreshadowing_payoff?.length ? `**✅ 本卷回收**：${vol.foreshadowing_payoff.join('、')}` : '',
                                    vol.foreshadowing_advance ? `**🔗 伏笔推进**：${vol.foreshadowing_advance}` : '',
                                    vol.foreshadowing_planted?.length ? `**🪝 新伏笔**：${vol.foreshadowing_planted.join('、')}` : '',
                                    vol.foreshadowing_recovered?.length ? `**✅ 回收伏笔**：${vol.foreshadowing_recovered.join('、')}` : '',
                                    '',
                                    '## 本卷章节细纲',
                                    ...volPlans.map(p => `### 第${p.chapter_number}章 ${p.title}\n${p.summary}\n人物：${p.characters.join('、')}\n事件：${p.key_events.join('、')}\n字数：${p.estimated_words}`)
                                  ].filter(Boolean).join('\n\n')
                                })}
                                className="px-2 py-1 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary"
                              >📖 查看完整</button>
                            </div>
                            {/* 逐章生成列表 */}
                            <div className="space-y-0.5 mt-1 max-h-64 overflow-auto">
                              {Array.from({ length: vol.chapter_range[1] - vol.chapter_range[0] + 1 }, (_, i) => vol.chapter_range[0] + i).map(cn => {
                                const plan = chapterPlans.find(p => p.chapter_number === cn)
                                const prevPlan = cn > vol.chapter_range[0] ? chapterPlans.find(p => p.chapter_number === cn - 1) : true
                                if (!plan) {
                                  return (
                                    <div key={cn} className="flex items-center gap-1.5 text-xs text-text-placeholder px-2 py-0.5">
                                      <span>○</span><span className="flex-1">{cn}. 未生成</span>
                                      <button onClick={() => genSingleChapterPlan(cn)}
                                        disabled={generating || !prevPlan}
                                        className="text-primary hover:underline disabled:opacity-30 text-xs">
                                        {!prevPlan ? '需上章' : '生成'}
                                      </button>
                                    </div>
                                  )
                                }
                                return (
                                  <div key={cn}
                                    draggable onDragStart={() => setDragChapter(cn)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={() => { if (dragChapter) { moveChapterToVolume(dragChapter, vol.volume_number); setDragChapter(null) } }}
                                    onClick={() => setFullView({
                                      title: `第${cn}章细纲：${plan.title}`,
                                      content: `# 第${cn}章 ${plan.title}\n\n**功能**：${(plan as any).function || '—'}\n**情绪目标**：${(plan as any).emotional_goal || '—'}\n**结尾**：${(plan as any).ending_type || '—'}\n**字数**：${plan.estimated_words}字\n\n**概要**\n${plan.summary}\n\n**人物**：${plan.characters.join('、')}\n\n**关键事件**\n${plan.key_events.map((e: string) => '- ' + e).join('\n')}`
                                    })}
                                    className={`text-xs rounded px-2 py-0.5 cursor-pointer flex items-center gap-1.5 transition-colors
                                      ${dragChapter === cn ? 'opacity-50' : ''}
                                      ${selectedChapter === cn ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-bg-secondary'}`}>
                                    <span className={chDone(cn) ? 'text-success' : 'text-text-placeholder'}>{chDone(cn) ? '●' : '○'}</span>
                                    <span className="flex-1 truncate">{cn}. {plan.title}</span>
                                    <button onClick={(e) => { e.stopPropagation(); genSingleChapterPlan(cn) }}
                                      className="text-text-placeholder hover:text-primary text-xs" title="重新生成">🔄</button>
                                    <span className="text-text-placeholder cursor-grab" title="拖拽">⠿</span>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
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
            <TimelinePanel projectId={Number(id)} chapters={chapters.map(c => ({ chapter_number: c.chapter_number, title: c.title }))} />
          )}

          {/* 校对 Tab */}
          {rightTab === 'review' && (
            <div className="p-3 overflow-auto flex-1">
              {reviewing ? (
                <div className="flex gap-2 mb-3">
                  <span className="flex-1 px-3 py-2 text-xs text-warning flex items-center justify-center gap-1"><div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 校对中...</span>
                  <button onClick={() => handleCancel()} className="px-3 py-2 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消</button>
                </div>
              ) : (
                <button onClick={handleReview} disabled={chapters.length < 2}
                  className="w-full px-3 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50 mb-3">
                  🔍 执行校对
                </button>
              )}

              {!reviewResult && !reviewing && (
                <p className="text-xs text-text-placeholder text-center py-8">
                  生成至少 2 章后可执行校对，检查人物一致性、情节连贯、时间线和伏笔
                </p>
              )}

              {reviewResult && (
                <div className="space-y-3">
                  {/* 整体评价 */}
                  <details className="bg-white rounded-card border border-border">
                    <summary className="px-3 py-2 text-xs font-medium text-text-main cursor-pointer">📋 整体评价</summary>
                    <p className="px-3 pb-2 text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">{reviewResult.overall_report}</p>
                  </details>

                  {/* 逐章问题 */}
                  {reviewResult.chapter_fixes.length === 0 ? (
                    <p className="text-xs text-success text-center py-4">✅ 未发现明显问题</p>
                  ) : (
                    reviewResult.chapter_fixes.map(fix => {
                      const sevColors: Record<string, string> = { 'S1': 'bg-red-600', 'S2': 'bg-orange-500', 'S3': 'bg-yellow-500', 'S4': 'bg-gray-400', '严重': 'bg-danger', '中等': 'bg-warning', '轻微': 'bg-text-placeholder' }
                      const sevLabels: Record<string, string> = { 'S1': 'S1 硬事实冲突', 'S2': 'S2 软设定冲突', 'S3': 'S3 风格不一致', 'S4': 'S4 质量建议' }
                      const isEditing = editingFixPrompt === fix.chapter_number
                      return (
                        <div key={fix.chapter_number} className="bg-white rounded-card border border-border p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-text-main">第{fix.chapter_number}章</span>
                            <span className={`text-[10px] text-white px-1.5 py-0.5 rounded-full ${sevColors[fix.severity] || 'bg-text-placeholder'}`}>{sevLabels[fix.severity] || fix.severity}</span>
                          </div>
                          <ul className="text-xs text-text-secondary mb-2 space-y-0.5">
                            {fix.issues.map((issue, i) => (
                              <li key={i} className="flex gap-1"><span className="text-text-placeholder shrink-0">{i + 1}.</span><span>{issue}</span></li>
                            ))}
                          </ul>
                          {/* 修改提示 — 可编辑 */}
                          {isEditing ? (
                            <div className="mb-2">
                              <textarea
                                value={editFixPromptText}
                                onChange={(e) => setEditFixPromptText(e.target.value)}
                                rows={4}
                                className="w-full px-2 py-1 text-xs border border-primary rounded resize-none focus:outline-none"
                              />
                              <div className="flex gap-2 mt-1">
                                <button onClick={() => {
                                  const updated = reviewResult.chapter_fixes.map(f =>
                                    f.chapter_number === fix.chapter_number ? { ...f, fix_prompt: editFixPromptText } : f
                                  )
                                  setReviewResult({ ...reviewResult, chapter_fixes: updated })
                                  setEditingFixPrompt(null)
                                }} className="text-xs text-primary hover:underline">💾 保存</button>
                                <button onClick={() => setEditingFixPrompt(null)} className="text-xs text-text-placeholder hover:underline">取消</button>
                              </div>
                            </div>
                          ) : (
                            <pre
                              onClick={() => { setEditingFixPrompt(fix.chapter_number); setEditFixPromptText(fix.fix_prompt) }}
                              className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed mb-2 p-2 bg-bg-secondary rounded cursor-pointer hover:bg-border/30"
                              title="点击编辑修改提示"
                            >{fix.fix_prompt}</pre>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                const text = isEditing ? editFixPromptText : fix.fix_prompt
                                navigator.clipboard.writeText(text).then(
                                  () => showToast('success', '修改提示已复制！粘贴到生成面板的「额外提示」框中使用'),
                                  () => showToast('error', '复制失败，请手动复制')
                                )
                              }}
                              className="flex-1 px-2 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light/20"
                            >📋 复制修改提示</button>
                            <button
                              onClick={() => autoFixChapter(fix.chapter_number, fix.issues, isEditing ? editFixPromptText : fix.fix_prompt)}
                              disabled={fixingChapter === fix.chapter_number}
                              className="flex-1 px-2 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50"
                            >{fixingChapter === fix.chapter_number ? '⏳ 修改中...' : '🤖 自动修改'}</button>
                          {fixingChapter === fix.chapter_number && (
                            <button onClick={() => handleCancel()} className="px-2 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10 shrink-0">⏹</button>
                          )}
                          </div>
                        </div>
                      )
                    })
                  )}
                  <p className="text-[10px] text-text-placeholder text-center pb-2">
                    💡 「复制修改提示」后粘贴到生成面板的「额外提示」输入框，重新生成即可 | 「自动修改」仅处理可精确定位的文字问题
                  </p>
                </div>
              )}
            </div>
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
              <h2 className="text-section-title">{genConfig.title}</h2>
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

      {/* 全屏查看弹窗 */}
      {fullView && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setFullView(null)}>
          <div className="bg-white rounded-card shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-section-title text-text-main">{fullView.title}</h2>
              <button onClick={() => setFullView(null)} className="w-8 h-8 flex items-center justify-center rounded-btn hover:bg-bg-secondary text-text-secondary">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <pre className="text-base text-text-main whitespace-pre-wrap leading-relaxed font-sans">{fullView.content}</pre>
            </div>
            <div className="px-5 py-3 border-t border-border text-right">
              <button onClick={() => setFullView(null)} className="px-4 py-2 bg-primary text-white rounded-btn text-body hover:bg-primary-hover">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
