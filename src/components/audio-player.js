const SPEEDS = [0.75, 0.85, 0.9, 0.95, 1, 1.15, 1.25, 1.4, 1.5]

export function audioPlayerHTML(currentRate = 1) {
  const closest = SPEEDS.reduce((best, r) => (Math.abs(r - currentRate) < Math.abs(best - currentRate) ? r : best), SPEEDS[0])
  return `
    <div class="audio-player">
      <button class="icon-btn" id="ap-play" aria-label="Play">▶</button>
      <div class="ap-progress" id="ap-progress">
        <div class="ap-progress-bar" id="ap-bar"></div>
      </div>
      <span class="ap-time" id="ap-time">0:00</span>
      <select id="ap-speed" class="ap-speed" title="Speed">
        ${SPEEDS.map((r) => `<option value="${r}" ${r === closest ? 'selected' : ''}>${r}x</option>`).join('')}
      </select>
      <button class="icon-btn" id="ap-repeat-sentence" title="Repeat sentence">↺S</button>
      <button class="icon-btn" id="ap-repeat-paragraph" title="Repeat paragraph">↺P</button>
      <button class="icon-btn" id="ap-download" title="Download audio">⬇</button>
    </div>
  `
}

/**
 * Wires an audio-player DOM fragment (from audioPlayerHTML) to a MaterialPlayer.
 * @param {HTMLElement} root
 * @param {import('../api/material-player.js').MaterialPlayer} player
 * @param {{onDownload?: Function, onGenerateAndDownload?: () => Promise<void>}} opts
 */
export function wireAudioPlayer(root, player, opts = {}) {
  const playBtn = root.querySelector('#ap-play')
  const progress = root.querySelector('#ap-progress')
  const bar = root.querySelector('#ap-bar')
  const timeEl = root.querySelector('#ap-time')
  const speedSel = root.querySelector('#ap-speed')
  const downloadBtn = root.querySelector('#ap-download')

  playBtn.addEventListener('click', () => player.togglePlay())
  speedSel.addEventListener('change', () => player.setRate(Number(speedSel.value)))
  root.querySelector('#ap-repeat-sentence').addEventListener('click', () => player.repeatSentence())
  root.querySelector('#ap-repeat-paragraph').addEventListener('click', () => player.repeatParagraph())

  if (player.mode === 'audio') {
    progress.addEventListener('click', (e) => {
      const rect = progress.getBoundingClientRect()
      const pct = (e.clientX - rect.left) / rect.width
      if (player.audio.duration) player.audio.currentTime = pct * player.audio.duration
    })
  }

  if (player.mode === 'audio' && opts.onDownload) {
    downloadBtn.addEventListener('click', () => opts.onDownload(player.audioBlobRef))
  } else if (player.mode === 'browser' && opts.onGenerateAndDownload) {
    downloadBtn.textContent = '⚡'
    downloadBtn.title = 'Generate audio with Gemini TTS, cache it, and download'
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true
      downloadBtn.textContent = '…'
      try {
        await opts.onGenerateAndDownload()
      } finally {
        downloadBtn.disabled = false
        downloadBtn.textContent = '⚡'
      }
    })
  } else {
    downloadBtn.disabled = true
    downloadBtn.title = 'No cached audio for this material'
  }

  player.addEventListener('playstate', (e) => {
    playBtn.textContent = e.detail.playing ? '⏸' : '▶'
  })
  player.addEventListener('timeupdate', (e) => {
    const pct = e.detail.duration ? (e.detail.currentTime / e.detail.duration) * 100 : 0
    bar.style.width = `${Math.min(100, pct)}%`
    timeEl.textContent =
      player.mode === 'audio'
        ? formatTime(e.detail.currentTime)
        : `${e.detail.currentTime + 1}/${e.detail.duration}`
  })
  player.addEventListener('ended', () => {
    playBtn.textContent = '▶'
    bar.style.width = '0%'
  })
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
