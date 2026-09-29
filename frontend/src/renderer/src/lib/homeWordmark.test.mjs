import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_HOME_WORDMARK,
  effectiveHomeWordmark,
  HOME_WORDMARK_MAX_LENGTH,
  HOME_LOGO_URL_MAX_LENGTH,
  isHomeLogoUrl,
  normalizeHomeWordmark,
} from './homeWordmark'

describe('home wordmark', () => {
  test('uses jaz when the appearance override is blank', () => {
    expect(effectiveHomeWordmark('   ')).toBe(DEFAULT_HOME_WORDMARK)
  })

  test('trims custom text and preserves internal spaces', () => {
    expect(effectiveHomeWordmark('  hello world  ')).toBe('hello world')
  })

  test('caps custom text by Unicode character rather than UTF-16 code unit', () => {
    const text = '🪐'.repeat(HOME_WORDMARK_MAX_LENGTH + 1)
    expect(Array.from(normalizeHomeWordmark(text))).toHaveLength(HOME_WORDMARK_MAX_LENGTH)
  })

  test('keeps image URLs longer than the text limit', () => {
    const url = `https://example.com/logo.png?token=${'a'.repeat(HOME_WORDMARK_MAX_LENGTH)}`
    expect(normalizeHomeWordmark(` ${url} `)).toBe(url)
    expect(normalizeHomeWordmark(`https://${'a'.repeat(HOME_LOGO_URL_MAX_LENGTH)}`).length).toBe(HOME_LOGO_URL_MAX_LENGTH)
  })

  test('recognizes HTTP image links without treating other schemes as images', () => {
    expect(isHomeLogoUrl('https://example.com/logo.svg')).toBe(true)
    expect(isHomeLogoUrl('HTTP://example.com/logo.png')).toBe(true)
    expect(isHomeLogoUrl('javascript:alert(1)')).toBe(false)
    expect(isHomeLogoUrl('my logo')).toBe(false)
  })
})
