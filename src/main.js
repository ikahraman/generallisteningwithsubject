import './styles/variables.css'
import './styles/base.css'
import './styles/components.css'
import './styles/layout.css'
import { getAllSettings } from './db.js'
import { renderSettings, applyTheme, applyAccent } from './modules/settings.js'
import { renderGenerator } from './modules/generator.js'
import { renderContentStudio } from './modules/content-studio.js'
import { renderBbcContent } from './modules/bbc-content.js'
import { renderYoutubeContent } from './modules/youtube-content.js'
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
  'content-studio': renderContentStudio,
  'bbc-content': renderBbcContent,
  'youtube-content': renderYoutubeContent,
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

// The mobile drawer's own state lives on these two elements (a class each)
// rather than in a JS variable, since sidebarEl's innerHTML — but not the
// <aside> itself — gets replaced on every route change; reading classList
// off the persistent elements avoids needing to restore state after that.
function closeMobileSidebar() {
  document.querySelector('#app-sidebar')?.classList.remove('mobile-open')
  document.querySelector('#sidebar-backdrop')?.classList.remove('visible')
}

async function render() {
  closeMobileSidebar()
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
    <div class="mobile-topbar">
      <button id="mobile-menu-btn" class="mobile-menu-btn" aria-label="Open menu" title="Open menu">☰</button>
      <span class="mobile-topbar-brand">Academic English Studio</span>
    </div>
    <div id="sidebar-backdrop" class="sidebar-backdrop"></div>
    <aside id="app-sidebar" class="app-sidebar"></aside>
    <div id="app" class="app-content"></div>
  `

  document.querySelector('#mobile-menu-btn').addEventListener('click', () => {
    document.querySelector('#app-sidebar').classList.add('mobile-open')
    document.querySelector('#sidebar-backdrop').classList.add('visible')
  })
  document.querySelector('#sidebar-backdrop').addEventListener('click', closeMobileSidebar)

  window.addEventListener('hashchange', render)
  await render()
}

boot()
