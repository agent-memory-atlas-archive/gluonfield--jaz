import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type DragEvent, type Ref, useMemo, useState } from 'react'
import { stateDot } from '@/components/sidebar/SessionRow'
import { PANEL_ICON_BUTTON_CLASS, SidebarHeader, SidebarScroll } from '@/components/sidebar/SidebarScroll'
import { MarkdownText } from '@/components/session/MessageMarkdown'
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

const SPRING = { type: 'spring', duration: 0.3, bounce: 0 } as const
const TILE_COLUMNS = 3

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
  const startDrag = (id: string) => setDrag({ id, pins })

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
              const next = landing(e, drag, pins, tiles.map((bot) => bot.id))
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
                <AnimatePresence initial={false} mode="popLayout">
                  {tiles.map((bot) => (
                    <BotEntry key={bot.id} bot={bot} bots={list} tile dragged={drag?.id === bot.id} onDrag={startDrag} />
                  ))}
                </AnimatePresence>
              </div>
            ) : null}
            <div className="flex flex-col gap-0.5">
              <AnimatePresence initial={false} mode="popLayout">
                {rest.map((bot) => (
                  <BotEntry key={bot.id} bot={bot} bots={list} dragged={drag?.id === bot.id} onDrag={startDrag} />
                ))}
              </AnimatePresence>
            </div>
            {!list.length ? <p className="px-2.5 py-1 text-[13px] text-ink-3">No bots yet</p> : null}
          </section>
        )}
      </SidebarScroll>
    </>
  )
}

// Where a dragged bot lands among the pins: beside the tile in the grid cell
// under the pointer, or last past the tiles. Cells come from the grid, not the
// tiles, so a tile still sliding cannot bounce the drop back. Off the tiles a
// pinned bot keeps its place, so the drop can unpin it, and a row leaves.
function landing(e: DragEvent, drag: PinDrag, pinned: string[], tiles: string[]): string[] {
  const grid = (e.target as Element).closest('[data-pins]')
  if (!grid) return pinned.includes(drag.id) ? drag.pins : drag.pins.filter((id) => id !== drag.id)
  const box = grid.getBoundingClientRect()
  const width = box.width / TILE_COLUMNS
  const height = box.height / Math.ceil(tiles.length / TILE_COLUMNS)
  const x = e.clientX - box.left
  const column = Math.min(TILE_COLUMNS - 1, Math.floor(x / width))
  const cell = Math.floor((e.clientY - box.top) / height) * TILE_COLUMNS + column
  return placePin(drag.pins, drag.id, tiles[cell], x - column * width > width / 2)
}

// A pinned bot is a tile (face over name); the rest are rows with a preview.
// Tiles and rows slide to new places, and scale in and out as they come and go.
function BotEntry({ ref, bot, bots, tile = false, dragged, onDrag }: {
  ref?: Ref<HTMLDivElement>
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
    <motion.div
      ref={ref}
      layout="position"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: dragged ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={SPRING}
      className="min-w-0"
    >
      <Link
        to="/bots/$botId"
        params={{ botId: bot.id }}
        activeProps={{ className: 'bg-list-active!' }}
        {...menuTriggers}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move'
          onDrag(bot.id)
        }}
        className={`select-none rounded-lg text-ink transition-colors duration-150 [-webkit-touch-callout:none] hover:bg-list-hover ${
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
            {bot.preview ? (
              <span className="truncate text-[12px] text-ink-3">
                <MarkdownText text={bot.preview} />
              </span>
            ) : null}
          </span>
        )}
      </Link>
      {menu ? <BotMenu bot={bot} point={menu} onClose={() => setMenu(null)} onRename={() => setRenaming(true)} /> : null}
    </motion.div>
  )
}
