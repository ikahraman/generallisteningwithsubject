// Minimal auto-dismissing toast — used to surface TTS engine fallbacks that
// would otherwise fail completely silently (e.g. Edge TTS unreachable,
// falling back to the browser voice with no visible sign anything changed).
let hideTimer = null

export function showToast(message) {
  let el = document.getElementById('app-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'app-toast'
    document.body.appendChild(el)
  }
  el.textContent = message
  el.classList.add('show')
  clearTimeout(hideTimer)
  hideTimer = setTimeout(() => el.classList.remove('show'), 3500)
}
