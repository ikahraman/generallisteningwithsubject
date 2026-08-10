import { getAllMaterials, getAllStudyLog, toggleFavorite, deleteMaterial } from '../db.js'
import { materialCardHTML } from '../components/material-card.js'
import { openModal } from '../components/modal.js'
import { downloadJSON, slugify } from '../utils/helpers.js'

const DAILY_GOAL_MINUTES = 20

export async function renderDashboard(container) {
  const [materials, studyLog] = await Promise.all([getAllMaterials(), getAllStudyLog()])

  const continueLearning = pickContinueLearning(materials)
  const recent = recentlyStudied(materials)
  const favorites = materials.filter((m) => m.isFavorite)
  const stats = computeQuickStats(materials, studyLog)
  const todayMinutes = computeTodayMinutes(studyLog)
  const goalPct = Math.min(100, Math.round((todayMinutes / DAILY_GOAL_MINUTES) * 100))

  container.innerHTML = `
    <div class="page" style="max-width: 1000px;">
      <div class="dash-header">
        <h1 class="section-title">Dashboard</h1>
        <a class="btn primary" href="#/generator">+ Quick Generate</a>
      </div>

      <div class="dash-stats-row">
        ${statTileHTML('Materials', stats.totalMaterials)}
        ${statTileHTML('Study Time', formatMinutes(stats.totalStudySeconds))}
        ${statTileHTML('Weekly Streak', `${stats.streak} day${stats.streak === 1 ? '' : 's'}`)}
        ${statTileHTML('Completion', stats.completion !== null ? `${stats.completion}%` : '—')}
      </div>

      <div class="card">
        <h2 class="card-title">Daily Goal</h2>
        <div class="progress-bar-lg"><div class="progress-bar-lg-fill" style="width:${goalPct}%"></div></div>
        <p class="card-hint">${todayMinutes}/${DAILY_GOAL_MINUTES} min today</p>
      </div>

      ${
        continueLearning
          ? `<div class="card">
              <h2 class="card-title">Continue Learning</h2>
              <div class="lib-grid">${materialCardHTML(continueLearning, false, { showSelect: false })}</div>
            </div>`
          : ''
      }

      <div class="card">
        <h2 class="card-title">Recent Materials</h2>
        <div class="lib-grid">
          ${recent.length ? recent.map((m) => materialCardHTML(m, false, { showSelect: false })).join('') : '<p class="text-muted">Nothing studied yet — finish a Check All in Workspace to see it here.</p>'}
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">Favorites</h2>
        <div class="lib-grid">
          ${favorites.length ? favorites.map((m) => materialCardHTML(m, false, { showSelect: false })).join('') : '<p class="text-muted">No favorites yet.</p>'}
        </div>
      </div>
    </div>
  `

  wireEvents(container)
}

function statTileHTML(label, value) {
  return `<div class="stat-tile"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`
}

function pickContinueLearning(materials) {
  const opened = materials.filter((m) => m.lastOpenedAt).sort((a, b) => new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt))
  return opened[0] || null
}

function recentlyStudied(materials, limit = 5) {
  return materials
    .filter((m) => m.lastStudiedAt)
    .sort((a, b) => new Date(b.lastStudiedAt) - new Date(a.lastStudiedAt))
    .slice(0, limit)
}

function computeQuickStats(materials, studyLog) {
  const totalStudySeconds = studyLog.reduce((sum, s) => sum + (s.duration || 0), 0)
  const totalAnswered = studyLog.reduce((sum, s) => sum + (s.answeredCount || 0), 0)
  const totalQuestions = studyLog.reduce((sum, s) => sum + (s.totalCount || 0), 0)
  return {
    totalMaterials: materials.length,
    totalStudySeconds,
    completion: totalQuestions ? Math.round((totalAnswered / totalQuestions) * 100) : null,
    streak: computeStreak(studyLog),
  }
}

function computeStreak(studyLog) {
  const days = new Set(studyLog.map((s) => s.date.slice(0, 10)))
  let streak = 0
  const cursor = new Date()
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function computeTodayMinutes(studyLog) {
  const today = new Date().toISOString().slice(0, 10)
  const seconds = studyLog.filter((s) => s.date.slice(0, 10) === today).reduce((sum, s) => sum + (s.duration || 0), 0)
  return Math.round(seconds / 60)
}

function formatMinutes(seconds) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// ---------- card actions (favorite / export / delete), same behavior as Library ----------

function wireEvents(root) {
  root.querySelectorAll('[data-fav]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.fav)
      const isFavorite = btn.textContent.trim() !== '★'
      btn.textContent = isFavorite ? '★' : '☆'
      await toggleFavorite(id, isFavorite)
    })
  })
  root.querySelectorAll('[data-export]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.export)
      const materials = await getAllMaterials()
      const m = materials.find((x) => x.id === id)
      downloadJSON(
        { materials: [m], folders: [], tags: [], studyLog: [], exportedAt: new Date().toISOString() },
        `${slugify(m.title)}.json`
      )
    })
  })
  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => confirmDeleteMaterial(root, Number(btn.dataset.delete)))
  })
}

function confirmDeleteMaterial(root, id) {
  openModal({
    title: 'Delete Material?',
    bodyHTML: '<p>This material and its cached audio will be permanently deleted.</p>',
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Delete',
        variant: 'danger',
        onClick: async () => {
          await deleteMaterial(id)
          await renderDashboard(root)
        },
      },
    ],
  })
}
