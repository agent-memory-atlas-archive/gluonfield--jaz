import { Link } from '@tanstack/react-router'
import { Search, SquarePen } from 'lucide-react'
import { NAV_LINK_CLASS, PANEL_ICON_BUTTON_CLASS, SidebarHeader, SidebarScroll } from './SidebarScroll'
import { SidebarSessions } from './SidebarSessions'

// Chat's side of the panel: a new task, search, and the threads.
export function ChatPanel({ open, mobile, onOpenCommandPalette }: { open: boolean; mobile: boolean; onOpenCommandPalette: () => void }) {
  return (
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
  )
}
