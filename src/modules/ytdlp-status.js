// yt-dlp Status: surfaces the version/update info server/system.js exposes.
// Exists because a datacenter-IP block on YouTube's audio CDN has already
// once been silently fixed by nothing more than a newer yt-dlp release (see
// git history) — without this page, noticing that requires SSHing in and
// running `yt-dlp --version` by hand. A weekly cron already runs the same
// update this page's button triggers manually; this is for checking it
// worked, or forcing it now instead of waiting up to a week.
import { getYtdlpStatus, updateYtdlp } from '../db.js'

let status = null
let loadError = ''
let isUpdating = false
let updateResult = ''

export async function renderYtdlpStatus(container) {
  container.innerHTML = `<div class="page"><h1 class="section-title">yt-dlp Status</h1><p class="card-hint">Loading…</p></div>`

  try {
    status = await getYtdlpStatus()
    loadError = ''
  } catch (err) {
    loadError = err.message || 'Could not load yt-dlp status.'
  }

  render(container)
}

function render(container) {
  container.innerHTML = `
    <div class="page">
      <h1 class="section-title">yt-dlp Status</h1>
      <p class="card-hint" style="margin-bottom: var(--space-6);">
        BBC Content, YouTube Content, and YouTube Channels all depend on <code>yt-dlp</code> to fetch real transcripts and audio. YouTube changes how it blocks/allows this fairly often, and a newer yt-dlp release is usually the fix — this checks whether one's available and can pull it now. A cron job on the server already does this automatically every Sunday at 03:00.
      </p>

      ${loadError ? `<div class="banner error">${escapeHtml(loadError)}</div>` : ''}

      ${status ? statusCardHTML() : ''}
      ${status?.log ? logCardHTML() : ''}
    </div>
  `

  wireEvents(container)
}

function statusCardHTML() {
  const { currentVersion, latestVersion, latestVersionError, updateAvailable, lastCheckedAt } = status
  return `
    <div class="card">
      <div class="card-badges" style="margin-bottom: var(--space-4);">
        <span class="badge">Installed: ${escapeHtml(currentVersion || 'unknown')}</span>
        ${latestVersion ? `<span class="badge">Latest on PyPI: ${escapeHtml(latestVersion)}</span>` : ''}
        ${
          updateAvailable
            ? `<span class="badge" style="color:var(--danger); border-color:var(--danger);">Update available</span>`
            : currentVersion && latestVersion
              ? `<span class="badge level">Up to date</span>`
              : ''
        }
      </div>
      ${latestVersionError ? `<p class="card-hint">Couldn't reach PyPI to check the latest version: ${escapeHtml(latestVersionError)}</p>` : ''}
      <p class="card-hint">Last automatic check/update: ${lastCheckedAt ? formatDateTime(lastCheckedAt) : 'never run yet'}</p>

      ${updateResult ? `<div class="banner ${/error|fail/i.test(updateResult) ? 'error' : 'success'}" style="margin-top:12px; white-space:pre-wrap;">${escapeHtml(updateResult)}</div>` : ''}
      <button class="btn primary" id="ytdlp-update-now" ${isUpdating ? 'disabled' : ''} style="margin-top:12px;">
        ${isUpdating ? spinnerHTML() + 'Updating…' : '⬆ Check & Update Now'}
      </button>
    </div>
  `
}

function logCardHTML() {
  return `
    <div class="card">
      <h2 class="card-title">Recent Update Log</h2>
      <p class="card-hint" style="margin-bottom:10px;">Output from the last couple of automatic (or manual) update runs.</p>
      <pre style="white-space:pre-wrap; font-size:12.5px; line-height:1.5; background:var(--bg-tertiary); padding:12px; border-radius:8px; max-height:320px; overflow:auto;">${escapeHtml(status.log)}</pre>
    </div>
  `
}

function wireEvents(root) {
  root.querySelector('#ytdlp-update-now')?.addEventListener('click', () => handleUpdate(root))
}

async function handleUpdate(root) {
  isUpdating = true
  updateResult = ''
  render(root)

  try {
    const result = await updateYtdlp()
    status = result.status
    updateResult = result.output || 'Update finished — no output.'
  } catch (err) {
    updateResult = err.message || 'Update failed.'
  } finally {
    isUpdating = false
    render(root)
  }
}

function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function spinnerHTML() {
  return '<span class="spinner"></span> '
}
function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
