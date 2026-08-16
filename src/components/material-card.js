import { formatDate } from '../utils/helpers.js'
import { MODE_LABELS } from '../modules/material-modes.js'

// groupD (Ear Training) is excluded — it's not a flat question list (see
// material-modes.js) and self-checks per-exercise rather than tracking a
// written answer, so it doesn't fit this "answered/total" progress metric.
function questionProgress(material) {
  const groups = ['groupA', 'groupB', 'groupC']
  let answered = 0
  let total = 0
  for (const g of groups) {
    const questions = material.questions?.[g] || []
    total += questions.length
    answered += Object.keys(material.userAnswers?.[g] || {}).length
  }
  return { answered, total }
}

// Derived from sourceUrl rather than a stored field, so existing materials
// (created before this badge existed) get a correct tag with no migration —
// BBC Content/YouTube Content are the only flows that set sourceUrl at all,
// so its presence/host already fully determines where a material came from.
function sourceTag(material) {
  if (!material.sourceUrl) return { label: 'Topic', icon: '✨' }
  if (/youtube\.com|youtu\.be/.test(material.sourceUrl)) return { label: 'YouTube', icon: '▶️' }
  if (/bbc\.co\.uk/.test(material.sourceUrl)) return { label: 'BBC', icon: '📻' }
  return { label: 'Source', icon: '🔗' }
}

export function materialCardHTML(material, selected, { showSelect = true } = {}) {
  const { answered, total } = questionProgress(material)
  const pct = total ? Math.round((answered / total) * 100) : 0
  const tag = sourceTag(material)

  return `
    <div class="material-card" data-id="${material.id}">
      <div class="card-top-row">
        ${
          showSelect
            ? `<label class="card-select"><input type="checkbox" data-select="${material.id}" ${selected ? 'checked' : ''} /></label>`
            : '<span></span>'
        }
        <button class="icon-btn card-fav" data-fav="${material.id}" aria-label="Toggle favorite">${material.isFavorite ? '★' : '☆'}</button>
      </div>
      <h3 class="card-title-sm">${escapeHtml(material.title)}</h3>
      <div class="card-badges">
        <span class="badge level">${material.level}</span>
        <span class="badge">${MODE_LABELS[material.mode] || material.mode}</span>
        <span class="badge" title="How this material was produced">${tag.icon} ${tag.label}</span>
      </div>
      <p class="card-meta">${material.wordCount || 0} words · ~${Math.round((material.duration || 0) / 60)} min</p>
      <p class="card-meta text-muted">Last studied: ${formatDate(material.lastStudiedAt)}</p>
      ${
        total
          ? `<div class="progress-bar" title="${answered}/${total} questions answered"><div class="progress-bar-fill" style="width:${pct}%"></div></div>`
          : ''
      }
      <div class="card-actions">
        <a class="btn primary" href="#/workspace/${material.id}">Study</a>
        <button class="btn ghost" data-export="${material.id}">Export</button>
        <button class="btn danger" data-delete="${material.id}">Delete</button>
      </div>
    </div>
  `
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
