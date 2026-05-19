import { useLocation, useNavigate } from 'react-router-dom';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  section: string;
}

const navItems: NavItem[] = [
  { path: '/devices', label: '设备信息', icon: '🖥', section: '设备管理' },
  { path: '/backup', label: '配置备份', icon: '📦', section: '配置管理' },
  { path: '/diff', label: '配置对比', icon: '📊', section: '配置管理' },
  { path: '/inspect', label: '自动化巡检', icon: '📋', section: '运维工具' },
  { path: '/cli', label: '交互式终端', icon: '💻', section: '运维工具' },
  // { path: '/topology', label: '网络拓扑', icon: '🗺️', section: '可视化' },
  { path: '/scheduler', label: '定时任务', icon: '⏰', section: '自动化' },
  { path: '/ai', label: 'AI 运维助手', icon: '🤖', section: '智能运维' },
  { path: '/skills', label: '技能管理', icon: '🧩', section: '智能运维' },
];

export default function Sidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const sections = navItems.reduce<Record<string, NavItem[]>>((acc, item) => {
    if (!acc[item.section]) acc[item.section] = [];
    acc[item.section].push(item);
    return acc;
  }, {});

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>NetOps</h1>
        <p>网工运维工具</p>
      </div>
      <nav className="sidebar-nav">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section}>
            <div className="nav-section-title">{section}</div>
            {items.map(item => (
              <div
                key={item.path}
                className={`nav-item ${location.pathname === item.path ? 'active' : ''}`}
                onClick={() => navigate(item.path)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
