import { queryOptions } from '@tanstack/react-query'
import { keys } from '@/lib/query/keys'
import { del, get, patch, post } from './client'
import type { Bot, BotAvatar } from './types'

// Polling belongs to the list on screen; other readers take the shared cache.
export const botsQuery = queryOptions({
  queryKey: keys.bots,
  queryFn: async () => (await get<{ bots: Bot[] | null }>('/v1/bots')).bots ?? [],
  staleTime: 10_000,
})

export function createBot(input: { name: string; avatar: BotAvatar }): Promise<Bot> {
  return post<Bot>('/v1/bots', input)
}

export function createGroup(input: { name: string; members: string[] }): Promise<Bot> {
  return post<Bot>('/v1/bots/groups', input)
}

export type BotPatch = Partial<Pick<Bot, 'name' | 'avatar' | 'members' | 'agent' | 'model' | 'reasoning_effort' | 'worker'>>

export function updateBot(id: string, input: BotPatch): Promise<Bot> {
  return patch<Bot>(`/v1/bots/${id}`, input)
}

export function deleteBot(id: string): Promise<void> {
  return del<void>(`/v1/bots/${id}`)
}

export function sendGroupMessage(id: string, text: string): Promise<void> {
  return post<void>(`/v1/bots/${id}/messages`, { text })
}
