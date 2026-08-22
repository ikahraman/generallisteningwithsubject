// yt-dlp version/update status for the "yt-dlp Status" page — surfaces the
// same update this server already depends on (server/youtube.js) so a
// datacenter-IP block that a newer yt-dlp release fixes (as one already
// did once, see git history) doesn't go unnoticed until someone happens to
// SSH in and check by hand.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const execFileAsync = promisify(execFile)
const YTDLP_BIN = process.env.YTDLP_PATH || 'yt-dlp'
// Mirrors YTDLP_PATH's own local-dev-vs-deployed split: on the VDS this is
// the same venv's pip (no sudo needed — the venv is deploy-owned); plain
// "pip" resolves via PATH for local dev, wherever yt-dlp itself came from.
const PIP_BIN = process.env.YTDLP_PIP_PATH || 'pip'
const UPDATE_LOG_PATH = process.env.YTDLP_UPDATE_LOG || path.join(process.env.DATA_DIR || '.', 'ytdlp-update.log')
const PYPI_TIMEOUT_MS = 10000
const UPDATE_TIMEOUT_MS = 60000

export async function getCurrentVersion() {
  try {
    const { stdout } = await execFileAsync(YTDLP_BIN, ['--version'], { timeout: 10000 })
    return stdout.trim()
  } catch {
    return null
  }
}

export async function getLatestVersion() {
  const res = await fetch('https://pypi.org/pypi/yt-dlp/json', { signal: AbortSignal.timeout(PYPI_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`PyPI lookup failed (HTTP ${res.status}).`)
  const data = await res.json()
  return data.info?.version || null
}

async function getUpdateLog() {
  try {
    const text = await readFile(UPDATE_LOG_PATH, 'utf-8')
    // Last ~2 update runs' worth, not the whole (possibly long-lived) file.
    return text.split('\n').slice(-60).join('\n')
  } catch {
    return ''
  }
}

async function getUpdateLogModifiedAt() {
  try {
    return (await stat(UPDATE_LOG_PATH)).mtime.toISOString()
  } catch {
    return null
  }
}

// yt-dlp's own `--version` output zero-pads (e.g. "2026.08.19") while
// PyPI's metadata doesn't ("2026.8.19") — same release, different
// formatting, so a plain string compare falsely flags an "update available"
// for every already-up-to-date install. Compare the dot-separated segments
// as numbers instead.
function versionsDiffer(a, b) {
  if (!a || !b) return false
  const segs = (v) => v.split('.').map((s) => parseInt(s, 10))
  const [x, y] = [segs(a), segs(b)]
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i++) {
    if ((x[i] || 0) !== (y[i] || 0)) return true
  }
  return false
}

export async function getStatus() {
  const [currentVersion, latestResult, log, lastCheckedAt] = await Promise.all([
    getCurrentVersion(),
    getLatestVersion().catch((err) => ({ error: err.message })),
    getUpdateLog(),
    getUpdateLogModifiedAt(),
  ])
  const latestVersion = typeof latestResult === 'string' ? latestResult : null
  return {
    currentVersion,
    latestVersion,
    latestVersionError: latestResult?.error || null,
    updateAvailable: versionsDiffer(currentVersion, latestVersion),
    log,
    lastCheckedAt,
  }
}

// Same command the weekly cron job runs (see deploy notes) — exposed here
// too so "check now" doesn't mean waiting up to a week to find out whether
// it actually helped.
export async function runUpdate() {
  let stdout = '', stderr = ''
  try {
    ;({ stdout, stderr } = await execFileAsync(PIP_BIN, ['install', '--upgrade', 'yt-dlp'], {
      timeout: UPDATE_TIMEOUT_MS,
    }))
  } catch (err) {
    stdout = err.stdout || ''
    stderr = err.stderr || err.message
  }
  return { output: [stdout, stderr].filter(Boolean).join('\n'), status: await getStatus() }
}
