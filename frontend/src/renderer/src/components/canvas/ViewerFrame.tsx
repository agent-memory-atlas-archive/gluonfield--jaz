import type { ReactNode } from 'react'
import type { CanvasFile } from '@/lib/api/canvas'
import { sessionFileRawUrl } from '@/lib/api/sessions'
import { useCanvas } from './canvasContext'

export function rawUrl(sessionId: string, file: CanvasFile): string {
  return `${sessionFileRawUrl(sessionId, file.path)}&v=${encodeURIComponent(file.version ?? '')}`
}

// Every file viewer shares this frame: the content, then a footer with what
// the file is and, for viewers that take the pointer, Focus/Done.
export function ViewerFrame({ id, status, focusable, controls, paper, children }: {
  id: string
  status: ReactNode
  focusable?: boolean
  controls?: ReactNode
  paper?: boolean
  children: ReactNode
}) {
  const { focused, setFocused } = useCanvas()
  const live = focused === id
  return (
    <div className="canvas-viewer">
      <div className={`canvas-viewer-body${live ? ' live nodrag nowheel nopan' : ''}${paper ? ' paper' : ''}`}>{children}</div>
      <div className="canvas-viewer-bar">
        <span className="canvas-viewer-status">{status}</span>
        {live && controls ? <span className="canvas-viewer-controls nodrag">{controls}</span> : null}
        {focusable ? (
          <button type="button" className={`canvas-focus nodrag${live ? ' on' : ''}`} onClick={() => setFocused(live ? null : id)}>
            {live ? 'Done' : 'Focus'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

