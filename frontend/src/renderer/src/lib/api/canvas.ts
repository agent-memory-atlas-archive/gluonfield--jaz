import { get, patch } from '@/lib/api/client'

// A JSON Canvas 1.0 node or edge (jsoncanvas.org). Fields stay open: the agent
// may write ones Jaz does not render, and patches must not drop them.
export interface CanvasItem {
  id: string
  type?: string
  [field: string]: unknown
}

export interface CanvasFile {
  path: string
  // Absent when the file is missing; changes whenever its content does.
  version?: string
}

export interface CanvasComponent {
  code?: string
  error?: string
}

export interface CanvasView {
  version: string
  dir: string
  nodes: CanvasItem[]
  edges: CanvasItem[]
  files: Record<string, CanvasFile>
  components: Record<string, CanvasComponent>
}

// Fields set to null are removed; unknown ids are added.
export interface CanvasPatch {
  nodes?: Partial<CanvasItem>[]
  edges?: Partial<CanvasItem>[]
  remove?: string[]
}

function canvasPath(sessionId: string): string {
  return `/v1/sessions/${encodeURIComponent(sessionId)}/canvas`
}

// The server answers 204 while the board still matches `current`.
export async function getCanvas(sessionId: string, current?: CanvasView): Promise<CanvasView> {
  const query = current ? `?version=${encodeURIComponent(current.version)}` : ''
  const view = await get<CanvasView | undefined>(`${canvasPath(sessionId)}${query}`)
  return view ?? current!
}

export function patchCanvas(sessionId: string, change: CanvasPatch): Promise<{ version: string }> {
  return patch<{ version: string }>(canvasPath(sessionId), change)
}
