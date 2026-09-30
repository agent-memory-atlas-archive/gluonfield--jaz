import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { stateDot } from '@/components/sidebar/SessionRow'
import { PANEL_ICON_BUTTON_CLASS, SidebarHeader, SidebarScroll } from '@/components/sidebar/SidebarScroll'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { botsQuery } from '@/lib/api/bots'
import type { Bot } from '@/lib/api/types'
import { botAvatars, botSections } from '@/lib/bots'
import { useContextMenuTrigger } from '@/lib/hooks/useContextMenuTrigger'
import { BotIcon } from './BotAvatar'
import { BotMenu } from './BotMenu'
import { BotNameInput } from './BotNameInput'
import { NewBotPicker } from './NewBotPicker'

export function BotsPanel({ mobile }: { mobile: boolean }) {
  const bots = useQuery({
    ...botsQuery,
    refetchInterval: (query) => (query.state.data?.some((bot) => bot.status === 'running') ? 3_000 : 15_000),
  })
  const [query, setQuery] = useState<string | null>(null)
  const list = useMemo(() => bots.data ?? [], [bots.data])
  const { pinned, rest } = useMemo(() => botSections(list, query ?? ''), [list, query])

  return (
    <>
      <SidebarHeader>
        {query === null ? (
          <>
            <p className="flex h-[30px] min-w-0 flex-1 items-center px-2.5 text-[13px] font-medium text-ink max-sm:h-11 max-sm:px-3 max-sm:text-[15px]">
              Bots
            </p>
            <button
              type="button"
              aria-label="Search bots"
              title="Search bots"
              onClick={() => setQuery('')}
              className={PANEL_ICON_BUTTON_CLASS}
            >
              <Search size={15} className="max-sm:size-[18px]" />
            </button>
          </>
        ) : (
          <input
            autoFocus
            value={query}
            aria-label="Search bots"
            placeholder="Search bots"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery(null)
            }}
            onBlur={() => {
              if (!query.trim()) setQuery(null)
            }}
            className="mr-px h-[30px] min-w-0 flex-1 rounded-lg bg-list-hover px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 max-sm:h-11 max-sm:text-[15px]"
          />
        )}
        <NewBotPicker bots={list} />
      </SidebarHeader>
      <SidebarScroll mobile={mobile}>
        {bots.isPending ? (
          <SkeletonRows count={4} />
        ) : bots.isError && !bots.data ? (
          <p className="px-2.5 py-1 text-[13px] text-ink-3">Backend unreachable</p>
        ) : (
          <section className="flex shrink-0 flex-col gap-3">
            {pinned.length ? (
              <div className="grid grid-cols-2 gap-px">
                {pinned.map((bot) => (
                  <BotEntry key={bot.id} bot={bot} bots={list} tile />
                ))}
              </div>
            ) : null}
            <div className="flex flex-col gap-px">
              {rest.map((bot) => (
                <BotEntry key={bot.id} bot={bot} bots={list} />
              ))}
            </div>
            {!list.length ? <p className="px-2.5 py-1 text-[13px] text-ink-3">No bots yet</p> : null}
          </section>
        )}
      </SidebarScroll>
    </>
  )
}

// A pinned bot is a tile (face over name); the rest are rows with a preview.
function BotEntry({ bot, bots, tile = false }: { bot: Bot; bots: Bot[]; tile?: boolean }) {
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuTriggers = useContextMenuTrigger(setMenu)
  const state = stateDot(bot)
  const dot = state ? <span title={state.title} className={`size-1.5 shrink-0 rounded-full ${state.className}`} /> : null
  const name = renaming ? (
    <BotNameInput
      bot={bot}
      autoFocus
      onDone={() => setRenaming(false)}
      className={`w-full rounded bg-surface-1 px-1.5 py-0.5 text-[13px] ring-1 ring-primary ${tile ? 'text-center' : ''}`}
    />
  ) : (
    <span className="min-w-0 truncate">{bot.name}</span>
  )

  return (
    <>
      <Link
        to="/bots/$botId"
        params={{ botId: bot.id }}
        activeProps={{ className: 'bg-list-active!' }}
        {...menuTriggers}
        className={`select-none rounded-lg text-ink transition-colors duration-150 [-webkit-touch-callout:none] hover:bg-list-hover ${
          tile
            ? 'flex min-w-0 flex-col items-center gap-1.5 px-2 pt-3 pb-2 text-[12px] max-sm:text-[14px]'
            : 'flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] max-sm:py-2.5 max-sm:text-[15px]'
        }`}
      >
        <BotIcon avatars={botAvatars(bot, bots)} size={tile ? 44 : 28} />
        {tile ? (
          <span className="flex max-w-full items-center gap-1">
            {name}
            {dot}
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center justify-between gap-2">
              {name}
              {dot}
            </span>
            {bot.preview ? <span className="truncate text-[12px] text-ink-3">{bot.preview}</span> : null}
          </span>
        )}
      </Link>
      {menu ? <BotMenu bot={bot} point={menu} onClose={() => setMenu(null)} onRename={() => setRenaming(true)} /> : null}
    </>
  )
}
