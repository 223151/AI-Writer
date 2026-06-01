import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

let db: Database | null = null
let SQL: SqlJsStatic | null = null

/** 数据库文件路径 */
const DB_PATH = join(app.getPath('userData'), 'data.db')

/** 初始化数据库 */
export async function initDatabase(): Promise<void> {
  // 加载 sql.js WASM
  SQL = await initSqlJs()

  // 确保目录存在
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // 从磁盘加载已有数据库，或创建新数据库
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // 创建表结构
  createTables()
  console.log('✓ Database initialized:', DB_PATH)
}

/** 创建所有表 */
function createTables(): void {
  if (!db) throw new Error('Database not initialized')

  // 启用外键约束（CASCADE DELETE 依赖此设置）
  db.run('PRAGMA foreign_keys = ON')

  db.run(`
    -- 系统设置
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    -- 风格库
    CREATE TABLE IF NOT EXISTS style_libraries (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      source_novel_title TEXT DEFAULT '',
      style_profile      TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 小说项目
    CREATE TABLE IF NOT EXISTS novel_projects (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      title               TEXT NOT NULL,
      description         TEXT DEFAULT '',
      primary_style_id    INTEGER,
      auxiliary_style_ids TEXT DEFAULT '[]',
      status              TEXT NOT NULL DEFAULT 'outline',
      created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (primary_style_id) REFERENCES style_libraries(id) ON DELETE SET NULL
    );

    -- 大纲
    CREATE TABLE IF NOT EXISTS outlines (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      content    TEXT NOT NULL DEFAULT '',
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- 细纲
    CREATE TABLE IF NOT EXISTS detailed_outlines (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      chapters   TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- 章节
    CREATE TABLE IF NOT EXISTS chapters (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      title          TEXT NOT NULL DEFAULT '',
      content        TEXT NOT NULL DEFAULT '',
      word_count     INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'draft',
      created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, chapter_number)
    );

    -- Token 用量记录
    CREATE TABLE IF NOT EXISTS token_usage (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      purpose        TEXT NOT NULL DEFAULT '',
      model          TEXT NOT NULL DEFAULT 'deepseek-chat',
      prompt_tokens  INTEGER NOT NULL DEFAULT 0,
      cached_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens  INTEGER NOT NULL DEFAULT 0,
      total_tokens   INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(created_at);

    -- 拆文项目
    CREATE TABLE IF NOT EXISTS disassembly_projects (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      source_text        TEXT NOT NULL DEFAULT '',
      total_chapters     INTEGER NOT NULL DEFAULT 0,
      current_stage      INTEGER NOT NULL DEFAULT 0,
      -- 0=概要, 1=黄金三章, 2=逐章摘要, 3=聚合分析, 4=文风, 5=完成
      stage_results      TEXT NOT NULL DEFAULT '{}',
      -- JSON: { stage0: {...}, stage1: {...}, ... }
      created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 上下文状态（长篇写作一致性维护）
    CREATE TABLE IF NOT EXISTS context_state (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL UNIQUE,
      character_state TEXT NOT NULL DEFAULT '{}',
      plot_summary    TEXT NOT NULL DEFAULT '',
      last_chapter    INTEGER NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- 角色卡片（结构化角色管理）
    CREATE TABLE IF NOT EXISTS character_cards (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL,
      name            TEXT NOT NULL,
      role_type       TEXT NOT NULL DEFAULT 'main',
      personality     TEXT DEFAULT '',
      background      TEXT DEFAULT '',
      appearance      TEXT DEFAULT '',
      abilities       TEXT DEFAULT '',
      relationships   TEXT DEFAULT '[]',
      status_tracking TEXT DEFAULT '{}',
      notes           TEXT DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- 世界设定卡片
    CREATE TABLE IF NOT EXISTS world_settings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL,
      category        TEXT NOT NULL DEFAULT 'general',
      name            TEXT NOT NULL,
      description     TEXT DEFAULT '',
      details         TEXT DEFAULT '',
      trigger_keywords TEXT DEFAULT '',
      priority        INTEGER NOT NULL DEFAULT 0,
      is_global       INTEGER NOT NULL DEFAULT 0,
      notes           TEXT DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- 章节摘要（记录官 — 自动提取）
    CREATE TABLE IF NOT EXISTS chapter_summaries (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id            INTEGER NOT NULL,
      chapter_number        INTEGER NOT NULL,
      summary               TEXT NOT NULL DEFAULT '',
      characters_appeared   TEXT DEFAULT '[]',
      locations             TEXT DEFAULT '[]',
      key_events            TEXT DEFAULT '[]',
      foreshadowing_planted TEXT DEFAULT '[]',
      foreshadowing_recovered TEXT DEFAULT '[]',
      character_changes     TEXT DEFAULT '{}',
      world_changes         TEXT DEFAULT '{}',
      created_at            TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, chapter_number)
    );
  `)

  // Tier 3 迁移：角色成长 + 关系演变
  try { db.run('CREATE TABLE IF NOT EXISTS character_arc_log (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, character_name TEXT NOT NULL, chapter_number INTEGER NOT NULL, change_type TEXT NOT NULL, change_description TEXT NOT NULL, before_state TEXT DEFAULT \'\', after_state TEXT DEFAULT \'\', created_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE)') } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_arc_log_char ON character_arc_log(project_id, character_name, chapter_number)') } catch {}
  try { db.run('CREATE TABLE IF NOT EXISTS relationship_timeline (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, char_a TEXT NOT NULL, char_b TEXT NOT NULL, chapter_number INTEGER NOT NULL, relation_type TEXT NOT NULL DEFAULT \'ally\', intimacy_level INTEGER NOT NULL DEFAULT 50, change_description TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE)') } catch {}

  // Tier 1 迁移：v1.4 新表（如果已存在则跳过）
  try { db.run('CREATE TABLE IF NOT EXISTS foreshadowing_registry (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, foreshadow_id TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'planted\', priority TEXT NOT NULL DEFAULT \'normal\', planted_chapter INTEGER, target_chapter INTEGER, resolved_chapter INTEGER, related_characters TEXT DEFAULT \'[]\', notes TEXT DEFAULT \'\', created_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE, UNIQUE(project_id, foreshadow_id))') } catch {}
  try { db.run('CREATE TABLE IF NOT EXISTS story_timeline (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, chapter_number INTEGER NOT NULL, event_order INTEGER NOT NULL DEFAULT 0, event_description TEXT NOT NULL, time_label TEXT DEFAULT \'\', absolute_day INTEGER, location TEXT DEFAULT \'\', characters_involved TEXT DEFAULT \'[]\', event_type TEXT DEFAULT \'plot\', is_major INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE)') } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_timeline_project ON story_timeline(project_id, absolute_day)') } catch {}
  try { db.run('CREATE TABLE IF NOT EXISTS canon_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, fact_category TEXT NOT NULL DEFAULT \'setting\', fact_key TEXT NOT NULL, fact_value TEXT NOT NULL, established_chapter INTEGER, last_verified INTEGER, is_hard_rule INTEGER NOT NULL DEFAULT 0, verification_status INTEGER NOT NULL DEFAULT 0, source TEXT DEFAULT \'\', notes TEXT DEFAULT \'\', created_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE)') } catch {}

  // 迁移：为旧数据库添加 cached_tokens 列
  try { db.run('ALTER TABLE token_usage ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0') } catch {}

  // 迁移：canon_facts 增加 details 字段
  try { db.run('ALTER TABLE canon_facts ADD COLUMN details TEXT DEFAULT \'{}\'') } catch {}

  // 迁移：将 character_cards 数据迁入 canon_facts
  try {
    const chars = db.exec("SELECT * FROM character_cards")
    if (chars.length > 0) {
      const cols = chars[0].columns
      const rows = chars[0].values
      for (const row of rows) {
        const obj: any = {}
        cols.forEach((c: string, i: number) => { obj[c] = row[i] })
        const details: any = {}
        if (obj.personality) details.personality = obj.personality
        if (obj.background) details.background = obj.background
        if (obj.appearance) details.appearance = obj.appearance
        if (obj.abilities) details.abilities = obj.abilities
        if (obj.relationships) details.relationships = obj.relationships
        if (obj.status_tracking) details.status_tracking = obj.status_tracking
        if (obj.role_type) details.role_type = obj.role_type
        db.run(
          "INSERT OR IGNORE INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details) VALUES (?, 'character', ?, ?, 1, '卡片迁移', ?)",
          [obj.project_id, obj.name, obj.notes || obj.personality?.slice(0, 200) || '', JSON.stringify(details)]
        )
      }
    }
  } catch {}

  // 迁移：将 world_settings 数据迁入 canon_facts
  try {
    const worlds = db.exec("SELECT * FROM world_settings")
    if (worlds.length > 0) {
      const cols = worlds[0].columns
      const rows = worlds[0].values
      for (const row of rows) {
        const obj: any = {}
        cols.forEach((c: string, i: number) => { obj[c] = row[i] })
        const details: any = {}
        if (obj.description) details.description = obj.description
        if (obj.details) details.inner_details = obj.details
        if (obj.trigger_keywords) details.trigger_keywords = obj.trigger_keywords
        if (obj.priority) details.priority = obj.priority
        if (obj.is_global) details.is_global = obj.is_global
        if (obj.notes) details.notes_text = obj.notes
        db.run(
          "INSERT OR IGNORE INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, details) VALUES (?, 'setting', ?, ?, 1, '卡片迁移', ?)",
          [obj.project_id, obj.name, (obj.description || '').slice(0, 200), JSON.stringify(details)]
        )
      }
    }
  } catch {}

  // 迁移后删除旧表
  try { db.run('DROP TABLE IF EXISTS character_cards') } catch {}
  try { db.run('DROP TABLE IF EXISTS world_settings') } catch {}

  // 设定库
  try {
    db.run('CREATE TABLE IF NOT EXISTS setting_libraries (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source_text TEXT NOT NULL DEFAULT \'\', setting_data TEXT NOT NULL DEFAULT \'{}\', created_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')), updated_at TEXT NOT NULL DEFAULT (datetime(\'now\',\'localtime\')))')
    // 验证表存在
    const test = db.exec('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'setting_libraries\'')
    if (test.length === 0 || test[0].values.length === 0) {
      console.error('FAILED to create setting_libraries table!')
    }
  } catch (e) {
    console.error('Error creating setting_libraries:', e)
  }

  // 插入默认设置
  db.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('api_key', '');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('api_base_url', 'https://api.deepseek.com');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('api_model', 'deepseek-v4-pro');
  `)

  saveToDisk()
}

/** 持久化到磁盘 */
function saveToDisk(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(DB_PATH, buffer)
}

/** 执行查询 (SELECT) */
export function query(sql: string, params?: any[]): any[] {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare(sql)
  if (params) stmt.bind(params)
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

/** 执行写操作 (INSERT/UPDATE/DELETE) */
export function run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number } {
  if (!db) throw new Error('Database not initialized')
  db.run(sql, params)
  saveToDisk()
  let lastId = 0
  try {
    const r = db.exec("SELECT last_insert_rowid() AS id")
    if (r.length > 0 && r[0].values.length > 0) lastId = r[0].values[0][0] as number || 0
  } catch {}
  // Fallback: if last_insert_rowid() returns 0, try to get the max id
  if (lastId === 0 && sql.trim().toUpperCase().startsWith('INSERT')) {
    try {
      // Extract table name from INSERT INTO "table" ...
      const m = sql.match(/INSERT\s+INTO\s+["'`]?(\w+)/i)
      if (m) {
        const r = db.exec(`SELECT MAX(id) AS mid FROM ${m[1]}`)
        if (r.length > 0 && r[0].values.length > 0) lastId = r[0].values[0][0] as number || 0
      }
    } catch {}
  }
  return {
    changes: db.getRowsModified(),
    lastInsertRowid: lastId,
  }
}

/** 查询单行 */
export function get(sql: string, params?: any[]): any | null {
  const rows = query(sql, params)
  return rows.length > 0 ? rows[0] : null
}

/** 关闭数据库 */
export function closeDatabase(): void {
  if (db) {
    saveToDisk()
    db.close()
    db = null
  }
}
