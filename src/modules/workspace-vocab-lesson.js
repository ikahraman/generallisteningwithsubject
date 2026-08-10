// Vocab Lesson tab: turns the vocabulary list into a spoken-style narration
// — "let's look at the word X, it means Y, for example Z" — read aloud with
// one button, like a teacher walking through the list, instead of the
// silent word-by-word reference view in the Vocabulary tab. Split out of
// workspace-vocab.js to stay under the 400-line-per-file rule.
import { speakStudyText, stopStudyAudio, synthesizeStudyAudioBlob, requireApiKey, showAudioErrorModal, ENGINE_LABELS } from './workspace-audio.js'
import { getEtSpeed, setEtSpeed, SPEECH_RATE_OPTIONS } from '../utils/ear-training-utils.js'
import { downloadBlob, slugify } from '../utils/helpers.js'
import { openModal } from '../components/modal.js'
import { getAudioBlob, getSetting } from '../db.js'
import { generateAndCacheAudio, DEFAULT_VOICES } from '../api/tts.js'

const AUDIO_KIND = 'vocab-lesson'
let lessonAudio = null

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
      <div id="vl-audio-status"></div>
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

  root.querySelector('#vl-play-all')?.addEventListener('click', () => playFullLesson(material.id, fullText))
  root.querySelector('#vl-stop')?.addEventListener('click', () => stopLesson())
  root.querySelector('#vl-speed')?.addEventListener('change', (e) => setEtSpeed(Number(e.target.value)))
  root.querySelectorAll('.vl-speak').forEach((btn) => {
    btn.addEventListener('click', () => speakStudyText(btn.dataset.text, getEtSpeed()))
  })

  root.querySelector('#vl-download')?.addEventListener('click', () => downloadLessonMp3(root, material, fullText))

  refreshAudioStatus(root, material, segments)
}

// Plays the cached, previously-generated lesson narration (reliable, no
// live TTS call) if one exists; otherwise falls back to the same live Edge
// TTS / browser-voice path as the individual word buttons, so playback
// always works even before anyone hits "Generate Speech".
async function playFullLesson(materialId, fullText) {
  stopLesson()
  const cached = await getAudioBlob(materialId, AUDIO_KIND)
  if (cached?.blob) {
    const url = URL.createObjectURL(cached.blob)
    lessonAudio = new Audio(url)
    lessonAudio.playbackRate = getEtSpeed()
    lessonAudio.addEventListener('ended', () => URL.revokeObjectURL(url))
    lessonAudio.play().catch(() => {})
    return
  }
  speakStudyText(fullText, getEtSpeed())
}

function stopLesson() {
  lessonAudio?.pause()
  lessonAudio = null
  stopStudyAudio()
}

async function refreshAudioStatus(root, material, segments) {
  const container = root.querySelector('#vl-audio-status')
  if (!container) return
  const [cached, defaultEngine] = await Promise.all([
    getAudioBlob(material.id, AUDIO_KIND),
    getSetting('defaultTtsEngine', 'cloud'),
  ])
  container.innerHTML = renderAudioStatus(cached, defaultEngine)
  container.querySelector('#vl-generate')?.addEventListener('click', () => generateLessonAudio(root, material, segments))
}

function renderAudioStatus(cached, defaultEngine) {
  if (cached?.blob) {
    const label = ENGINE_LABELS[cached.engine] || cached.engine || 'unknown source'
    return `
      <div class="audio-source-row">
        <span class="badge">🔊 ${label}</span>
        <button class="btn ghost" id="vl-generate">↻ Regenerate</button>
      </div>
    `
  }
  return `
    <div class="banner warning" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <span>No generated lesson audio yet — the word buttons and "Play Full Lesson" still work via live playback, but generating caches it for fast, reliable, cross-device replay.</span>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <select id="vl-engine-select" title="Engine to generate with">
          <option value="cloud" ${defaultEngine === 'cloud' ? 'selected' : ''}>Google Cloud TTS</option>
          <option value="edge" ${defaultEngine === 'edge' ? 'selected' : ''}>Edge TTS</option>
        </select>
        <button class="btn primary" id="vl-generate">🔊 Generate Speech</button>
      </div>
    </div>
  `
}

async function generateLessonAudio(root, material, segments) {
  const btn = root.querySelector('#vl-generate')
  const engine = root.querySelector('#vl-engine-select')?.value || (await getSetting('defaultTtsEngine', 'cloud'))
  const resetBtn = () => {
    if (btn) {
      btn.disabled = false
      btn.textContent = '🔊 Generate Speech'
    }
  }
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Generating…'
  }
  try {
    const apiKey = await requireApiKey()
    if (!apiKey) return resetBtn()
    const paragraphs = segments.map((s) => ({ text: s.speechText }))
    await generateAndCacheAudio(material.id, paragraphs, apiKey, { ...DEFAULT_VOICES, preferredEngine: engine }, null, AUDIO_KIND)
    await refreshAudioStatus(root, material, segments)
  } catch (err) {
    resetBtn()
    showAudioErrorModal(err)
  }
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
