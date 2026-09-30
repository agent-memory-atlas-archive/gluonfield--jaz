import { UserBubble } from '@/components/session/Bubble'
import { UserMessageMarkdown } from '@/components/session/MessageMarkdown'
import { SystemEventRow } from '@/components/session/SystemEventRow'
import type { Bot, BotAvatar as Avatar } from '@/lib/api/types'
import { BOT_COLORS, type ChatEntry } from '@/lib/bots'
import { messageTime } from '@/lib/format/time'
import { BotAvatar } from './BotAvatar'

const GONE: Avatar = { shape: 'circle', color: 'gray' }
const QUIET_GAP_MS = 30 * 60_000

// A messenger-style log shared by a bot's chat and a group: bubbles, the time
// after a quiet gap, activity rows, and who is working now. `named` labels
// each speaker with a name and face, which only a group needs.
export function ChatLog({
  entries,
  bots,
  named,
  working,
}: {
  entries: ChatEntry[]
  bots: Bot[]
  named: boolean
  working: { bot: Bot; doing?: string }[]
}) {
  const avatar = (id?: string) => bots.find((bot) => bot.id === id)?.avatar ?? GONE
  return (
    <div className="flex flex-col">
      {entries.map((entry, index) => {
        const previous = entries[index - 1]
        const next = entries[index + 1]
        const stamped = !previous || Date.parse(entry.at) - Date.parse(previous.at) > QUIET_GAP_MS
        const nextStamped = !next || Date.parse(next.at) - Date.parse(entry.at) > QUIET_GAP_MS
        const sameSpeaker = (other?: ChatEntry) =>
          other?.kind === entry.kind && (entry.kind !== 'bot' || (other.kind === 'bot' && other.botId === entry.botId))
        const opensRun = stamped || !sameSpeaker(previous)
        const closesRun = nextStamped || !sameSpeaker(next)
        return (
          <div key={entry.key} className={opensRun ? 'mt-4 first:mt-0' : 'mt-1'}>
            {stamped ? <p className="pb-3 text-center text-[12px] text-ink-3">{messageTime(entry.at)}</p> : null}
            {entry.kind === 'user' ? (
              <UserBubble text={entry.text} createdAt={entry.at} />
            ) : entry.kind === 'activity' ? (
              <SystemEventRow event={entry.event} />
            ) : (
              <div className="flex items-end gap-2.5">
                {named ? (
                  <span className="w-7 shrink-0">{closesRun ? <BotAvatar avatar={avatar(entry.botId)} size={28} /> : null}</span>
                ) : null}
                <div className="flex min-w-0 max-w-[84%] flex-col items-start gap-1">
                  {named && opensRun ? (
                    <span
                      className="px-1 text-[12px] font-medium"
                      style={{ color: `color-mix(in oklab, ${BOT_COLORS[avatar(entry.botId).color]} 65%, var(--color-ink))` }}
                    >
                      {entry.name}
                    </span>
                  ) : null}
                  <div className="min-w-0 rounded-card bg-surface px-3.5 py-2.5 text-sm [overflow-wrap:break-word] select-text">
                    <UserMessageMarkdown text={entry.text} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
      {working.map(({ bot, doing = 'working' }) => (
        <p key={bot.id} role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-3 first:mt-0">
          <BotAvatar avatar={bot.avatar} size={22} />
          <span className="live-shimmer">
            {bot.name} is {doing}…
          </span>
        </p>
      ))}
    </div>
  )
}
