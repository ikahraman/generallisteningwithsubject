import { splitSentences } from './helpers.js'

const REQUIRED_TOP_LEVEL = ['title', 'transcript', 'paragraphs', 'questions']
const QUESTION_GROUPS = ['groupA', 'groupB', 'groupC']

export function parseGeminiMaterialJSON(rawText) {
  const cleaned = stripCodeFences(rawText)
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch (err) {
    // Logged (not shown to the user) so a real parse failure — as opposed to
    // truncation, which gemini.js now catches earlier via finishReason — can
    // actually be diagnosed from devtools instead of just "try again".
    console.error('Gemini JSON parse failure:', err.message, '\n--- raw response ---\n', rawText)
    throw new Error('The AI response was not valid JSON. Try generating again.')
  }
  return validateMaterialJSON(obj)
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
}

export function validateMaterialJSON(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('AI response was empty or malformed.')

  for (const key of REQUIRED_TOP_LEVEL) {
    if (!(key in obj)) throw new Error(`AI response is missing required field "${key}".`)
  }
  if (!Array.isArray(obj.paragraphs) || obj.paragraphs.length === 0) {
    throw new Error('AI response has no paragraphs.')
  }

  const questions = obj.questions && typeof obj.questions === 'object' ? obj.questions : {}
  for (const group of QUESTION_GROUPS) {
    if (!Array.isArray(questions[group])) questions[group] = []
    questions[group] = questions[group].map((q, i) => validateQuestion(q, group, i))
  }
  // groupD (Ear Training) is optional — only audio modes ask Gemini for it —
  // and shaped completely differently from groupA/B/C: an object keyed by
  // subtype (each with its own item shape), not a flat question list.
  const rawGroupD = questions.groupD
  questions.groupD = validateEarTraining(rawGroupD)
  logEarTrainingDiagnostics(rawGroupD, questions.groupD)

  return {
    title: String(obj.title || 'Untitled Material'),
    transcript: String(obj.transcript || ''),
    paragraphs: obj.paragraphs.map(normalizeParagraph),
    vocabulary: validateVocabulary(obj.vocabulary),
    expressions: Array.isArray(obj.expressions) ? obj.expressions : [],
    grammar: Array.isArray(obj.grammar) ? obj.grammar : [],
    questions,
    shadowing: validateShadowing(obj.shadowing),
  }
}

// Each example now carries its own written pronunciation (a whole-sentence
// phonetic transcription), not just the headword — self-healing here so a
// plain string (if Gemini ignores the {text, pronunciation} shape) still
// renders correctly instead of leaving "pronunciation" undefined everywhere.
function validateVocabulary(vocabulary) {
  const items = toArray(vocabulary).map((v) => ({
    ...v,
    examples: toArray(v?.examples).map((ex) =>
      typeof ex === 'string'
        ? { text: ex, pronunciation: '' }
        : { text: String(ex?.text || ''), pronunciation: String(ex?.pronunciation || '') }
    ),
  }))
  const allExamples = items.flatMap((v) => v.examples)
  if (allExamples.length && allExamples.every((ex) => !ex.pronunciation)) {
    // Logged (not shown to the user) — Gemini either omitted the field
    // entirely or used a different shape ("phonetic" instead of
    // "pronunciation", etc). Doesn't affect anything else, so not worth
    // failing generation over, but worth being able to diagnose.
    console.warn('Vocabulary: no example carried a "pronunciation" value — Gemini likely omitted that part of the schema.')
  }
  return items
}

// Each item is one verbatim sentence from the transcript for shadowing
// practice (listen, then repeat aloud) — a flat list, not chunk/type-tagged.
// `pronunciation` (whole-sentence phonetic transcription) mirrors the same
// field on vocabulary examples — same diagnostic-not-fatal handling if
// Gemini omits it.
function validateShadowing(shadowing) {
  const items = toArray(shadowing).map((it, i) => ({
    id: it?.id || `sh-${i + 1}`,
    text: String(it?.text || it?.chunk || ''),
    pronunciation: String(it?.pronunciation || ''),
    paragraphRef: numberOr(it?.paragraphRef),
  }))
  if (items.length && items.every((it) => !it.pronunciation)) {
    console.warn('Shadowing: no item carried a "pronunciation" value — Gemini likely omitted that part of the schema.')
  }
  return items
}

function normalizeParagraph(p) {
  if (typeof p === 'string') return { text: p, sentences: splitSentences(p) }
  const text = String(p?.text || '')
  const sentences = Array.isArray(p?.sentences) && p.sentences.length ? p.sentences : splitSentences(text)
  return { text, sentences }
}

// Open-ended questions: the AI provides a model answer string instead of a
// set of options. No self-healing needed here (unlike the old options-based
// format) since there's nothing structural to collapse or reposition.
function validateQuestion(q, group, i) {
  if (!q || typeof q !== 'object') throw new Error(`${group} question #${i + 1} is malformed.`)
  if (!q.text || typeof q.text !== 'string') {
    throw new Error(`${group} question #${i + 1} is missing question text.`)
  }

  return {
    id: q.id || `${group}-${i + 1}`,
    text: String(q.text || ''),
    correctAnswer: String(q.correctAnswer || ''),
    paragraphRef: typeof q.paragraphRef === 'number' ? q.paragraphRef : 0,
  }
}

// Logged (not shown to the user) so "no Ear Training tab" can actually be
// diagnosed — was groupD missing from Gemini's response entirely (it ignored
// that part of the prompt), or present but shaped wrong (parsed to 0 items)?
function logEarTrainingDiagnostics(rawGroupD, validated) {
  const total = Object.values(validated).reduce((sum, arr) => sum + arr.length, 0)
  if (total > 0) return
  if (rawGroupD === undefined) {
    console.warn('Ear Training: Gemini response had no "groupD" key at all (expected for reading modes — if this was a listening mode, Gemini skipped the section).')
  } else {
    console.warn('Ear Training: "groupD" was present but no valid items were extracted from it. Raw value:', rawGroupD)
  }
}

// Ear Training validation is intentionally light (types/defaults only) — it
// does NOT try to fix up "correctWords" or "correct"/"options" mismatches
// here. That defensive work happens in the exercise UI instead (recomputed
// from the sentence/option text itself, not trusted blindly from the AI),
// matching how the reference implementation this was ported from does it.
function validateEarTraining(groupD) {
  const obj = groupD && typeof groupD === 'object' ? groupD : {}
  return {
    wordSpotting: toArray(obj.wordSpotting).map((it, i) => ({
      id: it?.id || `ws-${i + 1}`,
      paragraphRef: numberOr(it?.paragraphRef),
      sentence: String(it?.sentence || ''),
      options: toStringArray(it?.options),
      correctWords: toStringArray(it?.correctWords),
    })),
    cloze: toArray(obj.cloze).map((it, i) => ({
      id: it?.id || `cl-${i + 1}`,
      paragraphRef: numberOr(it?.paragraphRef),
      text: String(it?.text || ''),
      options: toStringArray(it?.options),
      correct: String(it?.correct || ''),
      hint: String(it?.hint || ''),
    })),
    dictation: toArray(obj.dictation).map((it, i) => ({
      id: it?.id || `dc-${i + 1}`,
      paragraphRef: numberOr(it?.paragraphRef),
      correctText: String(it?.correctText || ''),
      difficulty: ['word', 'phrase', 'sentence'].includes(it?.difficulty) ? it.difficulty : 'sentence',
    })),
    minimalPairs: toArray(obj.minimalPairs).map((it, i) => ({
      id: it?.id || `mp-${i + 1}`,
      paragraphRef: numberOr(it?.paragraphRef),
      options: toStringArray(it?.options),
      correct: String(it?.correct || ''),
      context: String(it?.context || ''),
    })),
    reducedSpeech: toArray(obj.reducedSpeech).map((it, i) => ({
      id: it?.id || `rs-${i + 1}`,
      paragraphRef: numberOr(it?.paragraphRef),
      original: String(it?.original || ''),
      reduced: String(it?.reduced || ''),
      contextSentence: String(it?.contextSentence || ''),
      type: ['reduction', 'linking', 'elision'].includes(it?.type) ? it.type : 'reduction',
    })),
    numbers: toArray(obj.numbers).map((it, i) => ({
      id: it?.id || `nm-${i + 1}`,
      paragraphRef: numberOr(it?.paragraphRef),
      audioText: String(it?.audioText || it?.correct || ''),
      correct: String(it?.correct || ''),
      distractors: toStringArray(it?.distractors),
    })),
    functionWords: toArray(obj.functionWords).map((it, i) => ({
      id: it?.id || `fw-${i + 1}`,
      paragraphRef: numberOr(it?.paragraphRef),
      sentence: String(it?.sentence || ''),
      missingWord: String(it?.missingWord || ''),
      options: toStringArray(it?.options),
    })),
  }
}

function toArray(v) {
  return Array.isArray(v) ? v : []
}
function toStringArray(v) {
  return Array.isArray(v) ? v.map(String) : []
}
function numberOr(v, fallback = 0) {
  return typeof v === 'number' ? v : fallback
}
