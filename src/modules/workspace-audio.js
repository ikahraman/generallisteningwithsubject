// Audio playback + on-demand TTS generation for Workspace, split out of
// workspace.js to stay under the 400-line-per-file rule. `material` is
// passed in by reference (not duplicated module state) so mutations here
// (bookmarks) are visible to workspace.js without a shared-state module.
import { getAudioBlob, getAudioTracks } from '../db.js'
import { getSetting } from '../db.js'
import { MaterialPlayer } from '../api/material-player.js'
import { generateBothEngines, generateAndCacheAudioWithEngine, DEFAULT_VOICES } from '../api/tts.js'
import { synthesizeSpeech as synthesizeEdgeSpeech, EDGE_TTS_VOICES } from '../api/edge-tts.js'
import { synthesizeSpeech as synthesizeCloudSpeech, CLOUD_TTS_VOICES } from '../api/cloud-tts.js'
import { pcmToWavBlob } from '../api/gemini.js'
import { audioPlayerHTML, wireAudioPlayer } from '../components/audio-player.js'
import { openModal } from '../components/modal.js'
import { showToast } from '../components/toast.js'
import { downloadBlob, slugify, pickBestVoice } from '../utils/helpers.js'

export const ENGINE_LABELS = { cloud: 'Google Cloud TTS', edge: 'Edge TTS', gemini: 'Gemini TTS' }

// Which cached track plays by default: Cloud > Edge > Gemini (last-resort
// safety net) > the unlabeled legacy slot from before materials could have
// more than one track.
const TRACK_PRIORITY = ['cloud', 'edge', 'gemini', null]

let player = null
// Remembers a manual track switch for the current workspace visit (reset
// per material) — loadAudioTracks honors it instead of always resetting to
// TRACK_PRIORITY's default, so switching tracks doesn't get undone by the
// full re-render that switching (and generating) already triggers.
let trackOverride = null

// Metadata only (kind/engine per track, no binary) — fast, and deliberately
// does NOT download any track's actual audio. A cached track can be many
// MB; awaiting it here would block the whole Workspace page (transcript,
// tabs, everything) behind a slow download before any of it could render.
// The real blob is fetched separately, in the background, by
// setupAudioPlayer — see that function for why.
export async function loadAudioTracks(materialId) {
  const tracks = await getAudioTracks(materialId)
  if (!tracks.length) return { tracks: [], defaultKind: undefined }
  const override = trackOverride?.materialId === materialId ? trackOverride.kind : undefined
  const defaultKind =
    override !== undefined && tracks.some((t) => (t.kind || null) === override)
      ? override
      : TRACK_PRIORITY.find((kind) => tracks.some((t) => (t.kind || null) === kind))
  return { tracks, defaultKind }
}

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
// still plays below so the material is usable immediately either way.
// `audioTracks` is loadAudioTracks()'s result — metadata only, so this
// renders a "loading" badge even when a track exists; setupAudioPlayer
// swaps it for the real label once the audio itself has actually
// downloaded. When more than one track is cached (Cloud + Edge), a
// switcher lets the user pick which one plays without regenerating.
export function renderAudioSection(audioTracks, defaultSpeed = 1) {
  const { tracks = [], defaultKind } = audioTracks || {}
  if (defaultKind !== undefined) {
    const current = tracks.find((t) => (t.kind || null) === (defaultKind || null))
    const label = ENGINE_LABELS[current?.engine] || current?.engine || 'unknown source'
    const others = tracks.filter((t) => (t.kind || null) !== (defaultKind || null))
    return `
      <div class="audio-source-row">
        <span class="badge" id="ws-audio-badge">⏳ Loading ${label}…</span>
        ${
          others.length
            ? `<select id="ws-track-select" title="Switch audio track">
                <option value="${defaultKind ?? ''}">${label}</option>
                ${others.map((t) => `<option value="${t.kind ?? ''}">${ENGINE_LABELS[t.engine] || t.engine}</option>`).join('')}
              </select>`
            : ''
        }
      </div>
      ${audioPlayerHTML(defaultSpeed)}
    `
  }
  return `
    <div class="banner warning" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
      <span>No real audio generated for this material yet. You can listen with your browser's voice below, or generate real audio now.</span>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <select id="ws-engine-select" title="Which engine(s) to generate with">
          <option value="both">Cloud + Edge (both)</option>
          <option value="edge">Edge TTS only — fast, no Google quota</option>
          <option value="cloud">Google Cloud TTS only</option>
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
 * @param {{tracks: Array, defaultKind: string|null|undefined}} audioTracks from loadAudioTracks() — metadata only, passed in rather than re-fetched since the caller already loaded it to render renderAudioSection().
 * @param {() => Promise<void>} onAudioChanged called after audio is generated/switched so the caller can re-render
 */
export async function setupAudioPlayer(root, material, sentences, audioTracks, onAudioChanged) {
  root.querySelector('#ws-generate-speech')?.addEventListener('click', () => generateSpeechInPlace(root, material, onAudioChanged))
  root.querySelector('#ws-track-select')?.addEventListener('change', (e) => {
    trackOverride = { materialId: material.id, kind: e.target.value || null }
    destroyAudioPlayer()
    onAudioChanged()
  })

  const defaultVoice = await getSetting('defaultVoice', '')
  const defaultSpeed = await getSetting('defaultSpeed', 1)

  // Attach in browser-voice mode immediately (no blob) so Transcript/tabs
  // are usable right away — a cached track can be several MB and take a
  // long time on a slow connection, and must never block the rest of the
  // page on that download (see loadAudioTracks).
  player = new MaterialPlayer({ sentences, audioBlob: undefined, voiceURI: defaultVoice, rate: defaultSpeed })
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

  if (audioTracks?.defaultKind !== undefined) {
    loadTrackInBackground(root, material, audioTracks.defaultKind)
  }
}

// Downloads the actual cached track's audio after the page is already
// interactive, and upgrades the live player in place once it arrives —
// same player instance, so the click listeners wired above (which capture
// `player` by reference to the module-level `let`) keep working, and so do
// wireAudioPlayer's own closures (which capture the object, not a mode
// snapshot). Only the download button's mode-dependent behavior is set up
// once at wire time, so that one needs a manual refresh here.
async function loadTrackInBackground(root, material, kind) {
  const row = await getAudioBlob(material.id, kind || undefined)
  if (!row?.blob || !player) return
  player.upgradeToBlob(row.blob)

  const badge = root.querySelector('#ws-audio-badge')
  if (badge) badge.textContent = `🔊 ${ENGINE_LABELS[row.engine] || row.engine}`

  const downloadBtn = root.querySelector('#ap-download')
  if (downloadBtn) {
    downloadBtn.disabled = false
    downloadBtn.title = ''
    downloadBtn.textContent = '⬇'
    downloadBtn.onclick = () => downloadBlob(row.blob, `${slugify(material.title)}.wav`)
  }
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

// engineChoice: 'both' (default) generates Cloud and Edge independently —
// Gemini as a last-resort safety net if both fail (see generateBothEngines)
// — or 'edge'/'cloud' generates ONLY that one engine, no fallback and no
// waiting on the other engine first. The "both" default tries Cloud first;
// if it's having a bad day (quota, slow responses near the 30s timeout —
// across several paragraphs that adds up to minutes before it even gets to
// Edge), picking "Edge only" skips straight past that wait entirely.
// Downloads whichever track ends up current so callers get a blob back
// immediately (e.g. to download). Fetching the blob here is fine — the
// user just explicitly asked to generate, so a short wait is expected,
// unlike the page-load path in setupAudioPlayer which must never block on
// it. Returns null (after showing the "no key" modal) instead of throwing
// when the key is missing, so callers only handle the real-failure case.
async function ensureAudioGenerated(material, engineChoice, onProgress) {
  const apiKey = await requireApiKey()
  if (!apiKey) return null

  if (engineChoice === 'edge' || engineChoice === 'cloud') {
    const blob = await generateAndCacheAudioWithEngine(
      material.id,
      material.paragraphs,
      apiKey,
      DEFAULT_VOICES,
      engineChoice,
      onProgress,
      engineChoice
    )
    trackOverride = { materialId: material.id, kind: engineChoice }
    return blob
  }

  await generateBothEngines(material.id, material.paragraphs, apiKey, DEFAULT_VOICES, onProgress)
  trackOverride = null
  const { defaultKind } = await loadAudioTracks(material.id)
  if (defaultKind === undefined) return null
  const row = await getAudioBlob(material.id, defaultKind || undefined)
  return row?.blob || null
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
    const blob = await ensureAudioGenerated(material, 'both')
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
  const engineChoice = root.querySelector('#ws-engine-select')?.value || 'both'
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
    const blob = await ensureAudioGenerated(material, engineChoice, (engine, i, n) => {
      if (btn) btn.innerHTML = `<span class="spinner"></span> ${ENGINE_LABELS[engine] || engine} (${i}/${n})…`
    })
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
