import { useState } from 'react'
import { SidePanelShell } from '@/components/session/SidePanelShell'
import { Popover } from '@/components/ui/Popover'
import { agentLabel } from '@/lib/agentLabel'
import type { Bot, BotColor } from '@/lib/api/types'
import { BOT_COLORS, BOT_SHAPES } from '@/lib/bots'
import { OVERVIEW_PANEL_WIDTH } from '@/lib/sidePanelTabs'
import { BotAvatar } from './BotAvatar'
import { BotNameInput } from './BotNameInput'
import { BotRoutines } from './BotRoutines'
import { useUpdateBot } from './useUpdateBot'

export function BotDetails({ bot, focusName }: { bot: Bot; focusName: boolean }) {
  return (
    <SidePanelShell width={OVERVIEW_PANEL_WIDTH} variant="hug" className="gap-6 px-4 py-5">
      <div className="flex flex-col items-center gap-1 text-center">
        <AvatarEditor bot={bot} />
        <BotNameInput
          key={bot.id}
          bot={bot}
          autoFocus={focusName}
          className="mt-2 w-full rounded-md px-1 text-center text-[17px] font-semibold hover:bg-list-hover focus:bg-list-hover"
        />
        <p className="text-[12px] text-ink-3">{[agentLabel(bot.agent), bot.model].filter(Boolean).join(' · ')}</p>
        {bot.directory ? <p className="max-w-full truncate text-[12px] text-ink-3">{bot.directory}</p> : null}
      </div>
      <BotRoutines bot={bot} />
    </SidePanelShell>
  )
}

// Shapes wear the current color and colors the current shape, so every pick
// previews exactly what it sets.
function AvatarEditor({ bot }: { bot: Bot }) {
  const [open, setOpen] = useState(false)
  const update = useUpdateBot(bot.id)
  const { avatar } = bot
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      placement="below"
      trigger={
        <button
          type="button"
          aria-label="Change face"
          title="Change face"
          onClick={() => setOpen((value) => !value)}
          className="grid size-20 place-items-center rounded-full transition-transform duration-150 hover:scale-[1.04] active:scale-[0.97]"
        >
          <BotAvatar avatar={avatar} size={72} />
        </button>
      }
    >
      <div className="flex w-60 flex-col gap-2 p-1">
        <div className="grid grid-cols-4 gap-1">
          {BOT_SHAPES.map((shape) => (
            <button
              key={shape}
              type="button"
              aria-label={shape}
              aria-pressed={shape === avatar.shape}
              onClick={() => update.mutate({ avatar: { ...avatar, shape } })}
              className={`grid h-12 place-items-center rounded-[8px] transition-colors duration-150 hover:bg-list-hover ${
                shape === avatar.shape ? 'bg-list-active' : ''
              }`}
            >
              <BotAvatar avatar={{ ...avatar, shape }} size={34} />
            </button>
          ))}
        </div>
        <div className="grid grid-cols-6 gap-1 border-t border-border pt-2">
          {(Object.keys(BOT_COLORS) as BotColor[]).map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={color === avatar.color}
              onClick={() => update.mutate({ avatar: { ...avatar, color } })}
              className={`grid h-9 place-items-center rounded-[8px] transition-colors duration-150 hover:bg-list-hover ${
                color === avatar.color ? 'bg-list-active' : ''
              }`}
            >
              <BotAvatar avatar={{ ...avatar, color }} size={24} />
            </button>
          ))}
        </div>
      </div>
    </Popover>
  )
}
