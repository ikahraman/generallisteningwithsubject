import { getMaterial, updateMaterial, toggleFavorite, recordMaterialStudied, addStudyLogEntry } from '../db.js'
import { getSetting } from '../db.js'
import { flattenSentences } from '../api/material-player.js'
import { questionBlockHTML, wireQuestionBlock } from '../components/question-block.js'
import { MODE_LABELS, GROUP_LABELS, hasAudioMode } from './material-modes.js'
import { renderAudioSection, setupAudioPlayer, destroyAudioPlayer, loadAudioTracks } from './workspace-audio.js'
import { renderSummaryPanel, wireSummaryPanel } from './workspace-summary.js'
import { renderVocabCard, wireVocabCard, vocabMatchTitle } from './workspace-vocab.js'
import { renderVocabLessonPanel, wireVocabLessonPanel } from './workspace-vocab-lesson.js'
import { renderEarTrainingPanel, wireEarTrainingPanel } from './workspace-ear-training.js'
import { renderShadowingPanel, wireShadowingPanel } from './workspace-shadowing.js'
import { promptExportPdf } from './workspace-export.js'

let material = null
let sentences = [] // flattened, with paragraphIndex
let activeTab = 'transcript'
let showFeedback = false

export async function renderWorkspace(container, materialId) {
  material = await getMaterial(materialId)
  if (!material) {
    container.innerHTML = `<div class="page"><p>Material not found.</p></div>`
    return
  }
  sentences = flattenSentences(material.paragraphs)
  activeTab = 'transcript'
  showFeedback = false

  material.lastOpenedAt = new Date().toISOString()
  updateMaterial(material.id, { lastOpenedAt: material.lastOpenedAt })

  const audioTracks = hasAudioMode(material.mode) ? await loadAudioTracks(material.id) : null
  const defaultSpeed = await getSetting('defaultSpeed', 1)

  container.innerHTML = `
    <div class="workspace">
      <header class="workspace-header">
        <button class="btn ghost" id="ws-back">&larr; Back</button>
        <h1>${escapeHtml(material.title)}</h1>
        <span class="badge level">${material.level}</span>
        <span class="badge">${MODE_LABELS[material.mode] || material.mode}</span>
        ${material.contentSource ? `<span class="badge" title="Which LLM produced this material">🤖 ${escapeHtml(material.contentSource)}</span>` : ''}
        ${material.createdAt ? `<span class="badge text-muted" title="Created">${formatDateTime(material.createdAt)}</span>` : ''}
        <button class="btn ghost" id="ws-pdf">Worksheet PDF</button>
        <button class="icon-btn" id="ws-favorite" aria-label="Toggle favorite">${material.isFavorite ? '★' : '☆'}</button>
      </header>
      <main class="ws-main">
        ${hasAudioMode(material.mode) ? `<div class="ws-main-audio">${renderAudioSection(audioTracks, defaultSpeed)}</div>` : ''}
        <div class="tabs" id="ws-tabs">
          ${tabIds()
            .map((t) => `<button data-tab="${t}" class="${t === activeTab ? 'active' : ''}">${tabLabel(t)}</button>`)
            .join('')}
        </div>
        <div class="ws-main-tabpanel" id="ws-tab-panel">${renderTabPanel()}</div>
        <div class="ws-score-bar">
          <span id="ws-score">${scoreLabel()}</span>
          <button class="btn primary" id="ws-check-all">Check All</button>
        </div>
      </main>
    </div>
  `

  wireHeader(container)
  wireMainPanel(container)
  if (hasAudioMode(material.mode)) {
    await setupAudioPlayer(container, material, sentences, audioTracks, () => renderWorkspace(container, material.id))
  }
}

// ---------- header ----------

function wireHeader(root) {
  root.querySelector('#ws-back').addEventListener('click', () => {
    destroyAudioPlayer()
    location.hash = '#/library'
  })
  const favoriteBtn = root.querySelector('#ws-favorite')
  favoriteBtn.addEventListener('click', async () => {
    material.isFavorite = !material.isFavorite
    favoriteBtn.textContent = material.isFavorite ? '★' : '☆'
    await toggleFavorite(material.id, material.isFavorite)
  })

  root.querySelector('#ws-pdf').addEventListener('click', () => promptExportPdf(material))
}

// ---------- Transcript tab ----------

function renderTranscript() {
  let globalIndex = 0
  return material.paragraphs
    .map((p) => {
      const sentenceList = p.sentences?.length ? p.sentences : [p.text]
      const html = sentenceList
        .map((s) => {
          const idx = globalIndex++
          const bookmarked = (material.bookmarks || []).some((b) => b.sentenceIndex === idx)
          const title = vocabMatchTitle(material.vocabulary, s)
          return `<span class="sentence" data-sentence-index="${idx}" ${title ? `title="${escapeAttr(title)}"` : ''}>${escapeHtml(s)}</span><span class="bookmark-icon ${bookmarked ? 'active' : ''}" data-bookmark-index="${idx}">🔖</span> `
        })
        .join('')
      return `<p class="paragraph">${html}</p>`
    })
    .join('')
}

// Bookmarking works for every mode (reading included). Wired whenever the
// Transcript tab is (re-)rendered, alongside the other tabs' own wiring.
function wireTranscriptTab(root) {
  root.querySelectorAll('[data-bookmark-index]').forEach((el) => {
    el.addEventListener('click', (evt) => {
      evt.stopPropagation()
      toggleBookmark(Number(el.dataset.bookmarkIndex), el)
    })
  })
}

function toggleBookmark(sentenceIndex, iconEl) {
  material.bookmarks = material.bookmarks || []
  const existing = material.bookmarks.findIndex((b) => b.sentenceIndex === sentenceIndex)
  if (existing >= 0) {
    material.bookmarks.splice(existing, 1)
    iconEl.classList.remove('active')
  } else {
    material.bookmarks.push({ sentenceIndex, note: '' })
    iconEl.classList.add('active')
  }
  updateMaterial(material.id, { bookmarks: material.bookmarks })
}

// ---------- main tabbed panel: transcript / vocab / questions / ear training / review ----------

// groupD (Ear Training) only shows up as a tab when the material actually
// has questions for it — reading materials and older materials generated
// before this feature existed simply never get the tab. It's an object
// keyed by subtype (not a flat array like the other groups), so "has any
// questions" means "any subtype array is non-empty".
function hasEarTraining() {
  return Object.values(material.questions.groupD || {}).some((arr) => arr?.length)
}

function hasShadowing() {
  return (material.shadowing || []).length > 0
}

// Ear Training and Shadowing sit right after Vocabulary — both are
// listening/speaking practice, conceptually closer to it than to the
// comprehension question groups that follow. Summary and Transcript are
// last — vocab/practice/questions come first, the full text is there for
// reference/review after.
function tabIds() {
  const earTraining = hasEarTraining() ? ['groupD'] : []
  const shadowing = hasShadowing() ? ['shadowing'] : []
  return ['vocab', 'vocabLesson', ...earTraining, ...shadowing, 'groupA', 'groupB', 'groupC', 'review', 'summary', 'transcript']
}

function tabLabel(t) {
  if (t === 'transcript') return 'Transcript'
  if (t === 'summary') return 'Summary'
  if (t === 'vocab') return 'Vocabulary'
  if (t === 'vocabLesson') return 'Vocab Lesson'
  if (t === 'shadowing') return 'Shadowing'
  if (t === 'review') return 'Review'
  return GROUP_LABELS[t]
}

function allQuestions() {
  return [
    ...(material.questions.groupA || []).map((q) => ({ ...q, group: 'groupA' })),
    ...(material.questions.groupB || []).map((q) => ({ ...q, group: 'groupB' })),
    ...(material.questions.groupC || []).map((q) => ({ ...q, group: 'groupC' })),
  ]
}

// Free-text answers can't be auto-graded, so this tracks completion (how
// many questions have a written answer) rather than correctness — the
// student self-checks against the revealed model answers instead.
function scoreLabel() {
  const total = allQuestions().length
  const answered = allQuestions().filter((q) => (material.userAnswers[q.group]?.[q.id] || '').trim()).length
  return showFeedback ? `Answered: ${answered}/${total}` : `${total} questions`
}

function renderTabPanel() {
  if (activeTab === 'transcript') {
    return `<div class="transcript" id="ws-transcript">${renderTranscript()}</div>`
  }
  if (activeTab === 'summary') {
    return renderSummaryPanel(material)
  }
  if (activeTab === 'vocab') {
    return renderVocabCard(material.vocabulary)
  }
  if (activeTab === 'vocabLesson') {
    return renderVocabLessonPanel(material)
  }
  if (activeTab === 'review') {
    return allQuestions()
      .map((q, i) => questionBlockHTML(q, i, material.userAnswers[q.group]?.[q.id], true))
      .join('')
  }
  if (activeTab === 'groupD') {
    return renderEarTrainingPanel(material)
  }
  if (activeTab === 'shadowing') {
    return renderShadowingPanel(material)
  }
  const questions = material.questions[activeTab] || []
  if (!questions.length) return '<p class="text-muted">No questions in this group.</p>'
  return questions
    .map((q, i) => questionBlockHTML(q, i, material.userAnswers[activeTab]?.[q.id], showFeedback))
    .join('')
}

// The shared "Check All" score bar only makes sense for the open-ended
// question groups — Transcript/Vocabulary/Shadowing have nothing to check,
// and Ear Training checks itself per-exercise (Check/Try Again on each
// card) — so it's hidden on all of those tabs.
const NO_SCORE_BAR_TABS = ['transcript', 'summary', 'vocab', 'vocabLesson', 'groupD', 'shadowing']
function updateScoreBarVisibility(root) {
  const bar = root.querySelector('.ws-score-bar')
  if (bar) bar.style.display = NO_SCORE_BAR_TABS.includes(activeTab) ? 'none' : ''
}

function wireMainPanel(root) {
  root.querySelectorAll('#ws-tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab
      root.querySelectorAll('#ws-tabs button').forEach((b) => b.classList.toggle('active', b === btn))
      root.querySelector('#ws-tab-panel').innerHTML = renderTabPanel()
      updateScoreBarVisibility(root)
      wireQuestionBlocks(root)
    })
  })
  updateScoreBarVisibility(root)
  wireQuestionBlocks(root)

  root.querySelector('#ws-check-all').addEventListener('click', async () => {
    showFeedback = true
    root.querySelector('#ws-tab-panel').innerHTML = renderTabPanel()
    wireQuestionBlocks(root)
    root.querySelector('#ws-score').textContent = scoreLabel()

    const total = allQuestions().length
    const answered = allQuestions().filter((q) => (material.userAnswers[q.group]?.[q.id] || '').trim()).length
    await recordMaterialStudied(material.id)
    await addStudyLogEntry({ materialId: material.id, duration: material.duration || 0, answeredCount: answered, totalCount: total })
  })
}

function wireQuestionBlocks(root) {
  if (activeTab === 'transcript') {
    wireTranscriptTab(root)
    return
  }
  if (activeTab === 'summary') {
    wireSummaryPanel(root, material)
    return
  }
  if (activeTab === 'vocab') {
    wireVocabCard(root)
    return
  }
  if (activeTab === 'vocabLesson') {
    wireVocabLessonPanel(root, material)
    return
  }
  if (activeTab === 'groupD') {
    wireEarTrainingPanel(root, material)
    return
  }
  if (activeTab === 'shadowing') {
    wireShadowingPanel(root)
    return
  }
  const list = activeTab === 'review' ? allQuestions() : (material.questions[activeTab] || []).map((q) => ({ ...q, group: activeTab }))
  list.forEach((q) => {
    wireQuestionBlock(root, q, (questionId, text) => {
      material.userAnswers[q.group] = material.userAnswers[q.group] || {}
      material.userAnswers[q.group][questionId] = text
      updateMaterial(material.id, { userAnswers: material.userAnswers })
      root.querySelector('#ws-score').textContent = scoreLabel()
    })
  })
}

// ---------- utils ----------

// Date + time (unlike utils/helpers.js's formatDate, which is date-only —
// used elsewhere like "Last studied: Aug 10" where time isn't useful).
// Shown in the workspace header so a pre-produced-content batch is
// traceable to exactly when it was imported.
function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
