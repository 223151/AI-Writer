import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import { useSettingStore } from '../../store/settingStore'
import { SETTING_EXTRACTION_SYSTEM, SETTING_EXTRACTION_USER } from '../../services/settingExtractor'

type CatKey = 'characters' | 'worlds' | 'rules' | 'relationships'

const CATS: { key: CatKey; label: string; icon: string }[] = [
  { key: 'characters', label: '角色', icon: '👤' },
  { key: 'worlds', label: '世界观', icon: '🌍' },
  { key: 'rules', label: '规则', icon: '📏' },
  { key: 'relationships', label: '关系', icon: '🔗' },
]

export default function SettingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { libraries, load, updateData } = useSettingStore()
  const [running, setRunning] = useState(false)
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState<Record<string, string>>({})
  const [cat, setCat] = useState<CatKey>('characters')
  const cancelledRef = useRef(false)
  const runningRef = useRef(false)

  const proj = libraries.find(l => l.id === Number(id))
  const raw = proj?.setting_data || {}
  const data = {
    characters: (raw as any).characters || [],
    worlds: (raw as any).worlds || [],
    rules: (raw as any).rules || [],
    relationships: (raw as any).relationships || [],
  }
  const currentItems: any[] = data[cat]

  useEffect(() => { load() }, [])
  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { return () => { if (runningRef.current) { cancelledRef.current = true; window.electronAPI?.cancelAi() } } }, [])

  const handleExtract = async (targetCat?: CatKey) => {
    if (!proj || !proj.source_text) { showToast('error', '请先导入小说'); return }
    const extractCat = targetCat || cat
    setRunning(true)
    cancelledRef.current = false
    try {
      const prompt = extractCat === 'characters'
        ? `从以下小说中只提取角色信息。输出JSON：{"characters":[{"name":"角色名","info":"身份描述","abilities":"能力","role":"main/support/antagonist/minor"}]}`
        : extractCat === 'worlds'
          ? `从以下小说中只提取世界观信息。输出JSON：{"worlds":[{"name":"名称","description":"描述","category":"location/faction/organization"}]}`
          : extractCat === 'rules'
            ? `从以下小说中只提取规则体系。输出JSON：{"rules":[{"name":"规则名","description":"规则描述"}]}`
            : `从以下小说中只提取角色关系。输出JSON：{"relationships":[{"char_a":"角色A","char_b":"角色B","relation":"关系类型","description":"关系描述"}]}`

      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: '只输出JSON对象，不要markdown代码块。' },
        { role: 'user', content: `${SETTING_EXTRACTION_USER(proj.source_text)}\n\n${prompt}` },
      ], '设定提取')
      if (cancelledRef.current) return
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI返回格式异常'); return }
      const parsed = JSON.parse(jm[0])
      const newData = JSON.parse(JSON.stringify(data))
      if (extractCat === 'characters') newData.characters = parsed.characters || []
      else if (extractCat === 'worlds') newData.worlds = parsed.worlds || []
      else if (extractCat === 'rules') newData.rules = parsed.rules || []
      else newData.relationships = parsed.relationships || []

      await updateData(Number(id), newData)
      const catLabel = CATS.find(c => c.key === extractCat)?.label
      showToast('success', `已提取${catLabel}`)
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消提取')
      else showToast('error', '提取失败：' + (e.message || '未知'))
    } finally { setRunning(false) }
  }

  const handleExtractAll = async () => {
    if (!proj || !proj.source_text) { showToast('error', '请先导入小说'); return }
    setRunning(true)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: SETTING_EXTRACTION_SYSTEM },
        { role: 'user', content: SETTING_EXTRACTION_USER(proj.source_text) },
      ], '设定提取')
      if (cancelledRef.current) return
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI返回格式异常'); return }
      const parsed = JSON.parse(jm[0])
      await updateData(Number(id), {
        characters: parsed.characters || [],
        worlds: parsed.worlds || [],
        rules: parsed.rules || [],
        relationships: parsed.relationships || [],
      })
      showToast('success', `提取完成：${parsed.characters?.length || 0}角色，${parsed.worlds?.length || 0}世界观`)
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消提取')
      else showToast('error', '提取失败：' + (e.message || '未知'))
    } finally { setRunning(false) }
  }

  const handleCancel = () => { cancelledRef.current = true; window.electronAPI?.cancelAi() }

  const startEdit = (path: string, value: string) => { setEditField(path); setEditValue(value) }
  const saveEdit = () => {
    if (!editField || !proj) return
    const newData = JSON.parse(JSON.stringify(data))
    const keys = editField.split('.')
    let obj = newData
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
    obj[keys[keys.length - 1]] = editValue
    updateData(Number(id), newData)
    setEditField(null)
  }

  const deleteItem = (index: number) => {
    if (!proj) return
    const newData = JSON.parse(JSON.stringify(data))
    newData[cat].splice(index, 1)
    updateData(Number(id), newData)
  }

  const startAdd = () => { setShowAddForm(true); setAddForm({}) }
  const handleAdd = () => {
    if (!proj) return
    const newData = JSON.parse(JSON.stringify(data))
    if (cat === 'characters') {
      if (!addForm.name?.trim()) return
      newData.characters.push({ name: addForm.name, info: addForm.info || '', abilities: addForm.abilities || '', role: addForm.role || 'support' })
    } else if (cat === 'worlds') {
      if (!addForm.name?.trim()) return
      newData.worlds.push({ name: addForm.name, description: addForm.description || '', category: addForm.category || 'location' })
    } else if (cat === 'rules') {
      if (!addForm.name?.trim()) return
      newData.rules.push({ name: addForm.name, description: addForm.description || '' })
    } else if (cat === 'relationships') {
      if (!addForm.char_a?.trim() || !addForm.char_b?.trim()) return
      newData.relationships.push({ char_a: addForm.char_a, char_b: addForm.char_b, relation: addForm.relation || '', description: addForm.description || '' })
    }
    updateData(Number(id), newData)
    setShowAddForm(false); setAddForm({})
  }

  if (!proj) {
    if (libraries.length > 0) return <div className="flex justify-center py-24 text-text-secondary">项目不存在或已被删除 (id={id})</div>
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  }

  const catLabel = CATS.find(c => c.key === cat)?.label || ''
  const hasSource = !!(proj.source_text)

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate('/setting-lib')} className="text-text-secondary hover:text-text-main">← 返回</button>
        <h1 className="text-page-title text-text-main">{proj.name}</h1>
        <div className="flex-1" />
        {hasSource && (
          !running ? (
            <button onClick={() => handleExtractAll()} className="px-3 py-1.5 text-sm bg-primary text-white rounded-btn hover:bg-primary-hover">🔄 全部提取</button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-primary">AI分析中...</span>
              <button onClick={handleCancel} className="px-3 py-1.5 text-sm border border-danger text-danger rounded-btn hover:bg-danger/10">取消</button>
            </div>
          )
        )}
      </div>

      {/* 类别标签 */}
      <div className="flex border-b border-border mb-4">
        {CATS.map(c => (
          <button key={c.key} onClick={() => { setCat(c.key); setShowAddForm(false) }}
            className={`flex items-center gap-1 px-4 py-2 text-sm transition-colors
              ${cat === c.key ? 'text-primary border-b-2 border-primary font-medium' : 'text-text-secondary hover:text-text-main'}`}
          >{c.icon} {c.label} <span className="text-text-placeholder">({data[c.key]?.length || 0})</span></button>
        ))}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button onClick={startAdd} className="px-2 py-1 text-xs border border-primary text-primary rounded hover:bg-primary/5">+ 手动添加</button>
        {hasSource && (
          <button onClick={() => handleExtract(cat)} disabled={running}
            className="px-2 py-1 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary disabled:opacity-50"
          >{running ? '⏳' : '🤖'} 提取{catLabel}</button>
        )}
      </div>

      {/* 添加表单 */}
      {showAddForm && (
        <div className="bg-bg-secondary/30 border border-border rounded-card p-3 mb-3 space-y-2">
          {cat === 'characters' && <>
            <input value={addForm.name || ''} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="角色名 *" autoFocus
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            <input value={addForm.info || ''} onChange={e => setAddForm(p => ({...p, info: e.target.value}))} placeholder="身份描述"
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            <div className="flex gap-2">
              <input value={addForm.abilities || ''} onChange={e => setAddForm(p => ({...p, abilities: e.target.value}))} placeholder="能力"
                className="flex-1 text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <select value={addForm.role || 'support'} onChange={e => setAddForm(p => ({...p, role: e.target.value}))}
                className="text-sm border border-border-input rounded px-2 py-1">
                <option value="main">主角</option><option value="support">配角</option><option value="antagonist">反派</option><option value="minor">次要</option>
              </select>
            </div>
          </>}
          {cat === 'worlds' && <>
            <input value={addForm.name || ''} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="名称 *" autoFocus
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            <input value={addForm.description || ''} onChange={e => setAddForm(p => ({...p, description: e.target.value}))} placeholder="描述"
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            <input value={addForm.category || ''} onChange={e => setAddForm(p => ({...p, category: e.target.value}))} placeholder="类别"
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
          </>}
          {cat === 'rules' && <>
            <input value={addForm.name || ''} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="规则名 *" autoFocus
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            <input value={addForm.description || ''} onChange={e => setAddForm(p => ({...p, description: e.target.value}))} placeholder="规则描述"
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
          </>}
          {cat === 'relationships' && <>
            <div className="flex gap-2">
              <input value={addForm.char_a || ''} onChange={e => setAddForm(p => ({...p, char_a: e.target.value}))} placeholder="角色A *" autoFocus
                className="flex-1 text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <input value={addForm.char_b || ''} onChange={e => setAddForm(p => ({...p, char_b: e.target.value}))} placeholder="角色B *"
                className="flex-1 text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            </div>
            <input value={addForm.relation || ''} onChange={e => setAddForm(p => ({...p, relation: e.target.value}))} placeholder="关系类型"
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            <input value={addForm.description || ''} onChange={e => setAddForm(p => ({...p, description: e.target.value}))} placeholder="关系描述"
              className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
          </>}
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-3 py-1 text-xs bg-primary text-white rounded">添加</button>
            <button onClick={() => setShowAddForm(false)} className="px-3 py-1 text-xs border rounded">取消</button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {currentItems.length === 0 ? (
        <div className="text-center py-16 text-text-secondary text-sm">
          暂无{catLabel}数据，点击「+ 手动添加」或{hasSource ? '「提取' + catLabel + '」' : '先导入小说'}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
          {currentItems.map((item: any, i: number) => (
            <div key={i} className="bg-white rounded-card border border-border p-3 hover:border-primary/20 transition-colors group">
              {cat === 'characters' && <>
                <Field label="姓名" value={item.name} path={`characters.${i}.name`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="身份" value={item.info} path={`characters.${i}.info`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="能力" value={item.abilities} path={`characters.${i}.abilities`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="定位" value={item.role} path={`characters.${i}.role`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
              </>}
              {cat === 'worlds' && <>
                <Field label="名称" value={item.name} path={`worlds.${i}.name`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="描述" value={item.description} path={`worlds.${i}.description`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="类别" value={item.category} path={`worlds.${i}.category`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
              </>}
              {cat === 'rules' && <>
                <Field label="名称" value={item.name} path={`rules.${i}.name`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="描述" value={item.description} path={`rules.${i}.description`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
              </>}
              {cat === 'relationships' && <>
                <Field label="角色A" value={item.char_a} path={`relationships.${i}.char_a`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="角色B" value={item.char_b} path={`relationships.${i}.char_b`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="关系" value={item.relation} path={`relationships.${i}.relation`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
                <Field label="描述" value={item.description} path={`relationships.${i}.description`} ef={editField} ev={editValue} onEdit={startEdit} onSave={saveEdit} onChange={setEditValue} />
              </>}
              <button onClick={() => deleteItem(i)}
                className="opacity-0 group-hover:opacity-100 text-xs text-text-placeholder hover:text-danger transition-all mt-1">🗑 删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, path, ef, ev, onEdit, onSave, onChange }: {
  label: string; value: string; path: string; ef: string | null; ev: string
  onEdit: (p: string, v: string) => void; onSave: () => void; onChange: (v: string) => void
}) {
  return (
    <div className="flex items-start gap-2 text-sm mb-1">
      <span className="text-text-placeholder shrink-0 w-10">{label}：</span>
      {ef === path ? (
        <div className="flex-1 flex gap-1">
          <input value={ev} onChange={e => onChange(e.target.value)} className="flex-1 text-sm border-b border-primary px-1 py-0.5 focus:outline-none" autoFocus />
          <button onClick={onSave} className="text-xs text-primary">保存</button>
        </div>
      ) : (
        <span className="text-text-main cursor-pointer hover:text-primary flex-1" onClick={() => onEdit(path, value)}>{value || '-'}</span>
      )}
    </div>
  )
}
