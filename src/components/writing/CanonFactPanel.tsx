import { useState, useEffect, useCallback, useRef } from 'react'
import { showToast } from '../common/Toast'
import { CANON_EXTRACTION_SYSTEM, CANON_EXTRACTION_USER } from '../../services/generator'
import type { CanonFact, FactCategory } from '../../types'

const CATS: { key: FactCategory; label: string; icon: string }[] = [
  { key: 'character', label: '角色', icon: '👤' },
  { key: 'setting', label: '世界观', icon: '🌍' },
  { key: 'rule', label: '规则', icon: '📏' },
  { key: 'relationship', label: '关系', icon: '🔗' },
  { key: 'event', label: '事件', icon: '📖' },
]

interface Props {
  projectId: number
  outlineContent?: string
  chapters?: { chapter_number: number; title: string; content: string }[]
}

export default function CanonFactPanel({ projectId, outlineContent, chapters }: Props) {
  const [facts, setFacts] = useState<CanonFact[]>([])
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState<FactCategory>('character')
  const [extracting, setExtracting] = useState(false)
  const [genLoading, setGenLoading] = useState('')
  const cancelledRef = useRef(false)
  const loadingRef = useRef(false)

  useEffect(() => {
    loadingRef.current = !!(genLoading || extracting)
  }, [genLoading, extracting])

  useEffect(() => {
    return () => {
      if (loadingRef.current) {
        cancelledRef.current = true
        window.electronAPI?.cancelAi()
      }
    }
  }, [])

  const handleCancel = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
  }

  // 手动添加
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newDetails, setNewDetails] = useState('')
  const [newHard, setNewHard] = useState(true)

  // 编辑/展开
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const loadFacts = useCallback(async () => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM canon_facts WHERE project_id = ? ORDER BY fact_key',
        [projectId]
      )
      setFacts(rows)
    } catch { }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadFacts() }, [loadFacts])

  const filtered = facts.filter(f => f.fact_category === cat)

  // ========== AI 从大纲生成角色/设定 ==========
  const handleGenFromOutline = async () => {
    if (!outlineContent || !window.electronAPI) { showToast('error', '请先生成大纲'); return }
    cancelledRef.current = false
    setGenLoading(cat)
    try {
      const prompt = cat === 'character'
        ? `请从以下大纲中提取所有角色，输出严格JSON数组：\n[{"fact_key":"角色名","fact_value":"角色描述(50字)","details":{"personality":"性格","abilities":"能力","role_type":"main/support/antagonist/minor"}}]\n\n大纲：\n${outlineContent.slice(0, 5000)}`
        : cat === 'setting'
          ? `请从以下大纲中提取所有世界观设定（地点、势力、规则体系），输出严格JSON数组：\n[{"fact_key":"设定名","fact_value":"描述(50字)","details":{"description":"详细描述","trigger_keywords":"触发词","is_global":true/false}}]\n\n大纲：\n${outlineContent.slice(0, 5000)}`
          : `请从以下大纲中提取${CATS.find(c => c.key === cat)?.label}相关信息，输出严格JSON数组：\n[{"fact_key":"名称","fact_value":"描述(50字)","details":{}}]\n\n大纲：\n${outlineContent.slice(0, 5000)}`

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: '你是小说设定提取专家。只输出JSON数组，不要任何其他文字。' },
        { role: 'user', content: prompt },
      ], '设定生成')
      if (cancelledRef.current) return
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\[[\s\S]*\]/)
      if (!jm) { showToast('error', 'AI返回格式异常'); return }
      const arr = JSON.parse(jm[0])

      // 清除旧数据
      await window.electronAPI.db.run(
        'DELETE FROM canon_facts WHERE project_id = ? AND fact_category = ? AND source = ?',
        [projectId, cat, 'AI生成']
      )
      for (const item of arr) {
        const details = item.details || {}
        await window.electronAPI.db.run(
          `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details)
           VALUES (?, ?, ?, ?, 1, 'AI生成', ?)`,
          [projectId, cat, item.fact_key, item.fact_value || '', JSON.stringify(details)]
        )
      }
      showToast('success', `已生成 ${arr.length} 个${CATS.find(c => c.key === cat)?.label}`)
      loadFacts()
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消生成')
      else showToast('error', '生成失败：' + (e.message || '未知'))
    } finally { setGenLoading('') }
  }

  // ========== 从章节提取 ==========
  const handleExtractFromChapter = async () => {
    if (!chapters || chapters.length === 0) { showToast('error', '暂无章节'); return }
    const chNums = chapters.map(c => c.chapter_number).join(',')
    const num = parseInt(window.prompt(`从第几章提取？（可选：${chNums}）`, String(chapters[chapters.length - 1]?.chapter_number || 1)) || '0')
    if (!num) return
    const ch = chapters.find(c => c.chapter_number === num)
    if (!ch || !ch.content) { showToast('error', '该章无内容'); return }

    setExtracting(true)
    try {
      const prompt = cat === 'character'
        ? `从以下章节提取所有角色及其特征，输出JSON数组：[{"fact_key":"角色名","fact_value":"角色描述","details":{"personality":"性格","abilities":"能力"}}]`
        : `从以下章节提取所有${CATS.find(c => c.key === cat)?.label}信息，输出JSON数组：[{"fact_key":"名称","fact_value":"描述","details":{}}]`

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: '只输出JSON数组，不要任何其他文字。' },
        { role: 'user', content: `${prompt}\n\n章节内容：\n${ch.content.slice(0, 7000)}` },
      ], '章节提取设定')
      if (cancelledRef.current) return
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\[[\s\S]*\]/)
      if (!jm) { showToast('error', 'AI返回格式异常'); return }
      const arr = JSON.parse(jm[0])
      let added = 0
      for (const item of arr) {
        const existing = await window.electronAPI.db.get(
          'SELECT id FROM canon_facts WHERE project_id = ? AND fact_category = ? AND fact_key = ?',
          [projectId, cat, item.fact_key]
        )
        if (existing) {
          await window.electronAPI.db.run(
            'UPDATE canon_facts SET fact_value = ?, details = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
            [item.fact_value || '', JSON.stringify(item.details || {}), existing.id]
          )
        } else {
          await window.electronAPI.db.run(
            `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details, established_chapter)
             VALUES (?, ?, ?, ?, 1, '章节提取', ?, ?)`,
            [projectId, cat, item.fact_key, item.fact_value || '', JSON.stringify(item.details || {}), num]
          )
          added++
        }
      }
      showToast('success', `新增 ${added} 个，更新 ${arr.length - added} 个`)
      loadFacts()
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消提取')
      else showToast('error', '提取失败：' + (e.message || '未知'))
    } finally { setExtracting(false) }
  }

  // ========== AI 补全 ==========
  const handleAIFill = async () => {
    const name = window.prompt(`输入${CATS.find(c => c.key === cat)?.label}名称，AI将自动补全信息：`)
    if (!name || !name.trim()) return
    if (!outlineContent) { showToast('error', '请先生成大纲'); return }

    cancelledRef.current = false
    setGenLoading(cat)
    try {
      const prompt = cat === 'character'
        ? `请根据大纲为角色「${name}」补全信息，输出JSON：{"fact_value":"50字角色描述","details":{"personality":"性格","background":"背景","abilities":"能力","role_type":"main/support/antagonist/minor"}}`
        : `请根据大纲为「${name}」补全信息，输出JSON：{"fact_value":"50字描述","details":{}}`

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: '只输出JSON对象，不要任何其他文字。' },
        { role: 'user', content: `${prompt}\n\n大纲：\n${outlineContent.slice(0, 4000)}` },
      ], 'AI补全设定')
      if (cancelledRef.current) return
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI返回格式异常'); return }
      const obj = JSON.parse(jm[0])

      await window.electronAPI.db.run(
        `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details)
         VALUES (?, ?, ?, ?, 1, 'AI补全', ?)`,
        [projectId, cat, name.trim(), obj.fact_value || '', JSON.stringify(obj.details || {})]
      )
      showToast('success', `已添加「${name.trim()}」`)
      loadFacts()
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消补全')
      else showToast('error', '补全失败：' + (e.message || '未知'))
    } finally { setGenLoading('') }
  }

  // ========== CRUD ==========
  const addFact = async () => {
    if (!newKey.trim()) { showToast('error', '请输入名称'); return }
    await window.electronAPI?.db.run(
      `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details)
       VALUES (?, ?, ?, ?, ?, '手动添加', ?)`,
      [projectId, cat, newKey.trim(), newValue.trim(), newHard ? 1 : 0, newDetails || '{}']
    )
    setShowAdd(false); setNewKey(''); setNewValue(''); setNewDetails(''); setNewHard(true)
    loadFacts()
  }

  const toggleHard = async (f: CanonFact) => {
    await window.electronAPI?.db.run(
      'UPDATE canon_facts SET is_hard_rule = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [f.is_hard_rule ? 0 : 1, f.id]
    )
    loadFacts()
  }

  const updateFact = async (id: number, field: string, value: string) => {
    await window.electronAPI?.db.run(
      `UPDATE canon_facts SET ${field} = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [value, id]
    )
    loadFacts()
  }

  const deleteFact = async (id: number) => {
    await window.electronAPI?.db.run('DELETE FROM canon_facts WHERE id = ?', [id])
    loadFacts()
  }

  // ========== 批量生成全部类别 ==========
  const handleExtractAll = async () => {
    if (!outlineContent || !window.electronAPI) { showToast('error', '请先生成大纲'); return }
    setExtracting(true)
    try {
      const messages = [
        { role: 'system' as const, content: CANON_EXTRACTION_SYSTEM },
        { role: 'user' as const, content: CANON_EXTRACTION_USER(outlineContent) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '事实簿提取')
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\[[\s\S]*\]/)
      if (!jm) { showToast('error', 'AI返回格式异常'); return }
      const arr = JSON.parse(jm[0])
      await window.electronAPI.db.run('DELETE FROM canon_facts WHERE project_id = ? AND source = ?', [projectId, '大纲'])
      for (const f of arr) {
        await window.electronAPI.db.run(
          `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details, established_chapter)
           VALUES (?, ?, ?, ?, ?, '大纲', '{}', 0)`,
          [projectId, f.fact_category, f.fact_key, f.fact_value, f.is_hard_rule ? 1 : 0]
        )
      }
      showToast('success', `已提取 ${arr.length} 条核心事实`)
      loadFacts()
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消提取')
      else showToast('error', '提取失败：' + (e.message || '未知'))
    } finally { setExtracting(false) }
  }

  const hardCount = facts.filter(f => f.is_hard_rule).length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center gap-1 px-3 py-2 bg-bg-secondary border-b border-border shrink-0 flex-wrap">
        <span className="text-sm font-medium text-text-main mr-1">📖 设定</span>
        <span className="text-xs text-text-secondary">{facts.length}项 · {hardCount}硬规则</span>
        <div className="flex-1" />
        <button onClick={handleExtractAll} disabled={extracting || !outlineContent}
          className="px-2 py-0.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50"
        >{extracting ? '⏳' : '🔄'} 批量提取</button>
        <button onClick={async () => {
          try {
            const libs = await window.electronAPI!.db.query("SELECT id, name, setting_data FROM setting_libraries ORDER BY created_at DESC")
            if (libs.length === 0) { showToast('error', '左侧设定库暂无数据，请先创建'); return }
            const names = libs.map((l: any, i: number) => `${i+1}. ${l.name}`).join('\n')
            const idx = parseInt(window.prompt(`选择要导入的设定库：\n${names}`, '1') || '0') - 1
            if (idx < 0 || idx >= libs.length) return
            const lib = libs[idx]
            const d = typeof lib.setting_data === 'string' ? JSON.parse(lib.setting_data || '{}') : (lib.setting_data || {})
            let imported = 0
            for (const ch of (d.characters || [])) {
              await window.electronAPI!.db.run(
                `INSERT OR IGNORE INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details, established_chapter) VALUES (?, 'character', ?, ?, 1, '设定库导入', ?, 0)`,
                [projectId, ch.name, ch.info || '', JSON.stringify({ personality: ch.info, abilities: ch.abilities, role_type: ch.role })]
              ); imported++
            }
            for (const w of (d.worlds || [])) {
              await window.electronAPI!.db.run(
                `INSERT OR IGNORE INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details, established_chapter) VALUES (?, 'setting', ?, ?, 1, '设定库导入', ?, 0)`,
                [projectId, w.name, w.description || '', JSON.stringify({ description: w.description, trigger_keywords: w.category })]
              ); imported++
            }
            for (const r of (d.rules || [])) {
              await window.electronAPI!.db.run(
                `INSERT OR IGNORE INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details, established_chapter) VALUES (?, 'rule', ?, ?, 1, '设定库导入', ?, 0)`,
                [projectId, r.name, r.description, '{}']
              ); imported++
            }
            showToast('success', `已从《${lib.name}》导入 ${imported} 条设定`)
            loadFacts()
          } catch (e: any) { showToast('error', '导入失败：' + (e.message || '未知')) }
        }}
          className="px-2 py-0.5 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary"
        >📥 从设定库导入</button>
      </div>

      {/* 类别标签 */}
      <div className="flex border-b border-border shrink-0 overflow-x-auto">
        {CATS.map(c => {
          const count = facts.filter(f => f.fact_category === c.key).length
          return (
            <button key={c.key} onClick={() => setCat(c.key)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs whitespace-nowrap transition-colors
                ${cat === c.key ? 'text-primary border-b-2 border-primary font-medium' : 'text-text-secondary hover:text-text-main'}`}
            >
              {c.icon} {c.label}
              {count > 0 && <span className="text-text-placeholder">({count})</span>}
            </button>
          )
        })}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border shrink-0 flex-wrap">
        <button onClick={() => { setShowAdd(!showAdd); setNewKey(''); setNewValue(''); setNewDetails(''); setNewHard(true) }}
          className="px-2 py-0.5 text-xs border border-primary text-primary rounded hover:bg-primary/5"
        >+ 手动添加</button>
        <button onClick={handleGenFromOutline} disabled={!!genLoading || !outlineContent}
          className="px-2 py-0.5 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary disabled:opacity-50"
        >{genLoading === cat ? '⏳' : '🤖'} 从大纲生成</button>
        <button onClick={handleExtractFromChapter} disabled={!!extracting}
          className="px-2 py-0.5 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary disabled:opacity-50"
        >{extracting ? '⏳' : '📖'} 从章节提取</button>
        <button onClick={handleAIFill} disabled={!!genLoading}
          className="px-2 py-0.5 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary disabled:opacity-50"
        >{genLoading === cat ? '⏳' : '🪄'} AI补全</button>
        {(genLoading || extracting) && (
          <button onClick={handleCancel}
            className="px-2 py-0.5 text-xs border border-danger text-danger rounded hover:bg-danger/10"
          >⏹ 取消</button>
        )}
      </div>

      {/* 添加表单 */}
      {showAdd && (
        <div className="px-3 py-2 border-b border-border bg-bg-secondary/30 shrink-0 space-y-1.5">
          <input value={newKey} onChange={e => setNewKey(e.target.value)}
            placeholder={`${CATS.find(c => c.key === cat)?.label}名称（如：林辰）`} autoFocus
            className="w-full text-xs border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
          <input value={newValue} onChange={e => setNewValue(e.target.value)}
            placeholder="描述（如：主角，火木双灵根修士）"
            className="w-full text-xs border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
          {cat === 'character' && (
            <textarea value={newDetails} onChange={e => setNewDetails(e.target.value)}
              placeholder='JSON扩展信息（可选）：{"personality":"冷静果敢","abilities":"剑术大师","role_type":"main"}'
              rows={2}
              className="w-full text-xs border border-border-input rounded px-2 py-1 resize-none focus:outline-none focus:border-primary" />
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary flex items-center gap-1">
              <input type="checkbox" checked={newHard} onChange={e => setNewHard(e.target.checked)} /> 硬规则
            </label>
            <div className="flex-1" />
            <button onClick={() => setShowAdd(false)} className="text-xs px-2 py-0.5 border rounded">取消</button>
            <button onClick={addFact} className="text-xs px-2 py-0.5 bg-primary text-white rounded">保存</button>
          </div>
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">
            {facts.length === 0 ? '暂无设定，点击上方按钮生成或手动添加' : `暂无${CATS.find(c => c.key === cat)?.label}类别数据`}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map(f => {
              let details: any = {}
              try { details = typeof f.details === 'string' ? JSON.parse(f.details || '{}') : (f.details || {}) } catch {}
              const isExpanded = expandedId === f.id

              return (
                <div key={f.id} className="hover:bg-bg-secondary/30 transition-colors">
                  <div className="px-3 py-2 flex items-start justify-between cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : f.id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`w-1.5 h-1.5 rounded-full ${f.is_hard_rule ? 'bg-red-500' : 'bg-gray-300'}`} />
                        <span className="text-xs font-medium text-text-main truncate">{f.fact_key}</span>
                        {f.is_hard_rule ? (
                          <span className="text-[10px] px-1 rounded bg-red-100 text-red-700">S1</span>
                        ) : (
                          <span className="text-[10px] px-1 rounded bg-gray-100 text-gray-500">软</span>
                        )}
                        <span className="text-[10px] text-text-placeholder">{f.source}</span>
                      </div>
                      <p className="text-xs text-text-secondary truncate">{f.fact_value}</p>
                    </div>
                    <div className="flex gap-1 ml-2 shrink-0">
                      <button onClick={(e) => { e.stopPropagation(); toggleHard(f) }}
                        className="text-xs px-1 py-0.5 rounded border border-border-input hover:bg-bg-secondary"
                        title={f.is_hard_rule ? '降为软设定' : '升为硬规则'}>{f.is_hard_rule ? '🔓' : '🔒'}</button>
                      <button onClick={(e) => { e.stopPropagation(); deleteFact(f.id) }}
                        className="text-xs px-1 py-0.5 rounded border border-border-input hover:bg-red-50 text-text-placeholder hover:text-danger">🗑</button>
                    </div>
                  </div>

                  {/* 展开详情 */}
                  {isExpanded && (
                    <div className="px-3 pb-2 space-y-1.5" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                        <span>{CATS.find(c => c.key === f.fact_category)?.icon} {CATS.find(c => c.key === f.fact_category)?.label}</span>
                        {f.established_chapter != null && <span>· 📍 第{f.established_chapter}章</span>}
                      </div>
                      <textarea
                        value={f.fact_value}
                        onChange={e => updateFact(f.id, 'fact_value', e.target.value)}
                        rows={2}
                        className="w-full text-xs border border-border-input rounded px-2 py-1 resize-none focus:outline-none focus:border-primary"
                      />
                      {cat === 'character' && details.personality && (
                        <div className="text-xs text-text-secondary">
                          <span className="text-text-placeholder">性格：</span>{details.personality}
                          {details.abilities && <span className="ml-2"><span className="text-text-placeholder">能力：</span>{details.abilities}</span>}
                          {details.role_type && <span className="ml-2"><span className="text-text-placeholder">类型：</span>{details.role_type}</span>}
                        </div>
                      )}
                      {cat === 'setting' && (details.description || details.trigger_keywords) && (
                        <div className="text-xs text-text-secondary">
                          {details.description && <span>{details.description}</span>}
                          {details.trigger_keywords && <span className="ml-2"><span className="text-text-placeholder">触发词：</span>{details.trigger_keywords}</span>}
                        </div>
                      )}
                      <div className="flex gap-1">
                        <button onClick={() => updateFact(f.id, 'details', JSON.stringify(details))}
                          className="text-xs px-2 py-0.5 border border-border-input rounded hover:bg-bg-secondary">💾 保存编辑</button>
                        <button onClick={() => setExpandedId(null)}
                          className="text-xs px-2 py-0.5 border border-border-input rounded hover:bg-bg-secondary">收起</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
