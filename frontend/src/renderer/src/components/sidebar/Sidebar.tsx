import { Link } from '@tanstack/react-router'
import { Search, Settings, SquarePen } from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { BotsPanel } from '@/components/bots/BotsPanel'
import { ConnectionFooterButton } from '@/components/connection/ConnectionFooterButton'
import { UpdatePanel } from '@/components/update/UpdatePanel'
import { NAV_LINK_CLASS, PANEL_ICON_BUTTON_CLASS, SidebarHeader, SidebarScroll } from './SidebarScroll'
import { SidebarSessions } from './SidebarSessions'

// The thread panel beside the content: Chat's threads, or the Bots list on
// the Bots tab.
export function Sidebar({
  open,
  width,
  mobile = false,
  bots = false,
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
  bots?: boolean
  onDismiss?: () => void
  resizing?: boolean
  onResizeStart: (e: ReactPointerEvent) => void
  onResizeReset: () => void
  onOpenCommandPalette: () => void
  onOpenSettings: () => void
  onOpenConnect: () => void
}) {
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
      {bots ? (
        <BotsPanel mobile={mobile} />
      ) : (
        <>
          <SidebarHeader>
            <Link to="/new" className={`${NAV_LINK_CLASS} min-w-0 flex-1`}>
              <span className="grid size-[18px] shrink-0 place-items-center">
                <SquarePen size={15} className="text-ink-2 max-sm:size-[18px]" />
              </span>
              <span className="flex-1">New task</span>
            </Link>
            <button
              type="button"
              onClick={onOpenCommandPalette}
              aria-label="Open search"
              className={PANEL_ICON_BUTTON_CLASS}
            >
              <Search size={15} className="max-sm:size-[18px]" />
            </button>
          </SidebarHeader>
          <SidebarScroll mobile={mobile}>
            <SidebarSessions open={open} />
          </SidebarScroll>
        </>
      )}

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
