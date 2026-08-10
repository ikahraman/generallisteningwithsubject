// Minimal dependency-free ZIP reader/writer (STORE method, no compression).
// Enough for bundling our own JSON + audio blobs for export/import — we
// don't need DEFLATE since these archives are generated and consumed by us.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date = new Date()) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, dosDate }
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function jsonToBytes(obj) {
  return textEncoder.encode(JSON.stringify(obj))
}

export function bytesToJSON(bytes) {
  return JSON.parse(textDecoder.decode(bytes))
}

/**
 * @param {Array<{name: string, data: Uint8Array}>} files
 * @returns {Blob}
 */
export function buildZip(files) {
  const { time, dosDate } = dosDateTime()
  const localChunks = []
  const centralChunks = []
  let offset = 0

  for (const { name, data } of files) {
    const nameBytes = textEncoder.encode(name)
    const crc = crc32(data)

    const localHeader = new DataView(new ArrayBuffer(30))
    localHeader.setUint32(0, 0x04034b50, true)
    localHeader.setUint16(4, 20, true) // version needed
    localHeader.setUint16(6, 0, true) // flags
    localHeader.setUint16(8, 0, true) // method: store
    localHeader.setUint16(10, time, true)
    localHeader.setUint16(12, dosDate, true)
    localHeader.setUint32(14, crc, true)
    localHeader.setUint32(18, data.length, true)
    localHeader.setUint32(22, data.length, true)
    localHeader.setUint16(26, nameBytes.length, true)
    localHeader.setUint16(28, 0, true) // extra field length

    localChunks.push(new Uint8Array(localHeader.buffer), nameBytes, data)

    const centralHeader = new DataView(new ArrayBuffer(46))
    centralHeader.setUint32(0, 0x02014b50, true)
    centralHeader.setUint16(4, 20, true) // version made by
    centralHeader.setUint16(6, 20, true) // version needed
    centralHeader.setUint16(8, 0, true) // flags
    centralHeader.setUint16(10, 0, true) // method
    centralHeader.setUint16(12, time, true)
    centralHeader.setUint16(14, dosDate, true)
    centralHeader.setUint32(16, crc, true)
    centralHeader.setUint32(20, data.length, true)
    centralHeader.setUint32(24, data.length, true)
    centralHeader.setUint16(28, nameBytes.length, true)
    centralHeader.setUint16(30, 0, true) // extra length
    centralHeader.setUint16(32, 0, true) // comment length
    centralHeader.setUint16(34, 0, true) // disk number
    centralHeader.setUint16(36, 0, true) // internal attrs
    centralHeader.setUint32(38, 0, true) // external attrs
    centralHeader.setUint32(42, offset, true) // local header offset

    centralChunks.push(new Uint8Array(centralHeader.buffer), nameBytes)

    offset += 30 + nameBytes.length + data.length
  }

  const centralSize = centralChunks.reduce((sum, c) => sum + c.length, 0)
  const eocd = new DataView(new ArrayBuffer(22))
  eocd.setUint32(0, 0x06054b50, true)
  eocd.setUint16(4, 0, true)
  eocd.setUint16(6, 0, true)
  eocd.setUint16(8, files.length, true)
  eocd.setUint16(10, files.length, true)
  eocd.setUint32(12, centralSize, true)
  eocd.setUint32(16, offset, true)
  eocd.setUint16(20, 0, true)

  return new Blob([...localChunks, ...centralChunks, new Uint8Array(eocd.buffer)], {
    type: 'application/zip',
  })
}

/**
 * @param {ArrayBuffer} buffer
 * @returns {Array<{name: string, data: Uint8Array}>}
 */
export function extractZip(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  let eocdOffset = -1
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset === -1) throw new Error('Not a valid ZIP file')

  const entryCount = view.getUint16(10, true)
  let centralOffset = view.getUint32(16, true)
  const files = []

  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(centralOffset, true) !== 0x02014b50) break
    const compressedSize = view.getUint32(centralOffset + 20, true)
    const nameLen = view.getUint16(centralOffset + 28, true)
    const extraLen = view.getUint16(centralOffset + 30, true)
    const commentLen = view.getUint16(centralOffset + 32, true)
    const localOffset = view.getUint32(centralOffset + 42, true)
    const name = textDecoder.decode(bytes.subarray(centralOffset + 46, centralOffset + 46 + nameLen))

    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const data = bytes.slice(dataStart, dataStart + compressedSize)

    files.push({ name, data })
    centralOffset += 46 + nameLen + extraLen + commentLen
  }

  return files
}

// ---------- optional AES-GCM password protection for export bundles ----------

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function toB64(bytes) {
  return btoa(String.fromCharCode(...bytes))
}
function fromB64(str) {
  return new Uint8Array(
    atob(str)
      .split('')
      .map((c) => c.charCodeAt(0))
  )
}

/** Encrypts a JS object, returns files to add into the zip: data.json.enc + crypto-meta.json */
export async function encryptJSON(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, jsonToBytes(obj))
  return [
    { name: 'data.json.enc', data: new Uint8Array(cipher) },
    {
      name: 'crypto-meta.json',
      data: jsonToBytes({ algo: 'AES-GCM-PBKDF2', salt: toB64(salt), iv: toB64(iv) }),
    },
  ]
}

export async function decryptJSON(encryptedBytes, metaBytes, password) {
  const meta = bytesToJSON(metaBytes)
  const key = await deriveKey(password, fromB64(meta.salt))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(meta.iv) },
    key,
    encryptedBytes
  )
  return bytesToJSON(new Uint8Array(plain))
}
