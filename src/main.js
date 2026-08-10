import './styles/variables.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import { getAllSettings } from './db.js'
import { renderSettings, applyTheme, applyAccent } from './modules/settings.js'
import { renderGenerator } from './modules/generator.js'
import { renderWorkspace } from './modules/workspace.js'
import { renderLibrary } from './modules/library.js'
import { renderDashboard } from './modules/dashboard.js'
import { renderStatistics } from './modules/statistics.js'
import { sidebarHTML, wireSidebar } from './components/sidebar.js'

// Workspace is opened contextually (from Generator/Library/Dashboard) via
// #/workspace/:id, so it isn't a sidebar tab.
const ROUTES = {
  dashboard: renderDashboard,
  generator: renderGenerator,
  library: renderLibrary,
  statistics: renderStatistics,
  settings: renderSettings,
}

function parseHash() {
  const hash = location.hash.replace('#/', '')
  const workspaceMatch = hash.match(/^workspace\/(\d+)$/)
  if (workspaceMatch) return { route: 'workspace', materialId: Number(workspaceMatch[1]) }
  return { route: ROUTES[hash] ? hash : 'dashboard' }
}

async function render() {
  const { route, materialId } = parseHash()
  const sidebarEl = document.querySelector('#app-sidebar')
  sidebarEl.innerHTML = sidebarHTML(route === 'workspace' ? null : route)
  wireSidebar(sidebarEl)

  const app = document.querySelector('#app')
  if (route === 'workspace') {
    await renderWorkspace(app, materialId)
  } else {
    await ROUTES[route](app)
  }
}

async function boot() {
  let settings = {}
  try {
    settings = await getAllSettings()
  } catch (err) {
    document.querySelector('#app-shell').innerHTML = `
      <div class="app-content" style="padding:2rem;text-align:center">
        <p>${err.message}</p>
      </div>
    `
    return
  }
  applyTheme(settings.theme || 'dark')
  applyAccent(settings.accentColor || 'indigo')

  document.querySelector('#app-shell').innerHTML = `
    <aside id="app-sidebar" class="app-sidebar"></aside>
    <div id="app" class="app-content"></div>
  `

  window.addEventListener('hashchange', render)
  await render()
}

boot()
