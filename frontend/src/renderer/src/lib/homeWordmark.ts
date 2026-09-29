export const DEFAULT_HOME_WORDMARK = 'jaz'
export const HOME_WORDMARK_MAX_LENGTH = 64
export const HOME_LOGO_URL_MAX_LENGTH = 8192

export function isHomeLogoUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function normalizeHomeWordmark(value: string): string {
  const trimmed = value.trim()
  const limit = isHomeLogoUrl(trimmed) ? HOME_LOGO_URL_MAX_LENGTH : HOME_WORDMARK_MAX_LENGTH
  return Array.from(trimmed).slice(0, limit).join('')
}

export function effectiveHomeWordmark(value: string): string {
  return normalizeHomeWordmark(value) || DEFAULT_HOME_WORDMARK
}
