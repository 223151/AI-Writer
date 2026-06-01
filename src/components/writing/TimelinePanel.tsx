import { useState, useEffect, useCallback } from 'react'
import type { TimelineEvent, TimelineEventType } from '../../types'

const TYPE_LABELS: Record<TimelineEventType, string> = {
  plot: '📖 剧情', character_development: '👤 角色发展', revelation: '💡 揭示',
  conflict: '⚔️ 冲突', resolution: '🏁 解决', world_building: '🌍 世界观'
}

const TYPE_COLORS: Record<TimelineEventType, string> = {
  plot: '#3B82F6', character_development: '#10B981', revelation: '#F59E0B',
  conflict: '#EF4444', resolution: '#8B5CF6', world_building: '#6B7280'
}

interface Props {
  projectId: number
  chapters: { chapter_number: number; title: string }[]
}

export default function TimelinePanel({ projectId, chapters }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [charFilter, setCharFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<TimelineEventType | ''>('')

  const loadEvents = useCallback(async () => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM story_timeline WHERE project_id = ? ORDER BY absolute_day ASC, chapter_number ASC, event_order ASC',
        [projectId]
      )
      setEvents(rows.map((r: any) => ({
        ...r,
        characters_involved: typeof r.characters_involved === 'string'
          ? JSON.parse(r.characters_involved || '[]') : (r.characters_involved || [])
      })))
    } catch { }
    finally { setLoading(false) }
  }, [projectId])

  const deleteEvent = async (id: number) => {
    if (!window.electronAPI) return
    await window.electronAPI.db.run('DELETE FROM story_timeline WHERE id = ?', [id])
    loadEvents()
  }

  useEffect(() => { loadEvents() }, [loadEvents])

  // Collect all character names
  const allChars = [...new Set(events.flatMap(e => e.characters_involved))].sort()

  const filtered = events.filter(e => {
    if (charFilter && !e.characters_involved.includes(charFilter)) return false
    if (typeFilter && e.event_type !== typeFilter) return false
    return true
  })

  const majorOnly = filtered.filter(e => e.is_major)
  const timeConflicts: string[] = []
  for (let i = 1; i < events.length; i++) {
    if (events[i].absolute_day != null && events[i-1].absolute_day != null &&
        events[i].absolute_day! < events[i-1].absolute_day!) {
      timeConflicts.push(`⚠ 第${events[i-1].chapter_number}章(第${events[i-1].absolute_day}天) → 第${events[i].chapter_number}章(第${events[i].absolute_day}天)：时间倒退`)
    }
  }

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-wrap">
        <span className="text-xs text-text-secondary">{events.length} 事件</span>
        <div className="flex-1" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TimelineEventType | '')}
          className="text-xs border border-border-input rounded px-1.5 py-0.5"
        >
          <option value="">全部类型</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={charFilter} onChange={e => setCharFilter(e.target.value)}
          className="text-xs border border-border-input rounded px-1.5 py-0.5"
        >
          <option value="">全部角色</option>
          {allChars.map(c => <option key={c} value={c}>👤 {c}</option>)}
        </select>
      </div>

      {timeConflicts.length > 0 && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          {timeConflicts.map((c, i) => <p key={i}>{c}</p>)}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          暂无时间线数据，生成章节后将自动提取
        </div>
      ) : (
        <div className="relative pl-8 pr-4 py-3">
          {/* 竖线 */}
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" style={{ left: '22px' }} />

          {filtered.map((event, idx) => {
            const ch = chapters.find(c => c.chapter_number === event.chapter_number)
            const color = TYPE_COLORS[event.event_type as TimelineEventType] || '#6B7280'
            const prevCh = idx > 0 ? filtered[idx-1].chapter_number : 0
            const showChapterMarker = event.chapter_number !== prevCh

            return (
              <div key={event.id}>
                {showChapterMarker && (
                  <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0">
                    <div className="w-3 h-3 rounded-full bg-primary border-2 border-white absolute"
                      style={{ left: '17px', marginTop: '2px' }} />
                    <span className="text-xs font-medium text-primary">
                      📍 第{event.chapter_number}章 {ch?.title || ''}
                    </span>
                  </div>
                )}
                <div className="relative pb-3 ml-2 group">
                  <div className="w-2 h-2 rounded-full absolute border-2 border-white"
                    style={{ background: color, left: '-3px', top: '4px' }} />
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs text-text-secondary">
                      {event.time_label ? `🕐 ${event.time_label}` : ''}
                      {event.absolute_day != null ? ` · 第${event.absolute_day}天` : ''}
                    </span>
                    <span className={`px-1 py-0 rounded text-xs ${event.is_major ? 'bg-primary/10 text-primary' : 'text-text-placeholder'}`}>
                      {TYPE_LABELS[event.event_type as TimelineEventType] || event.event_type}
                    </span>
                  </div>
                  <p className="text-xs text-text-main">{event.event_description}</p>
                  <div className="flex gap-1.5 mt-0.5 text-xs text-text-placeholder">
                    {event.location && <span>📍 {event.location}</span>}
                    {event.characters_involved.length > 0 && (
                      <span>👤 {event.characters_involved.join('、')}</span>
                    )}
                  </div>
                  <button onClick={() => deleteEvent(event.id)}
                    className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 text-xs text-text-placeholder hover:text-danger transition-all"
                    title="删除"
                  >🗑</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
