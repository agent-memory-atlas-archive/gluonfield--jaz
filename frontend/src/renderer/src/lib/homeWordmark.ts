export const DEFAULT_HOME_WORDMARK = 'jaz'
export const HOME_WORDMARK_MAX_LENGTH = 64

export function isHomeLogoUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

export function normalizeHomeWordmark(value: string): string {
  const trimmed = value.trim()
  return isHomeLogoUrl(trimmed)
    ? trimmed
    : Array.from(trimmed).slice(0, HOME_WORDMARK_MAX_LENGTH).join('')
}

export function effectiveHomeWordmark(value: string): string {
  return normalizeHomeWordmark(value) || DEFAULT_HOME_WORDMARK
}
