// Pure helpers shared by the Ear Training exercise types. Ported from a
// reference React implementation (BBC_6_min_eng) — same algorithms, no
// framework dependency.

export const SPEECH_RATE_OPTIONS = [0.8, 0.85, 0.9, 0.95, 1.0, 1.1, 1.25]

const SPEED_STORAGE_KEY = 'et-speech-rate'
let currentSpeed = Number(localStorage.getItem(SPEED_STORAGE_KEY)) || 1

// Ear Training has its own playback speed, independent of the main audio
// player's — lives here (a shared leaf module) rather than in either
// workspace-ear-training*.js file, so both can read/write it without a
// circular import between them.
export function getEtSpeed() {
  return currentSpeed
}
export function setEtSpeed(rate) {
  currentSpeed = rate
  localStorage.setItem(SPEED_STORAGE_KEY, String(rate))
}

/** Returns a shuffled copy. AI providers tend to list the correct answer
 * first (or in a consistent position), which makes it guessable by position
 * alone unless the order is randomized ourselves. */
export function shuffle(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** Whole-word, case-insensitive check for whether `word` appears in `text`. */
export function wordAppearsIn(text, word) {
  const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
}

const BLANK_MARKER = /_{3,}|\[[A-Z_]+\]/

/** Fills a cloze-style blank in text meant for text-to-speech playback. AI
 * providers don't always follow the "_____" convention exactly (some emit
 * bracketed labels like "[KEY_VOCAB]" instead), so this matches both. */
export function fillBlank(text, replacement) {
  return BLANK_MARKER.test(text) ? text.replace(BLANK_MARKER, replacement) : text
}

export function normalizeWord(word) {
  return String(word).toLowerCase().replace(/[^a-z0-9']/g, '')
}

/**
 * Word-by-word comparison of a target sentence against a typed attempt,
 * aligned with edit distance rather than compared by raw position. A single
 * dropped/added word would otherwise shift everything after it out of
 * position and mark an otherwise-correct attempt as wrong.
 * @returns {{word: string, correct: boolean}[]} one entry per target word
 */
export function compareWords(target, attempt) {
  const targetWords = String(target ?? '').split(/\s+/).filter(Boolean)
  const attemptWords = String(attempt ?? '').trim().split(/\s+/).filter(Boolean)
  const n = targetWords.length
  const m = attemptWords.length
  const matches = (i, j) => normalizeWord(targetWords[i]) === normalizeWord(attemptWords[j])

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) dp[i][0] = i
  for (let j = 0; j <= m; j++) dp[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (matches(i - 1, j - 1) ? 0 : 1))
    }
  }

  const result = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (matches(i - 1, j - 1) ? 0 : 1)) {
      result.unshift({ word: targetWords[i - 1], correct: matches(i - 1, j - 1) })
      i--
      j--
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      result.unshift({ word: targetWords[i - 1], correct: false })
      i--
    } else {
      j--
    }
  }
  return result
}
