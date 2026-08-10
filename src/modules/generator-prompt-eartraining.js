// The Ear Training (groupD) section of the Gemini generation prompt — kept
// separate from generator-prompt.js since it's a large, self-contained block
// (7 distinct exercise types, each with its own item shape). Wording follows
// a reference implementation's proven prompt closely; adapted here for
// paragraph-based materials (paragraphRef) instead of transcript line ids,
// and scaled by paragraph count instead of fixed totals.
const QUESTIONS_PER_PARAGRAPH = 3

export function earTrainingItemCount(paragraphCount) {
  return paragraphCount * QUESTIONS_PER_PARAGRAPH
}

export const EAR_TRAINING_SCHEMA_SNIPPET = `,
    "groupD": {
      "wordSpotting": [...],
      "cloze": [...],
      "dictation": [...],
      "minimalPairs": [...],
      "reducedSpeech": [...],
      "numbers": [...],
      "functionWords": [...]
    }`

export function buildEarTrainingSection(paragraphCount) {
  const n = earTrainingItemCount(paragraphCount)
  return `

Group D — Ear Training. These test recognizing what was actually SAID (not comprehension) — base every item on a word, number, or phrase that genuinely occurs in the transcript you write. Provide exactly ${n} items per subtype below (${QUESTIONS_PER_PARAGRAPH} per paragraph), each item referencing its "paragraphRef" (0-indexed):

### wordSpotting
Pick a real sentence from that paragraph (put it in "sentence"). Choose exactly 4 single words as "options": 2 words that literally appear in that sentence (put those 2 in "correctWords"), and 2 plausible distractors that do NOT appear in it (similar sound, similar topic, or same part of speech — never random unrelated words).
{ "id": "ws1", "paragraphRef": 0, "sentence": "...", "options": ["w1","w2","w3","w4"], "correctWords": ["w1","w3"] }

### cloze
Remove one word or short phrase from a real sentence in that paragraph. Mark the removed part with exactly five underscores ("_____") in "text" — never a bracketed label, since "text" is also read aloud as-is. Provide exactly 3 multiple-choice "options" (one of which equals "correct"). Put a short category label (key vocab / collocation / grammar / function word) in "hint".
{ "id": "cl1", "paragraphRef": 0, "text": "... _____ ...", "options": ["a","b","c"], "correct": "b", "hint": "key vocab" }

### dictation
A short segment taken verbatim from that paragraph, in "correctText" (must match the transcript text exactly) — never more than ONE sentence, so the listener can hold the whole thing in working memory. Tag "difficulty" as "word" (one word), "phrase" (a short clause, under ~6 words), or "sentence" (one full sentence, never two or more).
{ "id": "dc1", "paragraphRef": 0, "correctText": "...", "difficulty": "sentence" }

### minimalPairs
Take a real word from that paragraph and pair it with a similar-sounding word that does NOT appear in it (e.g. ship/sheep, live/leave, bad/bat, walk/work). "correct" is the word that actually appears; "options" has exactly those 2 words. "context" is the real sentence from the paragraph with that word replaced by "_____".
{ "id": "mp1", "paragraphRef": 0, "options": ["ship","sheep"], "correct": "ship", "context": "... _____ ..." }

### reducedSpeech
Find or naturally include a reduced spoken form in that paragraph (going to→gonna, want to→wanna, did you→didja, kind of→kinda, let me→lemme, got to→gotta, don't know→dunno, would you→woodja). "original" is the full form, "reduced" is the contracted form, "contextSentence" is the real sentence containing it, "type" is "reduction", "linking", or "elision".
{ "id": "rs1", "paragraphRef": 0, "original": "going to", "reduced": "gonna", "contextSentence": "...", "type": "reduction" }

### numbers
Take a real number, date, year, or percentage actually stated in that paragraph. "audioText" is the exact phrase as spoken (e.g. "fifteen" or "nineteen oh six"), "correct" is that same value, "distractors" has exactly 2 easily-confused values (e.g. 13 vs 30, 15 vs 50, 18 vs 80).
{ "id": "nm1", "paragraphRef": 0, "audioText": "fifteen", "correct": "15", "distractors": ["50","5"] }

### functionWords
Take a real sentence from that paragraph and blank out one small grammatical word (article, preposition, conjunction — the, of, to, for, at, has, have, been). Mark it with "_____" in "sentence". "missingWord" is the removed word, "options" has exactly 4 choices (the correct one plus 3 plausible alternatives).
{ "id": "fw1", "paragraphRef": 0, "sentence": "... _____ ...", "missingWord": "of", "options": ["of","for","to","at"] }`
}
