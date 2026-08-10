// Ear Training tab: a sub-tab bar over 7 exercise subtypes (Word Spotting,
// Cloze, Dictation, Minimal Pairs, Reduced Speech, Numbers, Function Words),
// each with its own interaction — only one shown at a time, same tab pattern
// as the rest of Workspace. Word Spotting (checkbox multi-select) and
// Dictation (typed + word-by-word diff) are custom; the other 5 are all
// "pick one option" and share the engine in workspace-ear-training-choice.js.
// Split out of workspace.js to stay under the 400-line-per-file rule.
import { updateMaterial } from '../db.js'
import { speakStudyText } from './workspace-audio.js'
import { EAR_TRAINING_SUBTYPES } from './material-modes.js'
import { renderChoiceSection, wireChoiceSection } from './workspace-ear-training-choice.js'
import { shuffle, wordAppearsIn, compareWords, getEtSpeed, setEtSpeed, SPEECH_RATE_OPTIONS } from '../utils/ear-training-utils.js'

let activeSubtab = null

function ensureAnswers(material) {
  material.earTrainingAnswers = material.earTrainingAnswers || {}
  for (const { key } of EAR_TRAINING_SUBTYPES) material.earTrainingAnswers[key] = material.earTrainingAnswers[key] || {}
  return material.earTrainingAnswers
}

function ensureCardState(answers, subtypeKey, itemId, init) {
  if (!answers[subtypeKey][itemId]) answers[subtypeKey][itemId] = init()
  return answers[subtypeKey][itemId]
}

export function renderEarTrainingPanel(material) {
  const groupD = material.questions.groupD || {}
  const answers = ensureAnswers(material)
  const sections = EAR_TRAINING_SUBTYPES.filter((s) => (groupD[s.key] || []).length > 0)

  if (!sections.length) {
    return '<p class="text-muted">No ear training content was generated for this material.</p>'
  }
  // Falls back to the first available subtype if the material changed (or
  // this is the first visit) and the previously active one no longer exists.
  if (!sections.some((s) => s.key === activeSubtab)) activeSubtab = sections[0].key

  for (const { key } of sections) {
    for (const item of groupD[key] || []) ensureCardState(answers, key, item.id, () => defaultState(key))
  }

  return `
    <div class="et-panel">
      <div class="et-speed-row">
        <label class="et-speed-label">Speed:
          <select id="et-speed">
            ${SPEECH_RATE_OPTIONS.map((r) => `<option value="${r}" ${r === getEtSpeed() ? 'selected' : ''}>${r.toFixed(2)}x</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="tabs et-subtabs" id="et-subtabs">
        ${sections
          .map(
            ({ key, label }) =>
              `<button data-subtab="${key}" class="${key === activeSubtab ? 'active' : ''}">${label} <span class="badge">${(groupD[key] || []).length}</span></button>`
          )
          .join('')}
      </div>
      <div class="et-subtab-panel" id="et-subtab-panel">${renderSection(activeSubtab, groupD[activeSubtab] || [], answers[activeSubtab])}</div>
    </div>
  `
}

function defaultState(subtypeKey) {
  if (subtypeKey === 'wordSpotting') return { options: null, selected: [], checked: false }
  if (subtypeKey === 'dictation') return { value: '', checked: false }
  return { options: null, selected: null, checked: false }
}

function renderSection(subtypeKey, items, state) {
  if (subtypeKey === 'wordSpotting') return renderWordSpottingSection(items, state)
  if (subtypeKey === 'dictation') return renderDictationSection(items, state)
  return renderChoiceSection(subtypeKey, items, state)
}

export function wireEarTrainingPanel(root, material) {
  const panel = root.querySelector('.et-panel')
  if (!panel) return
  const groupD = material.questions.groupD || {}
  const answers = ensureAnswers(material)
  const persist = () => updateMaterial(material.id, { earTrainingAnswers: material.earTrainingAnswers })

  panel.querySelector('#et-speed')?.addEventListener('change', (e) => setEtSpeed(Number(e.target.value)))

  panel.querySelectorAll('#et-subtabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeSubtab = btn.dataset.subtab
      panel.querySelectorAll('#et-subtabs button').forEach((b) => b.classList.toggle('active', b === btn))
      const items = groupD[activeSubtab] || []
      panel.querySelector('#et-subtab-panel').innerHTML = renderSection(activeSubtab, items, answers[activeSubtab])
      wireActiveSection(root, activeSubtab, items, answers[activeSubtab], persist)
    })
  })

  wireActiveSection(root, activeSubtab, groupD[activeSubtab] || [], answers[activeSubtab], persist)
}

function wireActiveSection(root, key, items, state, persist) {
  if (!items.length) return
  if (key === 'wordSpotting') wireWordSpottingSection(root, items, state, persist)
  else if (key === 'dictation') wireDictationSection(root, items, state, persist)
  else wireChoiceSection(root, key, items, state, persist)
}

// ---------- Word Spotting (checkbox multi-select) ----------

function renderWordSpottingSection(items, state) {
  if (!items.length) return '<p class="text-muted">No items for this category.</p>'
  return `<div class="et-list" id="et-section-wordSpotting">${items.map((item) => renderWordSpottingCard(item, state[item.id])).join('')}</div>`
}

// Ground truth for "correct" is the sentence text itself (via wordAppearsIn),
// not item.correctWords blindly — AI providers sometimes list a word as a
// distractor that actually does appear in the sentence.
function renderWordSpottingCard(item, cardState) {
  if (!cardState.options) cardState.options = shuffle(item.options)
  const { options, selected, checked } = cardState
  const correctWords = options.filter((opt) => wordAppearsIn(item.sentence, opt))
  const isAllCorrect = checked && selected.length === correctWords.length && selected.every((w) => correctWords.includes(w))

  return `
    <div class="et-card ${checked ? (isAllCorrect ? 'et-correct' : 'et-incorrect') : ''}" data-item-id="${escapeAttr(item.id)}">
      <div class="et-card-top">
        <p class="et-prompt-hint">Listen, then tick the words you heard.</p>
        <button class="btn ghost et-speak" data-text="${escapeAttr(item.sentence)}">🔊 Listen</button>
      </div>
      <div class="et-options">
        ${options
          .map((word) => {
            const isSelected = selected.includes(word)
            const isCorrectWord = checked && correctWords.includes(word)
            const isWrong = checked && isSelected && !correctWords.includes(word)
            const isMissed = checked && !isSelected && correctWords.includes(word)
            return `<button class="et-option et-word ${isSelected ? 'selected' : ''} ${isCorrectWord ? 'et-opt-correct' : ''} ${isWrong ? 'et-opt-wrong' : ''} ${isMissed ? 'et-opt-missed' : ''}" data-word="${escapeAttr(word)}" ${checked ? 'disabled' : ''}><span class="et-checkbox">${isSelected ? '✓' : ''}</span>${escapeHtml(word)}</button>`
          })
          .join('')}
      </div>
      ${
        !checked
          ? `<div class="et-actions"><button class="btn primary et-check" ${selected.length ? '' : 'disabled'}>Check</button></div>`
          : `<div class="et-feedback">
              <span class="${isAllCorrect ? 'et-ok-text' : 'et-bad-text'}">${isAllCorrect ? '✓ Correct' : `✗ Correct words: ${correctWords.join(', ')}`}</span>
              <p class="text-muted" style="margin:4px 0;">"${escapeHtml(item.sentence)}"</p>
              <button class="btn ghost et-retry">Try again</button>
            </div>`
      }
    </div>
  `
}

function wireWordSpottingSection(root, items, state, onPersist) {
  const section = root.querySelector('#et-section-wordSpotting')
  if (!section) return
  const refresh = () => {
    section.outerHTML = renderWordSpottingSection(items, state)
    wireWordSpottingSection(root, items, state, onPersist)
  }
  section.querySelectorAll('.et-speak').forEach((btn) => btn.addEventListener('click', () => speakStudyText(btn.dataset.text, getEtSpeed())))
  section.querySelectorAll('.et-card').forEach((card) => {
    const item = items.find((it) => it.id === card.dataset.itemId)
    const cardState = state[item.id]
    if (!cardState.checked) {
      card.querySelectorAll('.et-word').forEach((btn) => {
        btn.addEventListener('click', () => {
          const word = btn.dataset.word
          const idx = cardState.selected.indexOf(word)
          if (idx >= 0) cardState.selected.splice(idx, 1)
          else cardState.selected.push(word)
          onPersist()
          refresh()
        })
      })
      card.querySelector('.et-check')?.addEventListener('click', () => {
        cardState.checked = true
        onPersist()
        refresh()
      })
    } else {
      card.querySelector('.et-retry')?.addEventListener('click', () => {
        cardState.checked = false
        cardState.selected = []
        onPersist()
        refresh()
      })
    }
  })
}

// ---------- Dictation (typed + word-by-word diff) ----------

function renderDictationSection(items, state) {
  if (!items.length) return '<p class="text-muted">No items for this category.</p>'
  return `<div class="et-list" id="et-section-dictation">${items.map((item) => renderDictationCard(item, state[item.id])).join('')}</div>`
}

function renderDictationCard(item, cardState) {
  const { value, checked } = cardState
  const comparison = checked ? compareWords(item.correctText, value) : []
  const allCorrect = checked && comparison.length > 0 && comparison.every((c) => c.correct)

  return `
    <div class="et-card ${checked ? (allCorrect ? 'et-correct' : 'et-incorrect') : ''}" data-item-id="${escapeAttr(item.id)}">
      <div class="et-card-top">
        <span class="badge">${escapeHtml(item.difficulty)}</span>
        <button class="btn ghost et-speak" data-text="${escapeAttr(item.correctText)}">🔊 Listen</button>
      </div>
      <textarea class="et-dictation-input" rows="2" placeholder="Type exactly what you hear..." ${checked ? 'disabled' : ''}>${escapeHtml(value)}</textarea>
      ${
        !checked
          ? `<div class="et-actions"><button class="btn primary et-check" ${value.trim() ? '' : 'disabled'}>Check</button></div>`
          : `<div class="et-feedback-col">
              <span class="${allCorrect ? 'et-ok-text' : 'et-bad-text'}">${allCorrect ? '✓ Perfect!' : 'Word-by-word comparison:'}</span>
              ${!allCorrect ? `<p class="et-diff">${comparison.map((c) => `<span class="${c.correct ? 'et-diff-ok' : 'et-diff-bad'}">${escapeHtml(c.word)}</span>`).join(' ')}</p>` : ''}
              <button class="btn ghost et-retry">Try again</button>
            </div>`
      }
    </div>
  `
}

function wireDictationSection(root, items, state, onPersist) {
  const section = root.querySelector('#et-section-dictation')
  if (!section) return
  const refresh = () => {
    section.outerHTML = renderDictationSection(items, state)
    wireDictationSection(root, items, state, onPersist)
  }
  section.querySelectorAll('.et-speak').forEach((btn) => btn.addEventListener('click', () => speakStudyText(btn.dataset.text, getEtSpeed())))
  section.querySelectorAll('.et-card').forEach((card) => {
    const item = items.find((it) => it.id === card.dataset.itemId)
    const cardState = state[item.id]
    const textarea = card.querySelector('.et-dictation-input')
    if (!cardState.checked) {
      // Deliberately not a full refresh() per keystroke — that would blur
      // the textarea and reset the cursor position on every character typed.
      textarea?.addEventListener('input', () => {
        cardState.value = textarea.value
        const checkBtn = card.querySelector('.et-check')
        if (checkBtn) checkBtn.disabled = !textarea.value.trim()
      })
      textarea?.addEventListener('blur', onPersist)
      card.querySelector('.et-check')?.addEventListener('click', () => {
        cardState.checked = true
        onPersist()
        refresh()
      })
    } else {
      card.querySelector('.et-retry')?.addEventListener('click', () => {
        cardState.checked = false
        cardState.value = ''
        onPersist()
        refresh()
      })
    }
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
