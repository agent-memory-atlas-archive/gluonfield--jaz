import { apiBaseUrl, isLocalBackendUrl, post } from '@/lib/api/client'
import { shouldProxyPreview } from '@shared/preview'
import { parseFileReference } from '@shared/fileReader'
import { preparePreviewProxySource, type PreviewProxyResponse } from '@/lib/api/previewSource'

const previewHosts = new Map<string, string>()

export async function resolvePreviewSource(value: string): Promise<string> {
  const file = parseFileReference(value)
  if (!file && (!shouldProxyPreview(value) || isLocalBackendUrl(apiBaseUrl()))) {
    return value
  }
  const response = file
    ? await post<PreviewProxyResponse>('/v1/preview/files', { path: file.path })
    : await post<PreviewProxyResponse>('/v1/preview/proxies', { url: value })
  const source = await preparePreviewProxySource(response)
  previewHosts.set(new URL(source).host, response.base_url)
  return source
}

export function previewDisplayUrl(value: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  const fromHost = previewHosts.get(parsed.host)
  if (fromHost) {
    return fromHost + parsed.pathname.slice(1) + parsed.search + parsed.hash
  }
  return null
}
