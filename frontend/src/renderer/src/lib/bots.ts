import type { Bot, BotAvatar, BotColor, BotShape } from '@/lib/api/types'

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

export function randomAvatar(): BotAvatar {
  return { shape: pick(BOT_SHAPES), color: pick(Object.keys(BOT_COLORS) as BotColor[]) }
}

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
