import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import { useDisassemblyStore } from '../../store/disassemblyStore'
import { DISASSEMBLE_SYSTEM, DISASSEMBLE_USER, sampleText, estimateChapters } from '../../services/disassembler'

export default function DisassemblyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { updateStage } = useDisassemblyStore()

  const [project, setProject] = useState<any>(null)
  const [result, setResult] = useState<string>('')
  const [sections, setSections] = useState<{ title: string; content: string }[]>([])
  const [running, setRunning] = useState(false)
  const cancelledRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [editingSection, setEditingSection] = useState<number | null>(null)
  const [editSectionText, setEditSectionText] = useState('')

  // 离开时取消
  useEffect(() => {
    return () => {
      if (running) {
        cancelledRef.current = true
        window.electronAPI?.cancelAi()
      }
    }
  })

  useEffect(() => {
    (async () => {
      try {
        if (!window.electronAPI) { setLoaded(true); return }
        const proj = await window.electronAPI.db.get(
          'SELECT * FROM disassembly_projects WHERE id = ?', [Number(id)]
        )
        if (proj) {
          setProject(proj)
          const results = typeof proj.stage_results === 'string' ? JSON.parse(proj.stage_results) : (proj.stage_results || {})
          // 检查是否已经完成拆文（v2 单次结果存在 'result' 字段中，或旧版 stage5）
          const fullResult = results.result || results.stage5 || ''
          if (fullResult) {
            setResult(fullResult)
            setSections(parseSections(fullResult))
          }
        }
      } catch (e: any) { setError(e.message || String(e)) }
      setLoaded(true)
    })()
  }, [id])

  /** 将拆文结果按 ## 标题拆分为可分段编辑的 section */
  const parseSections = (text: string) => {
    const secs: { title: string; content: string }[] = []
    const parts = text.split(/(?=^## )/m)
    for (const part of parts) {
      const match = part.match(/^## (.+)/m)
      if (match) {
        secs.push({ title: match[1].trim(), content: part.trim() })
      } else if (part.trim()) {
        // 没有 ## 标题的内容放在第一个"概述"section
        if (secs.length === 0) secs.push({ title: '概述', content: part.trim() })
        else secs[secs.length - 1].content += '\n\n' + part.trim()
      }
    }
    return secs
  }

  const saveSectionEdit = async (idx: number) => {
    if (!project || !window.electronAPI) return
    const newSections = sections.map((s, i) => i === idx ? { ...s, content: editSectionText } : s)
    const newResult = newSections.map(s => `## ${s.title}\n\n${s.content}`).join('\n\n')
    const newResults = { result: newResult, total_chapters: project.total_chapters }
    await window.electronAPI.db.run(
      'UPDATE disassembly_projects SET stage_results = ? WHERE id = ?',
      [JSON.stringify(newResults), project.id]
    )
    setSections(newSections)
    setResult(newResult)
    setEditingSection(null)
    showToast('success', '已保存')
  }

  const runDisassembly = async () => {
    if (!project || !window.electronAPI) return
    setRunning(true)
    cancelledRef.current = false
    try {
      const sourceText = project.source_text || ''
      const totalChars = sourceText.length
      const totalChapters = estimateChapters(sourceText)

      // 更新章节数
      await window.electronAPI.db.run(
        'UPDATE disassembly_projects SET total_chapters = ? WHERE id = ?',
        [totalChapters, project.id]
      )

      // 智能采样
      const sampled = sampleText(sourceText)
      const sampledChars = sampled.length

      showToast('info', `全文 ${totalChars.toLocaleString()} 字 → 采样 ${sampledChars.toLocaleString()} 字 (${(sampledChars / totalChars * 100).toFixed(1)}%) → AI 分析中...`)

      // 单次 AI 调用
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: DISASSEMBLE_SYSTEM },
        { role: 'user', content: DISASSEMBLE_USER(sampled, totalChapters, totalChars) },
      ], '拆文分析')

      if (cancelledRef.current) return

      // 保存结果
      const newResults = { result: reply, sampled_chars: sampledChars, total_chars: totalChars, total_chapters: totalChapters }
      await window.electronAPI.db.run(
        'UPDATE disassembly_projects SET stage_results = ?, current_stage = 5, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
        [JSON.stringify(newResults), project.id]
      )
      setResult(reply)
      setSections(parseSections(reply))
      showToast('success', '拆文完成！')
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消拆文')
      else showToast('error', '拆文失败：' + (e.message || '未知'))
    } finally {
      setRunning(false)
    }
  }

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (error) return <div className="flex justify-center py-24 text-text-secondary">错误：{error}</div>
  if (!project) return <div className="flex justify-center py-24 text-text-secondary">项目不存在或已被删除 (id={id})</div>

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate('/disassembly')} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary hover:text-text-main mb-4 inline-flex items-center gap-1">← 返回拆文库</button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-page-title text-text-main">{project.name}</h1>
          <p className="text-caption text-text-secondary mt-1">
            原文 {(project.source_text || '').length.toLocaleString()} 字 · {project.total_chapters || '?'} 章
          </p>
        </div>
      </div>

      {/* 一键拆文按钮 */}
      <div className="mb-6">
        {running ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-primary-light/10 border border-primary/30 rounded-card">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <div>
              <p className="text-sm font-medium text-primary">AI 正在分析中...</p>
              <p className="text-xs text-text-secondary mt-0.5">智能采样已经完成，正在调用 AI 一次性分析全部维度</p>
            </div>
            <button onClick={() => { cancelledRef.current = true; window.electronAPI?.cancelAi() }}
              className="ml-auto px-3 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
              ⏹ 取消
            </button>
          </div>
        ) : (
          <button onClick={runDisassembly}
            className="w-full px-4 py-3 text-sm bg-primary text-white rounded-card hover:bg-primary-hover transition-colors">
            {result ? '🔄 重新拆文' : '🤖 开始拆文（一键完成全部分析）'}
          </button>
        )}
      </div>

      {/* 结果展示 — 分段编辑 */}
      {sections.length > 0 && (
        <div className="space-y-3">
          {sections.map((sec, idx) => {
            const isEditing = editingSection === idx
            return (
              <div key={idx} className="bg-white rounded-card border border-border overflow-hidden">
                <div className="px-4 py-2.5 bg-bg-secondary border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-medium text-text-main">{sec.title}</h3>
                  {isEditing ? (
                    <div className="flex gap-2">
                      <button onClick={() => saveSectionEdit(idx)} className="text-xs text-primary hover:underline">💾 保存</button>
                      <button onClick={() => setEditingSection(null)} className="text-xs text-text-placeholder hover:underline">取消</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingSection(idx); setEditSectionText(sec.content) }}
                      className="text-xs text-primary hover:underline">✏️ 编辑</button>
                  )}
                </div>
                <div className="p-4">
                  {isEditing ? (
                    <textarea value={editSectionText} onChange={e => setEditSectionText(e.target.value)}
                      rows={Math.max(6, sec.content.split('\n').length)}
                      className="w-full px-3 py-2 text-xs border border-primary rounded-btn resize-y font-mono focus:outline-none" />
                  ) : (
                    <pre className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed max-h-80 overflow-auto"
                      onClick={() => { setEditingSection(idx); setEditSectionText(sec.content) }}
                      title="点击编辑">
                      {sec.content}
                    </pre>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!result && !running && (
        <div className="text-center py-12 text-text-placeholder text-sm">
          <p className="mb-2">📚</p>
          <p>点击上方按钮，一键完成全部拆文分析</p>
          <p className="text-xs mt-1">智能采样 → AI 一次性分析 → 角色 · 剧情 · 文风 · 评分</p>
        </div>
      )}
    </div>
  )
}
