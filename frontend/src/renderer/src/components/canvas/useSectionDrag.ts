import { useReactFlow } from '@xyflow/react'
import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { CanvasPatch } from '@/lib/api/canvas'
import { growToFit, innermostSection, rectOfNode, rounded, sectionContents, type BoardEdge, type BoardNode, type Rect } from './board'

function pointerOf(event: MouseEvent | TouchEvent) {
  return 'changedTouches' in event ? event.changedTouches[0] : event
}

// Dragging a section carries the items inside it; dragging items over a section
// grows it to hold them. The result is saved once, when the drag ends.
export function useSectionDrag(setNodes: Dispatch<SetStateAction<BoardNode[]>>, commit: (change: CanvasPatch) => void) {
  const flow = useReactFlow<BoardNode, BoardEdge>()
  const start = useRef<Map<string, Rect> | null>(null)
  const members = useRef(new Map<string, string[]>())
  const [dragging, setDragging] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const onNodeDragStart = (_event: unknown, _node: BoardNode, dragged: BoardNode[]) => {
    const all = flow.getNodes()
    const draggedIds = new Set(dragged.map((node) => node.id))
    start.current = new Map(all.map((node) => [node.id, rectOfNode(node)]))
    members.current = new Map(dragged.filter((node) => node.type === 'group').map((section) => [
      section.id,
      sectionContents(section, all).filter((node) => !draggedIds.has(node.id)).map((node) => node.id),
    ]))
    setDragging(true)
  }

  const onNodeDrag = (event: MouseEvent | TouchEvent, _node: BoardNode, dragged: BoardNode[]) => {
    const from = start.current
    if (!from) return
    const draggedIds = new Set(dragged.map((node) => node.id))
    const offsets = new Map<string, { dx: number; dy: number }>()
    for (const section of dragged.filter((node) => node.type === 'group')) {
      const origin = from.get(section.id)!
      for (const id of members.current.get(section.id) ?? []) offsets.set(id, { dx: section.position.x - origin.x, dy: section.position.y - origin.y })
    }
    const items = dragged.filter((node) => node.type !== 'group').map(rectOfNode)
    let target: string | null = null
    if (items.length) {
      const pointer = pointerOf(event)
      const point = flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY })
      const sections = flow.getNodes().filter((node) => node.type === 'group' && !draggedIds.has(node.id))
      target = innermostSection(sections.map((node) => ({ id: node.id, rect: from.get(node.id)! })), point.x, point.y)?.id ?? null
    }
    setDropTarget(target)
    setNodes((current) => current.map((node) => {
      const delta = offsets.get(node.id)
      const origin = from.get(node.id)
      if (delta && origin) return { ...node, position: { x: origin.x + delta.dx, y: origin.y + delta.dy } }
      if (node.type !== 'group' || draggedIds.has(node.id) || !origin) return node
      const rect = node.id === target ? growToFit(origin, items) : origin
      return { ...node, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height }
    }))
  }

  const onNodeDragStop = () => {
    const from = start.current
    start.current = null
    setDragging(false)
    setDropTarget(null)
    if (!from) return
    const moved = flow.getNodes().flatMap((node) => {
      const before = from.get(node.id)
      const rect = rounded(rectOfNode(node))
      return before && JSON.stringify(rect) !== JSON.stringify(rounded(before)) ? [{ id: node.id, ...rect }] : []
    })
    if (moved.length) commit({ nodes: moved })
  }

  return { dragging, dropTarget, onNodeDragStart, onNodeDrag, onNodeDragStop }
}
