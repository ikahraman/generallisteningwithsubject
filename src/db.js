// Client for the server-side library store (see server/store.js). Used to
// be Dexie/IndexedDB, but that meant each browser/device had its own
// separate copy of the library — moving it to the server means a phone and
// a desktop hitting the same server see the same materials.
import { fetchWithToken } from './api/auth-token.js'

// Relative — same-origin in production (nginx proxies /api to the
// companion server), proxied to localhost:5175 by Vite in dev (see
// vite.config.js).
const SERVER_URL = ''

async function request(method, path, body) {
  let res
  try {
    res = await fetchWithToken(`${SERVER_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Library server is not reachable — is it running? (npm start inside server/)')
  }
  if (!res.ok) throw new Error(await extractError(res))
  if (res.status === 204) return undefined
  return res.json()
}

async function extractError(res) {
  try {
    const body = await res.json()
    return body?.error || `Library server error (HTTP ${res.status}).`
  } catch {
    return `Library server error (HTTP ${res.status}).`
  }
}

// ---------- materials ----------

export async function addMaterial(material) {
  const { id } = await request('POST', '/api/materials', material)
  return id
}

export function getMaterial(id) {
  return request('GET', `/api/materials/${id}`)
}

export function getAllMaterials() {
  return request('GET', '/api/materials')
}

export function updateMaterial(id, changes) {
  return request('PATCH', `/api/materials/${id}`, changes)
}

export function deleteMaterial(id) {
  return request('DELETE', `/api/materials/${id}`)
}

export function recordMaterialStudied(id) {
  return request('POST', `/api/materials/${id}/studied`)
}

export function toggleFavorite(id, isFavorite) {
  return request('PATCH', `/api/materials/${id}/favorite`, { isFavorite })
}

// ---------- folders ----------

export async function addFolder(name, parentId = null) {
  const { id } = await request('POST', '/api/folders', { name, parentId })
  return id
}

export function getAllFolders() {
  return request('GET', '/api/folders')
}

export function renameFolder(id, name) {
  return request('PATCH', `/api/folders/${id}`, { name })
}

export function deleteFolder(id) {
  return request('DELETE', `/api/folders/${id}`)
}

// ---------- tags ----------

export async function addTag(name, color) {
  const { id } = await request('POST', '/api/tags', { name, color })
  return id
}

export function getAllTags() {
  return request('GET', '/api/tags')
}

export function deleteTag(id) {
  return request('DELETE', `/api/tags/${id}`)
}

// ---------- audio cache ----------

// `kind` picks which narration slot to use for a material — omit for the
// main listening-passage audio, or e.g. 'vocab-lesson' for the Vocab
// Lesson's spoken word-list (different text, stored separately so the two
// don't overwrite each other).
function audioPath(materialId, kind) {
  return kind ? `/api/audio/${materialId}/${encodeURIComponent(kind)}` : `/api/audio/${materialId}`
}

// Metadata only (kind/engine/createdAt per track) — no binary download —
// so callers can see which tracks exist (e.g. build a switcher) without
// fetching every track's full audio.
export function getAudioTracks(materialId) {
  return request('GET', `/api/audio-meta/${materialId}`)
}

export async function saveAudioBlob(materialId, blob, engine, kind) {
  const buf = await blob.arrayBuffer()
  const qs = engine ? `?engine=${encodeURIComponent(engine)}` : ''
  const res = await fetchWithToken(`${SERVER_URL}${audioPath(materialId, kind)}${qs}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: buf,
  })
  if (!res.ok) throw new Error(await extractError(res))
}

export async function getAudioBlob(materialId, kind) {
  let res
  try {
    res = await fetchWithToken(`${SERVER_URL}${audioPath(materialId, kind)}`)
  } catch {
    throw new Error('Library server is not reachable — is it running? (npm start inside server/)')
  }
  if (res.status === 404) return undefined
  if (!res.ok) throw new Error(await extractError(res))
  const blob = await res.blob()
  return {
    materialId,
    blob,
    engine: res.headers.get('X-Audio-Engine') || null,
    createdAt: res.headers.get('X-Audio-Created-At') || null,
  }
}

export function deleteAudioBlob(materialId, kind) {
  return request('DELETE', audioPath(materialId, kind))
}

// ---------- settings (key/value) ----------

export async function getSetting(key, fallback = undefined) {
  const settings = await request('GET', '/api/settings')
  return key in settings ? settings[key] : fallback
}

export function setSetting(key, value) {
  return request('PUT', `/api/settings/${encodeURIComponent(key)}`, { value })
}

export function getAllSettings() {
  return request('GET', '/api/settings')
}

// ---------- study log ----------

export async function addStudyLogEntry(entry) {
  const { id } = await request('POST', '/api/study-log', entry)
  return id
}

export function getStudyLogForMaterial(materialId) {
  return request('GET', `/api/study-log/${materialId}`)
}

export function getAllStudyLog() {
  return request('GET', '/api/study-log')
}

// ---------- BBC Content import ----------
// Both hit BBC directly (server-side, see server/bbc.js) rather than
// going through this module's request()/extractError() helper, since they
// need their own longer timeouts — fetching a BBC page + downloading its
// transcript PDF, or a multi-MB audio file, legitimately takes longer than
// the rest of this app's API calls.

const BBC_IMPORT_TIMEOUT_MS = 30000
const BBC_AUDIO_TIMEOUT_MS = 60000

export async function importBbcEpisode(url) {
  let res
  try {
    res = await fetchWithToken(`${SERVER_URL}/api/bbc/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(BBC_IMPORT_TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(`Timed out fetching that page after ${BBC_IMPORT_TIMEOUT_MS / 1000}s.`)
    throw new Error('Library server is not reachable — is it running? (npm start inside server/)')
  }
  if (!res.ok) throw new Error(await extractError(res))
  return res.json()
}

export async function saveBbcAudio(materialId, mp3Url) {
  let res
  try {
    res = await fetchWithToken(`${SERVER_URL}/api/bbc/audio/${materialId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mp3Url }),
      signal: AbortSignal.timeout(BBC_AUDIO_TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(`Audio download timed out after ${BBC_AUDIO_TIMEOUT_MS / 1000}s.`)
    throw new Error('Library server is not reachable — is it running? (npm start inside server/)')
  }
  if (!res.ok) throw new Error(await extractError(res))
}

// ---------- bulk data (export/import, Settings module) ----------

export function exportAllData() {
  return request('GET', '/api/export')
}

export function importBulk(data) {
  return request('POST', '/api/import', data)
}

export function clearAllData() {
  return request('POST', '/api/clear')
}
