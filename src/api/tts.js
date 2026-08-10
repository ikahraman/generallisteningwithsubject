import { generateSpeechPCM, pcmToWavBlob, GEMINI_TTS_VOICES } from './gemini.js'
import { synthesizeSpeech as synthesizeCloudSpeech, CLOUD_TTS_VOICES } from './cloud-tts.js'
import { synthesizeSpeech as synthesizeEdgeSpeech, EDGE_TTS_VOICES } from './edge-tts.js'
import { saveAudioBlob } from '../db.js'

const SAMPLE_RATE = 24000

export const DEFAULT_VOICES = {
  cloudVoice: CLOUD_TTS_VOICES[0],
  edgeVoice: EDGE_TTS_VOICES[0],
  geminiVoice: GEMINI_TTS_VOICES[0],
  speed: 'normal',
}

// Maps the Generator's Slow/Normal/Fast choice to each engine's own rate
// format — Cloud TTS wants a 0.25–4.0 multiplier, Edge TTS wants a signed
// percentage string. Gemini TTS has no rate control in this API, so it
// always renders at normal speed (acceptable: it's only a silent fallback).
const SPEED_PRESETS = {
  slow: { cloud: 0.85, edge: '-15%' },
  normal: { cloud: 1, edge: '+0%' },
  fast: { cloud: 1.15, edge: '+15%' },
}

function synthesizers(apiKey, voices) {
  const preset = SPEED_PRESETS[voices.speed] || SPEED_PRESETS.normal
  return {
    cloud: (text) => synthesizeCloudSpeech(apiKey, text, voices.cloudVoice, preset.cloud),
    edge: (text) => synthesizeEdgeSpeech(text, voices.edgeVoice, preset.edge),
    gemini: (text) => generateSpeechPCM(apiKey, text, voices.geminiVoice),
  }
}

// Synthesizes every paragraph with one fixed engine and concatenates the
// result into a single WAV blob. If the engine fails partway through, the
// whole thing throws — callers that want a fallback retry the *entire*
// material with a different engine (see generateAndCacheAudio) rather than
// stitching partial results together, so a material never ends up with
// paragraphs in two different voices.
async function synthesizeParagraphs(engine, paragraphs, apiKey, voices, onProgress) {
  const synth = synthesizers(apiKey, voices)[engine]
  const silenceGap = new Uint8Array(Math.round(SAMPLE_RATE * 2 * 0.35)) // ~350ms of 16-bit mono silence
  const chunks = []

  for (let i = 0; i < paragraphs.length; i++) {
    onProgress?.(engine, i + 1, paragraphs.length)
    const result = await synth(paragraphs[i].text)
    chunks.push(result.pcmBytes, silenceGap)
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  return pcmToWavBlob(combined, SAMPLE_RATE)
}

// Generates the material's cached study audio using the user's preferred
// engine ('cloud' or 'edge', chosen in Settings/Generator), with Gemini TTS
// as a silent last-resort safety net if the preferred engine fails
// entirely — it's never offered as a user-facing choice, just a backstop
// so generation doesn't hard-fail on a transient outage. The engine that
// actually succeeded is tagged onto the cached blob so Workspace can show
// "generated with Cloud/Edge/Gemini TTS" and offer to upgrade it later.
export async function generateAndCacheAudio(materialId, paragraphs, apiKey, voices = DEFAULT_VOICES, onProgress, kind) {
  const order = [voices.preferredEngine || 'cloud', 'gemini']
  let blob
  let usedEngine
  let lastErr
  for (const engine of order) {
    try {
      blob = await synthesizeParagraphs(engine, paragraphs, apiKey, voices, onProgress)
      usedEngine = engine
      break
    } catch (err) {
      lastErr = err
    }
  }
  if (!blob) throw lastErr

  await saveAudioBlob(materialId, blob, usedEngine, kind)
  return blob
}

// Generates with exactly one engine — no Gemini fallback. Used when the
// user explicitly picks an engine (rather than trusting the Settings
// default), so a failure surfaces as a real, actionable error instead of
// silently being replaced by whatever the fallback produced.
export async function generateAndCacheAudioWithEngine(materialId, paragraphs, apiKey, voices, engine, onProgress, kind) {
  const blob = await synthesizeParagraphs(engine, paragraphs, apiKey, voices, onProgress)
  await saveAudioBlob(materialId, blob, engine, kind)
  return blob
}
