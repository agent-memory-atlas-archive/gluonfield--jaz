import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/toast'
import { setSessionAgentConfig } from '@/lib/api/sessions'
import type { AgentSessionConfigOption } from '@/lib/api/types'
import { keys } from '@/lib/query/keys'

export function NativeModelOptions({ sessionId, options, disabled }: {
  sessionId: string
  options?: AgentSessionConfigOption[] | null
  disabled: boolean
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const update = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) => setSessionAgentConfig(sessionId, id, value),
    onError: (error) => toast(error.message, 'danger'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.sessionOverview(sessionId) })
      queryClient.invalidateQueries({ queryKey: keys.sessionMessages(sessionId) })
    },
  })
  return options?.filter((option) => option.category === 'model_config').map((option) => (
    <div key={option.id} className="px-2.5 py-1">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <span className="text-[13px] text-ink-2">{option.name}</span>
        <Select
          aria-label={option.name}
          value={option.current_value}
          options={option.options.map((value) => ({ value: value.value, label: value.name }))}
          disabled={disabled || update.isPending}
          onChange={(value) => update.mutate({ id: option.id, value })}
        />
      </div>
      {option.description ? <p className="max-w-64 text-[11px] text-ink-3">{option.description}</p> : null}
    </div>
  ))
}
