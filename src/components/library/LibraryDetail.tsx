import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../../store/libraryStore'
import { showToast } from '../common/Toast'
import { STYLE_EXTRACTION_SYSTEM, STYLE_EXTRACTION_USER } from '../../services/extractor'
import type { StyleLibrary } from '../../types'

export default function LibraryDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { libraries, loaded, load } = useLibraryStore()
  const [library, setLibrary] = useState<StyleLibrary | null>(null)
  const [reextracting, setReextracting] = useState(false)
  const reextractCancelled = useRef(false)

  // 离开时取消提取（不弹toast，由catch处理）
  useEffect(() => {
    return () => {
      if (reextracting) {
        reextractCancelled.current = true
        window.electronAPI?.cancelAi()
      }
    }
  })

  useEffect(() => { if (!loaded) load() }, [])
  useEffect(() => {
    const found = libraries.find((l) => l.id === Number(id))
    setLibrary(found || null)
  }, [libraries, id])

  const updateField = async (path: string[], value: string) => {
    if (!library) return showToast('error', '数据未加载')
    if (!window.electronAPI) return showToast('error', '请在应用中操作')
    try {
      const currentProfile = typeof library.style_profile === 'string'
        ? JSON.parse(library.style_profile) : (library.style_profile || {})
      const newProfile = JSON.parse(JSON.stringify(currentProfile))
      let obj: any = newProfile
      for (let i = 0; i < path.length - 1; i++) {
        if (!obj[path[i]] || typeof obj[path[i]] !== 'object') obj[path[i]] = {}
        obj = obj[path[i]]
      }
      obj[path[path.length - 1]] = value
      const jsonStr = JSON.stringify(newProfile)
      await window.electronAPI.db.run('UPDATE style_libraries SET style_profile=? WHERE id=?', [jsonStr, library.id])
      setLibrary({ ...library, style_profile: newProfile })
      showToast('success', '已保存')
    } catch (e: any) {
      showToast('error', '保存失败：' + (e.message || '未知'))
    }
  }

  const handleReextract = async () => {
    if (!window.electronAPI || !library) return
    setReextracting(true)
    try {
      const file = await window.electronAPI.openFile({ filters: [{ name: '文档', extensions: ['txt', 'docx', 'pdf'] }] })
      if (!file) { setReextracting(false); return }
      const text = await window.electronAPI.parseFile(file.filePath)
      if (!text || text.length < 500) { showToast('error', '文件内容不足500字'); setReextracting(false); return }
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: STYLE_EXTRACTION_SYSTEM },
        { role: 'user', content: STYLE_EXTRACTION_USER(text) },
      ], '重新提取风格')
      const jm = reply.match(/```json\s*([\s\S]*?)\s*```/) || reply.match(/\{[\s\S]*\}/)
      const profile = jm ? JSON.parse(jm[1] || jm[0]) : { raw_analysis: reply }
      const jsonStr = JSON.stringify(profile)
      await window.electronAPI.db.run('UPDATE style_libraries SET style_profile=? WHERE id=?', [jsonStr, library.id])
      setLibrary({ ...library, style_profile: profile })
      showToast('success', '风格已重新提取')
    } catch (e: any) {
      if (reextractCancelled.current) showToast('info', '已取消提取')
      else showToast('error', '重新提取失败：' + (e.message || '未知'))
    }
    finally { setReextracting(false) }
  }

  if (!library) {
    return <div className="flex flex-col items-center justify-center py-24 text-text-secondary"><p className="text-body">加载中...</p></div>
  }

  let p: any = {}
  try {
    p = typeof library.style_profile === 'string' ? JSON.parse(library.style_profile) : (library.style_profile || {})
  } catch { p = {} }

  const Field = ({ label, path, multiline }: { label: string; path: string[]; multiline?: boolean }) => {
    const [editing, setEditing] = useState(false)
    const [val, setVal] = useState('')
    const inputRef = useRef<any>(null)

    const currentVal: string = path.reduce((o: any, k) => (o && o[k]) ? o[k] : '', p as any) || ''

    const startEdit = () => { setVal(currentVal); setEditing(true); setTimeout(() => inputRef.current?.focus(), 50) }
    const save = () => { updateField(path, val); setEditing(false) }

    return (
      <div className="mb-2 group">
        <span className="text-xs text-text-placeholder">{label}</span>
        {editing ? (
          <div>
            {multiline ? (
              <textarea ref={inputRef} value={val} onChange={(e: any) => setVal(e.target.value)}
                onBlur={save} onKeyDown={(e: any) => { if (e.key === 'Escape') setEditing(false) }}
                rows={3} className="w-full px-2 py-1 mt-0.5 text-xs border border-primary rounded resize-y focus:outline-none" />
            ) : (
              <input ref={inputRef} value={val} onChange={(e: any) => setVal(e.target.value)}
                onBlur={save} onKeyDown={(e: any) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                className="w-full px-2 py-1 mt-0.5 text-xs border border-primary rounded focus:outline-none" />
            )}
          </div>
        ) : (
          <p onClick={startEdit}
            className="text-body text-text-main cursor-pointer hover:bg-bg-secondary rounded px-1 -mx-1 py-0.5 min-h-[1.5rem]"
            title="点击编辑">
            {currentVal || <span className="text-text-placeholder">点击添加...</span>}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => navigate('/library')} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary hover:text-text-main mb-4 inline-flex items-center gap-1">← 返回风格库</button>

      <div className="bg-white rounded-card border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-page-title">{library.name}</h1>
          {reextracting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-warning flex items-center gap-1"><div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 提取中...</span>
              <button onClick={() => { reextractCancelled.current = true; window.electronAPI?.cancelAi() }} className="px-2 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消</button>
            </div>
          ) : (
            <button onClick={handleReextract} className="px-3 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light/20">
              🔄 重新提取
            </button>
          )}
        </div>
        <p className="text-xs text-text-placeholder mb-4">💡 点击任意字段直接编辑，失焦自动保存</p>

        {/* 写作风格 */}
        <Section title="✍️ 写作风格（AI生成时读取）">
          <Field label="叙事视角" path={['writing_style', 'narrative_perspective']} multiline />
          <Field label="句式特点" path={['writing_style', 'sentence_characteristics']} multiline />
          <Field label="段落配比" path={['writing_style', 'paragraph_ratio']} multiline />
          <Field label="节奏感" path={['writing_style', 'pace']} multiline />
        </Section>

        {/* 语言特点 */}
        <Section title="💬 语言特点（AI生成时读取）">
          <Field label="词汇偏好" path={['language_features', 'vocabulary_preference']} multiline />
          <Field label="口语化程度" path={['language_features', 'colloquial_level']} />
          <Field label="文白比例" path={['language_features', 'literary_ratio']} />
        </Section>

        {/* 修辞手法 */}
        <Section title="🎨 修辞手法">
          <Field label="比喻" path={['rhetoric', 'metaphor']} multiline />
          <Field label="排比" path={['rhetoric', 'parallelism']} />
          <Field label="象征" path={['rhetoric', 'symbolism']} multiline />
        </Section>

        {/* 氛围基调 */}
        <Section title="🎭 氛围基调（AI生成时读取）">
          <Field label="主要氛围" path={['atmosphere', 'primary']} />
          <Field label="次要氛围" path={['atmosphere', 'secondary']} />
          <Field label="情感基调" path={['atmosphere', 'emotional_tone']} multiline />
        </Section>

        {/* 综合分析 */}
        <Section title="📝 综合分析（AI生成时作为风格描述读取）">
          <Field label="综合分析" path={['raw_analysis']} multiline />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 pb-5 border-b border-border last:border-b-0 last:mb-0 last:pb-0">
      <h3 className="text-sm font-medium text-text-main mb-3">{title}</h3>
      {children}
    </div>
  )
}
