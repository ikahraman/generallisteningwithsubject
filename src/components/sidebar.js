const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'generator', label: 'Generate', icon: '✨' },
  { id: 'library', label: 'Library', icon: '📚' },
  { id: 'statistics', label: 'Statistics', icon: '📊' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
]

const STORAGE_KEY = 'sidebar-collapsed'
const isCollapsed = () => localStorage.getItem(STORAGE_KEY) === '1'

export function sidebarHTML(active) {
  return `
    <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle menu" title="Toggle menu">☰</button>
    <div class="sidebar-brand">Academic English Studio</div>
    <nav class="sidebar-nav">
      ${NAV_ITEMS.map(
        (item) => `
        <a href="#/${item.id}" class="sidebar-link ${item.id === active ? 'active' : ''}" title="${item.label}">
          <span class="sidebar-icon">${item.icon}</span>
          <span>${item.label}</span>
        </a>`
      ).join('')}
    </nav>
  `
}

// Called after every sidebarHTML() innerHTML swap (each route change) —
// re-applies the persisted collapsed state (the <aside> element itself is
// reused across routes, only its content is replaced) and (re)wires the
// toggle button, since the old one was just destroyed along with the markup.
export function wireSidebar(sidebarEl) {
  sidebarEl.classList.toggle('collapsed', isCollapsed())
  sidebarEl.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
    const collapsed = !sidebarEl.classList.contains('collapsed')
    sidebarEl.classList.toggle('collapsed', collapsed)
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  })
}
