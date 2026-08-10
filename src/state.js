// Single global AppState object with a minimal pub/sub layer.
// Modules call `subscribe()` to react to changes instead of polling.

const listeners = new Set()

function notify(prop, value) {
  for (const fn of listeners) fn(prop, value, state)
}

const target = {
  route: 'dashboard', // dashboard | generator | workspace | library | statistics | settings
  theme: 'dark', // light | dark | system
  accentColor: 'indigo', // indigo | rose | emerald | amber | sky
  sidebarCollapsed: false,
  currentMaterialId: null,
  isLoading: false,
}

export const state = new Proxy(target, {
  set(obj, prop, value) {
    if (obj[prop] === value) return true
    obj[prop] = value
    notify(prop, value)
    return true
  },
})

// Subscribe to ANY state change. Returns an unsubscribe function.
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Convenience: subscribe to a single property only.
export function subscribeTo(prop, fn) {
  return subscribe((changedProp, value) => {
    if (changedProp === prop) fn(value)
  })
}

export function setState(patch) {
  for (const [key, value] of Object.entries(patch)) {
    state[key] = value
  }
}

export default state
