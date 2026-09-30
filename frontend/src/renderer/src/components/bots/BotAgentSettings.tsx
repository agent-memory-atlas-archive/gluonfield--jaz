import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/toast'
import { agentLabel } from '@/lib/agentLabel'
import { enabledACPAgents } from '@/lib/agentRuntimes'
import { setSessionAgentConfig } from '@/lib/api/sessions'
import { agentSettingsQuery } from '@/lib/api/settings'
import type { AgentSessionConfigOption, AgentSessionState, Bot } from '@/lib/api/types'
import { keys } from '@/lib/query/keys'
import { useUpdateBot } from './useUpdateBot'

// The bot's agent and that agent's own model and reasoning options.
export function BotAgentSettings({ bot, agentSession, working }: { bot: Bot; agentSession?: AgentSessionState; working: boolean }) {
  const options = agentSession?.config_options ?? []
  const model = options.find((option) => option.category === 'model')
  const reasoning = options.find((option) => option.category === 'thought_level')
  return (
    <div className="-mx-2.5 flex flex-col">
      <Row label="Agent">
        <AgentSelect bot={bot} working={working} />
      </Row>
      {model ? (
        <Row label="Model">
          <OptionSelect sessionId={bot.id} option={model} working={working} />
        </Row>
      ) : null}
      {reasoning ? (
        <Row label="Reasoning">
          <OptionSelect sessionId={bot.id} option={reasoning} working={working} />
        </Row>
      ) : null}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-9 items-center gap-3 rounded-lg px-2.5 transition-colors duration-150 hover:bg-list-hover">
      <span className="shrink-0 text-[13px] text-ink">{label}</span>
      {children}
    </div>
  )
}

// Another agent keeps the bot, its chat and routines, but starts with no
// memory of the conversation, so the move asks first.
function AgentSelect({ bot, working }: { bot: Bot; working: boolean }) {
  const settings = useQuery(agentSettingsQuery)
  const update = useUpdateBot(bot.id)
  const current = bot.agent ?? ''
  const agents = enabledACPAgents(settings.data)
  const choices = !current || agents.includes(current) ? agents : [current, ...agents]
  return (
    <Select
      aria-label="Agent"
      variant="plain"
      value={current}
      options={choices.map((agent) => ({ value: agent, label: agentLabel(agent) }))}
      disabled={working || update.isPending}
      onChange={(agent) => {
        if (agent === current) return
        const label = agentLabel(agent)
        if (!window.confirm(`Move ${bot.name} to ${label}? ${label} starts with a fresh memory; the chat and routines stay.`)) return
        update.mutate({ agent })
      }}
    />
  )
}

function OptionSelect({ sessionId, option, working }: { sessionId: string; option: AgentSessionConfigOption; working: boolean }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const update = useMutation({
    mutationFn: (value: string) => setSessionAgentConfig(sessionId, option.id, value),
    onError: (error) => toast(error.message, 'danger'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.sessionOverview(sessionId) })
      queryClient.invalidateQueries({ queryKey: keys.bots })
    },
  })
  return (
    <Select
      aria-label={option.name}
      variant="plain"
      value={option.current_value}
      options={option.options.map((value) => ({ value: value.value, label: value.name }))}
      disabled={working || update.isPending}
      onChange={(value) => update.mutate(value)}
    />
  )
}
