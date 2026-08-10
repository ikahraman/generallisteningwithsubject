// Thin client for Google Cloud Text-to-Speech (a separate product from the
// Gemini API — mature/production-grade, not a preview model, with a large
// free tier). Used as the primary audio engine; api/gemini.js's TTS stays
// as an automatic fallback if this fails. Same API-key auth pattern as
// Gemini, but a different endpoint/host and its own voice catalog.
import { parseWav } from '../utils/wav.js'

const ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const SAMPLE_RATE = 24000

export const CLOUD_TTS_VOICES = [
  'en-US-Neural2-C', // female
  'en-US-Neural2-D', // male
  'en-US-Neural2-F', // female
  'en-US-Neural2-A', // male
  'en-US-Wavenet-C', // female
  'en-US-Wavenet-D', // male
]

// Google's own API, so far less likely to stall than Edge's unofficial one
// — but a hard timeout still matters, since a hang here would block the
// same fallback chain just as badly. See edge-tts.js for the fuller story.
const TIMEOUT_MS = 30000

export async function synthesizeSpeech(apiKey, text, voiceName = CLOUD_TTS_VOICES[0], speakingRate = 1) {
  let res
  try {
    res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: 'en-US', name: voiceName },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: SAMPLE_RATE, speakingRate },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(`Cloud TTS timed out after ${TIMEOUT_MS / 1000}s.`)
    throw err
  }
  if (!res.ok) throw new Error(await extractError(res))

  const { audioContent } = await res.json()
  if (!audioContent) throw new Error('Cloud TTS returned no audio.')

  const wavBytes = base64ToBytes(audioContent)
  return parseWav(wavBytes.buffer)
}

async function extractError(res) {
  try {
    const body = await res.json()
    return body?.error?.message || `Cloud TTS error (HTTP ${res.status}).`
  } catch {
    return `Cloud TTS error (HTTP ${res.status}).`
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
