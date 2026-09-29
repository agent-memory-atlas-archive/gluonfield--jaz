import { Link, useRouterState } from '@tanstack/react-router'
import { LayoutDashboard, MessageSquare, Repeat, Settings } from 'lucide-react'
import { useState } from 'react'

export const RAIL_WIDTH = 48

export function navTab(pathname: string) {
  if (pathname.startsWith('/loops')) return 'loops'
  if (pathname.startsWith('/boards')) return 'boards'
  return 'chat'
}

const TAB_CLASS =
  'grid size-9 place-items-center rounded-[10px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] [&_svg]:size-[18px] [&_svg]:stroke-[1.75]'

const tabClass = (active: boolean) =>
  `${TAB_CLASS} ${active ? 'bg-list-active text-ink' : 'text-ink-2 hover:bg-list-hover hover:text-ink'}`

export function NavRail({ onOpenSettings }: { onOpenSettings: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const tab = navTab(pathname)

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
        aria-current={tab === 'chat' ? 'page' : undefined}
        className={tabClass(tab === 'chat')}
      >
        <MessageSquare aria-hidden />
      </Link>
      <Link
        to="/loops"
        aria-label="Loops"
        title="Loops"
        aria-current={tab === 'loops' ? 'page' : undefined}
        className={tabClass(tab === 'loops')}
      >
        <Repeat aria-hidden />
      </Link>
      <Link
        to="/boards"
        aria-label="Boards"
        title="Boards"
        aria-current={tab === 'boards' ? 'page' : undefined}
        className={tabClass(tab === 'boards')}
      >
        <LayoutDashboard aria-hidden />
      </Link>
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings (⌘,)"
        className={`${tabClass(false)} mt-auto`}
      >
        <Settings aria-hidden />
      </button>
    </nav>
  )
}
