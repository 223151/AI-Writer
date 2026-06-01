import { useState, useEffect, useCallback } from 'react'
import type { ForeshadowingItem, ForeshadowingStatus, ForeshadowingPriority } from '../../types'

const STATUS_LABELS: Record<ForeshadowingStatus, string> = {
  planned: '📋 计划中', planted: '🌱 已埋下', buried: '🪨 已加固',
  recycled: '♻️ 已复用', resolved: '✅ 已回收', expired: '⏰ 已过期'
}

const STATUS_COLORS: Record<ForeshadowingStatus, string> = {
  planned: 'bg-gray-100 text-gray-600', planted: 'bg-blue-100 text-blue-700',
  buried: 'bg-indigo-100 text-indigo-700', recycled: 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700', expired: 'bg-red-100 text-red-500'
}

const PRIORITY_COLORS: Record<ForeshadowingPriority, string> = {
  critical: 'bg-red-500', high: 'bg-orange-400', normal: 'bg-blue-400', low: 'bg-gray-300'
}

interface Props {
  projectId: number
  chapters: { chapter_number: number; title: string }[]
}

export default function ForeshadowingPanel({ projectId, chapters }: Props) {
  const [items, setItems] = useState<ForeshadowingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('active')

  const loadItems = useCallback(async () => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM foreshadowing_registry WHERE project_id = ? ORDER BY created_at ASC',
        [projectId]
      )
      setItems(rows.map((r: any) => ({
        ...r,
        related_characters: typeof r.related_characters === 'string'
          ? JSON.parse(r.related_characters || '[]') : (r.related_characters || [])
      })))
    } catch { /* table may not exist yet */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadItems() }, [loadItems])

  const updateStatus = async (id: number, status: ForeshadowingStatus) => {
    await window.electronAPI?.db.run(
      'UPDATE foreshadowing_registry SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [status, id]
    )
    loadItems()
  }

  const deleteItem = async (id: number) => {
    if (!window.electronAPI) return
    await window.electronAPI.db.run('DELETE FROM foreshadowing_registry WHERE id = ?', [id])
    loadItems()
  }

  const filtered = items.filter(i => {
    if (filter === 'active') return !['resolved', 'expired'].includes(i.status)
    if (filter === 'resolved') return i.status === 'resolved'
    return true
  })

  const activeCount = items.filter(i => !['resolved', 'expired'].includes(i.status)).length
  const resolvedCount = items.filter(i => i.status === 'resolved').length
  const recoveryRate = items.length > 0 ? Math.round((resolvedCount / items.length) * 100) : 0

  return (
    <div className="h-full overflow-auto">
      {/* 统计头部 */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
        <span className="text-xs text-text-secondary">
          {items.length}个 · {resolvedCount}已回收 · {recoveryRate}%
        </span>
        <div className="flex-1" />
        <div className="flex gap-1">
          {(['active', 'resolved', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                filter === f ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-secondary'
              }`}
            >
              {f === 'active' ? '未回收' : f === 'resolved' ? '已回收' : '全部'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {items.length === 0 ? '暂无伏笔数据，生成章节后将自动提取' : '没有匹配的伏笔'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {filtered.map(item => {
            const ch = chapters.find(c => c.chapter_number === item.planted_chapter)
            const targetCh = chapters.find(c => c.chapter_number === item.target_chapter)
            const resolvedCh = chapters.find(c => c.chapter_number === item.resolved_chapter)

            return (
              <div key={item.id} className="px-4 py-2.5 hover:bg-bg-secondary/50 transition-colors">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[item.priority]}`} title={item.priority} />
                    <span className="text-xs text-text-main font-medium">{item.foreshadow_id || `#${item.id}`}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[item.status]}`}>
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <select
                      value={item.status}
                      onChange={e => updateStatus(item.id, e.target.value as ForeshadowingStatus)}
                      className="text-xs border border-border-input rounded px-1 py-0.5 bg-white"
                    >
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                    <button onClick={() => deleteItem(item.id)}
                      className="text-xs text-text-placeholder hover:text-danger transition-colors px-0.5"
                      title="删除"
                    >🗑</button>
                  </div>
                </div>
                <p className="text-xs text-text-main mb-1.5">{item.description}</p>
                <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
                  {item.planted_chapter && (
                    <span>📍 第{item.planted_chapter}章{ch ? ` ${ch.title}` : ''}</span>
                  )}
                  {item.target_chapter && (
                    <span>🎯 目标：第{item.target_chapter}章{targetCh ? ` ${targetCh.title}` : ''}</span>
                  )}
                  {item.resolved_chapter && (
                    <span>✅ 回收：第{item.resolved_chapter}章{resolvedCh ? ` ${resolvedCh.title}` : ''}</span>
                  )}
                  {item.related_characters.length > 0 && (
                    <span>👤 {item.related_characters.join('、')}</span>
                  )}
                </div>
                {item.notes && <p className="text-xs text-text-placeholder mt-1">{item.notes}</p>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
