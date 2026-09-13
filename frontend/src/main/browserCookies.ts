import { createHash, timingSafeEqual } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { CookiesSetDetails } from 'electron'
import type { BrowserImportCount } from '@shared/browserProfile'
import type { LocalBrowserProfile } from '@main/browserProfiles'
import { browserStorageKey, decryptBrowserValue, readKeychainPassword } from '@main/browserSafeStorage'

const CHROME_EPOCH_SECONDS = 11644473600

type CookieRow = {
  domain: string
  name: string
  value: string
  path: string
  secure: number
  httpOnly: number
  sameSite: number
  expires: number
  persistent: number
  encrypted?: Uint8Array
}

function readCookies(profile: LocalBrowserProfile): { rows: CookieRow[]; version: number } {
  const db = new DatabaseSync(profile.database!, { readOnly: true, timeout: 1000 })
  try {
    const chromium = profile.family === 'chromium'
    const statement = db.prepare(chromium
      ? `SELECT host_key AS domain, name, value, path, is_secure AS secure, is_httponly AS httpOnly,
          samesite AS sameSite, expires_utc AS expires, has_expires AS persistent, encrypted_value AS encrypted
          FROM cookies WHERE top_frame_site_key = ''`
      : `SELECT host AS domain, name, value, path, isSecure AS secure, isHttpOnly AS httpOnly,
          sameSite, expiry AS expires, 1 AS persistent FROM moz_cookies WHERE originAttributes = ''`)
    statement.setReadBigInts(true)
    const rows = statement.all().map((row) => ({
      ...row,
      expires: chromium ? Number(row.expires) / 1_000_000 - CHROME_EPOCH_SECONDS : Number(row.expires),
      secure: Number(row.secure), httpOnly: Number(row.httpOnly), sameSite: Number(row.sameSite), persistent: Number(row.persistent),
    })) as CookieRow[]
    const version = chromium ? Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value) : 0
    if (chromium && !Number.isFinite(version)) {
      throw new Error('Missing cookie database version')
    }
    return { rows: rows.filter((row) => !row.persistent || row.expires > Date.now() / 1000), version }
  } finally {
    db.close()
  }
}

export async function importProfileCookies(
  profile: LocalBrowserProfile,
  setCookie: (cookie: CookiesSetDetails) => Promise<void>,
  password: (service: string) => Promise<string> = readKeychainPassword,
): Promise<BrowserImportCount> {
  if (!profile.database) {
    throw new Error('No cookies were found in this browser profile.')
  }
  const { rows, version } = readCookies(profile)
  if (!rows.length) {
    return { imported: 0, failed: 0 }
  }
  let key: Buffer | undefined
  if (rows.some((row) => row.encrypted?.length)) {
    if (!profile.keychainService) {
      throw new Error('Encrypted cookies are unsupported for this browser.')
    }
    key = await browserStorageKey(profile.keychainService, password)
  }
  const result = { imported: 0, failed: 0 }
  try {
    for (const row of rows) {
      try {
        const value = row.encrypted?.length ? decryptCookie(row, version, key!) : row.value
        const host = row.domain.replace(/^\./, '')
        const url = new URL(`${row.secure ? 'https' : 'http'}://${host}`)
        if (url.hostname !== host || url.username || url.password || url.port) {
          throw new Error('Invalid cookie domain')
        }
        await setCookie({
          url: url.origin + row.path, name: row.name, value, path: row.path,
          ...(row.domain.startsWith('.') ? { domain: row.domain } : {}),
          secure: Boolean(row.secure), httpOnly: Boolean(row.httpOnly),
          sameSite: row.sameSite === 0 ? 'no_restriction' : row.sameSite === 1 ? 'lax' : row.sameSite === 2 ? 'strict' : 'unspecified',
          ...(row.persistent ? { expirationDate: row.expires } : {}),
        })
        result.imported += 1
      } catch {
        result.failed += 1
      }
    }
    return result
  } finally {
    key?.fill(0)
  }
}

function decryptCookie(row: CookieRow, version: number, key: Buffer): string {
  let value = decryptBrowserValue(row.encrypted!, key)
  // Chromium schema 24 binds each encrypted value to the SHA-256 of its exact host.
  if (version >= 24) {
    const hash = createHash('sha256').update(row.domain).digest()
    if (value.length < hash.length || !timingSafeEqual(value.subarray(0, hash.length), hash)) {
      throw new Error('Cookie host verification failed')
    }
    value = value.subarray(hash.length)
  }
  return value.toString('utf8')
}
