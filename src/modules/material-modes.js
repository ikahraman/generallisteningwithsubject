// Single source of truth for the 4 material types (BUEPT-style), shared by
// Generator, Workspace, Library, Dashboard, PDF export, and Statistics —
// previously each of those files duplicated its own mode-label map and its
// own "is this a listening mode" string check.
export const MODES = {
  selective: {
    label: 'Selective Listening',
    defaultWords: 700,
    defaultParagraphs: 3,
    hasAudio: true,
    kind: 'listening',
    promptPurpose:
      'a SELECTIVE LISTENING passage: the listener follows along for overall meaning and key details on a single pass, not word-for-word transcription',
  },
  careful: {
    label: 'Careful Listening',
    defaultWords: 1100,
    defaultParagraphs: 4,
    hasAudio: true,
    kind: 'listening',
    promptPurpose:
      'a CAREFUL LISTENING passage: denser academic content that rewards close, attentive listening to specific details, not just the gist',
  },
  'search-reading': {
    label: 'Search Reading',
    defaultWords: 400,
    defaultParagraphs: 2,
    hasAudio: false,
    kind: 'reading',
    promptPurpose:
      'material for SEARCH READING practice: TWO short, related but distinct reading passages that a student scans quickly to locate specific information, not deep analysis',
  },
  'careful-reading': {
    label: 'Careful Reading',
    defaultWords: 650,
    defaultParagraphs: 3,
    hasAudio: false,
    kind: 'reading',
    promptPurpose:
      'a CAREFUL READING passage: one longer, analytical academic text with abstract or complex ideas that rewards slow, careful reading',
  },
}

export const MODE_LABELS = Object.fromEntries(Object.entries(MODES).map(([id, m]) => [id, m.label]))

// Question-group semantics are now the same across all 4 modes (previously
// they varied per mode, which made cross-material accuracy stats mix
// unrelated skills under the same "Group A/B/C" label).
export const GROUP_DESCRIPTIONS = {
  groupA: 'General Meaning — the overall gist / main idea of each paragraph',
  groupB: 'Specific Details — who, what, where, when, why (5W1H) stated in each paragraph',
  groupC: 'Word-Level — fill-in-the-blank items and catching specific phrases/expressions/collocations from each paragraph',
}

// The base 3 groups every mode gets. Ear Training (groupD) is separate —
// it only makes sense for audio modes, so it's added conditionally via
// EAR_TRAINING_GROUP rather than living in this list.
export const QUESTION_GROUPS = ['groupA', 'groupB', 'groupC']

export const GROUP_LABELS = { groupA: 'Group A', groupB: 'Group B', groupC: 'Group C', groupD: 'Ear Training' }

// Ear Training (groupD) is audio-only — it tests recognizing what was
// actually said (a specific word, a number, a reduced form like "gonna"),
// which has no equivalent for a silent reading passage. Unlike groupA/B/C,
// it's not a flat question list: each subtype below has its own item shape
// and its own interaction (checkbox multi-select, multiple choice, or typed
// dictation) — see workspace-ear-training*.js.
export const EAR_TRAINING_GROUP = 'groupD'
export const EAR_TRAINING_SUBTYPES = [
  { key: 'wordSpotting', label: 'Word Spotting' },
  { key: 'cloze', label: 'Cloze' },
  { key: 'dictation', label: 'Dictation' },
  { key: 'minimalPairs', label: 'Minimal Pairs' },
  { key: 'reducedSpeech', label: 'Reduced Speech' },
  { key: 'numbers', label: 'Numbers' },
  { key: 'functionWords', label: 'Function Words' },
]

export function hasAudioMode(mode) {
  return !!MODES[mode]?.hasAudio
}
