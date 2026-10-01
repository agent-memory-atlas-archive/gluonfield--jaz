import { memo, useMemo } from 'react'
import type { ThreadChatView } from '@/components/session/ThreadView'
import type { Bot } from '@/lib/api/types'
import { botChat, subtasksDoing } from '@/lib/bots'
import { ChatLog } from './ChatLog'

// A bot's thread read as its chat, rebuilt only when the thread changes rather
// than on every render of the thread view around it.
export const BotChat = memo(function BotChat({ bot, bots, messages, events, working, threads }: ThreadChatView & { bot: Bot; bots: Bot[] }) {
  const chat = useMemo(() => botChat(messages, events, bot, working), [messages, events, bot, working])
  const subtasks = subtasksDoing(threads)
  const busy = working ? [{ bot, ...chat.work }] : subtasks ? [{ bot, doing: subtasks }] : []
  return <ChatLog entries={chat.entries} bots={bots} named={false} working={busy} />
})
