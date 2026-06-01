import { create } from 'zustand'
import type { SettingLibrary } from '../types'

interface SettingStoreState {
  libraries: SettingLibrary[]
  loaded: boolean
  loading: boolean
  load: () => Promise<void>
  create: (name: string, sourceText: string) => Promise<number | null>
  remove: (id: number) => Promise<void>
  updateData: (id: number, data: any) => Promise<void>
}

export const useSettingStore = create<SettingStoreState>((set, get) => ({
  libraries: [],
  loaded: false,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      if (window.electronAPI) {
        const rows = await window.electronAPI.db.query(
          'SELECT * FROM setting_libraries ORDER BY created_at DESC'
        )
        set({ libraries: rows.map((r: any) => ({
          ...r,
          setting_data: typeof r.setting_data === 'string' ? JSON.parse(r.setting_data || '{}') : r.setting_data
        })), loaded: true, loading: false })
      } else {
        set({ loaded: true, loading: false })
      }
    } catch { set({ loaded: true, loading: false }) }
  },

  create: async (name, sourceText) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.db.run(
          'INSERT INTO setting_libraries (name, source_text) VALUES (?, ?)',
          [name, sourceText || '']
        )
        await get().load()
        return result.lastInsertRowid || result.changes
      }
      return null
    } catch { return null }
  },

  remove: async (id) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.db.run('DELETE FROM setting_libraries WHERE id = ?', [id])
        await get().load()
      }
    } catch { /* ignore */ }
  },

  updateData: async (id, data) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.db.run(
          "UPDATE setting_libraries SET setting_data = ?, updated_at = datetime('now','localtime') WHERE id = ?",
          [JSON.stringify(data), id]
        )
        await get().load()
      }
    } catch { /* ignore */ }
  },
}))
