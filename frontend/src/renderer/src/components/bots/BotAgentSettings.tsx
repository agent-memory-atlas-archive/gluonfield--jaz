import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ModelSelect } from '@/components/session/ModelSelect'
import { Select } from '@/components/ui/Select'
import { agentLabel } from '@/lib/agentLabel'
import { enabledACPAgents, runtimeModelState } from '@/lib/agentRuntimes'
import { agentSettingsQuery } from '@/lib/api/settings'
import type { AgentSessionState, Bot } from '@/lib/api/types'
import type { ModelSelection } from '@/lib/modelPicker'
import { useModelReasoningState } from '@/lib/modelReasoning'
import { useUpdateBot } from './useUpdateBot'

// The bot's agent and model, and what its background workers run on, in the
// composer's picker. A running agent's own options are the truth for the bot;
// before it starts, the bot's stored pick is.
export function BotAgentSettings({ bot, agentSession, working }: { bot: Bot; agentSession?: AgentSessionState; working: boolean }) {
  const settings = useQuery(agentSettingsQuery)
  const update = useUpdateBot(bot.id)
  const agents = enabledACPAgents(settings.data)
  const live = (category: string) => agentSession?.config_options?.find((option) => option.category === category)?.current_value
  const worker = bot.worker?.agent ? bot.worker : undefined
  return (
    <div className="-mx-2.5 flex flex-col">
      <Row label="Agent">
        <AgentSelect bot={bot} agents={agents} working={working} />
      </Row>
      <Row label="Model">
        <AgentModelSelect
          agent={bot.agent ?? ''}
          model={live('model') || bot.model}
          effort={live('thought_level') || bot.reasoning_effort}
          disabled={working || update.isPending}
          onChange={(next) => update.mutate({ model: next.model, reasoning_effort: next.effort })}
        />
      </Row>
      <Row label="Workers">
        <Select
          aria-label="Workers"
          variant="plain"
          value={worker?.agent ?? ''}
          options={[{ value: '', label: 'Same as bot' }, ...agentOptions(agents, worker?.agent ?? '')]}
          disabled={update.isPending}
          onChange={(agent) => update.mutate({ worker: { agent } })}
        />
      </Row>
      {worker ? (
        <Row label="Worker model">
          <AgentModelSelect
            agent={worker.agent}
            model={worker.model}
            effort={worker.reasoning_effort}
            disabled={update.isPending}
            onChange={(next) => update.mutate({ worker: { agent: worker.agent, model: next.model, reasoning_effort: next.effort } })}
          />
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
function AgentSelect({ bot, agents, working }: { bot: Bot; agents: string[]; working: boolean }) {
  const update = useUpdateBot(bot.id)
  const current = bot.agent ?? ''
  return (
    <Select
      aria-label="Agent"
      variant="plain"
      value={current}
      options={agentOptions(agents, current)}
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

// The enabled agents, keeping one still in use after it was turned off.
function agentOptions(agents: string[], current: string) {
  return (!current || agents.includes(current) ? agents : [current, ...agents]).map((agent) => ({ value: agent, label: agentLabel(agent) }))
}

// One agent's model and effort from its catalog, defaulting to the agent's own.
function AgentModelSelect({ agent, model, effort, disabled, onChange }: {
  agent: string
  model?: string
  effort?: string
  disabled: boolean
  onChange: (selection: ModelSelection) => void
}) {
  const settings = useQuery(agentSettingsQuery).data
  const runtime = runtimeModelState(settings, agent)
  const value = model || runtime.defaultModel
  const reasoning = useModelReasoningState({
    settings,
    agent,
    model: value,
    reasoningEffort: effort || runtime.defaultEffort,
    usesProvider: runtime.usesProvider,
    provider: runtime.provider,
    selectedProvider: runtime.selectedProvider,
  })
  return (
    <div className="-mr-2.5 flex min-w-0 flex-1 justify-end">
      <ModelSelect
        key={agent}
        value={value}
        effort={reasoning.effectiveReasoningEffort}
        suggestions={reasoning.modelSuggestions}
        effortOptions={reasoning.reasoningOptions}
        loading={reasoning.modelsLoading}
        disabled={disabled}
        placement="below"
        align="end"
        onChange={onChange}
      />
    </div>
  )
}
