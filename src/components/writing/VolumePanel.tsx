import type { Volume, ChapterPlan } from '../../types'
import { showToast } from '../common/Toast'
import MoreFields from './MoreFields'

interface Props {
  volumes: Volume[]
  chapterPlans: ChapterPlan[]
  expandedVolume: number | null
  setExpandedVolume: (n: number | null) => void
  generating: boolean
  outlineContent: string
  outlineVersion: number
  showGenPanel: 'outline' | 'volumes' | 'chapter' | null
  setShowGenPanel: (v: 'outline' | 'volumes' | 'chapter' | null) => void
  dragChapter: number | null
  setDragChapter: (n: number | null) => void
  selectedChapter: number
  addVolume: () => void
  deleteVolume: (n: number) => void
  moveChapterToVolume: (ch: number, vol: number) => void
  genSingleChapterPlan: (n: number) => Promise<void>
  setFullView: (v: { title: string; content: string }) => void
  chDone: (n: number) => boolean
  onUpdateVolume: (volNum: number, field: string, value: string) => void
  onUpdateChapterPlan: (chapNum: number, field: string, value: any) => void
  onFullscreenEdit: (title: string, content: string, onSave: (c: string) => void) => void
}

export default function VolumePanel({
  volumes, chapterPlans, expandedVolume, setExpandedVolume,
  generating, outlineContent, outlineVersion, showGenPanel, setShowGenPanel,
  dragChapter, setDragChapter, selectedChapter,
  addVolume, deleteVolume, moveChapterToVolume,
  genSingleChapterPlan, setFullView, chDone,
  onUpdateVolume, onUpdateChapterPlan, onFullscreenEdit,
}: Props) {
  return (
    <div className="p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-main">卷纲与细纲</span>
        <div className="flex gap-2">
          <button onClick={addVolume} className="text-xs text-primary hover:underline">＋新建卷</button>
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
                className={`border border-border rounded-card overflow-hidden transition-colors ${dragChapter ? 'border-primary/50 bg-primary-light/10' : ''}`}>
                <button onClick={() => setExpandedVolume(isExpanded ? null : vol.volume_number)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary transition-colors text-left">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-text-main truncate">{vol.title}</div>
                    <div className="text-xs text-text-placeholder">第{vol.chapter_range[0]}-{vol.chapter_range[1]}章 · {vol.theme}{vol.version ? ` · v${vol.version}` : ''}</div>
                    {vol.outline_version && outlineVersion > vol.outline_version && (
                      <div className="text-xxs text-yellow-600 mt-0.5">⚠ 大纲 v{outlineVersion}（此卷基于 v{vol.outline_version}）</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button onClick={(e) => { e.stopPropagation(); deleteVolume(vol.volume_number) }}
                      className="text-xs text-text-placeholder hover:text-danger" title="删除此卷">🗑</button>
                    <span className="text-xs text-text-placeholder">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </button>
                {isExpanded && (
                  <div className="border-t border-border px-3 py-1.5 space-y-1">
                    {(vol.detailed_summary || vol.summary) && (
                      <details><summary className="text-xs font-medium text-text-secondary cursor-pointer hover:text-text-main select-none py-0.5">📖 剧情详述</summary>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed mt-0.5 pl-2 border-l-2 border-border">{vol.detailed_summary || vol.summary}</p>
                      </details>
                    )}
                    {(vol.key_events?.length || vol.key_events_str) && (
                      <details><summary className="text-xs font-medium text-text-secondary cursor-pointer hover:text-text-main select-none py-0.5">⚡ 关键事件</summary>
                        <p className="text-xs text-text-secondary mt-0.5 pl-2 border-l-2 border-border">{vol.key_events_str || vol.key_events?.map((e: any) => typeof e === 'string' ? e : `${e.event}(${e.chapters})`).join('、')}</p>
                      </details>
                    )}
                    {vol.character_arcs && (
                      <details><summary className="text-xs font-medium text-text-secondary cursor-pointer hover:text-text-main select-none py-0.5">👤 角色弧线</summary>
                        <p className="text-xs text-text-secondary whitespace-pre-wrap mt-0.5 pl-2 border-l-2 border-border">{vol.character_arcs}</p>
                      </details>
                    )}
                    {vol.emotional_curve && (
                      <details><summary className="text-xs font-medium text-text-secondary cursor-pointer hover:text-text-main select-none py-0.5">🎭 情感曲线</summary>
                        <p className="text-xs text-text-secondary mt-0.5 pl-2 border-l-2 border-border">{vol.emotional_curve}</p>
                      </details>
                    )}
                    {(vol.pacing_design || vol.emotional_cadence || vol.word_count_target || vol.connection_prev || vol.connection_next || vol.foreshadowing_plant?.length || vol.foreshadowing_payoff?.length || vol.foreshadowing_advance || vol.character_milestones?.length || vol.conflict_nodes?.length) && (
                      <MoreFields vol={vol} />
                    )}
                    <div className="flex gap-0.5 flex-wrap">
                      <button onClick={async () => { try { for (let c = vol.chapter_range[0]; c <= vol.chapter_range[1]; c++) { if (!chapterPlans.find(p => p.chapter_number === c)) await genSingleChapterPlan(c) } } catch {} }}
                        disabled={generating} className="flex-none px-1.5 py-0 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50">生成全卷</button>
                      <button onClick={() => {
                        const exportVol: any = {}
                        for (const k of Object.keys(vol)) {
                          if (k !== 'outline_version' && k !== 'version' && vol[k as keyof typeof vol] !== undefined && vol[k as keyof typeof vol] !== '')
                            exportVol[k] = vol[k as keyof typeof vol]
                        }
                        onFullscreenEdit(`编辑第${vol.volume_number}卷`, JSON.stringify(exportVol, null, 2), (c: string) => {
                          try {
                            const parsed = JSON.parse(c)
                            for (const [k, v] of Object.entries(parsed)) {
                              if (k !== 'volume_number' && k !== 'chapter_range' && k !== 'outline_version' && k !== 'version')
                                onUpdateVolume(vol.volume_number, k, typeof v === 'string' ? v : JSON.stringify(v))
                            }
                            // special: update arrays/objects as JSON strings to preserve structure
                            if (parsed.key_events) onUpdateVolume(vol.volume_number, 'key_events_str', JSON.stringify(parsed.key_events))
                            showToast('success', '卷纲已更新')
                          } catch { showToast('error', 'JSON 格式错误，请检查后重试') }
                        })
                      }} className="flex-none px-1.5 py-0 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary">编辑卷纲</button>
                      <button onClick={() => setFullView({
                        title: vol.title,
                        content: [
                          `# ${vol.title}`, `**主题**：${vol.theme}`, `**章节范围**：第${vol.chapter_range[0]}-${vol.chapter_range[1]}章`,
                          vol.word_count_target ? `**字数目标**：${vol.word_count_target.toLocaleString()} 字` : '',
                          vol.connection_prev ? `**承上**：${vol.connection_prev}` : '', vol.connection_next ? `**启下**：${vol.connection_next}` : '', '',
                          `**剧情详述**：${vol.detailed_summary || vol.summary}`, vol.pacing_design ? `**节奏设计**：${vol.pacing_design}` : '',
                          vol.emotional_cadence ? `**情绪节奏**：${vol.emotional_cadence}` : '', vol.character_arcs ? `**角色弧线**：${vol.character_arcs}` : '',
                          vol.emotional_curve ? `**情感曲线**：${vol.emotional_curve}` : '', `**关键事件**：${vol.key_events.join('、')}`, '',
                          vol.character_milestones?.length ? `**人物里程碑**：\n${vol.character_milestones.map(cm => `- ${cm.character}: ${cm.start_state} → ${cm.end_state} (${cm.key_event})`).join('\n')}` : '',
                          vol.conflict_nodes?.length ? `**关键冲突节点**：\n${vol.conflict_nodes.map(cn => `- [${cn.chapter_segment}] ${cn.description} (${cn.escalation_type})`).join('\n')}` : '',
                          vol.foreshadowing_plant?.length ? `**🪝 本卷新埋**：${vol.foreshadowing_plant.join('、')}` : '',
                          vol.foreshadowing_payoff?.length ? `**✅ 本卷回收**：${vol.foreshadowing_payoff.join('、')}` : '',
                          vol.foreshadowing_advance ? `**🔗 伏笔推进**：${vol.foreshadowing_advance}` : '',
                          vol.foreshadowing_planted?.length ? `**🪝 新伏笔**：${vol.foreshadowing_planted.join('、')}` : '',
                          vol.foreshadowing_recovered?.length ? `**✅ 回收伏笔**：${vol.foreshadowing_recovered.join('、')}` : '',
                          '', '## 本卷章节细纲',
                          ...volPlans.map(p => `### 第${p.chapter_number}章 ${p.title}\n${p.summary || ''}\n人物：${(p.characters || []).join('、')}\n事件：${(p.key_events || []).join('、')}\n字数：${p.estimated_words}`)
                        ].filter(Boolean).join('\n\n')
                      })} className="flex-none px-1.5 py-0 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary">查看详情</button>
                    </div>
                    <div className="max-h-64 overflow-auto">
                      {Array.from({ length: vol.chapter_range[1] - vol.chapter_range[0] + 1 }, (_, i) => vol.chapter_range[0] + i).map(cn => {
                        const plan = chapterPlans.find(p => p.chapter_number === cn)
                        const prevPlan = cn > vol.chapter_range[0] ? chapterPlans.find(p => p.chapter_number === cn - 1) : true
                        if (!plan) return (
                          <div key={cn} className="flex items-center gap-1.5 text-xs text-text-placeholder px-2 py-0.5">
                            <span>○</span><span className="flex-1">{cn}. 未生成</span>
                            <button onClick={() => genSingleChapterPlan(cn)} disabled={generating || !prevPlan}
                              className="text-primary hover:underline disabled:opacity-30 text-xs">{!prevPlan ? '需上章' : '生成'}</button>
                          </div>
                        );
                        return (
                          <div key={cn}>
                            <div draggable onDragStart={() => setDragChapter(cn)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => { if (dragChapter) { moveChapterToVolume(dragChapter, vol.volume_number); setDragChapter(null) } }}
                              onClick={() => {
                                const p = plan as any
                                let md = `# 第${cn}章 ${plan.title}\n\n`
                                if (p.core_event) md += `**核心事件**：${p.core_event}\n\n`
                                if (p.emotional_arc) md += `**情绪弧线**：${p.emotional_arc}\n\n`
                                if (p.cool_moment) md += `**爽点**：${p.cool_moment}\n\n`
                                if (p.opening_hook) md += `**章首钩子**：${p.opening_hook.type} — ${p.opening_hook.detail}\n\n`
                                if (p.closing_hook) md += `**章尾钩子**：${p.closing_hook.type}（期待度：${p.closing_hook.impact}）\n\n`
                                if (plan.plot_beats?.length) { md += `**情节点序列**（${plan.plot_beats.length}条）\n`; plan.plot_beats.forEach((b: string, i: number) => { md += `${i + 1}. ${b}\n` }); md += '\n' }
                                md += `**字数**：${plan.estimated_words}字\n\n`
                                if (plan.summary) md += `**概要**\n${plan.summary}\n\n`
                                if (plan.characters?.length) md += `**人物**：${plan.characters.join('、')}\n\n`
                                if (plan.key_events?.length) md += `**关键事件**\n${plan.key_events.map((e: string) => '- ' + e).join('\n')}`
                                setFullView({ title: `第${cn}章细纲：${plan.title}`, content: md })
                              }}
                              className={`text-xs rounded px-2 py-0.5 cursor-pointer flex items-center gap-1.5 transition-colors ${dragChapter === cn ? 'opacity-50' : ''} ${selectedChapter === cn ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-bg-secondary'}`}>
                              <span className={chDone(cn) ? 'text-success' : 'text-text-placeholder'}>{chDone(cn) ? '●' : '○'}</span>
                              <span className="flex-1 truncate">{cn}. {plan.title}</span>
                              <button onClick={(e) => { e.stopPropagation();
                                const exportPlan: any = {}
                                for (const k of Object.keys(plan)) {
                                  if (k !== 'volume_version' && k !== 'plan_version' && (plan as any)[k] !== undefined && (plan as any)[k] !== '')
                                    exportPlan[k] = (plan as any)[k]
                                }
                                onFullscreenEdit(`编辑第${cn}章细纲`, JSON.stringify(exportPlan, null, 2), (c: string) => {
                                  try {
                                    const parsed = JSON.parse(c)
                                    for (const [k, v] of Object.entries(parsed)) {
                                      if (k !== 'chapter_number') onUpdateChapterPlan(cn, k, v)
                                    }
                                    showToast('success', '细纲已更新')
                                  } catch { showToast('error', 'JSON 格式错误，请检查后重试') }
                                })
                              }} className="text-xs text-text-placeholder hover:text-primary" title="编辑细纲">编辑</button>
                              <button onClick={(e) => { e.stopPropagation(); genSingleChapterPlan(cn) }} className="text-text-placeholder hover:text-primary text-xs" title="重新生成">🔄</button>
                              <span className="text-text-placeholder cursor-grab" title="拖拽">⠿</span>
                            </div>
                          </div>
                        )})}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
