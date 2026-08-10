// Vocab Lesson tab: turns the vocabulary list into a spoken-style narration
// — "let's look at the word X, it means Y, for example Z" — read aloud with
// one button, like a teacher walking through the list, instead of the
// silent word-by-word reference view in the Vocabulary tab. Split out of
// workspace-vocab.js to stay under the 400-line-per-file rule.
import { speakStudyText, stopStudyAudio, synthesizeStudyAudioBlob } from './workspace-audio.js'
import { getEtSpeed, setEtSpeed, SPEECH_RATE_OPTIONS } from '../utils/ear-training-utils.js'
import { downloadBlob, slugify } from '../utils/helpers.js'
import { openModal } from '../components/modal.js'

// Turkish meaning is deliberately left out of the spoken text — an
// English voice reading a Turkish word aloud comes out mispronounced and
// confusing. It's still shown in the visible text below, just not spoken.
function buildSegment(v) {
  const examples = (v.examples || []).map((ex) => (typeof ex === 'string' ? ex : ex.text)).filter(Boolean)
  const speechParts = [`Let's look at the word "${v.word}".`]
  if (v.synonym) speechParts.push(`It's similar in meaning to "${v.synonym}".`)
  if (v.antonym) speechParts.push(`It's the opposite of "${v.antonym}".`)
  examples.forEach((ex, i) => speechParts.push(i === 0 ? `For example: ${ex}` : `Another example: ${ex}`))

  return {
    word: v.word,
    meaningTR: v.meaningTR || v.meaning || '',
    synonym: v.synonym || '',
    antonym: v.antonym || '',
    examples,
    speechText: speechParts.join(' '),
  }
}

export function renderVocabLessonPanel(material) {
  const items = material.vocabulary || []
  if (!items.length) return '<p class="text-muted">No vocabulary for this material.</p>'
  const segments = items.map(buildSegment)

  return `
    <div class="vocab-lesson">
      <div class="vocab-lesson-controls">
        <button class="btn primary" id="vl-play-all">▶ Play Full Lesson</button>
        <button class="btn ghost" id="vl-stop">⏹ Stop</button>
        <label class="et-speed-label">Speed:
          <select id="vl-speed">
            ${SPEECH_RATE_OPTIONS.map((r) => `<option value="${r}" ${r === getEtSpeed() ? 'selected' : ''}>${r.toFixed(2)}x</option>`).join('')}
          </select>
        </label>
        <button class="btn ghost" id="vl-download">⬇ Download MP3</button>
      </div>
      <div class="vocab-lesson-list">
        ${segments.map(renderSegment).join('')}
      </div>
    </div>
  `
}

function renderSegment(seg) {
  return `
    <div class="vocab-lesson-item">
      <p class="vocab-lesson-head">
        <button class="icon-btn vl-speak" data-text="${escapeAttr(seg.speechText)}" title="Play this word" aria-label="Play ${escapeAttr(seg.word)}">🔊</button>
        <strong>${escapeHtml(seg.word)}</strong>
        ${seg.meaningTR ? `<span class="text-muted">— TR: ${escapeHtml(seg.meaningTR)}</span>` : ''}
      </p>
      <p class="vocab-lesson-text">
        Let's look at the word <strong>${escapeHtml(seg.word)}</strong>.
        ${seg.synonym ? ` It's similar in meaning to <em>${escapeHtml(seg.synonym)}</em>.` : ''}
        ${seg.antonym ? ` It's the opposite of <em>${escapeHtml(seg.antonym)}</em>.` : ''}
        ${seg.examples
          .map((ex, i) => ` ${i === 0 ? 'For example' : 'Another example'}: ${escapeHtml(stripTrailingPeriod(ex))}.`)
          .join('')}
      </p>
    </div>
  `
}

export function wireVocabLessonPanel(root, material) {
  const segments = (material.vocabulary || []).map(buildSegment)
  const fullText = segments.map((s) => s.speechText).join(' ... ')

  root.querySelector('#vl-play-all')?.addEventListener('click', () => speakStudyText(fullText, getEtSpeed()))
  root.querySelector('#vl-stop')?.addEventListener('click', () => stopStudyAudio())
  root.querySelector('#vl-speed')?.addEventListener('change', (e) => setEtSpeed(Number(e.target.value)))
  root.querySelectorAll('.vl-speak').forEach((btn) => {
    btn.addEventListener('click', () => speakStudyText(btn.dataset.text, getEtSpeed()))
  })

  root.querySelector('#vl-download')?.addEventListener('click', () => downloadLessonMp3(root, material, fullText))
}

async function downloadLessonMp3(root, material, fullText) {
  const btn = root.querySelector('#vl-download')
  const resetBtn = () => {
    if (btn) {
      btn.disabled = false
      btn.textContent = '⬇ Download MP3'
    }
  }
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Generating…'
  }
  try {
    const wavBlob = await synthesizeStudyAudioBlob(fullText, getEtSpeed())
    const { wavBlobToMp3Blob } = await import('../utils/mp3-encoder.js')
    const mp3Blob = await wavBlobToMp3Blob(wavBlob)
    downloadBlob(mp3Blob, `${slugify(material.title)}-vocab-lesson.mp3`)
  } catch (err) {
    openModal({
      title: 'Download Failed',
      bodyHTML: `<p>Edge TTS is unavailable (${escapeHtml(err.message || 'request failed')}), so the MP3 couldn't be generated. Make sure the Edge TTS server is running and try again.</p>`,
      actions: [{ label: 'Close' }],
    })
  } finally {
    resetBtn()
  }
}

function stripTrailingPeriod(str) {
  return str.replace(/\.+\s*$/, '')
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
