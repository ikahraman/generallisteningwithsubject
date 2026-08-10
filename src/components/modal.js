// Reusable modal. Single instance mounted lazily into <body>.

let root = null

function ensureRoot() {
  if (root) return root
  root = document.createElement('div')
  root.className = 'modal-root'
  document.body.appendChild(root)
  return root
}

function onKeydown(e) {
  if (e.key === 'Escape') closeModal()
}

/**
 * @param {{title:string, bodyHTML:string, actions?: Array<{label:string, variant?:string, onClick?:Function, closeOnClick?:boolean}>}} opts
 */
export function openModal({ title = '', bodyHTML = '', actions = [] }) {
  const el = ensureRoot()
  el.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" data-close aria-label="Close">&times;</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${
        actions.length
          ? `<div class="modal-actions">
              ${actions
                .map((a, i) => `<button class="btn ${a.variant || ''}" data-action="${i}">${a.label}</button>`)
                .join('')}
            </div>`
          : ''
      }
    </div>
  `
  el.classList.add('open')
  // Bumped on every openModal() call so a pending async action below can
  // detect that its own onClick opened a follow-up modal (e.g. an error
  // dialog) while it awaited, and skip auto-closing that new modal.
  const generation = String(Number(el.dataset.generation || 0) + 1)
  el.dataset.generation = generation

  el.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal))
  actions.forEach((a, i) => {
    const btn = el.querySelector(`[data-action="${i}"]`)
    btn?.addEventListener('click', async () => {
      const result = a.onClick?.()
      if (result && typeof result.then === 'function') {
        const originalHTML = btn.innerHTML
        btn.disabled = true
        btn.innerHTML = `<span class="spinner"></span> ${originalHTML}`
        try {
          await result
        } catch (err) {
          console.error(err)
        }
        // Only auto-close if nothing else (like a follow-up modal opened
        // from inside onClick) replaced this modal while we were waiting.
        if (el.dataset.generation !== generation) return
        if (a.closeOnClick !== false) closeModal()
        else {
          btn.disabled = false
          btn.innerHTML = originalHTML
        }
      } else if (a.closeOnClick !== false) {
        closeModal()
      }
    })
  })
  document.addEventListener('keydown', onKeydown)
  return el
}

export function closeModal() {
  if (!root) return
  root.classList.remove('open')
  root.innerHTML = ''
  document.removeEventListener('keydown', onKeydown)
}

export function getModalRoot() {
  return root
}
