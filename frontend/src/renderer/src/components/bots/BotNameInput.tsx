import { useRef, useState } from 'react'
import type { Bot } from '@/lib/api/types'
import { useUpdateBot } from './useUpdateBot'

// Blur or Enter saves; Escape puts the old name back.
export function BotNameInput({ bot, autoFocus, className, onDone }: {
  bot: Bot
  autoFocus?: boolean
  className: string
  onDone?: () => void
}) {
  const [value, setValue] = useState(bot.name)
  const cancelled = useRef(false)
  const update = useUpdateBot(bot.id)

  const finish = () => {
    const next = value.trim()
    if (!cancelled.current && next && next !== bot.name) update.mutate({ name: next })
    else setValue(bot.name)
    onDone?.()
  }

  return (
    <input
      autoFocus={autoFocus}
      value={value}
      aria-label="Name"
      placeholder="Name"
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => {
        cancelled.current = false
        e.currentTarget.select()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') cancelled.current = true
        if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur()
      }}
      onBlur={finish}
      className={`min-w-0 select-text bg-transparent text-ink outline-none ${className}`}
    />
  )
}
