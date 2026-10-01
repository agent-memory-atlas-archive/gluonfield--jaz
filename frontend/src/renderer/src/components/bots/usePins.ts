import { useQueryClient } from '@tanstack/react-query'
import { pinBots } from '@/lib/api/bots'
import type { Bot } from '@/lib/api/types'
import { pinOrder } from '@/lib/bots'
import { invalidateSessionLists } from '@/lib/query/invalidate'
import { keys } from '@/lib/query/keys'

// Rewrites the pinned order from the current one, like a state updater.
export function usePins() {
  const queryClient = useQueryClient()
  return (update: (pins: string[]) => string[]) => {
    const pins = pinOrder(queryClient.getQueryData<Bot[]>(keys.bots) ?? [])
    const next = update(pins)
    if (next.join() === pins.join()) return
    queryClient.setQueryData<Bot[]>(keys.bots, (bots) => bots?.map((bot) => ({ ...bot, pinned: next.indexOf(bot.id) + 1 || undefined })))
    void pinBots(next).finally(() => invalidateSessionLists(queryClient))
  }
}
