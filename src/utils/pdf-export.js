import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { MODE_LABELS, GROUP_LABELS, EAR_TRAINING_SUBTYPES } from '../modules/material-modes.js'

// pdf-lib's built-in 14 standard fonts only support WinAnsi encoding, which
// can't render Turkish characters (ı, ğ, ş, ç, ö, ü, İ...) or IPA phonetic
// symbols (ɪ, ˈ, ɡ, ʃ...) used in vocabulary pronunciation guides — and this
// app's worksheets plausibly contain both. DejaVu Sans is embedded instead
// via fontkit: it has full Latin Extended + IPA Extensions coverage, unlike
// Roboto which lacks IPA glyphs entirely. (Bitstream Vera license, free.)
const FONT_REGULAR_URL = '/fonts/DejaVuSans.ttf'
const FONT_BOLD_URL = '/fonts/DejaVuSans-Bold.ttf'

const PAGE_WIDTH = 595.28 // A4 in points
const PAGE_HEIGHT = 841.89
const MARGIN = 50
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const INK = rgb(0.13, 0.13, 0.15)
const MUTED = rgb(0.45, 0.45, 0.48)
const RULE = rgb(0.8, 0.8, 0.82)

// Tracks page/cursor state and handles automatic pagination + text wrapping,
// since pdf-lib only draws single lines at fixed coordinates.
class PdfBuilder {
  constructor(doc, fontRegular, fontBold) {
    this.doc = doc
    this.fontRegular = fontRegular
    this.fontBold = fontBold
    this.page = null
    this.y = 0
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    this.y = PAGE_HEIGHT - MARGIN
    return this.page
  }

  ensureSpace(height) {
    if (this.y - height < MARGIN) this.addPage()
  }

  heading(text, size = 16) {
    this.ensureSpace(size + 12)
    this.page.drawText(text, { x: MARGIN, y: this.y, size, font: this.fontBold, color: INK })
    this.y -= size + 12
  }

  paragraph(text, { size = 11, font, color = INK, lineHeight = size * 1.5, indent = 0 } = {}) {
    const f = font || this.fontRegular
    const lines = wrapText(text, f, size, CONTENT_WIDTH - indent)
    lines.forEach((line) => {
      this.ensureSpace(lineHeight)
      this.page.drawText(line, { x: MARGIN + indent, y: this.y, size, font: f, color })
      this.y -= lineHeight
    })
  }

  spacer(height) {
    this.y -= height
  }

  rule() {
    this.ensureSpace(12)
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 0.75, color: RULE })
    this.y -= 12
  }

  blankLines(count, spacing = 24) {
    for (let i = 0; i < count; i++) {
      this.ensureSpace(spacing)
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_WIDTH - MARGIN, y: this.y }, thickness: 0.5, color: RULE })
      this.y -= spacing
    }
  }

}

function wrapText(text, font, size, maxWidth) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean)
  const lines = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (current && font.widthOfTextAtSize(test, size) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

/**
 * Generates a printable study worksheet for a material. Page order: cover
 * + vocabulary together on page 1 (no break between them), then each
 * question group on its own page, then transcript, prediction, writing
 * prompt, notes, and (optionally) a Teacher's Key as the last page.
 * @param {object} material
 * @param {{includeAnswerKey?: boolean}} options
 * @returns {Promise<Blob>}
 */
export async function generateWorksheetPDF(material, { includeAnswerKey = false } = {}) {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const [regularBytes, boldBytes] = await Promise.all([
    fetch(FONT_REGULAR_URL).then((r) => r.arrayBuffer()),
    fetch(FONT_BOLD_URL).then((r) => r.arrayBuffer()),
  ])
  const fontRegular = await doc.embedFont(regularBytes, { subset: true })
  const fontBold = await doc.embedFont(boldBytes, { subset: true })
  const b = new PdfBuilder(doc, fontRegular, fontBold)

  drawCoverAndVocabulary(b, material)
  drawQuestionGroup(b, material, 'groupA')
  drawQuestionGroup(b, material, 'groupB')
  drawQuestionGroup(b, material, 'groupC')
  drawEarTrainingGroup(b, material)
  drawTranscript(b, material)
  drawPrediction(b, material)
  drawWritingPrompt(b, material)
  drawNotesPage(b)
  if (includeAnswerKey) drawAnswerKey(b, material)

  const bytes = await doc.save()
  return new Blob([bytes], { type: 'application/pdf' })
}

// Title/level/date/word-count/topic flow straight into the vocabulary list
// with no forced page break — they only spill onto page 2 if the vocab
// list is long enough to overflow naturally.
function drawCoverAndVocabulary(b, material) {
  b.addPage()
  b.spacer(40)
  b.heading(material.title, 24)
  b.spacer(6)
  b.paragraph(`${material.level} · ${MODE_LABELS[material.mode] || material.mode}`, { size: 13, color: MUTED })
  b.spacer(16)
  b.rule()
  b.paragraph(`Date: ${new Date().toLocaleDateString()}`, { size: 11 })
  b.paragraph(`Word Count: ${material.wordCount || 0}`, { size: 11 })
  b.paragraph(`Topic: ${material.topic || '—'}`, { size: 11 })
  b.spacer(20)

  b.heading('Vocabulary', 16)
  const vocab = material.vocabulary || []
  if (!vocab.length) b.paragraph('No vocabulary recorded for this material.', { size: 10.5, color: MUTED })
  vocab.forEach((v) => {
    const parts = [v.word]
    if (v.pronunciation) parts.push(`/${v.pronunciation}/`)
    parts.push(v.meaningTR || v.meaning || '')
    if (v.synonym) parts.push(`Syn: ${v.synonym}`)
    if (v.antonym) parts.push(`Ant: ${v.antonym}`)
    b.paragraph(parts.filter(Boolean).join('  ·  '), { size: 11, font: b.fontBold })
    const examples = v.examples?.length ? v.examples : v.context ? [v.context] : []
    examples.forEach((ex, i) => {
      // Old materials (generated before per-example pronunciation existed)
      // still have plain strings here — handle both.
      const text = typeof ex === 'string' ? ex : ex.text
      const pronunciation = typeof ex === 'string' ? '' : ex.pronunciation
      const line = pronunciation ? `${i + 1}. ${text}  /${pronunciation}/` : `${i + 1}. ${text}`
      b.paragraph(line, { size: 10, color: MUTED, indent: 12 })
    })
    b.spacer(4)
  })
}

function drawQuestionGroup(b, material, group) {
  const questions = material.questions?.[group] || []
  if (!questions.length) return
  b.addPage()
  b.heading(GROUP_LABELS[group], 16)
  questions.forEach((q, i) => {
    b.paragraph(`${i + 1}. ${q.text}`, { size: 11, font: b.fontBold })
    b.blankLines(2, 18)
    b.spacer(6)
  })
}

// Ear Training (groupD) isn't a flat question list like groupA/B/C — it's an
// object keyed by subtype, each with its own item shape and its own way of
// posing a printable version of what's an on-screen interactive exercise
// on-screen (checkboxes, multiple choice, or typed dictation).
function drawEarTrainingGroup(b, material) {
  const groupD = material.questions?.groupD
  const sections = EAR_TRAINING_SUBTYPES.filter((s) => (groupD?.[s.key] || []).length)
  if (!sections.length) return

  b.addPage()
  b.heading('Ear Training', 16)
  sections.forEach(({ key, label }) => {
    b.spacer(6)
    b.heading(label, 13)
    ;(groupD[key] || []).forEach((item, i) => drawEarTrainingItem(b, key, item, i))
  })
}

function drawEarTrainingItem(b, subtypeKey, item, i) {
  const num = `${i + 1}.`
  switch (subtypeKey) {
    case 'wordSpotting':
      b.paragraph(`${num} Listen, then circle the words you heard.`, { size: 11, font: b.fontBold })
      b.paragraph(`Options: ${item.options.join('  /  ')}`, { size: 10, color: MUTED, indent: 12 })
      break
    case 'cloze':
      b.paragraph(`${num} ${item.text}`, { size: 11, font: b.fontBold })
      b.paragraph(`Options: ${item.options.join('  /  ')}`, { size: 10, color: MUTED, indent: 12 })
      break
    case 'dictation':
      b.paragraph(`${num} [${item.difficulty}] Write exactly what you hear:`, { size: 11, font: b.fontBold })
      b.blankLines(1, 16)
      break
    case 'minimalPairs':
      b.paragraph(`${num} ${item.context}`, { size: 11, font: b.fontBold })
      b.paragraph(`Options: ${item.options.join('  /  ')}`, { size: 10, color: MUTED, indent: 12 })
      break
    case 'reducedSpeech':
      b.paragraph(`${num} What does "${item.reduced}" mean in: "${item.contextSentence}"`, { size: 11, font: b.fontBold })
      break
    case 'numbers':
      b.paragraph(`${num} Listen and write the number you heard:`, { size: 11, font: b.fontBold })
      b.blankLines(1, 16)
      break
    case 'functionWords':
      b.paragraph(`${num} ${item.sentence}`, { size: 11, font: b.fontBold })
      b.paragraph(`Options: ${item.options.join('  /  ')}`, { size: 10, color: MUTED, indent: 12 })
      break
  }
  b.spacer(6)
}

function earTrainingAnswer(subtypeKey, item) {
  switch (subtypeKey) {
    case 'wordSpotting':
      return item.correctWords.join(', ')
    case 'cloze':
      return item.correct
    case 'dictation':
      return item.correctText
    case 'minimalPairs':
      return item.correct
    case 'reducedSpeech':
      return item.original
    case 'numbers':
      return item.correct
    case 'functionWords':
      return item.missingWord
    default:
      return ''
  }
}

function drawTranscript(b, material) {
  b.addPage()
  b.heading('Transcript', 16)
  ;(material.paragraphs || []).forEach((p) => {
    b.paragraph(p.text, { size: 11 })
    b.spacer(10)
  })
}

function drawPrediction(b, material) {
  b.addPage()
  b.heading('Prediction', 16)
  b.paragraph('Before reading/listening, write what you expect this material to be about:', { size: 10.5, color: MUTED })
  b.blankLines(3)
}

function drawWritingPrompt(b, material) {
  b.addPage()
  b.heading('Writing Prompt', 16)
  b.paragraph(`Write a short response (150–200 words) related to "${material.topic || material.title}".`, { size: 11 })
  b.spacer(10)
  b.blankLines(16)
}

function drawNotesPage(b) {
  b.addPage()
  b.heading('Notes', 16)
  b.blankLines(22)
}

function drawAnswerKey(b, material) {
  b.addPage()
  b.heading("Teacher's Key", 16)
  for (const group of ['groupA', 'groupB', 'groupC']) {
    const questions = material.questions?.[group] || []
    if (!questions.length) continue
    b.spacer(6)
    b.heading(GROUP_LABELS[group], 13)
    questions.forEach((q, i) => {
      b.paragraph(`${i + 1}. ${q.correctAnswer}`, { size: 11 })
    })
  }

  const groupD = material.questions?.groupD
  const sections = EAR_TRAINING_SUBTYPES.filter((s) => (groupD?.[s.key] || []).length)
  if (sections.length) {
    b.spacer(6)
    b.heading('Ear Training', 13)
    sections.forEach(({ key, label }) => {
      b.paragraph(label, { size: 11, font: b.fontBold })
      ;(groupD[key] || []).forEach((item, i) => {
        b.paragraph(`${i + 1}. ${earTrainingAnswer(key, item)}`, { size: 10.5, indent: 12 })
      })
    })
  }
}
