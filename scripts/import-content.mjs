// Batch-imports hand-produced content/<topic>/<subtopic>/<level>-<mode>.json
// files (see content/README.md — the workflow is: Generator's "Show Gemini
// Prompt" -> copy -> paste into whichever LLM -> save its JSON response
// here) into the running app's library.
//
// Goes through the app's own HTTP API rather than touching server/data
// directly — the live server (server/index.js) serializes its own writes
// correctly, but a second Node process writing the same file underneath it
// would not be coordinated with that and could silently lose an update if
// this ran while real users were also saving something. Hitting the API
// avoids that entirely, and also means this can be run from any machine
// (not just the VDS) against either localhost or the public URL.
//
// Usage:
//   node scripts/import-content.mjs
//   API_URL=http://185.149.103.172 API_TOKEN=... node scripts/import-content.mjs
//
// Idempotent: matches existing materials by their content/-relative path
// (stored as `sourceFile`), so re-running after editing a file updates it
// in place instead of creating a duplicate. Does NOT generate audio —
// that's a manual "Generate Speech" click per material in Workspace after
// import (see content/README.md for why).

import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { validateMaterialJSON } from '../src/utils/validators.js'
import { countWords, estimateDuration } from '../src/utils/helpers.js'
import { MODES } from '../src/modules/material-modes.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = path.join(__dirname, '..', 'content')
const API_URL = process.env.API_URL || 'http://localhost:5175'
const API_TOKEN = process.env.API_TOKEN || ''

const LEVEL_SLUGS = { a1plus: 'A1+', a2: 'A2', b1: 'B1', b2: 'B2', c1: 'C1', c2: 'C2' }

function titleCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// "b1-selective.json" -> { level: 'B1', mode: 'selective' }. Level is
// everything before the FIRST hyphen; mode is everything after (mode keys
// like "search-reading" contain hyphens themselves).
function parseFilename(filename) {
  const base = filename.replace(/\.json$/i, '')
  const firstDash = base.indexOf('-')
  if (firstDash === -1) return null
  const level = LEVEL_SLUGS[base.slice(0, firstDash)]
  const mode = base.slice(firstDash + 1)
  if (!level || !MODES[mode]) return null
  return { level, mode }
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(full)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(full)
  }
  return files
}

async function api(method, urlPath, body) {
  const res = await fetch(`${API_URL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Api-Token': API_TOKEN },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${method} ${urlPath} -> HTTP ${res.status}: ${await res.text()}`)
  return res.status === 204 ? undefined : res.json()
}

async function importFile(filePath, existingBySource) {
  const rel = path.relative(CONTENT_DIR, filePath).split(path.sep).join('/')
  const parts = rel.split('/')
  if (parts.length !== 3) {
    console.warn(`SKIP ${rel} — expected content/<topic>/<subtopic>/<level-mode>.json`)
    return
  }

  const [topicSlug, subtopicSlug, filename] = parts
  const parsed = parseFilename(filename)
  if (!parsed) {
    console.warn(`SKIP ${rel} — filename must be "<level>-<mode>.json" (e.g. b1-selective.json), got "${filename}"`)
    return
  }

  let raw
  try {
    raw = JSON.parse(await fs.readFile(filePath, 'utf-8'))
  } catch (err) {
    console.warn(`SKIP ${rel} — invalid JSON: ${err.message}`)
    return
  }

  let validated
  try {
    validated = validateMaterialJSON(raw)
  } catch (err) {
    console.warn(`SKIP ${rel} — ${err.message}`)
    return
  }

  const wordCount = countWords(validated.transcript)
  const material = {
    title: validated.title,
    topic: titleCase(topicSlug),
    subtopic: titleCase(subtopicSlug),
    level: parsed.level,
    mode: parsed.mode,
    wordCount,
    duration: estimateDuration(wordCount),
    transcript: validated.transcript,
    paragraphs: validated.paragraphs,
    questions: validated.questions,
    vocabulary: validated.vocabulary,
    expressions: validated.expressions,
    grammar: validated.grammar,
    shadowing: validated.shadowing,
    notes: '',
    bookmarks: [],
    userAnswers: { groupA: {}, groupB: {}, groupC: {} },
    earTrainingAnswers: {},
    sourceFile: rel,
  }

  const existing = existingBySource.get(rel)
  if (existing) {
    await api('PATCH', `/api/materials/${existing.id}`, material)
    console.log(`UPDATED ${rel} -> #${existing.id}`)
  } else {
    const { id } = await api('POST', '/api/materials', material)
    console.log(`ADDED   ${rel} -> #${id}`)
  }
}

async function main() {
  let files
  try {
    files = await walk(CONTENT_DIR)
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`No content/ directory found at ${CONTENT_DIR} — see content/README.md.`)
      process.exit(1)
    }
    throw err
  }
  if (!files.length) {
    console.log('No .json files found under content/.')
    return
  }

  const allMaterials = await api('GET', '/api/materials')
  const existingBySource = new Map(allMaterials.filter((m) => m.sourceFile).map((m) => [m.sourceFile, m]))

  console.log(`Found ${files.length} file(s) under content/, importing against ${API_URL}...`)
  for (const file of files) {
    await importFile(file, existingBySource)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error('Import failed:', err.message)
  process.exit(1)
})
