import { useState, useEffect, useCallback } from 'react'
import { showToast } from '../common/Toast'
import type { CharacterCard, WorldSetting, CharacterRoleType, WorldCategory } from '../../types'

const ROLE_LABELS: Record<CharacterRoleType, string> = {
  main: '主角', support: '配角', antagonist: '反派', minor: '次要'
}
const ROLE_COLORS: Record<CharacterRoleType, string> = {
  main: 'bg-warning/10 text-warning', support: 'bg-primary-light/50 text-primary',
  antagonist: 'bg-danger/10 text-danger', minor: 'text-text-placeholder'
}

const CATEGORY_LABELS: Record<WorldCategory, string> = {
  location: '地点', faction: '势力', rule: '规则', timeline: '时间线', general: '通用'
}

interface Props {
  projectId: number
  refreshTrigger?: number
  onRefresh?: () => void
  genLoading: boolean
  onGenLoadingChange: (v: boolean) => void
}

export default function CardPanel({ projectId, refreshTrigger, onRefresh, genLoading, onGenLoadingChange }: Props) {
  const [chapterInput, setChapterInput] = useState('')
  const [showChapterInput, setShowChapterInput] = useState(false)
  const [tab, setTab] = useState<'characters' | 'world'>('characters')
  const [characters, setCharacters] = useState<CharacterCard[]>([])
  const [worlds, setWorlds] = useState<WorldSetting[]>([])
  const [loaded, setLoaded] = useState(false)

  // 编辑弹窗
  const [editingChar, setEditingChar] = useState<CharacterCard | null>(null)
  const [editingWorld, setEditingWorld] = useState<WorldSetting | null>(null)
  const [showCharForm, setShowCharForm] = useState(false)
  const [showWorldForm, setShowWorldForm] = useState(false)

  // 展开状态
  const [expandedChar, setExpandedChar] = useState<number | null>(null)
  const [expandedWorld, setExpandedWorld] = useState<number | null>(null)

  // 离开时取消生成
  useEffect(() => { return () => { if (genLoading) window.electronAPI?.cancelAi() } })

  const loadCards = useCallback(async () => {
    if (!window.electronAPI) { setLoaded(true); return }
    try {
      const chars = await window.electronAPI.db.query(
        'SELECT * FROM character_cards WHERE project_id = ? ORDER BY CASE role_type WHEN "main" THEN 1 WHEN "antagonist" THEN 2 WHEN "support" THEN 3 ELSE 4 END',
        [projectId]
      )
      setCharacters(chars.map((c: any) => ({
        ...c,
        relationships: safeJson(c.relationships, []),
        status_tracking: safeJson(c.status_tracking, {}),
      })))

      const ws = await window.electronAPI.db.query(
        'SELECT * FROM world_settings WHERE project_id = ? ORDER BY priority ASC, is_global DESC',
        [projectId]
      )
      setWorlds(ws)
    } catch (e) { /* ignore */ }
    setLoaded(true)
  }, [projectId])

  useEffect(() => { loadCards() }, [loadCards, refreshTrigger])

  const safeJson = (val: string, fallback: any) => { try { return JSON.parse(val) } catch { return fallback } }

  /** 从 AI 回复中提取 JSON，带容错 */
  const extractJson = (reply: string): any | null => {
    let clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const jm = clean.match(/\{[\s\S]*\}/)
    if (!jm) return null
    try { return JSON.parse(jm[0]) } catch {
      // 尝试修复常见 JSON 错误：移除尾部逗号、修复未闭合字符串
      try {
        let fixed = jm[0]
          .replace(/,\s*}/g, '}')       // trailing comma before }
          .replace(/,\s*\]/g, ']')       // trailing comma before ]
          .replace(/\n/g, ' ')           // newlines in strings
        return JSON.parse(fixed)
      } catch {
        return null
      }
    }
  }

  // ===== 自动生成角色和世界卡片 =====
  const autoGenerateCards = async () => {
    if (!window.electronAPI) return
    onGenLoadingChange(true)
    try {
      // 读取大纲
      const outline = await window.electronAPI.db.get(
        'SELECT content FROM outlines WHERE project_id = ? ORDER BY version DESC LIMIT 1', [projectId]
      )
      // 读取拆文库引用
      const proj = await window.electronAPI.db.get(
        'SELECT primary_style_id, auxiliary_style_ids FROM novel_projects WHERE id = ?', [projectId]
      )
      let disContext = ''
      if (proj?.primary_style_id || proj?.auxiliary_style_ids) {
        const dissIds = JSON.parse(proj.auxiliary_style_ids || '[]')
        if (proj.primary_style_id) dissIds.unshift(proj.primary_style_id)
        // Actually primary_style_id is for style library, not disassembly. Let's read disassembly projects separately.
      }
      // Read disassembly projects
      const dissProjs = await window.electronAPI.db.query(
        'SELECT name, stage_results FROM disassembly_projects WHERE current_stage >= 1 ORDER BY updated_at DESC LIMIT 3'
      )
      if (dissProjs.length) {
        disContext = dissProjs.map((d: any) => {
          const r = safeJson(d.stage_results, {})
          return `【参考书】${d.name}\n${[r.stage0, r.stage1, r.stage3].filter(Boolean).join('\n').slice(0, 2000)}`
        }).join('\n\n---\n\n')
      }

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: `你是小说设定提取专家。根据大纲和拆文参考，自动提取角色和世界设定。

## 角色提取规则
1. 从大纲中识别所有重要角色（主角、反派、盟友、次要角色）
2. 为每个角色提取：姓名、角色类型(main/antagonist/support/minor)、性格、背景、外貌、能力
3. 分析角色之间的关系

## 世界设定提取规则
1. 从大纲中识别所有重要地点、势力、规则体系
2. 分类：地点(location)/势力(faction)/规则(rule)/时间线(timeline)/通用(general)
3. 为每个设定标注触发关键词

## 输出格式
严格的JSON，不要markdown代码块：
{
  "characters": [
    { "name": "角色名", "role_type": "main", "personality": "性格", "background": "背景", "appearance": "外貌", "abilities": "能力", "relationships": [{"name":"相关角色","relation":"关系描述","description":"说明"}], "status_tracking": {"current_status": "存活","location":"初始位置","goal":"目标"}, "notes": "" }
  ],
  "worlds": [
    { "name": "设定名", "category": "location", "description": "简述", "details": "详细内容", "trigger_keywords": "关键词1,关键词2", "priority": 1, "is_global": 0, "notes": "" }
  ]
}` },
        { role: 'user', content: `【大纲】
${(outline?.content || '暂无大纲').slice(0, 5000)}

【拆文参考】
${disContext || '无'}

请提取角色和世界设定。只输出JSON。` },
      ], '卡片自动生成')

      const parsed = extractJson(reply)
      if (!parsed) { showToast('error', 'AI 返回格式异常，请重试'); return }
      let charCount = 0, worldCount = 0

      // 保存角色
      if (parsed.characters?.length) {
        for (const c of parsed.characters) {
          if (!c.name) continue
          // 检查重名，跳过已存在的
          const existing = await window.electronAPI.db.get(
            'SELECT id FROM character_cards WHERE project_id = ? AND name = ?', [projectId, c.name]
          )
          if (existing) continue
          await window.electronAPI.db.run(
            `INSERT INTO character_cards (project_id, name, role_type, personality, background, appearance, abilities, relationships, status_tracking, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [projectId, c.name, c.role_type || 'support', c.personality || '', c.background || '', c.appearance || '', c.abilities || '',
              JSON.stringify(c.relationships || []), JSON.stringify(c.status_tracking || {}), c.notes || '']
          )
          charCount++
        }
      }

      // 保存世界设定
      if (parsed.worlds?.length) {
        for (const w of parsed.worlds) {
          if (!w.name) continue
          const existing = await window.electronAPI.db.get(
            'SELECT id FROM world_settings WHERE project_id = ? AND name = ?', [projectId, w.name]
          )
          if (existing) continue
          await window.electronAPI.db.run(
            `INSERT INTO world_settings (project_id, name, category, description, details, trigger_keywords, priority, is_global, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
            [projectId, w.name, w.category || 'general', w.description || '', w.details || '', w.trigger_keywords || '', w.priority || 0, w.is_global || 0, w.notes || '']
          )
          worldCount++
        }
      }

      loadCards()
      onRefresh?.()
      const dupInfo = (parsed.characters?.length - charCount) + (parsed.worlds?.length - worldCount)
      showToast('success', `已生成 ${charCount} 个角色 + ${worldCount} 个设定${dupInfo > 0 ? `（跳过 ${dupInfo} 个重复）` : ''}`)
    } catch (e: any) {
      const msg = e.message || '未知'
      if (msg.includes('abort') || msg.includes('Abort')) showToast('info', '已取消生成')
      else showToast('error', '自动生成失败：' + msg)
    }
    finally { onGenLoadingChange(false) }
  }

  // ===== 从选定章节生成角色和设定 =====
  const doGenerateFromChapters = async (input: string) => {
    if (!window.electronAPI) return
    const nums = input.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n))
    if (!nums.length) { showToast('error', '请输入有效的章节号'); return }
    setShowChapterInput(false); setChapterInput('')
    onGenLoadingChange(true)
    try {
      const chapters = await window.electronAPI.db.query(
        `SELECT chapter_number, title, content FROM chapters WHERE project_id = ? AND chapter_number IN (${nums.join(',')}) ORDER BY chapter_number`,
        [projectId]
      )
      if (!chapters.length) { showToast('error', '未找到指定章节，请先生成章节内容'); return }

      const chText = (chapters as any[]).map((ch: any) =>
        `### 第${ch.chapter_number}章 ${ch.title}\n${(ch.content || '').slice(0, 3000)}`
      ).join('\n\n---\n\n')

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: `你是小说设定提取专家。根据章节正文，提取其中出现的角色和世界设定。

## 输出格式
严格的JSON：{"characters":[{角色信息}],"worlds":[{设定信息}]}

## 注意
- 只提取章节中实际出现的角色和设定
- 角色字段：name, role_type(main/antagonist/support/minor), personality, background, appearance, abilities, relationships, status_tracking, notes
- 设定字段：name, category(location/faction/rule/timeline/general), description, details, trigger_keywords, priority, is_global, notes
- 如果信息不足，字段留空字符串` },
        { role: 'user', content: `【章节内容】\n${chText}\n\n请提取角色和设定。只输出JSON。` },
      ], '卡片-从章节生成')

      const parsed = extractJson(reply)
      if (!parsed) { showToast('error', 'AI 返回格式异常，请重试'); return }
      let charCount = 0, worldCount = 0

      if (parsed.characters?.length) {
        for (const c of parsed.characters) {
          if (!c.name) continue
          const existing = await window.electronAPI.db.get('SELECT id FROM character_cards WHERE project_id = ? AND name = ?', [projectId, c.name])
          if (existing) continue
          await window.electronAPI.db.run(
            `INSERT INTO character_cards (project_id, name, role_type, personality, background, appearance, abilities, relationships, status_tracking, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [projectId, c.name, c.role_type || 'support', c.personality || '', c.background || '', c.appearance || '', c.abilities || '',
              JSON.stringify(c.relationships || []), JSON.stringify(c.status_tracking || {}), c.notes || '']
          )
          charCount++
        }
      }
      if (parsed.worlds?.length) {
        for (const w of parsed.worlds) {
          if (!w.name) continue
          const existing = await window.electronAPI.db.get('SELECT id FROM world_settings WHERE project_id = ? AND name = ?', [projectId, w.name])
          if (existing) continue
          await window.electronAPI.db.run(
            `INSERT INTO world_settings (project_id, name, category, description, details, trigger_keywords, priority, is_global, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
            [projectId, w.name, w.category || 'general', w.description || '', w.details || '', w.trigger_keywords || '', w.priority || 0, w.is_global || 0, w.notes || '']
          )
          worldCount++
        }
      }
      loadCards(); onRefresh?.()
      showToast('success', `从章节生成了 ${charCount} 个角色 + ${worldCount} 个设定`)
    } catch (e: any) {
      const msg = e.message || '未知'
      if (msg.includes('abort') || msg.includes('Abort')) showToast('info', '已取消生成')
      else showToast('error', '生成失败：' + msg)
    }
    finally { onGenLoadingChange(false) }
  }

  // ===== 角色卡片表单 =====
  const CharForm = ({ initial }: { initial?: CharacterCard }) => {
    const [name, setName] = useState(initial?.name || '')
    const [roleType, setRoleType] = useState<CharacterRoleType>(initial?.role_type || 'main')
    const [personality, setPersonality] = useState(initial?.personality || '')
    const [background, setBackground] = useState(initial?.background || '')
    const [appearance, setAppearance] = useState(initial?.appearance || '')
    const [abilities, setAbilities] = useState(initial?.abilities || '')
    const [relText, setRelText] = useState(
      initial?.relationships?.map(r => `${r.name}:${r.relation}:${r.description}`).join('\n') || ''
    )
    const [status, setStatus] = useState(initial?.status_tracking?.current_status || '')
    const [location, setLocation] = useState(initial?.status_tracking?.location || '')
    const [goal, setGoal] = useState(initial?.status_tracking?.goal || '')
    const [notes, setNotes] = useState(initial?.notes || '')
    const [localLoading, setLocalLoading] = useState(false)

    const aiAutocomplete = async () => {
      if (!name.trim()) { showToast('error', '请先输入角色名'); return }
      if (!window.electronAPI) return
      setLocalLoading(true)
      try {
        const outline = await window.electronAPI.db.get('SELECT content FROM outlines WHERE project_id = ? ORDER BY version DESC LIMIT 1', [projectId])
        const reply = await window.electronAPI.aiChat([
          { role: 'system', content: '你是小说角色设计师。根据角色名和大纲，补全角色的详细信息。只输出JSON：{"personality":"性格","background":"背景","appearance":"外貌","abilities":"能力","notes":"备注"}。不要在JSON外加任何文字。' },
          { role: 'user', content: `角色名：${name}\n\n大纲：${(outline?.content || '').slice(0, 3000)}` },
        ], 'AI补全角色')
        const d = extractJson(reply)
        if (d) {
          if (!personality && d.personality) setPersonality(d.personality)
          if (!background && d.background) setBackground(d.background)
          if (!appearance && d.appearance) setAppearance(d.appearance)
          if (!abilities && d.abilities) setAbilities(d.abilities)
          if (!notes && d.notes) setNotes(d.notes)
          showToast('success', 'AI 已补全信息，请检查后保存')
        }
      } catch (e: any) { showToast('error', '补全失败') }
      finally { setLocalLoading(false) }
    }

    const save = async () => {
      if (!name.trim()) { showToast('error', '请输入角色名称'); return }
      const rels = relText.trim().split('\n').filter(Boolean).map(line => {
        const [n, r, d] = line.split(':')
        return { name: n?.trim() || '', relation: r?.trim() || '', description: d?.trim() || '' }
      })
      const data = {
        name: name.trim(), role_type: roleType, personality, background, appearance, abilities,
        relationships: JSON.stringify(rels),
        status_tracking: JSON.stringify({ current_status: status, location, goal }),
        notes,
      }
      try {
        if (initial) {
          await window.electronAPI.db.run(
            `UPDATE character_cards SET name=?,role_type=?,personality=?,background=?,appearance=?,abilities=?,relationships=?,status_tracking=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?`,
            [data.name, data.role_type, data.personality, data.background, data.appearance, data.abilities, data.relationships, data.status_tracking, data.notes, initial.id]
          )
        } else {
          await window.electronAPI.db.run(
            `INSERT INTO character_cards (project_id,name,role_type,personality,background,appearance,abilities,relationships,status_tracking,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [projectId, data.name, data.role_type, data.personality, data.background, data.appearance, data.abilities, data.relationships, data.status_tracking, data.notes]
          )
        }
        loadCards()
        closeCharForm()
        showToast('success', initial ? '已更新' : '已创建')
      } catch (e: any) { showToast('error', '保存失败：' + (e.message || '')) }
    }

    const closeCharForm = () => { setShowCharForm(false); setEditingChar(null) }

    return (
      <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={closeCharForm}>
        <div className="bg-white rounded-card shadow-xl w-[480px] max-h-[75vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
            <h2 className="text-sm font-medium">{initial ? '编辑角色' : '新建角色'}</h2>
            <button onClick={closeCharForm} className="text-text-placeholder hover:text-text-main">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">角色名 *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="如：林辰" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">角色类型</label>
                <select value={roleType} onChange={e => setRoleType(e.target.value as CharacterRoleType)} className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">性格特点</label>
              <textarea value={personality} onChange={e => setPersonality(e.target.value)} rows={2} placeholder="如：冷酷果决、心思缜密、重情义..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">背景故事</label>
                <textarea value={background} onChange={e => setBackground(e.target.value)} rows={2} placeholder="角色的过去、动机..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-secondary">外貌特征</label>
                <textarea value={appearance} onChange={e => setAppearance(e.target.value)} rows={2} placeholder="身高、长相、标志性特征..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">能力/金手指</label>
              <input value={abilities} onChange={e => setAbilities(e.target.value)} placeholder="如：灵根被废、医术传承、空间戒指..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">当前状态</label>
                <input value={status} onChange={e => setStatus(e.target.value)} placeholder="存活/受伤/失踪..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-secondary">当前位置</label>
                <input value={location} onChange={e => setLocation(e.target.value)} placeholder="如：青云宗" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-secondary">当前目标</label>
                <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="如：复仇、变强" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">人物关系 (每行一条：角色名:关系:描述)</label>
              <textarea value={relText} onChange={e => setRelText(e.target.value)} rows={3} placeholder={"林雪:盟友:青梅竹马\n张浩:对手:同门竞争"} className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none font-mono" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">备注</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="任何补充说明..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border flex justify-end gap-2 shrink-0">
            <button onClick={aiAutocomplete} disabled={localLoading}
              className="px-4 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light/20 disabled:opacity-50">
              {localLoading ? '⏳' : '🤖 AI 补全'}
            </button>
            <button onClick={closeCharForm} className="px-4 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary">取消</button>
            <button onClick={save} className="px-4 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">保存</button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 世界设定卡片表单 =====
  const WorldForm = ({ initial }: { initial?: WorldSetting }) => {
    const [name, setName] = useState(initial?.name || '')
    const [category, setCategory] = useState<WorldCategory>(initial?.category || 'general')
    const [description, setDesc] = useState(initial?.description || '')
    const [details, setDetails] = useState(initial?.details || '')
    const [triggerKeywords, setKeywords] = useState(initial?.trigger_keywords || '')
    const [priority, setPriority] = useState(initial?.priority || 0)
    const [isGlobal, setIsGlobal] = useState(initial?.is_global === 1)
    const [notes, setNotes] = useState(initial?.notes || '')
    const [localLoading, setLocalLoading] = useState(false)

    const aiAutocomplete = async () => {
      if (!name.trim()) { showToast('error', '请先输入设定名称'); return }
      if (!window.electronAPI) return
      setLocalLoading(true)
      try {
        const outline = await window.electronAPI.db.get('SELECT content FROM outlines WHERE project_id = ? ORDER BY version DESC LIMIT 1', [projectId])
        const reply = await window.electronAPI.aiChat([
          { role: 'system', content: '你是小说世界观设计师。根据设定名称和大纲，补全世界设定的详细信息。只输出JSON：{"category":"location/faction/rule/timeline/general","description":"简述","details":"详细内容","trigger_keywords":"关键词1,关键词2","notes":"备注"}。不要在JSON外加任何文字。' },
          { role: 'user', content: `设定名称：${name}\n\n大纲：${(outline?.content || '').slice(0, 3000)}` },
        ], 'AI补全设定')
        const d = extractJson(reply)
        if (d) {
          if (!category || category === 'general') { const cats: WorldCategory[] = ['location','faction','rule','timeline','general']; if (cats.includes(d.category)) setCategory(d.category) }
          if (!description && d.description) setDesc(d.description)
          if (!details && d.details) setDetails(d.details)
          if (!triggerKeywords && d.trigger_keywords) setKeywords(d.trigger_keywords)
          if (!notes && d.notes) setNotes(d.notes)
          showToast('success', 'AI 已补全信息，请检查后保存')
        }
      } catch (e: any) { showToast('error', '补全失败') }
      finally { setLocalLoading(false) }
    }

    const save = async () => {
      if (!name.trim()) { showToast('error', '请输入设定名称'); return }
      const data = { name: name.trim(), category, description, details, trigger_keywords: triggerKeywords, priority, is_global: isGlobal ? 1 : 0, notes }
      try {
        if (initial) {
          await window.electronAPI.db.run(
            `UPDATE world_settings SET name=?,category=?,description=?,details=?,trigger_keywords=?,priority=?,is_global=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?`,
            [data.name, data.category, data.description, data.details, data.trigger_keywords, data.priority, data.is_global, data.notes, initial.id]
          )
        } else {
          await window.electronAPI.db.run(
            `INSERT INTO world_settings (project_id,name,category,description,details,trigger_keywords,priority,is_global,notes) VALUES (?,?,?,?,?,?,?,?,?)`,
            [projectId, data.name, data.category, data.description, data.details, data.trigger_keywords, data.priority, data.is_global, data.notes]
          )
        }
        loadCards()
        closeWorldForm()
        showToast('success', initial ? '已更新' : '已创建')
      } catch (e: any) { showToast('error', '保存失败') }
    }

    const closeWorldForm = () => { setShowWorldForm(false); setEditingWorld(null) }

    return (
      <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={closeWorldForm}>
        <div className="bg-white rounded-card shadow-xl w-[480px] max-h-[75vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
            <h2 className="text-sm font-medium">{initial ? '编辑设定' : '新建设定'}</h2>
            <button onClick={closeWorldForm} className="text-text-placeholder hover:text-text-main">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">设定名称 *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="如：青云宗、灵气体系" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">分类</label>
                <select value={category} onChange={e => setCategory(e.target.value as WorldCategory)} className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">简述</label>
              <input value={description} onChange={e => setDesc(e.target.value)} placeholder="一句话描述..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">详细内容</label>
              <textarea value={details} onChange={e => setDetails(e.target.value)} rows={4} placeholder="详细描述..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">触发关键词 (逗号分隔)</label>
                <input value={triggerKeywords} onChange={e => setKeywords(e.target.value)} placeholder="青云宗,长老,修炼..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">优先级 (越小越高)</label>
                <input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} className="w-20 mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={isGlobal} onChange={e => setIsGlobal(e.target.checked)} className="accent-primary" />
                全局注入（不依赖关键词触发）
              </label>
            </div>
            <div>
              <label className="text-xs text-text-secondary">备注</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="补充..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border flex justify-end gap-2 shrink-0">
            <button onClick={aiAutocomplete} disabled={localLoading}
              className="px-4 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light/20 disabled:opacity-50">
              {localLoading ? '⏳' : '🤖 AI 补全'}
            </button>
            <button onClick={closeWorldForm} className="px-4 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary">取消</button>
            <button onClick={save} className="px-4 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">保存</button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 删除角色 =====
  const deleteChar = async (char: CharacterCard) => {
    if (!window.confirm(`确定删除角色「${char.name}」吗？`)) return
    await window.electronAPI.db.run('DELETE FROM character_cards WHERE id = ?', [char.id])
    loadCards()
    showToast('success', `「${char.name}」已删除`)
  }

  // ===== 删除世界设定 =====
  const deleteWorld = async (ws: WorldSetting) => {
    if (!window.confirm(`确定删除设定「${ws.name}」吗？`)) return
    await window.electronAPI.db.run('DELETE FROM world_settings WHERE id = ?', [ws.id])
    loadCards()
    showToast('success', `「${ws.name}」已删除`)
  }

  // ===== 批量删除 =====
  const deleteAllChars = async () => {
    if (!window.confirm(`确定删除全部 ${characters.length} 个角色？此操作不可恢复。`)) return
    await window.electronAPI!.db.run('DELETE FROM character_cards WHERE project_id = ?', [projectId])
    loadCards(); onRefresh?.()
    showToast('success', `已删除全部角色`)
  }
  const deleteAllWorlds = async () => {
    if (!window.confirm(`确定删除全部 ${worlds.length} 个设定？此操作不可恢复。`)) return
    await window.electronAPI!.db.run('DELETE FROM world_settings WHERE project_id = ?', [projectId])
    loadCards(); onRefresh?.()
    showToast('success', `已删除全部设定`)
  }

  if (!loaded) return <div className="p-4 text-xs text-text-placeholder">加载中...</div>

  return (
    <div className="flex flex-col h-full">
      {/* Sub tabs */}
      <div className="flex border-b border-border shrink-0">
        {[
          { key: 'characters' as const, label: `👤 角色 (${characters.length})` },
          { key: 'world' as const, label: `🌍 设定 (${worlds.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors
              ${tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-text-secondary hover:text-text-main'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {/* 角色卡片列表 */}
        {tab === 'characters' && (
          <div className="p-2 space-y-1.5">
            {genLoading ? (
              <div className="flex gap-1.5">
                <span className="flex-1 px-3 py-2 text-xs text-warning flex items-center justify-center gap-1 rounded-btn bg-warning/10">
                  <div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 分析中...
                </span>
                <button onClick={() => window.electronAPI?.cancelAi()} className="px-3 py-2 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹</button>
              </div>
            ) : (
              <button onClick={autoGenerateCards}
                className="w-full px-3 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors">
                🤖 从大纲/拆文自动生成角色和设定
              </button>
            )}
            <div className="flex gap-1.5">
              <button onClick={() => setShowCharForm(true)}
                className="flex-1 px-3 py-2 text-xs border border-dashed border-primary/30 rounded-card text-primary hover:bg-primary-light/30 transition-colors">
                ＋ 新建角色
              </button>
              <button onClick={() => setShowChapterInput(true)} disabled={genLoading}
                className="px-3 py-2 text-xs border border-dashed border-primary/30 rounded-card text-primary hover:bg-primary-light/30 transition-colors"
                title="从已生成的章节提取角色和设定">
                📖 从章节提取
              </button>
            </div>
            {characters.length > 0 && (
              <button onClick={deleteAllChars} className="w-full px-3 py-1 text-xs text-danger border border-danger/30 rounded-btn hover:bg-danger/10 transition-colors">
                🗑 清空全部角色 ({characters.length})
              </button>
            )}
            {characters.length === 0 ? (
              <p className="text-xs text-text-placeholder text-center py-6">暂无角色卡片</p>
            ) : (
              characters.map(char => {
                const isExpanded = expandedChar === char.id
                return (
                  <div key={char.id} className="border border-border rounded-card overflow-hidden">
                    <button
                      onClick={() => setExpandedChar(isExpanded ? null : char.id)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_COLORS[char.role_type]}`}>{ROLE_LABELS[char.role_type]}</span>
                        <span className="text-xs font-medium text-text-main truncate">{char.name}</span>
                      </div>
                      <span className="text-xs text-text-placeholder">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border px-3 py-2 space-y-1.5">
                        {char.personality && <div className="text-xs"><span className="text-text-placeholder">性格：</span>{char.personality}</div>}
                        {char.background && <div className="text-xs"><span className="text-text-placeholder">背景：</span>{char.background}</div>}
                        {char.appearance && <div className="text-xs"><span className="text-text-placeholder">外貌：</span>{char.appearance}</div>}
                        {char.abilities && <div className="text-xs"><span className="text-text-placeholder">能力：</span>{char.abilities}</div>}
                        {(() => { try { const rels = Array.isArray(char.relationships) ? char.relationships : (typeof char.relationships === 'string' ? JSON.parse(char.relationships) : []); return rels.length > 0 && (
                          <div className="text-xs">
                            <span className="text-text-placeholder">关系：</span>
                            {rels.map((r: any, i: number) => (
                              <span key={i} className="inline-block mr-2 bg-bg-secondary px-1 rounded">{r.name}（{r.relation}）</span>
                            ))}
                          </div>
                        )} catch { return null } })()}
                        {(() => { try { const st = typeof char.status_tracking === 'string' ? JSON.parse(char.status_tracking) : (char.status_tracking || {}); return Object.keys(st).length > 0 && (
                          <div className="text-xs">
                            <span className="text-text-placeholder">状态：</span>
                            {st.location && <span>📍{st.location} </span>}
                            {st.current_status && <span>{st.current_status} </span>}
                            {st.goal && <span>→ {st.goal}</span>}
                          </div>
                        );} catch { return null } })()}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => { setEditingChar(char); setShowCharForm(true) }}
                            className="text-xs text-primary hover:underline">编辑</button>
                          <button onClick={() => deleteChar(char)}
                            className="text-xs text-danger hover:underline">删除</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* 世界设定列表 */}
        {tab === 'world' && (
          <div className="p-2 space-y-1.5">
            {genLoading ? (
              <div className="flex gap-1.5">
                <span className="flex-1 px-3 py-2 text-xs text-warning flex items-center justify-center gap-1 rounded-btn bg-warning/10">
                  <div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 分析中...
                </span>
                <button onClick={() => window.electronAPI?.cancelAi()} className="px-3 py-2 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹</button>
              </div>
            ) : (
              <button onClick={autoGenerateCards}
                className="w-full px-3 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors">
                🤖 从大纲/拆文自动生成角色和设定
              </button>
            )}
            <div className="flex gap-1.5">
              <button onClick={() => setShowWorldForm(true)}
                className="flex-1 px-3 py-2 text-xs border border-dashed border-primary/30 rounded-card text-primary hover:bg-primary-light/30 transition-colors">
                ＋ 新建设定
              </button>
              <button onClick={() => setShowChapterInput(true)} disabled={genLoading}
                className="px-3 py-2 text-xs border border-dashed border-primary/30 rounded-card text-primary hover:bg-primary-light/30 transition-colors"
                title="从已生成的章节提取角色和设定">
                📖 从章节提取
              </button>
            </div>
            {worlds.length > 0 && (
              <button onClick={deleteAllWorlds} className="w-full px-3 py-1 text-xs text-danger border border-danger/30 rounded-btn hover:bg-danger/10 transition-colors">
                🗑 清空全部设定 ({worlds.length})
              </button>
            )}
            {worlds.length === 0 ? (
              <p className="text-xs text-text-placeholder text-center py-6">暂无世界设定</p>
            ) : (
              worlds.map(ws => {
                const isExpanded = expandedWorld === ws.id
                return (
                  <div key={ws.id} className="border border-border rounded-card overflow-hidden">
                    <button
                      onClick={() => setExpandedWorld(isExpanded ? null : ws.id)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-text-placeholder">{CATEGORY_LABELS[ws.category]}</span>
                        <span className="text-xs font-medium text-text-main truncate">{ws.name}</span>
                        {ws.is_global ? <span className="text-xs text-primary">🌐</span> : null}
                      </div>
                      <span className="text-xs text-text-placeholder">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border px-3 py-2 space-y-1.5">
                        {ws.description && <div className="text-xs text-text-secondary">{ws.description}</div>}
                        {ws.details && <div className="text-xs text-text-secondary whitespace-pre-wrap">{ws.details}</div>}
                        {ws.trigger_keywords && (
                          <div className="text-xs">
                            <span className="text-text-placeholder">触发词：</span>
                            {ws.trigger_keywords.split(',').filter(Boolean).map((k, i) => (
                              <span key={i} className="inline-block mr-1 bg-bg-secondary px-1 rounded">{k.trim()}</span>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => { setEditingWorld(ws); setShowWorldForm(true) }}
                            className="text-xs text-primary hover:underline">编辑</button>
                          <button onClick={() => deleteWorld(ws)}
                            className="text-xs text-danger hover:underline">删除</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* 表单弹窗 */}
      {showCharForm && <CharForm initial={editingChar || undefined} />}
      {showWorldForm && <WorldForm initial={editingWorld || undefined} />}

      {/* 章节号输入弹窗 */}
      {showChapterInput && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setShowChapterInput(false)}>
          <div className="bg-white rounded-card shadow-xl w-80 mx-4 p-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-3">从章节提取角色和设定</h3>
            <input
              value={chapterInput}
              onChange={e => setChapterInput(e.target.value)}
              placeholder="输入章节号，逗号分隔，如 1,2,3"
              className="w-full px-3 py-2 text-xs border border-border-input rounded-btn mb-3 focus:outline-none focus:border-primary"
              onKeyDown={e => { if (e.key === 'Enter') doGenerateFromChapters(chapterInput) }}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowChapterInput(false)} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary">取消</button>
              <button onClick={() => doGenerateFromChapters(chapterInput)} className="px-3 py-1.5 text-xs bg-primary text-white rounded-btn">确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
