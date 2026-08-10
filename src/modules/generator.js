import { getSetting, addMaterial } from '../db.js'
import { generateMaterialJSON } from '../api/gemini.js'
import { generateBothEngines, DEFAULT_VOICES } from '../api/tts.js'
import { parseGeminiMaterialJSON } from '../utils/validators.js'
import { countWords, estimateDuration, formatDate } from '../utils/helpers.js'
import { TOPIC_PRESETS } from './generator-topics.js'
import { MODES } from './material-modes.js'
import { buildGenerationPrompt, openPromptModal } from './generator-prompt.js'

const CATEGORIES = ['Medicine', 'Environment', 'Technology', 'Business', 'Education', 'Science', 'General']
const LEVELS = ['A1+', 'A2', 'B1', 'B2', 'C1', 'C2']
const ENGINE_LABELS = { cloud: 'Cloud TTS', edge: 'Edge TTS', gemini: 'Gemini TTS' }

let formState = {
  topic: '',
  subtopic: '',
  topicPreset: '',
  category: 'General',
  level: 'B1',
  mode: 'selective',
  wordCount: MODES.selective.defaultWords,
  paragraphCount: MODES.selective.defaultParagraphs,
  ttsEngine: 'both', // 'both' (Cloud + Edge, independently) or 'browser' (skip pre-generation)
  speed: 'normal',
}
let customPrompt = null // set when the user edits & locks in a prompt via the modal
let isGenerating = false
let lastResult = null // { material, id }
let errorMessage = ''
let progressText = ''

export async function renderGenerator(container) {
  const apiKey = await getSetting('geminiApiKey', '')
  const modeConfig = MODES[formState.mode]

  container.innerHTML = `
    <div class="page">
      <h1 class="section-title">Generate Material</h1>

      ${!apiKey ? `<div class="banner warning">No Gemini API key set. <a href="#/settings">Add one in Settings</a> to generate material.</div>` : ''}
      ${errorMessage ? `<div class="banner error">${escapeHtml(errorMessage)}</div>` : ''}

      <div class="card">
        <div class="tabs" data-group="mode" style="margin-bottom: var(--space-4);">
          ${Object.entries(MODES)
            .map(([id, m]) => `<button data-value="${id}" class="${id === formState.mode ? 'active' : ''}">${m.label}</button>`)
            .join('')}
        </div>
        <p class="card-hint" style="margin-bottom: var(--space-6);">${capitalize(modeConfig.promptPurpose)}.</p>

        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="gen-topic-preset">Quick Topic</label>
            <select id="gen-topic-preset">
              <option value="">— Choose a topic —</option>
              ${Object.keys(TOPIC_PRESETS)
                .map((t) => `<option value="${escapeAttr(t)}" ${formState.topicPreset === t ? 'selected' : ''}>${t}</option>`)
                .join('')}
            </select>
          </div>
          <div style="flex:1;">
            <label class="field-label" for="gen-subtopic-preset">Quick Subtopic</label>
            <select id="gen-subtopic-preset" ${!formState.topicPreset ? 'disabled' : ''}>
              <option value="">${formState.topicPreset ? '— Choose a subtopic —' : 'Choose a topic first'}</option>
              ${(TOPIC_PRESETS[formState.topicPreset] || [])
                .map((s) => `<option value="${escapeAttr(s)}" ${formState.subtopic === s ? 'selected' : ''}>${s}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <p class="card-hint">Pick a preset above, or just type your own topic below — whatever's in the boxes is what gets generated.</p>
        <div class="field">
          <label class="field-label" for="gen-topic">Topic</label>
          <input type="text" id="gen-topic" placeholder="e.g. Antibiotic Resistance" value="${escapeAttr(formState.topic)}" />
        </div>
        <div class="field">
          <label class="field-label" for="gen-subtopic">Subtopic (optional)</label>
          <input type="text" id="gen-subtopic" placeholder="e.g. overuse in agriculture" value="${escapeAttr(formState.subtopic)}" />
        </div>
        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="gen-category">Category</label>
            <select id="gen-category">
              ${CATEGORIES.map((c) => `<option ${c === formState.category ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;">
            <label class="field-label" for="gen-level">Level</label>
            <select id="gen-level">
              ${LEVELS.map((l) => `<option ${l === formState.level ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="gen-words">Word Count: <span id="gen-words-value">${formState.wordCount}</span></label>
            <input type="range" id="gen-words" min="300" max="1500" step="50" value="${formState.wordCount}" />
          </div>
          <div style="flex:1;">
            <label class="field-label" for="gen-paragraphs">${modeConfig.kind === 'reading' && formState.mode === 'search-reading' ? 'Passages' : 'Paragraphs'}: <span id="gen-paragraphs-value">${formState.paragraphCount}</span></label>
            <input type="range" id="gen-paragraphs" min="2" max="6" step="1" value="${formState.paragraphCount}" />
          </div>
        </div>

        ${
          modeConfig.hasAudio
            ? `
        <div class="field">
          <label class="field-label" for="gen-tts">Audio</label>
          <select id="gen-tts">
            <option value="both" ${formState.ttsEngine === 'both' ? 'selected' : ''}>Generate audio (Google Cloud + Edge TTS)</option>
            <option value="browser" ${formState.ttsEngine === 'browser' ? 'selected' : ''}>Use browser TTS at study time</option>
          </select>
        </div>
        ${
          formState.ttsEngine !== 'browser'
            ? '<p class="card-hint">Generates both engines independently — one failing (e.g. Cloud quota) doesn\'t skip the other, and Workspace lets you switch between them. Falls back to Gemini TTS only if both fail.</p>'
            : ''
        }
        <div class="field">
          <span class="field-label">Speech Speed</span>
          <div class="segmented" data-group="speed">
            ${['slow', 'normal', 'fast']
              .map((s) => `<button data-value="${s}" class="${s === formState.speed ? 'active' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`)
              .join('')}
          </div>
        </div>`
            : ''
        }

        <div class="field row" style="margin-top:8px;">
          <button class="btn primary" id="gen-submit" ${isGenerating || !apiKey ? 'disabled' : ''} style="flex:1; justify-content:center;">
            ${isGenerating ? spinnerHTML() + (progressText || 'Generating…') : 'Generate Material'}
          </button>
          <button class="btn ghost" id="gen-show-prompt" ${isGenerating ? 'disabled' : ''} style="flex:1; justify-content:center;">
            ${customPrompt ? '✎ Edit Prompt (customized)' : 'Show Gemini Prompt'}
          </button>
        </div>
        ${customPrompt ? `<p class="card-hint" style="margin-top:6px;">Using a manually edited prompt — form fields above are ignored until you reset it.</p>` : ''}
      </div>

      ${lastResult ? renderResultCard(lastResult) : ''}
    </div>
  `

  wireEvents(container)
}

function renderResultCard({ material, id }) {
  return `
    <div class="card">
      <h2 class="card-title">✓ ${escapeHtml(material.title)}</h2>
      <p class="card-hint">
        ${material.level} · ${MODES[material.mode].label} · ${material.wordCount} words ·
        ~${Math.round(material.duration / 60)} min · ${material.paragraphs.length} paragraphs ·
        ${material.vocabulary.length} vocab · ${countAllQuestions(material.questions)} questions
        ${countEarTraining(material.questions.groupD) ? ` · ${countEarTraining(material.questions.groupD)} ear training` : ''}
        ${material.audioCached ? ' · 🔊 audio cached' : ''}
      </p>
      <p class="card-hint">Saved to your library on ${formatDate(new Date().toISOString())}.</p>
      <a class="btn primary" href="#/workspace/${id}" style="margin-top:12px; display:inline-flex;">Open in Workspace</a>
      <details style="margin-top:12px;">
        <summary style="cursor:pointer; color:var(--text-secondary);">Show transcript</summary>
        <p style="margin-top:12px; white-space:pre-wrap; line-height:1.7;">${escapeHtml(material.transcript)}</p>
      </details>
    </div>
  `
}

function countAllQuestions(q) {
  return (q.groupA?.length || 0) + (q.groupB?.length || 0) + (q.groupC?.length || 0)
}

// groupD (Ear Training) isn't part of the main question tally — it's a
// separate object keyed by subtype, each with its own item shape.
function countEarTraining(groupD) {
  return Object.values(groupD || {}).reduce((sum, arr) => sum + (arr?.length || 0), 0)
}

function spinnerHTML() {
  return '<span class="spinner"></span> '
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}

function wireEvents(root) {
  root.querySelector('#gen-topic-preset')?.addEventListener('change', (e) => {
    formState.topicPreset = e.target.value
    formState.topic = e.target.value
    formState.subtopic = ''
    renderGenerator(root)
  })
  root.querySelector('#gen-subtopic-preset')?.addEventListener('change', (e) => {
    formState.subtopic = e.target.value
    renderGenerator(root)
  })

  root.querySelector('#gen-topic')?.addEventListener('input', (e) => (formState.topic = e.target.value))
  root.querySelector('#gen-subtopic')?.addEventListener('input', (e) => (formState.subtopic = e.target.value))
  root.querySelector('#gen-category')?.addEventListener('change', (e) => (formState.category = e.target.value))
  root.querySelector('#gen-level')?.addEventListener('change', (e) => (formState.level = e.target.value))

  root.querySelectorAll('[data-group="mode"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      formState.mode = btn.dataset.value
      formState.wordCount = MODES[formState.mode].defaultWords
      formState.paragraphCount = MODES[formState.mode].defaultParagraphs
      renderGenerator(root)
    })
  })

  root.querySelectorAll('[data-group="speed"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      formState.speed = btn.dataset.value
      renderGenerator(root)
    })
  })

  const words = root.querySelector('#gen-words')
  words?.addEventListener('input', () => {
    root.querySelector('#gen-words-value').textContent = words.value
    formState.wordCount = Number(words.value)
  })
  const paragraphs = root.querySelector('#gen-paragraphs')
  paragraphs?.addEventListener('input', () => {
    root.querySelector('#gen-paragraphs-value').textContent = paragraphs.value
    formState.paragraphCount = Number(paragraphs.value)
  })

  root.querySelector('#gen-tts')?.addEventListener('change', (e) => {
    formState.ttsEngine = e.target.value
    renderGenerator(root)
  })

  root.querySelector('#gen-submit')?.addEventListener('click', () => handleGenerate(root))

  root.querySelector('#gen-show-prompt')?.addEventListener('click', () => {
    const prompt = customPrompt || buildGenerationPrompt(formState)
    openPromptModal(prompt, {
      onApply: (text) => {
        customPrompt = text
        renderGenerator(root)
      },
      onReset: () => {
        customPrompt = null
        renderGenerator(root)
      },
    })
  })
}

// ---------- generation flow ----------

async function handleGenerate(root) {
  if (!formState.topic.trim()) {
    errorMessage = 'Please enter a topic.'
    return renderGenerator(root)
  }

  const apiKey = await getSetting('geminiApiKey', '')
  if (!apiKey) {
    errorMessage = 'No Gemini API key set. Add one in Settings first.'
    return renderGenerator(root)
  }

  isGenerating = true
  errorMessage = ''
  progressText = 'Writing material…'
  await renderGenerator(root)

  try {
    const prompt = customPrompt || buildGenerationPrompt(formState)
    const raw = await generateMaterialJSON(apiKey, prompt)
    const parsed = parseGeminiMaterialJSON(raw)

    const wordCount = countWords(parsed.transcript)
    const material = {
      title: parsed.title,
      topic: formState.topic,
      subtopic: formState.subtopic,
      level: formState.level,
      mode: formState.mode,
      wordCount,
      duration: estimateDuration(wordCount),
      transcript: parsed.transcript,
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
      geminiAudioUrl: null,
    }

    const id = await addMaterial(material)
    material.audioCached = false

    if (MODES[formState.mode].hasAudio && formState.ttsEngine !== 'browser') {
      try {
        progressText = 'Generating audio…'
        await renderGenerator(root)
        const voices = { ...DEFAULT_VOICES, speed: formState.speed }
        const results = await generateBothEngines(id, parsed.paragraphs, apiKey, voices, (engine, i, n) => {
          progressText = `Generating audio via ${ENGINE_LABELS[engine]} (paragraph ${i}/${n})…`
        })
        material.audioCached = true
        if (!results.cloud || !results.edge) {
          const failed = [!results.cloud && 'Cloud', !results.edge && 'Edge'].filter(Boolean).join(' and ')
          errorMessage = `${failed} TTS failed — the other engine's audio is cached and ready instead.`
        }
      } catch (audioErr) {
        // Non-fatal: material is saved; Workspace will fall back to browser TTS.
        errorMessage = `Material saved, but audio generation failed: ${audioErr.message}. Browser TTS will be used instead.`
      }
    }

    lastResult = { material, id }
    formState.topic = ''
    formState.subtopic = ''
    formState.topicPreset = ''
    customPrompt = null
  } catch (err) {
    errorMessage = err.message || 'Generation failed. Please try again.'
  } finally {
    isGenerating = false
    progressText = ''
    await renderGenerator(root)
  }
}
