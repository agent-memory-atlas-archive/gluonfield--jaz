import { expect, test } from 'bun:test'

async function loadAppearance(config, stored = {}, patch = {}) {
  const worker = new globalThis.Worker(new globalThis.URL('./appearance.worker.mjs', import.meta.url).href)
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data)
      worker.onerror = reject
      worker.postMessage({ config, stored, patch })
    })
  } finally {
    worker.terminate()
  }
}

test('appearance config seeds a name and theme without persisting user overrides', async () => {
  const result = await loadAppearance({ homeWordmark: '  My assistant  ', theme: 'dark' })
  expect(result.initial.homeWordmark).toBe('My assistant')
  expect(result.initial.invertHomeLogoInLightMode).toBe(false)
  expect(result.theme).toBe('dark')
  expect(result.stored).toEqual({})
})

test('appearance config preserves long image URLs and enables light-mode inversion', async () => {
  const url = `https://example.com/logo.svg?token=${'a'.repeat(10000)}`
  const result = await loadAppearance({
    homeWordmark: ` ${url} `,
    invertHomeLogoInLightMode: true,
  })
  expect(result.initial.homeWordmark).toBe(url)
  expect(result.initial.invertHomeLogoInLightMode).toBe(true)
})

test('explicit blank and false settings override branded config defaults on load', async () => {
  const stored = {
    'jaz.appearance.homeWordmark': '',
    'jaz.appearance.invertHomeLogoInLightMode': 'false',
    'jaz.theme': 'light',
  }
  const result = await loadAppearance({
    homeWordmark: 'https://example.com/logo.svg',
    invertHomeLogoInLightMode: true,
    theme: 'dark',
  }, stored)
  expect(result.initial.homeWordmark).toBe('')
  expect(result.initial.invertHomeLogoInLightMode).toBe(false)
  expect(result.theme).toBe('light')
  expect(result.stored).toEqual(stored)
})

test('user logo changes persist and removing an override restores the config default', async () => {
  const url = `https://example.com/logo.svg?token=${'b'.repeat(100)}`
  const result = await loadAppearance({ homeWordmark: 'My assistant' }, {}, {
    homeWordmark: ` ${url} `,
    invertHomeLogoInLightMode: true,
  })
  expect(result.changed.homeWordmark).toBe(url)
  expect(result.changed.invertHomeLogoInLightMode).toBe(true)
  expect(result.stored).toEqual({
    'jaz.appearance.homeWordmark': url,
    'jaz.appearance.invertHomeLogoInLightMode': 'true',
  })
  expect(result.reset.homeWordmark).toBe('My assistant')
  expect(result.reset.invertHomeLogoInLightMode).toBe(false)
})
