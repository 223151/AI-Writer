import { NavLink, useLocation, useNavigate } from 'react-router-dom'

interface SidebarProps {
  collapsed?: boolean
  onToggle?: () => void
}

const navItems = [
  { path: '/', label: '首页', icon: '🏠' },
  { path: '/disassembly', label: '拆文库', icon: '🔬' },
  { path: '/setting-lib', label: '设定库', icon: '📋' },
  { path: '/library', label: '风格库', icon: '🎨' },
  { path: '/personality', label: '人格库', icon: '🧠' },
  { path: '/settings', label: '设置', icon: '⚙' },
]

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()

  if (collapsed) {
    return (
      <aside className="w-12 bg-bg-sidebar flex flex-col items-center shrink-0 border-r border-border py-2 gap-1">
        <button onClick={onToggle} className="w-8 h-8 flex items-center justify-center text-sm hover:bg-white rounded-btn transition-colors" title="展开菜单">
          ▶
        </button>
        {navItems.map((item) => {
          const isActive = (item.path === '/' && location.pathname === '/') ||
            (item.path !== '/' && location.pathname.startsWith(item.path))
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-8 h-8 flex items-center justify-center text-sm rounded-btn transition-colors
                ${isActive ? 'bg-primary-light text-primary' : 'text-text-secondary hover:bg-white'}
              `}
              title={item.label}
            >
              {item.icon}
            </button>
          )
        })}
        <div className="flex-1" />
        <div className="text-xs text-text-placeholder -rotate-90 whitespace-nowrap mb-4">v1</div>
      </aside>
    )
  }

  return (
    <aside className="w-sidebar bg-bg-sidebar flex flex-col shrink-0">
      <div className="h-9 flex items-center justify-center border-b border-border">
        {onToggle && (
          <button onClick={onToggle} className="absolute left-2 text-xs text-text-placeholder hover:text-primary" title="收起菜单">◀</button>
        )}
        <span className="text-sm text-primary font-medium">📖 AI写作</span>
      </div>

      <nav className="flex-1 py-3 flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = (item.path === '/' && location.pathname === '/') ||
            (item.path !== '/' && location.pathname.startsWith(item.path))
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`flex items-center gap-2.5 h-10 pl-3 pr-2 mx-1.5 rounded-btn text-lg transition-colors
                ${isActive
                  ? 'bg-primary-light text-primary font-medium'
                  : 'text-text-secondary hover:bg-white hover:text-text-main'
                }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="text-center py-2 text-xxs text-text-placeholder border-t border-border">
        v2.2.0
      </div>
    </aside>
  )
}
