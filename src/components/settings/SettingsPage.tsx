import { useState, useEffect } from 'react'
import { showToast } from '../common/Toast'

const PROVIDERS = [
  { key: 'deepseek', name: 'DeepSeek', defaultUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-v4-pro', desc: '性价比高，中文能力强' },
  { key: 'openai', name: 'OpenAI', defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o', desc: '综合能力最强' },
  { key: 'anthropic', name: 'Anthropic Claude', defaultUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6', desc: '长文本理解优秀' },
  { key: 'qwen', name: '通义千问', defaultUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus', desc: '阿里云，国内稳定' },
]

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [provider, setProvider] = useState('deepseek')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<any>(null)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.electronAPI) {
          const savedKey = await window.electronAPI.settings.get('api_key')
          const savedProvider = await window.electronAPI.settings.get('llm_provider')
          const savedUrl = await window.electronAPI.settings.get('api_base_url')
          const savedModel = await window.electronAPI.settings.get('api_model')

          if (savedKey) setApiKey(savedKey)
          const prov = savedProvider || 'deepseek'
          setProvider(prov)

          const p = PROVIDERS.find(p => p.key === prov) || PROVIDERS[0]
          setBaseUrl(savedUrl || p.defaultUrl)
          setModel(savedModel || p.defaultModel)
        }
      } catch { /* 开发环境 */ }
      setLoaded(true)
    }
    loadSettings()
  }, [])

  const switchProvider = (prov: string) => {
    setProvider(prov)
    const p = PROVIDERS.find(p => p.key === prov)
    if (p) {
      setBaseUrl(p.defaultUrl)
      setModel(p.defaultModel)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (window.electronAPI) {
        await window.electronAPI.settings.set('api_key', apiKey.trim())
        await window.electronAPI.settings.set('llm_provider', provider)
        await window.electronAPI.settings.set('api_base_url', baseUrl.trim())
        await window.electronAPI.settings.set('api_model', model.trim())
      }
      showToast('success', '设置已保存')
    } catch (e: any) {
      showToast('error', '保存失败：' + (e.message || '未知错误'))
    } finally { setSaving(false) }
  }

  const handleTest = async () => {
    if (!apiKey.trim()) { showToast('error', '请先输入 API Key'); return }
    setTesting(true)
    try {
      if (window.electronAPI) {
        await window.electronAPI.settings.set('api_key', apiKey.trim())
        await window.electronAPI.settings.set('llm_provider', provider)
        await window.electronAPI.settings.set('api_base_url', baseUrl.trim())
        await window.electronAPI.settings.set('api_model', model.trim())
        const reply = await window.electronAPI.aiChat([
          { role: 'user', content: '你好，请回复"测试成功"' },
        ])
        if (reply) {
          showToast('success', `${PROVIDERS.find(p => p.key === provider)?.name || 'API'} 连接测试通过！✓`)
        } else {
          showToast('error', 'API 返回为空，请检查配置')
        }
      } else {
        await new Promise((r) => setTimeout(r, 1500))
        showToast('success', 'API 连接测试通过！（开发模式）')
      }
    } catch (e: any) {
      showToast('error', '连接失败：' + (e.message || '未知错误'))
    } finally { setTesting(false) }
  }

  const checkUpdate = async () => {
    setChecking(true)
    setUpdateInfo(null)
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.app.checkUpdate()
        setUpdateInfo(result)
        if (result.error) showToast('error', result.error)
        else if (result.hasUpdate) showToast('info', `发现新版本 ${result.latestVersion}`)
        else showToast('success', '已是最新版本')
      }
    } catch (e: any) {
      showToast('error', '检查失败：' + (e.message || ''))
    } finally { setChecking(false) }
  }

  const currentProvider = PROVIDERS.find(p => p.key === provider)

  return (
    <div>
      <h1 className="text-xl text-text-main mb-6">设置</h1>

      <div className="bg-white rounded-card border border-border p-5 max-w-lg">
        <h2 className="text-lg text-text-main mb-4">🤖 AI 模型配置</h2>

        {/* Provider 选择 */}
        <div className="mb-4">
          <label className="block text-base text-text-main mb-2">AI 供应商</label>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map(p => (
              <button
                key={p.key}
                onClick={() => switchProvider(p.key)}
                disabled={!loaded}
                className={`px-3 py-2 rounded-btn text-xs text-left border transition-colors
                  ${provider === p.key
                    ? 'border-primary bg-primary-light text-primary'
                    : 'border-border-input text-text-secondary hover:bg-bg-secondary'
                  }`}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-text-placeholder mt-0.5">{p.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* API Base URL */}
        <div className="mb-4">
          <label className="block text-base text-text-main mb-2">API 地址</label>
          <input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.deepseek.com/v1"
            disabled={!loaded}
            className="w-full h-10 px-3 border border-border-input rounded-btn text-base
                       focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                       placeholder:text-text-placeholder disabled:bg-bg-secondary disabled:text-text-placeholder"
          />
          <p className="text-sm text-text-secondary mt-1">
            {currentProvider ? `${currentProvider.name} 默认：${currentProvider.defaultUrl}` : ''}
          </p>
        </div>

        {/* 模型 */}
        <div className="mb-4">
          <label className="block text-base text-text-main mb-2">模型名称</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="deepseek-chat"
            disabled={!loaded}
            className="w-full h-10 px-3 border border-border-input rounded-btn text-base
                       focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                       placeholder:text-text-placeholder disabled:bg-bg-secondary disabled:text-text-placeholder"
          />
          <p className="text-sm text-text-secondary mt-1">
            {currentProvider ? `${currentProvider.name} 推荐模型：${currentProvider.defaultModel}` : '输入模型名称'}
          </p>
        </div>

        {/* API Key */}
        <div className="mb-4">
          <label className="block text-base text-text-main mb-2">API Key *</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            disabled={!loaded}
            className="w-full h-10 px-3 border border-border-input rounded-btn text-base
                       focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                       placeholder:text-text-placeholder disabled:bg-bg-secondary disabled:text-text-placeholder"
          />
          <p className="text-sm text-text-secondary mt-1">
            🔒 API Key 仅存储在你的电脑本地，不会上传到任何第三方服务器
          </p>
        </div>

        {/* 按钮组 */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !loaded}
            className={`px-4 py-2 rounded-btn text-base transition-colors
              ${loaded ? 'bg-primary text-white hover:bg-primary-hover' : 'bg-border text-text-placeholder cursor-not-allowed'}
            `}
          >
            {saving ? '⏳ 保存中...' : '💾 保存'}
          </button>
          <button
            onClick={handleTest}
            disabled={!apiKey.trim() || testing || !loaded}
            className={`px-4 py-2 rounded-btn text-base transition-colors
              ${apiKey.trim() && !testing && loaded
                ? 'border border-primary text-primary hover:bg-primary-light'
                : 'border border-border-input text-text-placeholder cursor-not-allowed'
              }`}
          >
            {testing ? '⏳ 测试中...' : '🔍 测试连接'}
          </button>
        </div>
      </div>

      {/* 版本更新 */}
      <div className="bg-white rounded-card border border-border p-5 max-w-lg mt-4">
        <h2 className="text-lg text-text-main mb-3">🔄 版本更新</h2>
        <p className="text-base text-text-secondary mb-3">当前版本：{updateInfo?.currentVersion || 'v2.2.0'}</p>
        <button
          onClick={checkUpdate}
          disabled={checking}
          className={`px-4 py-2 rounded-btn text-base transition-colors
            ${checking ? 'bg-border text-text-placeholder' : 'bg-primary text-white hover:bg-primary-hover'}
          `}
        >
          {checking ? '⏳ 检查中...' : '🔍 检查更新'}
        </button>
        {updateInfo && updateInfo.hasUpdate && (
          <div className="mt-3 p-3 bg-primary-light/10 border border-primary/20 rounded">
            <p className="text-sm font-medium text-text-main">发现新版本：{updateInfo.latestVersion}</p>
            {updateInfo.body && <pre className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">{updateInfo.body}</pre>}
            <a href={updateInfo.url} target="_blank" rel="noreferrer"
              className="inline-block mt-2 px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
              前往下载
            </a>
          </div>
        )}
        {updateInfo && !updateInfo.hasUpdate && !updateInfo.error && (
          <p className="mt-2 text-xs text-success">✅ 已是最新版本</p>
        )}
      </div>

      {/* 使用说明 */}
      <div className="bg-white rounded-card border border-border p-5 max-w-lg mt-4">
        <h2 className="text-lg text-text-main mb-3">📖 使用说明</h2>
        <ol className="text-base text-text-secondary space-y-2 list-decimal list-inside">
          <li>选择你的 AI 供应商（DeepSeek / OpenAI / Claude / 通义千问）</li>
          <li>在对应平台注册并获取 API Key</li>
          <li>将 API Key 填入上方输入框，点击「测试连接」确认可用</li>
          <li>进入「风格库」页面，导入一本小说，AI 会分析其写作风格</li>
          <li>在首页新建项目，选择风格库，开始创作</li>
        </ol>
      </div>
    </div>
  )
}
