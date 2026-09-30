export const DOWNLOAD_CHANNEL = 'jaz:browser-downloads'
export const DOWNLOAD_CHANGED_CHANNEL = 'jaz:browser-downloads:changed'

export type BrowserDownload = {
  id: string
  name: string
  path: string
  startedAt: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  receivedBytes: number
  totalBytes: number
}

export type BrowserDownloadState = {
  downloads: BrowserDownload[]
  directory: string
  error?: string
}

export type BrowserDownloadAction =
  | { kind: 'folder' }
  | { kind: 'open' | 'reveal' | 'cancel'; id: string }

export type BrowserDownloadAPI = {
  state: () => Promise<BrowserDownloadState>
  act: (action: BrowserDownloadAction) => Promise<{ error?: string }>
  subscribe: (handler: (state: BrowserDownloadState) => void) => () => void
}
