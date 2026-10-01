import { useQuery } from '@tanstack/react-query'
import { botsQuery } from '@/lib/api/bots'
import type { Bot } from '@/lib/api/types'

// The bot a voice conversation is with, when its thread is a bot's.
export function useVoiceBot(sessionId: string | null): Bot | undefined {
  const bots = useQuery({ ...botsQuery, enabled: Boolean(sessionId) })
  return bots.data?.find((bot) => bot.id === sessionId)
}

// The route a voice conversation lives on: its bot's chat, or its thread.
export function voiceHome(sessionId: string, bot: Bot | undefined): string {
  return bot ? `/bots/${sessionId}` : `/sessions/${sessionId}`
}
