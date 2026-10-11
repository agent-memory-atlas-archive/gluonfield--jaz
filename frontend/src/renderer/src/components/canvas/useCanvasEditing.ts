import { useReactFlow } from '@xyflow/react'
import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
import type { CanvasItem, CanvasPatch, CanvasView } from '@/lib/api/canvas'
import { bounds, cloneItems, itemLabel, rectOfItem, sectionContents, type BoardEdge, type BoardNode } from './board'
import type { CanvasPick } from './useCanvasContexts'

const CLIP = 'application/x-jaz-canvas'
const OFFSET = 24
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

type Clip = { dir: string; nodes: CanvasItem[]; edges: CanvasItem[] }

export function typing(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]')
}

function pick(item: CanvasItem): CanvasPick {
  return { node: item.id, label: itemLabel(item) }
}

// Undo and redo, select all, nudge, duplicate, and copy, cut and paste. They
// act while the board holds the user's attention: focus inside it, or a last
// click on it with nothing else focused.
export function useCanvasEditing({ local, commit, replay, onSelect, container }: {
  local: CanvasView | undefined
  commit: (change: CanvasPatch) => void
  replay: (from: 'undo' | 'redo') => void
  onSelect: (picks: CanvasPick[]) => void
  container: RefObject<HTMLDivElement | null>
}) {
  const flow = useReactFlow<BoardNode, BoardEdge>()
  const clicked = useRef(false)
  const pasted = useRef({ raw: '', count: 0 })

  const attending = (event: Event) => {
    const target = event.target as Node
    return !typing(event.target) && (!!container.current?.contains(target) || (target === document.body && clicked.current))
  }

  // The selection, with what its sections hold and the connectors among them.
  const picked = (board: CanvasView): Clip => {
    const all = flow.getNodes()
    const chosen = all.filter((node) => node.selected)
    const ids = new Set([...chosen, ...chosen.filter((node) => node.type === 'group').flatMap((section) => sectionContents(section, all))].map((node) => node.id))
    return {
      dir: board.dir,
      nodes: board.nodes.filter((item) => ids.has(item.id)),
      edges: board.edges.filter((edge) => ids.has(edge.fromNode as string) && ids.has(edge.toNode as string)),
    }
  }

  const place = ({ nodes, edges }: Clip, dx: number, dy: number) => {
    const change = cloneItems(nodes, edges, dx, dy)
    commit(change)
    onSelect((change.nodes as CanvasItem[]).map(pick))
  }

  // A paste lands beside its original while that is in view, otherwise in the
  // middle of the view; pasting again steps further along. Files from another
  // board keep pointing at its folder.
  const paste = (board: CanvasView, clip: Clip, raw: string) => {
    if (clip.dir !== board.dir) {
      clip.nodes = clip.nodes.map((item) => (typeof item.file === 'string' && !item.file.startsWith('/') ? { ...item, file: `${clip.dir}/${item.file}` } : item))
    }
    const count = pasted.current.raw === raw ? pasted.current.count + 1 : 1
    pasted.current = { raw, count }
    const box = bounds(clip.nodes.map(rectOfItem))
    const screen = container.current!.getBoundingClientRect()
    const a = flow.screenToFlowPosition({ x: screen.left, y: screen.top })
    const b = flow.screenToFlowPosition({ x: screen.right, y: screen.bottom })
    const seen = box.x < b.x && box.x + box.width > a.x && box.y < b.y && box.y + box.height > a.y
    const dx = seen ? 0 : (a.x + b.x - box.width) / 2 - box.x
    const dy = seen ? 0 : (a.y + b.y - box.height) / 2 - box.y
    place(clip, dx + OFFSET * count, dy + OFFSET * count)
  }

  const run = (event: Event, action: () => void) => {
    event.preventDefault()
    event.stopPropagation()
    action()
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (!local || event.defaultPrevented || event.altKey || !attending(event)) {
      return
    }
    const command = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()
    if (command && key === 'z') {
      run(event, () => replay(event.shiftKey ? 'redo' : 'undo'))
      return
    }
    if (command && key === 'y') {
      run(event, () => replay('redo'))
      return
    }
    if (command && key === 'a') {
      run(event, () => onSelect(local.nodes.map(pick)))
      return
    }
    const clip = picked(local)
    if (!clip.nodes.length) {
      return
    }
    if (command && key === 'd') {
      run(event, () => place(clip, OFFSET, OFFSET))
      return
    }
    const arrow = ARROWS[event.key]
    if (!command && arrow) {
      const step = event.shiftKey ? 10 : 1
      run(event, () => commit({ nodes: clip.nodes.map((item) => ({ id: item.id, x: rectOfItem(item).x + arrow[0] * step, y: rectOfItem(item).y + arrow[1] * step })) }))
    }
  })

  const onCopy = useEffectEvent((event: ClipboardEvent) => {
    if (!local || !attending(event)) {
      return
    }
    const clip = picked(local)
    if (!clip.nodes.length) {
      return
    }
    event.preventDefault()
    event.clipboardData?.setData(CLIP, JSON.stringify(clip))
    event.clipboardData?.setData('text/plain', clip.nodes.map(itemLabel).join('\n'))
    if (event.type === 'cut') {
      commit({ remove: clip.nodes.map((item) => item.id) })
    }
  })

  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const raw = event.clipboardData?.getData(CLIP)
    if (!local || !raw || !attending(event)) {
      return
    }
    event.preventDefault()
    paste(local, JSON.parse(raw) as Clip, raw)
  })

  useEffect(() => {
    const key = (event: KeyboardEvent) => onKey(event)
    const copy = (event: ClipboardEvent) => onCopy(event)
    const paste = (event: ClipboardEvent) => onPaste(event)
    const down = (event: PointerEvent) => {
      clicked.current = !!container.current?.contains(event.target as Node)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', down, true)
    document.addEventListener('copy', copy)
    document.addEventListener('cut', copy)
    document.addEventListener('paste', paste)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', down, true)
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', copy)
      document.removeEventListener('paste', paste)
    }
  }, [container])
}
