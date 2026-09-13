import { DatabaseSync } from 'node:sqlite'
import { BrowserPasswordStore, type BrowserPassword } from '@main/browserPasswordStore'
import type { LocalBrowserProfile } from '@main/browserProfiles'
import { browserStorageKey, decryptBrowserValue, readKeychainPassword } from '@main/browserSafeStorage'
import type { BrowserImportCount } from '@shared/browserProfile'

type LoginRow = {
  origin_url: string
  signon_realm: string
  username_value: string
  password_value: Uint8Array
  date_password_modified: bigint
}

export async function importProfilePasswords(
  profile: LocalBrowserProfile,
  store: BrowserPasswordStore,
  password = readKeychainPassword,
): Promise<BrowserImportCount> {
  if (!profile.passwordDatabases.length || !profile.keychainService) {
    throw new Error('Password import is available from Chrome and Edge on macOS.')
  }
  const rows = profile.passwordDatabases.flatMap((file) => {
    const db = new DatabaseSync(file, { readOnly: true, timeout: 1000 })
    try {
      const statement = db.prepare(`SELECT origin_url, signon_realm, username_value, password_value, date_password_modified
        FROM logins WHERE blacklisted_by_user = 0 AND scheme = 0 AND length(password_value) > 0`)
      statement.setReadBigInts(true)
      return statement.all() as LoginRow[]
    } finally {
      db.close()
    }
  }).sort((a, b) => a.date_password_modified === b.date_password_modified ? 0 : a.date_password_modified > b.date_password_modified ? -1 : 1)
  if (!rows.length) {
    return { imported: 0, failed: 0 }
  }
  const key = await browserStorageKey(profile.keychainService, password)
  const records: BrowserPassword[] = []
  let failed = 0
  try {
    for (const row of rows) {
      try {
        const url = new URL(row.origin_url)
        if (url.protocol !== 'https:' || row.signon_realm !== url.origin + '/') {
          throw new Error('Unsupported login origin')
        }
        const value = decryptBrowserValue(row.password_value, key)
        try {
          const password = new TextDecoder('utf-8', { fatal: true }).decode(value)
          const username = row.username_value.trim()
          if (!password || password.length > 4096 || username.length > 1024) {
            throw new Error('Unsupported login fields')
          }
          records.push({ origin: url.origin, username, password })
        } finally {
          value.fill(0)
        }
      } catch {
        failed += 1
      }
    }
    const imported = store.import(records)
    return { imported, failed, skipped: records.length - imported }
  } finally {
    key.fill(0)
  }
}
