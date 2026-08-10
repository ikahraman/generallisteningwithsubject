import { getAllSettings, setSetting, exportAllData, clearAllData } from '../db.js'
import { openModal, closeModal } from '../components/modal.js'
import { buildDataZip, readDataZip, restoreAudioFiles, importIntoDatabase } from '../utils/import-export.js'
import { downloadBlob, downloadJSON, timestampSlug, pickBestVoice } from '../utils/helpers.js'

const ACCENTS = [
  { id: 'indigo', hex: '#6366f1' },
  { id: 'rose', hex: '#f43f5e' },
  { id: 'emerald', hex: '#10b981' },
  { id: 'amber', hex: '#f59e0b' },
  { id: 'sky', hex: '#0ea5e9' },
]

// ---------- theme / accent application (called from main.js on boot too) ----------

let systemThemeListenerAttached = false

export function applyTheme(theme) {
  const resolveDark = () =>
    theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  document.body.classList.toggle('light-theme', !resolveDark())

  if (theme === 'system' && !systemThemeListenerAttached) {
    systemThemeListenerAttached = true
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (document.body.dataset.themePref === 'system') applyTheme('system')
    })
  }
  document.body.dataset.themePref = theme
}

export function applyAccent(accent) {
  document.body.dataset.accent = accent
}

// ---------- voices ----------

function loadVoices() {
  return new Promise((resolve) => {
    const existing = speechSynthesis.getVoices()
    if (existing.length) return resolve(existing)
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices())
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1000)
  })
}

// ---------- render ----------

export async function renderSettings(container) {
  const s = await getAllSettings()
  const voices = await loadVoices()
  const theme = s.theme || 'dark'
  const accent = s.accentColor || 'indigo'
  const apiKey = s.geminiApiKey || ''
  const bestVoice = pickBestVoice(voices)
  const defaultVoice = s.defaultVoice || (bestVoice ? `${bestVoice.name}::${bestVoice.lang}` : '')
  const defaultSpeed = s.defaultSpeed ?? 1
  const defaultTtsEngine = s.defaultTtsEngine || 'cloud'

  container.innerHTML = `
    <div class="page">
      <h1 class="section-title">Settings</h1>
      <div class="settings-grid">

        <div class="card">
          <h2 class="card-title">Appearance</h2>
          <div class="field">
            <span class="field-label">Theme</span>
            <div class="segmented" data-group="theme">
              ${['light', 'dark', 'system']
                .map((t) => `<button data-value="${t}" class="${t === theme ? 'active' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`)
                .join('')}
            </div>
          </div>
          <div class="field">
            <span class="field-label">Accent Color</span>
            <div class="swatches" data-group="accent">
              ${ACCENTS.map(
                (a) =>
                  `<button class="swatch ${a.id === accent ? 'active' : ''}" data-value="${a.id}" style="background:${a.hex}" aria-label="${a.id}"></button>`
              ).join('')}
            </div>
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">API &amp; Voice</h2>
          <div class="field">
            <label class="field-label" for="api-key">Gemini API Key</label>
            <div class="input-with-action">
              <input type="password" id="api-key" placeholder="Paste your Gemini API key" value="${escapeAttr(apiKey)}" autocomplete="off" />
              <button class="icon-btn" id="toggle-key" type="button" aria-label="Show key">👁</button>
            </div>
            <p class="card-hint">Stored locally in IndexedDB only. Never leaves your browser except in direct calls to Google's API.</p>
          </div>
          <div class="field">
            <span class="field-label">Default TTS Engine (for generating study audio)</span>
            <div class="segmented" data-group="tts-engine">
              <button data-value="cloud" class="${defaultTtsEngine === 'cloud' ? 'active' : ''}">Google Cloud TTS</button>
              <button data-value="edge" class="${defaultTtsEngine === 'edge' ? 'active' : ''}">Edge TTS</button>
            </div>
            <p class="card-hint">Used by Workspace's on-demand "Generate Speech" — Generate has its own per-material choice. Falls back to Gemini TTS automatically if this fails.</p>
          </div>
          <div class="field">
            <label class="field-label" for="voice-select">Default Browser Voice</label>
            <select id="voice-select">
              ${voices
                .map(
                  (v) =>
                    `<option value="${v.name}::${v.lang}" ${`${v.name}::${v.lang}` === defaultVoice ? 'selected' : ''}>${v.name} (${v.lang})</option>`
                )
                .join('') || '<option value="">No voices available</option>'}
            </select>
          </div>
          <div class="field">
            <label class="field-label" for="speed-range">Default Speech Speed: <span id="speed-value">${Number(defaultSpeed).toFixed(1)}x</span></label>
            <input type="range" id="speed-range" min="0.5" max="2" step="0.1" value="${defaultSpeed}" />
          </div>
        </div>

        <div class="card">
          <h2 class="card-title">Data</h2>
          <div class="field row">
            <div>
              <div>Export</div>
              <p class="card-hint">JSON is text-only. ZIP also bundles cached audio and supports an optional password.</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn" id="export-json">Export JSON</button>
              <button class="btn" id="export-zip">Export ZIP</button>
            </div>
          </div>
          <div class="field row">
            <div>
              <div>Import</div>
              <p class="card-hint">Restores materials, folders, tags, and settings from a previous export.</p>
            </div>
            <div>
              <button class="btn" id="import-btn">Import File</button>
              <input type="file" id="import-input" accept=".json,.zip" hidden />
            </div>
          </div>
          <div class="field row">
            <div>
              <div>Clear All Data</div>
              <p class="card-hint">Permanently deletes every material, folder, and setting.</p>
            </div>
            <button class="btn danger" id="clear-data">Clear Data</button>
          </div>
        </div>

      </div>
    </div>
  `

  wireEvents(container)
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}

function wireEvents(root) {
  root.querySelectorAll('[data-group="theme"] button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.value
      root.querySelectorAll('[data-group="theme"] button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      applyTheme(theme)
      await setSetting('theme', theme)
    })
  })

  root.querySelectorAll('[data-group="accent"] button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const accent = btn.dataset.value
      root.querySelectorAll('[data-group="accent"] button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      applyAccent(accent)
      await setSetting('accentColor', accent)
    })
  })

  root.querySelectorAll('[data-group="tts-engine"] button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      root.querySelectorAll('[data-group="tts-engine"] button').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      await setSetting('defaultTtsEngine', btn.dataset.value)
    })
  })

  const keyInput = root.querySelector('#api-key')
  keyInput.addEventListener('change', () => setSetting('geminiApiKey', keyInput.value.trim()))
  root.querySelector('#toggle-key').addEventListener('click', (e) => {
    const showing = keyInput.type === 'text'
    keyInput.type = showing ? 'password' : 'text'
    e.currentTarget.textContent = showing ? '👁' : '🙈'
  })

  root.querySelector('#voice-select').addEventListener('change', (e) => setSetting('defaultVoice', e.target.value))

  const speedRange = root.querySelector('#speed-range')
  const speedValue = root.querySelector('#speed-value')
  speedRange.addEventListener('input', () => {
    speedValue.textContent = `${Number(speedRange.value).toFixed(1)}x`
  })
  speedRange.addEventListener('change', () => setSetting('defaultSpeed', Number(speedRange.value)))

  root.querySelector('#export-json').addEventListener('click', async () => {
    const data = await exportAllData()
    downloadJSON(data, `academic-english-studio-${timestampSlug()}.json`)
  })

  root.querySelector('#export-zip').addEventListener('click', () => promptExportZip())

  const importInput = root.querySelector('#import-input')
  root.querySelector('#import-btn').addEventListener('click', () => importInput.click())
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0]
    if (file) await handleImportFile(file)
    importInput.value = ''
  })

  root.querySelector('#clear-data').addEventListener('click', () => confirmClearData())
}

// ---------- export ----------

function promptExportZip() {
  openModal({
    title: 'Export as ZIP',
    bodyHTML: `
      <p>Optionally protect the archive with a password (leave blank for none).</p>
      <div class="field" style="margin-top:12px;">
        <input type="password" id="export-pw" placeholder="Password (optional)" />
      </div>
    `,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Export',
        variant: 'primary',
        onClick: async () => {
          const password = document.getElementById('export-pw').value
          await runZipExport(password || null)
        },
      },
    ],
  })
}

async function runZipExport(password) {
  const data = await exportAllData()
  const zipBlob = await buildDataZip(data, password)
  downloadBlob(zipBlob, `academic-english-studio-${timestampSlug()}.zip`)
}

// ---------- import ----------

async function handleImportFile(file) {
  try {
    let data
    if (file.name.endsWith('.zip')) {
      const result = await readDataZip(await file.arrayBuffer(), promptPassword)
      if (result === null) return // user cancelled password prompt
      data = result.data
      await restoreAudioFiles(result.audioFiles)
    } else {
      data = JSON.parse(await file.text())
    }
    await importIntoDatabase(data)
    openModal({
      title: 'Import Complete',
      bodyHTML: '<p>Your data has been restored. The app will now reload.</p>',
      actions: [{ label: 'Reload', variant: 'primary', onClick: () => location.reload() }],
    })
  } catch (err) {
    openModal({
      title: 'Import Failed',
      bodyHTML: `<p>${err.message || 'The file could not be read.'}</p>`,
      actions: [{ label: 'Close' }],
    })
  }
}

function promptPassword(message) {
  return new Promise((resolve) => {
    openModal({
      title: 'Password Required',
      bodyHTML: `<p>${message}</p><div class="field" style="margin-top:12px;"><input type="password" id="pw-input" placeholder="Archive password" /></div>`,
      actions: [
        { label: 'Cancel', variant: 'ghost', onClick: () => resolve(null) },
        {
          label: 'Unlock',
          variant: 'primary',
          onClick: () => resolve(document.getElementById('pw-input').value),
        },
      ],
    })
  })
}

// ---------- clear all data ----------

function confirmClearData() {
  openModal({
    title: 'Clear All Data?',
    bodyHTML:
      '<p>This permanently deletes every material, folder, tag, audio file, and setting from this browser. This cannot be undone.</p>',
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Delete Everything',
        variant: 'danger',
        onClick: async () => {
          await clearAllData()
          closeModal()
          location.reload()
        },
        closeOnClick: false,
      },
    ],
  })
}
