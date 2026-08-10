import { getAllMaterials, getAllFolders, getAllTags, updateMaterial, deleteMaterial, toggleFavorite } from '../db.js'
import { openModal } from '../components/modal.js'
import { materialCardHTML } from '../components/material-card.js'
import { downloadJSON, slugify } from '../utils/helpers.js'
import {
  filters,
  selectedIds,
  sortBy,
  setSortBy,
  materials,
  setLibraryData,
  removeMaterialsFromCache,
  getVisibleMaterials,
  escapeHtml,
} from './library-state.js'
import { sidebarHTML, wireSidebar } from './library-sidebar.js'
import { bulkBarHTML, wireBulkBar, handleLibraryImport } from './library-bulk.js'
import { MODES } from './material-modes.js'

export async function renderLibrary(container) {
  const [m, f, t] = await Promise.all([getAllMaterials(), getAllFolders(), getAllTags()])
  setLibraryData(m, f, t)
  selectedIds.clear()
  container.innerHTML = libraryHTML()
  wireEvents(container)
}

function libraryHTML() {
  return `
    <div class="library">
      <aside class="lib-sidebar">${sidebarHTML()}</aside>
      <main class="lib-main">
        <h1 class="section-title">Library</h1>
        <div class="lib-topbar">${topbarHTML()}</div>
        <div id="lib-bulk-bar">${selectedIds.size ? bulkBarHTML() : ''}</div>
        <div class="lib-grid" id="lib-grid">${gridHTML()}</div>
      </main>
    </div>
  `
}

function topbarHTML() {
  return `
    <input type="text" id="lib-search" placeholder="Search materials..." value="${escHtmlAttr(filters.search)}" />
    <select id="lib-sort">
      <option value="date-desc" ${sortBy === 'date-desc' ? 'selected' : ''}>Newest</option>
      <option value="title-asc" ${sortBy === 'title-asc' ? 'selected' : ''}>Title</option>
      <option value="level" ${sortBy === 'level' ? 'selected' : ''}>Level</option>
      <option value="last-studied" ${sortBy === 'last-studied' ? 'selected' : ''}>Last Studied</option>
    </select>
    <select id="lib-filter-level">
      <option value="">All Levels</option>
      ${['A1+', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => `<option value="${l}" ${filters.level === l ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <select id="lib-filter-mode">
      <option value="">All Modes</option>
      ${Object.entries(MODES)
        .map(([id, m]) => `<option value="${id}" ${filters.mode === id ? 'selected' : ''}>${m.label}</option>`)
        .join('')}
    </select>
    <label class="switch" title="Favorites only">
      <input type="checkbox" id="lib-fav-only" ${filters.favoritesOnly ? 'checked' : ''} />
      <span class="switch-track"></span>
    </label>
    <button class="btn" id="lib-import-btn">Import</button>
    <input type="file" id="lib-import-input" accept=".json,.zip" hidden />
  `
}

function gridHTML() {
  const list = getVisibleMaterials()
  if (!list.length) return '<p class="lib-empty">No materials match your filters. Generate one to get started.</p>'
  return list.map((m) => materialCardHTML(m, selectedIds.has(m.id))).join('')
}

// ---------- refresh helpers (passed as callbacks into the split submodules) ----------

async function refreshAll(root) {
  await renderLibrary(root)
}

function refreshGrid(root) {
  root.querySelector('#lib-grid').innerHTML = gridHTML()
  const bulkBar = root.querySelector('#lib-bulk-bar')
  if (bulkBar) bulkBar.innerHTML = selectedIds.size ? bulkBarHTML() : ''
  wireGridAndBulk(root)
}

function refreshSidebarAndGrid(root) {
  root.querySelector('.lib-sidebar').innerHTML = sidebarHTML()
  wireSidebar(root, { onFullRefresh: refreshAll, onFilterChange: refreshSidebarAndGrid })
  refreshGrid(root)
}

// ---------- wiring ----------

function wireEvents(root) {
  wireSidebar(root, { onFullRefresh: refreshAll, onFilterChange: refreshSidebarAndGrid })
  wireTopbar(root)
  wireGridAndBulk(root)
}

function wireTopbar(root) {
  let searchTimer
  root.querySelector('#lib-search').addEventListener('input', (e) => {
    clearTimeout(searchTimer)
    const value = e.target.value
    searchTimer = setTimeout(() => {
      filters.search = value
      refreshGrid(root)
    }, 300)
  })
  root.querySelector('#lib-sort').addEventListener('change', (e) => {
    setSortBy(e.target.value)
    refreshGrid(root)
  })
  root.querySelector('#lib-filter-level').addEventListener('change', (e) => {
    filters.level = e.target.value
    refreshGrid(root)
  })
  root.querySelector('#lib-filter-mode').addEventListener('change', (e) => {
    filters.mode = e.target.value
    refreshGrid(root)
  })
  root.querySelector('#lib-fav-only').addEventListener('change', (e) => {
    filters.favoritesOnly = e.target.checked
    refreshGrid(root)
  })

  const importInput = root.querySelector('#lib-import-input')
  root.querySelector('#lib-import-btn').addEventListener('click', () => importInput.click())
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0]
    if (file) await handleLibraryImport(root, file, refreshAll)
    importInput.value = ''
  })
}

function wireGridAndBulk(root) {
  root.querySelectorAll('[data-select]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = Number(cb.dataset.select)
      if (cb.checked) selectedIds.add(id)
      else selectedIds.delete(id)
      const bulkBar = root.querySelector('#lib-bulk-bar')
      if (bulkBar) bulkBar.innerHTML = selectedIds.size ? bulkBarHTML() : ''
      wireBulkBar(root, { onGridRefresh: refreshGrid })
    })
  })
  root.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.fav)
      const m = materials.find((x) => x.id === id)
      m.isFavorite = !m.isFavorite
      btn.textContent = m.isFavorite ? '★' : '☆'
      await toggleFavorite(id, m.isFavorite)
    })
  })
  root.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', () => exportSingleMaterial(Number(btn.dataset.export)))
  })
  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteMaterial(root, Number(btn.dataset.delete)))
  })
  wireBulkBar(root, { onGridRefresh: refreshGrid })
}

// ---------- single-material actions ----------

function exportSingleMaterial(id) {
  const m = materials.find((x) => x.id === id)
  const data = { materials: [m], folders: [], tags: [], studyLog: [], exportedAt: new Date().toISOString() }
  downloadJSON(data, `${slugify(m.title)}.json`)
}

function confirmDeleteMaterial(root, id) {
  const m = materials.find((x) => x.id === id)
  openModal({
    title: 'Delete Material?',
    bodyHTML: `<p>"${escapeHtml(m?.title || '')}" and its cached audio will be permanently deleted.</p>`,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Delete',
        variant: 'danger',
        onClick: async () => {
          await deleteMaterial(id)
          removeMaterialsFromCache([id])
          selectedIds.delete(id)
          refreshGrid(root)
        },
      },
    ],
  })
}

function escHtmlAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
