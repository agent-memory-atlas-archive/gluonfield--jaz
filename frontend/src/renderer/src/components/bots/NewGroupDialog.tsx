import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/toast'
import { createGroup } from '@/lib/api/bots'
import type { Bot } from '@/lib/api/types'
import { keys } from '@/lib/query/keys'
import { BotAvatar } from './BotAvatar'

export function NewGroupDialog({ open, bots, onClose }: { open: boolean; bots: Bot[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const toast = useToast()
  const candidates = bots.filter((bot) => bot.kind === 'bot')
  const close = () => {
    setName('')
    setMembers([])
    onClose()
  }
  const create = useMutation({
    mutationFn: () =>
      createGroup({
        name: name.trim() || candidates.filter((bot) => members.includes(bot.id)).map((bot) => bot.name).join(', '),
        members,
      }),
    onSuccess: (group) => {
      queryClient.setQueryData<Bot[]>(keys.bots, (list = []) => [group, ...list])
      void queryClient.invalidateQueries({ queryKey: keys.bots })
      close()
      void navigate({ to: '/bots/$botId', params: { botId: group.id } })
    },
    onError: (error) => toast(`Couldn't create the group: ${error.message}`, 'danger'),
  })

  return (
    <Modal
      open={open}
      onClose={close}
      title="New group chat"
      size="sm"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={members.length < 2 || create.isPending} onClick={() => create.mutate()}>
            Create
          </Button>
        </div>
      }
    >
      <Input value={name} placeholder="Name" onChange={(e) => setName(e.target.value)} />
      {candidates.length < 2 ? <p className="mt-3 text-[13px] text-ink-3">A group needs two bots.</p> : null}
      <div className="mt-3 flex max-h-64 flex-col gap-px overflow-y-auto">
        {candidates.map((bot) => (
          <label key={bot.id} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2 hover:bg-list-hover">
            <Checkbox
              checked={members.includes(bot.id)}
              aria-label={bot.name}
              onChange={(on) => setMembers((ids) => (on ? [...ids, bot.id] : ids.filter((id) => id !== bot.id)))}
            />
            <BotAvatar avatar={bot.avatar} size={22} />
            <span className="min-w-0 truncate text-[13px] text-ink">{bot.name}</span>
          </label>
        ))}
      </div>
    </Modal>
  )
}
