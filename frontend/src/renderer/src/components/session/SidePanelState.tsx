import { useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import { clientRuntime } from '@/lib/clientRuntime'
import { modalDialogOpen } from '@/lib/dom/modal'
import { isMobileViewport } from '@/lib/hooks/useIsMobile'
import { useWindowEvent } from '@/lib/hooks/useWindowEvent'
import { parseFileReference, type FileReference } from '@shared/fileReader'
import { useBrowserSessions, useSessionPreview } from '@/lib/browserSessions'
import { SidebarVisibility } from '@/lib/sidebar'
import { OVERVIEW_PANEL_WIDTH, sidePanelTabs, type SidePanelMode, type SidePanelTab } from '@/lib/sidePanelTabs'

const PANEL_OPEN_KEY = 'jaz.sessionPanel'
const PANEL_MAX_WIDTH = 1180
const PANEL_MIN_THREAD_WIDTH = 360

export function useSidePanelState(sessionId: string, sideChatAvailable = false) {
  const setSidebarOpen = useContext(SidebarVisibility)
  const browsers = useBrowserSessions()
  const [state, dispatch] = useReducer(sidePanelTabs, undefined, () => {
    const tabs: SidePanelTab[] = browsers.getSnapshot()
      .filter((entry) => entry.ownerId === sessionId)
      .map((entry) => ({ id: entry.id, kind: 'preview' }))
    return { tabs, activeId: tabs[0]?.id ?? null }
  })
  const [containerWidth, setContainerWidth] = useState(0)
  const containerRef = useCallback((element: HTMLDivElement | null) => {
    if (!element) {
      return
    }
    const observer = new ResizeObserver(([entry]) => setContainerWidth(Math.round(entry.contentRect.width)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(PANEL_OPEN_KEY)
    return stored === 'open' ? true : stored === 'closed' ? false : !isMobileViewport()
  })
  const [mode, setMode] = useState<SidePanelMode>('overview')
  const [widthOverride, setWidthOverride] = useState<number>()
  const [resizing, setResizing] = useState(false)
  const tabs = useMemo(() => state.tabs.filter((tab) => tab.kind !== 'side-chat' || sideChatAvailable), [state.tabs, sideChatAvailable])
  const activeTab = tabs.find((tab) => tab.id === state.activeId) ?? tabs[0]
  const availableWidth = containerWidth - PANEL_MIN_THREAD_WIDTH
  const minWidth = Math.min(400, Math.max(240, availableWidth))
  const defaultWidth = Math.max(640, Math.round(containerWidth * 0.6))
  const maxWidth = Math.max(minWidth, Math.min(PANEL_MAX_WIDTH, availableWidth))
  const width = mode === 'overview' ? OVERVIEW_PANEL_WIDTH : clampWidth(widthOverride ?? defaultWidth, minWidth, maxWidth)
  const availableCSS = `calc(100% - ${PANEL_MIN_THREAD_WIDTH}px)`
  const preferredCSS = widthOverride === undefined ? 'max(640px, 60%)' : `${widthOverride}px`
  const widthStyle = mode === 'tabs'
    ? `clamp(min(400px, max(240px, ${availableCSS})), ${preferredCSS}, max(240px, min(${PANEL_MAX_WIDTH}px, ${availableCSS})))`
    : `${width}px`

  useEffect(() => {
    localStorage.setItem(PANEL_OPEN_KEY, open ? 'open' : 'closed')
  }, [open])

  const showTabs = useCallback(() => {
    setSidebarOpen?.(false)
    setMode('tabs')
    setOpen(true)
  }, [setSidebarOpen])
  const toggleMode = useCallback((next: SidePanelMode) => {
    if (open && mode === next) {
      setOpen(false)
    } else if (next === 'tabs') {
      showTabs()
    } else {
      setMode(next)
      setOpen(true)
    }
  }, [open, mode, showTabs])
  const close = useCallback(() => setOpen(false), [])
  const resize = useCallback((next: number) => setWidthOverride(clampWidth(next, minWidth, maxWidth)), [minWidth, maxWidth])
  const selectTab = useCallback((id: string) => {
    dispatch({ type: 'select', id })
    showTabs()
  }, [showTabs])
  const openTab = useCallback((tab: SidePanelTab) => {
    dispatch({ type: 'open', tab })
    showTabs()
  }, [showTabs])
  const showPreview = useCallback(() => openTab({ id: sessionId, kind: 'preview' }), [openTab, sessionId])
  useSessionPreview(sessionId, showPreview)

  const addTab = useCallback((kind: SidePanelTab['kind']) => {
    if (kind === 'preview') {
      openTab({ id: browsers.openTab(sessionId), kind })
    } else if (kind === 'file') {
      openTab({ id: 'file', kind, file: null })
    } else {
      openTab({ id: kind, kind })
    }
  }, [browsers, openTab, sessionId])
  const closeTab = useCallback((id: string) => {
    browsers.close(id)
    dispatch({ type: 'close', id })
  }, [browsers])
  const openPreview = useCallback((url: string) => {
    openTab({ id: browsers.openTab(sessionId, url), kind: 'preview' })
  }, [browsers, openTab, sessionId])
  useEffect(() => clientRuntime.onOpenPreviewURL?.(openPreview), [openPreview])

  const openFile = useCallback((file: string | FileReference) => {
    const ref = typeof file === 'string' ? parseFileReference(file) : file
    if (!ref) {
      return false
    }
    openTab({ id: `file:${ref.path}`, kind: 'file', file: ref })
    return true
  }, [openTab])

  useWindowEvent('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.defaultPrevented || event.altKey || modalDialogOpen()) {
      return
    }
    const key = event.key.toLowerCase()
    if (event.shiftKey) {
      if (key === 's') {
        event.preventDefault()
        toggleMode('tabs')
      }
      return
    }
    if (!event.metaKey || event.ctrlKey) {
      return
    }
    if (key === 'o') {
      event.preventDefault()
      toggleMode('overview')
      return
    }
    const shortcuts = { j: 'side-chat', d: 'diff', p: 'preview', t: 'terminal' } as const
    const kind = shortcuts[key as keyof typeof shortcuts]
    if (!kind || (kind === 'side-chat' && !sideChatAvailable)) {
      return
    }
    event.preventDefault()
    const existing = tabs.find((tab) => tab.kind === kind)
    if (existing) {
      selectTab(existing.id)
    } else {
      addTab(kind)
    }
  })

  return {
    containerRef, open, mode, tabs, activeTab,
    resize, resizing, setResizing, width, widthStyle, minWidth, maxWidth,
    resizable: mode === 'tabs',
    toggleMode, close, selectTab, addTab, closeTab, openFile, openPreview,
  }
}

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.round(Math.min(Math.max(width, minWidth), maxWidth))
}
