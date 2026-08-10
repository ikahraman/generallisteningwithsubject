import { getAllStudyLog, updateMaterial, deleteMaterial } from '../db.js'
import { openModal, closeModal } from '../components/modal.js'
import { buildDataZip, readDataZip, restoreAudioFiles, importIntoDatabase } from '../utils/import-export.js'
import { downloadBlob, timestampSlug } from '../utils/helpers.js'
import { selectedIds, materials, folders, tags, escapeHtml, removeMaterialsFromCache } from './library-state.js'

export function bulkBarHTML() {
  return `
    <div class="lib-bulk-bar">
      <span>${selectedIds.size} selected</span>
      <div class="actions">
        <button class="btn" id="bulk-export">Export ZIP</button>
        <button class="btn" id="bulk-move">Move to Folder</button>
        <button class="btn danger" id="bulk-delete">Delete</button>
        <button class="btn ghost" id="bulk-clear">Clear</button>
      </div>
    </div>
  `
}

/**
 * @param {HTMLElement} root
 * @param {{onGridRefresh: Function}} callbacks
 */
export function wireBulkBar(root, { onGridRefresh }) {
  root.querySelector('#bulk-export')?.addEventListener('click', () => promptBulkExport())
  root.querySelector('#bulk-move')?.addEventListener('click', () => promptBulkMove(root, onGridRefresh))
  root.querySelector('#bulk-delete')?.addEventListener('click', () => confirmBulkDelete(root, onGridRefresh))
  root.querySelector('#bulk-clear')?.addEventListener('click', () => {
    selectedIds.clear()
    onGridRefresh(root)
  })
}

function promptBulkExport() {
  openModal({
    title: `Export ${selectedIds.size} Material(s) as ZIP`,
    bodyHTML: `
      <p>Optionally protect the archive with a password (leave blank for none).</p>
      <div class="field" style="margin-top:12px;"><input type="password" id="export-pw" placeholder="Password (optional)" /></div>
    `,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Export',
        variant: 'primary',
        onClick: async () => {
          const password = document.getElementById('export-pw').value || null
          await runBulkExport(password)
        },
      },
    ],
  })
}

async function runBulkExport(password) {
  const selected = materials.filter((m) => selectedIds.has(m.id))
  const folderIds = new Set(selected.map((m) => m.folderId).filter(Boolean))
  const tagNames = new Set(selected.flatMap((m) => m.tags || []))
  const allLog = await getAllStudyLog()

  const data = {
    materials: selected,
    folders: folders.filter((f) => folderIds.has(f.id)),
    tags: tags.filter((t) => tagNames.has(t.name)),
    studyLog: allLog.filter((s) => selectedIds.has(s.materialId)),
    exportedAt: new Date().toISOString(),
  }
  const blob = await buildDataZip(data, password)
  downloadBlob(blob, `materials-${timestampSlug()}.zip`)
}

function promptBulkMove(root, onGridRefresh) {
  openModal({
    title: 'Move to Folder',
    bodyHTML: `
      <div class="field">
        <select id="bulk-move-target">
          <option value="">Unfiled</option>
          ${folders.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}
        </select>
      </div>
    `,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Move',
        variant: 'primary',
        onClick: async () => {
          const value = document.getElementById('bulk-move-target').value
          const folderId = value ? Number(value) : null
          await Promise.all(
            [...selectedIds].map(async (id) => {
              await updateMaterial(id, { folderId })
              const m = materials.find((x) => x.id === id)
              if (m) m.folderId = folderId
            })
          )
          selectedIds.clear()
          onGridRefresh(root)
        },
      },
    ],
  })
}

function confirmBulkDelete(root, onGridRefresh) {
  openModal({
    title: `Delete ${selectedIds.size} Material(s)?`,
    bodyHTML: '<p>This permanently deletes the selected materials and their cached audio.</p>',
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Delete',
        variant: 'danger',
        onClick: async () => {
          await Promise.all([...selectedIds].map((id) => deleteMaterial(id)))
          removeMaterialsFromCache(selectedIds)
          selectedIds.clear()
          onGridRefresh(root)
        },
      },
    ],
  })
}

// ---------- import ----------

export async function handleLibraryImport(root, file, onFullRefresh) {
  try {
    let data
    if (file.name.endsWith('.zip')) {
      const result = await readDataZip(await file.arrayBuffer(), promptPassword)
      if (result === null) return
      data = result.data
      await restoreAudioFiles(result.audioFiles)
    } else {
      data = JSON.parse(await file.text())
    }
    await importIntoDatabase(data)
    closeModal()
    await onFullRefresh(root)
  } catch (err) {
    openModal({
      title: 'Import Failed',
      bodyHTML: `<p>${escapeHtml(err.message || 'The file could not be read.')}</p>`,
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
        { label: 'Unlock', variant: 'primary', onClick: () => resolve(document.getElementById('pw-input').value) },
      ],
    })
  })
}
