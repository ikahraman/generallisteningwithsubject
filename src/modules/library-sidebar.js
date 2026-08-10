import { addFolder, renameFolder, deleteFolder, addTag, deleteTag, updateMaterial } from '../db.js'
import { openModal } from '../components/modal.js'
import { filters, materials, folders, tags, escapeHtml, escapeAttr } from './library-state.js'

export function sidebarHTML() {
  return `
    <div class="lib-sidebar-section">
      <h3>Folders</h3>
      <div class="lib-folder-list">
        <div class="lib-folder-item ${filters.folderId === 'all' ? 'active' : ''}" data-folder="all"><span class="lib-folder-name">All Materials</span></div>
        <div class="lib-folder-item ${filters.folderId === 'unfiled' ? 'active' : ''}" data-folder="unfiled"><span class="lib-folder-name">Unfiled</span></div>
        ${folders
          .map(
            (f) => `
          <div class="lib-folder-item ${filters.folderId === f.id ? 'active' : ''}" data-folder="${f.id}">
            <span class="lib-folder-name">${escapeHtml(f.name)}</span>
            <span class="lib-folder-actions">
              <button data-rename-folder="${f.id}" title="Rename">✎</button>
              <button data-delete-folder="${f.id}" title="Delete">🗑</button>
            </span>
          </div>`
          )
          .join('')}
      </div>
      <button class="btn ghost" id="lib-new-folder">+ New Folder</button>
    </div>
    <div class="lib-sidebar-section">
      <h3>Tags</h3>
      <div class="lib-tag-list">
        ${
          tags
            .map(
              (t) => `
          <span class="tag-chip ${filters.tagNames.has(t.name) ? 'active' : ''}" data-tag="${escapeAttr(t.name)}">
            ${escapeHtml(t.name)} <span class="tag-remove" data-delete-tag="${t.id}" data-tag-name="${escapeAttr(t.name)}">×</span>
          </span>`
            )
            .join('') || '<p class="text-muted" style="font-size:0.85rem;">No tags yet.</p>'
        }
      </div>
      <button class="btn ghost" id="lib-new-tag">+ New Tag</button>
    </div>
  `
}

/**
 * @param {HTMLElement} root
 * @param {{onFullRefresh: Function, onFilterChange: Function}} callbacks
 */
export function wireSidebar(root, { onFullRefresh, onFilterChange }) {
  root.querySelectorAll('[data-folder]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-rename-folder],[data-delete-folder]')) return
      const val = el.dataset.folder
      filters.folderId = val === 'all' || val === 'unfiled' ? val : Number(val)
      onFilterChange(root)
    })
  })
  root.querySelectorAll('[data-rename-folder]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      promptRenameFolder(root, Number(btn.dataset.renameFolder), onFullRefresh)
    })
  })
  root.querySelectorAll('[data-delete-folder]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      confirmDeleteFolder(root, Number(btn.dataset.deleteFolder), onFullRefresh)
    })
  })
  root.querySelector('#lib-new-folder').addEventListener('click', () => promptNewFolder(root, onFullRefresh))

  root.querySelectorAll('[data-tag]').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('[data-delete-tag]')) return
      const name = chip.dataset.tag
      if (filters.tagNames.has(name)) filters.tagNames.delete(name)
      else filters.tagNames.add(name)
      onFilterChange(root)
    })
  })
  root.querySelectorAll('[data-delete-tag]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await handleDeleteTag(Number(btn.dataset.deleteTag), btn.dataset.tagName)
      await onFullRefresh(root)
    })
  })
  root.querySelector('#lib-new-tag').addEventListener('click', () => promptNewTag(root, onFullRefresh))
}

function promptNewFolder(root, onFullRefresh) {
  openModal({
    title: 'New Folder',
    bodyHTML: `<div class="field"><input type="text" id="folder-name-input" placeholder="Folder name" /></div>`,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Create',
        variant: 'primary',
        onClick: async () => {
          const name = document.getElementById('folder-name-input').value.trim()
          if (!name) return
          await addFolder(name)
          await onFullRefresh(root)
        },
      },
    ],
  })
}

function promptRenameFolder(root, id, onFullRefresh) {
  const folder = folders.find((f) => f.id === id)
  openModal({
    title: 'Rename Folder',
    bodyHTML: `<div class="field"><input type="text" id="folder-name-input" value="${escapeAttr(folder?.name || '')}" /></div>`,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Save',
        variant: 'primary',
        onClick: async () => {
          const name = document.getElementById('folder-name-input').value.trim()
          if (!name) return
          await renameFolder(id, name)
          await onFullRefresh(root)
        },
      },
    ],
  })
}

function confirmDeleteFolder(root, id, onFullRefresh) {
  openModal({
    title: 'Delete Folder?',
    bodyHTML: '<p>Materials inside will be moved to Unfiled. This cannot be undone.</p>',
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Delete',
        variant: 'danger',
        onClick: async () => {
          await deleteFolder(id)
          if (filters.folderId === id) filters.folderId = 'all'
          await onFullRefresh(root)
        },
      },
    ],
  })
}

function promptNewTag(root, onFullRefresh) {
  openModal({
    title: 'New Tag',
    bodyHTML: `<div class="field"><input type="text" id="tag-name-input" placeholder="Tag name" /></div>`,
    actions: [
      { label: 'Cancel', variant: 'ghost' },
      {
        label: 'Create',
        variant: 'primary',
        onClick: async () => {
          const name = document.getElementById('tag-name-input').value.trim()
          if (!name) return
          await addTag(name)
          await onFullRefresh(root)
        },
      },
    ],
  })
}

async function handleDeleteTag(tagId, tagName) {
  await deleteTag(tagId)
  const affected = materials.filter((m) => (m.tags || []).includes(tagName))
  await Promise.all(
    affected.map((m) => updateMaterial(m.id, { tags: (m.tags || []).filter((t) => t !== tagName) }))
  )
  filters.tagNames.delete(tagName)
}
