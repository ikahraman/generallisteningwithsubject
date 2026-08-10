import { getAllMaterials, getAllStudyLog } from '../db.js'
import { GROUP_LABELS, hasAudioMode } from './material-modes.js'

const PALETTE = ['#6366f1', '#f43f5e', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7']

let materials = []
let studyLog = []
let chartRange = 7

export async function renderStatistics(container) {
  ;[materials, studyLog] = await Promise.all([getAllMaterials(), getAllStudyLog()])
  container.innerHTML = statisticsHTML()
  wireEvents(container)
}

function statisticsHTML() {
  const listeningSeconds = listeningTime(materials, studyLog)
  const vocabCount = uniqueVocabCount(materials)
  const materialsCompleted = materials.filter((m) => m.studyCount > 0).length
  const groupStats = groupCompletion(materials)
  const leastPracticed = leastPracticedGroup(groupStats)
  const topics = topicBreakdown(materials)

  return `
    <div class="page" style="max-width: 1000px;">
      <h1 class="section-title">Statistics</h1>

      <div class="dash-stats-row">
        <div class="stat-tile"><div class="stat-value">${formatMinutes(listeningSeconds)}</div><div class="stat-label">Listening Time</div></div>
        <div class="stat-tile"><div class="stat-value">${materialsCompleted}</div><div class="stat-label">Materials Completed</div></div>
        <div class="stat-tile"><div class="stat-value">${vocabCount}</div><div class="stat-label">Unique Vocabulary</div></div>
      </div>

      <div class="card">
        <div class="row">
          <h2 class="card-title">Study Time</h2>
          <div class="segmented" data-group="range">
            <button data-value="7" class="${chartRange === 7 ? 'active' : ''}">7 Days</button>
            <button data-value="30" class="${chartRange === 30 ? 'active' : ''}">30 Days</button>
          </div>
        </div>
        <div id="stats-chart">${chartHTML(dailyMinutes(studyLog, chartRange))}</div>
      </div>

      <div class="card">
        <h2 class="card-title">Weekly Streak</h2>
        ${streakCalendarHTML(studyLog)}
      </div>

      <div class="card">
        <h2 class="card-title">Completion by Question Group</h2>
        ${groupCompletionHTML(groupStats)}
        ${
          leastPracticed
            ? `<p class="card-hint" style="margin-top:12px;">Least practiced: <strong>${GROUP_LABELS[leastPracticed]}</strong> — you've answered the fewest questions here so far.</p>`
            : '<p class="card-hint" style="margin-top:12px;">Complete a Check All in Workspace to see your completion breakdown.</p>'
        }
      </div>

      <div class="card">
        <h2 class="card-title">Most Studied Topics</h2>
        ${pieChartHTML(topics)}
      </div>
    </div>
  `
}

// ---------- computations ----------

function listeningTime(materials, studyLog) {
  const modeById = new Map(materials.map((m) => [m.id, m.mode]))
  return studyLog
    .filter((s) => hasAudioMode(modeById.get(s.materialId)))
    .reduce((sum, s) => sum + (s.duration || 0), 0)
}

function uniqueVocabCount(materials) {
  const words = new Set()
  materials.forEach((m) => (m.vocabulary || []).forEach((v) => v.word && words.add(v.word.toLowerCase())))
  return words.size
}

// Free-text answers can't be auto-graded, so this tracks completion (how
// many questions per group have a written answer) rather than accuracy.
// groupD (Ear Training) is excluded — it's not a flat question list and
// self-checks per-exercise rather than tracking a written answer.
function groupCompletion(materials) {
  const stats = {
    groupA: { answered: 0, total: 0 },
    groupB: { answered: 0, total: 0 },
    groupC: { answered: 0, total: 0 },
  }
  materials.forEach((m) => {
    for (const group of Object.keys(stats)) {
      const questions = m.questions?.[group] || []
      const answers = m.userAnswers?.[group] || {}
      questions.forEach((q) => {
        stats[group].total++
        if ((answers[q.id] || '').trim()) stats[group].answered++
      })
    }
  })
  return stats
}

function leastPracticedGroup(stats) {
  let least = null
  let lowestPct = Infinity
  for (const [group, s] of Object.entries(stats)) {
    if (!s.total) continue
    const pct = s.answered / s.total
    if (pct < lowestPct) {
      lowestPct = pct
      least = group
    }
  }
  return least
}

function topicBreakdown(materials) {
  const useStudyCount = materials.some((m) => m.studyCount > 0)
  const counts = {}
  materials.forEach((m) => {
    const topic = m.topic || 'Other'
    const weight = useStudyCount ? m.studyCount || 0 : 1
    if (weight > 0) counts[topic] = (counts[topic] || 0) + weight
  })
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  return entries.map(([topic, value]) => ({ topic, pct: total ? Math.round((value / total) * 100) : 0 }))
}

function dailyMinutes(studyLog, days) {
  const buckets = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const seconds = studyLog.filter((s) => s.date.slice(0, 10) === key).reduce((sum, s) => sum + (s.duration || 0), 0)
    buckets.push({ date: key, minutes: Math.round(seconds / 60) })
  }
  return buckets
}

// ---------- render pieces ----------

function chartHTML(buckets) {
  const max = Math.max(1, ...buckets.map((b) => b.minutes))
  return `
    <div class="bar-chart">
      ${buckets
        .map(
          (b) => `
        <div class="bar-chart-col" title="${b.date}: ${b.minutes} min">
          <div class="bar-chart-bar" style="height:${Math.max(2, (b.minutes / max) * 100)}%"></div>
          <span class="bar-chart-label">${dayLabel(b.date, buckets.length)}</span>
        </div>`
        )
        .join('')}
    </div>
  `
}

function dayLabel(dateStr, rangeLength) {
  const d = new Date(dateStr + 'T00:00:00')
  return rangeLength <= 7 ? d.toLocaleDateString(undefined, { weekday: 'narrow' }) : String(d.getDate())
}

function streakCalendarHTML(studyLog) {
  const days = new Set(studyLog.map((s) => s.date.slice(0, 10)))
  const today = new Date()
  const cells = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    cells.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), active: days.has(key), key })
  }
  return `<div class="streak-row">${cells
    .map((c) => `<div class="streak-cell ${c.active ? 'active' : ''}" title="${c.key}">${c.label}</div>`)
    .join('')}</div>`
}

function groupCompletionHTML(stats) {
  return Object.entries(stats)
    .map(([group, s]) => {
      const pct = s.total ? Math.round((s.answered / s.total) * 100) : 0
      return `
        <div class="field">
          <div class="row"><span>${GROUP_LABELS[group]}</span><span class="text-muted">${pct}% (${s.answered}/${s.total})</span></div>
          <div class="progress-bar-lg"><div class="progress-bar-lg-fill" style="width:${pct}%"></div></div>
        </div>
      `
    })
    .join('')
}

function pieChartHTML(items) {
  if (!items.length) return '<p class="text-muted">No topics yet — generate some materials first.</p>'
  let cursor = 0
  const stops = items.map((item, i) => {
    const start = cursor
    cursor += item.pct
    return `${PALETTE[i % PALETTE.length]} ${start}% ${cursor}%`
  })
  return `
    <div class="pie-row">
      <div class="pie-chart" style="background: conic-gradient(${stops.join(', ')});"></div>
      <ul class="pie-legend">
        ${items
          .map(
            (item, i) =>
              `<li><span class="pie-swatch" style="background:${PALETTE[i % PALETTE.length]}"></span>${escapeHtml(item.topic)} — ${item.pct}%</li>`
          )
          .join('')}
      </ul>
    </div>
  `
}

function formatMinutes(seconds) {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}

// ---------- wiring ----------

function wireEvents(root) {
  root.querySelectorAll('[data-group="range"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      chartRange = Number(btn.dataset.value)
      root.querySelectorAll('[data-group="range"] button').forEach((b) => b.classList.toggle('active', b === btn))
      root.querySelector('#stats-chart').innerHTML = chartHTML(dailyMinutes(studyLog, chartRange))
    })
  })
}
