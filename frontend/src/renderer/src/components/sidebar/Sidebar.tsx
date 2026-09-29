import { Link } from '@tanstack/react-router'
import { Search, Settings, SquarePen } from 'lucide-react'
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react'
import { ConnectionFooterButton } from '@/components/connection/ConnectionFooterButton'
import { UpdatePanel } from '@/components/update/UpdatePanel'
import { SECTIONS } from './NavRail'
import { SidebarSessions } from './SidebarSessions'

const NAV_LINK_CLASS =
  'group flex h-[30px] items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-list-hover max-sm:h-11 max-sm:px-3 max-sm:text-[15px]'

export function Sidebar({
  open,
  width,
  mobile = false,
  onDismiss,
  resizing,
  onResizeStart,
  onResizeReset,
  onOpenCommandPalette,
  onOpenSettings,
  onOpenConnect,
}: {
  open: boolean
  width: number
  mobile?: boolean
  onDismiss?: () => void
  resizing?: boolean
  onResizeStart: (e: ReactPointerEvent) => void
  onResizeReset: () => void
  onOpenCommandPalette: () => void
  onOpenSettings: () => void
  onOpenConnect: () => void
}) {
  const navRef = useRef<HTMLElement | null>(null)
  const [navEdge, setNavEdge] = useState({ scrollable: false, scrolled: false })
  const updateNavEdge = useCallback(() => {
    const nav = navRef.current
    const scrollable = Boolean(nav && nav.scrollHeight - nav.clientHeight > 1)
    const scrolled = Boolean(scrollable && nav && nav.scrollTop > 1)
    setNavEdge((current) =>
      current.scrollable === scrollable && current.scrolled === scrolled
        ? current
        : { scrollable, scrolled },
    )
  }, [])

  useEffect(() => {
    updateNavEdge()
    const nav = navRef.current
    if (!nav) return

    const resizeObserver = new ResizeObserver(updateNavEdge)
    resizeObserver.observe(nav)
    const mutationObserver = new MutationObserver(updateNavEdge)
    mutationObserver.observe(nav, { childList: true, subtree: true })
    window.addEventListener('resize', updateNavEdge)
    const frame = window.requestAnimationFrame(updateNavEdge)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updateNavEdge)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [updateNavEdge])

  const showNavEdge = navEdge.scrollable && navEdge.scrolled

  return (
    <aside
      onClick={
        mobile && onDismiss
          ? (event) => {
              if (!(event.target as HTMLElement).closest('button, input, textarea')) onDismiss()
            }
          : undefined
      }
      className="relative flex h-full shrink-0 flex-col border-r border-border bg-panel max-sm:w-full!"
      style={{ width }}
    >
      <div className="flex shrink-0 flex-col pl-1.5 pr-3 pt-1.5 pb-px max-sm:px-4 max-sm:pt-2">
        <div className="flex items-center gap-px">
          <Link
            to="/new"
            className={`${NAV_LINK_CLASS} min-w-0 flex-1`}
            activeProps={{ className: 'bg-list-active!' }}
          >
            <span className="grid size-[18px] shrink-0 place-items-center">
              <SquarePen size={15} className="text-ink-2 max-sm:size-[18px]" />
            </span>
            <span className="flex-1">New task</span>
          </Link>
          <button
            type="button"
            onClick={onOpenCommandPalette}
            aria-label="Open search"
            className="grid size-[30px] shrink-0 place-items-center rounded-lg text-ink-3 transition-colors duration-150 hover:bg-list-hover hover:text-ink focus-visible:bg-list-hover focus-visible:ring-2 focus-visible:ring-primary/40 max-sm:size-11"
          >
            <Search size={15} className="max-sm:size-[18px]" />
          </button>
        </div>
      </div>

      <div
        aria-hidden
        className={`pointer-events-none relative z-[1] h-0 shrink-0 transition-opacity duration-150 ${
          showNavEdge ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="h-px bg-border/70" />
        <div className="absolute inset-x-0 top-px h-5 bg-gradient-to-b from-panel to-transparent" />
      </div>

      <nav
        ref={navRef}
        onScroll={updateNavEdge}
        className="scrollbar-quiet flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pl-1.5 pr-3 pt-4 max-sm:gap-6 max-sm:px-4"
      >
        {/* Phones have no rail, so its tabs ride at the top of the drawer. */}
        {mobile && (
          <div className="flex flex-col gap-px">
            {SECTIONS.map(({ to, label, Icon }) => (
              <Link key={to} to={to} className={NAV_LINK_CLASS} activeProps={{ className: 'bg-list-active!' }}>
                <span className="grid size-[18px] shrink-0 place-items-center">
                  <Icon size={18} className="text-ink-2" />
                </span>
                <span className="flex-1">{label}</span>
              </Link>
            ))}
          </div>
        )}

        <SidebarSessions open={open} />
      </nav>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-border pl-1.5 pr-3 py-1.5 empty:hidden max-sm:pl-3">
        <UpdatePanel />
        <ConnectionFooterButton onOpenConnect={onOpenConnect} />
        {mobile && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[15px] font-medium text-ink transition-colors duration-150 hover:bg-list-hover"
          >
            <span className="grid size-[18px] shrink-0 place-items-center">
              <Settings size={18} className="text-ink-2" />
            </span>
            <span className="flex-1 text-left">Settings</span>
          </button>
        )}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onResizeStart}
        onDoubleClick={onResizeReset}
        className="group absolute inset-y-0 right-0 z-10 flex w-2 cursor-col-resize touch-none justify-end max-sm:hidden"
      >
        <span
          className={`h-full w-px transition-colors duration-150 group-hover:bg-primary/40 ${
            resizing ? 'bg-primary/60' : 'bg-transparent'
          }`}
        />
      </div>
    </aside>
  )
}
