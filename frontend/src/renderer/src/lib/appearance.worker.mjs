globalThis.onmessage = async ({ data: { config, stored, patch } }) => {
  const values = new Map(Object.entries(stored))
  const listeners = []
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  globalThis.window = {
    __JAZ_DEFAULTS__: config,
    matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    addEventListener: (type, listener) => {
      if (type === 'storage') {
        listeners.push(listener)
      }
    },
  }
  globalThis.document = {
    documentElement: {
      classList: { toggle: () => {} },
      style: { setProperty: () => {}, removeProperty: () => {} },
    },
  }

  const { getAppearance, setAppearance } = await import('@/lib/appearance')
  const { getThemePref } = await import('@/lib/theme')
  const initial = getAppearance()
  const theme = getThemePref()
  setAppearance(patch)
  const changed = getAppearance()
  const persisted = Object.fromEntries(values)
  values.clear()
  for (const listener of listeners) {
    listener({ key: null, storageArea: globalThis.localStorage })
  }
  globalThis.postMessage({ initial, theme, changed, stored: persisted, reset: getAppearance() })
}
