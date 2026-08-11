// Summary tab: a short (~10 sentence) AI-generated summary of the material
// — doubles as a quick comprehension recap and as short model material for
// speaking (read-aloud/shadowing) or writing practice. Live Edge-TTS-or-
// browser-voice playback only (same as Shadowing/Vocab Lesson) — this is
// supplementary text, not the primary listening content, so it isn't
// cached like the main transcript audio. Split out of workspace.js to stay
// under the 400-line-per-file rule.
import { speakStudyText, stopStudyAudio } from './workspace-audio.js'
import { getEtSpeed, setEtSpeed, SPEECH_RATE_OPTIONS } from '../utils/ear-training-utils.js'

export function renderSummaryPanel(material) {
  const summary = (material.summary || '').trim()
  if (!summary) {
    return '<p class="text-muted">No summary was generated for this material.</p>'
  }
  return `
    <div class="summary-panel">
      <div class="vocab-lesson-controls">
        <button class="btn primary" id="sum-play">▶ Listen</button>
        <button class="btn ghost" id="sum-stop">⏹ Stop</button>
        <label class="et-speed-label">Speed:
          <select id="sum-speed">
            ${SPEECH_RATE_OPTIONS.map((r) => `<option value="${r}" ${r === getEtSpeed() ? 'selected' : ''}>${r.toFixed(2)}x</option>`).join('')}
          </select>
        </label>
      </div>
      <p class="summary-text">${escapeHtml(summary)}</p>
    </div>
  `
}

export function wireSummaryPanel(root, material) {
  const summary = (material.summary || '').trim()
  root.querySelector('#sum-play')?.addEventListener('click', () => speakStudyText(summary, getEtSpeed()))
  root.querySelector('#sum-stop')?.addEventListener('click', () => stopStudyAudio())
  root.querySelector('#sum-speed')?.addEventListener('change', (e) => setEtSpeed(Number(e.target.value)))
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
