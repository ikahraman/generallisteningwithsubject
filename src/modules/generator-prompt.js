import { openModal, closeModal } from '../components/modal.js'
import { MODES, GROUP_DESCRIPTIONS } from './material-modes.js'
import { buildEarTrainingSection, EAR_TRAINING_SCHEMA_SNIPPET } from './generator-prompt-eartraining.js'

const QUESTIONS_PER_PARAGRAPH = 3

// The exact text sent to the Gemini API for material generation. Kept
// separate from generator.js (which was already at the 400-line cap) so the
// "show/edit prompt" modal below can live next to the thing it edits.
export function buildGenerationPrompt(state) {
  const { topic, subtopic, category, level, mode, wordCount, paragraphCount } = state
  const modeConfig = MODES[mode]
  const perGroup = paragraphCount * QUESTIONS_PER_PARAGRAPH
  const total = perGroup * 3

  const structureNote =
    mode === 'search-reading'
      ? `- This must be exactly ${paragraphCount} SEPARATE short passages on related but distinct angles of the topic — NOT one continuous essay. Each entry in "paragraphs" below is one full short passage, not a paragraph within a single text.`
      : `- Paragraphs: exactly ${paragraphCount}, forming one continuous, coherent text`

  const fieldLine = category && category !== 'General' ? `\nField: ${category}` : ''

  const earTrainingSchema = modeConfig.hasAudio ? EAR_TRAINING_SCHEMA_SNIPPET : ''
  const earTrainingSection = modeConfig.hasAudio ? buildEarTrainingSection(paragraphCount) : ''

  return `You are an expert academic English content creator for Turkish university students preparing for English proficiency exams (BUEPT, IELTS, TOEFL).

Create ${modeConfig.promptPurpose}.
Topic: "${topic}"${subtopic ? ` (specifically: ${subtopic})` : ''}
Level: ${level} (CEFR)${fieldLine}

Requirements:
- Word count: approximately ${wordCount} total
${structureNote}
- Academic tone, suitable for health sciences/engineering/social sciences students
- Include field-specific vocabulary

Return ONLY a valid JSON object with this exact structure:
{
  "title": "...",
  "transcript": "full text with paragraphs separated by \\n\\n",
  "paragraphs": [
    { "text": "paragraph 1", "sentences": ["sentence 1", "sentence 2"] }
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
    "groupC": [...]${earTrainingSchema}
  },
  "shadowing": [
    { "id": "sh1", "text": "a single medium-length sentence taken verbatim from the transcript", "pronunciation": "IPA or simplified phonetic transcription of that whole sentence", "paragraphRef": 0 }
  ]
}

Question groups (${perGroup} questions per group, ${total} total — ${QUESTIONS_PER_PARAGRAPH} per paragraph per group):
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

STRICT RULE: these are OPEN-ENDED / fill-in questions — do NOT include "options" or "correctIndex" fields, and do NOT phrase the question text as a multiple-choice prompt (no "A) ... B) ..."). The student writes their own free-text answer; "correctAnswer" is the model answer shown later in an answer key, not a set of choices. Group C's fill-in-the-blank items should use "___" in the question text for the blank, with "correctAnswer" holding the missing word/phrase.

Provide 10-15 vocabulary items — each MUST have a pronunciation guide, a Turkish meaning, exactly one synonym, exactly one antonym, and exactly 2 English example sentences that use the word, each example ALSO carrying its own phonetic transcription of the whole sentence (not just the headword). Also provide 5-8 expressions, 3-5 grammar points, and exactly 10 shadowing sentences: real sentences taken verbatim from the transcript, medium length (roughly 8-15 words each — not a short fragment, not a run-on), spread across the paragraphs for variety, each with its "paragraphRef".

DO NOT include markdown code blocks. Return raw JSON only.`
}

/**
 * Shows the exact prompt that will be sent to Gemini and lets the user edit
 * it before generating. "Use This Prompt" locks in the edited text (verbatim)
 * as an override; "Reset to Default" clears the override so the prompt goes
 * back to being rebuilt live from the form fields.
 * @param {string} prompt - either the current override or a freshly built default
 * @param {{onApply: (text: string) => void, onReset: () => void}} handlers
 */
export function openPromptModal(prompt, { onApply, onReset }) {
  openModal({
    title: 'Gemini Prompt',
    bodyHTML: `
      <p class="card-hint" style="margin-bottom:10px;">
        This is exactly what will be sent to the Gemini API. Edit it directly if you want full control, or reset to the auto-generated version.
      </p>
      <textarea id="prompt-editor" rows="20" style="width:100%; font-family: ui-monospace, monospace; font-size:12.5px; line-height:1.5; resize:vertical;">${escapeHtml(prompt)}</textarea>
    `,
    actions: [
      {
        label: 'Reset to Default',
        variant: 'ghost',
        onClick: () => {
          onReset()
          closeModal()
        },
      },
      {
        label: 'Use This Prompt',
        variant: 'primary',
        onClick: () => {
          const text = document.getElementById('prompt-editor')?.value ?? prompt
          onApply(text)
          closeModal()
        },
      },
    ],
  })
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
