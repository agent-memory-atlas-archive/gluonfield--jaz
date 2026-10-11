import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useViewport,
  type Connection,
  type OnSelectionChangeParams,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import './canvas.css'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useToast } from '@/components/ui/toast'
import { getCanvas, patchCanvas, type CanvasItem, type CanvasPatch, type CanvasView } from '@/lib/api/canvas'
import { useArtifactThemeCSS } from '@/lib/hooks/useArtifactThemeCSS'
import { keys } from '@/lib/query/keys'
import {
  applyPatch,
  bounds,
  changedNodeIds,
  contains,
  containsPoint,
  fileName,
  focusable,
  growToFit,
  itemLabel,
  mergeEdges,
  mergeNodes,
  rectOfNode,
  padded,
  rounded,
  sectionContents,
  sidesBetween,
  toFlowEdges,
  toFlowNodes,
  viewerFor,
  type BoardEdge,
  type BoardNode,
  type Rect,
} from './board'
import { CanvasContext, type CanvasBoard } from './canvasContext'
import { CanvasDock, type Tool } from './CanvasDock'
import { ConnectorEdge, FileNode, GroupNode, LinkNode, TextNode } from './CanvasNodes'
import type { CanvasPick } from './useCanvasContexts'

interface Props {
  sessionId: string
  working: boolean
  selection: string[]
  onSelect: (picks: CanvasPick[]) => void
  onPrompt: (text: string) => void
}

const nodeTypes = { text: TextNode, file: FileNode, link: LinkNode, group: GroupNode }
const edgeTypes = { connector: ConnectorEdge }
const FIT = { padding: { top: '56px', bottom: '56px', left: '88px', right: '56px' } } as const
// After this long without input the camera may follow the agent's edits.
const IDLE_MS = 3000
const HINTS: Record<string, string> = { link: 'Use the page', cad: 'Drag to rotate, scroll to zoom', dxf: 'Drag to pan, scroll to zoom', pdf: 'Scroll and use the page controls' }

export function ThreadCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  )
}

function newId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}`
}

function pointerOf(event: MouseEvent | TouchEvent) {
  return 'changedTouches' in event ? event.changedTouches[0] : event
}

function Board({ sessionId, working, selection, onSelect, onPrompt }: Props) {
  const flow = useReactFlow<BoardNode, BoardEdge>()
  const { zoom } = useViewport()
  const queryClient = useQueryClient()
  const toast = useToast()
  const theme = useArtifactThemeCSS()
  const container = useRef<HTMLDivElement>(null)
  // Polling while the agent works; a final read when the turn ends.
  const canvas = useQuery({
    queryKey: keys.sessionCanvas(sessionId),
    queryFn: () => getCanvas(sessionId, queryClient.getQueryData<CanvasView>(keys.sessionCanvas(sessionId))),
    refetchInterval: working ? 1000 : false,
  })
  const { refetch } = canvas
  const wasWorking = useRef(working)
  useEffect(() => {
    if (wasWorking.current && !working) void refetch()
    wasWorking.current = working
  }, [working, refetch])

  const view = canvas.data
  const [pending, setPending] = useState<CanvasPatch[]>([])
  const local = useMemo(() => (view ? pending.reduce(applyPatch, view) : undefined), [view, pending])
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<BoardEdge>([])
  const held = useRef(new Set<string>())
  useEffect(() => {
    if (!local) return
    setNodes((current) => mergeNodes(current, toFlowNodes(local), held.current))
    setEdges((current) => mergeEdges(current, toFlowEdges(local)))
  }, [local, setNodes, setEdges])

  const mine = useRef(new Map<string, number>())
  const commit = useCallback((change: CanvasPatch) => {
    const until = Date.now() + 5000
    for (const item of [...(change.nodes ?? []), ...(change.edges ?? [])]) mine.current.set(item.id!, until)
    setPending((current) => [...current, change])
    patchCanvas(sessionId, change)
      .catch((error: Error) => toast(`Couldn't save the canvas: ${error.message}`, 'danger'))
      .then(() => refetch())
      .finally(() => setPending((current) => current.filter((item) => item !== change)))
  }, [sessionId, refetch, toast])

  // The camera follows the agent's edits unless the user is in the middle of
  // something; then a pill offers to show them.
  const touched = useRef(0)
  const seen = useRef<CanvasView | undefined>(undefined)
  const [flash, setFlash] = useState<Record<string, number>>({})
  const [news, setNews] = useState<string[]>([])
  const show = useCallback((ids: string[]) => {
    setNews([])
    requestAnimationFrame(() => void flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 600, maxZoom: 1, ...FIT }))
  }, [flow])
  useEffect(() => {
    if (!view) return
    const before = seen.current
    seen.current = view
    if (!before) {
      requestAnimationFrame(() => void flow.fitView({ maxZoom: 1, ...FIT }))
      return
    }
    const now = Date.now()
    const box = container.current?.getBoundingClientRect()
    const viewport = flow.getViewport()
    const visible = (id: string) => {
      const node = flow.getNode(id)
      if (!node || !box) return false
      const rect = rectOfNode(node)
      const left = rect.x * viewport.zoom + viewport.x
      const top = rect.y * viewport.zoom + viewport.y
      return left >= 0 && top >= 0 && left + rect.width * viewport.zoom <= box.width && top + rect.height * viewport.zoom <= box.height
    }
    const changed = changedNodeIds(before, view).filter((id) => (mine.current.get(id) ?? 0) < now)
    if (!changed.length) return
    setFlash((current) => ({ ...current, ...Object.fromEntries(changed.map((id) => [id, now])) }))
    if (changed.every(visible)) return
    if (now - touched.current > IDLE_MS) show(changed)
    else setNews(changed)
  }, [view, flow, show])

  const [tool, setTool] = useState<Tool>('select')
  const [editing, setEditing] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const [connectSource, setConnectSource] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const onSelectionChange = useCallback(({ nodes: picked }: OnSelectionChangeParams<BoardNode, BoardEdge>) => {
    onSelect(picked.map((node) => ({ node: node.id, label: itemLabel(node.data.item) })))
  }, [onSelect])
  useEffect(() => {
    const wanted = new Set(selection)
    setNodes((current) =>
      current.every((node) => Boolean(node.selected) === wanted.has(node.id))
        ? current
        : current.map((node) => ({ ...node, selected: wanted.has(node.id) })))
  }, [selection, setNodes])

  // A new item dropped inside a section grows the section around it.
  const sectionFor = (rect: Rect, ignore: Set<string> = new Set()): Partial<CanvasItem>[] => {
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    const sections = flow.getNodes()
      .filter((node) => node.type === 'group' && !ignore.has(node.id) && containsPoint(rectOfNode(node), centre.x, centre.y))
      .sort((a, b) => rectOfNode(a).width * rectOfNode(a).height - rectOfNode(b).width * rectOfNode(b).height)
    const section = sections[0]
    if (!section || contains(rectOfNode(section), rect)) return []
    return [{ id: section.id, ...rounded(growToFit(rectOfNode(section), [rect])) }]
  }

  const create = (kind: Tool, clientX: number, clientY: number) => {
    const at = flow.screenToFlowPosition({ x: clientX, y: clientY })
    const id = newId(kind)
    const rect = kind === 'sticky'
      ? { x: at.x - 100, y: at.y - 100, width: 200, height: 200 }
      : { x: at.x, y: at.y - 20, width: 240, height: 48 }
    commit({ nodes: [{ id, type: 'text', text: '', ...(kind === 'sticky' ? { color: '3' } : {}), ...rounded(rect) }, ...sectionFor(rect)] })
    setEditing(id)
    setTool('select')
  }

  const addSection = (rect: Rect) => {
    commit({ nodes: [{ id: newId('section'), type: 'group', label: 'Section', ...rounded(rect) }] })
    setTool('select')
  }

  const onLayerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'section') setDraft({ x0: event.clientX, y0: event.clientY, x1: event.clientX, y1: event.clientY })
  }

  const onLayerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draft) {
      create(tool, event.clientX, event.clientY)
      return
    }
    setDraft(null)
    const a = flow.screenToFlowPosition({ x: Math.min(draft.x0, draft.x1), y: Math.min(draft.y0, draft.y1) })
    const b = flow.screenToFlowPosition({ x: Math.max(draft.x0, draft.x1), y: Math.max(draft.y0, draft.y1) })
    const small = Math.abs(draft.x1 - draft.x0) < 12 && Math.abs(draft.y1 - draft.y0) < 12
    addSection(small ? { x: a.x - 240, y: a.y - 160, width: 480, height: 320 } : { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y })
  }

  // Dragging a section carries the items inside it; dragging items over a
  // section grows it to hold them. Nothing from the server lands mid-drag.
  const dragStart = useRef<Map<string, Rect> | null>(null)
  const members = useRef(new Map<string, string[]>())
  const onNodeDragStart = (_event: unknown, _node: BoardNode, dragged: BoardNode[]) => {
    setBusy(true)
    const all = flow.getNodes()
    const draggedIds = new Set(dragged.map((node) => node.id))
    dragStart.current = new Map(all.map((node) => [node.id, rectOfNode(node)]))
    members.current = new Map(dragged.filter((node) => node.type === 'group').map((group) => [
      group.id,
      sectionContents(group, all).filter((node) => !draggedIds.has(node.id)).map((node) => node.id),
    ]))
    held.current = new Set(all.map((node) => node.id))
  }

  const onNodeDrag = (event: MouseEvent | TouchEvent, _node: BoardNode, dragged: BoardNode[]) => {
    const start = dragStart.current
    if (!start) return
    const draggedIds = new Set(dragged.map((node) => node.id))
    const offsets = new Map<string, { dx: number; dy: number }>()
    for (const group of dragged.filter((node) => node.type === 'group')) {
      const from = start.get(group.id)!
      const delta = { dx: group.position.x - from.x, dy: group.position.y - from.y }
      for (const id of members.current.get(group.id) ?? []) offsets.set(id, delta)
    }
    const items = dragged.filter((node) => node.type !== 'group').map(rectOfNode)
    let target: string | null = null
    if (items.length) {
      const pointer = pointerOf(event)
      const point = flow.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY })
      target = flow.getNodes()
        .filter((node) => node.type === 'group' && !draggedIds.has(node.id) && containsPoint(start.get(node.id)!, point.x, point.y))
        .sort((a, b) => start.get(a.id)!.width * start.get(a.id)!.height - start.get(b.id)!.width * start.get(b.id)!.height)[0]?.id ?? null
    }
    setDropTarget(target)
    setNodes((current) => current.map((node) => {
      const delta = offsets.get(node.id)
      const from = start.get(node.id)
      if (delta && from) return { ...node, position: { x: from.x + delta.dx, y: from.y + delta.dy } }
      if (node.type !== 'group' || draggedIds.has(node.id) || !from) return node
      const rect = node.id === target ? growToFit(from, items) : from
      return { ...node, position: { x: rect.x, y: rect.y }, width: rect.width, height: rect.height }
    }))
  }

  const onNodeDragStop = () => {
    const start = dragStart.current
    dragStart.current = null
    held.current = new Set()
    setBusy(false)
    setDropTarget(null)
    if (!start) return
    const moved = flow.getNodes().flatMap((node) => {
      const from = start.get(node.id)
      const rect = rounded(rectOfNode(node))
      return from && JSON.stringify(rect) !== JSON.stringify(rounded(from)) ? [{ id: node.id, ...rect }] : []
    })
    if (moved.length) commit({ nodes: moved })
  }

  const onConnect = (connection: Connection) => {
    commit({ edges: [{ id: newId('edge'), fromNode: connection.source, toNode: connection.target, fromSide: connection.sourceHandle, toSide: connection.targetHandle }] })
  }

  const onReconnect = (old: BoardEdge, connection: Connection) => {
    commit({ edges: [{ id: old.id, fromNode: connection.source, toNode: connection.target, fromSide: connection.sourceHandle, toSide: connection.targetHandle }] })
  }

  const onNodeClick = (_event: unknown, node: BoardNode) => {
    if (tool !== 'connector') return
    if (!connectSource) {
      setConnectSource(node.id)
      return
    }
    if (node.id === connectSource) return
    const [fromSide, toSide] = sidesBetween(rectOfNode(flow.getNode(connectSource)!), rectOfNode(node))
    commit({ edges: [{ id: newId('edge'), fromNode: connectSource, toNode: node.id, fromSide, toSide }] })
    setConnectSource(null)
    setTool('select')
  }

  const chooseTool = (next: Tool) => {
    setTool(next)
    setConnectSource(null)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (event.defaultPrevented || target.closest('input, textarea, [contenteditable="true"]')) return
      if (event.key === 'Escape') {
        setFocused(null)
        setTool('select')
        setConnectSource(null)
        return
      }
      // Cmd+Delete removes a section and keeps what it holds; React Flow's own
      // Delete would take the contents too.
      if ((event.metaKey || event.ctrlKey) && (event.key === 'Backspace' || event.key === 'Delete')) {
        const sections = flow.getNodes().filter((node) => node.selected && node.type === 'group')
        if (!sections.length) return
        event.preventDefault()
        event.stopPropagation()
        commit({ remove: sections.map((node) => node.id) })
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const shortcuts: Record<string, Tool> = { KeyV: 'select', KeyH: 'hand', KeyS: 'sticky', KeyT: 'text', KeyX: 'connector' }
      if (event.code === 'KeyS' && event.shiftKey) {
        event.preventDefault()
        const picked = flow.getNodes().filter((node) => node.selected && node.type !== 'group')
        if (!picked.length) {
          setTool('section')
          return
        }
        addSection(padded(bounds(picked.map(rectOfNode))))
        return
      }
      if (!event.shiftKey && shortcuts[event.code]) setTool(shortcuts[event.code])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const board = useMemo<CanvasBoard | null>(() => view ? {
    sessionId,
    view,
    theme,
    focused,
    setFocused,
    flash,
    editing,
    setEditing,
    dropTarget,
    connectSource,
    commit,
    prompt: onPrompt,
  } : null, [sessionId, view, theme, focused, flash, editing, dropTarget, connectSource, commit, onPrompt])

  const focusedItem = nodes.find((node) => node.id === focused)?.data.item
  const focusedKind = focusedItem?.type === 'link' ? 'link' : viewerFor(String(focusedItem?.file ?? ''))

  return (
    <div
      ref={container}
      className={`canvas tool-${tool}${busy ? ' canvas-busy' : ''}${tool === 'connector' ? ' canvas-connecting' : ''}`}
      onPointerDownCapture={() => (touched.current = Date.now())}
      onWheelCapture={() => (touched.current = Date.now())}
      onKeyDownCapture={() => (touched.current = Date.now())}
    >
      {board ? (
        <CanvasContext.Provider value={board}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onReconnect={onReconnect}
            onDelete={({ nodes: gone, edges: cut }) => {
              const contents = gone.filter((node) => node.type === 'group').flatMap((section) => sectionContents(section, flow.getNodes()))
              commit({ remove: [...new Set([...gone, ...cut, ...contents].map((item) => item.id))] })
            }}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={(event, node) => {
              if (node.type !== 'group') {
                if (focusable(node.data.item)) setFocused(node.id)
                return
              }
              // Double-clicking a section's edge fits it to what it holds.
              const inside = sectionContents(node, flow.getNodes())
              if (inside.length && (event.target as HTMLElement).closest('.react-flow__resize-control')) {
                commit({ nodes: [{ id: node.id, ...rounded(padded(bounds(inside.map(rectOfNode)))) }] })
              }
            }}
            onEdgeDoubleClick={(_event, edge) => setEditing(edge.id)}
            onPaneClick={() => setFocused(null)}
            onSelectionChange={onSelectionChange}
            onMoveStart={(event) => event && setBusy(true)}
            onMoveEnd={() => setBusy(false)}
            onSelectionStart={() => setBusy(true)}
            onSelectionEnd={() => setBusy(false)}
            connectionMode={ConnectionMode.Loose}
            connectionLineStyle={{ stroke: 'var(--canvas-accent)', strokeWidth: 1.5 }}
            reconnectRadius={8}
            panOnScroll
            selectionOnDrag={tool !== 'hand'}
            panOnDrag={tool === 'hand' ? true : [1, 2]}
            nodesDraggable={tool !== 'hand'}
            elementsSelectable={tool !== 'hand'}
            zoomOnDoubleClick={false}
            elevateNodesOnSelect={false}
            nodeDragThreshold={3}
            deleteKeyCode={['Backspace', 'Delete']}
            multiSelectionKeyCode={['Meta', 'Shift']}
            minZoom={0.1}
            maxZoom={4}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.6} color="var(--canvas-dot)" bgColor="var(--color-bg)" />
            <Panel position="bottom-right" className="canvas-map canvas-overlay">
              <MiniMap
                pannable
                zoomable
                ariaLabel="Canvas overview"
                nodeColor={(node) => (node.type === 'group' ? 'var(--canvas-map-section)' : 'var(--canvas-map-node)')}
                nodeStrokeWidth={0}
                maskColor="var(--canvas-map-mask)"
                style={{ position: 'static', margin: 0, width: 200, height: 130, background: 'transparent' }}
              />
              <div className="canvas-zoom">
                <button type="button" aria-label="Zoom out" onClick={() => void flow.zoomOut({ duration: 200 })}>
                  <Minus size={14} />
                </button>
                <button type="button" title="Fit everything" onClick={() => void flow.fitView({ duration: 300, ...FIT })}>
                  {Math.round(zoom * 100)}%
                </button>
                <button type="button" aria-label="Zoom in" onClick={() => void flow.zoomIn({ duration: 200 })}>
                  <Plus size={14} />
                </button>
              </div>
            </Panel>
          </ReactFlow>
        </CanvasContext.Provider>
      ) : null}

      {['sticky', 'text', 'section'].includes(tool) ? (
        <div
          className="canvas-tool-layer"
          onPointerDown={onLayerDown}
          onPointerMove={(event) => draft && setDraft({ ...draft, x1: event.clientX, y1: event.clientY })}
          onPointerUp={onLayerUp}
        >
          {draft ? (
            <div
              className="canvas-section-draft"
              style={{ left: Math.min(draft.x0, draft.x1) - (container.current?.getBoundingClientRect().left ?? 0), top: Math.min(draft.y0, draft.y1) - (container.current?.getBoundingClientRect().top ?? 0), width: Math.abs(draft.x1 - draft.x0), height: Math.abs(draft.y1 - draft.y0) }}
            />
          ) : null}
        </div>
      ) : null}

      <CanvasDock tool={tool} onTool={chooseTool} />

      {focusedItem ? (
        <div className="canvas-overlay canvas-banner">
          <span className="canvas-banner-dot" />
          <span>
            Focused on <strong>{focusedItem.type === 'link' ? String(focusedItem.url) : fileName(String(focusedItem.file))}</strong>
          </span>
          <span className="text-ink-3">{HINTS[focusedKind] ?? ''} · Esc</span>
          <button type="button" onClick={() => setFocused(null)}>Done</button>
        </div>
      ) : news.length ? (
        <div className="canvas-overlay canvas-banner">
          <span className="canvas-banner-dot" />
          <span>Jaz changed {news.length === 1 ? 'an item' : `${news.length} items`}</span>
          <button type="button" onClick={() => show(news)}>Show</button>
        </div>
      ) : canvas.error ? (
        <div className="canvas-overlay canvas-banner danger">{canvas.error.message}</div>
      ) : null}
    </div>
  )
}
