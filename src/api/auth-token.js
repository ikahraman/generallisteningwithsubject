// Replaces nginx Basic Auth for /api and /synthesize (see server/index.js)
// — the browser's HTTP auth cache didn't reliably carry over to fetch()
// calls, especially on mobile, so the app could look loaded while every
// request silently failed. localStorage persists per-device far more
// reliably, and this only ever prompts once (on the first 401), not on
// every visit.
const STORAGE_KEY = 'apiToken'

const getToken = () => localStorage.getItem(STORAGE_KEY) || ''
const setToken = (token) => localStorage.setItem(STORAGE_KEY, token)

export async function fetchWithToken(url, options = {}) {
  const attempt = () =>
    fetch(url, { ...options, headers: { ...options.headers, 'X-Api-Token': getToken() } })

  let res = await attempt()
  if (res.status === 401) {
    setToken(window.prompt('Access password:') || '')
    res = await attempt()
  }
  return res
}
