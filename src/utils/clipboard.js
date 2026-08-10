// navigator.clipboard requires a secure context (HTTPS or localhost) — this
// app is currently served over plain HTTP on a bare IP (no DNS/SSL set up
// yet), where that API is simply undefined, so writeText() calls were
// silently doing nothing. Falls back to the older select()+execCommand
// ('copy') trick, which has no such restriction, so Copy buttons keep
// working until real SSL is in place.
export async function copyText(text, sourceEl) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy fallback below
    }
  }
  if (sourceEl) {
    sourceEl.focus()
    sourceEl.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  }
  return false
}
