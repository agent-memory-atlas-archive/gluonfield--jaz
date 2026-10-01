import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { type DragEvent, useMemo, useState } from 'react'
import { stateDot } from '@/components/sidebar/SessionRow'
import { PANEL_ICON_BUTTON_CLASS, SidebarHeader, SidebarScroll } from '@/components/sidebar/SidebarScroll'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { botsQuery } from '@/lib/api/bots'
import type { Bot } from '@/lib/api/types'
import { botAvatars, botSections, placePin } from '@/lib/bots'
import { useContextMenuTrigger } from '@/lib/hooks/useContextMenuTrigger'
import { BotIcon } from './BotAvatar'
import { BotMenu } from './BotMenu'
import { BotNameInput } from './BotNameInput'
import { NewBotPicker } from './NewBotPicker'
import { usePins } from './usePins'

// A dragged bot and the pinned order it would leave behind if dropped now.
type PinDrag = { id: string; pins: string[] }

export function BotsPanel({ mobile }: { mobile: boolean }) {
  const bots = useQuery({
    ...botsQuery,
    refetchInterval: (query) => (query.state.data?.some((bot) => bot.status === 'running') ? 3_000 : 15_000),
  })
  const [query, setQuery] = useState<string | null>(null)
  const list = useMemo(() => bots.data ?? [], [bots.data])
  const { pins, pinned, rest } = useMemo(() => botSections(list, query ?? ''), [list, query])
  const pin = usePins()
  const [drag, setDrag] = useState<PinDrag | null>(null)
  const shown = [...pinned, ...rest]
  const tiles = drag ? drag.pins.flatMap((id) => shown.find((bot) => bot.id === id) ?? []) : pinned
  const startDrag = (id: string) => {
    // A frame later, so the drag image is taken before the bot fades.
    requestAnimationFrame(() => setDrag({ id, pins }))
  }

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
          <section
            onDragOver={(e) => {
              if (!drag) return
              e.preventDefault()
              const next = landing(e, drag, pins)
              if (next.join() !== drag.pins.join()) setDrag({ ...drag, pins: next })
            }}
            onDrop={(e) => {
              if (!drag) return
              e.preventDefault()
              setDrag(null)
              const onTiles = (e.target as Element).closest('[data-pins]')
              pin(() => (onTiles ? drag.pins : drag.pins.filter((id) => id !== drag.id)))
            }}
            onDragEnd={() => setDrag(null)}
            className="flex flex-1 shrink-0 flex-col gap-3"
          >
            {tiles.length ? (
              <div data-pins className="grid grid-cols-3 gap-px">
                {tiles.map((bot) => (
                  <BotEntry key={bot.id} bot={bot} bots={list} tile dragged={drag?.id === bot.id} onDrag={startDrag} />
                ))}
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5">
              {rest.map((bot) => (
                <BotEntry key={bot.id} bot={bot} bots={list} dragged={drag?.id === bot.id} onDrag={startDrag} />
              ))}
            </div>
            {!list.length ? <p className="px-2.5 py-1 text-[13px] text-ink-3">No bots yet</p> : null}
          </section>
        )}
      </SidebarScroll>
    </>
  )
}

// Where a dragged bot lands among the pins: beside the tile under the pointer,
// or last over the tiles' empty space. Off the tiles a pinned bot keeps its
// place, so the drop can unpin it, and a row leaves the pins.
function landing(e: DragEvent, drag: PinDrag, pinned: string[]): string[] {
  const target = e.target as Element
  const tile = target.closest<HTMLElement>('[data-pin]')
  if (tile) {
    const box = tile.getBoundingClientRect()
    return placePin(drag.pins, drag.id, tile.dataset.pin, e.clientX > box.left + box.width / 2)
  }
  if (target.closest('[data-pins]')) return placePin(drag.pins, drag.id, undefined, false)
  return pinned.includes(drag.id) ? drag.pins : drag.pins.filter((id) => id !== drag.id)
}

// A pinned bot is a tile (face over name); the rest are rows with a preview.
function BotEntry({ bot, bots, tile = false, dragged, onDrag }: {
  bot: Bot
  bots: Bot[]
  tile?: boolean
  dragged: boolean
  onDrag: (id: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const menuTriggers = useContextMenuTrigger(setMenu)
  // A working bot shows it on its face; the dot is for unread and failed.
  const working = bot.status === 'running'
  const state = working ? null : stateDot(bot)
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
        data-pin={tile ? bot.id : undefined}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          onDrag(bot.id)
        }}
        className={`select-none rounded-lg text-ink transition-[background-color,opacity] duration-150 [-webkit-touch-callout:none] hover:bg-list-hover ${dragged ? 'opacity-40' : ''} ${
          tile
            ? 'flex min-w-0 flex-col items-center gap-1.5 px-2 pt-3 pb-2 text-[12px] max-sm:text-[14px]'
            : 'flex h-13 items-center gap-2.5 px-2.5 text-[13px] max-sm:h-16 max-sm:text-[15px]'
        }`}
      >
        <BotIcon avatars={botAvatars(bot, bots)} size={tile ? 44 : 28} working={working} />
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
