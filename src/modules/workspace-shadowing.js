// Shadowing tab: medium-length sentences pulled straight from the
// transcript for shadowing practice (listen, then repeat aloud along with
// or right after the audio). There's no "correct answer" to check here —
// shadowing is a speaking/rhythm technique, not a comprehension test — so
// this is just a list of sentences with a Listen button each. Shares Ear
// Training's playback speed (same underlying getEtSpeed/setEtSpeed), kept
// in its own module purely to stay under the 400-line-per-file rule.
import { speakStudyText } from './workspace-audio.js'
import { getEtSpeed, setEtSpeed, SPEECH_RATE_OPTIONS } from '../utils/ear-training-utils.js'

export function renderShadowingPanel(material) {
  const items = material.shadowing || []
  if (!items.length) {
    return '<p class="text-muted">No shadowing sentences were generated for this material.</p>'
  }
  return `
    <div class="sh-panel">
      <div class="et-speed-row">
        <label class="et-speed-label">Speed:
          <select id="sh-speed">
            ${SPEECH_RATE_OPTIONS.map((r) => `<option value="${r}" ${r === getEtSpeed() ? 'selected' : ''}>${r.toFixed(2)}x</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="sh-list">
        ${items
          .map(
            (item, i) => `
            <div class="sh-card">
              <span class="sh-index">${i + 1}</span>
              <p class="sh-text">${escapeHtml(item.text)}</p>
              <button class="btn ghost sh-speak" data-text="${escapeAttr(item.text)}">🔊 Listen</button>
            </div>`
          )
          .join('')}
      </div>
    </div>
  `
}

export function wireShadowingPanel(root) {
  root.querySelector('#sh-speed')?.addEventListener('change', (e) => setEtSpeed(Number(e.target.value)))
  root.querySelectorAll('.sh-speak').forEach((btn) => {
    btn.addEventListener('click', () => speakStudyText(btn.dataset.text, getEtSpeed()))
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
