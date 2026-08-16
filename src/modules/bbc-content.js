// BBC Content: same material structure/UI as Generator (vocab, questions,
// grammar, shadowing, summary), but the source is a real BBC Learning
// English episode instead of an AI-invented topic. Two server round trips
// (see server/bbc.js): first fetch+parse the page/transcript so the user can
// preview it before spending an AI call, then — only after a material
// exists to attach it to — download the real BBC mp3 as an extra audio
// track (kind 'bbc'), which workspace-audio.js's TRACK_PRIORITY prefers
// over any TTS engine since it's a real recording, not synthesized speech.
import { getSetting, addMaterial, importBbcEpisode, saveBbcAudio } from '../db.js'
import { generateMaterialJSON } from '../api/gemini.js'
import { parseGeminiMaterialJSON } from '../utils/validators.js'
import { countWords, estimateDuration, formatDate, splitSentences } from '../utils/helpers.js'
import { buildBbcAnalysisPrompt } from './bbc-prompt.js'
import { MODES } from './material-modes.js'

const LEVELS = ['A1+', 'A2', 'B1', 'B2', 'C1', 'C2']
const BBC_MODE = 'careful' // real spoken dialogue, denser than a scripted "selective" passage — closest existing mode

let formState = { url: '', level: 'B1' }
let episode = null // { title, description, pdfUrl, mp3Url, sourceUrl, transcript }
let isFetching = false
let isGenerating = false
let fetchError = ''
let generateError = ''
let progressText = ''
let lastResult = null // { material, id }

export async function renderBbcContent(container) {
  const apiKey = await getSetting('geminiApiKey', '')

  container.innerHTML = `
    <div class="page">
      <h1 class="section-title">BBC Content</h1>
      <p class="card-hint" style="margin-bottom: var(--space-6);">
        Paste a link to a BBC Learning English episode — its real transcript and audio are pulled in directly, then built out into the same vocabulary/questions/grammar/shadowing material as everything else in the library.
      </p>

      ${!apiKey ? `<div class="banner warning">No Gemini API key set. <a href="#/settings">Add one in Settings</a> to build study material from the transcript.</div>` : ''}
      ${fetchError ? `<div class="banner error">${escapeHtml(fetchError)}</div>` : ''}

      <div class="card">
        <div class="field">
          <label class="field-label" for="bbc-url">BBC Learning English URL</label>
          <input type="text" id="bbc-url" placeholder="https://www.bbc.co.uk/learningenglish/features/..." value="${escapeAttr(formState.url)}" />
        </div>
        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="bbc-level">Target Level</label>
            <select id="bbc-level">
              ${LEVELS.map((l) => `<option ${l === formState.level ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="btn primary" id="bbc-fetch" ${isFetching ? 'disabled' : ''}>
          ${isFetching ? spinnerHTML() + 'Fetching…' : 'Fetch Episode'}
        </button>
      </div>

      ${episode ? renderEpisodePreview(apiKey) : ''}
      ${lastResult ? renderResultCard(lastResult) : ''}
    </div>
  `

  wireEvents(container)
}

function renderEpisodePreview(apiKey) {
  const wordCount = countWords(episode.transcript)
  return `
    <div class="card">
      <h2 class="card-title">${escapeHtml(episode.title)}</h2>
      <p class="card-hint">${escapeHtml(episode.description || '')}</p>
      <p class="card-hint">${wordCount} words transcribed ${episode.mp3Url ? '· 🔊 audio available' : '· no audio file found on this page'}</p>
      <details style="margin-top:10px;">
        <summary style="cursor:pointer; color:var(--text-secondary);">Show transcript</summary>
        <p style="margin-top:12px; white-space:pre-wrap; line-height:1.7;">${escapeHtml(episode.transcript)}</p>
      </details>

      ${generateError ? `<div class="banner error" style="margin-top:12px;">${escapeHtml(generateError)}</div>` : ''}
      <button class="btn primary" id="bbc-generate" style="margin-top:12px;" ${isGenerating || !apiKey ? 'disabled' : ''}>
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
        ${material.audioCached ? ' · 🔊 BBC audio attached' : ''}
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
  root.querySelector('#bbc-url')?.addEventListener('input', (e) => (formState.url = e.target.value))
  root.querySelector('#bbc-level')?.addEventListener('change', (e) => (formState.level = e.target.value))
  root.querySelector('#bbc-fetch')?.addEventListener('click', () => handleFetch(root))
  root.querySelector('#bbc-generate')?.addEventListener('click', () => handleGenerate(root))
}

async function handleFetch(root) {
  if (!formState.url.trim()) {
    fetchError = 'Please paste a BBC Learning English URL first.'
    return renderBbcContent(root)
  }

  isFetching = true
  fetchError = ''
  episode = null
  lastResult = null
  await renderBbcContent(root)

  try {
    episode = await importBbcEpisode(formState.url.trim())
  } catch (err) {
    fetchError = err.message || 'Could not fetch that episode.'
  } finally {
    isFetching = false
    await renderBbcContent(root)
  }
}

async function handleGenerate(root) {
  const apiKey = await getSetting('geminiApiKey', '')
  if (!apiKey) {
    generateError = 'No Gemini API key set. Add one in Settings first.'
    return renderBbcContent(root)
  }

  isGenerating = true
  generateError = ''
  progressText = 'Analyzing transcript…'
  await renderBbcContent(root)

  try {
    const prompt = buildBbcAnalysisPrompt({
      title: episode.title,
      transcript: episode.transcript,
      sourceUrl: episode.sourceUrl,
      level: formState.level,
    })
    const raw = await generateMaterialJSON(apiKey, prompt)
    const parsed = parseGeminiMaterialJSON(raw)
    // Belt-and-suspenders against the prompt instruction being ignored: for
    // real BBC dialogue, "sentences" must always come from splitting the
    // real "text" verbatim, never from whatever the AI put in that field
    // (it has a habit of writing a paraphrased summary there instead).
    parsed.paragraphs = parsed.paragraphs.map((p) => ({ text: p.text, sentences: splitSentences(p.text) }))

    const wordCount = countWords(parsed.transcript)
    const material = {
      title: parsed.title,
      topic: 'BBC Learning English',
      subtopic: episode.title,
      level: formState.level,
      mode: BBC_MODE,
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
      sourceUrl: episode.sourceUrl,
      contentSource: 'Gemini (BBC transcript)',
    }

    const id = await addMaterial(material)
    material.audioCached = false

    if (episode.mp3Url) {
      try {
        progressText = 'Downloading BBC audio…'
        await renderBbcContent(root)
        await saveBbcAudio(id, episode.mp3Url)
        material.audioCached = true
      } catch (audioErr) {
        // Non-fatal: material is saved; Workspace will fall back to browser TTS.
        generateError = `Material saved, but the BBC audio download failed: ${audioErr.message}. Browser TTS will be used instead.`
      }
    }

    lastResult = { material, id }
    formState.url = ''
    episode = null
  } catch (err) {
    generateError = err.message || 'Generation failed. Please try again.'
  } finally {
    isGenerating = false
    progressText = ''
    await renderBbcContent(root)
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
