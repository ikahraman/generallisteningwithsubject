// Fetches and parses YouTube videos (transcript + audio) for the "YouTube
// Content" import flow, mirroring bbc.js's role for BBC Learning English.
//
// Unlike BBC, plain fetch() from Node can't reliably get a working caption
// or audio URL directly from YouTube's own pages any more — YouTube's
// player/signature/bot-detection layer changes constantly, and a bare
// InnerTube client (tried first, see youtubei.js) came back empty on both
// counts for a real test video. `yt-dlp` is externally maintained
// specifically to keep up with that, so this shells out to it (see
// YTDLP_BIN below for how it's located) for ONE thing only: resolving a video's
// metadata, caption track URLs, and format URLs via `--dump-json`. Once
// resolved, those URLs (including the audio one — no ffmpeg transcoding
// needed) are plain, directly fetchable HTTP(S) URLs, so everything after
// that first call is a normal fetch(), same as bbc.js.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)
const YTDLP_TIMEOUT_MS = 30000
const YTDLP_MAX_BUFFER = 20 * 1024 * 1024
const YTDLP_AUDIO_TIMEOUT_MS = 180000
// Plain "yt-dlp" resolves via PATH for local dev (however it got installed —
// pip, a standalone binary, whatever). On the VDS it lives inside a
// dedicated venv (not on the systemd service's PATH), so deploy sets
// YTDLP_PATH to that venv's binary explicitly.
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp'

export function isYoutubeUrl(url) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\.|^m\./, '')
    if (host === 'youtu.be') return u.pathname.length > 1
    if (host === 'youtube.com') return (u.pathname === '/watch' && !!u.searchParams.get('v')) || /^\/(shorts|live)\//.test(u.pathname)
    return false
  } catch {
    return false
  }
}

async function dumpJson(url) {
  let stdout
  try {
    ;({ stdout } = await execFileAsync(YTDLP_BIN, ['--dump-json', '--no-warnings', url], {
      timeout: YTDLP_TIMEOUT_MS,
      maxBuffer: YTDLP_MAX_BUFFER,
    }))
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('yt-dlp is not installed on the server.')
    if (err.killed) throw new Error('Timed out reading that video (yt-dlp took too long).')
    throw new Error('Could not read that video — it may be private, age-restricted, region-locked, or removed.')
  }
  return JSON.parse(stdout)
}

// Manually-uploaded captions ("subtitles") are preferred over YouTube's
// auto-generated ones ("automatic_captions") when both exist, same
// preference order the reference pipeline uses for its own transcript
// fetch. Tries a few English language-code variants since yt-dlp's key
// naming varies (plain "en", "en-US", "en-GB", "en-orig" for dubbed audio).
function pickCaptionTrack(info) {
  const pickLang = (obj) => {
    const keys = Object.keys(obj || {})
    return keys.find((k) => k === 'en') || keys.find((k) => k.startsWith('en') && k !== 'en-orig') || keys.find((k) => k.startsWith('en'))
  }
  for (const [obj, isManual] of [[info.subtitles, true], [info.automatic_captions, false]]) {
    const lang = pickLang(obj)
    if (!lang) continue
    const tracks = obj[lang]
    const track = tracks.find((t) => t.ext === 'json3') || tracks.find((t) => t.ext === 'vtt')
    if (track) return { ...track, isManual }
  }
  return null
}

// json3 is YouTube's raw caption event stream (what VTT/SRT are rendered
// from) — each event carries only its own new words, unlike the VTT export
// which repeats previous lines for its rolling on-screen display. That
// makes json3 trivial to turn into a clean transcript: concatenate every
// event's segs in order, no de-duplication needed.
async function extractJson3Transcript(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Could not download captions (${res.status}).`)
  const data = await res.json()
  const text = (data.events || [])
    .filter((e) => e.segs)
    .map((e) => e.segs.map((s) => s.utf8).join(''))
    .join('')
  return text.replace(/\n{2,}/g, '\n').trim()
}

async function extractVttTranscript(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Could not download captions (${res.status}).`)
  const vtt = await res.text()
  const lines = vtt.split('\n')
  const out = []
  let lastLine = null
  for (const raw of lines) {
    if (!raw.trim() || raw.startsWith('WEBVTT') || raw.startsWith('Kind:') || raw.startsWith('Language:')) continue
    if (/-->/.test(raw)) continue
    const clean = raw.replace(/<[^>]*>/g, '').trim()
    if (!clean) continue
    if (clean === lastLine) continue
    out.push(clean)
    lastLine = clean
  }
  return out.join(' ').trim()
}


export async function fetchYoutubeVideoMeta(url) {
  if (!isYoutubeUrl(url)) {
    throw new Error("That doesn't look like a youtube.com or youtu.be video URL.")
  }
  const info = await dumpJson(url)

  const captionTrack = pickCaptionTrack(info)
  if (!captionTrack) {
    throw new Error('No English captions/transcript found for this video — this importer needs one to work from.')
  }
  const transcript = captionTrack.ext === 'json3' ? await extractJson3Transcript(captionTrack.url) : await extractVttTranscript(captionTrack.url)
  if (!transcript) throw new Error("Couldn't extract any text from this video's captions.")

  return {
    videoId: info.id,
    title: info.title || info.id,
    channel: info.uploader || info.channel || '',
    thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
    sourceUrl: `https://youtu.be/${info.id}`,
    transcript,
  }
}

// Downloads via `yt-dlp` itself rather than resolving a format URL and
// fetching it directly — tried that first, but YouTube's CDN 403'd a plain
// fetch() against the exact same URL yt-dlp had just resolved (some
// combination of connection/retry/request-fingerprint behavior yt-dlp
// handles internally and a bare fetch doesn't). No `--extract-audio` here:
// an audio-only stream needs no muxing, so this stays ffmpeg-free, unlike
// the reference pipeline's mp3-transcoding version. m4a is requested first
// purely for playback compatibility (Safari has no WebM/Opus support),
// falling back to whatever audio-only stream is best if m4a isn't offered.
export async function fetchYoutubeAudioBuffer(url) {
  const dir = await mkdtemp(join(tmpdir(), 'yt-audio-'))
  try {
    await execFileAsync(YTDLP_BIN, ['-f', 'bestaudio[ext=m4a]/bestaudio', '--no-warnings', '-o', join(dir, 'audio.%(ext)s'), url], {
      timeout: YTDLP_AUDIO_TIMEOUT_MS,
      maxBuffer: YTDLP_MAX_BUFFER,
    })
    const files = await readdir(dir)
    if (!files.length) throw new Error('yt-dlp produced no audio file.')
    return await readFile(join(dir, files[0]))
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('yt-dlp is not installed on the server.')
    if (err.killed) throw new Error('Timed out downloading that video\'s audio.')
    throw err instanceof Error && err.message === 'yt-dlp produced no audio file.' ? err : new Error("Could not download this video's audio.")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
