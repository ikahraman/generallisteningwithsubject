// Thin client for the Gemini API. The user's own key is passed in per-call —
// it is never read from source, only from the IndexedDB settings table.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// gemini-2.5-flash was retired for new API users (Gemini 2.5 line shuts down
// entirely Oct 2026) — moved to the current GA/preview models as of mid-2026.
const TEXT_MODEL = 'gemini-3.6-flash'
const TTS_MODEL = 'gemini-3.1-flash-tts-preview'

export const GEMINI_TTS_VOICES = [
  'Zephyr',
  'Puck',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
]

export async function generateMaterialJSON(apiKey, prompt) {
  const res = await fetch(`${API_BASE}/${TEXT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      // maxOutputTokens set explicitly and generously: open-ended questions
      // (full-sentence correctAnswer values, not short options) plus a full
      // transcript/vocabulary/grammar payload, plus Ear Training's 7 subtypes
      // (3 items per paragraph each) can add up to a lot of JSON — without
      // this, some responses were getting cut off mid-object, producing
      // "not valid JSON" errors from truncation, not bad output.
      generationConfig: { responseMimeType: 'application/json', temperature: 0.9, maxOutputTokens: 32768 },
    }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json()
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.map((p) => p.text).join('') ?? ''
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('The AI response was cut off (too long for the token limit). Try fewer paragraphs/words, or generate again.')
  }
  if (!text) {
    const reason = candidate?.finishReason ? ` (reason: ${candidate.finishReason})` : ''
    throw new Error(`Gemini returned an empty response${reason}.`)
  }
  return text
}

export async function generateSpeechPCM(apiKey, text, voiceName = 'Kore') {
  const res = await fetch(`${API_BASE}/${TTS_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  })
  if (!res.ok) throw new Error(await extractError(res))
  const data = await res.json()
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!part) throw new Error('Gemini TTS returned no audio.')
  const sampleRate = Number(part.inlineData.mimeType?.match(/rate=(\d+)/)?.[1] || 24000)
  return { pcmBytes: base64ToBytes(part.inlineData.data), sampleRate }
}

export async function generateSpeech(apiKey, text, voiceName = 'Kore') {
  const { pcmBytes, sampleRate } = await generateSpeechPCM(apiKey, text, voiceName)
  return pcmToWavBlob(pcmBytes, sampleRate)
}

async function extractError(res) {
  try {
    const body = await res.json()
    return body?.error?.message || `Gemini API error (HTTP ${res.status}).`
  } catch {
    return `Gemini API error (HTTP ${res.status}).`
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Wraps raw 16-bit little-endian mono PCM into a playable WAV Blob.
export function pcmToWavBlob(pcmBytes, sampleRate) {
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = (numChannels * bitsPerSample) / 8
  const byteRate = sampleRate * blockAlign
  const buffer = new ArrayBuffer(44 + pcmBytes.length)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes.length, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(view, 36, 'data')
  view.setUint32(40, pcmBytes.length, true)
  new Uint8Array(buffer, 44).set(pcmBytes)

  return new Blob([buffer], { type: 'audio/wav' })
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}
