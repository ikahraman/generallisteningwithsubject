// YouTube Channels: a top-level list of added playlists ("channels" here
// really means "an added playlist" — see server/youtube.js), each opened
// into its own page showing that playlist's videos as a checklist. Checking
// videos and hitting "Generate Selected" batch-generates study material for
// them, reusing the exact same pipeline as youtube-content.js (single-video
// import) one video at a time, sequentially.
import { getSetting, addMaterial, addChannel, getAllChannels, deleteChannel, updateChannelVideo, importYoutubeVideo, saveYoutubeAudio } from '../db.js'
import { generateMaterialJSON } from '../api/gemini.js'
import { parseGeminiMaterialJSON } from '../utils/validators.js'
import { countWords, estimateDuration, splitSentences } from '../utils/helpers.js'
import { buildTranscriptAnalysisPrompt } from './transcript-analysis-prompt.js'
import { openModal } from '../components/modal.js'

const LEVELS = ['A1+', 'A2', 'B1', 'B2', 'C1', 'C2']
const YOUTUBE_MODE = 'careful'
const CHANNEL_VIEW_KEY = 'yt-channels-list-view-mode'
const VIDEO_VIEW_KEY = 'yt-channels-video-view-mode'

let channels = []
let channelViewMode = localStorage.getItem(CHANNEL_VIEW_KEY) === 'detail' ? 'detail' : 'list'
let videoViewMode = localStorage.getItem(VIDEO_VIEW_KEY) === 'detail' ? 'detail' : 'list'
let newUrl = ''
let newLevel = 'B1'
let isAddingChannel = false
let addError = ''
// Set of "channelId:videoId" keys — session-only selection state, not persisted.
let selected = new Set()
let isGenerating = false
let generateProgress = '' // e.g. "3/12: <title>"
// The one video actually in flight right now (if any), as "channelId:videoId"
// — distinct from a video's persisted status: a 'generating' status can also
// mean "a previous browser session was closed/crashed mid-request," which
// this same client has no way to confirm is still running, so only THIS
// key is treated as truly unselectable. A stale 'generating' row is
// otherwise re-checkable, or it would be stuck forever with no way to retry.
let activeKey = null

// ---------- top-level: list of added playlists ----------

export async function renderYoutubeChannels(container) {
  channels = await getAllChannels()

  container.innerHTML = `
    <div class="page">
      <h1 class="section-title">YouTube Channels</h1>
      <p class="card-hint" style="margin-bottom: var(--space-6);">
        Add a playlist link below. Open it to see its videos as a checklist, check the ones you want, and generate study material for all of them in one go — same real transcript + real audio pipeline as YouTube Content.
      </p>

      <div class="card">
        <div class="field row">
          <div style="flex:2;">
            <label class="field-label" for="ytc-url">Playlist URL</label>
            <input type="text" id="ytc-url" placeholder="https://www.youtube.com/playlist?list=..." value="${escapeAttr(newUrl)}" />
          </div>
          <div style="flex:1;">
            <label class="field-label" for="ytc-level">Level (applies to every video in this playlist)</label>
            <select id="ytc-level">
              ${LEVELS.map((l) => `<option ${l === newLevel ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        ${addError ? `<div class="banner error" style="margin-top:10px;">${escapeHtml(addError)}</div>` : ''}
        <button class="btn primary" id="ytc-add" ${isAddingChannel ? 'disabled' : ''} style="margin-top:10px;">
          ${isAddingChannel ? spinnerHTML() + 'Reading playlist…' : 'Add Playlist'}
        </button>
      </div>

      ${
        channels.length
          ? `<div class="segmented" data-group="ytc-channel-view" style="margin-bottom: var(--space-4);">
              <button data-value="list" class="${channelViewMode === 'list' ? 'active' : ''}">List</button>
              <button data-value="detail" class="${channelViewMode === 'detail' ? 'active' : ''}">Detailed</button>
            </div>`
          : ''
      }
      ${channelViewMode === 'list' ? channelListHTML() : channelGridHTML()}
      ${!channels.length ? '<p class="card-hint">No playlists added yet.</p>' : ''}
    </div>
  `

  wireTopLevelEvents(container)
}

function channelProgress(channel) {
  const done = channel.videos.filter((v) => v.status === 'done').length
  return { done, total: channel.videos.length }
}

function channelListHTML() {
  return `
    <div class="card">
      <div style="display:flex; flex-direction:column; gap:2px;">
        ${channels.map(channelRowHTML).join('')}
      </div>
    </div>
  `
}

function channelRowHTML(channel) {
  const { done, total } = channelProgress(channel)
  const cover = channel.videos[0]?.thumbnail
  return `
    <div class="row" data-channel-link="${channel.id}" style="align-items:center; gap:10px; padding:8px 4px; border-radius:6px; cursor:pointer;">
      ${cover ? `<img src="${escapeAttr(cover)}" alt="" style="width:64px; height:36px; object-fit:cover; border-radius:4px; flex-shrink:0;" />` : ''}
      <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600;">${escapeHtml(channel.title)}</span>
      <span class="badge level">${channel.level}</span>
      <span class="badge">${total} videos</span>
      <span class="badge" title="Study materials generated so far">${done}/${total} generated</span>
      <button class="icon-btn" data-delete-channel="${channel.id}" title="Remove playlist" aria-label="Remove playlist">🗑</button>
    </div>
  `
}

function channelGridHTML() {
  return `<div class="lib-grid">${channels.map(channelCardHTML).join('')}</div>`
}

function channelCardHTML(channel) {
  const { done, total } = channelProgress(channel)
  const cover = channel.videos[0]?.thumbnail
  return `
    <div class="material-card" data-channel-link="${channel.id}" style="cursor:pointer;">
      <div class="card-top-row">
        <span class="badge level">${channel.level}</span>
        <button class="icon-btn" data-delete-channel="${channel.id}" title="Remove playlist" aria-label="Remove playlist">🗑</button>
      </div>
      ${cover ? `<img src="${escapeAttr(cover)}" alt="" style="width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:6px; margin:6px 0;" />` : ''}
      <h3 class="card-title-sm">${escapeHtml(channel.title)}</h3>
      <p class="card-meta">${total} videos · ${done}/${total} generated</p>
    </div>
  `
}

function wireTopLevelEvents(root) {
  root.querySelector('#ytc-url')?.addEventListener('input', (e) => (newUrl = e.target.value))
  root.querySelector('#ytc-level')?.addEventListener('change', (e) => (newLevel = e.target.value))
  root.querySelector('#ytc-add')?.addEventListener('click', () => handleAddChannel(root))

  root.querySelectorAll('[data-group="ytc-channel-view"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      channelViewMode = btn.dataset.value
      localStorage.setItem(CHANNEL_VIEW_KEY, channelViewMode)
      renderYoutubeChannels(root)
    })
  })

  root.querySelectorAll('[data-delete-channel]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      confirmDeleteChannel(root, Number(btn.dataset.deleteChannel), () => renderYoutubeChannels(root))
    })
  })

  root.querySelectorAll('[data-channel-link]').forEach((el) => {
    el.addEventListener('click', () => {
      location.hash = `#/youtube-channels/${el.dataset.channelLink}`
    })
  })
}

async function handleAddChannel(root) {
  if (!newUrl.trim()) {
    addError = 'Please paste a playlist URL first.'
    return renderYoutubeChannels(root)
  }
  isAddingChannel = true
  addError = ''
  await renderYoutubeChannels(root)

  try {
    await addChannel(newUrl.trim(), newLevel)
    newUrl = ''
  } catch (err) {
    addError = err.message || 'Could not read that playlist.'
  } finally {
    isAddingChannel = false
    await renderYoutubeChannels(root)
  }
}

function confirmDeleteChannel(root, channelId, onDeleted) {
  const channel = channels.find((c) => c.id === channelId)
  openModal({
    title: 'Remove Playlist?',
    bodyHTML: `<p>"${escapeHtml(channel?.title || '')}" will be removed from this list. Materials you've already generated from it are kept — only the checklist itself is removed.</p>`,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Remove',
        variant: 'danger',
        onClick: async () => {
          await deleteChannel(channelId)
          for (const key of [...selected]) {
            if (key.startsWith(`${channelId}:`)) selected.delete(key)
          }
          await onDeleted()
        },
      },
    ],
  })
}

// ---------- detail: one playlist's videos as a checklist ----------

export async function renderYoutubeChannelDetail(container, channelId) {
  const apiKey = await getSetting('geminiApiKey', '')
  channels = await getAllChannels()
  const channel = channels.find((c) => c.id === channelId)

  if (!channel) {
    container.innerHTML = `
      <div class="page">
        <a class="btn ghost" href="#/youtube-channels">&larr; All Channels</a>
        <p class="card-hint" style="margin-top:12px;">That playlist isn't in your list any more.</p>
      </div>
    `
    return
  }

  const { done, total } = channelProgress(channel)
  const count = selected.size

  container.innerHTML = `
    <div class="page">
      <a class="btn ghost" href="#/youtube-channels">&larr; All Channels</a>
      <div class="row" style="justify-content:space-between; align-items:center; margin-top:12px; flex-wrap:wrap; gap:10px;">
        <h1 class="section-title" style="margin-bottom:0;">${escapeHtml(channel.title)}</h1>
        <div class="row" style="gap:8px;">
          <span class="badge level">${channel.level}</span>
          <span class="badge">${total} videos</span>
          <span class="badge">${done}/${total} generated</span>
        </div>
      </div>

      ${!apiKey ? `<div class="banner warning" style="margin-top:12px;">No Gemini API key set. <a href="#/settings">Add one in Settings</a> to generate material.</div>` : ''}

      <div class="row" style="justify-content:space-between; align-items:center; margin:var(--space-4) 0; flex-wrap:wrap; gap:10px;">
        <div class="segmented" data-group="ytc-video-view">
          <button data-value="list" class="${videoViewMode === 'list' ? 'active' : ''}">List</button>
          <button data-value="detail" class="${videoViewMode === 'detail' ? 'active' : ''}">Detailed</button>
        </div>
        <button class="btn primary" id="ytc-generate" ${!count || isGenerating || !apiKey ? 'disabled' : ''}>
          ${isGenerating ? spinnerHTML() + (generateProgress || 'Generating…') : `Generate Selected${count ? ` (${count})` : ''}`}
        </button>
      </div>

      <div class="card">
        ${videoViewMode === 'list' ? videoListHTML(channel) : videoGridHTML(channel)}
      </div>
    </div>
  `

  wireDetailEvents(container, channelId)
}

function videoListHTML(channel) {
  return `
    <div style="display:flex; flex-direction:column; gap:2px;">
      ${channel.videos.map((v) => videoRowHTML(channel, v)).join('')}
    </div>
  `
}

function videoRowHTML(channel, v) {
  const key = `${channel.id}:${v.videoId}`
  const checked = selected.has(key)
  const disabled = v.status === 'done' || key === activeKey
  return `
    <label class="row" style="align-items:center; gap:10px; padding:6px 4px; border-radius:6px;" title="${escapeAttr(v.title)}">
      <input type="checkbox" data-video="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
      <img src="${escapeAttr(v.thumbnail)}" alt="" style="width:48px; height:27px; object-fit:cover; border-radius:4px; flex-shrink:0;" />
      <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(v.title)}</span>
      <span class="card-meta text-muted" style="flex-shrink:0;">${formatDuration(v.duration)}</span>
      ${statusBadgeHTML(v, key === activeKey)}
    </label>
  `
}

function videoGridHTML(channel) {
  return `
    <div class="lib-grid">
      ${channel.videos.map((v) => videoCardHTML(channel, v)).join('')}
    </div>
  `
}

function videoCardHTML(channel, v) {
  const key = `${channel.id}:${v.videoId}`
  const checked = selected.has(key)
  const disabled = v.status === 'done' || key === activeKey
  return `
    <div class="material-card">
      <div class="card-top-row">
        <label class="card-select"><input type="checkbox" data-video="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} /></label>
        ${statusBadgeHTML(v, key === activeKey)}
      </div>
      <img src="${escapeAttr(v.thumbnail)}" alt="" style="width:100%; aspect-ratio:16/9; object-fit:cover; border-radius:6px; margin:6px 0;" />
      <h3 class="card-title-sm">${escapeHtml(v.title)}</h3>
      <p class="card-meta">${formatDuration(v.duration)}</p>
    </div>
  `
}

function statusBadgeHTML(v, isActive) {
  if (isActive) return `<span class="badge">${spinnerHTML()}Generating…</span>`
  if (v.status === 'generating') return `<span class="badge" style="color:var(--danger);" title="A previous attempt was interrupted (tab closed or crashed) before it finished — check it again to retry.">⚠ Interrupted — recheck to retry</span>`
  if (v.status === 'done') return `<a class="badge" href="#/workspace/${v.materialId}">✓ Open</a>`
  if (v.status === 'error') return `<span class="badge" style="color:var(--danger);" title="${escapeAttr(v.error || '')}">⚠ Failed</span>`
  return ''
}

function wireDetailEvents(root, channelId) {
  root.querySelectorAll('[data-group="ytc-video-view"] button').forEach((btn) => {
    btn.addEventListener('click', () => {
      videoViewMode = btn.dataset.value
      localStorage.setItem(VIDEO_VIEW_KEY, videoViewMode)
      renderYoutubeChannelDetail(root, channelId)
    })
  })

  root.querySelector('#ytc-generate')?.addEventListener('click', () => handleGenerateSelected(root, channelId))

  root.querySelectorAll('[data-video]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const key = cb.dataset.video
      if (cb.checked) selected.add(key)
      else selected.delete(key)
      // Only the generate button's enabled/count state needs refreshing —
      // a full re-render here would fight the checkbox's own native toggle.
      const btn = root.querySelector('#ytc-generate')
      if (btn) {
        btn.disabled = !selected.size || isGenerating
        btn.textContent = `Generate Selected${selected.size ? ` (${selected.size})` : ''}`
      }
    })
  })
}

// ---------- batch generation ----------

async function handleGenerateSelected(root, channelId) {
  const apiKey = await getSetting('geminiApiKey', '')
  if (!apiKey) return

  const queue = [...selected]
    .map((key) => {
      const [cId, videoId] = [Number(key.split(':')[0]), key.slice(key.indexOf(':') + 1)]
      const channel = channels.find((c) => c.id === cId)
      const video = channel?.videos.find((v) => v.videoId === videoId)
      return channel && video ? { channel, video } : null
    })
    .filter(Boolean)
  if (!queue.length) return

  isGenerating = true
  for (let i = 0; i < queue.length; i++) {
    const { channel, video } = queue[i]
    const key = `${channel.id}:${video.videoId}`
    generateProgress = `${i + 1}/${queue.length}: ${video.title}`
    selected.delete(key)
    activeKey = key
    video.status = 'generating'
    await renderYoutubeChannelDetail(root, channelId)
    await updateChannelVideo(channel.id, video.videoId, { status: 'generating' })

    try {
      const materialId = await generateOneVideo(channel, video, apiKey)
      video.status = 'done'
      video.materialId = materialId
      await updateChannelVideo(channel.id, video.videoId, { status: 'done', materialId, error: null })
    } catch (err) {
      video.status = 'error'
      video.error = err.message || 'Generation failed.'
      await updateChannelVideo(channel.id, video.videoId, { status: 'error', error: video.error })
    } finally {
      activeKey = null
    }
    await renderYoutubeChannelDetail(root, channelId)
  }
  isGenerating = false
  generateProgress = ''
  await renderYoutubeChannelDetail(root, channelId)
}

// Same steps as youtube-content.js's handleGenerate, minus the UI/preview
// step in between — the playlist listing already gave us title/thumbnail,
// so this goes straight from videoId to a finished material.
async function generateOneVideo(channel, video, apiKey) {
  const sourceUrl = `https://youtu.be/${video.videoId}`
  const imported = await importYoutubeVideo(sourceUrl)

  const prompt = buildTranscriptAnalysisPrompt({
    title: imported.title,
    transcript: imported.transcript,
    sourceUrl: imported.sourceUrl,
    level: channel.level,
    sourceLabel: 'YouTube video',
    artifactNote: 'obvious auto-caption artifacts (missing punctuation, an obviously wrong word if the context makes the correct one unambiguous)',
  })
  const raw = await generateMaterialJSON(apiKey, prompt)
  const parsed = parseGeminiMaterialJSON(raw)
  parsed.paragraphs = parsed.paragraphs.map((p) => ({ text: p.text, sentences: splitSentences(p.text) }))

  const wordCount = countWords(parsed.transcript)
  const material = {
    title: parsed.title,
    topic: 'YouTube',
    subtopic: imported.title,
    level: channel.level,
    mode: YOUTUBE_MODE,
    wordCount,
    duration: estimateDuration(wordCount),
    transcript: parsed.transcript,
    summary: parsed.summary,
    paragraphs: parsed.paragraphs,
    questions: parsed.questions,
    vocabulary: parsed.vocabulary,
    expressions: parsed.expressions,
    grammar: parsed.grammar,
    shadowing: parsed.shadowing,
    notes: '',
    bookmarks: [],
    userAnswers: { groupA: {}, groupB: {}, groupC: {} },
    earTrainingAnswers: {},
    sourceUrl: imported.sourceUrl,
    contentSource: 'Gemini (YouTube transcript)',
  }

  const id = await addMaterial(material)
  try {
    await saveYoutubeAudio(id, imported.sourceUrl)
  } catch {
    // Non-fatal, same as youtube-content.js: material is saved either way,
    // Workspace falls back to browser TTS if no audio track got attached.
  }
  return id
}

function formatDuration(seconds) {
  if (typeof seconds !== 'number') return '--:--'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function spinnerHTML() {
  return '<span class="spinner"></span> '
}
function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
