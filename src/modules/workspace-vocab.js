// Vocabulary tab content, split out of workspace.js to stay under the
// 400-line-per-file rule. Every word is shown fully expanded in one list —
// word + pronunciation + TR meaning + synonym/antonym on one line, examples
// below it — no click-to-open dialog, so the whole vocabulary is scannable
// at a glance instead of hidden behind chips.
import { speakVocabText } from './workspace-audio.js'

export function renderVocabCard(vocabulary) {
  const items = vocabulary || []
  if (!items.length) return '<p class="text-muted">No vocabulary for this material.</p>'
  return `<div class="vocab-full-list">${items.map(renderVocabRow).join('')}</div>`
}

function renderVocabRow(v) {
  return `
    <div class="vocab-row">
      <p class="vocab-row-head">
        <button class="icon-btn vocab-speak" data-text="${escapeAttr(v.word)}" title="Pronounce" aria-label="Pronounce ${escapeAttr(v.word)}">🔊</button>
        <strong>${escapeHtml(v.word)}</strong>
        ${v.pronunciation ? `<span class="text-muted">/${escapeHtml(v.pronunciation)}/</span>` : ''}
        <span><strong>TR:</strong> ${escapeHtml(v.meaningTR || v.meaning || '—')}</span>
        ${v.synonym ? `<span>&nbsp;·&nbsp;<strong>Syn:</strong> ${escapeHtml(v.synonym)}</span>` : ''}
        ${v.antonym ? `<span>&nbsp;·&nbsp;<strong>Ant:</strong> ${escapeHtml(v.antonym)}</span>` : ''}
      </p>
      ${
        v.examples?.length
          ? v.examples
              .map((ex, i) => {
                // Old materials (generated before per-example pronunciation
                // existed) still have plain strings here — handle both.
                const text = typeof ex === 'string' ? ex : ex.text
                const pronunciation = typeof ex === 'string' ? '' : ex.pronunciation
                return `
                <p class="vocab-example">
                  <button class="icon-btn vocab-speak" data-text="${escapeAttr(text)}" title="Pronounce example">🔊</button>
                  <span>${i + 1}. ${escapeHtml(text)}${pronunciation ? ` <span class="text-muted">/${escapeHtml(pronunciation)}/</span>` : ''}</span>
                </p>`
              })
              .join('')
          : ''
      }
    </div>
  `
}

export function wireVocabCard(root) {
  root.querySelectorAll('.vocab-speak').forEach((btn) => {
    btn.addEventListener('click', () => speakVocabText(btn.dataset.text))
  })
}

// Used by workspace.js to show a transcript sentence's matching vocab word
// (word + Turkish meaning) as a hover tooltip.
export function vocabMatchTitle(vocabulary, text) {
  const lower = text.toLowerCase()
  const hit = (vocabulary || []).find((v) => v.word && lower.includes(v.word.toLowerCase()))
  return hit ? `${hit.word}: ${hit.meaningTR || hit.meaning || ''}` : ''
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
