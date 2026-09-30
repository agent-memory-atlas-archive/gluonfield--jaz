import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, MoreHorizontal, Play, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { compactSchedule } from '@/components/loops/schedule'
import { IconButton } from '@/components/ui/IconButton'
import { MenuRow, Popover } from '@/components/ui/Popover'
import { Switch } from '@/components/ui/Switch'
import { useToast } from '@/components/ui/toast'
import { apiUrl } from '@/lib/api/client'
import { botRoutinesQuery, deleteLoop, loopTone, runLoopNow, TONE_DOT, updateLoop } from '@/lib/api/loops'
import type { Bot, Loop, LoopTrigger } from '@/lib/api/types'
import { writeClipboard } from '@/lib/clipboard'
import { hasTime, messageTime } from '@/lib/format/time'
import { keys } from '@/lib/query/keys'

const SOURCES: Record<Exclude<LoopTrigger['kind'], 'webhook'>, string> = {
  gmail: 'Gmail',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  slack: 'Slack',
}

function routineWhen({ trigger, schedule }: Loop): string {
  if (!trigger) return compactSchedule(schedule.expr, false)
  if (trigger.kind === 'webhook') return 'Webhook'
  const where = trigger.kind === 'slack' && trigger.subject ? ` in ${trigger.subject}` : ''
  return `New ${SOURCES[trigger.kind]}${trigger.from ? ` from ${trigger.from}` : ''}${where}`
}

export function BotRoutines({ bot }: { bot: Bot }) {
  const routines = useQuery(botRoutinesQuery(bot.id))
  return (
    <section className="flex flex-col gap-1">
      {routines.data?.length ? (
        routines.data.map((loop) => <RoutineRow key={loop.id} loop={loop} />)
      ) : routines.isPending ? null : (
        <p className="text-[13px] text-ink-3">Ask {bot.name} to schedule something.</p>
      )}
    </section>
  )
}

function RoutineRow({ loop }: { loop: Loop }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const paused = loop.status === 'paused'
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: keys.loops })
    queryClient.invalidateQueries({ queryKey: keys.bots })
  }
  const act = useMutation({
    mutationFn: (action: 'toggle' | 'run' | 'delete'): Promise<unknown> =>
      action === 'toggle'
        ? updateLoop(loop.id, { status: paused ? 'active' : 'paused' })
        : action === 'run'
          ? runLoopNow(loop.id)
          : deleteLoop(loop.id),
    onSettled: invalidate,
    onError: (error) => toast(`Couldn't update ${loop.name}: ${error.message}`, 'danger'),
  })
  const menu = (action: () => void) => () => {
    setMenuOpen(false)
    action()
  }
  const when = paused ? 'Paused' : hasTime(loop.next_run_at) ? `next ${messageTime(loop.next_run_at)}` : ''

  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[loopTone(loop.last_run_status, loop.status)]}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-ink">{loop.name}</p>
        <p className="truncate text-[12px] text-ink-3">{[routineWhen(loop), when].filter(Boolean).join(' · ')}</p>
      </div>
      <Switch
        checked={!paused}
        aria-label={paused ? `Resume ${loop.name}` : `Pause ${loop.name}`}
        disabled={act.isPending}
        onChange={() => act.mutate('toggle')}
      />
      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="below"
        align="end"
        trigger={
          <IconButton size="xs" aria-label={`${loop.name} actions`} title="More" onClick={() => setMenuOpen((open) => !open)}>
            <MoreHorizontal size={14} />
          </IconButton>
        }
      >
        <MenuRow onClick={menu(() => act.mutate('run'))}>
          <span className="flex items-center gap-2">
            <Play size={13} />
            Run now
          </span>
        </MenuRow>
        {loop.trigger?.kind === 'webhook' ? (
          <MenuRow onClick={menu(() => void writeClipboard(apiUrl(`/v1/hooks/${loop.id}`)))}>
            <span className="flex items-center gap-2">
              <Link2 size={13} />
              Copy webhook URL
            </span>
          </MenuRow>
        ) : null}
        <MenuRow
          onClick={menu(() => {
            if (window.confirm(`Delete ${loop.name}?`)) act.mutate('delete')
          })}
        >
          <span className="flex items-center gap-2 text-danger">
            <Trash2 size={13} />
            Delete
          </span>
        </MenuRow>
      </Popover>
    </div>
  )
}
