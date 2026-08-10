// Worksheet PDF (+ optional audio bundle) export modal and flow, split out
// of workspace.js to stay under the 400-line-per-file rule.
import { getAudioBlob } from '../db.js'
import { generateAndCacheAudioWithEngine, DEFAULT_VOICES } from '../api/tts.js'
import { openModal } from '../components/modal.js'
import { buildZip } from '../utils/zip-handler.js'
import { downloadBlob, slugify } from '../utils/helpers.js'
import { hasAudioMode } from './material-modes.js'

const ENGINE_LABELS = { cloud: 'Google Cloud TTS', edge: 'Edge TTS', gemini: 'Gemini TTS' }

export async function promptExportPdf(material) {
  const hasAudioOption = hasAudioMode(material.mode)
  const cached = hasAudioOption ? await getAudioBlob(material.id) : null
  const audioHint = cached?.blob
    ? `Bundles the already-cached ${ENGINE_LABELS[cached.engine] || cached.engine} audio as .mp3 — no new API call.`
    : 'No cached audio yet — generates one via Edge TTS (free, no Google TTS quota used) and caches it for next time.'

  openModal({
    title: 'Export Worksheet PDF',
    bodyHTML: `
      <label class="row" style="cursor:pointer;">
        <span>Include Teacher's Answer Key as the last page</span>
        <span class="switch">
          <input type="checkbox" id="pdf-answer-key" />
          <span class="switch-track"></span>
        </span>
      </label>
      ${
        hasAudioOption
          ? `<label class="row" style="cursor:pointer; margin-top:12px;">
              <span>Also bundle audio (as a .zip)</span>
              <span class="switch">
                <input type="checkbox" id="pdf-with-audio" />
                <span class="switch-track"></span>
              </span>
            </label>
            <p class="card-hint" style="margin-top:8px;">${audioHint}</p>`
          : ''
      }
    `,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Generate',
        variant: 'primary',
        onClick: async () => {
          const includeAnswerKey = document.getElementById('pdf-answer-key').checked
          const withAudio = hasAudioOption && document.getElementById('pdf-with-audio').checked
          await exportWorksheet(material, { includeAnswerKey, withAudio })
        },
      },
    ],
  })
}

async function exportWorksheet(material, { includeAnswerKey, withAudio }) {
  const slug = slugify(material.title)
  const { generateWorksheetPDF } = await import('../utils/pdf-export.js')
  const pdfBlob = await generateWorksheetPDF(material, { includeAnswerKey })

  if (!withAudio) {
    downloadBlob(pdfBlob, `${slug}-worksheet.pdf`)
    return
  }

  // Reuses whatever's already cached for this material (from generation
  // time, any engine) instead of calling an AI TTS provider again here. If
  // nothing is cached yet, generates once via Edge TTS — free, no Google
  // quota — and caches the result so future exports/playback reuse it too.
  // Cloud TTS is never called from this flow.
  let cached = await getAudioBlob(material.id)
  let engine = cached?.engine

  if (!cached?.blob) {
    try {
      const blob = await generateAndCacheAudioWithEngine(material.id, material.paragraphs, null, DEFAULT_VOICES, 'edge')
      cached = { blob }
      engine = 'edge'
    } catch (err) {
      downloadBlob(pdfBlob, `${slug}-worksheet.pdf`)
      openModal({
        title: 'Audio Not Bundled',
        bodyHTML: `<p>Edge TTS is unavailable (${escapeHtml(err.message || 'request failed')}), so the PDF was downloaded without audio. Generate audio for this material first (Cloud or Edge), then export again to bundle it.</p>`,
        actions: [{ label: 'Close' }],
      })
      return
    }
  }

  const { wavBlobToMp3Blob } = await import('../utils/mp3-encoder.js')
  const mp3Blob = await wavBlobToMp3Blob(cached.blob)

  const files = [
    { name: `${slug}-worksheet.pdf`, data: new Uint8Array(await pdfBlob.arrayBuffer()) },
    { name: `${slug}-${engine}-tts.mp3`, data: new Uint8Array(await mp3Blob.arrayBuffer()) },
  ]
  downloadBlob(buildZip(files), `${slug}-bundle.zip`)
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
