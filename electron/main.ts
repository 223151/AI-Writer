import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { initDatabase, query, run, get, closeDatabase } from './database'

let mainWindow: BrowserWindow | null = null
let currentAbortController: AbortController | null = null

// ==================== 窗口创建 ====================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'AI 小说写作',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ==================== LLM Provider 配置 ====================

interface ProviderConfig {
  apiKey: string
  baseURL: string
  model: string
}

function getProviderConfig(): ProviderConfig {
  const provider = get('SELECT value FROM settings WHERE key = ?', ['llm_provider'])?.value || 'deepseek'
  const apiKey = get('SELECT value FROM settings WHERE key = ?', ['api_key'])?.value || ''

  const providerDefaults: Record<string, { baseURL: string; model: string }> = {
    deepseek: { baseURL: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
    openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' },
    anthropic: { baseURL: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6' },
    qwen: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  }

  const defaults = providerDefaults[provider] || providerDefaults.deepseek
  const baseUrl = get('SELECT value FROM settings WHERE key = ?', ['api_base_url'])?.value || defaults.baseURL
  const model = get('SELECT value FROM settings WHERE key = ?', ['api_model'])?.value || defaults.model

  return { apiKey, baseURL: baseUrl, model }
}

function recordTokenUsage(purpose: string, model: string, promptTokens: number, outputTokens: number, cachedTokens: number) {
  run(
    'INSERT INTO token_usage (purpose, model, prompt_tokens, cached_tokens, output_tokens, total_tokens) VALUES (?,?,?,?,?,?)',
    [purpose || '', model, promptTokens, cachedTokens, outputTokens, promptTokens + outputTokens]
  )
}

// ==================== IPC 处理器 ====================

function registerIpcHandlers() {
  // ---- 数据库操作 ----
  ipcMain.handle('db:query', (_event, sql: string, params?: any[]) => {
    return query(sql, params)
  })

  ipcMain.handle('db:run', (_event, sql: string, params?: any[]) => {
    return run(sql, params)
  })

  ipcMain.handle('db:get', (_event, sql: string, params?: any[]) => {
    return get(sql, params)
  })

  // ---- 设置操作（便捷方法） ----
  ipcMain.handle('settings:get', (_event, key: string) => {
    const row = get('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value ?? ''
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
    return true
  })

  // ---- AI API 调用（非流式，兼容旧代码） ----
  ipcMain.handle('ai:chat', async (_event, messages: any[], purpose?: string) => {
    const config = getProviderConfig()
    if (!config.apiKey) {
      throw new Error('请先在设置页面配置 API Key')
    }

    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })

    currentAbortController = new AbortController()
    try {
      const response = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      }, { signal: currentAbortController.signal })

      if (response.usage) {
        const promptTokens = response.usage.prompt_tokens || 0
        const outputTokens = response.usage.completion_tokens || 0
        const cachedTokens = (response.usage as any).prompt_tokens_details?.cached_tokens || 0
        recordTokenUsage(purpose || '', config.model, promptTokens, outputTokens, cachedTokens)
      }

      return response.choices[0]?.message?.content || ''
    } finally {
      currentAbortController = null
    }
  })

  // ---- AI 流式调用 ----
  ipcMain.handle('ai:chatStream', async (_event, messages: any[], purpose?: string) => {
    const config = getProviderConfig()
    if (!config.apiKey) {
      throw new Error('请先在设置页面配置 API Key')
    }

    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })

    currentAbortController = new AbortController()
    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
      }, { signal: currentAbortController.signal })

      let fullContent = ''
      let promptTokens = 0
      let outputTokens = 0
      let cachedTokens = 0

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || ''
        if (delta) {
          fullContent += delta
          mainWindow?.webContents.send('ai:stream-chunk', { chunk: delta, done: false })
        }
        if (chunk.usage) {
          promptTokens = chunk.usage.prompt_tokens || 0
          outputTokens = chunk.usage.completion_tokens || 0
          cachedTokens = (chunk.usage as any).prompt_tokens_details?.cached_tokens || 0
        }
      }

      if (promptTokens === 0 && outputTokens === 0) {
        const promptText = messages.map((m: any) => m.content).join('')
        const cnChars = (promptText.match(/[一-鿿]/g) || []).length
        promptTokens = Math.max(1, cnChars + Math.floor((promptText.length - cnChars) / 4))
        const outCnChars = (fullContent.match(/[一-鿿]/g) || []).length
        outputTokens = Math.max(1, outCnChars + Math.floor((fullContent.length - outCnChars) / 4))
      }

      mainWindow?.webContents.send('ai:stream-chunk', { chunk: '', done: true, usage: { promptTokens, outputTokens, cachedTokens } })
      recordTokenUsage(purpose || '', config.model, promptTokens, outputTokens, cachedTokens)
      return fullContent
    } catch (err: any) {
      if (err?.name === 'AbortError' || err?.message?.includes('abort')) {
        mainWindow?.webContents.send('ai:stream-chunk', { chunk: '', done: true, error: '已取消' })
        return ''
      }
      mainWindow?.webContents.send('ai:stream-chunk', { chunk: '', done: true, error: err.message })
      throw err
    } finally {
      currentAbortController = null
    }
  })

  // ---- 中断 AI 调用 ----
  ipcMain.on('ai:cancel', () => {
    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = null
    }
  })

  // ---- Token 用量查询 ----
  ipcMain.handle('tokens:stats', () => {
    const today = new Date().toISOString().slice(0, 10)
    const todayRow = get(
      "SELECT COALESCE(SUM(total_tokens),0) as total, COALESCE(SUM(prompt_tokens),0) as prompt, COALESCE(SUM(output_tokens),0) as output, COALESCE(SUM(cached_tokens),0) as cached, COUNT(*) as calls FROM token_usage WHERE created_at >= ?",
      [today]
    )
    const allRow = get(
      "SELECT COALESCE(SUM(total_tokens),0) as total, COALESCE(SUM(prompt_tokens),0) as prompt, COALESCE(SUM(output_tokens),0) as output, COALESCE(SUM(cached_tokens),0) as cached, COUNT(*) as calls FROM token_usage"
    )

    return {
      today: { tokens: todayRow?.total || 0, prompt: todayRow?.prompt || 0, output: todayRow?.output || 0, cached: todayRow?.cached || 0, calls: todayRow?.calls || 0 },
      total: { tokens: allRow?.total || 0, prompt: allRow?.prompt || 0, output: allRow?.output || 0, cached: allRow?.cached || 0, calls: allRow?.calls || 0 },
    }
  })

  ipcMain.handle('tokens:history', () => {
    return query(
      "SELECT purpose, model, prompt_tokens, output_tokens, total_tokens, created_at FROM token_usage ORDER BY created_at DESC LIMIT 50"
    )
  })

  // ---- 文件操作 ----
  ipcMain.handle('file:open', async (_event, options?: any) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: options?.filters || [
        { name: '文档文件', extensions: ['txt', 'docx', 'pdf'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const fileName = filePath.split(/[/\\]/).pop() || filePath
    return { filePath, fileName }
  })

  ipcMain.handle('file:read', (_event, filePath: string) => {
    return readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('file:save', async (_event, options?: any) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: options?.defaultPath,
      filters: options?.filters || [
        { name: '文本文档', extensions: ['txt'] },
        { name: 'Word 文档', extensions: ['docx'] },
        { name: 'PDF 文档', extensions: ['pdf'] },
      ],
    })
    if (result.canceled || !result.filePath) return null
    return { filePath: result.filePath }
  })

  ipcMain.handle('file:write', (_event, filePath: string, content: string) => {
    writeFileSync(filePath, content, 'utf-8')
  })

  ipcMain.handle('file:writeBuffer', (_event, filePath: string, base64Data: string) => {
    const buffer = Buffer.from(base64Data, 'base64')
    writeFileSync(filePath, buffer)
  })

  // ---- 文件解析（TXT/DOCX/PDF → 纯文本） ----
  ipcMain.handle('file:parse', async (_event, filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase()

    if (ext === 'txt') {
      return readFileSync(filePath, 'utf-8')
    }

    if (ext === 'docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      return result.value
    }

    if (ext === 'pdf') {
      const fs = await import('fs')
      const pdfParse = (await import('pdf-parse')).default
      const dataBuffer = fs.readFileSync(filePath)
      const data = await pdfParse(dataBuffer)
      return data.text
    }

    throw new Error(`不支持的文件格式: .${ext}`)
  })

  // ---- 应用信息 ----
  ipcMain.handle('app:getPath', (_event, name: string) => {
    return app.getPath(name as any)
  })
}

// ==================== 应用生命周期 ====================

app.whenReady().then(async () => {
  await initDatabase()
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  closeDatabase()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
