import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Pencil, Pin, Trash2 } from 'lucide-react'
import { ContextMenu, MenuRow } from '@/components/ui/Popover'
import { useToast } from '@/components/ui/toast'
import { deleteBot } from '@/lib/api/bots'
import { setSessionPinned } from '@/lib/api/sessions'
import type { Bot } from '@/lib/api/types'
import { invalidateSessionLists } from '@/lib/query/invalidate'
import { keys } from '@/lib/query/keys'

// Right-click / press-and-hold actions for a bot or group in the panel.
export function BotMenu({ bot, point, onClose, onRename }: {
  bot: Bot
  point: { x: number; y: number }
  onClose: () => void
  onRename: () => void
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const openBotId = useParams({ strict: false }).botId
  const toast = useToast()

  const patchCache = (update: (bots: Bot[]) => Bot[]) =>
    queryClient.setQueryData<Bot[]>(keys.bots, (bots) => bots && update(bots))
  const run = (action: () => void) => () => {
    onClose()
    action()
  }
  const togglePin = () => {
    patchCache((bots) => bots.map((item) => (item.id === bot.id ? { ...item, pinned: !bot.pinned } : item)))
    void setSessionPinned(bot.id, !bot.pinned).finally(() => invalidateSessionLists(queryClient))
  }
  const remove = () => {
    if (!window.confirm(bot.kind === 'bot' ? `Delete ${bot.name}? Its routines stop.` : `Delete ${bot.name}?`)) return
    void deleteBot(bot.id)
      .then(() => {
        patchCache((bots) => bots.filter((item) => item.id !== bot.id))
        invalidateSessionLists(queryClient)
        queryClient.invalidateQueries({ queryKey: keys.loops })
        if (openBotId === bot.id) void navigate({ to: '/bots' })
      })
      .catch((error: Error) => toast(`Couldn't delete: ${error.message}`, 'danger'))
  }

  return (
    <ContextMenu point={point} onClose={onClose}>
      <MenuRow onClick={run(togglePin)}>
        <span className="flex items-center gap-2">
          <Pin size={13} className={bot.pinned ? 'fill-current' : ''} />
          {bot.pinned ? 'Unpin' : 'Pin'}
        </span>
      </MenuRow>
      <MenuRow onClick={run(onRename)}>
        <span className="flex items-center gap-2">
          <Pencil size={13} />
          Rename
        </span>
      </MenuRow>
      <MenuRow onClick={run(remove)}>
        <span className="flex items-center gap-2 text-danger">
          <Trash2 size={13} />
          Delete
        </span>
      </MenuRow>
    </ContextMenu>
  )
}
