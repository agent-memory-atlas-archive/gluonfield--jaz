import { describe, expect, test } from 'bun:test'
import { normalizePreviewURL, shouldProxyPreview } from './preview'
import { resolveFileLink } from './fileReader'

test('browser input preserves local paths and file URIs', () => {
  for (const path of ['/Users/wins/.jaz/workspaces/default/manufacturing/research/qdd-actuator-2026-09-17/index.html', 'file:///tmp/report%20one.html', 'C:\\reports\\index.html']) {
    expect(normalizePreviewURL(path)).toBe(path)
  }
  expect(normalizePreviewURL('localhost:3000')).toBe('http://localhost:3000/')
  expect(normalizePreviewURL('example.com')).toBe('https://example.com/')
})

test('document links resolve relative files and preserve line references', () => {
  expect(resolveFileLink('bom.csv', '/work/report/index.md')).toEqual({ path: '/work/report/bom.csv' })
  expect(resolveFileLink('../index.html', '/work/report/notes.md')).toEqual({ path: '/work/report/../index.html' })
  expect(resolveFileLink('app.ts:12', '/work/report/notes.md')).toEqual({ path: '/work/report/app.ts', line: 12 })
  for (const url of ['https://example.com/report.html', 'javascript:alert(1)', '#heading']) {
    expect(resolveFileLink(url, '/work/notes.md')).toBeNull()
  }
})

describe('shouldProxyPreview', () => {
  test('proxies server loopback targets but not generated preview origins', () => {
    expect(shouldProxyPreview('http://localhost:3000/')).toBeTrue()
    expect(shouldProxyPreview('http://127.0.0.1:3000/')).toBeTrue()
    expect(shouldProxyPreview('http://jaz-preview-capability.localhost:5299/')).toBeFalse()
    expect(shouldProxyPreview('https://preview.example.test/')).toBeFalse()
  })
})
