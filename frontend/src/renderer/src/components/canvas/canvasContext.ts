import { createContext, useContext } from 'react'
import type { CanvasPatch, CanvasView } from '@/lib/api/canvas'

export interface CanvasBoard {
  sessionId: string
  view: CanvasView
  theme: string
  focused: string | null
  setFocused: (id: string | null) => void
  editing: string | null
  setEditing: (id: string | null) => void
  dropTarget: string | null
  connectSource: string | null
  commit: (change: CanvasPatch) => void
  prompt: (text: string) => void
}

export const CanvasContext = createContext<CanvasBoard | null>(null)

export const useCanvas = () => useContext(CanvasContext)!
