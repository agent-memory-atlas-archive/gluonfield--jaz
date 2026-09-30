import type { Bot, BotAvatar, BotColor, BotShape, ChatMessage, SessionEvent } from '@/lib/api/types'
import { messageText } from '@/lib/messageText'

export const BOT_SHAPES: BotShape[] = ['circle', 'blob', 'squircle', 'pill', 'triangle', 'hex', 'cloud', 'drop']

// Fills bright enough to carry dark eyes on both themes.
export const BOT_COLORS: Record<BotColor, string> = {
  white: '#f4f4f5',
  brown: '#c08b5c',
  red: '#f45d5d',
  orange: '#f98c46',
  amber: '#f6c443',
  green: '#5bcb72',
  teal: '#37c6b4',
  blue: '#58a0f8',
  purple: '#a682f6',
  pink: '#f47fbf',
  gray: '#a3a3ad',
}

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)]

// A random face skips the neutral white and gray.
const VIVID = (Object.keys(BOT_COLORS) as BotColor[]).filter((color) => color !== 'white' && color !== 'gray')

export function randomAvatar(): BotAvatar {
  return { shape: pick(BOT_SHAPES), color: pick(VIVID) }
}

const LAST_BOT_KEY = 'jaz.lastBot'

// The Bots tab returns to the chat the user left, as Chat returns to its thread.
export const lastBotId = () => localStorage.getItem(LAST_BOT_KEY) ?? undefined
export const rememberBot = (id: string) => localStorage.setItem(LAST_BOT_KEY, id)

const TARGET_PREFIX = 'bot:'

export const botTarget = (id: string) => `${TARGET_PREFIX}${id}`

export function botIdFromTarget(target: string): string | undefined {
  return target.startsWith(TARGET_PREFIX) ? target.slice(TARGET_PREFIX.length) : undefined
}

// Pinned tiles keep a stable order; the list below moves with activity.
export function botSections(bots: Bot[], query: string) {
  const needle = query.trim().toLowerCase()
  const matching = bots.filter((bot) => bot.name.toLowerCase().includes(needle))
  return {
    pinned: matching.filter((bot) => bot.pinned).toSorted((a, b) => a.name.localeCompare(b.name)),
    rest: matching
      .filter((bot) => !bot.pinned)
      .toSorted((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)),
  }
}

// A group wears its first two members' faces, falling back to its own.
export function botAvatars(bot: Bot, bots: Bot[]): BotAvatar[] {
  if (bot.kind === 'bot') return [bot.avatar]
  const members = (bot.members ?? [])
    .flatMap((id) => bots.find((member) => member.id === id)?.avatar ?? [])
    .slice(0, 2)
  return members.length ? members : [bot.avatar]
}

export type ChatEntry =
  | { kind: 'user'; key: string; at: string; text: string }
  | { kind: 'bot'; key: string; at: string; botId?: string; name: string; text: string }
  | { kind: 'activity'; key: string; at: string; event: SessionEvent }

type ChatTurn = { user: boolean; spoke: boolean; reply?: { key: string; at: string; text: string } }

const SHOWN_ACTIVITY = new Set(['message_sent', 'message_received'])

// A bot's chat log: what people typed, what bots sent with send_message, and
// the activity worth a row. Everything else in the thread is the bot's private
// work. A finished turn the user started in which the bot sent nothing shows
// its last written reply, so an answer is never lost.
export function chatEntries(
  messages: ChatMessage[],
  events: SessionEvent[],
  self: { id: string; name: string },
  working: boolean,
): ChatEntry[] {
  const items = [
    ...messages.flatMap((message) =>
      message.role === 'user' ? [{ at: message.created_at, message, event: undefined }] : [],
    ),
    ...events.map((event) => ({ at: event.at, message: undefined, event })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const out: ChatEntry[] = []
  let turn: ChatTurn | undefined
  const close = () => {
    if (turn?.user && !turn.spoke && turn.reply) out.push({ kind: 'bot', name: self.name, botId: self.id, ...turn.reply })
  }
  for (const { at, message, event } of items) {
    if (message) {
      close()
      out.push({ kind: 'user', key: `message:${message.seq}:${at}`, at, text: messageText(message) })
      turn = { user: true, spoke: false }
      continue
    }
    const key = `${event.session_id}:${event.seq ?? at}`
    const room = event.room_message
    if (room) {
      if (room.speaker === 'user') out.push({ kind: 'user', key, at, text: room.text })
      else out.push({ kind: 'bot', key, at, botId: room.bot_id, name: room.name, text: room.text })
      if (turn && room.speaker === 'bot') turn.spoke = true
    } else if (event.bot_activity) {
      close()
      if (SHOWN_ACTIVITY.has(event.bot_activity.kind)) out.push({ kind: 'activity', key, at, event })
      turn = { user: false, spoke: false }
    } else if (event.loop_created || event.type === 'agent_switch') {
      out.push({ kind: 'activity', key, at, event })
    } else if (turn && (event.type === 'acp_message' || event.type === 'acp') && event.acp?.id === self.id && event.content?.trim()) {
      turn.reply = { key, at, text: event.content.trim() }
    }
  }
  if (!working) close()
  return out
}

// What a bot is busy with when a group, another bot or a routine opened its
// latest turn, whose output lands elsewhere; undefined for the user's own.
export function botDoing(messages: ChatMessage[], events: SessionEvent[]): string | undefined {
  const opener = events.findLast((event) => event.bot_activity && event.bot_activity.kind !== 'message_sent')
  const activity = opener?.bot_activity
  if (!opener || !activity) return undefined
  if (messages.some((message) => message.role === 'user' && Date.parse(message.created_at) > Date.parse(opener.at))) return undefined
  switch (activity.kind) {
    case 'group':
      return `working in ${activity.label}`
    case 'message_received':
      return `working on ${activity.label}'s message`
    case 'routine':
      return `running ${activity.label}`
  }
  return undefined
}

