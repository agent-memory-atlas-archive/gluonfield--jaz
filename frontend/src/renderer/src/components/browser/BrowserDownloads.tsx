import { ArrowLeft, Download, FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { IconButton } from '@/components/ui/IconButton'
import type { BrowserDownloadAction, BrowserDownloadAPI, BrowserDownloadState } from '@shared/browserDownloads'

export function BrowserDownloads({ api, onBack }: { api: BrowserDownloadAPI; onBack: () => void }) {
  const [state, setState] = useState<BrowserDownloadState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    let changed = false
    const unsubscribe = api.subscribe((next) => {
      changed = true
      if (active) {
        setState(next)
      }
    })
    void api.state().then((next) => {
      if (active && !changed) {
        setState(next)
      }
    }).catch(() => {
      if (active && !changed) {
        setError('Downloads could not be loaded.')
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [api])

  const act = async (action: BrowserDownloadAction) => {
    setBusy(true)
    setError('')
    try {
      const result = await api.act(action)
      setError(result.error || '')
    } catch {
      setError('The download action failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return <section aria-label="Browser downloads" className="w-96 max-w-[calc(100vw-32px)] p-2">
    <div className="flex items-center gap-1">
      <IconButton aria-label="Back to browser menu" className="size-10" onClick={onBack}><ArrowLeft size={16} /></IconButton>
      <h2 className="flex-1 text-[14px] font-medium text-ink">Downloads</h2>
      <IconButton aria-label="Open Downloads folder" title={state?.directory || 'Open Downloads folder'} disabled={busy} className="size-10" onClick={() => void act({ kind: 'folder' })}><FolderOpen size={17} /></IconButton>
    </div>
    {error || state?.error ? <p role="alert" className="px-2 pb-2 text-[12px] text-danger">{error || state?.error}</p> : null}
    {!state ? <p className="p-3 text-[13px] text-ink-2">{error ? 'Try opening the menu again.' : 'Loading downloads…'}</p> : !state.downloads.length ? <p className="p-3 text-[13px] text-ink-2">No recent downloads.</p> :
      <ul className="max-h-[min(28rem,calc(100vh-160px))] overflow-y-auto">
        {state.downloads.map((download) => <li key={download.id} className="border-t border-border px-2 py-3 first:border-0">
          <div className="flex items-start gap-2.5">
            <Download size={17} className="mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <p title={download.name} className="truncate text-[13px] font-medium text-ink">{download.name}</p>
              <p className="mt-1 text-[12px] text-ink-2 tabular-nums">
                {download.state === 'progressing' ? `${bytes(download.receivedBytes)}${download.totalBytes ? ` / ${bytes(download.totalBytes)}` : ''}` :
                  download.state === 'completed' ? `${bytes(download.receivedBytes)} · ${new Date(download.startedAt).toLocaleString()}` :
                    download.state === 'cancelled' ? 'Cancelled' : 'Download interrupted'}
              </p>
              {download.state === 'progressing' ? <progress aria-label={`Downloading ${download.name}`} value={download.totalBytes ? download.receivedBytes : undefined} max={download.totalBytes || 1} className="mt-2 block h-1 w-full accent-primary" /> : null}
              {download.path ? <p title={download.path} className="mt-1 break-all text-[11px] text-ink-3">{download.path}</p> : null}
              <div className="mt-2 flex flex-wrap gap-1">
                {download.state === 'completed' ? <>
                  <Button size="sm" variant="ghost" className="min-h-10" disabled={busy} aria-label={`Open ${download.name}`} onClick={() => void act({ kind: 'open', id: download.id })}>Open</Button>
                  <Button size="sm" variant="ghost" className="min-h-10" disabled={busy} aria-label={`Show ${download.name} in folder`} onClick={() => void act({ kind: 'reveal', id: download.id })}>Show in folder</Button>
                </> : download.state === 'progressing' || download.state === 'interrupted' ? <Button size="sm" variant="ghost" className="min-h-10" disabled={busy} aria-label={`Cancel download of ${download.name}`} onClick={() => void act({ kind: 'cancel', id: download.id })}>Cancel</Button> : null}
              </div>
            </div>
          </div>
        </li>)}
      </ul>}
  </section>
}

function bytes(value: number): string {
  const index = Math.min(3, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)))
  return `${Number((value / 1024 ** index).toFixed(index ? 1 : 0))} ${['B', 'KB', 'MB', 'GB'][index]}`
}
