// Shared single-choice exercise engine — powers Cloze, Minimal Pairs,
// Reduced Speech, Numbers, and Function Words (all "pick one option, Check,
// Try Again"), each just adapting its own item shape into a common
// { promptHTML, speakText, options, correct, hint } view before rendering.
// A whole section (all items of one subtype) re-renders together on any
// interaction within it — simpler and reliable in vanilla JS, and sections
// are small enough (paragraphCount × 3) that this stays smooth.
import { speakStudyText } from './workspace-audio.js'
import { shuffle, fillBlank, getEtSpeed } from '../utils/ear-training-utils.js'

const REDUCED_SPEECH_DISTRACTOR_POOL = [
  'going to', 'want to', 'kind of', 'let me', 'got to', "don't know", 'did you', 'would you',
]

// Builds the 4-option set for a Reduced Speech item client-side, matching
// the reference: the correct original form plus 3 other common forms, so
// the choices always look like plausible alternatives rather than noise.
function buildReducedSpeechOptions(correct) {
  const distractors = REDUCED_SPEECH_DISTRACTOR_POOL.filter((d) => d !== correct).slice(0, 3)
  return shuffle([correct, ...distractors])
}

const ADAPTERS = {
  cloze: (item) => ({
    promptHTML: escapeHtml(item.text),
    speakText: fillBlank(item.text, item.correct),
    options: item.options,
    correct: item.correct,
    hint: item.hint,
  }),
  minimalPairs: (item) => ({
    promptHTML: escapeHtml(item.context),
    speakText: item.correct,
    options: item.options,
    correct: item.correct,
    hint: 'Press Listen and pick the word you heard',
  }),
  reducedSpeech: (item) => ({
    promptHTML: `What does <strong>"${escapeHtml(item.reduced)}"</strong> mean in: "${escapeHtml(item.contextSentence)}"`,
    speakText: item.contextSentence,
    options: buildReducedSpeechOptions(item.original),
    correct: item.original,
    hint: '',
  }),
  numbers: (item) => ({
    promptHTML: 'Press Listen and pick the number you heard.',
    speakText: item.audioText || item.correct,
    options: shuffle([item.correct, ...item.distractors]),
    correct: item.correct,
    hint: '',
  }),
  functionWords: (item) => ({
    promptHTML: item.sentence ? escapeHtml(item.sentence) : `Fill in the blank with: ${escapeHtml(item.missingWord)}`,
    speakText: item.sentence ? fillBlank(item.sentence, item.missingWord) : item.missingWord,
    options: item.options,
    correct: item.missingWord,
    hint: '',
  }),
}

// AI providers don't always match the schema exactly (non-array options, or
// a "correct" value missing from the option list) — never let one bad item
// break the exercise, just make it as usable as possible.
function safeOptions(rawOptions, correct) {
  const opts = Array.isArray(rawOptions) ? rawOptions.filter(Boolean) : []
  return correct && !opts.includes(correct) ? [...opts, correct] : opts
}

export function renderChoiceSection(subtypeKey, items, state) {
  if (!items.length) return '<p class="text-muted">No items for this category.</p>'
  return `<div class="et-list" id="et-section-${subtypeKey}">${items.map((item) => renderChoiceCard(subtypeKey, item, state[item.id])).join('')}</div>`
}

function renderChoiceCard(subtypeKey, item, cardState) {
  const view = ADAPTERS[subtypeKey](item)
  const options = cardState.options || (cardState.options = shuffle(safeOptions(view.options, view.correct)))
  const { selected, checked } = cardState
  const isCorrect = checked && selected === view.correct

  return `
    <div class="et-card ${checked ? (isCorrect ? 'et-correct' : 'et-incorrect') : ''}" data-item-id="${escapeAttr(item.id)}">
      <div class="et-card-top">
        <div class="et-prompt">${view.promptHTML}</div>
        <button class="btn ghost et-speak" data-text="${escapeAttr(view.speakText)}">🔊 Listen</button>
      </div>
      <div class="et-options">
        ${options
          .map((opt) => {
            const isSelected = selected === opt
            const isCorrectOpt = checked && opt === view.correct
            const isWrong = checked && isSelected && opt !== view.correct
            return `<button class="et-option ${isSelected ? 'selected' : ''} ${isCorrectOpt ? 'et-opt-correct' : ''} ${isWrong ? 'et-opt-wrong' : ''}" data-option="${escapeAttr(opt)}" ${checked ? 'disabled' : ''}>${escapeHtml(opt)}</button>`
          })
          .join('')}
      </div>
      ${
        !checked
          ? `<div class="et-actions">
              <button class="btn primary et-check" ${selected ? '' : 'disabled'}>Check</button>
              ${view.hint ? `<span class="et-hint">Hint: ${escapeHtml(view.hint)}</span>` : ''}
            </div>`
          : `<div class="et-feedback">
              <span class="${isCorrect ? 'et-ok-text' : 'et-bad-text'}">${isCorrect ? '✓ Correct' : `✗ Correct answer: ${escapeHtml(view.correct)}`}</span>
              <button class="btn ghost et-retry">Try again</button>
            </div>`
      }
    </div>
  `
}

export function wireChoiceSection(root, subtypeKey, items, state, onPersist) {
  const section = root.querySelector(`#et-section-${subtypeKey}`)
  if (!section) return

  const refresh = () => {
    section.outerHTML = renderChoiceSection(subtypeKey, items, state)
    wireChoiceSection(root, subtypeKey, items, state, onPersist)
  }

  section.querySelectorAll('.et-speak').forEach((btn) => {
    btn.addEventListener('click', () => speakStudyText(btn.dataset.text, getEtSpeed()))
  })
  section.querySelectorAll('.et-card').forEach((card) => {
    const item = items.find((it) => it.id === card.dataset.itemId)
    const cardState = state[item.id]
    if (!cardState.checked) {
      card.querySelectorAll('.et-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          cardState.selected = btn.dataset.option
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
        cardState.selected = null
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
