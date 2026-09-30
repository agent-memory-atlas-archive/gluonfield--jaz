import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app, ipcMain, session, shell, webContents, type DownloadItem } from 'electron'
import { DOWNLOAD_CHANNEL, DOWNLOAD_CHANGED_CHANNEL, type BrowserDownload, type BrowserDownloadAction, type BrowserDownloadState } from '@shared/browserDownloads'
import { PREVIEW_PARTITION } from '@shared/preview'
import { isTrustedRendererURL } from '@main/permissions'

export function installBrowserDownloads(): void {
  const file = join(app.getPath('userData'), 'browser-downloads.json')
  const active = new Map<string, DownloadItem>()
  let downloads: BrowserDownload[] = []
  let error: string | undefined
  try {
    const saved: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(saved) || !saved.every(isDownload)) {
      throw new Error('Invalid download history')
    }
    downloads = saved.slice(0, 50).map((record) => ({ ...record, state: record.state === 'progressing' || record.state === 'interrupted' ? 'failed' : record.state }))
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      error = 'Download history could not be loaded.'
    }
  }

  const state = (): BrowserDownloadState => ({ downloads, directory: app.getPath('downloads'), ...(error && { error }) })
  const changed = () => {
    for (const host of webContents.getAllWebContents()) {
      if (host.getType() === 'window' && isTrustedRendererURL(host.getURL())) {
        host.send(DOWNLOAD_CHANGED_CHANNEL, state())
      }
    }
  }
  const save = () => {
    let retained = 0
    downloads = downloads.filter((record) => active.has(record.id) || retained++ < 50)
    try {
      writeFileSync(file + '.tmp', JSON.stringify(downloads), { mode: 0o600 })
      renameSync(file + '.tmp', file)
      error = undefined
    } catch {
      error = 'Download history could not be saved.'
    }
  }

  session.fromPartition(PREVIEW_PARTITION).on('will-download', (_event, item) => {
    const record: BrowserDownload = {
      id: randomUUID(), name: item.getFilename(), path: item.getSavePath(), startedAt: item.getStartTime() * 1000,
      state: 'progressing', receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(),
    }
    active.set(record.id, item)
    downloads.unshift(record)
    save()
    changed()
    const update = (next: BrowserDownload['state']) => {
      const path = item.getSavePath()
      const pathChanged = record.path !== path
      Object.assign(record, {
        state: next, path, name: path ? basename(path) : item.getFilename(),
        receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(),
      })
      if (pathChanged || !active.has(record.id)) {
        save()
      }
      changed()
    }
    item.on('updated', (_event, next) => update(next))
    item.once('done', (_event, next) => {
      active.delete(record.id)
      update(next === 'interrupted' ? 'failed' : next)
    })
  })

  ipcMain.handle(DOWNLOAD_CHANNEL, async (event, action?: BrowserDownloadAction) => {
    if (event.sender.getType() !== 'window' || event.senderFrame !== event.sender.mainFrame || !isTrustedRendererURL(event.senderFrame.url)) {
      throw new Error('Downloads must be managed from Jaz.')
    }
    if (!action) {
      return state()
    }
    try {
      let path = app.getPath('downloads')
      if (action.kind !== 'folder') {
        const record = downloads.find((download) => download.id === action.id)
        if (!record) {
          throw new Error('This download is no longer in the recent list.')
        }
        if (action.kind === 'cancel') {
          active.get(record.id)?.cancel()
          return {}
        }
        if (action.kind !== 'open' && action.kind !== 'reveal') {
          throw new Error('Unknown download action.')
        }
        if (record.state !== 'completed' || !record.path || !existsSync(record.path)) {
          throw new Error('This downloaded file is no longer available at its saved location.')
        }
        if (action.kind === 'reveal') {
          shell.showItemInFolder(record.path)
          return {}
        }
        path = record.path
      }
      const error = await shell.openPath(path)
      return error ? { error } : {}
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'The download action failed.' }
    }
  })
}

function isDownload(value: unknown): value is BrowserDownload {
  if (!value || typeof value !== 'object') {
    return false
  }
  const record = value as BrowserDownload
  return typeof record.id === 'string' && typeof record.name === 'string' && typeof record.path === 'string' &&
    Number.isFinite(record.startedAt) && record.startedAt >= 0 &&
    Number.isFinite(record.receivedBytes) && record.receivedBytes >= 0 && Number.isFinite(record.totalBytes) && record.totalBytes >= 0 &&
    ['progressing', 'interrupted', 'completed', 'cancelled', 'failed'].includes(record.state)
}
