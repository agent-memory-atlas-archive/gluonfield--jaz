import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/toast'
import { pinBots } from '@/lib/api/bots'
import type { Bot } from '@/lib/api/types'
import { pinOrder } from '@/lib/bots'
import { invalidateSessionLists } from '@/lib/query/invalidate'
import { keys } from '@/lib/query/keys'

// Rewrites the pinned order from the current one, like a state updater.
export function usePins() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return (update: (pins: string[]) => string[]) => {
    const pins = pinOrder(queryClient.getQueryData<Bot[]>(keys.bots) ?? [])
    const next = update(pins)
    if (next.join() === pins.join()) return
    queryClient.setQueryData<Bot[]>(keys.bots, (bots) => bots?.map((bot) => ({ ...bot, pinned: next.indexOf(bot.id) + 1 || undefined })))
    void pinBots(next)
      .catch((error: Error) => toast(`Couldn't pin: ${error.message}`, 'danger'))
      .finally(() => invalidateSessionLists(queryClient))
  }
}
