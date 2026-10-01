import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ModelSelect } from '@/components/session/ModelSelect'
import { Select } from '@/components/ui/Select'
import { agentLabel } from '@/lib/agentLabel'
import { enabledACPAgents, runtimeModelState } from '@/lib/agentRuntimes'
import { agentSettingsQuery } from '@/lib/api/settings'
import type { AgentSessionState, Bot } from '@/lib/api/types'
import { useModelReasoningState } from '@/lib/modelReasoning'
import { useUpdateBot } from './useUpdateBot'

// The bot's agent, and the model and effort it runs with in the composer's
// picker.
export function BotAgentSettings({ bot, agentSession, working }: { bot: Bot; agentSession?: AgentSessionState; working: boolean }) {
  return (
    <div className="-mx-2.5 flex flex-col">
      <Row label="Agent">
        <AgentSelect bot={bot} working={working} />
      </Row>
      <Row label="Model">
        <BotModelSelect bot={bot} agentSession={agentSession} working={working} />
      </Row>
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

// A running agent's own options are the truth; before it starts, the bot's
// stored pick is.
function BotModelSelect({ bot, agentSession, working }: { bot: Bot; agentSession?: AgentSessionState; working: boolean }) {
  const settings = useQuery(agentSettingsQuery).data
  const update = useUpdateBot(bot.id)
  const agent = bot.agent ?? ''
  const runtime = runtimeModelState(settings, agent)
  const live = (category: string) => agentSession?.config_options?.find((option) => option.category === category)?.current_value
  const model = live('model') || bot.model || runtime.defaultModel
  const reasoning = useModelReasoningState({
    settings,
    agent,
    model,
    reasoningEffort: live('thought_level') || bot.reasoning_effort || runtime.defaultEffort,
    usesProvider: runtime.usesProvider,
    provider: runtime.provider,
    selectedProvider: runtime.selectedProvider,
  })
  return (
    <div className="-mr-2.5 flex min-w-0 flex-1 justify-end">
      <ModelSelect
        key={agent}
        value={model}
        effort={reasoning.effectiveReasoningEffort}
        suggestions={reasoning.modelSuggestions}
        effortOptions={reasoning.reasoningOptions}
        loading={reasoning.modelsLoading}
        disabled={working || update.isPending}
        placement="below"
        align="end"
        onChange={(next) => update.mutate({ model: next.model, reasoning_effort: next.effort })}
      />
    </div>
  )
}
