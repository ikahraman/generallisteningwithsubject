// Client for the local edge-tts companion server (see server/). Browsers
// can't call Microsoft's TTS backend directly (it requires a WebSocket
// header the WebSocket API won't let a webpage set), so this is a thin
// HTTP wrapper around a Node process running edge-tts-universal instead.
// If that server isn't running, fetch() fails fast (connection refused)
// and the caller's engine-fallback chain moves on to the next tier.
const SERVER_URL = 'http://localhost:5175'
const TARGET_SAMPLE_RATE = 24000 // match Cloud TTS / Gemini TTS so paragraphs concatenate cleanly

export const EDGE_TTS_VOICES = [
  'en-US-AndrewNeural',
  'en-US-GuyNeural',
  'en-US-AriaNeural',
  'en-US-JennyNeural',
  'en-GB-SoniaNeural',
]

export async function synthesizeSpeech(text, voiceName = EDGE_TTS_VOICES[0], rate = '+0%') {
  let res
  try {
    res = await fetch(`${SERVER_URL}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voiceName, rate }),
    })
  } catch {
    throw new Error('Edge TTS server is not reachable — is it running? (npm start inside server/)')
  }
  if (!res.ok) throw new Error(await extractError(res))

  const mp3ArrayBuffer = await res.arrayBuffer()
  return decodeMp3ToPcm(mp3ArrayBuffer)
}

async function extractError(res) {
  try {
    const body = await res.json()
    return body?.error || `Edge TTS server error (HTTP ${res.status}).`
  } catch {
    return `Edge TTS server error (HTTP ${res.status}).`
  }
}

// Decodes into an OfflineAudioContext pinned to TARGET_SAMPLE_RATE — a plain
// AudioContext resamples to the system/hardware default instead, which
// would silently mismatch the fixed 24kHz the rest of the pipeline assumes.
async function decodeMp3ToPcm(mp3ArrayBuffer) {
  const audioCtx = new OfflineAudioContext(1, 1, TARGET_SAMPLE_RATE)
  const decoded = await audioCtx.decodeAudioData(mp3ArrayBuffer)
  const pcmBytes = float32ToInt16Bytes(decoded.getChannelData(0))
  return { pcmBytes, sampleRate: decoded.sampleRate }
}

function float32ToInt16Bytes(float32) {
  const buffer = new ArrayBuffer(float32.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buffer)
}
