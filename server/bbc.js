// Fetches and parses BBC Learning English episodes (transcript PDF + audio)
// for the "BBC Content" import flow. Runs entirely server-side: BBC blocks
// cross-origin fetches from a browser, but a Node server has no such
// restriction talking to it directly, so no proxy/CORS workaround is
// needed here (a reference implementation that ran this client-side in a
// browser needed a same-origin dev proxy for exactly this reason).
//
// The PDF-parsing heuristics (speaker-label-on-its-own-line, boilerplate
// filtering) are ported from that same reference implementation, verified
// against a real "Real Easy English" episode — BBC's transcript PDFs
// aren't structurally tagged, so this relies on layout (x/y text
// positions), not markup.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

export function isBbcLearningEnglishUrl(url) {
  try {
    const parsed = new URL(url)
    return /(^|\.)bbc\.co\.uk$/.test(parsed.hostname) && parsed.pathname.includes('/learningenglish/')
  } catch {
    return false
  }
}

function resolveUrl(href, base) {
  if (!href) return undefined
  try {
    return new URL(href, base).toString()
  } catch {
    return undefined
  }
}

function decodeHtmlEntities(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
}

function extractMeta(html, pageUrl) {
  const ogTitle = html.match(/<meta property="og:title" content="([^"]*)"/i)?.[1]
  const ogDesc = html.match(/<meta property="og:description" content="([^"]*)"/i)?.[1]
  const titleTag = html.match(/<title>([^<]*)<\/title>/i)?.[1]
  const title = decodeHtmlEntities(ogTitle || titleTag || 'Untitled episode')
    .replace(/^BBC Learning English\s*-\s*/i, '')
    .trim()
  const description = decodeHtmlEntities(ogDesc || '')

  // BBC labels these links "Download" / "Download PDF", not by file type,
  // so we go by URL pattern instead. Some episode formats ("Real Easy
  // English") link BOTH a transcript PDF and a worksheet PDF on the same
  // page — grabbing "the first .pdf" (as if there's only ever one, true for
  // "6 Minute English") silently picks the worksheet instead. Prefer a
  // filename containing "transcript"; only fall back to "any non-worksheet
  // .pdf" for formats that don't follow that naming.
  const hrefs = Array.from(html.matchAll(/href="([^"]+)"/gi)).map((m) => m[1])
  const pdfHrefs = hrefs.filter((h) => /\.pdf(\?|$)/i.test(h))
  const pdfHref = pdfHrefs.find((h) => /transcript/i.test(h)) || pdfHrefs.find((h) => !/worksheet/i.test(h)) || pdfHrefs[0]
  const mp3Href = hrefs.find((h) => /\.mp3(\?|$)/i.test(h))

  return {
    title,
    description,
    pdfUrl: resolveUrl(pdfHref, pageUrl),
    mp3Url: resolveUrl(mp3Href, pageUrl),
  }
}

export async function fetchBbcEpisodeMeta(url) {
  if (!isBbcLearningEnglishUrl(url)) {
    throw new Error("That doesn't look like a bbc.co.uk/learningenglish URL.")
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`BBC returned an error (${res.status}).`)
  const html = await res.text()
  const meta = extractMeta(html, url)
  if (!meta.pdfUrl) {
    throw new Error('No transcript PDF found on that page — this importer only supports episodes with a downloadable transcript.')
  }
  return { ...meta, sourceUrl: url }
}

// ---------- PDF transcript extraction ----------

const BOILERPLATE_LINES = [
  /^BBC LEARNING ENGLISH$/i,
  /British Broadcasting Corporation/i,
  /^bbclearningenglish\.com/i,
  /^Page \d+ of \d+$/i,
  /this is not a word-for-word (script|transcript)/i,
  /^6 Minute English$/i,
  /^Real Easy English$/i,
]
// A speaker label is a short Title-Case line ("Neil", "Estrella Luna-Diez")
// on its own — never all-caps, since section headings like "VOCABULARY" are
// too (and mark the end of the dialogue — see isSectionEnd).
const SPEAKER_LABEL = /^[A-Z][a-zA-Z'-]*(\s[A-Z][a-zA-Z'.-]*){0,3}$/

function isAllCaps(line) {
  const letters = line.replace(/[^a-zA-Z]/g, '')
  return letters.length > 1 && letters === letters.toUpperCase()
}
function isBoilerplate(line) {
  return BOILERPLATE_LINES.some((re) => re.test(line))
}
function isSpeakerLabel(line) {
  return line.length > 0 && line.length <= 40 && SPEAKER_LABEL.test(line) && !isAllCaps(line)
}
function isSectionEnd(line) {
  return isAllCaps(line) && line.length > 2
}
function cleanupSpacing(text) {
  return text
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/(\w)\s'\s(\w)/g, "$1'$2")
    .replace(/\s+/g, ' ')
    .trim()
}

async function extractLines(doc) {
  const allLines = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()

    const lines = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = Math.round(item.transform[5])
      const x = item.transform[4]
      let line = lines.find((l) => Math.abs(l.y - y) < 3)
      if (!line) {
        line = { y, parts: [] }
        lines.push(line)
      }
      line.parts.push({ x, text: item.str })
    }

    lines.sort((a, b) => b.y - a.y)
    for (const line of lines) {
      line.parts.sort((a, b) => a.x - b.x)
      const text = line.parts.map((p) => p.text).join(' ').replace(/\s+/g, ' ').trim()
      if (text) allLines.push(text)
    }
  }
  return allLines
}

function reformatAsTranscript(lines) {
  const cleaned = []
  let seenFirstSpeaker = false

  for (const line of lines) {
    if (isBoilerplate(line)) continue
    if (!seenFirstSpeaker && isSpeakerLabel(line)) seenFirstSpeaker = true
    if (!seenFirstSpeaker) continue // skip the title line before dialogue starts
    cleaned.push(line)
  }

  const turns = []
  let current = null
  for (const line of cleaned) {
    if (isSectionEnd(line)) break
    if (isSpeakerLabel(line)) {
      if (current) turns.push(current)
      current = { speaker: line, text: '' }
    } else if (current) {
      current.text = current.text ? `${current.text} ${line}` : line
    }
  }
  if (current) turns.push(current)

  return turns
    .filter((t) => t.text.trim().length > 0)
    .map((t) => `${t.speaker}: ${cleanupSpacing(t.text)}`)
    .join('\n')
}

export async function extractTranscriptFromPdf(pdfUrl) {
  const res = await fetch(pdfUrl, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Could not download the transcript PDF (${res.status}).`)
  const data = new Uint8Array(await res.arrayBuffer())
  const doc = await pdfjsLib.getDocument({ data }).promise
  const lines = await extractLines(doc)
  const transcript = reformatAsTranscript(lines)
  if (!transcript) throw new Error("Couldn't find any dialogue in that PDF.")
  return transcript
}

export async function fetchAudioBuffer(mp3Url) {
  const res = await fetch(mp3Url, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`Could not download the audio file (${res.status}).`)
  return Buffer.from(await res.arrayBuffer())
}
