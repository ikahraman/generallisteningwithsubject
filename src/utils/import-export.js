// Shared ZIP/JSON bundling logic used by both Settings (full-library backup)
// and Library (export/import of an arbitrary subset of materials). Kept
// UI-agnostic: password prompting is injected by the caller as a callback.

import { getAudioBlob, saveAudioBlob, importBulk } from '../db.js'
import { buildZip, extractZip, jsonToBytes, bytesToJSON, encryptJSON, decryptJSON } from './zip-handler.js'

/**
 * @param {{materials?, folders?, tags?, settings?, studyLog?}} data
 * @param {string|null} password
 * @returns {Promise<Blob>}
 */
export async function buildDataZip(data, password) {
  const materialIds = (data.materials || []).map((m) => m.id)
  const audioRows = (await Promise.all(materialIds.map((id) => getAudioBlob(id)))).filter(Boolean)

  const files = password
    ? await encryptJSON(data, password)
    : [{ name: 'data.json', data: jsonToBytes(data) }]

  for (const row of audioRows) {
    const buf = await row.blob.arrayBuffer()
    files.push({ name: `audio/${row.materialId}.bin`, data: new Uint8Array(buf) })
  }

  return buildZip(files)
}

/**
 * @param {ArrayBuffer} arrayBuffer
 * @param {(message: string) => Promise<string|null>} promptPassword
 * @returns {Promise<{data: object, audioFiles: Array}|null>} null if the user cancelled a password prompt
 */
export async function readDataZip(arrayBuffer, promptPassword) {
  const files = extractZip(arrayBuffer)
  const audioFiles = files.filter((f) => f.name.startsWith('audio/'))

  const plain = files.find((f) => f.name === 'data.json')
  if (plain) return { data: bytesToJSON(plain.data), audioFiles }

  const enc = files.find((f) => f.name === 'data.json.enc')
  const meta = files.find((f) => f.name === 'crypto-meta.json')
  if (!enc || !meta) throw new Error('Archive does not contain a valid data.json')

  const password = await promptPassword('This archive is password-protected.')
  if (password === null) return null
  return { data: await decryptJSON(enc.data, meta.data, password), audioFiles }
}

export async function restoreAudioFiles(audioFiles) {
  for (const f of audioFiles) {
    const materialId = Number(f.name.slice('audio/'.length).replace('.bin', ''))
    if (!Number.isFinite(materialId)) continue
    await saveAudioBlob(materialId, new Blob([f.data]))
  }
}

export async function importIntoDatabase(data) {
  await importBulk(data)
}
