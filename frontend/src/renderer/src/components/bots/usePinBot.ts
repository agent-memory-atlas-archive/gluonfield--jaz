import { useQueryClient } from '@tanstack/react-query'
import { setSessionPinned } from '@/lib/api/sessions'
import type { Bot } from '@/lib/api/types'
import { invalidateSessionLists } from '@/lib/query/invalidate'
import { keys } from '@/lib/query/keys'

export function usePinBot() {
  const queryClient = useQueryClient()
  return (id: string, pinned: boolean) => {
    queryClient.setQueryData<Bot[]>(keys.bots, (bots) => bots?.map((bot) => (bot.id === id ? { ...bot, pinned } : bot)))
    void setSessionPinned(id, pinned).finally(() => invalidateSessionLists(queryClient))
  }
}
