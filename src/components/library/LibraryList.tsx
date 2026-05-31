import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../common/Modal'
import { showToast } from '../common/Toast'
import InlineEdit from '../common/InlineEdit'
import { useLibraryStore } from '../../store/libraryStore'
import { STYLE_EXTRACTION_SYSTEM, STYLE_EXTRACTION_USER } from '../../services/extractor'
import type { StyleLibrary } from '../../types'

export default function LibraryList() {
  const [modalOpen, setModalOpen] = useState(false)
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [pastedText, setPastedText] = useState('')
  const [libraryName, setLibraryName] = useState('')
  const [filePath, setFilePath] = useState('')
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')

  const { libraries, loaded, load, create, remove } = useLibraryStore()

  useEffect(() => { load() }, [])

  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI?.openFile({
        filters: [{ name: '文档文件', extensions: ['txt', 'docx', 'pdf'] }],
      })
      if (result) {
        setFilePath(result.filePath)
        setFileName(result.fileName)
        showToast('success', `已选择：${result.fileName}`)
      }
    } catch {
      showToast('error', '文件选择失败，请重试')
    }
  }

  const handleImport = async () => {
    // 验证
    if (!libraryName.trim()) {
      showToast('error', '请输入风格库名称')
      return
    }
    if (mode === 'paste' && !pastedText.trim()) {
      showToast('error', '请粘贴小说文本（至少 1000 字）')
      return
    }
    if (mode === 'file' && !filePath) {
      showToast('error', '请选择小说文件')
      return
    }
    if (mode === 'paste' && pastedText.trim().length < 500) {
      showToast('error', '文本太短，请至少粘贴 500 字以获得准确的风格分析')
      return
    }

    setImporting(true)
    try {
      let text = ''

      // 步骤 1：获取文本
      setImportProgress('正在读取文件...')
      if (mode === 'file') {
        text = await window.electronAPI.parseFile(filePath)
      } else {
        text = pastedText
      }

      if (!text || text.trim().length < 500) {
        showToast('error', '文件内容太少（不足 500 字），无法进行风格分析')
        setImporting(false)
        return
      }

      // 步骤 2：AI 风格分析
      setImportProgress('AI 正在分析写作风格...（约需 30-60 秒）')
      const messages = [
        { role: 'system' as const, content: STYLE_EXTRACTION_SYSTEM },
        { role: 'user' as const, content: STYLE_EXTRACTION_USER(text) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '风格提取')

      // 步骤 3：解析 JSON 结果
      setImportProgress('正在保存风格库...')
      let styleProfile
      try {
        // 尝试提取 JSON（可能包裹在 ```json ``` 中）
        const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/) || reply.match(/\{[\s\S]*\}/)
        const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : reply
        styleProfile = JSON.parse(jsonStr)
      } catch {
        // 如果 JSON 解析失败，将原始回复存为 raw_analysis
        styleProfile = {
          writing_style: { narrative_perspective: '', sentence_characteristics: '', pace: '' },
          language_features: { vocabulary_preference: '', colloquial_level: '', literary_ratio: '' },
          rhetoric: { metaphor: '', parallelism: '', symbolism: '', other: [] },
          atmosphere: { primary: '', secondary: '', emotional_tone: '' },
          sample_passages: [],
          raw_analysis: reply,
        }
      }

      // 步骤 4：保存到数据库
      const id = await create(libraryName.trim(), fileName || '粘贴文本', styleProfile)
      if (id) {
        showToast('success', `风格库「${libraryName}」创建成功！`)
      }

      // 关闭弹窗
      setModalOpen(false)
      resetForm()
    } catch (e: any) {
      showToast('error', '导入失败：' + (e.message || '未知错误'))
    } finally {
      setImporting(false)
      setImportProgress('')
    }
  }

  const handleDelete = (id: number, name: string) => {
    if (window.confirm(`确定要删除风格库「${name}」吗？`)) {
      remove(id)
      showToast('success', `「${name}」已删除`)
    }
  }

  const handleRename = async (id: number, oldName: string) => {
    const newName = window.prompt('修改名称：', oldName)
    if (newName && newName.trim() && newName.trim() !== oldName) {
      try {
        if (window.electronAPI) {
          await window.electronAPI.db.run('UPDATE style_libraries SET name=? WHERE id=?', [newName.trim(), id])
          await load()
          showToast('success', '名称已更新')
        }
      } catch { showToast('error', '改名失败') }
    }
  }

  const resetForm = () => {
    setLibraryName('')
    setPastedText('')
    setFilePath('')
    setFileName('')
    setMode('file')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-page-title text-text-main">风格库</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors"
        >
          + 导入小说
        </button>
      </div>

      {/* 列表 或 空状态 */}
      {libraries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-text-secondary">
          <span className="text-5xl mb-4">📚</span>
          <p className="text-body mb-2">还没有风格库</p>
          <p className="text-caption">导入一本小说，让 AI 学习它的写作风格</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {libraries.map((lib) => (
            <LibraryCard key={lib.id} library={lib} onDelete={() => handleDelete(lib.id, lib.name)} />
          ))}
        </div>
      )}

      {/* 导入弹窗 */}
      <Modal
        open={modalOpen}
        title="导入小说 · 创建风格库"
        onClose={() => { if (!importing) { setModalOpen(false); resetForm() } }}
        width="max-w-lg"
        footer={
          !importing ? (
            <>
              <button
                onClick={() => { setModalOpen(false); resetForm() }}
                className="px-4 py-2 border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleImport}
                className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors"
              >
                开始分析
              </button>
            </>
          ) : undefined
        }
      >
        {importing ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-body text-text-main">{importProgress}</p>
            <p className="text-caption text-text-secondary">正在调用 AI 进行分析，请耐心等待...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* 名称 */}
            <div>
              <label className="block text-body text-text-main mb-2">风格库名称 *</label>
              <input
                type="text"
                value={libraryName}
                onChange={(e) => setLibraryName(e.target.value)}
                placeholder="例如：三体风格、金庸武侠风"
                autoFocus
                className="w-full h-10 px-3 border border-border-input rounded-btn text-body
                           focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                           placeholder:text-text-placeholder"
              />
            </div>

            {/* 导入方式 */}
            <div>
              <label className="block text-body text-text-main mb-2">导入方式</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setMode('file')}
                  className={`px-4 py-2 rounded-btn text-body transition-colors
                    ${mode === 'file' ? 'bg-primary text-white' : 'border border-border-input text-text-secondary hover:bg-bg-secondary'}`}
                >
                  📁 上传文件
                </button>
                <button
                  onClick={() => setMode('paste')}
                  className={`px-4 py-2 rounded-btn text-body transition-colors
                    ${mode === 'paste' ? 'bg-primary text-white' : 'border border-border-input text-text-secondary hover:bg-bg-secondary'}`}
                >
                  📋 粘贴文本
                </button>
              </div>
            </div>

            {mode === 'file' && (
              <div
                onClick={handleSelectFile}
                className="border-2 border-dashed border-border-input rounded-card p-8 text-center cursor-pointer
                           hover:border-primary hover:bg-primary-light/30 transition-colors"
              >
                <span className="text-3xl mb-2 block">📂</span>
                {fileName ? (
                  <p className="text-body text-text-main">{fileName}</p>
                ) : (
                  <>
                    <p className="text-body text-text-secondary mb-1">点击选择文件</p>
                    <p className="text-caption text-text-placeholder">支持 TXT、Word、PDF 格式</p>
                  </>
                )}
              </div>
            )}

            {mode === 'paste' && (
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="将小说文本粘贴到此处（建议至少 3000 字以获得准确的风格分析）"
                rows={10}
                className="w-full px-3 py-2 border border-border-input rounded-btn text-body resize-none
                           focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                           placeholder:text-text-placeholder"
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

/** 风格库卡片 */
function LibraryCard({ library, onDelete }: { library: StyleLibrary; onDelete: () => void }) {
  const navigate = useNavigate()
  const profile = library.style_profile
  const primary = profile?.atmosphere?.primary || '未知'
  const secondary = profile?.atmosphere?.secondary || ''
  const perspective = profile?.writing_style?.narrative_perspective || ''

  return (
    <div
      onClick={() => navigate(`/library/${library.id}`)}
      className="bg-white rounded-card border border-border p-5 hover:shadow-md hover:border-primary/30 transition-all group cursor-pointer relative"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-section-title text-text-main">
          <InlineEdit
            value={library.name}
            onSave={async (newName) => {
              if (window.electronAPI) {
                await window.electronAPI.db.run('UPDATE style_libraries SET name=? WHERE id=?', [newName, library.id])
              }
            }}
          />
        </h3>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 text-text-placeholder hover:text-danger transition-all"
        >🗑</button>
      </div>

      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-caption">
          <span className="text-text-placeholder">源小说：</span>
          <span className="text-text-secondary">{library.source_novel_title || '未记录'}</span>
        </div>
        <div className="flex items-center gap-2 text-caption">
          <span className="text-text-placeholder">氛围：</span>
          <span className="px-1.5 py-0.5 rounded bg-primary-light text-primary text-xs">
            {primary}
          </span>
          {secondary && (
            <span className="px-1.5 py-0.5 rounded bg-bg-secondary text-text-secondary text-xs">
              {secondary}
            </span>
          )}
        </div>
        {perspective && (
          <div className="text-caption text-text-secondary truncate" title={perspective}>
            {perspective}
          </div>
        )}
      </div>

      <div className="text-caption text-text-placeholder">
        {library.created_at?.slice(0, 10)}
      </div>
    </div>
  )
}
