import { session, shell, type Event, type WebContents } from 'electron'
import { PREVIEW_WEB_PREFERENCES } from '@main/previewSession'
import { PREVIEW_PARTITION, isPreviewURL } from '@shared/preview'

function canNavigate(url: string): boolean {
  return url === 'about:blank' || isPreviewURL(url)
}

export function attachWindowOpenHandler(contents: WebContents, openExternal = shell.openExternal): void {
  if (contents.session !== session.fromPartition(PREVIEW_PARTITION)) {
    contents.setWindowOpenHandler(({ url }) => {
      void openExternal(url)
      return { action: 'deny' }
    })
    return
  }
  const guard = (event: Event, url: string) => {
    if (!canNavigate(url)) {
      event.preventDefault()
    }
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.setWindowOpenHandler(({ url }) => {
    if (!canNavigate(url)) {
      return { action: 'deny' }
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        frame: true,
        webPreferences: { ...PREVIEW_WEB_PREFERENCES, preload: undefined },
      },
    }
  })
  contents.on('did-create-window', (window, { url }) => {
    const updateTitle = () => {
      const current = window.webContents.getURL() || url
      window.setTitle(current === 'about:blank' ? 'Jaz browser' : new URL(current).origin)
    }
    window.on('page-title-updated', event => event.preventDefault())
    window.webContents.on('did-navigate', updateTitle)
    window.webContents.on('did-navigate-in-page', updateTitle)
    updateTitle()
  })
}
