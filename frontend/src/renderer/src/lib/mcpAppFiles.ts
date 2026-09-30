import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import { z } from 'zod'
import { put } from '@/lib/api/client'
import { sessionFileRawUrl } from '@/lib/api/sessions'

// OpenedFile is a session file handed to a file entrypoint. The app only sees
// its opaque uri; reads and saves come back to Jaz, which holds the path.
export type OpenedFile = { sessionId: string; path: string; name: string; uri: string }

export function openedFile(sessionId: string, path: string): OpenedFile {
  return { sessionId, path, name: path.split(/[\\/]/).pop() || path, uri: `host-resource://${crypto.randomUUID()}` }
}

const writeParams = z.object({
  uri: z.string(),
  ifMatch: z.string().optional(),
  text: z.string().optional(),
  blob: z.string().optional(),
})

// serveFile answers a file viewer's resources/read and openai/resources/write
// for the opened file, as OpenAI's MCP extensions define them.
export function serveFile(bridge: AppBridge, file: OpenedFile) {
  bridge.onreadresource = async ({ uri, _meta }) => {
    if (uri !== file.uri) throw new Error(`unknown resource ${uri}`)
    const response = await fetch(sessionFileRawUrl(file.sessionId, file.path))
    if (!response.ok) throw new Error(`could not read ${file.name}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const representation = (_meta?.['openai/resource'] as { representation?: string } | undefined)?.representation
    const text = representation === 'blob' ? undefined : decodeText(bytes, representation === 'text')
    const meta = { 'openai/resource': { etag: await etag(bytes), writable: true } }
    return { contents: [text === undefined ? { uri, blob: toBase64(bytes), _meta: meta } : { uri, text, _meta: meta }] }
  }
  bridge.setRequestHandler('openai/resources/write', { params: writeParams }, (params) => {
    if (params.uri !== file.uri) throw new Error('only the opened file can be written')
    return put<Record<string, unknown>>(`/v1/sessions/${encodeURIComponent(file.sessionId)}/file`, {
      path: file.path,
      text: params.text,
      blob: params.blob,
      if_match: params.ifMatch,
    })
  })
}

// decodeText reads UTF-8, or reports undefined for binary content unless text
// was asked for.
function decodeText(bytes: Uint8Array<ArrayBuffer>, force: boolean): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: !force }).decode(bytes)
  } catch {
    return undefined
  }
}

// etag matches the backend's: the hex SHA-256 of the file's bytes.
async function etag(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
