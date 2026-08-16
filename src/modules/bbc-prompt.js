// The Gemini prompt for BBC Content: unlike Generator's buildGenerationPrompt
// (which asks Gemini to WRITE a new passage from a topic), this asks it to
// ANALYZE a real, already-fetched BBC transcript and build the same study
// materials (vocab/grammar/questions/shadowing/summary/Ear Training) around
// it verbatim — the transcript itself must not be rewritten. Produces the
// same JSON shape as the main schema, so it goes through the same
// validateMaterialJSON() unchanged.
import { GROUP_DESCRIPTIONS } from './material-modes.js'
import { buildEarTrainingSection, EAR_TRAINING_SCHEMA_SNIPPET } from './generator-prompt-eartraining.js'
import { countWords } from '../utils/helpers.js'

const QUESTIONS_PER_PARAGRAPH = 3
// BBC transcripts are dialogue (short back-and-forth turns), not prose —
// there's no natural "paragraph" in the source, so this estimates a
// reasonable chunk count from length alone (roughly matching the ~200-250
// words/paragraph the app's own generated materials average) purely to
// size the question/Ear Training counts; Gemini decides the actual grouping.
function estimateParagraphCount(wordCount) {
  return Math.max(2, Math.min(6, Math.round(wordCount / 220)))
}

export function buildBbcAnalysisPrompt({ title, transcript, sourceUrl, level }) {
  const paragraphCount = estimateParagraphCount(countWords(transcript))
  const perGroup = paragraphCount * QUESTIONS_PER_PARAGRAPH
  const total = perGroup * 3
  const earTrainingSection = buildEarTrainingSection(paragraphCount)

  return `You are an expert academic English content creator for Turkish university students preparing for English proficiency exams (BUEPT, IELTS, TOEFL).

You are given a REAL transcript from a BBC Learning English episode (source: ${sourceUrl}). Do NOT rewrite, paraphrase, shorten, or invent any part of the dialogue — copy it into "transcript"/"paragraphs" exactly as given, fixing only obvious PDF-extraction artifacts (stray spacing, a misplaced character) without changing any actual words or meaning. Your job is to analyze this real transcript and build supporting study materials around it, the same way you would for a passage you wrote yourself.

Do NOT paraphrase or summarize any individual sentence anywhere in "transcript" or "paragraphs" — every paragraph's "text" must be an exact, verbatim slice of the real transcript, just regrouped into ${paragraphCount} chunks.

Episode title: "${title}"
Target level: ${level} (CEFR) — pitch vocabulary/grammar explanations at this level even though the transcript's own difficulty is fixed.

Transcript:
"""
${transcript}
"""

Return ONLY a valid JSON object with this exact structure:
{
  "title": "a clean, short title for this material (reuse or lightly tidy the episode title)",
  "transcript": "the transcript above, verbatim, split into paragraphs separated by \\n\\n — group consecutive speaker turns into roughly ${paragraphCount} paragraphs by topic/scene shift, not one paragraph per turn",
  "summary": "a concise ~10-sentence summary of the transcript's key points, written as flowing natural prose (not a bullet list) — short enough to double as model material for speaking (read-aloud/shadowing) or writing practice on this topic",
  "paragraphs": [
    { "text": "paragraph 1 — an exact, verbatim slice of the transcript above, not a paraphrase or summary" }
  ],
  "vocabulary": [
    { "word": "...", "pronunciation": "IPA or simplified phonetic, e.g. /rɪˈzɪliəns/", "meaningTR": "Turkish meaning", "synonym": "...", "antonym": "...", "examples": [{ "text": "English example sentence 1 using the word", "pronunciation": "IPA or simplified phonetic transcription of that whole sentence" }, { "text": "English example sentence 2 using the word", "pronunciation": "IPA or simplified phonetic transcription of that whole sentence" }] }
  ],
  "expressions": [
    { "expression": "...", "meaning": "...", "example": "..." }
  ],
  "grammar": [
    { "point": "...", "explanation": "...", "examples": ["..."] }
  ],
  "questions": {
    "groupA": [...],
    "groupB": [...],
    "groupC": [...]${EAR_TRAINING_SCHEMA_SNIPPET}
  },
  "shadowing": [
    { "id": "sh1", "text": "a single medium-length sentence taken verbatim from the transcript", "pronunciation": "IPA or simplified phonetic transcription of that whole sentence", "paragraphRef": 0 }
  ]
}

Question groups (${perGroup} questions per group, ${total} total — roughly ${QUESTIONS_PER_PARAGRAPH} per paragraph per group):
- Group A (${GROUP_DESCRIPTIONS.groupA})
- Group B (${GROUP_DESCRIPTIONS.groupB})
- Group C (${GROUP_DESCRIPTIONS.groupC})${earTrainingSection}

Question format for each item in groupA/groupB/groupC:
{
  "id": "q1",
  "text": "question text",
  "correctAnswer": "the expected answer, as a short phrase or sentence a student would write",
  "paragraphRef": 0
}

STRICT RULE: paragraph objects must have ONLY a "text" field — do not add a "sentences" field or any other field to them; sentence-splitting is done automatically afterward, from your verbatim "text", so anything you add there would be discarded or would risk overriding the real transcript with a paraphrase.

STRICT RULE: these are OPEN-ENDED / fill-in questions — do NOT include "options" or "correctIndex" fields, and do NOT phrase the question text as a multiple-choice prompt (no "A) ... B) ..."). The student writes their own free-text answer; "correctAnswer" is the model answer shown later in an answer key, not a set of choices. Group C's fill-in-the-blank items should use "___" in the question text for the blank, with "correctAnswer" holding the missing word/phrase.

Provide 10-15 vocabulary items — each MUST have a pronunciation guide, a Turkish meaning, exactly one synonym, exactly one antonym, and exactly 2 English example sentences that use the word, each example ALSO carrying its own phonetic transcription of the whole sentence (not just the headword). Only pick words that actually appear in the transcript. Also provide 5-8 expressions, 3-5 grammar points illustrated by real sentences from the transcript, and exactly 10 shadowing sentences: real sentences taken verbatim from the transcript, medium length (roughly 8-15 words each — not a short fragment, not a run-on), spread across the paragraphs for variety, each with its "paragraphRef".

The "summary" field must be EXACTLY 10 sentences — condensing the whole transcript's main ideas into a short, coherent, standalone paragraph a student could read aloud for pronunciation/fluency practice or use as a model when writing their own summary. Not copied verbatim from the transcript — genuinely condensed and rephrased.

CRITICAL OUTPUT RULES — this JSON is parsed programmatically with no human review, so it must be perfect on the first try:
- Output ONLY the raw JSON object and nothing else. No markdown code fences (no \`\`\`json or \`\`\`), no preamble like "Here is the JSON:", no explanation or notes before or after it. Your entire response must start with { and end with }.
- Valid JSON syntax only: double-quoted keys and string values (never single quotes or unquoted keys), no trailing commas after the last item in any array or object, no comments, every brace and bracket properly matched and closed.
- Every double-quote, newline, or backslash that appears INSIDE a string value (e.g. inside "transcript", a question's "text", a quoted phrase) must be escaped correctly (\\", \\n, \\\\) — this is the single most common cause of broken JSON in long text fields, so pay special attention to it.
- Before you finalize your answer, mentally re-parse the entire JSON structure from top to bottom and verify: every string is correctly escaped, every array/object is properly closed, there are no stray or trailing commas, and no duplicate keys. If you find an issue, fix it before responding — do not output a first draft that still has errors.`
}
