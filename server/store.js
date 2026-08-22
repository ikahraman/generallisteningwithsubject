// File-backed replacement for the browser's IndexedDB, so the library
// (materials/folders/tags/settings/studyLog) lives on the server instead of
// per-device — the whole point being that a phone and a desktop hitting the
// same server see the same data. Metadata lives in one JSON file; audio
// blobs are kept as separate files on disk (embedding them as base64 in the
// JSON would mean rewriting a multi-MB file on every unrelated edit).
import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Overridable so a blue-green deploy (release dir swapped on every push) can
// point this at a persistent directory outside the versioned release —
// otherwise every deploy would start with an empty library.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')
const LIBRARY_FILE = path.join(DATA_DIR, 'library.json')
const AUDIO_DIR = path.join(DATA_DIR, 'audio')

const EMPTY_LIBRARY = { materials: [], folders: [], tags: [], settings: [], studyLog: [], audioMeta: [], channels: [], seq: {} }

// Concurrent requests (e.g. two devices saving at once) must not interleave
// read-modify-write cycles on the same file, so every mutation is queued
// onto this chain instead of running as soon as it's called.
let writeQueue = Promise.resolve()
function serialize(fn) {
  const result = writeQueue.then(fn)
  writeQueue = result.catch(() => {})
  return result
}

async function ensureDirs() {
  await fs.mkdir(AUDIO_DIR, { recursive: true })
}

async function readLibrary() {
  try {
    const raw = await fs.readFile(LIBRARY_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return { ...EMPTY_LIBRARY, ...parsed, seq: { ...parsed.seq } }
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(EMPTY_LIBRARY)
    throw err
  }
}

async function writeLibrary(lib) {
  await ensureDirs()
  const tmp = `${LIBRARY_FILE}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(lib, null, 2))
  await fs.rename(tmp, LIBRARY_FILE)
}

function nextId(lib, collection) {
  const id = (lib.seq[collection] || 0) + 1
  lib.seq[collection] = id
  return id
}

function bumpSeqPastExisting(lib, collection, rows) {
  const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  lib.seq[collection] = Math.max(lib.seq[collection] || 0, maxId)
}

// `kind` distinguishes a material's main listening-passage audio (kind
// omitted, unchanged filename/meta shape for backward compatibility) from
// other narrations belonging to the same material — currently just the
// Vocab Lesson's spoken word-list, which is different text entirely and
// would otherwise overwrite the main audio if it used the same slot.
const audioPath = (materialId, kind) =>
  path.join(AUDIO_DIR, kind ? `${materialId}-${kind}.bin` : `${materialId}.bin`)
const matchesAudioMeta = (a, materialId, kind) => a.materialId === materialId && (a.kind || null) === (kind || null)

// ---------- materials ----------

export function addMaterial(material) {
  return serialize(async () => {
    const lib = await readLibrary()
    const row = {
      isFavorite: false,
      folderId: null,
      tags: [],
      lastStudiedAt: null,
      lastOpenedAt: null,
      studyCount: 0,
      notes: '',
      prediction: '',
      bookmarks: [],
      version: 1,
      createdAt: new Date().toISOString(),
      ...material,
      id: nextId(lib, 'materials'),
    }
    lib.materials.push(row)
    await writeLibrary(lib)
    return row.id
  })
}

export async function getMaterial(id) {
  const lib = await readLibrary()
  return lib.materials.find((m) => m.id === id) || null
}

export async function getAllMaterials() {
  return (await readLibrary()).materials
}

export function updateMaterial(id, changes) {
  return serialize(async () => {
    const lib = await readLibrary()
    const idx = lib.materials.findIndex((m) => m.id === id)
    if (idx === -1) return
    lib.materials[idx] = { ...lib.materials[idx], ...changes }
    await writeLibrary(lib)
  })
}

export function deleteMaterial(id) {
  return serialize(async () => {
    const lib = await readLibrary()
    lib.materials = lib.materials.filter((m) => m.id !== id)
    lib.studyLog = lib.studyLog.filter((s) => s.materialId !== id)
    // Read the tracks *before* clearing audioMeta — a material can now have
    // several (main cloud/edge/gemini + vocab-lesson), and hardcoding kind
    // names here previously left cloud/edge files orphaned on disk forever.
    const ownTracks = lib.audioMeta.filter((a) => a.materialId === id)
    lib.audioMeta = lib.audioMeta.filter((a) => a.materialId !== id)
    await writeLibrary(lib)
    await Promise.all(ownTracks.map((t) => fs.rm(audioPath(id, t.kind), { force: true })))
  })
}

export function recordMaterialStudied(id) {
  return serialize(async () => {
    const lib = await readLibrary()
    const m = lib.materials.find((m) => m.id === id)
    if (!m) return
    m.lastStudiedAt = new Date().toISOString()
    m.studyCount = (m.studyCount || 0) + 1
    await writeLibrary(lib)
  })
}

export function toggleFavorite(id, isFavorite) {
  return serialize(async () => {
    const lib = await readLibrary()
    const m = lib.materials.find((m) => m.id === id)
    if (m) m.isFavorite = isFavorite
    await writeLibrary(lib)
  })
}

// ---------- folders ----------

export function addFolder(name, parentId = null) {
  return serialize(async () => {
    const lib = await readLibrary()
    const row = { id: nextId(lib, 'folders'), name, parentId, createdAt: new Date().toISOString() }
    lib.folders.push(row)
    await writeLibrary(lib)
    return row.id
  })
}

export async function getAllFolders() {
  return (await readLibrary()).folders
}

export function renameFolder(id, name) {
  return serialize(async () => {
    const lib = await readLibrary()
    const f = lib.folders.find((f) => f.id === id)
    if (f) f.name = name
    await writeLibrary(lib)
  })
}

export function deleteFolder(id) {
  return serialize(async () => {
    const lib = await readLibrary()
    lib.folders = lib.folders.filter((f) => f.id !== id)
    lib.materials.forEach((m) => {
      if (m.folderId === id) m.folderId = null
    })
    await writeLibrary(lib)
  })
}

// ---------- tags ----------

export function addTag(name, color) {
  return serialize(async () => {
    const lib = await readLibrary()
    const row = { id: nextId(lib, 'tags'), name, color }
    lib.tags.push(row)
    await writeLibrary(lib)
    return row.id
  })
}

export async function getAllTags() {
  return (await readLibrary()).tags
}

export function deleteTag(id) {
  return serialize(async () => {
    const lib = await readLibrary()
    lib.tags = lib.tags.filter((t) => t.id !== id)
    await writeLibrary(lib)
  })
}

// ---------- channels (YouTube Channels: added playlists + their videos) ----------
// One row per added playlist. `videos` is embedded (not a separate
// collection) since it's always read/written as a whole with its parent —
// there's no cross-channel query need that would justify normalizing it out.

export function addChannel({ url, title, level, videos }) {
  return serialize(async () => {
    const lib = await readLibrary()
    const row = {
      id: nextId(lib, 'channels'),
      url,
      title,
      level,
      createdAt: new Date().toISOString(),
      videos: videos.map((v) => ({ status: 'pending', materialId: null, error: null, ...v })),
    }
    lib.channels.push(row)
    await writeLibrary(lib)
    return row.id
  })
}

export async function getAllChannels() {
  return (await readLibrary()).channels
}

export function deleteChannel(id) {
  return serialize(async () => {
    const lib = await readLibrary()
    lib.channels = lib.channels.filter((c) => c.id !== id)
    await writeLibrary(lib)
  })
}

// Used to record each video's progress (pending -> generating -> done/error)
// as a batch generation run works through a channel's checked videos, one at
// a time, so the page shows live status and reloading mid-batch doesn't lose it.
export function updateChannelVideo(channelId, videoId, changes) {
  return serialize(async () => {
    const lib = await readLibrary()
    const channel = lib.channels.find((c) => c.id === channelId)
    const video = channel?.videos.find((v) => v.videoId === videoId)
    if (!video) return
    Object.assign(video, changes)
    await writeLibrary(lib)
  })
}

// ---------- audio cache ----------

export function saveAudioBlob(materialId, buffer, engine, kind) {
  return serialize(async () => {
    await ensureDirs()
    await fs.writeFile(audioPath(materialId, kind), buffer)
    const lib = await readLibrary()
    const meta = { materialId, kind: kind || null, engine: engine || null, createdAt: new Date().toISOString() }
    const idx = lib.audioMeta.findIndex((a) => matchesAudioMeta(a, materialId, kind))
    if (idx === -1) lib.audioMeta.push(meta)
    else lib.audioMeta[idx] = meta
    await writeLibrary(lib)
  })
}

export async function getAudioBlob(materialId, kind) {
  let buffer
  try {
    buffer = await fs.readFile(audioPath(materialId, kind))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  const lib = await readLibrary()
  const meta = lib.audioMeta.find((a) => matchesAudioMeta(a, materialId, kind))
  return { materialId, buffer, engine: meta?.engine || null, createdAt: meta?.createdAt || null }
}

// Metadata only (no binary read) — lets a caller see which tracks exist
// for a material (e.g. 'cloud' and 'edge' both cached) without downloading
// every track's full audio just to build a switcher UI.
export async function getAudioTracks(materialId) {
  const lib = await readLibrary()
  return lib.audioMeta.filter((a) => a.materialId === materialId)
}

export function deleteAudioBlob(materialId, kind) {
  return serialize(async () => {
    const lib = await readLibrary()
    lib.audioMeta = lib.audioMeta.filter((a) => !matchesAudioMeta(a, materialId, kind))
    await writeLibrary(lib)
    await fs.rm(audioPath(materialId, kind), { force: true })
  })
}

// ---------- settings (key/value) ----------

export async function getSetting(key, fallback = undefined) {
  const lib = await readLibrary()
  const row = lib.settings.find((s) => s.key === key)
  return row ? row.value : fallback
}

export function setSetting(key, value) {
  return serialize(async () => {
    const lib = await readLibrary()
    const idx = lib.settings.findIndex((s) => s.key === key)
    if (idx === -1) lib.settings.push({ key, value })
    else lib.settings[idx] = { key, value }
    await writeLibrary(lib)
  })
}

export async function getAllSettings() {
  const lib = await readLibrary()
  return Object.fromEntries(lib.settings.map((s) => [s.key, s.value]))
}

// ---------- study log ----------

export function addStudyLogEntry(entry) {
  return serialize(async () => {
    const lib = await readLibrary()
    const row = { id: nextId(lib, 'studyLog'), date: new Date().toISOString(), ...entry }
    lib.studyLog.push(row)
    await writeLibrary(lib)
    return row.id
  })
}

export async function getStudyLogForMaterial(materialId) {
  return (await readLibrary()).studyLog.filter((s) => s.materialId === materialId)
}

export async function getAllStudyLog() {
  return (await readLibrary()).studyLog
}

// ---------- bulk data (export/import, Settings module) ----------

export async function exportAllData() {
  const lib = await readLibrary()
  return {
    materials: lib.materials,
    folders: lib.folders,
    tags: lib.tags,
    settings: lib.settings,
    studyLog: lib.studyLog,
    channels: lib.channels,
    exportedAt: new Date().toISOString(),
  }
}

// Mirrors Dexie's bulkPut: upsert-by-id, keeping rows not present in `data`.
export function importBulk(data) {
  return serialize(async () => {
    const lib = await readLibrary()
    for (const collection of ['materials', 'folders', 'tags', 'settings', 'studyLog', 'channels']) {
      const incoming = data[collection]
      if (!incoming?.length) continue
      const keyField = collection === 'settings' ? 'key' : 'id'
      for (const row of incoming) {
        const idx = lib[collection].findIndex((r) => r[keyField] === row[keyField])
        if (idx === -1) lib[collection].push(row)
        else lib[collection][idx] = row
      }
      if (keyField === 'id') bumpSeqPastExisting(lib, collection, lib[collection])
    }
    await writeLibrary(lib)
  })
}

export function clearAllData() {
  return serialize(async () => {
    await writeLibrary(structuredClone(EMPTY_LIBRARY))
    await fs.rm(AUDIO_DIR, { recursive: true, force: true })
    await ensureDirs()
  })
}
