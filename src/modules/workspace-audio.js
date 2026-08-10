// Audio playback + on-demand TTS generation for Workspace, split out of
// workspace.js to stay under the 400-line-per-file rule. `material` is
// passed in by reference (not duplicated module state) so mutations here
// (bookmarks) are visible to workspace.js without a shared-state module.
import { getAudioBlob } from '../db.js'
import { getSetting } from '../db.js'
import { MaterialPlayer } from '../api/material-player.js'
import { generateAndCacheAudio, generateAndCacheAudioWithEngine, DEFAULT_VOICES } from '../api/tts.js'
import { synthesizeSpeech as synthesizeEdgeSpeech, EDGE_TTS_VOICES } from '../api/edge-tts.js'
import { synthesizeSpeech as synthesizeCloudSpeech, CLOUD_TTS_VOICES } from '../api/cloud-tts.js'
import { pcmToWavBlob } from '../api/gemini.js'
import { audioPlayerHTML, wireAudioPlayer } from '../components/audio-player.js'
import { openModal } from '../components/modal.js'
import { showToast } from '../components/toast.js'
import { downloadBlob, slugify, pickBestVoice } from '../utils/helpers.js'

export const ENGINE_LABELS = { cloud: 'Google Cloud TTS', edge: 'Edge TTS', gemini: 'Gemini TTS' }

let player = null

// Plain browser-voice playback — the last-resort fallback when neither Edge
// nor Cloud TTS is reachable (see speakVocabText/speakStudyText below).
// Reuses the same defaultVoice/defaultSpeed settings as the main player,
// unless `rateOverride` is given (Ear Training/Shadowing have their own
// speed control, independent of the main audio player's).
export async function speakText(text, rateOverride) {
  if (!('speechSynthesis' in window)) return
  speechSynthesis.cancel()
  const [voiceURI, defaultRate] = await Promise.all([getSetting('defaultVoice', ''), getSetting('defaultSpeed', 1)])
  const voices = speechSynthesis.getVoices()
  const voice = voices.find((v) => `${v.name}::${v.lang}` === voiceURI) || pickBestVoice(voices)
  const utter = new SpeechSynthesisUtterance(text)
  if (voice) utter.voice = voice
  utter.rate = rateOverride ?? defaultRate
  speechSynthesis.speak(utter)
}

let quickAudio = null

// Tries Edge TTS for a one-off playback (vocab word/example, ear training
// item, shadowing sentence, vocab lesson narration — anything using
// playQuickPcm rather than the main cached-audio player). Returns true on
// success (audio already playing), false if the Edge server isn't
// reachable, so callers can decide what to fall back to.
async function tryEdge(text, rate) {
  try {
    const { pcmBytes, sampleRate } = await synthesizeEdgeSpeech(text, EDGE_TTS_VOICES[0])
    playQuickPcm(pcmBytes, sampleRate, rate)
    return true
  } catch {
    return false
  }
}

// Real-engine pronunciation playback for vocabulary study (word or example
// sentence) — tries Edge TTS first (free, no Google quota risk), then Cloud
// TTS, and only falls back to the plain browser voice if both are
// unavailable (Edge server not running, no API key, offline, etc), with a
// toast so a silent-sounding fallback is at least visible.
export async function speakVocabText(text, rateOverride) {
  quickAudio?.pause()
  quickAudio = null
  const rate = rateOverride ?? (await getSetting('defaultSpeed', 1))

  if (await tryEdge(text, rate)) return

  const apiKey = await getSetting('geminiApiKey', '')
  if (apiKey) {
    try {
      const { pcmBytes, sampleRate } = await synthesizeCloudSpeech(apiKey, text, CLOUD_TTS_VOICES[0])
      playQuickPcm(pcmBytes, sampleRate, rate)
      return
    } catch {
      // Cloud failed too (quota, no billing, etc) — fall back to browser voice.
    }
  }

  showToast('Edge/Cloud TTS unavailable — using browser voice')
  speakText(text, rateOverride)
}

// Same idea as speakVocabText, but for Ear Training and Shadowing — these
// see far more clicks per session, so Cloud TTS is deliberately never used
// here (would burn through Google's quota fast). Edge TTS or nothing.
export async function speakStudyText(text, rateOverride) {
  quickAudio?.pause()
  quickAudio = null
  const rate = rateOverride ?? (await getSetting('defaultSpeed', 1))

  if (await tryEdge(text, rate)) return

  showToast('Edge TTS unavailable — using browser voice')
  speakText(text, rateOverride)
}

// Stops whichever engine is currently talking — used by the Vocab Lesson
// panel's Stop button, since a full-lesson narration can run long.
export function stopStudyAudio() {
  quickAudio?.pause()
  if ('speechSynthesis' in window) speechSynthesis.cancel()
}

// Numeric playback-rate multiplier (0.8–1.25, see SPEECH_RATE_OPTIONS) to
// the percentage string Edge TTS's own rate parameter expects.
function ratePercent(rate) {
  const pct = Math.round((rate - 1) * 100)
  return `${pct >= 0 ? '+' : ''}${pct}%`
}

// Synthesizes text via Edge TTS *at the given speed*, baked into the audio
// itself rather than applied as HTMLMediaElement.playbackRate — needed for
// a downloadable file, since playbackRate only affects in-browser playback,
// not the exported bytes. No browser-voice fallback here: there's nothing
// to download from speechSynthesis, so callers should show a clear error
// instead of silently producing a normal-speed (or empty) file.
export async function synthesizeStudyAudioBlob(text, rate = 1) {
  const { pcmBytes, sampleRate } = await synthesizeEdgeSpeech(text, EDGE_TTS_VOICES[0], ratePercent(rate))
  return pcmToWavBlob(pcmBytes, sampleRate)
}

function playQuickPcm(pcmBytes, sampleRate, rate) {
  const url = URL.createObjectURL(pcmToWavBlob(pcmBytes, sampleRate))
  quickAudio = new Audio(url)
  quickAudio.playbackRate = rate
  quickAudio.addEventListener('ended', () => URL.revokeObjectURL(url))
  // Swallow the "interrupted by a call to pause()" rejection — expected
  // when the user clicks another Listen button (or Stop) before this one
  // finishes loading; not an actual failure.
  quickAudio.play().catch(() => {})
}

// Shown instead of a plain audio player whenever a listening-mode material
// has no cached audio yet — e.g. generation failed at creation time (quota,
// "high demand", etc.) and silently fell back to browser TTS. Browser TTS
// still plays below so the material is usable immediately either way. The
// engine select here lets the user pick Cloud/Edge for this one generation
// without having to go change the Settings default first.
export function renderAudioSection(cachedAudio, defaultSpeed = 1, defaultEngine = 'cloud') {
  if (cachedAudio?.blob) {
    const engine = cachedAudio.engine
    const label = engine ? ENGINE_LABELS[engine] || engine : 'unknown source'
    const showUpgrade = engine && engine !== 'cloud'
    return `
      <div class="audio-source-row">
        <span class="badge">🔊 ${label}</span>
        ${showUpgrade ? `<button class="btn ghost" id="ws-upgrade-google-tts">⬆ Generate with Google TTS</button>` : ''}
      </div>
      ${audioPlayerHTML(defaultSpeed)}
    `
  }
  return `
    <div class="banner warning" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <span>No real audio generated for this material yet. You can listen with your browser's voice below, or generate real audio now.</span>
      <div style="display:flex; gap:8px; align-items:center; flex-shrink:0;">
        <select id="ws-engine-select" title="Engine to generate with">
          <option value="cloud" ${defaultEngine === 'cloud' ? 'selected' : ''}>Google Cloud TTS</option>
          <option value="edge" ${defaultEngine === 'edge' ? 'selected' : ''}>Edge TTS</option>
        </select>
        <button class="btn primary" id="ws-generate-speech">🔊 Generate Speech</button>
      </div>
    </div>
    ${audioPlayerHTML(defaultSpeed)}
  `
}

export function destroyAudioPlayer() {
  player?.destroy()
  player = null
}

/**
 * @param {HTMLElement} root
 * @param {object} material
 * @param {Array} sentences
 * @param {() => Promise<void>} onAudioChanged called after audio is generated so the caller can re-render
 */
export async function setupAudioPlayer(root, material, sentences, onAudioChanged) {
  root.querySelector('#ws-generate-speech')?.addEventListener('click', () => generateSpeechInPlace(root, material, onAudioChanged))
  root.querySelector('#ws-upgrade-google-tts')?.addEventListener('click', () => upgradeToGoogleTts(root, material, onAudioChanged))

  const audioRow = await getAudioBlob(material.id)
  const defaultVoice = await getSetting('defaultVoice', '')
  const defaultSpeed = await getSetting('defaultSpeed', 1)

  player = new MaterialPlayer({
    sentences,
    audioBlob: audioRow?.blob,
    voiceURI: defaultVoice,
    rate: defaultSpeed,
  })

  wireAudioPlayer(root, player, {
    onDownload: (blob) => downloadBlob(blob, `${slugify(material.title)}.wav`),
    onGenerateAndDownload: () => generateAudioOnDemand(root, material, onAudioChanged),
  })

  player.addEventListener('sentencechange', (e) => highlightSentence(root, e.detail.index))

  root.querySelectorAll('[data-sentence-index]').forEach((el) => {
    el.addEventListener('click', () => {
      player.seekToSentence(Number(el.dataset.sentenceIndex))
      player.play()
    })
  })
}

export async function requireApiKey() {
  const apiKey = await getSetting('geminiApiKey', '')
  if (!apiKey) {
    openModal({
      title: 'Gemini API Key Required',
      bodyHTML: '<p>Add your Gemini API key in Settings to generate audio for this material.</p>',
      actions: [{ label: 'Close' }],
    })
  }
  return apiKey || null
}

// Runs TTS generation with a Gemini-TTS safety net (engineOverride wins over
// the Settings default, e.g. from the inline picker in the "no audio yet"
// banner); returns null (after showing the "no key" modal) instead of
// throwing when the key is missing, so callers only handle the real-failure case.
async function ensureAudioGenerated(material, engineOverride) {
  const apiKey = await requireApiKey()
  if (!apiKey) return null
  const preferredEngine = engineOverride || (await getSetting('defaultTtsEngine', 'cloud'))
  return generateAndCacheAudio(material.id, material.paragraphs, apiKey, { ...DEFAULT_VOICES, preferredEngine })
}

// Forces exactly one engine, no Gemini fallback — used by "Generate with
// Google TTS" so a failure (e.g. quota) surfaces as a real error instead of
// silently caching Gemini audio again under a button that promised Google's.
async function ensureAudioGeneratedWithEngine(material, engine) {
  const apiKey = await requireApiKey()
  if (!apiKey) return null
  return generateAndCacheAudioWithEngine(material.id, material.paragraphs, apiKey, DEFAULT_VOICES, engine)
}

export function showAudioErrorModal(err) {
  openModal({
    title: 'Audio Generation Failed',
    bodyHTML: `<p>${escapeHtml(err.message || 'Something went wrong. Please try again.')}</p>`,
    actions: [{ label: 'Close' }],
  })
}

async function generateAudioOnDemand(root, material, onAudioChanged) {
  try {
    const blob = await ensureAudioGenerated(material)
    if (!blob) return
    downloadBlob(blob, `${slugify(material.title)}.wav`)
    destroyAudioPlayer()
    await onAudioChanged() // re-render so playback switches from browser TTS to the cached audio
  } catch (err) {
    showAudioErrorModal(err)
  }
}

async function generateSpeechInPlace(root, material, onAudioChanged) {
  const btn = root.querySelector('#ws-generate-speech')
  const engine = root.querySelector('#ws-engine-select')?.value
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
    const blob = await ensureAudioGenerated(material, engine)
    if (!blob) return resetBtn()
    destroyAudioPlayer()
    await onAudioChanged()
  } catch (err) {
    resetBtn()
    showAudioErrorModal(err)
  }
}

async function upgradeToGoogleTts(root, material, onAudioChanged) {
  const btn = root.querySelector('#ws-upgrade-google-tts')
  const resetBtn = () => {
    if (btn) {
      btn.disabled = false
      btn.textContent = '⬆ Generate with Google TTS'
    }
  }
  if (btn) {
    btn.disabled = true
    btn.innerHTML = '<span class="spinner"></span> Generating…'
  }
  try {
    const blob = await ensureAudioGeneratedWithEngine(material, 'cloud')
    if (!blob) return resetBtn()
    destroyAudioPlayer()
    await onAudioChanged()
  } catch (err) {
    resetBtn()
    showAudioErrorModal(err)
  }
}

function highlightSentence(root, index) {
  root.querySelectorAll('.sentence.current').forEach((el) => el.classList.remove('current'))
  const el = root.querySelector(`[data-sentence-index="${index}"]`)
  if (el) {
    el.classList.add('current')
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
