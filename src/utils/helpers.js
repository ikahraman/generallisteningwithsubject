export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  downloadBlob(blob, filename)
}

export function formatDate(isoString) {
  if (!isoString) return '—'
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function timestampSlug() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
}

export function countWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
}

export function estimateDuration(wordCount, wordsPerMinute = 140) {
  return Math.round((wordCount / wordsPerMinute) * 60)
}

export function splitSentences(text) {
  return String(text || '')
    .replace(/([.?!])\s+(?=[A-Z"'“])/g, '$1|')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// speechSynthesis.getVoices() order is inconsistent across browsers/OS/voice
// packs — blindly falling back to voices[0] means the "browser voice" is a
// good one some days and a robotic low-quality one on others. This picks
// deliberately: an English voice, and among those, one whose name suggests
// it's a modern/neural voice (how Edge/Chrome label their better ones).
const VOICE_QUALITY_HINTS = ['natural', 'online', 'neural', 'premium', 'enhanced']

export function pickBestVoice(voices) {
  if (!voices?.length) return null
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  const pool = english.length ? english : voices
  const quality = pool.find((v) => VOICE_QUALITY_HINTS.some((hint) => v.name.toLowerCase().includes(hint)))
  return quality || pool[0]
}
