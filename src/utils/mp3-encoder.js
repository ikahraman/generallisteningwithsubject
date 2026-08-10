// Client-side PCM→MP3 encoding via lamejs, used only for the "take it with
// you" PDF+audio bundle export. Kept out of the main bundle (callers should
// dynamic-import this module) since the encoder adds real weight and most
// sessions never touch it — the in-app player and single-file download stay
// on WAV, which is lossless and needs no encoding step.
import { Mp3Encoder } from '@breezystack/lamejs'
import { wavBlobToPcm } from './wav.js'

const BLOCK_SIZE = 1152

export function pcmToMp3Blob(pcmBytes, sampleRate, { kbps = 128 } = {}) {
  const encoder = new Mp3Encoder(1, sampleRate, kbps)
  const samples = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, Math.floor(pcmBytes.length / 2))
  const chunks = []

  for (let i = 0; i < samples.length; i += BLOCK_SIZE) {
    const encoded = encoder.encodeBuffer(samples.subarray(i, i + BLOCK_SIZE))
    if (encoded.length > 0) chunks.push(encoded)
  }
  const tail = encoder.flush()
  if (tail.length > 0) chunks.push(tail)

  return new Blob(chunks, { type: 'audio/mp3' })
}

export async function wavBlobToMp3Blob(wavBlob, opts) {
  const { pcmBytes, sampleRate } = await wavBlobToPcm(wavBlob)
  return pcmToMp3Blob(pcmBytes, sampleRate, opts)
}
