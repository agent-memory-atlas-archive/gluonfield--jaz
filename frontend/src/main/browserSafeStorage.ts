import { execFile } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { promisify } from 'node:util'

const execute = promisify(execFile)

export async function browserStorageKey(service: string, password = readKeychainPassword): Promise<Buffer> {
  return pbkdf2Sync(await password(service), 'saltysalt', 1003, 16, 'sha1')
}

export function decryptBrowserValue(encrypted: Uint8Array, key: Buffer): Buffer {
  const value = Buffer.from(encrypted)
  if (value.subarray(0, 3).toString() !== 'v10') {
    throw new Error('Unsupported browser encryption')
  }
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 32))
  return Buffer.concat([decipher.update(value.subarray(3)), decipher.final()])
}

export async function readKeychainPassword(service: string): Promise<string> {
  if (process.platform !== 'darwin') {
    throw new Error('Encrypted browser import is available on macOS only.')
  }
  try {
    const { stdout } = await execute('/usr/bin/security', ['find-generic-password', '-w', '-a', service.replace(/ Safe Storage$/, ''), '-s', service], { timeout: 30000, maxBuffer: 8192 })
    return stdout.replace(/\r?\n$/, '')
  } catch {
    throw new Error('Keychain access was not granted. Allow access to the selected browser’s Safe Storage key, then try again.')
  }
}
