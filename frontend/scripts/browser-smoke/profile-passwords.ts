import assert from 'node:assert/strict'
import { createCipheriv } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BrowserPasswordStore } from '@main/browserPasswordStore'
import { importProfilePasswords } from '@main/browserPasswordImport'
import type { LocalBrowserProfile } from '@main/browserProfiles'

export function preparePasswordDatabases(directory: string, key: Buffer, origin: string): void {
  const encrypt = (value: string) => {
    const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 32))
    return Buffer.concat([Buffer.from('v10'), cipher.update(value, 'utf8'), cipher.final()])
  }
  for (const [index, name] of ['Login Data', 'Login Data For Account'].entries()) {
    const db = new DatabaseSync(join(directory, name))
    db.exec(`CREATE TABLE logins (origin_url TEXT, signon_realm TEXT, username_value TEXT, password_value BLOB,
      blacklisted_by_user INTEGER, scheme INTEGER, date_password_modified INTEGER)`)
    const insert = db.prepare('INSERT INTO logins VALUES (?, ?, ?, ?, ?, ?, ?)')
    insert.run(origin + '/login', origin + '/', 'imported@example.test', encrypt(index ? 'fixture-import-latest' : 'fixture-import-old'), 0, 0, 13400000000000000n + BigInt(index))
    if (!index) {
      insert.run('http://insecure.test/login', 'http://insecure.test/', 'insecure', encrypt('insecure'), 0, 0, 1)
      insert.run(origin, origin + '/', 'unsupported', Buffer.from('v20-unsupported'), 0, 0, 2)
      insert.run(origin, origin + '/', 'blocked', encrypt('blocked'), 1, 0, 3)
      insert.run(origin, origin + '/realm', 'http-auth', encrypt('http-auth'), 0, 1, 4)
    }
    db.close()
  }
}

export async function exercisePasswordImport(profile: LocalBrowserProfile, file: string, password: string, origin: string): Promise<void> {
  const original = await Promise.all(profile.passwordDatabases.map((file) => readFile(file)))
  const store = new BrowserPasswordStore(file)
  await assert.rejects(importProfilePasswords(profile, store, async () => {
    throw new Error('Keychain denied')
  }), /Keychain denied/)
  assert.deepEqual(store.read(), [])
  assert.deepEqual(await importProfilePasswords(profile, store, async () => password), { imported: 1, failed: 2, skipped: 1 })
  assert.deepEqual(store.read(), [{ origin, username: 'imported@example.test', password: 'fixture-import-latest' }])
  const encrypted = await readFile(file)
  assert(!encrypted.includes(Buffer.from('fixture-import-latest')))
  assert(!encrypted.includes(Buffer.from('imported@example.test')))
  store.save({ origin, username: 'imported@example.test', password: 'newer-jaz-password' })
  assert.deepEqual(await importProfilePasswords(profile, store, async () => password), { imported: 0, failed: 2, skipped: 2 })
  assert.equal(store.read()[0].password, 'newer-jaz-password')
  assert.deepEqual(await Promise.all(profile.passwordDatabases.map((file) => readFile(file))), original)
}
