import { Link, useRouterState } from '@tanstack/react-router'
import { LayoutDashboard, MessageSquare, Repeat, Settings } from 'lucide-react'
import { useState } from 'react'

export const RAIL_WIDTH = 48

// The sections beside Chat. Each takes the whole content card; Chat is the one
// tab that keeps the thread panel.
export const SECTIONS = [
  { to: '/loops', label: 'Loops', Icon: Repeat },
  { to: '/boards', label: 'Boards', Icon: LayoutDashboard },
] as const

export type RailTab = 'chat' | 'settings' | (typeof SECTIONS)[number]['to']

// Settings rides in the URL search over any page, so it outranks the path.
export function railTab(pathname: string, settingsOpen: boolean): RailTab {
  if (settingsOpen) return 'settings'
  return SECTIONS.find(({ to }) => pathname.startsWith(to))?.to ?? 'chat'
}

const TAB_CLASS =
  'grid size-9 place-items-center rounded-[10px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] [&_svg]:size-[18px] [&_svg]:stroke-[1.75]'

const tabClass = (active: boolean) =>
  `${TAB_CLASS} ${active ? 'bg-list-active text-ink' : 'text-ink-2 hover:bg-list-hover hover:text-ink'}`

export function NavRail({ tab, onOpenSettings }: { tab: RailTab; onOpenSettings: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // The Chat tab returns to the thread the user left, the way switching apps
  // does; a fresh /new clears it so the tab lands back on the composer.
  const [lastSession, setLastSession] = useState<string>()
  const session = /^\/sessions\/([^/]+)/.exec(pathname)?.[1]
  const current = session ?? (pathname === '/new' ? undefined : lastSession)
  if (current !== lastSession) setLastSession(current)

  return (
    <nav aria-label="Sections" style={{ width: RAIL_WIDTH }} className="flex shrink-0 flex-col items-center gap-2 pb-2 pt-[5px] max-sm:hidden">
      <Link
        to={lastSession ? '/sessions/$sessionId' : '/new'}
        params={lastSession ? { sessionId: lastSession } : {}}
        aria-label="Chat"
        title="Chat"
        className={tabClass(tab === 'chat')}
      >
        <MessageSquare aria-hidden />
      </Link>
      {SECTIONS.map(({ to, label, Icon }) => (
        <Link
          key={to}
          to={to}
          aria-label={label}
          title={label}
          className={tabClass(tab === to)}
        >
          <Icon aria-hidden />
        </Link>
      ))}
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings (⌘,)"
        className={`${tabClass(tab === 'settings')} mt-auto`}
      >
        <Settings aria-hidden />
      </button>
    </nav>
  )
}
