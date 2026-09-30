import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus, Users } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useState } from 'react'
import { PANEL_ICON_BUTTON_CLASS } from '@/components/sidebar/SidebarScroll'
import { KeyboardShortcut } from '@/components/ui/KeyboardShortcut'
import { Popover } from '@/components/ui/Popover'
import { useToast } from '@/components/ui/toast'
import { createBot } from '@/lib/api/bots'
import type { Bot } from '@/lib/api/types'
import { botAvatars, randomAvatar } from '@/lib/bots'
import { keys } from '@/lib/query/keys'
import { BotIcon } from './BotAvatar'
import { NewGroupDialog } from './NewGroupDialog'

// A bot exists as soon as it is created; it opens with its details showing so
// the placeholder name gets replaced first.
export function useCreateBot() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  return useMutation({
    mutationFn: () => createBot({ name: 'New bot', avatar: randomAvatar() }),
    onSuccess: (bot) => {
      queryClient.setQueryData<Bot[]>(keys.bots, (bots = []) => [bot, ...bots])
      void queryClient.invalidateQueries({ queryKey: keys.bots })
      void navigate({ to: '/bots/$botId', params: { botId: bot.id }, state: { newBot: true } })
    },
    onError: (error) => toast(`Couldn't create a bot: ${error.message}`, 'danger'),
  })
}

type Row = { key: string; label: string; icon: ReactNode; run: () => void }

export function NewBotPicker({ bots }: { bots: Bot[] }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [grouping, setGrouping] = useState(false)
  const navigate = useNavigate()
  const create = useCreateBot()
  const needle = query.trim().toLowerCase()
  const rows: Row[] = [
    { key: 'bot', label: 'New bot', icon: <Plus size={15} />, run: () => create.mutate() },
    { key: 'group', label: 'New group chat', icon: <Users size={15} />, run: () => setGrouping(true) },
    ...bots
      .filter((bot) => bot.name.toLowerCase().includes(needle))
      .map((bot) => ({
        key: bot.id,
        label: bot.name,
        icon: <BotIcon avatars={botAvatars(bot, bots)} size={18} />,
        run: () => void navigate({ to: '/bots/$botId', params: { botId: bot.id } }),
      })),
  ]

  const close = () => {
    setOpen(false)
    setQuery('')
    setActive(0)
  }
  const choose = (row?: Row) => {
    if (!row) return
    close()
    row.run()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && /^[1-9]$/.test(e.key)) {
      e.preventDefault()
      choose(rows[Number(e.key) - 1])
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((index) => Math.min(Math.max(index + (e.key === 'ArrowDown' ? 1 : -1), 0), rows.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(rows[active])
    }
  }

  return (
    <>
      <Popover
        open={open}
        onClose={close}
        placement="below"
        align="end"
        trigger={
          <button
            type="button"
            aria-label="New bot or group"
            title="New bot or group"
            aria-expanded={open}
            onClick={() => (open ? close() : setOpen(true))}
            className={PANEL_ICON_BUTTON_CLASS}
          >
            <Plus size={15} className="max-sm:size-[18px]" />
          </button>
        }
      >
        <div className="w-60" onKeyDown={onKeyDown}>
          <input
            autoFocus
            value={query}
            aria-label="Start a chat with"
            placeholder="Start a chat with…"
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            className="h-8 w-full bg-transparent px-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
          />
          <div className="scrollbar-quiet max-h-72 overflow-y-auto">
            {rows.map((row, index) => (
              <button
                key={row.key}
                type="button"
                onMouseMove={() => setActive(index)}
                onClick={() => choose(row)}
                className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] text-ink ${
                  index === active ? 'bg-list-hover' : ''
                }`}
              >
                <span className="grid size-[18px] shrink-0 place-items-center text-ink-2">{row.icon}</span>
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                {index < 9 ? <KeyboardShortcut value={index + 1} className="border-transparent bg-surface-2" /> : null}
              </button>
            ))}
          </div>
        </div>
      </Popover>
      <NewGroupDialog open={grouping} bots={bots} onClose={() => setGrouping(false)} />
    </>
  )
}
