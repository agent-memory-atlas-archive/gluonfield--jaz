import { app, session, type WebContents, type WebPreferences } from 'electron'
import { BROWSER_PRELOAD_ARGUMENT, PREVIEW_PARTITION, isPreviewURL } from '@shared/preview'

export const PREVIEW_WEB_PREFERENCES: WebPreferences = {
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
}

export function attachPreviewWebviews(host: WebContents, preload: string): void {
  host.on('will-attach-webview', (event, preferences, params) => {
    if (!isPreviewURL(params.src) || params.partition !== PREVIEW_PARTITION) {
      event.preventDefault()
      return
    }
    delete (preferences as WebPreferences & { preloadURL?: string }).preloadURL
    preferences.preload = preload
    preferences.additionalArguments = [BROWSER_PRELOAD_ARGUMENT]
    Object.assign(preferences, PREVIEW_WEB_PREFERENCES)
  })
}

export function configurePreviewSession(): void {
  const browser = session.fromPartition(PREVIEW_PARTITION)
  const appProduct = `${app.getName().replaceAll(' ', '')}/${app.getVersion()}`
  const userAgent = browser.getUserAgent()
    .replace(` ${appProduct}`, '')
    .replace(` Electron/${process.versions.electron}`, '')
  browser.setUserAgent(userAgent)
}
