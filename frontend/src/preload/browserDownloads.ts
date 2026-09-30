import { ipcRenderer } from 'electron'
import { DOWNLOAD_CHANNEL, DOWNLOAD_CHANGED_CHANNEL, type BrowserDownloadAPI, type BrowserDownloadState } from '@shared/browserDownloads'

export const browserDownloads: BrowserDownloadAPI = {
  state: () => ipcRenderer.invoke(DOWNLOAD_CHANNEL),
  act: (action) => ipcRenderer.invoke(DOWNLOAD_CHANNEL, action),
  subscribe: (handler) => {
    const listener = (_event: unknown, state: BrowserDownloadState) => handler(state)
    ipcRenderer.on(DOWNLOAD_CHANGED_CHANNEL, listener)
    return () => ipcRenderer.removeListener(DOWNLOAD_CHANGED_CHANNEL, listener)
  },
}
