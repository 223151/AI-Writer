import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../common/Modal'
import { showToast } from '../common/Toast'
import InlineEdit from '../common/InlineEdit'
import { useProjectStore } from '../../store/projectStore'

export default function ProjectList() {
  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  const navigate = useNavigate()
  const { projects, loaded, load, create, remove } = useProjectStore()

  // 启动时加载项目列表
  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!title.trim()) {
      showToast('error', '请输入书名')
      return
    }
    setCreating(true)
    try {
      const newId = await create(title.trim(), description.trim())
      if (newId) {
        showToast('success', `项目「${title}」创建成功！`)
        setModalOpen(false)
        setTitle('')
        setDescription('')
        navigate(`/project/${newId}/workspace`)
      } else {
        showToast('info', `项目「${title}」已记录（开发模式）`)
        setModalOpen(false)
        setTitle('')
        setDescription('')
      }
    } catch (e: any) {
      showToast('error', '创建失败：' + (e.message || '未知错误'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = (id: number, title: string) => {
    if (window.confirm(`确定要删除「${title}」吗？此操作不可恢复。`)) {
      remove(id)
      showToast('success', `「${title}」已删除`)
    }
  }

  const statusLabel: Record<string, string> = {
    outline: '大纲阶段',
    detailed_outline: '细纲阶段',
    writing: '写作中',
    completed: '已完成',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-page-title text-text-main">我的小说</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors"
        >
          + 新建项目
        </button>
      </div>

      {/* 项目列表 或 空状态 */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-text-secondary">
          <span className="text-5xl mb-4">📝</span>
          <p className="text-body mb-2">还没有小说项目</p>
          <p className="text-caption">点击「新建项目」开始你的创作之旅</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/project/${project.id}/workspace`)}
              className="bg-white rounded-card border border-border p-5 cursor-pointer
                         hover:shadow-md hover:border-primary/30 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-section-title text-text-main">
                  <InlineEdit value={project.title} onSave={async (newName) => {
                    if (window.electronAPI) { await window.electronAPI.db.run('UPDATE novel_projects SET title=? WHERE id=?', [newName, project.id]) }
                  }} />
                </h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(project.id, project.title)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-text-placeholder hover:text-danger transition-all"
                >
                  🗑
                </button>
              </div>
              {project.description && (
                <p className="text-caption text-text-secondary mb-3 line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-caption px-2 py-0.5 rounded bg-primary-light text-primary">
                  {statusLabel[project.status] || project.status}
                </span>
                <span className="text-caption text-text-placeholder">
                  {project.updated_at?.slice(0, 10)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建项目弹窗 */}
      <Modal
        open={modalOpen}
        title="新建小说项目"
        onClose={() => { setModalOpen(false); setTitle(''); setDescription('') }}
        footer={
          <>
            <button
              onClick={() => { setModalOpen(false); setTitle(''); setDescription('') }}
              className="px-4 py-2 border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {creating ? '⏳ 创建中...' : '创建'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-body text-text-main mb-2">书名 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入小说书名"
              autoFocus
              className="w-full h-10 px-3 border border-border-input rounded-btn text-body
                         focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                         placeholder:text-text-placeholder"
            />
          </div>

          <div>
            <label className="block text-body text-text-main mb-2">简介</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单描述一下你想写的故事（可选）"
              rows={4}
              className="w-full px-3 py-2 border border-border-input rounded-btn text-body resize-none
                         focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                         placeholder:text-text-placeholder"
            />
          </div>

          <p className="text-caption text-text-secondary">
            💡 创建项目后，你可以选择风格库，然后按「大纲 → 细纲 → 章节」的顺序生成小说。
          </p>
        </div>
      </Modal>
    </div>
  )
}
