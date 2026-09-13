import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { usageDateKey } from '@/lib/usageDaily'
import { recentUsageRange, usageRangeError, type UsageWindow } from '@/lib/usageWindow'

const presets = [
  { value: '1', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '182', label: 'Last 6 months' },
  { value: 'custom', label: 'Custom range' },
]

export function UsageWindowFilter({
  window,
  onChange,
}: {
  window: UsageWindow
  onChange: (window: UsageWindow) => void
}) {
  const [draft, setDraft] = useState(() => recentUsageRange(30))
  const error = usageRangeError(draft)
  const today = usageDateKey(new Date())

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Select
        aria-label="Usage period"
        className="min-h-10 shrink-0"
        value={'days' in window ? String(window.days) : 'custom'}
        options={presets}
        onChange={(value) => {
          if (value === 'custom') {
            const range = 'days' in window ? recentUsageRange(window.days) : window
            setDraft(range)
            onChange(range)
          } else {
            onChange({ days: Number(value) })
          }
        }}
      />
      {!('days' in window) ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!error) {
              onChange(draft)
            }
          }}
        >
          <Input
            aria-label="Start date"
            type="date"
            required
            max={today}
            value={draft.start}
            onChange={(event) => setDraft({ ...draft, start: event.target.value })}
            className="min-h-10 w-36! min-w-0"
          />
          <span className="text-[12px] text-ink-3">to</span>
          <Input
            aria-label="End date"
            type="date"
            required
            max={today}
            value={draft.end}
            onChange={(event) => setDraft({ ...draft, end: event.target.value })}
            className="min-h-10 w-36! min-w-0"
          />
          <Button type="submit" disabled={!!error} className="min-h-10">Apply</Button>
          {error ? <p role="alert" className="w-full text-[12px] text-danger">{error}</p> : null}
        </form>
      ) : null}
    </div>
  )
}
