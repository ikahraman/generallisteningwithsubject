// Generic WAV parser (real RIFF chunk scan, not a fixed-offset assumption).
// Our own pcmToWavBlob() (api/gemini.js) always writes a plain 44-byte
// header, but Google Cloud Text-to-Speech's LINEAR16 output is also a WAV
// container and isn't guaranteed to lay out identically — so anything that
// needs to pull raw PCM back out of a WAV blob goes through this.
export function parseWav(arrayBuffer) {
  const view = new DataView(arrayBuffer)
  if (view.getUint32(0, false) !== 0x52494646) throw new Error('Not a RIFF/WAV file') // 'RIFF'

  let offset = 12 // skip 'RIFF' size 'WAVE'
  let sampleRate = 24000
  let dataOffset = -1
  let dataLength = 0

  while (offset < view.byteLength - 8) {
    const chunkId = view.getUint32(offset, false)
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 0x666d7420) {
      // 'fmt '
      sampleRate = view.getUint32(offset + 12, true)
    } else if (chunkId === 0x64617461) {
      // 'data'
      dataOffset = offset + 8
      dataLength = chunkSize
      break
    }
    offset += 8 + chunkSize + (chunkSize % 2) // chunks are word-aligned
  }

  if (dataOffset === -1) throw new Error('No data chunk found in WAV')
  return { pcmBytes: new Uint8Array(arrayBuffer, dataOffset, dataLength), sampleRate }
}

export async function wavBlobToPcm(wavBlob) {
  return parseWav(await wavBlob.arrayBuffer())
}
