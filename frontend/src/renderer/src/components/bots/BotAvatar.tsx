import type { ReactNode } from 'react'
import type { BotAvatar as Avatar, BotShape } from '@/lib/api/types'
import { BOT_COLORS } from '@/lib/bots'

// Drawn on a 100×100 grid; `eyes` is the vertical center of the eye pair.
// Triangle and hex round their corners with a same-color stroke.
const SHAPES: Record<BotShape, { eyes: number; body: (fill: string) => ReactNode }> = {
  circle: { eyes: 50, body: () => <circle cx="50" cy="50" r="46" /> },
  blob: {
    eyes: 50,
    body: () => <path d="M56 5c22 2 38 18 38 40 0 16-6 25-8 36-3 13-19 16-34 14C27 92 6 80 6 55 6 26 29 3 56 5z" />,
  },
  squircle: { eyes: 50, body: () => <rect x="6" y="6" width="88" height="88" rx="32" /> },
  pill: { eyes: 46, body: () => <rect x="20" y="4" width="60" height="92" rx="30" /> },
  triangle: {
    eyes: 62,
    body: (fill) => <path d="M50 14 88 80H12z" stroke={fill} strokeWidth="16" strokeLinejoin="round" />,
  },
  hex: {
    eyes: 50,
    body: (fill) => <path d="m50 11 34 19.5v39L50 89 16 69.5v-39z" stroke={fill} strokeWidth="12" strokeLinejoin="round" />,
  },
  cloud: {
    eyes: 58,
    body: () => (
      <>
        <circle cx="32" cy="60" r="22" />
        <circle cx="56" cy="44" r="28" />
        <circle cx="74" cy="62" r="20" />
        <rect x="12" y="56" width="76" height="26" rx="13" />
      </>
    ),
  },
  drop: { eyes: 64, body: () => <path d="M50 4s36 38 36 59a36 36 0 0 1-72 0C14 42 50 4 50 4z" /> },
}

export function BotAvatar({ avatar, size, className = '' }: { avatar: Avatar; size: number; className?: string }) {
  const fill = BOT_COLORS[avatar.color]
  const { eyes, body } = SHAPES[avatar.shape]
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={`shrink-0 overflow-visible drop-shadow-[0_0_0.5px_rgb(0_0_0/0.35)] ${className}`}
    >
      <g fill={fill}>{body(fill)}</g>
      <ellipse cx="38" cy={eyes} rx="6.5" ry="10" fill="#1c1c1f" />
      <ellipse cx="62" cy={eyes} rx="6.5" ry="10" fill="#1c1c1f" />
    </svg>
  )
}

// One face for a bot; a group overlaps its first two members.
export function BotIcon({ avatars, size }: { avatars: Avatar[]; size: number }) {
  if (avatars.length < 2) return <BotAvatar avatar={avatars[0]} size={size} />
  const member = Math.round(size * 0.72)
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <BotAvatar avatar={avatars[0]} size={member} className="absolute left-0 top-0" />
      <BotAvatar avatar={avatars[1]} size={member} className="absolute right-0 bottom-0" />
    </span>
  )
}

// The bot's identity centered in the titlebar.
export function BotPill({ avatars, name }: { avatars: Avatar[]; name: string }) {
  return (
    <span className="mx-auto flex min-w-0 items-center gap-1.5 rounded-full bg-surface py-0.5 pr-3 pl-1 text-[13px] font-medium text-ink">
      <BotIcon avatars={avatars} size={22} />
      <span className="truncate">{name}</span>
    </span>
  )
}
