// Content Studio: the in-app version of the content/ + scripts/import-
// content.mjs offline workflow — build a prompt with the same fields
// Generator uses, copy it out, run it through whichever LLM outside this
// app, paste the JSON response back in, and import it directly. No live
// API call happens on this page (unlike Generator, which calls Gemini
// itself) — it's purely a form-prompt-builder + paste-and-validate tool,
// meant for producing a pre-made content library ahead of time rather than
// generating on demand.
import { addMaterial, updateMaterial, getAllMaterials } from '../db.js'
import { parseGeminiMaterialJSON } from '../utils/validators.js'
import { countWords, estimateDuration, slugify } from '../utils/helpers.js'
import { copyText } from '../utils/clipboard.js'
import { showToast } from '../components/toast.js'
import { TOPIC_PRESETS } from './generator-topics.js'
import { MODES } from './material-modes.js'
import { buildGenerationPrompt } from './generator-prompt.js'

const CATEGORIES = ['Medicine', 'Environment', 'Technology', 'Business', 'Education', 'Science', 'General']
const LEVELS = ['A1+', 'A2', 'B1', 'B2', 'C1', 'C2']
const LEVEL_SLUGS = { 'A1+': 'a1plus', A2: 'a2', B1: 'b1', B2: 'b2', C1: 'c1', C2: 'c2' }

let formState = {
  topic: '',
  subtopic: '',
  topicPreset: '',
  category: 'General',
  level: 'B1',
  mode: 'selective',
  wordCount: MODES.selective.defaultWords,
  paragraphCount: MODES.selective.defaultParagraphs,
  // Which LLM actually produced the pasted response — free text (not a
  // fixed list) since new models show up constantly. Kept across imports
  // in the session since a batch is usually all done with the same model.
  contentSource: '',
}
const SOURCE_SUGGESTIONS = ['Gemini', 'ChatGPT', 'Claude', 'Kimi', 'DeepSeek', 'Grok']
let pastedResponse = ''
let statusMessage = ''
let statusIsError = false
let lastImportedId = null
let isImporting = false
let sessionLog = [] // { key, title, id, action: 'added'|'updated' }, newest first

// Same shape as scripts/import-content.mjs's file-path-derived sourceFile
// ("topic-slug/subtopic-slug/level-mode") — matters if this page and the
// offline script are ever both used against the same library: they'll
// dedupe against each other's entries instead of double-importing.
function contentKey(state) {
  const topicSlug = slugify(state.topic) || 'untitled'
  const subtopicSlug = slugify(state.subtopic) || 'general'
  return `${topicSlug}/${subtopicSlug}/${LEVEL_SLUGS[state.level]}-${state.mode}`
}

export async function renderContentStudio(container) {
  const modeConfig = MODES[formState.mode]
  const prompt = buildGenerationPrompt(formState)

  container.innerHTML = `
    <div class="page">
      <h1 class="section-title">Content Studio</h1>
      <p class="card-hint" style="margin-bottom: var(--space-6);">
        Build a prompt below, generate the content with any LLM outside this app, then paste the JSON response back in to import it — no live API call happens on this page.
      </p>

      <div class="card">
        <div class="tabs" data-group="cs-mode" style="margin-bottom: var(--space-4);">
          ${Object.entries(MODES)
            .map(([id, m]) => `<button data-value="${id}" class="${id === formState.mode ? 'active' : ''}">${m.label}</button>`)
            .join('')}
        </div>
        <p class="card-hint" style="margin-bottom: var(--space-6);">${capitalize(modeConfig.promptPurpose)}.</p>

        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="cs-topic-preset">Quick Topic</label>
            <select id="cs-topic-preset">
              <option value="">— Choose a topic —</option>
              ${Object.keys(TOPIC_PRESETS)
                .map((t) => `<option value="${escapeAttr(t)}" ${formState.topicPreset === t ? 'selected' : ''}>${t}</option>`)
                .join('')}
            </select>
          </div>
          <div style="flex:1;">
            <label class="field-label" for="cs-subtopic-preset">Quick Subtopic</label>
            <select id="cs-subtopic-preset" ${!formState.topicPreset ? 'disabled' : ''}>
              <option value="">${formState.topicPreset ? '— Choose a subtopic —' : 'Choose a topic first'}</option>
              ${(TOPIC_PRESETS[formState.topicPreset] || [])
                .map((s) => `<option value="${escapeAttr(s)}" ${formState.subtopic === s ? 'selected' : ''}>${s}</option>`)
                .join('')}
            </select>
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="cs-topic">Topic</label>
          <input type="text" id="cs-topic" placeholder="e.g. Antibiotic Resistance" value="${escapeAttr(formState.topic)}" />
        </div>
        <div class="field">
          <label class="field-label" for="cs-subtopic">Subtopic (optional)</label>
          <input type="text" id="cs-subtopic" placeholder="e.g. overuse in agriculture" value="${escapeAttr(formState.subtopic)}" />
        </div>
        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="cs-category">Category</label>
            <select id="cs-category">
              ${CATEGORIES.map((c) => `<option ${c === formState.category ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div style="flex:1;">
            <label class="field-label" for="cs-level">Level</label>
            <select id="cs-level">
              ${LEVELS.map((l) => `<option ${l === formState.level ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field row">
          <div style="flex:1;">
            <label class="field-label" for="cs-words">Word Count: <span id="cs-words-value">${formState.wordCount}</span></label>
            <input type="range" id="cs-words" min="300" max="1500" step="50" value="${formState.wordCount}" />
          </div>
          <div style="flex:1;">
            <label class="field-label" for="cs-paragraphs">${modeConfig.kind === 'reading' && formState.mode === 'search-reading' ? 'Passages' : 'Paragraphs'}: <span id="cs-paragraphs-value">${formState.paragraphCount}</span></label>
            <input type="range" id="cs-paragraphs" min="2" max="6" step="1" value="${formState.paragraphCount}" />
          </div>
        </div>

        <div class="field">
          <div class="row" style="margin-bottom:6px;">
            <label class="field-label" style="margin-bottom:0;" for="cs-prompt">Prompt</label>
            <button class="btn ghost" id="cs-copy-prompt">📋 Copy Prompt</button>
          </div>
          <textarea id="cs-prompt" readonly rows="12" style="width:100%; font-family: ui-monospace, monospace; font-size:12.5px; line-height:1.5; resize:vertical;">${escapeHtml(prompt)}</textarea>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">Paste LLM Response</h2>
        <p class="card-hint" style="margin-bottom:10px;">Paste the raw JSON the LLM returned — markdown code fences are fine, they're stripped automatically.</p>
        <textarea id="cs-response" rows="12" placeholder='{ "title": "...", "transcript": "...", ... }' style="width:100%; font-family: ui-monospace, monospace; font-size:12.5px; line-height:1.5; resize:vertical;">${escapeHtml(pastedResponse)}</textarea>
        <div class="field" style="margin-top:10px; margin-bottom:0;">
          <label class="field-label" for="cs-source">Source (which LLM produced this)</label>
          <input type="text" id="cs-source" list="cs-source-options" placeholder="e.g. Kimi K2, ChatGPT-5, Claude Opus, Gemini..." value="${escapeAttr(formState.contentSource)}" />
          <datalist id="cs-source-options">
            ${SOURCE_SUGGESTIONS.map((s) => `<option value="${escapeAttr(s)}">`).join('')}
          </datalist>
        </div>
        ${
          statusMessage
            ? `<div class="banner ${statusIsError ? 'error' : 'success'}" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-top:10px;">
                <span>${escapeHtml(statusMessage)}${!statusIsError ? ' You can also find it later in Library.' : ''}</span>
                ${!statusIsError && lastImportedId ? `<a class="btn primary" href="#/workspace/${lastImportedId}">▶ Open in Workspace</a>` : ''}
              </div>`
            : ''
        }
        <button class="btn primary" id="cs-import" style="margin-top:10px;" ${isImporting ? 'disabled' : ''}>
          ${isImporting ? spinnerHTML() + 'Importing…' : '⬆ Validate & Import'}
        </button>
      </div>

      ${
        sessionLog.length
          ? `<div class="card">
              <h2 class="card-title">Imported this session</h2>
              <ul style="display:flex; flex-direction:column; gap:6px; list-style:none;">
                ${sessionLog
                  .map(
                    (e) =>
                      `<li>${e.action === 'added' ? '✓ Added' : '↻ Updated'} <a href="#/workspace/${e.id}">${escapeHtml(e.title)}</a> <span class="text-muted">(${escapeHtml(e.key)})</span></li>`
                  )
                  .join('')}
              </ul>
            </div>`
          : ''
      }
    </div>
  `

  wireEvents(container)
}

function wireEvents(root) {
  root.querySelector('#cs-topic-preset')?.addEventListener('change', (e) => {
    formState.topicPreset = e.target.value
    formState.topic = e.target.value
    formState.subtopic = ''
    renderContentStudio(root)
  })
  root.querySelector('#cs-subtopic-preset')?.addEventListener('change', (e) => {
    formState.subtopic = e.target.value
    renderContentStudio(root)
  })

  // Text inputs sync the prompt preview directly rather than triggering a
  // full re-render — a re-render on every keystroke would blur the field
  // and reset the cursor position mid-typing.
  root.querySelector('#cs-topic')?.addEventListener('input', (e) => {
    formState.topic = e.target.value
    syncPrompt(root)
  })
  root.querySelector('#cs-subtopic')?.addEventListener('input', (e) => {
    formState.subtopic = e.target.value
    syncPrompt(root)
  })
  root.querySelector('#cs-category')?.addEventListener('change', (e) => {
    formState.category = e.target.value
    renderContentStudio(root)
  })
  root.querySelector('#cs-level')?.addEventListener('change', (e) => {
    formState.level = e.target.value
    renderContentStudio(root)
  })

  root.querySelectorAll('[data-group="cs-mode"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      formState.mode = btn.dataset.value
      formState.wordCount = MODES[formState.mode].defaultWords
      formState.paragraphCount = MODES[formState.mode].defaultParagraphs
      renderContentStudio(root)
    })
  })

  const words = root.querySelector('#cs-words')
  words?.addEventListener('input', () => {
    root.querySelector('#cs-words-value').textContent = words.value
    formState.wordCount = Number(words.value)
    syncPrompt(root)
  })
  const paragraphs = root.querySelector('#cs-paragraphs')
  paragraphs?.addEventListener('input', () => {
    root.querySelector('#cs-paragraphs-value').textContent = paragraphs.value
    formState.paragraphCount = Number(paragraphs.value)
    syncPrompt(root)
  })

  root.querySelector('#cs-copy-prompt')?.addEventListener('click', async () => {
    const textarea = root.querySelector('#cs-prompt')
    const ok = await copyText(textarea?.value || '', textarea)
    showToast(ok ? 'Prompt copied to clipboard' : 'Copy failed — select the text and copy manually')
  })

  root.querySelector('#cs-response')?.addEventListener('input', (e) => (pastedResponse = e.target.value))
  root.querySelector('#cs-source')?.addEventListener('input', (e) => (formState.contentSource = e.target.value))

  root.querySelector('#cs-import')?.addEventListener('click', () => handleImport(root))
}

function syncPrompt(root) {
  const el = root.querySelector('#cs-prompt')
  if (el) el.value = buildGenerationPrompt(formState)
}

async function handleImport(root) {
  if (!formState.topic.trim()) {
    statusMessage = 'Please enter a topic first.'
    statusIsError = true
    return renderContentStudio(root)
  }
  if (!pastedResponse.trim()) {
    statusMessage = "Paste the LLM's JSON response first."
    statusIsError = true
    return renderContentStudio(root)
  }

  isImporting = true
  await renderContentStudio(root)

  try {
    const validated = parseGeminiMaterialJSON(pastedResponse)
    const wordCount = countWords(validated.transcript)
    const key = contentKey(formState)
    const material = {
      title: validated.title,
      topic: formState.topic,
      subtopic: formState.subtopic,
      level: formState.level,
      mode: formState.mode,
      wordCount,
      duration: estimateDuration(wordCount),
      transcript: validated.transcript,
      paragraphs: validated.paragraphs,
      questions: validated.questions,
      vocabulary: validated.vocabulary,
      expressions: validated.expressions,
      grammar: validated.grammar,
      shadowing: validated.shadowing,
      notes: '',
      bookmarks: [],
      userAnswers: { groupA: {}, groupB: {}, groupC: {} },
      earTrainingAnswers: {},
      sourceFile: key,
      contentSource: formState.contentSource.trim(),
    }

    const all = await getAllMaterials()
    const existing = all.find((m) => m.sourceFile === key)
    let id, action
    if (existing) {
      await updateMaterial(existing.id, material)
      id = existing.id
      action = 'updated'
    } else {
      id = await addMaterial(material)
      action = 'added'
    }

    sessionLog = [{ key, title: material.title, id, action }, ...sessionLog]
    pastedResponse = ''
    statusMessage = `${action === 'added' ? 'Added' : 'Updated'} "${material.title}" (#${id}).`
    statusIsError = false
    lastImportedId = id
  } catch (err) {
    lastImportedId = null
    statusMessage = err.message || 'Import failed.'
    statusIsError = true
  } finally {
    isImporting = false
    await renderContentStudio(root)
  }
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
