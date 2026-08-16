// YouTube Content: same shape as bbc-content.js — paste a link, preview the
// real transcript, then build the same vocab/questions/grammar/shadowing
// material Generator produces, with the real video audio attached instead
// of TTS. See server/youtube.js for how the transcript/audio are resolved
// (yt-dlp, since a bare fetch() can no longer reliably read YouTube's own
// caption/format URLs).
import { getSetting, addMaterial, importYoutubeVideo, saveYoutubeAudio } from '../db.js'
import { generateMaterialJSON } from '../api/gemini.js'
import { parseGeminiMaterialJSON } from '../utils/validators.js'
import { countWords, estimateDuration, formatDate, splitSentences } from '../utils/helpers.js'
import { buildTranscriptAnalysisPrompt } from './transcript-analysis-prompt.js'
import { MODES } from './material-modes.js'

const LEVELS = ['A1+', 'A2', 'B1', 'B2', 'C1', 'C2']
const YOUTUBE_MODE = 'careful' // real spoken content, denser than a scripted "selective" passage — closest existing mode

let formState = { url: '', level: 'B1' }
let video = null // { videoId, title, channel, thumbnail, sourceUrl, transcript }
let isFetching = false
let isGenerating = false
let fetchError = ''
let generateError = ''
let progressText = ''
let lastResult = null // { material, id }

export async function renderYoutubeContent(container) {
  const apiKey = await getSetting('geminiApiKey', '')

  container.innerHTML = `
    <div class="page">
      <h1 class="section-title">YouTube Content</h1>
      <p class="card-hint" style="margin-bottom: var(--space-6);">
        Paste a YouTube video link — its real captions and audio are pulled in directly, then built out into the same vocabulary/questions/grammar/shadowing material as everything else in the library.
      </p>

      ${!apiKey ? `<div class="banner warning">No Gemini API key set. <a href="#/settings">Add one in Settings</a> to build study material from the transcript.</div>` : ''}
      ${fetchError ? `<div class="banner error">${escapeHtml(fetchError)}</div>` : ''}

      <div class="card">
        <div class="field">
          <label class="field-label" for="yt-url">YouTube URL</label>
          <input type="text" id="yt-url" placeholder="https://www.youtube.com/watch?v=..." value="${escapeAttr(formState.url)}" />
        </div>
        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="yt-level">Target Level</label>
            <select id="yt-level">
              ${LEVELS.map((l) => `<option ${l === formState.level ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="btn primary" id="yt-fetch" ${isFetching ? 'disabled' : ''}>
          ${isFetching ? spinnerHTML() + 'Fetching…' : 'Fetch Video'}
        </button>
      </div>

      ${video ? renderVideoPreview(apiKey) : ''}
      ${lastResult ? renderResultCard(lastResult) : ''}
    </div>
  `

  wireEvents(container)
}

function renderVideoPreview(apiKey) {
  const wordCount = countWords(video.transcript)
  return `
    <div class="card">
      <div class="row" style="align-items:flex-start; gap:12px;">
        ${video.thumbnail ? `<img src="${escapeAttr(video.thumbnail)}" alt="" style="width:120px; border-radius:8px; flex-shrink:0;" />` : ''}
        <div>
          <h2 class="card-title">${escapeHtml(video.title)}</h2>
          <p class="card-hint">${escapeHtml(video.channel || '')}</p>
          <p class="card-hint">${wordCount} words transcribed from captions</p>
        </div>
      </div>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--text-secondary);">Show transcript</summary>
        <p style="margin-top:12px; white-space:pre-wrap; line-height:1.7;">${escapeHtml(video.transcript)}</p>
      </details>

      ${generateError ? `<div class="banner error" style="margin-top:12px;">${escapeHtml(generateError)}</div>` : ''}
      <button class="btn primary" id="yt-generate" style="margin-top:12px;" ${isGenerating || !apiKey ? 'disabled' : ''}>
        ${isGenerating ? spinnerHTML() + (progressText || 'Generating…') : 'Build Study Material'}
      </button>
    </div>
  `
}

function renderResultCard({ material, id }) {
  return `
    <div class="card">
      <h2 class="card-title">✓ ${escapeHtml(material.title)}</h2>
      <p class="card-hint">
        ${material.level} · ${MODES[material.mode].label} · ${material.wordCount} words ·
        ~${Math.round(material.duration / 60)} min · ${material.paragraphs.length} paragraphs ·
        ${material.vocabulary.length} vocab · ${countAllQuestions(material.questions)} questions
        ${material.audioCached ? ' · 🔊 YouTube audio attached' : ''}
      </p>
      <p class="card-hint">Saved to your library on ${formatDate(new Date().toISOString())}.</p>
      <a class="btn primary" href="#/workspace/${id}" style="margin-top:12px; display:inline-flex;">Open in Workspace</a>
    </div>
  `
}

function countAllQuestions(q) {
  return (q.groupA?.length || 0) + (q.groupB?.length || 0) + (q.groupC?.length || 0)
}

function wireEvents(root) {
  root.querySelector('#yt-url')?.addEventListener('input', (e) => (formState.url = e.target.value))
  root.querySelector('#yt-level')?.addEventListener('change', (e) => (formState.level = e.target.value))
  root.querySelector('#yt-fetch')?.addEventListener('click', () => handleFetch(root))
  root.querySelector('#yt-generate')?.addEventListener('click', () => handleGenerate(root))
}

async function handleFetch(root) {
  if (!formState.url.trim()) {
    fetchError = 'Please paste a YouTube video URL first.'
    return renderYoutubeContent(root)
  }

  isFetching = true
  fetchError = ''
  video = null
  lastResult = null
  await renderYoutubeContent(root)

  try {
    video = await importYoutubeVideo(formState.url.trim())
  } catch (err) {
    fetchError = err.message || 'Could not fetch that video.'
  } finally {
    isFetching = false
    await renderYoutubeContent(root)
  }
}

async function handleGenerate(root) {
  const apiKey = await getSetting('geminiApiKey', '')
  if (!apiKey) {
    generateError = 'No Gemini API key set. Add one in Settings first.'
    return renderYoutubeContent(root)
  }

  isGenerating = true
  generateError = ''
  progressText = 'Analyzing transcript…'
  await renderYoutubeContent(root)

  try {
    const prompt = buildTranscriptAnalysisPrompt({
      title: video.title,
      transcript: video.transcript,
      sourceUrl: video.sourceUrl,
      level: formState.level,
      sourceLabel: 'YouTube video',
      artifactNote: 'obvious auto-caption artifacts (missing punctuation, an obviously wrong word if the context makes the correct one unambiguous)',
    })
    const raw = await generateMaterialJSON(apiKey, prompt)
    const parsed = parseGeminiMaterialJSON(raw)
    // Belt-and-suspenders against the prompt instruction being ignored: real
    // sentences must always come from splitting the real "text" verbatim,
    // never from whatever the AI put in that field (see bbc-content.js for
    // the transcript-paraphrase bug this guards against).
    parsed.paragraphs = parsed.paragraphs.map((p) => ({ text: p.text, sentences: splitSentences(p.text) }))

    const wordCount = countWords(parsed.transcript)
    const material = {
      title: parsed.title,
      topic: 'YouTube',
      subtopic: video.title,
      level: formState.level,
      mode: YOUTUBE_MODE,
      wordCount,
      duration: estimateDuration(wordCount),
      transcript: parsed.transcript,
      summary: parsed.summary,
      paragraphs: parsed.paragraphs,
      questions: parsed.questions,
      vocabulary: parsed.vocabulary,
      expressions: parsed.expressions,
      grammar: parsed.grammar,
      shadowing: parsed.shadowing,
      notes: '',
      bookmarks: [],
      userAnswers: { groupA: {}, groupB: {}, groupC: {} },
      earTrainingAnswers: {},
      sourceUrl: video.sourceUrl,
      contentSource: 'Gemini (YouTube transcript)',
    }

    const id = await addMaterial(material)
    material.audioCached = false

    try {
      progressText = 'Downloading video audio…'
      await renderYoutubeContent(root)
      await saveYoutubeAudio(id, video.sourceUrl)
      material.audioCached = true
    } catch (audioErr) {
      // Non-fatal: material is saved; Workspace will fall back to browser TTS.
      generateError = `Material saved, but the video audio download failed: ${audioErr.message}. Browser TTS will be used instead.`
    }

    lastResult = { material, id }
    formState.url = ''
    video = null
  } catch (err) {
    generateError = err.message || 'Generation failed. Please try again.'
  } finally {
    isGenerating = false
    progressText = ''
    await renderYoutubeContent(root)
  }
}

function spinnerHTML() {
  return '<span class="spinner"></span> '
}
function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
