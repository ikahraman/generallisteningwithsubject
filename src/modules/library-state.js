// Shared mutable state for the Library module, split out so library.js,
// library-sidebar.js, and library-bulk.js can all read/mutate it without
// a circular import between the split files.
import Fuse from 'fuse.js'

export const filters = { folderId: 'all', tagNames: new Set(), level: '', mode: '', favoritesOnly: false, search: '' }
export const selectedIds = new Set()

export let sortBy = 'date-desc'
export function setSortBy(value) {
  sortBy = value
}

export let materials = []
export let folders = []
export let tags = []
export let fuse = null

export function setLibraryData(newMaterials, newFolders, newTags) {
  materials = newMaterials
  folders = newFolders
  tags = newTags
  fuse = new Fuse(materials, { keys: ['title', 'topic', 'subtopic'], threshold: 0.35 })
}

export function removeMaterialsFromCache(ids) {
  const idSet = ids instanceof Set ? ids : new Set(ids)
  materials = materials.filter((m) => !idSet.has(m.id))
  fuse = new Fuse(materials, { keys: ['title', 'topic', 'subtopic'], threshold: 0.35 })
}

export function getVisibleMaterials() {
  let list = filters.search.trim() ? fuse.search(filters.search).map((r) => r.item) : materials.slice()
  if (filters.folderId === 'unfiled') list = list.filter((m) => !m.folderId)
  else if (filters.folderId !== 'all') list = list.filter((m) => m.folderId === filters.folderId)
  if (filters.tagNames.size) list = list.filter((m) => (m.tags || []).some((t) => filters.tagNames.has(t)))
  if (filters.level) list = list.filter((m) => m.level === filters.level)
  if (filters.mode) list = list.filter((m) => m.mode === filters.mode)
  if (filters.favoritesOnly) list = list.filter((m) => m.isFavorite)
  return sortMaterials(list)
}

function sortMaterials(list) {
  const copy = [...list]
  if (sortBy === 'title-asc') return copy.sort((a, b) => a.title.localeCompare(b.title))
  if (sortBy === 'level') return copy.sort((a, b) => a.level.localeCompare(b.level))
  if (sortBy === 'last-studied') return copy.sort((a, b) => new Date(b.lastStudiedAt || 0) - new Date(a.lastStudiedAt || 0))
  return copy.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
}
export function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;')
}
