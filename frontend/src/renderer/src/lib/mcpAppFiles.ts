import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge'
import { z } from 'zod'
import { apiFetch } from '@/lib/api/client'
import { sessionFilePath } from '@/lib/api/sessions'

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
// for the opened file, translating OpenAI's MCP extensions to the session file
// endpoint's ETag, If-Match, 412 and 413.
export function serveFile(bridge: AppBridge, file: OpenedFile) {
  const path = sessionFilePath(file.sessionId, file.path)
  bridge.onreadresource = async ({ uri, _meta }) => {
    if (uri !== file.uri) throw new Error(`unknown resource ${uri}`)
    const response = await apiFetch(path)
    if (!response.ok) throw new Error(`could not read ${file.name}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const representation = (_meta?.['openai/resource'] as { representation?: string } | undefined)?.representation
    const text = representation === 'blob' ? undefined : decodeText(bytes, representation === 'text')
    const meta = { 'openai/resource': { etag: response.headers.get('ETag') ?? undefined, writable: true } }
    return { contents: [text === undefined ? { uri, blob: toBase64(bytes), _meta: meta } : { uri, text, _meta: meta }] }
  }
  bridge.setRequestHandler('openai/resources/write', { params: writeParams }, async ({ uri, ifMatch, text, blob }) => {
    if (uri !== file.uri) throw new Error('only the opened file can be written')
    const body = text ?? (blob === undefined ? undefined : Uint8Array.from(atob(blob), (char) => char.charCodeAt(0)))
    if (body === undefined) throw new Error('text or blob is required')
    const response = await apiFetch(path, { method: 'PUT', headers: ifMatch ? { 'If-Match': ifMatch } : {}, body })
    const etag = response.headers.get('ETag') ?? ''
    if (response.status === 412) return { outcome: 'conflict', etag }
    if (response.status === 413) return { outcome: 'too-large', maxBytes: ((await response.json()) as { max_bytes: number }).max_bytes }
    if (!response.ok) throw new Error(`could not save ${file.name}`)
    return { outcome: 'saved', etag }
  })
}

// decodeText reads UTF-8, or reports undefined for binary content unless text
// was asked for.
function decodeText(bytes: Uint8Array, force: boolean): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: !force }).decode(bytes)
  } catch {
    return undefined
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
