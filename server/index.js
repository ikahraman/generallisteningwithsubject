// Local companion server for Microsoft Edge's neural TTS.
//
// Why this exists at all: Edge's TTS backend (speech.platform.bing.com)
// requires a WebSocket header the browser WebSocket API refuses to let a
// webpage set, so no purely client-side PWA can call it directly — only
// Node/Deno/Bun-style environments can. This tiny server is that
// environment; the browser app talks to it over plain HTTP on localhost.
//
// Unofficial/reverse-engineered API, not for commercial use — fine for a
// personal study tool. Run with: npm start (inside this server/ folder).
import express from 'express'
import cors from 'cors'
import { Communicate } from 'edge-tts-universal'
import * as store from './store.js'
import * as bbc from './bbc.js'

const PORT = process.env.PORT || 5175

const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))

// Replaces nginx Basic Auth (removed — the browser's HTTP auth cache turned
// out to not reliably carry over to same-origin fetch() calls, so the app
// could "load" while every /api request silently failed). Client stores
// this in localStorage after a one-time prompt(), so it survives far more
// reliably than a browser's Basic Auth cache does, especially on mobile.
// Unset (local dev) = auth disabled entirely, so `npm start` still needs
// zero config.
const API_TOKEN = process.env.API_TOKEN || ''
function requireToken(req, res, next) {
  if (!API_TOKEN || req.get('X-Api-Token') === API_TOKEN) return next()
  res.status(401).json({ error: 'Invalid or missing API token.' })
}

// ---------- library data API ----------
// Backs src/db.js: the browser used to keep all of this in IndexedDB, but
// that meant a phone and a desktop hitting the same app saw two different
// libraries. This makes the server the single source of truth instead.

app.use('/api', requireToken)
app.use('/synthesize', requireToken)

const asyncRoute = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  console.error('[api]', err)
  res.status(500).json({ error: err.message || 'Internal error.' })
})
const idParam = (req) => Number(req.params.id)

app.get('/api/materials', asyncRoute(async (req, res) => {
  res.json(await store.getAllMaterials())
}))
app.post('/api/materials', asyncRoute(async (req, res) => {
  res.json({ id: await store.addMaterial(req.body) })
}))
app.get('/api/materials/:id', asyncRoute(async (req, res) => {
  const material = await store.getMaterial(idParam(req))
  if (!material) return res.status(404).json({ error: 'Not found.' })
  res.json(material)
}))
app.patch('/api/materials/:id', asyncRoute(async (req, res) => {
  await store.updateMaterial(idParam(req), req.body)
  res.json({ ok: true })
}))
app.delete('/api/materials/:id', asyncRoute(async (req, res) => {
  await store.deleteMaterial(idParam(req))
  res.json({ ok: true })
}))
app.post('/api/materials/:id/studied', asyncRoute(async (req, res) => {
  await store.recordMaterialStudied(idParam(req))
  res.json({ ok: true })
}))
app.patch('/api/materials/:id/favorite', asyncRoute(async (req, res) => {
  await store.toggleFavorite(idParam(req), !!req.body.isFavorite)
  res.json({ ok: true })
}))

app.get('/api/folders', asyncRoute(async (req, res) => res.json(await store.getAllFolders())))
app.post('/api/folders', asyncRoute(async (req, res) => {
  res.json({ id: await store.addFolder(req.body.name, req.body.parentId ?? null) })
}))
app.patch('/api/folders/:id', asyncRoute(async (req, res) => {
  await store.renameFolder(idParam(req), req.body.name)
  res.json({ ok: true })
}))
app.delete('/api/folders/:id', asyncRoute(async (req, res) => {
  await store.deleteFolder(idParam(req))
  res.json({ ok: true })
}))

app.get('/api/tags', asyncRoute(async (req, res) => res.json(await store.getAllTags())))
app.post('/api/tags', asyncRoute(async (req, res) => {
  res.json({ id: await store.addTag(req.body.name, req.body.color) })
}))
app.delete('/api/tags/:id', asyncRoute(async (req, res) => {
  await store.deleteTag(idParam(req))
  res.json({ ok: true })
}))

// Lightweight — metadata for every cached track (kind/engine/createdAt),
// no binary. Lets the client decide what to show/switch between before
// downloading any actual audio.
app.get('/api/audio-meta/:materialId', asyncRoute(async (req, res) => {
  res.json(await store.getAudioTracks(Number(req.params.materialId)))
}))

// :kind distinguishes a material's main listening-passage audio (omitted)
// from other narrations for the same material, e.g. 'vocab-lesson'.
app.get('/api/audio/:materialId/:kind?', asyncRoute(async (req, res) => {
  const row = await store.getAudioBlob(Number(req.params.materialId), req.params.kind)
  if (!row) return res.status(404).json({ error: 'Not found.' })
  res.setHeader('X-Audio-Engine', row.engine || '')
  res.setHeader('X-Audio-Created-At', row.createdAt || '')
  res.setHeader('Content-Type', 'application/octet-stream')
  res.send(row.buffer)
}))
app.put('/api/audio/:materialId/:kind?', express.raw({ type: '*/*', limit: '50mb' }), asyncRoute(async (req, res) => {
  await store.saveAudioBlob(Number(req.params.materialId), req.body, req.query.engine || null, req.params.kind)
  res.json({ ok: true })
}))
app.delete('/api/audio/:materialId/:kind?', asyncRoute(async (req, res) => {
  await store.deleteAudioBlob(Number(req.params.materialId), req.params.kind)
  res.json({ ok: true })
}))

app.get('/api/settings', asyncRoute(async (req, res) => res.json(await store.getAllSettings())))
app.put('/api/settings/:key', asyncRoute(async (req, res) => {
  await store.setSetting(req.params.key, req.body.value)
  res.json({ ok: true })
}))

app.get('/api/study-log', asyncRoute(async (req, res) => res.json(await store.getAllStudyLog())))
app.get('/api/study-log/:materialId', asyncRoute(async (req, res) => {
  res.json(await store.getStudyLogForMaterial(Number(req.params.materialId)))
}))
app.post('/api/study-log', asyncRoute(async (req, res) => {
  res.json({ id: await store.addStudyLogEntry(req.body) })
}))

app.get('/api/export', asyncRoute(async (req, res) => res.json(await store.exportAllData())))
app.post('/api/import', asyncRoute(async (req, res) => {
  await store.importBulk(req.body)
  res.json({ ok: true })
}))
app.post('/api/clear', asyncRoute(async (req, res) => {
  await store.clearAllData()
  res.json({ ok: true })
}))

// ---------- BBC Content import ----------
// Runs entirely server-side (see bbc.js) — no CORS issue talking to BBC
// directly from Node. Two steps: fetch metadata + extract the transcript
// (fast-ish, text only) first so the client can preview it before spending
// an AI call on it; downloading the (multi-MB) audio is a separate step,
// triggered only once a material actually exists to attach it to.

app.post('/api/bbc/import', asyncRoute(async (req, res) => {
  const { url } = req.body || {}
  if (!url) return res.status(400).json({ error: '"url" is required.' })
  const meta = await bbc.fetchBbcEpisodeMeta(url)
  const transcript = await bbc.extractTranscriptFromPdf(meta.pdfUrl)
  res.json({ ...meta, transcript })
}))

app.post('/api/bbc/audio/:materialId', asyncRoute(async (req, res) => {
  const { mp3Url } = req.body || {}
  if (!mp3Url) return res.status(400).json({ error: '"mp3Url" is required.' })
  const buffer = await bbc.fetchAudioBuffer(mp3Url)
  await store.saveAudioBlob(Number(req.params.materialId), buffer, 'bbc', 'bbc')
  res.json({ ok: true })
}))

// Edge's backend is unofficial and can stall mid-stream instead of erroring
// — without a hard cap, that hangs this request (and the client's own
// timeout is a separate, later line of defense, not a substitute: a
// stalled request here still pins a connection/CPU on the server side).
const SYNTHESIZE_TIMEOUT_MS = 25000

app.post('/synthesize', async (req, res) => {
  const { text, voice, rate } = req.body || {}
  if (!text || !voice) {
    return res.status(400).json({ error: 'Both "text" and "voice" are required.' })
  }

  try {
    const communicate = new Communicate(text, { voice, rate: rate || '+0%' })
    const chunks = []
    const collect = (async () => {
      for await (const chunk of communicate.stream()) {
        if (chunk.type === 'audio' && chunk.data) chunks.push(chunk.data)
      }
    })()
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Edge TTS stalled (no response after ${SYNTHESIZE_TIMEOUT_MS / 1000}s).`)), SYNTHESIZE_TIMEOUT_MS)
    )
    await Promise.race([collect, timeout])
    if (!chunks.length) throw new Error('Edge TTS returned no audio.')

    const audio = Buffer.concat(chunks)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.send(audio)
  } catch (err) {
    console.error('[edge-tts] synthesis failed:', err.message)
    res.status(502).json({ error: err.message || 'Edge TTS synthesis failed.' })
  }
})

app.listen(PORT, () => {
  console.log(`Edge TTS server listening on http://localhost:${PORT}`)
})
